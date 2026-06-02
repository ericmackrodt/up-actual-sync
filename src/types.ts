export interface UpMoneyObject {
  currencyCode: string
  value: string
  valueInBaseUnits: number
}

export interface UpAccount {
  type: 'accounts'
  id: string
  attributes: {
    displayName: string
    accountType: 'SAVER' | 'TRANSACTIONAL' | 'HOME_LOAN'
    ownershipType: 'INDIVIDUAL' | 'JOINT'
    balance: UpMoneyObject
    createdAt: string
  }
}

export interface UpTransaction {
  type: 'transactions'
  id: string
  attributes: {
    status: 'HELD' | 'SETTLED'
    rawText: string | null
    description: string
    message: string | null
    amount: UpMoneyObject
    foreignAmount: UpMoneyObject | null
    settledAt: string | null
    createdAt: string
  }
  relationships: {
    account: { data: { type: string; id: string } }
  }
}

export interface AccountMapping {
  upAccountId: string
  actualAccountId: string
}

export interface SyncResult {
  upAccountId: string
  actualAccountId: string
  accountName: string
  fetched: number
  added: number
  updated: number
  errors: number
}
