import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'

export interface StoredDocument {
  version: number
  [key: string]: unknown
}
export interface DocumentStore {
  get<T extends StoredDocument>(
    partition: string,
    key: string,
  ): Promise<T | undefined>
  put(
    partition: string,
    key: string,
    document: StoredDocument,
    expectedVersion?: number,
  ): Promise<void>
  list<T extends StoredDocument>(
    partition: string,
    prefix?: string,
  ): Promise<T[]>
}
export class StoreConflict extends Error {
  constructor() {
    super('This record changed. Reload before saving.')
    this.name = 'StoreConflict'
  }
}
export class MemoryDocumentStore implements DocumentStore {
  private documents = new Map<string, StoredDocument>()
  async get<T extends StoredDocument>(partition: string, key: string) {
    return structuredClone(this.documents.get(`${partition}|${key}`)) as
      T | undefined
  }
  async put(
    partition: string,
    key: string,
    document: StoredDocument,
    expectedVersion?: number,
  ) {
    const current = this.documents.get(`${partition}|${key}`)
    if (
      expectedVersion === undefined
        ? current !== undefined
        : current?.version !== expectedVersion
    )
      throw new StoreConflict()
    this.documents.set(`${partition}|${key}`, structuredClone(document))
  }
  async list<T extends StoredDocument>(partition: string, prefix = '') {
    return [...this.documents]
      .filter(([key]) => key.startsWith(`${partition}|${prefix}`))
      .map(([, value]) => structuredClone(value) as T)
  }
}
export class DynamoDocumentStore implements DocumentStore {
  private client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  })
  constructor(private table: string) {}
  async get<T extends StoredDocument>(partition: string, key: string) {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk: partition, sk: key },
        ConsistentRead: true,
      }),
    )
    return result.Item?.document as T | undefined
  }
  async put(
    partition: string,
    key: string,
    document: StoredDocument,
    expectedVersion?: number,
  ) {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: partition, sk: key, document },
          ConditionExpression:
            expectedVersion === undefined
              ? 'attribute_not_exists(pk)'
              : '#d.#v = :v',
          ...(expectedVersion === undefined
            ? {}
            : {
                ExpressionAttributeNames: { '#d': 'document', '#v': 'version' },
                ExpressionAttributeValues: { ':v': expectedVersion },
              }),
        }),
      )
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      )
        throw new StoreConflict()
      throw error
    }
  }
  async list<T extends StoredDocument>(partition: string, prefix = '') {
    const documents: T[] = []
    let cursor: Record<string, unknown> | undefined
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: prefix
            ? 'pk = :pk AND begins_with(sk, :prefix)'
            : 'pk = :pk',
          ExpressionAttributeValues: prefix
            ? { ':pk': partition, ':prefix': prefix }
            : { ':pk': partition },
          ConsistentRead: true,
          ExclusiveStartKey: cursor,
        }),
      )
      documents.push(...(result.Items ?? []).map((item) => item.document as T))
      cursor = result.LastEvaluatedKey
    } while (cursor)
    return documents
  }
}
