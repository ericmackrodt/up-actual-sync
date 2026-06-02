import { logger } from './logger.js'
import { loadConfig, ConfigError } from './config.js'
import { UpClient } from './up-client.js'
import { ApiVersionMismatchError, listActualAccounts } from './actual-client.js'
import { runSync } from './sync.js'

// Exit codes
const EXIT_SUCCESS = 0
const EXIT_SYNC_ERRORS = 1
const EXIT_CONFIG_ERROR = 2
const EXIT_CONNECTION_ERROR = 3
const EXIT_VERSION_MISMATCH = 4

interface CliFlags {
  listUpAccounts: boolean
  listActualAccounts: boolean
  dryRun: boolean
  days?: number
  help: boolean
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    listUpAccounts: false,
    listActualAccounts: false,
    dryRun: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--list-up-accounts':
        flags.listUpAccounts = true
        break
      case '--list-actual-accounts':
        flags.listActualAccounts = true
        break
      case '--dry-run':
        flags.dryRun = true
        break
      case '--days': {
        const val = argv[++i]
        if (!val || isNaN(parseInt(val, 10))) {
          console.error('ERROR: --days requires a number')
          process.exit(EXIT_CONFIG_ERROR)
        }
        flags.days = parseInt(val, 10)
        break
      }
      case '--help':
      case '-h':
        flags.help = true
        break
      default:
        if (arg?.startsWith('--')) {
          console.error(`Unknown flag: ${arg}`)
          process.exit(EXIT_CONFIG_ERROR)
        }
    }
  }

  return flags
}

function printHelp(): void {
  console.log(`
up-actual-sync - Sync bank transactions from Up to Actual Budget

USAGE:
  up-actual-sync [OPTIONS]

OPTIONS:
  --list-up-accounts          List Up accounts (to find IDs for mapping)
  --list-actual-accounts      List Actual Budget accounts (to find IDs for mapping)
  --dry-run                   Preview what would be imported without writing
  --days <number>             Number of days to sync (default: 30)
  --help, -h                  Show this help message

ENVIRONMENT VARIABLES:
  UP_API_KEY                  (required) Your Up personal access token
  ACTUAL_SERVER_URL           (required) URL of your Actual Budget server
  ACTUAL_PASSWORD             (required) Actual Budget server password
  ACTUAL_BUDGET_ID            (required) Budget sync ID (Settings > Advanced)
  ACCOUNT_MAPPING             (required) Account mapping (up_account_id:actual_account_id,...)
  ACTUAL_ENCRYPTION_PASSWORD  E2E encryption password (if enabled)
  ACTUAL_DATA_DIR             Local data cache (default: ./data)
  SYNC_DAYS                   Days to sync (default: 30)
  LOG_LEVEL                   debug, info, warn, error (default: info)
  DRY_RUN                     true/false (default: false)

EXAMPLES:
  # Run sync
  up-actual-sync

  # Preview without importing
  up-actual-sync --dry-run

  # Sync last 60 days
  up-actual-sync --days 60

  # Find account IDs for mapping
  up-actual-sync --list-up-accounts
  up-actual-sync --list-actual-accounts

DOCKER:
  docker run --rm --env-file .env -v sync-data:/app/data ghcr.io/your-org/up-actual-sync
`)
}

async function handleListUpAccounts(): Promise<void> {
  const apiKey = process.env.UP_API_KEY

  if (!apiKey) {
    console.error(
      'ERROR: UP_API_KEY is not set.\n' +
        '  → Get your personal access token at https://api.up.com.au/'
    )
    process.exit(EXIT_CONFIG_ERROR)
  }

  const client = new UpClient(apiKey)
  const accounts = await client.listAccounts()

  console.log('\nUp Accounts:')
  for (const account of accounts) {
    const balance = account.attributes.balance.value
    console.log(
      `  ${account.id}  ${account.attributes.displayName} (${account.attributes.accountType})  ${balance} ${account.attributes.balance.currencyCode}`
    )
  }
  console.log()
}

async function handleListActualAccounts(): Promise<void> {
  const serverUrl = process.env.ACTUAL_SERVER_URL
  const password = process.env.ACTUAL_PASSWORD
  const budgetId = process.env.ACTUAL_BUDGET_ID
  const encryptionPassword = process.env.ACTUAL_ENCRYPTION_PASSWORD
  const dataDir = process.env.ACTUAL_DATA_DIR || './data'

  if (!serverUrl || !password || !budgetId) {
    console.error(
      'ERROR: ACTUAL_SERVER_URL, ACTUAL_PASSWORD, and ACTUAL_BUDGET_ID are required.\n' +
        '  → Set these environment variables to connect to your Actual Budget server.'
    )
    process.exit(EXIT_CONFIG_ERROR)
  }

  const accounts = await listActualAccounts({
    serverUrl,
    password,
    budgetId,
    encryptionPassword,
    dataDir,
  })

  console.log('\nActual Budget Accounts:')
  for (const account of accounts) {
    if (account.closed) continue
    const type = account.type ? ` (${account.type})` : ''
    const badge = account.offbudget ? ' [off-budget]' : ''
    console.log(`  ${account.id}  ${account.name}${type}${badge}`)
  }
  console.log()
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2))

  if (flags.help) {
    printHelp()
    process.exit(EXIT_SUCCESS)
  }

  if (flags.listUpAccounts) {
    await handleListUpAccounts()
    process.exit(EXIT_SUCCESS)
  }

  if (flags.listActualAccounts) {
    await handleListActualAccounts()
    process.exit(EXIT_SUCCESS)
  }

  const overrides: Record<string, string> = {}
  if (flags.dryRun) overrides.DRY_RUN = 'true'
  if (flags.days) overrides.SYNC_DAYS = String(flags.days)

  const config = loadConfig(overrides)

  if (config.dryRun) {
    logger.info('[DRY RUN] Preview mode — no changes will be written')
  }

  const results = await runSync(config)

  const totalAdded = results.reduce((sum, r) => sum + r.added, 0)
  const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0)
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0)

  if (config.dryRun) {
    logger.info(
      `[DRY RUN] Would import ${totalAdded} transactions across ${results.length} accounts. No changes written.`
    )
  } else {
    logger.info(
      { totalAdded, totalUpdated, totalErrors, accounts: results.length },
      'Sync complete. Changes pushed to Actual Budget server.'
    )
  }

  if (totalErrors > 0) {
    process.exit(EXIT_SYNC_ERRORS)
  }
}

main().catch((error) => {
  if (error instanceof ConfigError) {
    console.error(`ERROR: ${error.message}`)
    process.exit(EXIT_CONFIG_ERROR)
  }

  if (error instanceof ApiVersionMismatchError) {
    logger.error(
      {
        serverVersion: error.serverVersion,
        bundledVersion: error.bundledVersion,
        downloadError: error.downloadError,
      },
      error.message
    )
    process.exit(EXIT_VERSION_MISMATCH)
  }

  if (
    error instanceof Error &&
    (error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('Failed to reach'))
  ) {
    logger.error({ error: error.message }, 'Connection error')
    process.exit(EXIT_CONNECTION_ERROR)
  }

  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    'Unexpected error'
  )
  process.exit(EXIT_SYNC_ERRORS)
})
