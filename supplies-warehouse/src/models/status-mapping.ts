/**
 * @file status-mapping.ts
 * Маппинг ключей статусов МойСклад на UUID конкретного тенанта.
 *
 * UUID статусов customerorder/demand уникальны для каждого аккаунта МойСклад,
 * поэтому хранятся в БД (а не в process.env).
 *
 * @module supplies-warehouse/models/status-mapping
 */

import { model } from "@medusajs/framework/utils"

/**
 * Маппинг статуса МойСклад.
 * Уникален по (tenant_id, entity, state_key).
 */
export const StatusMapping = model.define("supplies_status_mapping", {
  id: model.id().primaryKey(),

  /** ID тенанта */
  tenant_id: model.text().index(),

  /** Сущность МС: customerorder | demand */
  entity: model.text(),

  /** Ключ статуса: new|delayed|shipped|cancelled|return|partial_cancel|on_payment */
  state_key: model.text(),

  /** UUID статуса в МС */
  state_href: model.text(),

  /** Человекочитаемое имя статуса (для отладки) */
  state_name: model.text().nullable(),
})

export default StatusMapping

/** Допустимые ключи статусов customerorder */
export const CUSTOMER_ORDER_STATE_KEYS = [
  "new",
  "delayed",
  "shipped",
  "cancelled",
  "return",
  "partial_cancel",
] as const

/** Допустимые ключи статусов demand */
export const DEMAND_STATE_KEYS = ["on_payment", "cancelled"] as const

export type CustomerOrderStateKey = (typeof CUSTOMER_ORDER_STATE_KEYS)[number]
export type DemandStateKey = (typeof DEMAND_STATE_KEYS)[number]
