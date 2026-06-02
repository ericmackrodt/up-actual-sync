import { describe, it, expect } from 'vitest'
import { toActualTransaction, transformTransactions } from './transform.js'
import type { UpTransaction } from './types.js'

function makeUpTxn(overrides: Partial<UpTransaction['attributes']> = {}): UpTransaction {
  return {
    type: 'transactions',
    id: 'txn-123',
    attributes: {
      status: 'SETTLED',
      description: 'Woolworths',
      message: null,
      amount: { currencyCode: 'AUD', value: '-12.50', valueInBaseUnits: -1250 },
      foreignAmount: null,
      settledAt: '2024-08-20T10:00:00+10:00',
      createdAt: '2024-08-20T09:00:00+10:00',
      ...overrides,
    },
    relationships: {
      account: { data: { type: 'accounts', id: 'acc-456' } },
    },
  }
}

describe('toActualTransaction', () => {
  it('uses valueInBaseUnits directly (negative = outflow)', () => {
    const result = toActualTransaction(makeUpTxn({ amount: { currencyCode: 'AUD', value: '-12.50', valueInBaseUnits: -1250 } }))
    expect(result.amount).toBe(-1250)
  })

  it('uses valueInBaseUnits directly (positive = inflow)', () => {
    const result = toActualTransaction(makeUpTxn({ amount: { currencyCode: 'AUD', value: '12.50', valueInBaseUnits: 1250 } }))
    expect(result.amount).toBe(1250)
  })

  it('uses description as payee_name', () => {
    const result = toActualTransaction(makeUpTxn())
    expect(result.payee_name).toBe('Woolworths')
  })

  it('sets imported_id with up prefix', () => {
    const result = toActualTransaction(makeUpTxn())
    expect(result.imported_id).toBe('up:txn-123')
  })

  it('uses description as imported_payee', () => {
    const result = toActualTransaction(makeUpTxn())
    expect(result.imported_payee).toBe('Woolworths')
  })

  it('sets cleared to true for SETTLED transactions', () => {
    const result = toActualTransaction(makeUpTxn({ status: 'SETTLED' }))
    expect(result.cleared).toBe(true)
  })

  it('sets cleared to false for HELD transactions', () => {
    const result = toActualTransaction(makeUpTxn({ status: 'HELD' }))
    expect(result.cleared).toBe(false)
  })

  it('uses createdAt as the transaction date', () => {
    const result = toActualTransaction(makeUpTxn({ createdAt: '2024-08-19T09:00:00+10:00' }))
    expect(result.date).toBe('2024-08-19')
  })

  it('includes message in notes when present', () => {
    const result = toActualTransaction(makeUpTxn({ message: 'petrol' }))
    expect(result.notes).toBe('petrol')
  })

  it('omits notes when message is null', () => {
    const result = toActualTransaction(makeUpTxn({ message: null }))
    expect(result.notes).toBeUndefined()
  })
})

describe('transformTransactions', () => {
  it('imports both SETTLED and HELD transactions', () => {
    const transactions: UpTransaction[] = [
      makeUpTxn({ status: 'SETTLED', description: 'Settled txn' }),
      { ...makeUpTxn({ status: 'HELD', description: 'Held txn' }), id: 'txn-held' },
    ]

    const result = transformTransactions(transactions)
    expect(result).toHaveLength(2)
  })

  it('marks HELD transactions as not cleared', () => {
    const txn = { ...makeUpTxn({ status: 'HELD' }), id: 'txn-held' }
    const result = transformTransactions([txn])
    expect(result[0]!.cleared).toBe(false)
  })

  it('returns empty array when no transactions', () => {
    expect(transformTransactions([])).toHaveLength(0)
  })
})
