/**
 * @file supplies-action.ts
 * Модель: SuppliesAction — история действий над заказами.
 *
 * Хранит каждый акт проверки, отгрузки, оплаты, возврата, отмены.
 *
 * @module supplies-warehouse/models/supplies-action
 */

import { model } from "@medusajs/framework/utils"

const SuppliesAction = model.define("supplies_action", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),

  // Связь с заказом
  order_id: model.text().searchable(), // FK → supplies_order.id

  // Тип действия
  action_type: model.text(), // "check" | "demand" | "payment" | "return" | "cancel" | "scan"
  status: model.text(), // "success" | "error" | "skipped"

  // Кто выполнил
  actor_medusa_user_id: model.text().nullable(),
  actor_name: model.text().nullable(),

  // Результат
  ms_response: model.json().nullable(),
  error_message: model.text().nullable(),

  // Снимок состояния до/после
  before_status: model.text().nullable(),
  after_status: model.text().nullable(),

  // Дополнительные данные
  metadata: model.json().nullable(),
})

export default SuppliesAction
