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
import * as logs from 'aws-cdk-lib/aws-logs'
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets'
import type { Construct } from 'constructs'
import { resolve } from 'node:path'
import type { DeploymentStage } from '../config.js'

export interface RealtimePilotStackProps extends StackProps {
  readonly stage: DeploymentStage
}

/**
 * Single-task ALB/ECS proof for the v0alpha1 realtime contract.
 *
 * It intentionally does not scale above one task while the local platform uses
 * process memory. Durable placement, ownership leases, replay storage, TLS and
 * regional routing are production gates rather than hidden assumptions here.
 */
export class RealtimePilotStack extends Stack {
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
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        publicLoadBalancer: true,
        taskImageOptions: {
          image: ecs.ContainerImage.fromDockerImageAsset(image),
          containerName: 'arcade-local-stack',
          containerPort: 4100,
          environment: {
            ARCADE_ENV: props.stage,
            HOST: '0.0.0.0',
            PORT: '4100',
            ARCADE_CORS_ORIGINS: 'https://arcade.agentcommons.io',
          },
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: 'common-arcade-realtime',
            logRetention: logs.RetentionDays.ONE_MONTH,
          }),
        },
      },
    )
    service.targetGroup.configureHealthCheck({
      healthyHttpCodes: '200',
      interval: Duration.seconds(30),
      path: '/healthz',
      timeout: Duration.seconds(5),
    })

    new CfnOutput(this, 'PilotHttpUrl', {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
      description:
        'Development-only ALB endpoint; add managed TLS before staging.',
    })
    new CfnOutput(this, 'PilotRealtimeUrl', {
      value: `ws://${service.loadBalancer.loadBalancerDnsName}/realtime`,
      description: 'Development-only WebSocket endpoint.',
    })
  }
}
