import { Command } from '@commander-js/extra-typings'
import chalk from 'chalk'
import {
  authStatus,
  listOrgs,
  login,
  logout,
  selectDefaultOrg,
  setDefaultOrgById,
} from './auth'
import { getEnv } from './env'
import { initTool } from './init'
import { runProxy } from './proxy'

export async function runCli(argv: string[]) {
  const program = new Command()
    .name('uigraph-mcp')
    .description('UIGraph MCP local proxy and auth CLI')
    .action(async () => {
      getEnv()
      await runProxy()
    })

  const auth = program.command('auth').description('Authentication commands')

  auth
    .command('login')
    .description('Login as a service account or user account')
    .action(async () => {
      getEnv()
      await login()
      console.log(chalk.green('✔ Login complete.'))
    })

  auth
    .command('logout')
    .description('Remove stored credentials from keychain')
    .action(async () => {
      await logout()
      console.log(chalk.green('✔ Logged out.'))
    })

  auth
    .command('status')
    .description('Show current authentication status')
    .action(async () => {
      getEnv()
      const status = await authStatus()

      if (!status.authenticated) {
        console.log(
          chalk.red('Not authenticated.') +
            ` Run ${chalk.cyan('uigraph-mcp auth login')}.`
        )
        process.exitCode = 1
        return
      }

      const { me, orgs } = status

      if (me.kind === 'service_account') {
        console.log(`Logged in as ${chalk.bold(me.name)} (service account)`)
        if (orgs.length > 0) {
          console.log(`Organization: ${chalk.cyan(orgs[0].name)}`)
        }
        return
      }

      const effectiveOrg = await selectDefaultOrg(orgs)

      console.log(`Logged in as ${chalk.bold(me.name)} (${me.email})`)

      if (orgs.length === 0) {
        console.log('Organizations: none')
        return
      }

      console.log('Organizations:')
      for (const org of orgs) {
        const isDefault = org.id === effectiveOrg
        const name = isDefault ? chalk.cyan(org.name) : org.name
        const tag = isDefault ? chalk.dim(' (default)') : ''
        console.log(`  - ${name}${tag}`)
      }
    })

  auth
    .command('orgs')
    .description('List organizations you belong to')
    .action(async () => {
      getEnv()
      const orgs = await listOrgs()
      const effectiveOrg = await selectDefaultOrg(orgs)

      if (orgs.length === 0) {
        console.log(chalk.dim('No organizations found.'))
        return
      }

      for (const org of orgs) {
        const isDefault = org.id === effectiveOrg
        const name = isDefault ? chalk.cyan(org.name) : org.name
        const tag = isDefault ? chalk.dim(' (default)') : ''
        console.log(`  ${name}${tag}`)
      }
    })

  auth
    .command('default-org')
    .argument('<org>', 'organization id or name')
    .description('Set the default org used for MCP tool calls')
    .action(async (org) => {
      getEnv()
      const match = await setDefaultOrgById(org)
      console.log(
        `${chalk.green('✔')} Default org set to ${chalk.cyan(match.name)}.`
      )
    })

  program
    .command('init')
    .argument(
      '[agent]',
      'agent to configure (cursor, claude-code, claude-desktop, vscode, windsurf, gemini, opencode, codex); omit to pick interactively'
    )
    .description('Write MCP config for an agent')
    .action(async (agent) => {
      const result = await initTool(agent)
      console.log(
        `${chalk.green('✔')} Initialized ${result.label} MCP config at ${chalk.dim(result.file)}`
      )
    })

  await program.parseAsync(argv)
}
