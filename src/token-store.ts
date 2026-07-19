import keytar from 'keytar'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SERVICE = 'uigraph-mcp'
const ACCOUNT = 'default'
const FALLBACK_TOKEN_PATH = path.join(os.homedir(), '.uigraph-mcp-tokens.json')
const CONFIG_PATH = path.join(os.homedir(), '.uigraph-mcp-config.json')

export type TokenBundle = {
  accessToken: string
  kind: 'user' | 'service_account'
}

export async function getStoredTokens() {
  let raw: string | null = null

  try {
    raw = await keytar.getPassword(SERVICE, ACCOUNT)
  } catch {
    raw = null
  }

  if (!raw) {
    raw = await readFallbackTokens()
  }

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)

    if (
      typeof parsed.accessToken !== 'string' ||
      (parsed.kind !== 'user' &&
        parsed.kind !== 'service' &&
        parsed.kind !== 'service_account')
    ) {
      return null
    }

    if (parsed.kind === 'service') {
      return { accessToken: parsed.accessToken, kind: 'service_account' }
    }

    return parsed as TokenBundle
  } catch {
    return null
  }
}

export async function setStoredTokens(tokens: TokenBundle) {
  const payload = JSON.stringify(tokens)

  try {
    await keytar.setPassword(SERVICE, ACCOUNT, payload)
  } catch {
    await fs.writeFile(FALLBACK_TOKEN_PATH, payload, 'utf8')
  }
}

export async function clearStoredTokens() {
  try {
    await keytar.deletePassword(SERVICE, ACCOUNT)
  } catch {}

  try {
    await fs.unlink(FALLBACK_TOKEN_PATH)
  } catch {}
}

async function readFallbackTokens() {
  try {
    return await fs.readFile(FALLBACK_TOKEN_PATH, 'utf8')
  } catch {
    return null
  }
}

export async function getDefaultOrg() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw)

    if (typeof parsed.defaultOrgId === 'string') {
      return parsed.defaultOrgId
    }

    return null
  } catch {
    return null
  }
}

export async function setDefaultOrg(orgId: string) {
  await fs.writeFile(
    CONFIG_PATH,
    JSON.stringify({ defaultOrgId: orgId }),
    'utf8'
  )
}

export async function clearDefaultOrg() {
  try {
    await fs.unlink(CONFIG_PATH)
  } catch {}
}
