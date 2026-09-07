import { App, Stack } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { describe, expect, it } from 'vitest'
import { ControlPlaneStack } from './control-plane-stack.js'

describe('ControlPlaneStack', () => {
  it('allows the control Lambda to dispatch work to itself', () => {
    const app = new App()
    const dependencies = new Stack(app, 'Dependencies')
    const stack = new ControlPlaneStack(
      app,
      'CommonArcade-development-ControlPlane',
      {
        stage: 'development',
        realtimeControlUrl: 'https://realtime.example.test',
        recordingsBucket: new s3.Bucket(dependencies, 'Recordings'),
        table: new dynamodb.Table(dependencies, 'Coordination', {
          partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        }),
      },
    )

    const template = JSON.stringify(Template.fromStack(stack).toJSON())
    expect(template).toContain(':function:CommonArcade-development-Contro-*')
    expect(template).not.toContain(
      ':function/CommonArcade-development-Contro-*',
    )
  }, 30_000)
})
