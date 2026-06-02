import type { UpTransaction } from './types.js'

export interface ActualTransaction {
  date: string
  amount: number
  payee_name: string
  imported_payee: string
  imported_id: string
  notes?: string
  cleared: boolean
}

/**
 * Transform an Up transaction into Actual Budget's import format.
 *
 * - Amount: valueInBaseUnits is already signed integer cents (negative = outflow, positive = inflow).
 * - imported_id: prefixed with "up:" to avoid collision with other importers.
 * - payee_name: uses rawText (raw terminal string) when available, falls back to description.
 * - date: always uses createdAt (the date the transaction occurred).
 * - cleared: true for SETTLED transactions, false for HELD (pending).
 */
export function toActualTransaction(txn: UpTransaction): ActualTransaction {
  // valueInBaseUnits is already signed integer cents (negative = debit/outflow)
  const amount = txn.attributes.amount.valueInBaseUnits

  const date = txn.attributes.createdAt.split('T')[0]!

  return {
    date,
    amount,
    payee_name: txn.attributes.rawText ?? txn.attributes.description,
    imported_payee: txn.attributes.rawText ?? txn.attributes.description,
    imported_id: `up:${txn.id}`,
    notes: txn.attributes.message || undefined,
    cleared: txn.attributes.status === 'SETTLED',
  }
}

/**
 * Transform a batch of Up transactions into Actual Budget's import format.
 * Includes both HELD (pending) and SETTLED transactions.
 */
export function transformTransactions(transactions: UpTransaction[]): ActualTransaction[] {
  return transactions.map(toActualTransaction)
}
