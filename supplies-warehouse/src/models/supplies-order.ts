/**
 * @file supplies-order.ts
 * Модель: SuppliesOrder — заказ поставки из маркетплейса (WB/Ozon).
 *
 * Хранит кэшированные данные customerorder из МойСклад + результаты проверки.
 *
 * @module supplies-warehouse/models/supplies-order
 */

import { model } from "@medusajs/framework/utils"

/**
 * Статусы заказа (колонки канбана).
 */
export const SUPPLIES_ORDER_STATUS = {
  NEW: "new",
  CHECKING: "checking",
  CAN_SHIP: "can_ship",
  SHIPPED: "shipped",
  CAN_PAY: "can_pay",
  PAID: "paid",
  CAN_RETURN: "can_return",
  RETURNED: "returned",
  CANCELLED: "cancelled",
  DELAYED: "delayed",
} as const

export type SuppliesOrderStatus = typeof SUPPLIES_ORDER_STATUS[keyof typeof SUPPLIES_ORDER_STATUS]

const SuppliesOrder = model.define("supplies_order", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),

  // === Данные из МойСклад ===
  ms_order_href: model.text(),
  ms_order_name: model.text().nullable(),
  ms_order_moment: model.dateTime().nullable(),

  // === Извлечённые данные ===
  shipment_number: model.text().searchable(),
  marketplace: model.text(), // "wb" | "ozon" | "unknown"
  order_sum: model.number().default(0), // рубли
  paid_sum: model.number().default(0), // рубли
  shipped_sum: model.number().default(0), // рубли

  // === Статус (колонка канбана) ===
  status: model.text().default(SUPPLIES_ORDER_STATUS.NEW),
  lifecycle_status: model.text().nullable(), // имя статуса из МС

  // === Матрица решений ===
  can_demand: model.boolean().default(false),
  can_payment: model.boolean().default(false),
  can_return: model.boolean().default(false),
  can_cancel: model.boolean().default(false),

  // === Relations (href операции в МС) ===
  demand_href: model.text().nullable(),
  payment_href: model.text().nullable(),
  return_href: model.text().nullable(),

  // === Позиции ===
  positions: model.json().nullable(),

  // === Metadata ===
  last_checked_at: model.dateTime().nullable(),
  last_action: model.text().nullable(),
  last_action_at: model.dateTime().nullable(),
  last_action_by: model.text().nullable(),

  // === Данные из WB/Ozon кэшей ===
  scan_data: model.json().nullable(),
})

export default SuppliesOrder
