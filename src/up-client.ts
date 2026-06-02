import { logger } from './logger.js'
import type { UpAccount, UpTransaction } from './types.js'

interface UpAccountsResponse {
  data: UpAccount[]
  links: { prev: string | null; next: string | null }
}

interface UpTransactionsResponse {
  data: UpTransaction[]
  links: { prev: string | null; next: string | null }
}

const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 1000
const REQUEST_TIMEOUT_MS = 30_000
const BASE_URL = 'https://api.up.com.au/api/v1'

export class UpClient {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async listAccounts(): Promise<UpAccount[]> {
    const all: UpAccount[] = []
    let url: string | null = `${BASE_URL}/accounts?page[size]=100`

    while (url) {
      const data: UpAccountsResponse = await this.get<UpAccountsResponse>(url)
      all.push(...data.data)
      url = data.links.next
    }

    return all
  }

  async getTransactions(
    accountId: string,
    since: string,
    until: string
  ): Promise<UpTransaction[]> {
    const all: UpTransaction[] = []
    const params = new URLSearchParams({
      'page[size]': '100',
      'filter[since]': since,
      'filter[until]': until,
    })
    let url: string | null = `${BASE_URL}/accounts/${accountId}/transactions?${params}`

    while (url) {
      const data: UpTransactionsResponse = await this.get<UpTransactionsResponse>(url)
      all.push(...data.data)
      logger.debug({ fetched: all.length, hasMore: !!data.links.next }, 'Fetched transaction page')
      url = data.links.next
    }

    return all
  }

  private async get<T>(url: string): Promise<T> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        })

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After')
          const waitMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)
          logger.warn({ attempt, waitMs }, 'Rate limited by Up API, retrying')
          await sleep(waitMs)
          continue
        }

        if (response.status === 401) {
          throw new UpApiError(
            'Up API returned 401 Unauthorized. Check your personal access token at https://api.up.com.au/',
            401
          )
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new UpApiError(`Up API returned ${response.status}: ${body}`, response.status)
        }

        return (await response.json()) as T
      } catch (error) {
        if (error instanceof UpApiError) throw error

        if (attempt < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)
          logger.warn({ attempt, delay, error: String(error) }, 'Request failed, retrying')
          await sleep(delay)
          continue
        }

        throw new UpApiError(
          `Failed to reach Up API after ${MAX_RETRIES} attempts: ${error}`,
          0
        )
      } finally {
        clearTimeout(timeout)
      }
    }

    throw new UpApiError(`Failed to reach Up API after ${MAX_RETRIES} attempts`, 0)
  }
}

export class UpApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'UpApiError'
    this.status = status
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
