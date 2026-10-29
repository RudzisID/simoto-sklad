/**
 * @file ozon-client.ts
 * Ozon Seller API client.
 *
 * Интерфейсы:
 * - Returns API (возвраты)
 * - Postings API (отправления)
 * - Products API (товары)
 *
 * @module supplies-warehouse/utils/ozon-client
 */

const OZON_API_URL = "https://api-seller.ozon.ru"

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000
const TIMEOUT_MS = 30000

export interface OzonReturn {
  posting_number: string
  product_id: number
  product_name: string
  price: number
  status_name: string
  status: string
  return_reason: string
  sku: number
  quantity: number
  warehouse_id: number
}

export interface OzonPosting {
  posting_number: string
  order_id: number
  order_number: string
  status: string
  posting_status: string
  delivery_method: { id: number; name: string }
  products: Array<{ sku: number; name: string; price: number; quantity: number; offer_id: string }>
  created_at: string
  financial_data: any
}

/**
 * Ozon Seller API клиент.
 */
export class OzonClient {
  constructor(
    private clientId: string,
    private apiKey: string
  ) {}

  // ========================================
  // RETURNS — возвраты
  // ========================================

  /**
   * Получить возвраты Ozon.
   *
   * @param dateFrom — Дата начала (ISO).
   * @returns Массив возвратов.
   */
  async fetchReturns(dateFrom: string): Promise<OzonReturn[]> {
    const url = `${OZON_API_URL}/v1/returns/list`
    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify({
        filter: { created_at: { from: dateFrom } },
        limit: 1000,
        offset: 0,
      }),
    })
    return response.returns ?? response.result?.returns ?? []
  }

  /**
   * Получить список возвратов по отправлениям.
   */
  async fetchReturnStatuses(postingNumbers: string[]): Promise<any[]> {
    const url = `${OZON_API_URL}/v1/returns/statuses`
    return this.request(url, {
      method: "POST",
      body: JSON.stringify({ posting_numbers: postingNumbers }),
    })
  }

  // ========================================
  // POSTINGS — отправления
  // ========================================

  /**
   * Получить отправления Ozon за период.
   *
   * @param dateFrom — Дата начала.
   * @param dateTo — Дата окончания.
   * @param status — Статус отправления.
   */
  async fetchPostings(
    dateFrom: string,
    dateTo: string,
    status?: string
  ): Promise<OzonPosting[]> {
    const url = `${OZON_API_URL}/v1/posting/fbs/list`
    const body: Record<string, unknown> = {
      dir: "ASC",
      filter: {
        since: dateFrom,
        to: dateTo,
        ...(status ? { status } : {}),
      },
      limit: 100,
    }
    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify(body),
    })
    return response.result?.postings ?? []
  }

  /**
   * Получить статус отправления по номеру.
   */
  async fetchPostingStatus(postingNumber: string): Promise<{ status: string; statusName: string }> {
    const url = `${OZON_API_URL}/v1/posting/fbs/get`
    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify({ posting_number: postingNumber }),
    })
    const posting = response.result ?? response
    return {
      status: posting.status ?? "",
      statusName: posting.status_name ?? posting.status ?? "",
    }
  }

  // ========================================
  // PRODUCTS — товары
  // ========================================

  /**
   * Получить информацию о товаре по SKU.
   */
  async fetchProductBySku(sku: string): Promise<any | null> {
    const url = `${OZON_API_URL}/v2/products/info`
    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify({ sku: [sku] }),
    })
    return response.result?.items?.[0] ?? null
  }

  /**
   * Получить цены товаров.
   */
  async fetchPrices(skus: string[]): Promise<any[]> {
    const url = `${OZON_API_URL}/v4/product/info/prices`
    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify({ filter: { skus }, limit: 1000 }),
    })
    return response.result?.items ?? []
  }

  // ========================================
  // COMMON
  // ========================================

  private async request(url: string, options: RequestInit = {}): Promise<any> {
    const headers: Record<string, string> = {
      "Client-Id": this.clientId,
      "Api-Key": this.apiKey,
      "Content-Type": "application/json",
    }

    let lastError: Error | undefined

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })

        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Ozon API error ${response.status}`)
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt)))
          } else {
            throw lastError
          }
        } else if (!response.ok) {
          throw new Error(`Ozon API error ${response.status}`)
        } else {
          return await response.json()
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          lastError = err
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
          } else {
            throw new Error(`Ozon API timeout: ${err.message}`)
          }
        } else {
          throw err
        }
      }
    }

    throw lastError || new Error("Ozon API request failed")
  }
}
