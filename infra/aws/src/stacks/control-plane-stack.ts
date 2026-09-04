import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib'
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import type { Construct } from 'constructs'
import { resolve } from 'node:path'
import type { DeploymentStage } from '../config.js'

export interface ControlPlaneStackProps extends StackProps {
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
        ARCADE_CORS_ORIGINS: 'https://arcade.agentcommons.io',
      },
      handler: 'handler',
      memorySize: 512,
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(15),
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        minify: true,
        sourceMap: true,
      },
    })

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
