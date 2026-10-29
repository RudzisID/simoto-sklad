/**
 * @file wb-cache.ts
 * Модель: WbCache — кэш данных Wildberries API.
 *
 * Хранит результаты запросов к WB API (sales, returns, orders, analytics)
 * в PostgreSQL с TTL через last_refreshed_at.
 *
 * @module supplies-warehouse/models/wb-cache
 */

import { model } from "@medusajs/framework/utils"

const WbCache = model.define("wb_cache", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),

  cache_type: model.text(), // "sales" | "returns" | "orders" | "analytics" | "stickers" | "prices"
  cache_key: model.text(), // уникальный ключ, например "sales:2026-10-28"
  data: model.json(),
  last_refreshed_at: model.dateTime(),
  ttl_minutes: model.number().default(120),
  source: model.text().default("api"), // "api" | "xlsx" | "manual"

  // Метаданные обновления
  records_count: model.number().default(0),
  error_message: model.text().nullable(),
})

export default WbCache
