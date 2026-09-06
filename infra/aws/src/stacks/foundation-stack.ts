import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as events from 'aws-cdk-lib/aws-events'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import type { Construct } from 'constructs'
import type { DeploymentStage } from '../config.js'

export interface FoundationStackProps extends StackProps {
  stage: DeploymentStage
}

export class FoundationStack extends Stack {
  readonly releasesBucket: s3.Bucket
  readonly replaysBucket: s3.Bucket
  readonly coordinationTable: dynamodb.Table
  readonly eventBus: events.EventBus
  readonly workQueue: sqs.Queue

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props)

    const retained = RemovalPolicy.RETAIN

    this.releasesBucket = new s3.Bucket(this, 'ReleaseArtifacts', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: retained,
      versioned: true,
    })

    this.replaysBucket = new s3.Bucket(this, 'ReplayArtifacts', {
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST],
          allowedHeaders: ['*'],
          maxAge: 300,
        },
      ],
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: retained,
      versioned: true,
    })

    this.coordinationTable = new dynamodb.Table(this, 'Coordination', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: retained,
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expiresAt',
    })

    const deadLetterQueue = new sqs.Queue(this, 'WorkDeadLetterQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    })

    this.workQueue = new sqs.Queue(this, 'WorkQueue', {
      deadLetterQueue: { maxReceiveCount: 5, queue: deadLetterQueue },
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    })

    this.eventBus = new events.EventBus(this, 'ArcadeEvents')

    for (const repositoryName of [
      'realtime-gateway',
      'match-worker',
      'policy-worker',
      'build-worker',
    ]) {
      new ecr.Repository(this, `Container${repositoryName}`, {
        emptyOnDelete: false,
        imageScanOnPush: true,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        removalPolicy: retained,
      })
    }

    new CfnOutput(this, 'Stage', { value: props.stage })
    new CfnOutput(this, 'ReleaseArtifactsBucketName', {
      value: this.releasesBucket.bucketName,
    })
    new CfnOutput(this, 'ReplayArtifactsBucketName', {
      value: this.replaysBucket.bucketName,
    })
  }
}
