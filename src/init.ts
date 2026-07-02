import { select } from '@inquirer/prompts'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { env } from './env'

type AgentFormat =
  | 'json-mcp-servers'
  | 'json-servers'
  | 'opencode'
  | 'codex-toml'

type Agent = {
  id: string
  label: string
  file: string
  format: AgentFormat
}

function projectPath(...segments: string[]) {
  return path.join(process.cwd(), ...segments)
}

function homePath(...segments: string[]) {
  return path.join(os.homedir(), ...segments)
}

function claudeDesktopConfigPath() {
  if (process.platform === 'darwin') {
    return homePath(
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    )
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData) {
      return path.join(appData, 'Claude', 'claude_desktop_config.json')
    }
    return homePath(
      'AppData',
      'Roaming',
      'Claude',
      'claude_desktop_config.json'
    )
  }

  return homePath('.config', 'Claude', 'claude_desktop_config.json')
}

function getAgents(): Agent[] {
  return [
    {
      id: 'cursor',
      label: 'Cursor',
      file: projectPath('.cursor', 'mcp.json'),
      format: 'json-mcp-servers',
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      file: projectPath('.mcp.json'),
      format: 'json-mcp-servers',
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      file: claudeDesktopConfigPath(),
      format: 'json-mcp-servers',
    },
    {
      id: 'vscode',
      label: 'VS Code',
      file: projectPath('.vscode', 'mcp.json'),
      format: 'json-servers',
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      file: homePath('.codeium', 'windsurf', 'mcp_config.json'),
      format: 'json-mcp-servers',
    },
    {
      id: 'gemini',
      label: 'Gemini CLI',
      file: homePath('.gemini', 'settings.json'),
      format: 'json-mcp-servers',
    },
    {
      id: 'opencode',
      label: 'opencode',
      file: projectPath('opencode.json'),
      format: 'opencode',
    },
    {
      id: 'codex',
      label: 'Codex',
      file: homePath('.codex', 'config.toml'),
      format: 'codex-toml',
    },
  ]
}

function runCommand(command: string, args: string[]) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      stdio: 'ignore',
    })

    child.on('error', () => {
      resolve(false)
    })

    child.on('exit', (code) => {
      resolve(code === 0)
    })
  })
}

function installGlobalPackage() {
  return new Promise<boolean>((resolve) => {
    const child = spawn('npm', ['i', '-g', '@uigraph/mcp'], {
      shell: process.platform === 'win32',
      stdio: 'inherit',
    })

    child.on('error', () => {
      resolve(false)
    })

    child.on('exit', (code) => {
      resolve(code === 0)
    })
  })
}

async function hasUigraphMcpCommand() {
  if (process.platform === 'win32') {
    return runCommand('where', ['uigraph-mcp'])
  }

  return runCommand('command', ['-v', 'uigraph-mcp'])
}

async function ensureUigraphMcpInstalled() {
  if (await hasUigraphMcpCommand()) {
    console.log('uigraph-mcp found on PATH.')
    return
  }

  console.log(
    'uigraph-mcp not found on PATH. Installing @uigraph/mcp globally...'
  )

  if (!(await installGlobalPackage())) {
    throw new Error('Failed to install @uigraph/mcp globally with npm.')
  }

  console.log('Installed @uigraph/mcp globally.')

  if (!(await hasUigraphMcpCommand())) {
    throw new Error(
      'Installed @uigraph/mcp globally, but uigraph-mcp is still not available on PATH.\nRestart your terminal or ensure npm global bin is in PATH, then run:\nuigraph-mcp init'
    )
  }
}

function buildServerEnv(): Record<string, string> {
  const serverEnv: Record<string, string> = {
    UIGRAPH_MCP_SERVER_URL: env.UIGRAPH_MCP_SERVER_URL,
  }

  if (env.UIGRAPH_ACCESS_TOKEN?.trim()) {
    serverEnv.UIGRAPH_ACCESS_TOKEN = env.UIGRAPH_ACCESS_TOKEN.trim()
  }

  if (env.UIGRAPH_ORG_ID?.trim()) {
    serverEnv.UIGRAPH_ORG_ID = env.UIGRAPH_ORG_ID.trim()
  }

  return serverEnv
}

async function readJsonObject(file: string): Promise<Record<string, unknown>> {
  try {
    const existing = await readFile(file, 'utf8')
    const next = JSON.parse(existing)

    if (typeof next === 'object' && next !== null) {
      return next as Record<string, unknown>
    }

    return {}
  } catch {
    return {}
  }
}

async function writeJsonServer(
  file: string,
  topKey: string,
  serverEnv: Record<string, string>
) {
  await mkdir(path.dirname(file), { recursive: true })

  const parsed = await readJsonObject(file)
  const current = parsed[topKey]
  const servers =
    typeof current === 'object' && current !== null
      ? (current as Record<string, unknown>)
      : {}

  parsed[topKey] = {
    ...servers,
    uigraph: {
      command: 'uigraph-mcp',
      env: serverEnv,
    },
  }

  await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
}

async function writeOpencode(file: string, serverEnv: Record<string, string>) {
  await mkdir(path.dirname(file), { recursive: true })

  const parsed = await readJsonObject(file)

  if (!parsed.$schema) {
    parsed.$schema = 'https://opencode.ai/config.json'
  }

  const current = parsed.mcp
  const mcp =
    typeof current === 'object' && current !== null
      ? (current as Record<string, unknown>)
      : {}

  parsed.mcp = {
    ...mcp,
    uigraph: {
      type: 'local',
      command: ['uigraph-mcp'],
      enabled: true,
      environment: serverEnv,
    },
  }

  await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
}

function codexBlock(serverEnv: Record<string, string>) {
  const envEntries = Object.entries(serverEnv)
    .map(([key, value]) => `"${key}" = "${value}"`)
    .join(', ')

  return `[mcp_servers.uigraph]\ncommand = "uigraph-mcp"\nenv = { ${envEntries} }\n`
}

async function writeCodex(file: string, serverEnv: Record<string, string>) {
  await mkdir(path.dirname(file), { recursive: true })

  let content = ''
  try {
    content = await readFile(file, 'utf8')
  } catch {
    content = ''
  }

  const block = codexBlock(serverEnv)

  if (content.includes('[mcp_servers.uigraph]')) {
    const replaced = content.replace(
      /\[mcp_servers\.uigraph\][\s\S]*?(?=\n\[|$)/,
      block.trimEnd()
    )
    const normalized = replaced.endsWith('\n') ? replaced : `${replaced}\n`
    await writeFile(file, normalized, 'utf8')
    return
  }

  if (content.length === 0) {
    await writeFile(file, block, 'utf8')
    return
  }

  const separator = content.endsWith('\n') ? '\n' : '\n\n'
  await writeFile(file, `${content}${separator}${block}`, 'utf8')
}

async function promptAgent(agents: Agent[]): Promise<Agent> {
  return select({
    message: 'Select an agent to configure for UIGraph MCP',
    choices: agents.map((agent) => ({ name: agent.label, value: agent })),
  })
}

async function applyAgent(agent: Agent, serverEnv: Record<string, string>) {
  if (agent.format === 'json-mcp-servers') {
    await writeJsonServer(agent.file, 'mcpServers', serverEnv)
    return
  }

  if (agent.format === 'json-servers') {
    await writeJsonServer(agent.file, 'servers', serverEnv)
    return
  }

  if (agent.format === 'opencode') {
    await writeOpencode(agent.file, serverEnv)
    return
  }

  if (agent.format === 'codex-toml') {
    await writeCodex(agent.file, serverEnv)
    return
  }

  throw new Error(`Unhandled agent format "${agent.format}".`)
}

export async function initTool(requested?: string) {
  const agents = getAgents()

  let agent: Agent
  if (requested) {
    const match = agents.find((entry) => entry.id === requested)
    if (!match) {
      throw new Error(
        `Unsupported agent "${requested}".\nSupported agents: ${agents
          .map((entry) => entry.id)
          .join(', ')}`
      )
    }
    agent = match
  } else {
    agent = await promptAgent(agents)
  }

  await ensureUigraphMcpInstalled()

  const serverEnv = buildServerEnv()
  await applyAgent(agent, serverEnv)

  return { label: agent.label, file: agent.file }
}
