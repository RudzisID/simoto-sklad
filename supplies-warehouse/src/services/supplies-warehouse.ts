/**
 * @file service.ts
 * SuppliesWarehouseService — основной сервис модуля supplies-warehouse.
 *
 * Управляет:
 * - Проверкой заказов (checkOrder)
 * - Созданием отгрузок, платежей, возвратов, отмен
 * - Сканированием новых заказов
 * - Батч-операциями
 * - Обновлением кэшей WB/Ozon
 *
 * @module supplies-warehouse/services/supplies-warehouse
 */

import { MedusaService, MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Redis from "ioredis"
import {
  SuppliesOrder,
  WbConfig,
  OzonConfig,
  WbCache,
  OzonCache,
  SuppliesAction,
  StatusMapping,
} from "../models"
import { MsHttp, getMsBaseUrl, normalizeRows } from "../utils/ms-http"
import { encrypt, decrypt } from "../../../modules/moysklad/utils/crypto"
import {
  calculateDecision,
  extractShipmentNum,
  detectMarketplace,
  type DecisionInput,
} from "../utils/decision-matrix"

// Redis client для realtime events и progress tracking (lazy, с фоллбеком в память)
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379"
let scanProgressRedis: Redis | null = null
let redisConnectAttempted = false

/** In-memory фоллбек прогресса, если Redis недоступен */
const progressMemory = new Map<string, { value: string; expiresAt: number }>()

const SCAN_PROGRESS_TTL = 30 * 60 // 30 минут

/**
 * Получить Redis-клиент (lazy connect).
 * Если Redis недоступен — возвращает null, работа идёт через память.
 */
async function getRedis(): Promise<Redis | null> {
  if (scanProgressRedis) return scanProgressRedis
  if (redisConnectAttempted) return null
  redisConnectAttempted = true
  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3000,
      retryStrategy: () => null,
    })
    client.on("error", () => {})
    await client.connect()
    scanProgressRedis = client
    return client
  } catch {
    return null
  }
}

export type ScanOptions = {
  storeId?: string
  marketplaces?: ("wb" | "ozon")[]
  dateFrom?: string
  dateTo?: string
}

export type KanbanFilters = {
  status?: string
  marketplace?: string
  storeId?: string
  dateFrom?: string
  dateTo?: string
}

export type WarehouseFilters = {
  storeId?: string
  brand?: string
  oem?: string
  lowStock?: boolean
}

/**
 * SuppliesWarehouseService — сервис управления поставками и складом.
 */
export class SuppliesWarehouseService extends MedusaService({
  SuppliesOrder,
  WbConfig,
  OzonConfig,
  WbCache,
  OzonCache,
  SuppliesAction,
  StatusMapping,
}) {
  /**
   * Доступ к MoySkladModuleService через awilix-cradle (`__container__`).
   * В Medusa v2 cradle — plain object, доступ по имени регистрации (не .resolve()).
   */
  private get moyskladService_(): any {
    const cradle = (this as any).__container__
    if (!cradle) return null
    return cradle["moysklad"] ?? cradle.moysklad ?? null
  }

  // ========================================
  // TOKEN MANAGEMENT (DI к moysklad module)
  // ========================================

  /**
   * Получить tenant-токен МС для сканирования/чтения.
   * Использует DI к moysklad module — как в workflow sync-order-to-moysklad.
   */
  private async getScanToken(tenantId: string): Promise<string> {
    if (!this.moyskladService_) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "MoySklad module не найден. Убедитесь, что moysklad module установлен."
      )
    }
    const token = await this.moyskladService_.getDecryptedToken(tenantId)
    if (!token) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `MoySklad токен не найден для tenant ${tenantId}`
      )
    }
    return token
  }

  /**
   * Получить user-токен МС для действий (demand, payment, return).
   */
  private async getActionToken(tenantId: string, userId: string): Promise<string> {
    if (!this.moyskladService_) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "MoySklad module не найден")
    }
    const token = await this.moyskladService_.getDecryptedUserToken(tenantId, userId)
    if (!token) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        `User токен МС не найден для user ${userId} tenant ${tenantId}`
      )
    }
    return token
  }

  /**
   * Получить WB токен из своей модели WbConfig.
   */
  private async getWbToken(tenantId: string): Promise<string | null> {
    const [config] = await this.listWbConfigs({ tenant_id: tenantId, is_active: true })
    if (!config?.token_encrypted) return null
    return decrypt(config.token_encrypted)
  }

  /**
   * Получить Ozon credentials из своей модели OzonConfig.
   */
  private async getOzonCredentials(tenantId: string): Promise<{ clientId: string; apiKey: string } | null> {
    const [config] = await this.listOzonConfigs({ tenant_id: tenantId, is_active: true })
    if (!config?.credentials_encrypted) return null
    try {
      const decrypted = decrypt(config.credentials_encrypted)
      const separator = decrypted.includes(":") ? ":" : "|"
      const [clientId, apiKey] = decrypted.split(separator)
      return { clientId, apiKey }
    } catch {
      return null
    }
  }

  // ========================================
  // STATUS MAPPING
  // ========================================

  /**
   * Получить href статуса МойСклад по ключу для тенанта.
   * UUID статусов уникальны для каждого аккаунта МС — хранятся в БД.
   *
   * @param tenantId — ID тенанта.
   * @param entity — сущность МС (customerorder | demand).
   * @param stateKey — ключ статуса (delayed, cancelled, return, ...).
   * @returns Полный href статуса.
   * @throws MedusaError, если маппинг не настроен.
   */
  async resolveStateHref(
    tenantId: string,
    entity: "customerorder" | "demand",
    stateKey: string
  ): Promise<string> {
    const [mapping] = await this.listStatusMappings({
      tenant_id: tenantId,
      entity,
      state_key: stateKey,
    })

    const raw = mapping?.state_href?.trim()
    if (!raw) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Не настроен статус МС "${entity}.${stateKey}" для tenant ${tenantId}. ` +
          `Добавьте запись в supplies_status_mapping.`
      )
    }

    // Если хранится UUID — достраиваем href
    if (raw.includes("/")) return raw
    return `${getMsBaseUrl()}/entity/${entity}/metadata/states/${raw}`
  }

  /**
   * Сохранить/обновить маппинг статуса.
   */
  async upsertStateMapping(
    tenantId: string,
    entity: "customerorder" | "demand",
    stateKey: string,
    stateHref: string,
    stateName?: string
  ): Promise<any> {
    const [existing] = await this.listStatusMappings({
      tenant_id: tenantId,
      entity,
      state_key: stateKey,
    })
    if (existing) {
      return this.updateStatusMappings({
        id: existing.id,
        state_href: stateHref,
        state_name: stateName ?? existing.state_name,
      })
    }
    return this.createStatusMappings({
      tenant_id: tenantId,
      entity,
      state_key: stateKey,
      state_href: stateHref,
      state_name: stateName ?? null,
    })
  }

  /**
   * Получить все маппинги статусов тенанта.
   */
  async listStateMappings(tenantId: string): Promise<any[]> {
    return this.listStatusMappings({ tenant_id: tenantId })
  }

  // ========================================
  // ORDER CHECK
  // ========================================

  /**
   * Проверить заказ по номеру отправления.
   *
   * 1. Найти customerorder в МС
   * 2. Получить полные данные
   * 3. Определить площадку
   * 4. Проверить WB/Ozon кэши
   * 5. Рассчитать матрицу решений
   * 6. Сохранить результат
   */
  async checkOrder(
    tenantId: string,
    shipmentNum: string,
    userId: string
  ): Promise<any> {
    const token = await this.getScanToken(tenantId)
    const ms = new MsHttp(token)

    // Получить hrefs контрагентов WB/Ozon для фильтрации
    const wbConfig = await this.listWbConfigs({ tenant_id: tenantId, is_active: true })
    const ozonConfig = await this.listOzonConfigs({ tenant_id: tenantId, is_active: true })
    const counterpartyHrefs = [
      ...(wbConfig[0]?.ms_counterparty_href ? [wbConfig[0].ms_counterparty_href] : []),
      ...(ozonConfig[0]?.ms_counterparty_href ? [ozonConfig[0].ms_counterparty_href] : []),
    ]

    // Найти заказ
    const order = await ms.findOrderByShipmentNum(shipmentNum, { counterpartyHrefs })
    if (!order) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Заказ с номером отправления "${shipmentNum}" не найден`
      )
    }

    // Сохранить результат
    const result = await this.checkOrderInternal(tenantId, order.meta.href)

    // Записать действие
    await this.createSuppliesActions([{
      tenant_id: tenantId,
      order_id: result.id,
      action_type: "check",
      status: "success",
      actor_medusa_user_id: userId,
      after_status: result.status,
    }])

    return result
  }

  /**
   * Проверить заказ по MS href (внутренняя операция).
   */
  async checkOrderInternal(tenantId: string, orderHref: string): Promise<any> {
    const token = await this.getScanToken(tenantId)
    const ms = new MsHttp(token)

    // Полные данные заказа
    const order = await ms.getCustomerOrder(orderHref)
    const finance = await ms.getCustomerOrderFinance(orderHref)

    // Извлечь данные
    const shipmentNum = extractShipmentNum(order.description) ?? order.name
    const marketplace = detectMarketplace(order.agent?.name, order.description)
    const stateHref = order.state?.meta?.href ?? null
    const stateName = order.state?.name ?? null

    // Проверить наличие операций (нормализация: MS отдаёт массив или { rows })
    const demands = normalizeRows<any>(order.demands)
    const returns = normalizeRows<any>(order.returns)

    // Платежи НЕ хранятся в customerorder — получаем из первой отгрузки
    let payments: any[] = []
    if (demands[0]?.meta?.href) {
      try {
        const demandFull = await ms.getDemand(demands[0].meta.href)
        payments = normalizeRows<any>(demandFull.payments)
      } catch {
        payments = []
      }
    }

    const hasDemand = demands.length > 0
    const hasReturn = returns.length > 0
    const hasPayment = payments.length > 0

    // Проверить WB/Ozon кэши на возврат
    const wbReturn = await this.findInMarketplaceCaches(tenantId, shipmentNum, "wb_return")
    const ozonReturn = await this.findInMarketplaceCaches(tenantId, shipmentNum, "ozon_return")

    // Проверить резервы
    const positions = normalizeRows<any>(order.positions)
    const hasReserves = positions.some((p: any) => (p.reserve ?? 0) > 0)

    // Рассчитать матрицу решений
    const decision = calculateDecision({
      orderStateHref: stateHref,
      orderStateName: stateName,
      hasDemand,
      hasReturn,
      hasPayment,
      orderSum: finance.sum,
      paidSum: finance.paid_sum,
      shippedSum: finance.shipped_sum,
      wbReturnDetected: !!wbReturn,
      ozonReturnDetected: !!ozonReturn,
      hasReserves,
    })

    // Сохранить/обновить SuppliesOrder
    const existing = await this.listSuppliesOrders({
      tenant_id: tenantId,
      ms_order_href: orderHref,
    })

    const orderData = {
      tenant_id: tenantId,
      ms_order_href: orderHref,
      ms_order_name: order.name,
      ms_order_moment: order.moment ?? null,
      shipment_number: shipmentNum,
      marketplace,
      order_sum: finance.sum,
      paid_sum: finance.paid_sum,
      shipped_sum: finance.shipped_sum,
      status: decision.status,
      lifecycle_status: stateName,
      can_demand: decision.canDemand,
      can_payment: decision.canPayment,
      can_return: decision.canReturn,
      can_cancel: decision.canCancel,
      demand_href: hasDemand ? demands[0].meta.href : null,
      payment_href: hasPayment ? payments[0].meta.href : null,
      return_href: hasReturn ? returns[0].meta.href : null,
      positions: positions.map((p: any) => ({
        assortment_href: p.assortment?.meta?.href,
        code: p.assortment?.code,
        name: p.assortment?.name,
        quantity: p.quantity,
        price: p.price ? p.price / 100 : 0,
        reserve: p.reserve ?? 0,
      })),
      last_checked_at: new Date(),
      scan_data: {
        wb_return: wbReturn,
        ozon_return: ozonReturn,
        reason: decision.reason,
      },
    }

    if (existing[0]) {
      return this.updateSuppliesOrders({ id: existing[0].id, ...orderData })
    }
    return this.createSuppliesOrders(orderData)
  }

  // ========================================
  // ACTIONS (user-токен)
  // ========================================

  /**
   * Создать отгрузку (demand).
   */
  async createDemand(tenantId: string, orderId: string, userId: string): Promise<any> {
    const token = await this.getActionToken(tenantId, userId)
    const ms = new MsHttp(token)

    // Получить заказ
    const [order] = await this.listSuppliesOrders({ id: orderId, tenant_id: tenantId })
    if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ не найден")
    if (!order.can_demand) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Отгрузка невозможна")

    // Получить полные данные заказа из МС
    const msOrder = await ms.getCustomerOrder(order.ms_order_href)
    if (normalizeRows(msOrder.demands).length) {
      throw new Error("Отгрузка уже существует")
    }

    // Создать demand
    const positions = normalizeRows<any>(msOrder.positions).map((p: any) => ({
      quantity: p.quantity,
      price: p.price,
      discount: p.discount ?? 0,
      vat: p.vat,
      vatEnabled: p.vatEnabled,
      assortment: { meta: p.assortment.meta },
    }))

    const demand = await ms.createDemand({
      customerOrder: { meta: msOrder.meta },
      agent: { meta: msOrder.agent.meta },
      organization: { meta: msOrder.organization.meta },
      store: { meta: msOrder.store.meta },
      salesChannel: msOrder.salesChannel ? { meta: msOrder.salesChannel.meta } : null,
      positions,
    })

    // Сменить статус заказа на DELAYED
    const delayedHref = await this.resolveStateHref(tenantId, "customerorder", "delayed")
    await ms.changeOrderState(order.ms_order_href, delayedHref)

    // Обновить SuppliesOrder
    const updated = await this.updateSuppliesOrders({
      id: orderId,
      status: "shipped",
      demand_href: demand.meta.href,
      can_demand: false,
      can_payment: true,
      can_cancel: false,
      last_action: "demand",
      last_action_at: new Date(),
      last_action_by: userId,
    })

    // Записать действие
    await this.createSuppliesActions([{
      tenant_id: tenantId,
      order_id: orderId,
      action_type: "demand",
      status: "success",
      actor_medusa_user_id: userId,
      before_status: order.status,
      after_status: "shipped",
      ms_response: { demand_href: demand.meta.href },
    }])

    return updated
  }

  /**
   * Создать входящий платёж.
   */
  async createPayment(tenantId: string, orderId: string, userId: string): Promise<any> {
    const token = await this.getActionToken(tenantId, userId)
    const ms = new MsHttp(token)

    const [order] = await this.listSuppliesOrders({ id: orderId, tenant_id: tenantId })
    if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ не найден")
    if (!order.can_payment) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Оплата невозможна")

    // Получить demand
    const msOrder = await ms.getCustomerOrder(order.ms_order_href)
    const demand = normalizeRows<any>(msOrder.demands)[0]
    if (!demand) throw new Error("Отгрузка не найдена")

    // Проверить существование платежа (payments живут в demand, не в getOperation)
    const demandFull = await ms.getDemand(demand.meta.href)
    if (normalizeRows(demandFull.payments).length) {
      throw new Error("Платёж уже существует")
    }

    // Сумма к оплате = order_sum - paid_sum
    const amountToPay = order.order_sum - order.paid_sum
    if (amountToPay <= 0) throw new Error("Нечего оплачивать")

    // Создать paymentin
    const payment = await ms.createPaymentIn({
      sum: Math.round(amountToPay * 100), // копейки
      agent: { meta: msOrder.agent.meta },
      organization: { meta: msOrder.organization.meta },
      operations: [{
        meta: demand.meta,
        linkedSum: Math.round(amountToPay * 100),
      }],
      applicable: true,
      description: `Оплата заказа ${order.ms_order_name}`,
    })

    // Обновить
    const newPaidSum = order.order_sum // полностью оплачен
    const updated = await this.updateSuppliesOrders({
      id: orderId,
      paid_sum: newPaidSum,
      status: "paid",
      payment_href: payment.meta.href,
      can_payment: false,
      last_action: "payment",
      last_action_at: new Date(),
      last_action_by: userId,
    })

    await this.createSuppliesActions([{
      tenant_id: tenantId,
      order_id: orderId,
      action_type: "payment",
      status: "success",
      actor_medusa_user_id: userId,
      before_status: order.status,
      after_status: "paid",
      ms_response: { payment_href: payment.meta.href },
    }])

    return updated
  }

  /**
   * Создать возврат продаж.
   */
  async createReturn(
    tenantId: string,
    orderId: string,
    userId: string,
    selectedOfferIds?: string[]
  ): Promise<any> {
    const token = await this.getActionToken(tenantId, userId)
    const ms = new MsHttp(token)

    const [order] = await this.listSuppliesOrders({ id: orderId, tenant_id: tenantId })
    if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ не найден")
    if (!order.can_return) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Возврат невозможен")

    // Получить demand
    const msOrder = await ms.getCustomerOrder(order.ms_order_href)
    const demand = normalizeRows<any>(msOrder.demands)[0]
    if (!demand) throw new Error("Отгрузка не найдена")

    // Получить полные данные demand с позициями
    const demandFull = await ms.getDemand(demand.meta.href)

    // Проверить, что возврат ещё не создан
    if (normalizeRows(demandFull.returns).length || normalizeRows(msOrder.returns).length) {
      throw new Error("Возврат уже создан")
    }

    // Позиции для возврата
    const demandPositions = normalizeRows<any>(demandFull.positions)
    let positionsToReturn = demandPositions
    if (selectedOfferIds?.length) {
      positionsToReturn = demandPositions.filter((p: any) => {
        const code = p.assortment?.code ?? p.assortment?.name ?? ""
        return selectedOfferIds.includes(code)
      })
    }

    // Создать salesreturn
    const salesReturn = await ms.createSalesReturn({
      demand: { meta: demand.meta },
      agent: { meta: msOrder.agent.meta },
      organization: { meta: msOrder.organization.meta },
      store: { meta: msOrder.store.meta },
      salesChannel: msOrder.salesChannel ? { meta: msOrder.salesChannel.meta } : null,
      positions: positionsToReturn.map((p: any) => ({
        quantity: p.quantity,
        price: p.price,
        vat: p.vat,
        vatEnabled: p.vatEnabled,
        assortment: { meta: p.assortment.meta },
      })),
    })

    // Сменить статус заказа на RETURN
    const returnHref = await this.resolveStateHref(tenantId, "customerorder", "return")
    await ms.changeOrderState(order.ms_order_href, returnHref)

    // Сменить статус demand на CANCELLED
    const demandCancelledHref = await this.resolveStateHref(tenantId, "demand", "cancelled")
    await ms.changeDemandState(demand.meta.href, demandCancelledHref)

    const updated = await this.updateSuppliesOrders({
      id: orderId,
      status: "returned",
      return_href: salesReturn.meta.href,
      can_return: false,
      last_action: "return",
      last_action_at: new Date(),
      last_action_by: userId,
    })

    await this.createSuppliesActions([{
      tenant_id: tenantId,
      order_id: orderId,
      action_type: "return",
      status: "success",
      actor_medusa_user_id: userId,
      before_status: order.status,
      after_status: "returned",
      ms_response: { return_href: salesReturn.meta.href },
    }])

    return updated
  }

  /**
   * Отменить заказ.
   */
  async cancelOrder(tenantId: string, orderId: string, userId: string): Promise<any> {
    const token = await this.getActionToken(tenantId, userId)
    const ms = new MsHttp(token)

    const [order] = await this.listSuppliesOrders({ id: orderId, tenant_id: tenantId })
    if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ не найден")
    if (!order.can_cancel) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Отмена невозможна")

    // Проверить отсутствие отгрузки
    const msOrder = await ms.getCustomerOrder(order.ms_order_href)
    if (normalizeRows(msOrder.demands).length) {
      throw new Error("Нельзя отменить — отгрузка уже создана. Используйте возврат.")
    }

    // Очистить резервы
    await ms.clearOrderReserves(order.ms_order_href)

    // Сменить статус на CANCELLED
    const cancelledHref = await this.resolveStateHref(tenantId, "customerorder", "cancelled")
    await ms.changeOrderState(order.ms_order_href, cancelledHref)

    const updated = await this.updateSuppliesOrders({
      id: orderId,
      status: "cancelled",
      can_demand: false,
      can_payment: false,
      can_return: false,
      can_cancel: false,
      last_action: "cancel",
      last_action_at: new Date(),
      last_action_by: userId,
    })

    await this.createSuppliesActions([{
      tenant_id: tenantId,
      order_id: orderId,
      action_type: "cancel",
      status: "success",
      actor_medusa_user_id: userId,
      before_status: order.status,
      after_status: "cancelled",
    }])

    return updated
  }

  // ========================================
  // BATCH OPERATIONS
  // ========================================

  /**
   * Batch-обработка заказов с прогрессом через Redis.
   */
  async processBatch(
    tenantId: string,
    orderIds: string[],
    action: "demand" | "payment" | "return" | "cancel",
    userId: string,
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ success: string[]; failed: { id: string; error: string }[] }> {
    const results: { success: string[]; failed: { id: string; error: string }[] } = {
      success: [],
      failed: [],
    }

    // Инициализировать прогресс
    await this.setScanProgress(tenantId, {
      type: "batch",
      processed: 0,
      total: orderIds.length,
      status: "running",
    })

    // Обработка с concurrency = 3
    const concurrency = 3
    let processed = 0

    const queue = [...orderIds]
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const orderId = queue.shift()!
        try {
          switch (action) {
            case "demand":
              await this.createDemand(tenantId, orderId, userId)
              break
            case "payment":
              await this.createPayment(tenantId, orderId, userId)
              break
            case "return":
              await this.createReturn(tenantId, orderId, userId)
              break
            case "cancel":
              await this.cancelOrder(tenantId, orderId, userId)
              break
          }
          results.success.push(orderId)
        } catch (err: any) {
          results.failed.push({ id: orderId, error: err.message })
        }

        processed++
        await this.setScanProgress(tenantId, {
          type: "batch",
          processed,
          total: orderIds.length,
          status: "running",
        })
        onProgress?.(processed, orderIds.length)

        // Проверить abort
        const progress = await this.getScanProgress(tenantId)
        if (progress?.status === "cancelled") {
          break
        }
      }
    })

    await Promise.all(workers)

    // Завершить прогресс
    await this.setScanProgress(tenantId, {
      type: "batch",
      processed: orderIds.length,
      total: orderIds.length,
      status: "completed",
    })

    return results
  }

  // ========================================
  // SUPPLIES SCAN
  // ========================================

  /**
   * Сканировать новые заказы из МС для WB/Ozon.
   */
  async scanNewOrders(
    tenantId: string,
    options: ScanOptions,
    userId: string
  ): Promise<{ scanned: number; new: number; updated: number }> {
    const token = await this.getScanToken(tenantId)
    const ms = new MsHttp(token)

    // Получить hrefs контрагентов
    const wbConfig = await this.listWbConfigs({ tenant_id: tenantId, is_active: true })
    const ozonConfig = await this.listOzonConfigs({ tenant_id: tenantId, is_active: true })

    let counterpartyHrefs: string[] = []
    if (!options.marketplaces || options.marketplaces.includes("wb")) {
      if (wbConfig[0]?.ms_counterparty_href) counterpartyHrefs.push(wbConfig[0].ms_counterparty_href)
    }
    if (!options.marketplaces || options.marketplaces.includes("ozon")) {
      if (ozonConfig[0]?.ms_counterparty_href) counterpartyHrefs.push(ozonConfig[0].ms_counterparty_href)
    }

    if (!counterpartyHrefs.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Не настроены контрагенты WB/Ozon. Добавьте в настройках."
      )
    }

    // Даты по умолчанию — последние 14 дней
    const dateFrom = options.dateFrom ?? new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 19).replace("T", " ")
    const dateTo = options.dateTo ?? new Date().toISOString().slice(0, 19).replace("T", " ")

    // Инициализировать прогресс
    await this.setScanProgress(tenantId, {
      type: "scan",
      processed: 0,
      total: 0,
      status: "running",
    })

    let scanned = 0
    let newOrders = 0
    let updated = 0
    let offset = 0
    const limit = 100

    while (true) {
      // Проверить abort
      const progress = await this.getScanProgress(tenantId)
      if (progress?.status === "cancelled") break

      // Запрос к МС
      const response = await ms.listCustomerOrders({
        counterpartyHrefs,
        createdFrom: dateFrom,
        createdTo: dateTo,
        limit,
        offset,
      })

      const rows = normalizeRows<any>(response)
      if (!rows.length) break

      // Обновить total в прогрессе
      await this.setScanProgress(tenantId, {
        type: "scan",
        processed: scanned,
        total: response.meta?.size ?? rows.length,
        status: "running",
      })

      // Обработать каждый заказ
      for (const order of rows) {
        // Проверить abort
        const progress = await this.getScanProgress(tenantId)
        if (progress?.status === "cancelled") break

        const shipmentNum = extractShipmentNum(order.description)
        if (!shipmentNum) {
          // Пропустить заказы без номера отправления
          scanned++
          continue
        }

        const result = await this.checkOrderInternal(tenantId, order.meta.href)

        const existing = await this.listSuppliesOrders({
          tenant_id: tenantId,
          ms_order_href: order.meta.href,
        })
        if (existing[0]) {
          updated++
        } else {
          newOrders++
        }

        scanned++
        await this.setScanProgress(tenantId, {
          type: "scan",
          processed: scanned,
          total: response.meta?.size ?? scanned,
          status: "running",
        })
      }

      offset += limit
      if (offset >= (response.meta?.size ?? scanned)) break
    }

    // Завершить прогресс
    await this.setScanProgress(tenantId, {
      type: "scan",
      processed: scanned,
      total: scanned,
      status: "completed",
    })

    // Записать действие
    await this.createSuppliesActions([{
      tenant_id: tenantId,
      order_id: "batch",
      action_type: "scan",
      status: "success",
      actor_medusa_user_id: userId,
      metadata: { scanned, new: newOrders, updated },
    }])

    return { scanned, new: newOrders, updated }
  }

  // ========================================
  // CACHE MANAGEMENT
  // ========================================

  /**
   * Найти в WB/Ozon кэшах по номеру отправления.
   */
  async findInMarketplaceCaches(
    tenantId: string,
    shipmentNum: string,
    cacheType: string
  ): Promise<any | null> {
    if (cacheType.startsWith("wb_")) {
      const type = cacheType.replace("wb_", "")
      const caches = await this.listWbCaches({
        tenant_id: tenantId,
        cache_type: type,
      })
      // Поиск в data по shipmentNum
      for (const cache of caches) {
        if (this.searchInCacheData(cache.data, shipmentNum)) {
          return cache.data
        }
      }
    } else if (cacheType.startsWith("ozon_")) {
      const type = cacheType.replace("ozon_", "")
      const caches = await this.listOzonCaches({
        tenant_id: tenantId,
        cache_type: type,
      })
      for (const cache of caches) {
        if (this.searchInCacheData(cache.data, shipmentNum)) {
          return cache.data
        }
      }
    }
    return null
  }

  private searchInCacheData(data: any, shipmentNum: string): boolean {
    if (!data) return false
    const json = JSON.stringify(data)
    return json.includes(shipmentNum)
  }

  // ========================================
  // KANBAN
  // ========================================

  /**
   * Получить заказы для канбана с фильтрами.
   */
  async getOrdersForKanban(tenantId: string, filters: KanbanFilters): Promise<any[]> {
    const conditions: Record<string, unknown> = { tenant_id: tenantId }
    if (filters.status) conditions.status = filters.status
    if (filters.marketplace) conditions.marketplace = filters.marketplace
    if (filters.dateFrom) conditions.ms_order_moment = { $gte: new Date(filters.dateFrom) }
    if (filters.dateTo) conditions.ms_order_moment = { ...((conditions.ms_order_moment as any) || {}), $lte: new Date(filters.dateTo) }

    return this.listSuppliesOrders(conditions)
  }

  /**
   * Обновить статус заказа (для drag-and-drop).
   */
  async updateOrderStatus(
    tenantId: string,
    orderId: string,
    newStatus: string,
    userId: string
  ): Promise<any> {
    const [order] = await this.listSuppliesOrders({ id: orderId, tenant_id: tenantId })
    if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ не найден")

    const updated = await this.updateSuppliesOrders({
      id: orderId,
      status: newStatus,
      last_action: "status_change",
      last_action_at: new Date(),
      last_action_by: userId,
    })

    await this.createSuppliesActions([{
      tenant_id: tenantId,
      order_id: orderId,
      action_type: "status_change",
      status: "success",
      actor_medusa_user_id: userId,
      before_status: order.status,
      after_status: newStatus,
    }])

    return updated
  }

  // ========================================
  // WAREHOUSE
  // ========================================

  /**
   * Получить остатки склада.
   */
  async getWarehouseStock(
    tenantId: string,
    storeId?: string,
    filters?: WarehouseFilters
  ): Promise<any[]> {
    const token = await this.getScanToken(tenantId)
    const ms = new MsHttp(token)

    let stockRows: any[]
    if (storeId) {
      const stores = await ms.listStores()
      const store = stores.find((s: any) => s.id === storeId)
      if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Склад не найден")
      stockRows = await ms.getStockByStore(store.meta.href)
    } else {
      stockRows = await ms.getStock()
    }

    // Фильтрация
    let result = stockRows
    if (filters?.lowStock) {
      result = result.filter((r: any) => (r.stock ?? 0) < 5)
    }
    if (filters?.oem) {
      const oemLower = filters.oem.toLowerCase()
      result = result.filter((r: any) =>
        r.assortment?.code?.toLowerCase().includes(oemLower) ||
        r.assortment?.article?.toLowerCase().includes(oemLower)
      )
    }

    return result.map((r: any) => ({
      assortment_href: r.assortment?.meta?.href ?? r.meta?.href,
      name: r.assortment?.name ?? r.name ?? "",
      code: r.assortment?.code ?? r.code ?? "",
      article: r.assortment?.article ?? r.article ?? null,
      stock: r.stock ?? r.quantity ?? 0,
      reserve: r.reserve ?? 0,
      inTransit: r.inTransit ?? 0,
      price: r.price ? (typeof r.price === "object" ? r.price.value : r.price) / 100 : null,
      salePrice: r.salePrice ? (typeof r.salePrice === "object" ? r.salePrice.value : r.salePrice) / 100 : null,
    }))
  }

  // ========================================
  // REDIS PROGRESS
  // ========================================

  /**
   * Публичный прогресс сканирования для API.
   */
  async getScanStatus(tenantId: string): Promise<any> {
    return this.getScanProgress(tenantId)
  }

  /**
   * Отменить текущее сканирование.
   */
  async cancelScan(tenantId: string): Promise<void> {
    const current = (await this.getScanProgress(tenantId)) ?? {}
    await this.setScanProgress(tenantId, {
      ...current,
      status: "cancelled",
      type: current.type ?? "scan",
    })
  }

  /**
   * Принудительно обновить кэши WB/Ozon.
   *
   * @param tenantId — ID тенанта.
   * @param marketplace — "wb" | "ozon" | "all".
   */
  async refreshMarketplaceCaches(
    tenantId: string,
    marketplace: "wb" | "ozon" | "all" = "all"
  ): Promise<void> {
    if (marketplace === "wb" || marketplace === "all") {
      const token = await this.getWbToken(tenantId)
      if (!token) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, "WB токен не настроен")
      }
      const { WbClient } = await import("../utils/wb-client")
      const client = new WbClient(token)
      const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const orders = await client.fetchOrders(dateFrom)
      await this.createWbCaches({
        tenant_id: tenantId,
        cache_type: "orders",
        cache_key: `orders:${new Date().toISOString().slice(0, 10)}`,
        data: orders,
        last_refreshed_at: new Date(),
        records_count: orders.length,
      })
    }

    if (marketplace === "ozon" || marketplace === "all") {
      const creds = await this.getOzonCredentials(tenantId)
      if (!creds) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, "Ozon креды не настроены")
      }
      const { OzonClient } = await import("../utils/ozon-client")
      const client = new OzonClient(creds.clientId, creds.apiKey)
      const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const returns = await client.fetchReturns(dateFrom)
      await this.createOzonCaches({
        tenant_id: tenantId,
        cache_type: "returns",
        cache_key: `returns:${new Date().toISOString().slice(0, 10)}`,
        data: returns,
        last_refreshed_at: new Date(),
        records_count: returns.length,
      })
    }
  }

  /**
   * Сохранить настройки маркетплейсов (шифрует секреты).
   */
  async saveMarketplaceSettings(
    tenantId: string,
    body: {
      wb?: {
        token?: string
        ms_counterparty_href?: string
        is_active?: boolean
        cache_ttl_minutes?: number
        sync_enabled?: boolean
      }
      ozon?: {
        client_id?: string
        api_key?: string
        ms_counterparty_href?: string
        is_active?: boolean
        cache_ttl_minutes?: number
        sync_enabled?: boolean
        performance_enabled?: boolean
      }
    }
  ): Promise<void> {
    if (body.wb) {
      const [existing] = await this.listWbConfigs({ tenant_id: tenantId })
      const payload: Record<string, unknown> = {
        tenant_id: tenantId,
        is_active: body.wb.is_active ?? existing?.is_active ?? true,
        cache_ttl_minutes: body.wb.cache_ttl_minutes ?? existing?.cache_ttl_minutes ?? 120,
        sync_enabled: body.wb.sync_enabled ?? existing?.sync_enabled ?? true,
      }
      if (body.wb.ms_counterparty_href !== undefined) {
        payload.ms_counterparty_href = body.wb.ms_counterparty_href
      }
      if (body.wb.token) {
        payload.token_encrypted = encrypt(body.wb.token)
      }
      if (existing) {
        await this.updateWbConfigs({ id: existing.id, ...payload })
      } else if (payload.token_encrypted) {
        await this.createWbConfigs(payload)
      }
    }

    if (body.ozon) {
      const [existing] = await this.listOzonConfigs({ tenant_id: tenantId })
      const payload: Record<string, unknown> = {
        tenant_id: tenantId,
        is_active: body.ozon.is_active ?? existing?.is_active ?? true,
        cache_ttl_minutes: body.ozon.cache_ttl_minutes ?? existing?.cache_ttl_minutes ?? 120,
        sync_enabled: body.ozon.sync_enabled ?? existing?.sync_enabled ?? true,
        performance_enabled: body.ozon.performance_enabled ?? existing?.performance_enabled ?? false,
      }
      if (body.ozon.ms_counterparty_href !== undefined) {
        payload.ms_counterparty_href = body.ozon.ms_counterparty_href
      }
      if (body.ozon.client_id && body.ozon.api_key) {
        payload.credentials_encrypted = encrypt(`${body.ozon.client_id}:${body.ozon.api_key}`)
      }
      if (existing) {
        await this.updateOzonConfigs({ id: existing.id, ...payload })
      } else if (payload.credentials_encrypted) {
        await this.createOzonConfigs(payload)
      }
    }
  }

  /**
   * Получить доступные статусы сущности МС (для настройки маппинга).
   */
  async discoverMsStates(
    tenantId: string,
    entity: "customerorder" | "demand"
  ): Promise<Array<{ id: string; name: string; href: string }>> {
    const token = await this.getScanToken(tenantId)
    const ms = new MsHttp(token)
    const rows = await ms.listStates(entity)
    return rows.map((state: any) => ({
      id: state.id,
      name: state.name,
      href: state.meta?.href ?? `${getMsBaseUrl()}/entity/${entity}/metadata/states/${state.id}`,
    }))
  }

  private async getScanProgress(tenantId: string): Promise<any> {
    const key = `supplies:scan:${tenantId}:progress`
    try {
      const redis = await getRedis()
      if (redis) {
        const data = await redis.get(key)
        return data ? JSON.parse(data) : null
      }
    } catch {
      // fallthrough to memory
    }
    const mem = progressMemory.get(key)
    if (!mem) return null
    if (mem.expiresAt < Date.now()) {
      progressMemory.delete(key)
      return null
    }
    return JSON.parse(mem.value)
  }

  private async setScanProgress(tenantId: string, progress: any): Promise<void> {
    const key = `supplies:scan:${tenantId}:progress`
    const value = JSON.stringify(progress)
    try {
      const redis = await getRedis()
      if (redis) {
        await redis.set(key, value, "EX", SCAN_PROGRESS_TTL)
        return
      }
    } catch {
      // fallthrough to memory
    }
    progressMemory.set(key, { value, expiresAt: Date.now() + SCAN_PROGRESS_TTL * 1000 })
  }
}

export default SuppliesWarehouseService
