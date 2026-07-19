import readline from 'node:readline'
import { getCredentials, resolveMCPOrg } from './auth'
import { getEnv } from './env'

let clientName: string | null = null
let clientVersion: string | null = null

function parseLine(line: string) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function captureClientInfo(req: Record<string, unknown>) {
  if (req.method !== 'initialize') {
    return
  }
  const params = req.params
  if (typeof params !== 'object' || params === null) {
    return
  }
  const info = (params as Record<string, unknown>).clientInfo
  if (typeof info !== 'object' || info === null) {
    return
  }
  const name = (info as Record<string, unknown>).name
  const version = (info as Record<string, unknown>).version
  if (typeof name === 'string' && name) {
    clientName = name
  }
  if (typeof version === 'string' && version) {
    clientVersion = version
  }
}

function authError(id: unknown) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: -32001,
      message: 'Not authenticated. Run `uigraph-mcp auth login`.',
    },
  }
}

async function postRequest(
  req: Record<string, unknown>,
  credentials: { accessToken: string; kind: 'user' | 'service_account' },
  orgId: string | null
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }

  if (credentials.kind === 'service_account') {
    headers['X-API-Key'] = credentials.accessToken
  }

  if (credentials.kind === 'user') {
    headers.Authorization = `Bearer ${credentials.accessToken}`
  }

  if (credentials.kind !== 'user' && credentials.kind !== 'service_account') {
    throw new Error('Unsupported credential kind.')
  }

  if (orgId) {
    headers['X-UIGraph-Org-Id'] = orgId
  }

  if (clientName) {
    headers['X-UIGraph-Client-Name'] = clientName
  }

  if (clientVersion) {
    headers['X-UIGraph-Client-Version'] = clientVersion
  }

  const response = await fetch(getEnv().UIGRAPH_MCP_SERVER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  })

  const text = await response.text()

  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    text,
  }
}

function upstreamError(
  id: unknown,
  status: number,
  message: string,
  details?: string
) {
  const safeDetails = details?.trim() ? `: ${details.trim().slice(0, 200)}` : ''

  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: -32000,
      message: `Upstream MCP error (HTTP ${status}): ${message}${safeDetails}`,
    },
  }
}

function parseSseJson(text: string) {
  const lines = text.split('\n')

  for (const line of lines) {
    if (!line.startsWith('data:')) {
      continue
    }

    const payload = line.slice(5).trim()

    if (!payload || payload === '[DONE]') {
      continue
    }

    try {
      return JSON.parse(payload)
    } catch {
      continue
    }
  }

  return null
}

function parseResponse(
  text: string,
  contentType: string,
  req: Record<string, unknown>
) {
  if (contentType.includes('text/event-stream')) {
    const parsed = parseSseJson(text)

    if (parsed) {
      return parsed
    }

    return {
      jsonrpc: '2.0',
      id: req.id ?? null,
      error: {
        code: -32000,
        message: 'Upstream stream payload was not valid JSON',
      },
    }
  }

  try {
    return JSON.parse(text)
  } catch {
    return {
      jsonrpc: '2.0',
      id: req.id ?? null,
      error: {
        code: -32000,
        message: 'Upstream returned non-JSON response',
      },
    }
  }
}

async function forward(req: Record<string, unknown>) {
  const credentials = await getCredentials()

  if (!credentials) {
    return authError(req.id)
  }

  const orgId = await resolveMCPOrg()
  const res = await postRequest(req, credentials, orgId)

  if (res.status >= 500) {
    return upstreamError(req.id, res.status, 'Internal Server Error', res.text)
  }

  if (res.status === 401) {
    return authError(req.id)
  }

  if (res.status >= 400) {
    return upstreamError(req.id, res.status, 'Request failed', res.text)
  }

  return parseResponse(res.text, res.contentType, req)
}

export async function runProxy() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  rl.on('line', async (line) => {
    const req = parseLine(line)

    if (!req) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Invalid JSON',
          },
        })}\n`
      )
      return
    }

    captureClientInfo(req)

    try {
      const res = await forward(req)
      process.stdout.write(`${JSON.stringify(res)}\n`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Proxy error'
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: req.id ?? null,
          error: {
            code: -32000,
            message,
          },
        })}\n`
      )
    }
  })

  process.on('uncaughtException', (error) => {
    console.error('Uncaught:', error)
  })

  process.on('unhandledRejection', (error) => {
    console.error('Unhandled:', error)
  })
}
