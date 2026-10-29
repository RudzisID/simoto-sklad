/**
 * @file index.ts
 * Определение модуля supplies-warehouse.
 *
 * Модуль управления поставками и складом через МойСклад, WB, Ozon.
 *
 * Использование в simoto_main:
 * 1. Скопировать директорию supplies-warehouse в apps/backend/src/modules/
 * 2. Добавить в medusa-config.ts: { resolve: "./src/modules/supplies-warehouse" }
 * 3. Запустить: npx medusa db:generate supplies-warehouse && npx medusa db:migrate
 *
 * @module supplies-warehouse
 */

import SuppliesWarehouseService from "./src/services/supplies-warehouse"
import { Module } from "@medusajs/framework/utils"

export const SUPPLIES_WAREHOUSE_MODULE = "suppliesWarehouse"

export default Module(SUPPLIES_WAREHOUSE_MODULE, {
  service: SuppliesWarehouseService,
})
