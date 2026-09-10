import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { describe, expect, it } from 'vitest'
import { PaymentStack } from './payment-stack.js'

describe('PaymentStack', () => {
  it('keeps a single worker with encrypted persistent data and private gas signers', () => {
    const stack = new PaymentStack(new App(), 'PaymentsTest', {
      stage: 'development',
      registryUrl: 'https://arcade.agentcommons.io/api/arcade',
      corsOrigins: 'https://arcade.agentcommons.io',
    })
    const template = Template.fromStack(stack)
    template.resourceCountIs('AWS::ECS::Service', 1)
    template.hasResourceProperties('AWS::ECS::Service', {
      DesiredCount: 1,
      AvailabilityZoneRebalancing: 'DISABLED',
      DeploymentConfiguration: Match.objectLike({
        MinimumHealthyPercent: 0,
        MaximumPercent: 100,
      }),
    })
    template.hasResourceProperties('AWS::EFS::FileSystem', {
      Encrypted: true,
      BackupPolicy: { Status: 'ENABLED' },
    })
    template.hasResource('AWS::EFS::FileSystem', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    })
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Volumes: [
        Match.objectLike({
          EFSVolumeConfiguration: Match.objectLike({
            TransitEncryption: 'ENABLED',
            AuthorizationConfig: Match.objectLike({ IAM: 'ENABLED' }),
          }),
        }),
      ],
    })
    const tasks = Object.values(
      template.findResources('AWS::ECS::TaskDefinition'),
    )
    const containers = tasks[0]!.Properties.ContainerDefinitions
    expect(containers).toHaveLength(3)
    expect(
      containers.filter(
        (c: { PortMappings?: unknown[] }) => c.PortMappings?.length,
      ),
    ).toHaveLength(1)
    const payment = containers.find(
      (c: { Name: string }) => c.Name === 'payments',
    )
    expect(payment.DependsOn).toHaveLength(2)
    expect(payment.Secrets.map((s: { Name: string }) => s.Name)).toEqual(
      expect.arrayContaining([
        'ARCADE_ORIGIN_TOKEN',
        'ARCADE_RESOLVER_KEY_296',
      ]),
    )
    expect(JSON.stringify(template.toJSON())).toContain('secretsmanager:')
    template.resourceCountIs('AWS::CloudFront::Distribution', 1)
    template.resourceCountIs('AWS::EC2::NatGateway', 0)
  }, 30_000)
})
