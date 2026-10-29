/**
 * @file wb-client.ts
 * Wildberries Supplier API client.
 *
 * Интерфейсы:
 * - Content API (карточки товаров)
 * - Marketplace API (заказы, поставки, остатки)
 * - Analytics API (продажи, возвраты)
 *
 * @module supplies-warehouse/utils/wb-client
 */

const WB_CONTENT_URL = "https://content-api.wildberries.ru"
const WB_MARKETPLACE_URL = "https://suppliers-api.wildberries.ru"
const WB_ANALYTICS_URL = "https://analytics-api.wildberries.ru"

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000
const TIMEOUT_MS = 30000

export interface WbOrder {
  id: string
  warehouseId: number
  ozId: number
  rid: string
  createdAt: string
  userStatus: number
  skus: string[]
  nmId: number
  price: number
  currencyCode: number
  discountPercent: number
  orderUID: string
}

export interface WbReturn {
  id: string
  orderUID: string
  sku: string
  decision: string
  returnReasonType: string
  amount: number
}

/**
 * Wildberries API клиент.
 */
export class WbClient {
  constructor(private token: string) {}

  // ========================================
  // MARKETPLACE API — заказы
  // ========================================

  /**
   * Получить новые заказы WB за период.
   *
   * @param dateFrom — Дата начала (ISO).
   * @returns Массив заказов.
   */
  async fetchOrders(dateFrom: string): Promise<WbOrder[]> {
    const url = `${WB_MARKETPLACE_URL}/api/v3/orders/new`
    const response = await this.request(url)
    return response ?? []
  }

  /**
   * Получить статусы заказов по SKU.
   *
   * @param orderIds — ID заказов.
   * @returns Статусы.
   */
  async fetchOrderStatuses(orderIds: number[]): Promise<any[]> {
    const url = `${WB_MARKETPLACE_URL}/api/v3/orders/status`
    return this.request(url, {
      method: "POST",
      body: JSON.stringify({ orders: orderIds }),
    })
  }

  // ========================================
  // ANALYTICS API — продажи и возвраты
  // ========================================

  /**
   * Получить продажи WB за период.
   *
   * @param dateFrom — Дата начала.
   * @param dateTo — Дата окончания.
   */
  async fetchSales(dateFrom: string, dateTo: string): Promise<any[]> {
    const params = new URLSearchParams({ dateFrom, dateTo })
    const url = `${WB_ANALYTICS_URL}/api/v1/supplier/reportDetailByPeriod?${params.toString()}`
    const response = await this.request(url)
    return response.data ?? []
  }

  /**
   * Получить возвраты WB.
   *
   * @param dateFrom — Дата начала.
   */
  async fetchReturns(dateFrom: string): Promise<WbReturn[]> {
    // WB не имеет прямого API для возвратов — используем статусы заказов
    const orders = await this.fetchOrders(dateFrom)
    return orders
      .filter((o: any) => o.userStatus === 6) // Возврат
      .map((o: any) => ({
        id: o.id.toString(),
        orderUID: o.orderUID,
        sku: o.skus?.[0] ?? "",
        decision: "return",
        returnReasonType: "unknown",
        amount: o.price,
      }))
  }

  // ========================================
  // CONTENT API — карточки товаров
  // ========================================

  /**
   * Поиск товара по артикулу (SKU).
   */
  async fetchCardBySku(sku: string): Promise<any | null> {
    const url = `${WB_CONTENT_URL}/content/v2/cards/filter`
    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify({
        params: { query: sku, limit: 1 },
      }),
    })
    return response.cards?.[0] ?? null
  }

  // ========================================
  // COMMON
  // ========================================

  private async request(url: string, options: RequestInit = {}): Promise<any> {
    const headers: Record<string, string> = {
      "Authorization": this.token,
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
          lastError = new Error(`WB API error ${response.status}`)
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt)))
          } else {
            throw lastError
          }
        } else if (!response.ok) {
          throw new Error(`WB API error ${response.status}`)
        } else {
          return await response.json()
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          lastError = err
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
          } else {
            throw new Error(`WB API timeout: ${err.message}`)
          }
        } else {
          throw err
        }
      }
    }

    throw lastError || new Error("WB API request failed")
  }
}
