import { afterEach, describe, expect, it, vi } from 'vitest'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { DynamoDocumentStore } from './store.js'
describe('DynamoDB collection queries', () => {
  afterEach(() => vi.restoreAllMocks())
  it('lists an entire partition without an invalid empty sort-key operand', async () => {
    const send = vi
      .spyOn(DynamoDBDocumentClient.prototype, 'send')
      .mockResolvedValue({
        Items: [{ document: { version: 1, id: 'saved_match' } }],
      } as never)
    expect(await new DynamoDocumentStore('test').list('matches')).toEqual([
      { version: 1, id: 'saved_match' },
    ])
    const command = send.mock.calls[0]![0] as any
    expect(command.input.KeyConditionExpression).toBe('pk = :pk')
    expect(command.input.ExpressionAttributeValues).toEqual({
      ':pk': 'matches',
    })
  })
  it('preserves non-empty prefix filters and pagination', async () => {
    const send = vi
      .spyOn(DynamoDBDocumentClient.prototype, 'send')
      .mockResolvedValueOnce({
        Items: [{ document: { version: 1, id: 'prj_one' } }],
        LastEvaluatedKey: { pk: 'owner:one', sk: 'prj_one' },
      } as never)
      .mockResolvedValueOnce({
        Items: [{ document: { version: 1, id: 'prj_two' } }],
      } as never)
    expect(
      await new DynamoDocumentStore('test').list('owner:one', 'prj_'),
    ).toHaveLength(2)
    const command = send.mock.calls[1]![0] as any
    expect(command.input.ExpressionAttributeValues[':prefix']).toBe('prj_')
    expect(command.input.ExclusiveStartKey).toEqual({
      pk: 'owner:one',
      sk: 'prj_one',
    })
  })
})
