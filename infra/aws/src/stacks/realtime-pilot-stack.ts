import {
  CfnOutput,
  Duration,
  IgnoreMode,
  Stack,
  type StackProps,
} from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as patterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import type { ITable } from 'aws-cdk-lib/aws-dynamodb'
import * as logs from 'aws-cdk-lib/aws-logs'
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets'
import type { Construct } from 'constructs'
import { resolve } from 'node:path'
import type { DeploymentStage } from '../config.js'

export interface RealtimePilotStackProps extends StackProps {
  readonly table: ITable
  readonly stage: DeploymentStage
  readonly corsOrigins: string
}

/**
 * Single-task ALB/ECS proof for the v0alpha1 realtime contract.
 *
 * It intentionally does not scale above one task while the local platform uses
 * process memory. Durable placement, ownership leases, replay storage, TLS and
 * regional routing are production gates rather than hidden assumptions here.
 */
export class RealtimePilotStack extends Stack {
  readonly publicBaseUrl: string
  constructor(scope: Construct, id: string, props: RealtimePilotStackProps) {
    super(scope, id, props)

    const vpc = new ec2.Vpc(this, 'RealtimeVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    })
    const cluster = new ecs.Cluster(this, 'RealtimeCluster', {
      clusterName: `common-arcade-${props.stage}`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      vpc,
    })
    const image = new DockerImageAsset(this, 'LocalStackImage', {
      directory: resolve(import.meta.dirname, '../../../..'),
      exclude: [
        '.git/**',
        '**/.next/**',
        '**/.turbo/**',
        '**/cdk.out/**',
        '**/dist/**',
        '**/node_modules/**',
      ],
      file: 'apps/realtime-gateway/Dockerfile',
      ignoreMode: IgnoreMode.GLOB,
      platform: Platform.LINUX_AMD64,
    })
    const service = new patterns.ApplicationLoadBalancedFargateService(
      this,
      'RealtimePilot',
      {
        assignPublicIp: true,
        circuitBreaker: { rollback: true },
        cluster,
        cpu: 512,
        desiredCount: 1,
        healthCheckGracePeriod: Duration.seconds(30),
        memoryLimitMiB: 1024,
        minHealthyPercent: 0,
        maxHealthyPercent: 100,
        availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.DISABLED,
        publicLoadBalancer: true,
        taskImageOptions: {
          image: ecs.ContainerImage.fromDockerImageAsset(image),
          containerName: 'arcade-local-stack',
          containerPort: 4100,
          environment: {
            ARCADE_ENV: props.stage,
            ARCADE_STUDIO_TABLE: props.table.tableName,
            COMMONS_IDENTITY_ISSUER: 'https://auth.agentcommons.io/api/auth',
            HOST: '0.0.0.0',
            PORT: '4100',
            ARCADE_CORS_ORIGINS: props.corsOrigins,
          },
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: 'common-arcade-realtime',
            logRetention: logs.RetentionDays.ONE_MONTH,
          }),
        },
      },
    )
    props.table.grantReadWriteData(service.taskDefinition.taskRole)
    service.targetGroup.configureHealthCheck({
      healthyHttpCodes: '200',
      interval: Duration.seconds(30),
      path: '/healthz',
      timeout: Duration.seconds(5),
    })
    service.loadBalancer.setAttribute('idle_timeout.timeout_seconds', '300')

    const distribution = new cloudfront.Distribution(
      this,
      'RealtimeDistribution',
      {
        comment: `Common Arcade ${props.stage} HTTPS/WSS pilot`,
        defaultBehavior: {
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          compress: false,
          origin: new origins.LoadBalancerV2Origin(service.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        enabled: true,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      },
    )

    const publicBaseUrl = `https://${distribution.distributionDomainName}`
    this.publicBaseUrl = publicBaseUrl
    const realtimeUrl = `wss://${distribution.distributionDomainName}/realtime`
    service.taskDefinition.defaultContainer?.addEnvironment(
      'ARCADE_PUBLIC_BASE_URL',
      publicBaseUrl,
    )
    service.taskDefinition.defaultContainer?.addEnvironment(
      'ARCADE_REALTIME_URL',
      realtimeUrl,
    )

    new CfnOutput(this, 'PilotHttpUrl', {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
      description:
        'Development-only ALB endpoint; add managed TLS before staging.',
    })
    new CfnOutput(this, 'PilotRealtimeUrl', {
      value: `ws://${service.loadBalancer.loadBalancerDnsName}/realtime`,
      description: 'Development-only WebSocket endpoint.',
    })
    new CfnOutput(this, 'PublicApiUrl', {
      value: publicBaseUrl,
      description: 'CloudFront HTTPS endpoint for the development pilot.',
    })
    new CfnOutput(this, 'PublicRealtimeUrl', {
      value: realtimeUrl,
      description: 'CloudFront WSS endpoint for the development pilot.',
    })
  }
}
