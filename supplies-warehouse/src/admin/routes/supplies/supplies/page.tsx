/**
 * @file supplies/supplies/page.tsx
 * Страница канбана поставок.
 *
 * Основная страница модуля: канбан с колонками статусов,
 * панель действий, модалы деталей и прогресса.
 *
 * @route GET /app/supplies
 */

import React, { useCallback, useMemo, useState } from "react"
import {
  KanbanBoard,
  groupOrdersByColumn,
} from "../../../components/supplies/kanban-board"
import { ActionToolbar } from "../../../components/supplies/action-toolbar"
import { OrderDetailModal } from "../../../components/supplies/order-detail-modal"
import { ProgressModal } from "../../../components/supplies/progress-modal"
import { useKanbanOrders, useScanProgress } from "../../../components/supplies/use-supplies-polling"
import type { KanbanFilters, SuppliesOrder } from "../../../components/supplies/types"

/**
 * Страница канбана поставок.
 */
export default function SuppliesKanbanPage() {
  const [filters, setFilters] = useState<KanbanFilters>({})
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [showProgress, setShowProgress] = useState(false)
  const [isScanning, setIsScanning] = useState(false)

  // Polling заказов
  const { data: orders, isLoading, refetch } = useKanbanOrders(filters)

  // Polling прогресса сканирования
  const { data: progress } = useScanProgress(isScanning || showProgress)

  // Группировка по колонкам
  const columns = useMemo(() => {
    return groupOrdersByColumn(orders ?? [], [
      { id: "new", title: "Новые", color: "zinc" },
      { id: "checking", title: "Проверяется", color: "amber" },
      { id: "can_ship", title: "К отгрузке", color: "sky" },
      { id: "shipped", title: "Отгружено", color: "indigo" },
      { id: "can_pay", title: "К оплате", color: "violet" },
      { id: "paid", title: "Оплачено", color: "emerald" },
      { id: "can_return", title: "К возврату", color: "orange" },
      { id: "returned", title: "Возвращено", color: "red" },
      { id: "cancelled", title: "Отменён", color: "zinc" },
      { id: "delayed", title: "Отложено", color: "amber" },
    ])
  }, [orders])

  // Запуск сканирования
  const handleScan = useCallback(async () => {
    setIsScanning(true)
    setShowProgress(true)
    // TODO: вызов API сканирования
    // await fetch("/admin/supplies/scan", { method: "POST", body: JSON.stringify(filters) })
  }, [filters])

  // Действие над заказом
  const handleAction = useCallback(async (orderId: string, action: string) => {
    // TODO: вызов API действия
    // await fetch(`/admin/supplies/${orderId}/${action}`, { method: "POST" })
    refetch()
  }, [refetch])

  // Обновление WB кэша
  const handleRefreshWb = useCallback(async () => {
    // TODO: fetch("/admin/supplies/wb-cache/refresh", { method: "POST" })
  }, [])

  // Обновление Ozon кэша
  const handleRefreshOzon = useCallback(async () => {
    // TODO: fetch("/admin/supplies/ozon-cache/refresh", { method: "POST" })
  }, [])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Поставки</h1>

      {/* Action Toolbar */}
      <ActionToolbar
        filters={filters}
        onFiltersChange={setFilters}
        onScan={handleScan}
        onRefreshWb={handleRefreshWb}
        onRefreshOzon={handleRefreshOzon}
        isScanning={isScanning}
      />

      {/* Kanban Board */}
      {isLoading ? (
        <div className="text-center text-zinc-500 py-12">Загрузка заказов...</div>
      ) : (
        <KanbanBoard
          columns={columns}
          onViewOrder={setSelectedOrderId}
          onAction={handleAction}
        />
      )}

      {/* Order Detail Modal */}
      <OrderDetailModal
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        onAction={handleAction}
      />

      {/* Progress Modal */}
      <ProgressModal
        isOpen={showProgress}
        progress={progress ?? null}
        onClose={() => setShowProgress(false)}
        onCancel={() => {
          setIsScanning(false)
          // TODO: fetch("/admin/supplies/scan-cancel", { method: "POST" })
        }}
      />
    </div>
  )
}
