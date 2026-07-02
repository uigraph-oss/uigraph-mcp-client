#!/usr/bin/env node

import chalk from 'chalk'
import { runCli } from './cli'

try {
  await runCli(process.argv)
} catch (error) {
  if (error instanceof Error) {
    console.error(chalk.red(error.message))
  } else {
    console.error(chalk.red('Unexpected error occurred.'))
  }

  process.exitCode = 1
}
