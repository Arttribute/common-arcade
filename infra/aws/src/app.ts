#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { deploymentConfig } from './config.js'
import { ControlPlaneStack } from './stacks/control-plane-stack.js'
import { FoundationStack } from './stacks/foundation-stack.js'
import { RealtimePilotStack } from './stacks/realtime-pilot-stack.js'

const app = new App()
const config = deploymentConfig(app.node.tryGetContext('stage'))
const corsOrigins =
  app.node.tryGetContext('corsOrigins') ??
  'https://arcade.agentcommons.io,https://common-arcade.vercel.app'
const environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
}

const foundation = new FoundationStack(
  app,
  `CommonArcade-${config.stage}-Foundation`,
  {
    env: environment,
    stage: config.stage,
    terminationProtection: config.terminationProtection,
  },
)

const realtime = new RealtimePilotStack(
  app,
  `CommonArcade-${config.stage}-RealtimePilot`,
  {
    corsOrigins,
    table: foundation.coordinationTable,
    env: environment,
    stage: config.stage,
    terminationProtection: config.terminationProtection,
  },
)

new ControlPlaneStack(app, `CommonArcade-${config.stage}-ControlPlane`, {
  env: environment,
  stage: config.stage,
  table: foundation.coordinationTable,
  realtimeControlUrl: realtime.publicBaseUrl,
  recordingsBucket: foundation.replaysBucket,
  terminationProtection: config.terminationProtection,
})
