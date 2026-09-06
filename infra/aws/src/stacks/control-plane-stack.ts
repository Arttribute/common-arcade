import type { IBucket } from 'aws-cdk-lib/aws-s3'
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib'
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import type { ITable } from 'aws-cdk-lib/aws-dynamodb'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import type { Construct } from 'constructs'
import { resolve } from 'node:path'
import type { DeploymentStage } from '../config.js'

export interface ControlPlaneStackProps extends StackProps {
  recordingsBucket: IBucket
  table: ITable
  realtimeControlUrl: string
  stage: DeploymentStage
}

export class ControlPlaneStack extends Stack {
  constructor(scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props)

    const handler = new NodejsFunction(this, 'ControlApi', {
      entry: resolve(
        import.meta.dirname,
        '../../../../apps/control-api/src/lambda.ts',
      ),
      environment: {
        ARCADE_ENV: props.stage,
        ARCADE_CORS_ORIGINS:
          'https://arcade.agentcommons.io,https://common-arcade.vercel.app',
        ARCADE_STUDIO_TABLE: props.table.tableName,
        ARCADE_RECORDINGS_BUCKET: props.recordingsBucket.bucketName,
        COMMONS_IDENTITY_ISSUER: 'https://auth.agentcommons.io/api/auth',
        ARCADE_REALTIME_CONTROL_URL: props.realtimeControlUrl,
        ARCADE_PUBLIC_BASE_URL: 'https://arcade.agentcommons.io/api/arcade',
      },
      handler: 'handler',
      memorySize: 512,
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(600),
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        minify: true,
        sourceMap: true,
      },
    })

    props.table.grantReadWriteData(handler)
    props.recordingsBucket.grantReadWrite(handler)
    // Avoid referencing the function from its own role policy: that makes the
    // function depend on a policy which itself depends on the function ARN.
    // The stack prefix still limits this worker role to Common Arcade control
    // functions in this account and region.
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [
          this.formatArn({
            service: 'lambda',
            resource: 'function',
            resourceName: `${this.stackName.slice(0, 31)}-*`,
          }),
        ],
      }),
    )
    const functionUrl = handler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.BUFFERED,
    })
    new CfnOutput(this, 'StudioApiUrl', { value: functionUrl.url })
    const api = new apigateway.HttpApi(this, 'ControlHttpApi', {
      apiName: `common-arcade-control-${props.stage}`,
      createDefaultStage: true,
    })
    api.addRoutes({
      path: '/{proxy+}',
      methods: [apigateway.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ControlApiIntegration', handler),
    })
    api.addRoutes({
      path: '/',
      methods: [apigateway.HttpMethod.ANY],
      integration: new HttpLambdaIntegration(
        'ControlApiRootIntegration',
        handler,
      ),
    })

    new CfnOutput(this, 'ControlApiUrl', { value: api.apiEndpoint })
  }
}
