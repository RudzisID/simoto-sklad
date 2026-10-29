/**
 * @file ms-http.ts
 * HTTP-клиент для МойСклад API — обёртка над MoySkladApiClient.
 *
 * Использует существующие методы MoySkladApiClient через прокси,
 * добавляет недостающие через client.request() (retry/rate-limit из коробки).
 *
 * Никак не модифицирует MoySkladApiClient — только использует его.
 *
 * @module supplies-warehouse/utils/ms-http
 */

import { MedusaError } from "@medusajs/framework/utils"
import { MoySkladApiClient } from "../../../lib/moysklad-api-client"

const BASE_URL = "https://api.moysklad.ru/api/remap/1.2"

/**
 * Получить baseUrl для МойСклад API.
 * Используется в service для построения href статусов.
 */
export function getMsBaseUrl(): string {
  return BASE_URL
}

/**
 * Нормализовать коллекцию МойСклад в массив.
 * MS может вернуть массив или `{ rows: [] }` (для expand-полей).
 *
 * @param value — значение поля ответа MS.
 * @returns Массив элементов (пустой, если данных нет).
 */
export function normalizeRows<T = any>(value: unknown): T[] {
  if (!value) return []
  if (Array.isArray(value)) return value as T[]
  const rows = (value as { rows?: unknown }).rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

/**
 * HTTP-клиент для работы с МойСклад API.
 * Обёртка над MoySkladApiClient — не меняет его, использует как библиотеку.
 */
export class MsHttp {
  private client: MoySkladApiClient

  constructor(token: string) {
    this.client = new MoySkladApiClient(token)
  }

  // ========================================
  // ПРОКСИ-МЕТОДЫ (используют MoySkladApiClient)
  // ========================================

  /** Создать входящий платёж (paymentin). */
  createPaymentIn(data: Record<string, unknown>) {
    return this.client.createPaymentIn(data)
  }

  /** Найти товар по коду. */
  getProductByCode(code: string) {
    return this.client.getProductByCode(code)
  }

  /** Найти товар по коду или артикулю. */
  getAssortmentByCodeOrArticle(value: string) {
    return this.client.getAssortmentByCodeOrArticle(value)
  }

  /** Получить остатки по всем товарам. */
  getStock(): Promise<any[]> {
    return this.client.getStock()
  }

  /** Получить остатки по конкретному складу. */
  getStockByStore(storeHref: string): Promise<any[]> {
    return this.client.getStockByStore(storeHref)
  }

  /** Получить список организаций. */
  listOrganizations(search?: string) {
    return this.client.listOrganizations(search)
  }

  /** Получить список складов. */
  listStores() {
    return this.client.listStores()
  }

  /** Получить список сотрудников. */
  listEmployees() {
    return this.client.listEmployees()
  }

  /** Создать контрагента. */
  createCounterparty(data: Record<string, unknown>) {
    return this.client.createCounterparty(data)
  }

  /** Найти контрагента по email. */
  findCounterpartyByEmail(email: string) {
    return this.client.findCounterpartyByEmail(email)
  }

  /** Финансы заказа (sum, paidSum, shippedSum). */
  getCustomerOrderFinance(orderHref: string) {
    return this.client.getCustomerOrderFinance(orderHref)
  }

  /** Получить операцию по href. */
  getOperation(href: string) {
    return this.client.getOperation(href)
  }

  /** Список каналов продаж. */
  listSalesChannels(search?: string) {
    return this.client.listSalesChannels(search)
  }

  /** Найти заказ покупателя по номеру (name). */
  findCustomerOrderByNumber(number: string) {
    return this.client.findCustomerOrderByNumber(number)
  }

  // ========================================
  // НЕДОСТАЮЩИЕ МЕТОДЫ (через client.request())
  // ========================================

  /**
   * Получить customerorder с полным expand.
   * ВАЖНО: у customerorder НЕТ поля `payments` — платежи живут в demand.payments.
   */
  async getCustomerOrder(orderHref: string): Promise<any> {
    const id = this.extractUuid(orderHref)
    const path = `/entity/customerorder/${id}?expand=positions,demands,returns,state,agent,store,salesChannel`
    return this.client.request<any>(path, { method: "GET" })
  }

  /**
   * Получить demand с expand (включая payments и positions).
   * Используется для проверки существующих платежей и возвратов.
   */
  async getDemand(demandHref: string): Promise<any> {
    const id = this.extractUuid(demandHref)
    const path = `/entity/demand/${id}?expand=positions,payments,state,agent,store,salesChannel`
    return this.client.request<any>(path, { method: "GET" })
  }

  /**
   * Найти customerorder по номеру отправления (в description).
   * MoySkladApiClient.findCustomerOrderByNumber ищет по name, а не по description.
   */
  async findOrderByShipmentNum(
    shipmentNum: string,
    options?: {
      counterpartyHrefs?: string[]
      createdFrom?: string
      createdTo?: string
    }
  ): Promise<any | null> {
    const filters: string[] = []
    filters.push(`description~${encodeURIComponent(shipmentNum)}`)

    if (options?.counterpartyHrefs?.length) {
      const agentFilter = options.counterpartyHrefs
        .map(href => `agent=${encodeURIComponent(href)}`)
        .join(",")
      filters.push(agentFilter)
    }
    if (options?.createdFrom) {
      filters.push(`moment>=${options.createdFrom}`)
    }
    if (options?.createdTo) {
      filters.push(`moment<=${options.createdTo}`)
    }

    const path = `/entity/customerorder?filter=${filters.join(";")}&expand=positions,demands,returns,payments,state,agent,organization.store,salesChannel&limit=10`

    const response = await this.client.request<any>(path, { method: "GET" })
    return response.rows?.[0] ?? null
  }

  /**
   * Список customerorders с фильтром (для scanNewOrders).
   */
  async listCustomerOrders(filter: {
    counterpartyHrefs?: string[]
    state?: string
    createdFrom?: string
    createdTo?: string
    limit?: number
    offset?: number
  }): Promise<{ rows: any[]; meta: { size: number } }> {
    const filters: string[] = []

    if (filter.counterpartyHrefs?.length) {
      const agentFilter = filter.counterpartyHrefs
        .map(href => `agent=${encodeURIComponent(href)}`)
        .join(",")
      filters.push(agentFilter)
    }
    if (filter.state) filters.push(`state=${encodeURIComponent(filter.state)}`)
    if (filter.createdFrom) filters.push(`moment>=${filter.createdFrom}`)
    if (filter.createdTo) filters.push(`moment<=${filter.createdTo}`)

    const params = new URLSearchParams()
    if (filters.length) params.set("filter", filters.join(";"))
    params.set("expand", "positions,demands,returns,payments,state,agent,organization.store,salesChannel")
    params.set("limit", String(filter.limit ?? 100))
    params.set("offset", String(filter.offset ?? 0))

    return this.client.request(`/entity/customerorder?${params.toString()}`, { method: "GET" })
  }

  /**
   * Создать отгрузку (demand) на основе customerorder.
   */
  createDemand(data: Record<string, unknown>): Promise<any> {
    return this.client.request("/entity/demand", {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  /**
   * Создать возврат продаж (salesreturn).
   */
  createSalesReturn(data: Record<string, unknown>): Promise<any> {
    return this.client.request("/entity/salesreturn", {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  /**
   * Сменить статус customerorder.
   */
  changeOrderState(orderHref: string, stateHref: string): Promise<any> {
    const id = this.extractUuid(orderHref)
    return this.client.request(`/entity/customerorder/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        state: {
          meta: {
            href: stateHref,
            type: "state",
            mediaType: "application/json",
          },
        },
      }),
    })
  }

  /**
   * Сменить статус отгрузки (demand).
   */
  changeDemandState(demandHref: string, stateHref: string): Promise<any> {
    const id = this.extractUuid(demandHref)
    return this.client.request(`/entity/demand/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        state: {
          meta: {
            href: stateHref,
            type: "state",
            mediaType: "application/json",
          },
        },
      }),
    })
  }

  /**
   * Очистить резервы позиций заказа (для отмены).
   */
  async clearOrderReserves(orderHref: string): Promise<void> {
    const id = this.extractUuid(orderHref)
    const positionsPath = `/entity/customerorder/${id}/positions`

    // Получаем текущие позиции
    const positions = await this.client.request<any>(positionsPath, { method: "GET" })
    if (!positions.rows?.length) return

    // Обнуляем reserve
    const updates = positions.rows.map((pos: any) => ({
      meta: pos.meta,
      reserve: 0,
    }))

    await this.client.request(positionsPath, {
      method: "POST",
      body: JSON.stringify(updates),
    })
  }

  /**
   * Получить список статусов сущности МС (metadata/states).
   *
   * @param entity — customerorder | demand.
   * @returns Массив статусов { id, name, meta }.
   */
  async listStates(entity: "customerorder" | "demand"): Promise<any[]> {
    const response = await this.client.request<any>(
      `/entity/${entity}/metadata/states?limit=100`,
      { method: "GET" }
    )
    return normalizeRows<any>(response)
  }

  /**
   * Получить позиции customerorder с expand=assortment.
   */
  async getOrderPositions(orderHref: string): Promise<any[]> {
    const id = this.extractUuid(orderHref)
    const path = `/entity/customerorder/${id}/positions?expand=assortment&limit=1000`
    const response = await this.client.request<any>(path, { method: "GET" })
    return response.rows ?? []
  }

  // ========================================
  // ВНУТРЕННИЕ МЕТОДЫ
  // ========================================

  /**
   * Извлечь UUID из href.
   */
  private extractUuid(hrefOrUuid: string): string {
    if (hrefOrUuid.includes("/")) {
      const parts = hrefOrUuid.split("/")
      return parts[parts.length - 1].split("?")[0]
    }
    return hrefOrUuid
  }
}
