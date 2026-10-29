/**
 * @file use-supplies-polling.ts
 * React Query hooks для polling данных supplies-warehouse.
 *
 * Замена SSE из текущего проекта — polling каждые 2-5 секунд.
 *
 * @module supplies-warehouse/admin/components/supplies/use-supplies-polling
 */

import { useQuery } from "@tanstack/react-query"
import type { KanbanFilters, ScanProgress, SuppliesOrder, WarehouseStockItem } from "./types"

const API_BASE = "/admin/supplies"

/**
 * Получить заказы для канбана с фильтрами.
 */
export function useKanbanOrders(filters: KanbanFilters = {}) {
  return useQuery({
    queryKey: ["supplies-orders", filters],
    queryFn: async (): Promise<SuppliesOrder[]> => {
      const params = new URLSearchParams()
      if (filters.marketplace) params.set("marketplace", filters.marketplace)
      if (filters.storeId) params.set("store_id", filters.storeId)
      if (filters.dateFrom) params.set("date_from", filters.dateFrom)
      if (filters.dateTo) params.set("date_to", filters.dateTo)

      const qs = params.toString()
      const response = await fetch(`${API_BASE}${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      })
      if (!response.ok) throw new Error("Ошибка загрузки заказов")
      const data = await response.json()
      return data.orders ?? []
    },
    refetchInterval: 5000, // polling каждые 5 секунд
    staleTime: 2000,
  })
}

/**
 * Получить прогресс сканирования.
 */
export function useScanProgress(enabled: boolean) {
  return useQuery({
    queryKey: ["supplies-scan-progress"],
    queryFn: async (): Promise<ScanProgress | null> => {
      const response = await fetch(`${API_BASE}/scan-progress`, {
        credentials: "include",
      })
      if (!response.ok) return null
      const data = await response.json()
      return data.status === "idle" ? null : data
    },
    refetchInterval: 1000, // каждую секунду во время сканирования
    enabled,
  })
}

/**
 * Получить детали заказа.
 */
export function useOrderDetail(orderId: string | null) {
  return useQuery({
    queryKey: ["supplies-order", orderId],
    queryFn: async (): Promise<SuppliesOrder> => {
      const response = await fetch(`${API_BASE}/${orderId}`, {
        credentials: "include",
      })
      if (!response.ok) throw new Error("Ошибка загрузки заказа")
      const data = await response.json()
      return data.order
    },
    enabled: !!orderId,
  })
}

/**
 * Получить остатки склада.
 */
export function useWarehouseStock(
  storeId?: string,
  filters?: { oem?: string; lowStock?: boolean }
) {
  return useQuery({
    queryKey: ["warehouse-stock", storeId, filters],
    queryFn: async (): Promise<WarehouseStockItem[]> => {
      const params = new URLSearchParams()
      if (storeId) params.set("store_id", storeId)
      if (filters?.oem) params.set("oem", filters.oem)
      if (filters?.lowStock) params.set("low_stock", "true")

      const response = await fetch(`${API_BASE}/warehouse?${params.toString()}`, {
        credentials: "include",
      })
      if (!response.ok) throw new Error("Ошибка загрузки остатков")
      const data = await response.json()
      return data.items ?? []
    },
    refetchInterval: 30000, // 30 секунд
  })
}
