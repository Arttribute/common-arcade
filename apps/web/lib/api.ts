import { ControlClient } from '@common-arcade/control-client'
export async function arcade<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`/api/arcade/v1/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      result.detail ?? result.error ?? 'Request failed. Please retry.',
    )
  return result as T
}

export function browserControlClient() {
  return new ControlClient({
    baseUrl: 'https://arcade.invalid',
    fetch: (input, init) => {
      const url = new URL(String(input))
      return fetch(`/api/arcade${url.pathname}${url.search}`, init)
    },
  })
}
