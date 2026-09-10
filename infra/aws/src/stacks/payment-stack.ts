import {
  CfnOutput,
  Duration,
  IgnoreMode,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as efs from 'aws-cdk-lib/aws-efs'
import * as patterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as logs from 'aws-cdk-lib/aws-logs'
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets'
import type { Construct } from 'constructs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DeploymentStage } from '../config.js'

export interface PaymentStackProps extends StackProps {
  stage: DeploymentStage
  registryUrl: string
  corsOrigins: string
}

/** One durable testnet worker, with stop-before-start deployments and private facilitators. */
export class PaymentStack extends Stack {
  constructor(scope: Construct, id: string, props: PaymentStackProps) {
    super(scope, id, props)
    if (!props.registryUrl.startsWith('https://'))
      throw new Error('Payment registry must use HTTPS')
    const root = resolve(import.meta.dirname, '../../../..')
    const deployments = JSON.parse(
      readFileSync(
        resolve(root, 'packages/contracts/deployments/testnet-preview.json'),
        'utf8',
      ),
    )
    const treasury = '0xD9303DFc71728f209EF64DD1AD97F5a557AE0Fab'
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    })
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: `common-arcade-${props.stage}-payments`,
    })
    const runtimeSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'RuntimeSecret',
      `common-arcade/${props.stage}/payments`,
    )
    const originSecret = new secretsmanager.Secret(this, 'OriginSecret', {
      description: 'CloudFront-to-payment-origin authentication',
      generateSecretString: { excludePunctuation: true, passwordLength: 48 },
    })
    const image = new DockerImageAsset(this, 'Image', {
      directory: root,
      file: 'services/payment-service/Dockerfile',
      exclude: [
        '.git/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/.turbo/**',
        '**/cdk.out/**',
        '**/.env*',
        '**/lib/forge-std/**',
        '**/lib/openzeppelin-contracts/**',
        '**/lib/safe-contracts/**',
        '**/out/**',
        '**/cache/**',
        '**/broadcast/**',
      ],
      ignoreMode: IgnoreMode.GLOB,
      platform: Platform.LINUX_AMD64,
    })
    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    const task = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 512,
      memoryLimitMiB: 1024,
    })
    const container = task.addContainer('payments', {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      essential: true,
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'payments' }),
      environment: {
        PORT: '4021',
        ARCADE_PAYMENT_DATA_DIR: '/data',
        ARCADE_ESCROW_DEPLOYMENTS: JSON.stringify(deployments),
        ARCADE_REGISTRY_URL: props.registryUrl.replace(/\/$/, ''),
        ARCADE_PAYMENT_ORIGINS: props.corsOrigins,
        ARCADE_PAYMENT_CREATORS: treasury,
        ARCADE_X402_RAILS: JSON.stringify([
          {
            network: 'base-sepolia',
            payTo: treasury,
            facilitatorUrl: 'http://127.0.0.1:4022',
          },
          {
            network: 'arc-testnet',
            payTo: treasury,
            facilitatorUrl: 'http://127.0.0.1:4023',
          },
          {
            network: 'hedera-testnet',
            payTo: '0.0.10456930',
            facilitatorUrl: 'https://api.testnet.blocky402.com',
          },
        ]),
      },
      secrets: {
        ARCADE_RESOLVER_KEY_84532: ecs.Secret.fromSecretsManager(
          runtimeSecret,
          'resolverKey',
        ),
        ARCADE_RESOLVER_KEY_5042002: ecs.Secret.fromSecretsManager(
          runtimeSecret,
          'resolverKey',
        ),
        ARCADE_RESOLVER_KEY_296: ecs.Secret.fromSecretsManager(
          runtimeSecret,
          'resolverKey',
        ),
        ARCADE_ORIGIN_TOKEN: ecs.Secret.fromSecretsManager(originSecret),
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          'node -e "fetch(\'http://127.0.0.1:4021/healthz\').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"',
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        startPeriod: Duration.seconds(60),
        retries: 3,
      },
    })
    container.addPortMappings({ containerPort: 4021 })
    for (const [network, port, field] of [
      ['base-sepolia', '4022', 'baseFacilitatorKey'],
      ['arc-testnet', '4023', 'arcFacilitatorKey'],
    ] as const) {
      const facilitator = task.addContainer(`facilitator-${network}`, {
        image: ecs.ContainerImage.fromDockerImageAsset(image),
        command: ['node', 'dist/facilitator-server.js'],
        essential: true,
        readonlyRootFilesystem: true,
        logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: network }),
        environment: {
          ARCADE_FACILITATOR_NETWORK: network,
          ARCADE_FACILITATOR_HOST: '127.0.0.1',
          ARCADE_FACILITATOR_PORT: port,
        },
        secrets: {
          ARCADE_FACILITATOR_PRIVATE_KEY: ecs.Secret.fromSecretsManager(
            runtimeSecret,
            field,
          ),
        },
        healthCheck: {
          command: [
            'CMD-SHELL',
            `node -e "fetch('http://127.0.0.1:${port}/supported').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"`,
          ],
          interval: Duration.seconds(10),
          timeout: Duration.seconds(5),
          startPeriod: Duration.seconds(15),
          retries: 3,
        },
      })
      container.addContainerDependencies({
        container: facilitator,
        condition: ecs.ContainerDependencyCondition.HEALTHY,
      })
    }
    const service = new patterns.ApplicationLoadBalancedFargateService(
      this,
      'Service',
      {
        cluster,
        taskDefinition: task,
        assignPublicIp: true,
        desiredCount: 1,
        minHealthyPercent: 0,
        maxHealthyPercent: 100,
        circuitBreaker: { rollback: true },
        healthCheckGracePeriod: Duration.seconds(120),
        publicLoadBalancer: true,
      },
    )
    const cfnService = service.service.node.defaultChild as ecs.CfnService
    cfnService.availabilityZoneRebalancing = 'DISABLED'
    const fileSystem = new efs.FileSystem(this, 'MatchData', {
      vpc,
      encrypted: true,
      enableAutomaticBackups: true,
      removalPolicy: RemovalPolicy.RETAIN,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    })
    const accessPoint = fileSystem.addAccessPoint('Worker', {
      path: '/matches',
      posixUser: { uid: '1000', gid: '1000' },
      createAcl: { ownerUid: '1000', ownerGid: '1000', permissions: '700' },
    })
    fileSystem.connections.allowDefaultPortFrom(service.service)
    fileSystem.grantReadWrite(task.taskRole)
    task.addVolume({
      name: 'match-data',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    })
    container.addMountPoints({
      sourceVolume: 'match-data',
      containerPath: '/data',
      readOnly: false,
    })
    service.service.node.addDependency(accessPoint)
    service.targetGroup.configureHealthCheck({
      path: '/healthz',
      healthyHttpCodes: '200',
      interval: Duration.seconds(30),
    })
    service.loadBalancer.setAttribute('idle_timeout.timeout_seconds', '300')
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Common Arcade ${props.stage} testnet payments`,
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(service.loadBalancer, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          customHeaders: {
            'X-Arcade-Origin': originSecret.secretValue.unsafeUnwrap(),
          },
          readTimeout: Duration.seconds(60),
          keepaliveTimeout: Duration.seconds(60),
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: false,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    })
    const url = `https://${distribution.distributionDomainName}`
    container.addEnvironment('ARCADE_PAYMENT_DOMAIN', url)
    new CfnOutput(this, 'PaymentUrl', { value: url })
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName })
    new CfnOutput(this, 'ServiceName', { value: service.service.serviceName })
    new CfnOutput(this, 'LogGroupName', { value: logGroup.logGroupName })
    new CfnOutput(this, 'FileSystemId', { value: fileSystem.fileSystemId })
  }
}
