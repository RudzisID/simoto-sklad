/**
 * @file wb-config.ts
 * Модель: WbConfig — настройки Wildberries API для тенанта.
 *
 * Изолированная модель — не расширяет moysklad_config.
 * Хранит зашифрованный WB API token.
 *
 * @module supplies-warehouse/models/wb-config
 */

import { model } from "@medusajs/framework/utils"

const WbConfig = model.define("wb_config", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),

  // Зашифрованный WB Supplier API token
  token_encrypted: model.text().nullable(),

  // Идентификатор контрагента WB в МС (для фильтрации заказов)
  ms_counterparty_href: model.text().nullable(),

  is_active: model.boolean().default(false),

  // Параметры синхронизации
  cache_ttl_minutes: model.number().default(120),
  sync_enabled: model.boolean().default(true),
})

export default WbConfig
