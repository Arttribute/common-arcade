#!/usr/bin/env node
import { runCli } from './index.js'

process.exitCode = await runCli({ args: process.argv.slice(2) })
