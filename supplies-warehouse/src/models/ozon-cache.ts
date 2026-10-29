/**
 * @file ozon-cache.ts
 * Модель: OzonCache — кэш данных Ozon API.
 *
 * Хранит результаты запросов к Ozon API (returns, postings)
 * в PostgreSQL с TTL через last_refreshed_at.
 *
 * @module supplies-warehouse/models/ozon-cache
 */

import { model } from "@medusajs/framework/utils"

const OzonCache = model.define("ozon_cache", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),

  cache_type: model.text(), // "returns" | "postings" | "products"
  cache_key: model.text(),
  data: model.json(),
  last_refreshed_at: model.dateTime(),
  ttl_minutes: model.number().default(120),
  source: model.text().default("api"),

  // Метаданные
  records_count: model.number().default(0),
  error_message: model.text().nullable(),
})

export default OzonCache
