/**
 * @file types.ts
 * TypeScript типы для UI-компонентов supplies-warehouse.
 *
 * @module supplies-warehouse/admin/components/supplies/types
 */

/**
 * Статус заказа поставки (колонка канбана).
 */
export type SuppliesOrderStatus =
  | "new"
  | "checking"
  | "can_ship"
  | "shipped"
  | "can_pay"
  | "paid"
  | "can_return"
  | "returned"
  | "cancelled"
  | "delayed"

/**
 * Площадка маркетплейса.
 */
export type Marketplace = "wb" | "ozon" | "unknown"

/**
 * Заказ поставки для отображения в канбане.
 */
export interface SuppliesOrder {
  id: string
  tenant_id: string
  ms_order_href: string
  ms_order_name: string | null
  ms_order_moment: string | null
  shipment_number: string
  marketplace: Marketplace
  order_sum: number
  paid_sum: number
  shipped_sum: number
  status: SuppliesOrderStatus
  lifecycle_status: string | null
  can_demand: boolean
  can_payment: boolean
  can_return: boolean
  can_cancel: boolean
  demand_href: string | null
  payment_href: string | null
  return_href: string | null
  positions: SuppliesPosition[] | null
  last_checked_at: string | null
  last_action: string | null
  last_action_at: string | null
  last_action_by: string | null
  thumbnail_url?: string | null
}

/**
 * Позиция заказа.
 */
export interface SuppliesPosition {
  assortment_href: string
  code: string
  name: string
  quantity: number
  price: number
  reserve?: number
}

/**
 * Колонка канбана.
 */
export interface KanbanColumn {
  id: SuppliesOrderStatus
  title: string
  color: string
  orders: SuppliesOrder[]
}

/**
 * Фильтры канбана.
 */
export interface KanbanFilters {
  marketplace?: Marketplace
  storeId?: string
  dateFrom?: string
  dateTo?: string
}

/**
 * Прогресс сканирования.
 */
export interface ScanProgress {
  processed: number
  total: number
  wb: number
  ozon: number
  status: "idle" | "running" | "completed" | "cancelled"
  type?: string
}

/**
 * Остаток склада.
 */
export interface WarehouseStockItem {
  assortment_href: string
  name: string
  code: string
  article: string | null
  stock: number
  reserve: number
  in_transit: number
  price: number | null
  sale_price: number | null
}
