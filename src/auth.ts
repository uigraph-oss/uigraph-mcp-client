import { serve } from '@hono/node-server'
import { password, select } from '@inquirer/prompts'
import { Hono } from 'hono'
import crypto from 'node:crypto'
import open from 'open'
import { env } from './env'
import {
  clearStoredTokens,
  getDefaultOrg,
  getStoredTokens,
  setDefaultOrg,
  setStoredTokens,
} from './token-store'

const CALLBACK_PORT = 9876
const CALLBACK_PATH = '/callback'

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

  await setStoredTokens({ accessToken: token, kind: 'service' })
}

async function loginUserAccount() {
  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`

  const app = new Hono()

  const tokenPromise = new Promise<string>((resolve, reject) => {
    app.get(CALLBACK_PATH, (c) => {
      const token = c.req.query('token')
      const callbackState = c.req.query('state')

      if (!token || callbackState !== state) {
        reject(new Error('Invalid callback received'))
        return c.text('Login failed. Return to terminal.', 400)
      }

      resolve(token)
      return c.text('UIGraph auth successful. You can close this tab.')
    })
  })

  const server = serve({ fetch: app.fetch, port: CALLBACK_PORT })

  const loginUrl = new URL(`${env.UIGRAPH_MCP_SERVER_URL}/auth/login`)
  loginUrl.searchParams.set('redirect_uri', redirectUri)
  loginUrl.searchParams.set('state', state)

  console.log(`Opening login URL: ${loginUrl.toString()}`)
  await open(loginUrl.toString())

  try {
    const token = await tokenPromise
    await setStoredTokens({ accessToken: token, kind: 'user' })
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }
}

export async function login() {
  const choice = await select({
    message: 'Login as',
    choices: [
      { name: 'Service Account', value: 'service' },
      { name: 'User Account', value: 'user' },
    ],
  })

  if (choice === 'service') {
    await loginServiceAccount()
    return
  }

  await loginUserAccount()
}

export async function logout() {
  await clearStoredTokens()
}

export async function getValidAccessToken() {
  if (env.UIGRAPH_ACCESS_TOKEN?.trim()) {
    return env.UIGRAPH_ACCESS_TOKEN.trim()
  }

  const stored = await getStoredTokens()

  if (stored) {
    return stored.accessToken
  }

  return null
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
  const token = await getValidAccessToken()

  if (!token) {
    return { authenticated: false as const }
  }

  const response = await fetch(`${env.UIGRAPH_MCP_SERVER_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
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

let cachedFirstOrg: string | null | undefined

export async function getExplicitDefaultOrg() {
  const stored = await getDefaultOrg()
  if (stored) {
    return stored
  }

  if (env.UIGRAPH_ORG_ID?.trim()) {
    return env.UIGRAPH_ORG_ID.trim()
  }

  return null
}

export async function resolveDefaultOrg() {
  const explicit = await getExplicitDefaultOrg()
  if (explicit) {
    return explicit
  }

  if (cachedFirstOrg === undefined) {
    try {
      const status = await authStatus()

      if (!status.authenticated) {
        cachedFirstOrg = null
      } else if (status.me.kind === 'service_account') {
        cachedFirstOrg = status.me.orgId ?? null
      } else {
        cachedFirstOrg = status.orgs[0]?.id ?? null
      }
    } catch {
      cachedFirstOrg = null
    }
  }

  return cachedFirstOrg
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
