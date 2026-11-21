import { password } from '@inquirer/prompts'
import { getEnv } from './env'
import {
  clearStoredTokens,
  getDefaultOrg,
  getStoredTokens,
  setDefaultOrg,
  setStoredTokens,
} from './token-store'

async function loginServiceAccount() {
  const token = (
    await password({
      message: 'Paste your service account token:',
      mask: true,
    })
  ).trim()

  if (!token) {
    throw new Error('No token provided.')
  }

  await setStoredTokens({ accessToken: token, kind: 'service_account' })
}

export async function login() {
  await loginServiceAccount()
}

export async function logout() {
  await clearStoredTokens()
}

type Credentials = {
  accessToken: string
  kind: 'user' | 'service_account'
}

export async function getCredentials(): Promise<Credentials | null> {
  const accessToken = getEnv().UIGRAPH_ACCESS_TOKEN
  if (accessToken?.trim()) {
    return { accessToken: accessToken.trim(), kind: 'service_account' }
  }

  const stored = await getStoredTokens()

  if (stored) {
    return stored
  }

  return null
}

function credentialHeaders(credentials: Credentials): Record<string, string> {
  if (credentials.kind === 'service_account') {
    return { 'X-API-Key': credentials.accessToken }
  }

  if (credentials.kind === 'user') {
    return { Authorization: `Bearer ${credentials.accessToken}` }
  }

  throw new Error('Unsupported credential kind.')
}

type WhoamiMe = {
  userId: string
  orgId?: string
  email: string
  name: string
  login: string
  kind: string
  role: string
  authProvider: string
}

type WhoamiOrg = {
  id: string
  name: string
  role: string
}

export async function authStatus() {
  const credentials = await getCredentials()

  if (!credentials) {
    return { authenticated: false as const }
  }

  const response = await fetch(`${getEnv().UIGRAPH_MCP_SERVER_URL}/auth/me`, {
    headers: credentialHeaders(credentials),
  })

  if (!response.ok) {
    return { authenticated: false as const }
  }

  const data = (await response.json()) as {
    me: WhoamiMe
    orgs: WhoamiOrg[]
  }

  return {
    authenticated: true as const,
    me: data.me,
    orgs: data.orgs ?? [],
  }
}

export async function getExplicitDefaultOrg() {
  const stored = await getDefaultOrg()
  if (stored) {
    return stored
  }

  const orgId = getEnv().UIGRAPH_ORG_ID
  if (orgId?.trim()) {
    return orgId.trim()
  }

  return null
}

export async function selectDefaultOrg(orgs: WhoamiOrg[]) {
  const configuredOrgID = await getExplicitDefaultOrg()
  if (configuredOrgID && orgs.some((org) => org.id === configuredOrgID)) {
    return configuredOrgID
  }

  const firstOrg = orgs[0]
  if (!firstOrg) {
    return null
  }

  await setDefaultOrg(firstOrg.id)
  return firstOrg.id
}

let cachedMCPOrg: string | null | undefined

export async function resolveMCPOrg(): Promise<string | null> {
  if (cachedMCPOrg !== undefined) {
    return cachedMCPOrg
  }

  const status = await authStatus()

  if (!status.authenticated) {
    throw new Error('Not authenticated. Run `uigraph-mcp auth login`.')
  }

  const credentials = await getCredentials()
  if (!credentials || credentials.kind !== status.me.kind) {
    throw new Error(
      'Stored credential kind does not match authenticated identity.'
    )
  }

  if (status.me.kind === 'service_account') {
    cachedMCPOrg = null
    return cachedMCPOrg
  }

  if (status.me.kind !== 'user') {
    throw new Error('Unsupported authenticated identity kind.')
  }

  const orgId = await selectDefaultOrg(status.orgs)

  if (!orgId) {
    throw new Error('No organizations are available for this user account.')
  }

  cachedMCPOrg = orgId
  return orgId
}

export async function listOrgs() {
  const status = await authStatus()

  if (!status.authenticated) {
    throw new Error('Not authenticated. Run `uigraph-mcp auth login`.')
  }

  return status.orgs
}

export async function setDefaultOrgById(input: string) {
  const orgs = await listOrgs()

  const match = orgs.find(
    (org) => org.id === input || org.name.toLowerCase() === input.toLowerCase()
  )

  if (!match) {
    throw new Error(`No organization matching "${input}" found.`)
  }

  await setDefaultOrg(match.id)
  return match
}
