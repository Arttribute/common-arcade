#!/usr/bin/env node
// Standalone Node 22+ client. Wallet keys and Privy credentials remain on Arcade.
import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

const args = process.argv.slice(2),
  command = args[0]
const option = (name) => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}
const dir =
  process.env.ARCADE_WALLET_CONFIG_DIR ??
  join(homedir(), '.config', 'common-arcade')
const file = join(dir, 'agent-wallet.json')
const hash = (value) => createHash('sha256').update(value).digest('hex')
function endpoint(value) {
  const url = new URL(value)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      ))
  )
    throw Error('Use an HTTPS Arcade endpoint.')
  return value.replace(/\/$/, '')
}
async function request(api, path, body, token) {
  const response = await fetch(`${api}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(110000),
  })
  const value = await response.json()
  if (!response.ok)
    throw Error(value.detail ?? `Request failed (${response.status}).`)
  return value
}
function credentialStore(config, token) {
  const account = hash(`${config.api}:${config.walletId}`),
    service = 'common-arcade-agent-wallet'
  if (process.env.ARCADE_WALLET_PASSPHRASE) {
    if (token) {
      const salt = randomBytes(16),
        iv = randomBytes(12),
        key = scryptSync(process.env.ARCADE_WALLET_PASSPHRASE, salt, 32)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from(account))
      config.encrypted = {
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        data: Buffer.concat([cipher.update(token), cipher.final()]).toString(
          'hex',
        ),
        tag: cipher.getAuthTag().toString('hex'),
      }
      config.storage = 'encrypted'
      return
    }
    if (!config.encrypted) throw Error('No encrypted wallet session found.')
    const e = config.encrypted,
      decipher = createDecipheriv(
        'aes-256-gcm',
        scryptSync(
          process.env.ARCADE_WALLET_PASSPHRASE,
          Buffer.from(e.salt, 'hex'),
          32,
        ),
        Buffer.from(e.iv, 'hex'),
      )
    decipher.setAAD(Buffer.from(account))
    decipher.setAuthTag(Buffer.from(e.tag, 'hex'))
    return Buffer.concat([
      decipher.update(Buffer.from(e.data, 'hex')),
      decipher.final(),
    ]).toString()
  }
  if (config.storage === 'encrypted')
    throw Error(
      'Supply ARCADE_WALLET_PASSPHRASE from your secret store to unlock this session.',
    )
  let result
  if (process.platform === 'darwin') {
    // Feed the add command on stdin so the capability never appears in argv.
    result = token
      ? spawnSync('security', ['-i'], {
          input: `add-generic-password -U -a "${account}" -s "${service}" -w "${token}"\n`,
          encoding: 'utf8',
        })
      : spawnSync(
          'security',
          ['find-generic-password', '-a', account, '-s', service, '-w'],
          { encoding: 'utf8' },
        )
  } else {
    result = token
      ? spawnSync(
          'secret-tool',
          [
            'store',
            '--label=Common Arcade agent wallet',
            'service',
            service,
            'account',
            account,
          ],
          { input: token, encoding: 'utf8' },
        )
      : spawnSync(
          'secret-tool',
          ['lookup', 'service', service, 'account', account],
          { encoding: 'utf8' },
        )
  }
  if (result.status !== 0 || result.error)
    throw Error(
      'Secure credential storage is unavailable. Use macOS Keychain, Linux secret-tool, or provide ARCADE_WALLET_PASSPHRASE from your secret store. No plaintext token was saved.',
    )
  if (token) {
    config.storage = 'keychain'
    return
  }
  return result.stdout.trim()
}
async function configFile() {
  const config = JSON.parse(await readFile(file, 'utf8'))
  config.api = endpoint(config.api)
  return config
}
async function save(config) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}
async function connectionCode() {
  if (process.stdin.isTTY) {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    try {
      return (await prompt.question('Connection code: ')).trim()
    } finally {
      prompt.close()
    }
  }
  let value = ''
  for await (const chunk of process.stdin) {
    value += chunk
    if (value.length > 1024) throw Error('Connection code is too long.')
  }
  return value.trim()
}
try {
  if (command === 'connect') {
    const api = endpoint(
      option('--api') ?? 'https://arcade.agentcommons.io/api/arcade',
    )
    const pairCode = await connectionCode()
    const match = /^arp_([a-f0-9-]{36})\.[A-Za-z0-9_-]{43}$/.exec(pairCode)
    if (!match) throw Error('Paste the connection code from Arcade.')
    const walletId = match[1]
    let config, token
    try {
      config = await configFile()
      if (
        config.walletId === walletId &&
        config.api === api &&
        config.pairHash === hash(pairCode)
      )
        token = credentialStore(config)
    } catch {}
    if (!token) {
      config = { api, walletId, pairHash: hash(pairCode) }
      token = `arw_${walletId}.${randomBytes(32).toString('base64url')}`
      credentialStore(config, token)
      await save(config)
    }
    const result = await request(api, 'agent-wallets/connect', {
      pairCode,
      credentialHash: hash(token),
    })
    console.log(
      JSON.stringify(
        {
          connected: true,
          wallet: result.wallet,
          next: 'node arcade-wallet.mjs status',
        },
        null,
        2,
      ),
    )
  } else if (
    command === 'status' ||
    command === 'execute' ||
    command === 'logout'
  ) {
    const config = await configFile(),
      token = credentialStore(config)
    if (!/^arw_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(token))
      throw Error('Stored wallet credential is invalid. Reconnect from Arcade.')
    if (command === 'status')
      console.log(
        JSON.stringify(
          await request(config.api, 'agent-wallet/me', undefined, token),
          null,
          2,
        ),
      )
    if (command === 'execute') {
      const actionFile = option('--file'),
        requestId = option('--request-id')
      if (!actionFile || !requestId || !/^[a-f0-9-]{36}$/.test(requestId))
        throw Error(
          'Use execute --file action.json --request-id <UUID>. Reuse that ID when inspecting an uncertain request.',
        )
      const source = await readFile(actionFile, 'utf8')
      if (source.length > 16384) throw Error('Action is too large.')
      console.log(
        JSON.stringify(
          await request(
            config.api,
            'agent-wallet/execute',
            { requestId, action: JSON.parse(source) },
            token,
          ),
          null,
          2,
        ),
      )
    }
    if (command === 'logout') {
      await request(config.api, 'agent-wallet/logout', {}, token)
      await unlink(file)
      console.log('Agent access revoked. Wallet funds are kept.')
    }
  } else if (command === 'request-id') console.log(randomUUID())
  else
    console.log(
      `Arcade agent wallet — Node 22+\n\nconnect [--api URL]                 Pair using the code on stdin\nstatus                             Wallet, balance and allowance\nexecute --file JSON --request-id ID Execute an approved Arcade action\nrequest-id                         Generate a payment request ID\nlogout                             Revoke this connection\n\nActions: analysis, stake, start, observation, action (hit/stand), claim.\nCredentials use the OS keychain or passphrase-encrypted storage.\nNever pass a Privy secret or wallet private key to this client.`,
    )
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Wallet operation failed.',
  )
  process.exitCode = 1
}
