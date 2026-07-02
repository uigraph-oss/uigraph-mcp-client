import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { jsoncPatch } = require('jsonc-patch')

const version = process.argv[2]
if (!version) {
  console.error('Usage: node scripts/set-version.mjs <version>')
  process.exit(1)
}

const path = 'package.json'
const text = readFileSync(path, 'utf8')
const pkg = JSON.parse(text)
pkg.version = version
writeFileSync(path, jsoncPatch(text, pkg))
