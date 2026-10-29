/**
 * @file ozon-config.ts
 * Модель: OzonConfig — настройки Ozon API для тенанта.
 *
 * Изолированная модель — не расширяет moysklad_config.
 * Хранит зашифрованные Ozon credentials (clientId:apiKey).
 *
 * @module supplies-warehouse/models/ozon-config
 */

import { model } from "@medusajs/framework/utils"

const OzonConfig = model.define("ozon_config", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),

  // Зашифрованные credentials в формате "clientId:apiKey"
  credentials_encrypted: model.text().nullable(),

  // Идентификатор контрагента Ozon в МС (для фильтрации заказов)
  ms_counterparty_href: model.text().nullable(),

  is_active: model.boolean().default(false),

  // Параметры синхронизации
  cache_ttl_minutes: model.number().default(120),
  sync_enabled: model.boolean().default(true),

  // Performance API settings (для больших аккаунтов)
  performance_enabled: model.boolean().default(false),
})

export default OzonConfig
