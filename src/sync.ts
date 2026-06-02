import { logger } from './logger.js'
import { UpClient } from './up-client.js'
import { withActualBudget } from './actual-client.js'
import { transformTransactions } from './transform.js'
import type { Config } from './config.js'
import type { SyncResult } from './types.js'

/**
 * Run the full sync pipeline:
 * 1. Fetch transactions from Up for each mapped account
 * 2. Transform to Actual Budget format
 * 3. Import into Actual Budget
 */
export async function runSync(config: Config): Promise<SyncResult[]> {
  const up = new UpClient(config.upApiKey)

  // Validate Up connection and get accounts
  logger.info('Connecting to Up API...')
  const accounts = await up.listAccounts()
  logger.info({ accountCount: accounts.length }, `Connected to Up API (${accounts.length} accounts)`)

  // Build a lookup map for Up accounts
  const upAccountMap = new Map(accounts.map((a) => [a.id, a]))

  // Validate all mapped Up accounts exist
  for (const mapping of config.accountMapping) {
    if (!upAccountMap.has(mapping.upAccountId)) {
      throw new Error(
        `Up account ID '${mapping.upAccountId}' not found.\n` +
          '  → Run with --list-up-accounts to see available accounts.'
      )
    }
  }

  // Calculate date range in RFC-3339 format required by Up API
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - config.syncDays)
  const sinceStr = from.toISOString()
  const untilStr = to.toISOString()

  logger.info(
    { from: sinceStr.split('T')[0], to: untilStr.split('T')[0], days: config.syncDays },
    'Sync window'
  )

  // Connect to Actual Budget and run sync
  return withActualBudget(
    {
      serverUrl: config.actualServerUrl,
      password: config.actualPassword,
      budgetId: config.actualBudgetId,
      encryptionPassword: config.actualEncryptionPassword,
      dataDir: config.actualDataDir,
    },
    async ({ getAccounts, importTransactions }) => {
      // Validate all mapped Actual accounts exist
      const actualAccounts = await getAccounts()
      const actualAccountMap = new Map(actualAccounts.map((a) => [a.id, a]))

      for (const mapping of config.accountMapping) {
        if (!actualAccountMap.has(mapping.actualAccountId)) {
          throw new Error(
            `Actual Budget account ID '${mapping.actualAccountId}' not found.\n` +
              '  → Run with --list-actual-accounts to see available accounts.'
          )
        }
      }

      logger.info({ budgetAccounts: actualAccounts.length }, 'Connected to Actual Budget')

      const results: SyncResult[] = []

      // Sync each account mapping
      for (const mapping of config.accountMapping) {
        const upAccount = upAccountMap.get(mapping.upAccountId)!
        const actualAccount = actualAccountMap.get(mapping.actualAccountId)!

        logger.info(`Syncing: ${upAccount.attributes.displayName} → ${actualAccount.name}`)

        // Fetch transactions from Up
        const transactions = await up.getTransactions(mapping.upAccountId, sinceStr, untilStr)

        logger.info(
          { count: transactions.length },
          `Fetched ${transactions.length} transactions (${config.syncDays} days)`
        )

        // Transform to Actual format
        const actualTransactions = transformTransactions(transactions)

        if (actualTransactions.length === 0) {
          logger.info('No transactions to import')
          results.push({
            upAccountId: mapping.upAccountId,
            actualAccountId: mapping.actualAccountId,
            accountName: upAccount.attributes.displayName,
            fetched: transactions.length,
            added: 0,
            updated: 0,
            errors: 0,
          })
          continue
        }

        if (config.dryRun) {
          logger.info(
            `[DRY RUN] Would import ${actualTransactions.length} transactions to '${actualAccount.name}'`
          )
          results.push({
            upAccountId: mapping.upAccountId,
            actualAccountId: mapping.actualAccountId,
            accountName: upAccount.attributes.displayName,
            fetched: transactions.length,
            added: actualTransactions.length,
            updated: 0,
            errors: 0,
          })
          continue
        }

        // Import into Actual Budget
        const importResult = await importTransactions(mapping.actualAccountId, actualTransactions)

        const added = Array.isArray(importResult.added) ? importResult.added.length : 0
        const updated = Array.isArray(importResult.updated) ? importResult.updated.length : 0
        const errors = Array.isArray(importResult.errors) ? importResult.errors.length : 0

        logger.info({ added, updated, errors }, `Imported: ${added} added, ${updated} updated, ${errors} errors`)

        results.push({
          upAccountId: mapping.upAccountId,
          actualAccountId: mapping.actualAccountId,
          accountName: upAccount.attributes.displayName,
          fetched: transactions.length,
          added,
          updated,
          errors,
        })
      }

      return results
    }
  )
}
