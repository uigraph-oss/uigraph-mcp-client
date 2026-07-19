import { serve } from '@hono/node-server'
import { password, select } from '@inquirer/prompts'
import { Hono } from 'hono'
import crypto from 'node:crypto'
import open from 'open'
import { getEnv } from './env'
import {
  clearStoredTokens,
  getDefaultOrg,
  getStoredTokens,
  setDefaultOrg,
  setStoredTokens,
} from './token-store'

const CALLBACK_PORT = 9876
const CALLBACK_PATH = '/callback'

const CALLBACK_PAGE_STYLES = `
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #0B0E16;
    background-image: radial-gradient(rgba(59,107,255,0.10) 1px, transparent 1px);
    background-size: 22px 22px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .glow {
    pointer-events: none;
    position: fixed;
    inset: 0 0 auto 0;
    height: 400px;
    background: radial-gradient(ellipse at 50% 0%, rgba(59,107,255,0.12) 0%, transparent 70%);
  }
  .card {
    position: relative;
    width: 100%;
    max-width: 380px;
    background: #141925;
    border: 1px solid #2A3242;
    border-radius: 20px;
    padding: 36px 36px 32px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px rgba(0,0,0,0.55);
    text-align: center;
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-bottom: 24px;
  }
  .brand span {
    font-size: 15px;
    font-weight: 600;
    color: #F4F7FC;
    letter-spacing: -0.01em;
  }
  .badge {
    width: 48px;
    height: 48px;
    margin: 0 auto 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .badge.success { background: rgba(59,107,255,0.12); }
  .badge.error { background: rgba(248,113,113,0.12); }
  h1 {
    font-size: 20px;
    font-weight: 700;
    color: #F4F7FC;
    letter-spacing: -0.02em;
    margin: 0 0 8px;
  }
  p {
    font-size: 14px;
    color: #828DA3;
    margin: 0;
    line-height: 1.5;
  }
  .error p { color: #f87171; }
  footer {
    margin-top: 20px;
    font-size: 12px;
    color: #586378;
  }
`

const UIGRAPH_MARK_SVG = `
  <svg width="28" height="28" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius: 6px; flex-shrink: 0;">
    <rect width="64" height="64" rx="16" fill="#0B0E16" />
    <g stroke="#3B6BFF" stroke-width="4" stroke-linecap="round">
      <line x1="20" y1="20" x2="44" y2="20" />
      <line x1="44" y1="20" x2="44" y2="44" />
      <line x1="44" y1="44" x2="20" y2="44" />
      <line x1="20" y1="44" x2="20" y2="20" />
    </g>
    <circle cx="44" cy="20" r="6" fill="#3B6BFF" />
    <circle cx="44" cy="44" r="6" fill="#3B6BFF" />
    <circle cx="20" cy="44" r="6" fill="#3B6BFF" />
    <circle cx="20" cy="20" r="6.5" fill="#FFFFFF" />
  </svg>
`

function renderCallbackPage(options: {
  variant: 'success' | 'error'
  title: string
  message: string
}) {
  const { variant, title, message } = options
  const icon =
    variant === 'success'
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5C84FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>`
      : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>UIGraph</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${CALLBACK_PAGE_STYLES}</style>
</head>
<body>
<div class="glow"></div>
<main class="card ${variant}">
  <div class="brand">${UIGRAPH_MARK_SVG}<span>UIGraph</span></div>
  <div class="badge ${variant}">${icon}</div>
  <h1>${title}</h1>
  <p>${message}</p>
</main>
${variant === 'success' ? `<footer>You can close this tab now.</footer>` : ''}
<script>try { window.close() } catch (e) {}</script>
</body>
</html>`
}

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
        return c.html(
          renderCallbackPage({
            variant: 'error',
            title: 'Login failed',
            message:
              'Something went wrong. Return to your terminal and try again.',
          }),
          400
        )
      }

      resolve(token)
      return c.html(
        renderCallbackPage({
          variant: 'success',
          title: "You're signed in",
          message: 'Return to your terminal to continue.',
        })
      )
    })
  })

  const server = serve({ fetch: app.fetch, port: CALLBACK_PORT })

  const loginUrl = new URL(`${getEnv().UIGRAPH_MCP_SERVER_URL}/auth/login`)
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
  const accessToken = getEnv().UIGRAPH_ACCESS_TOKEN
  if (accessToken?.trim()) {
    return accessToken.trim()
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

  const response = await fetch(`${getEnv().UIGRAPH_MCP_SERVER_URL}/auth/me`, {
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

  const orgId = getEnv().UIGRAPH_ORG_ID
  if (orgId?.trim()) {
    return orgId.trim()
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
