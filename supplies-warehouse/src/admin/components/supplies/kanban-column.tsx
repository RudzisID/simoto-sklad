/**
 * @file kanban-column.tsx
 * Колонка канбана с заказами.
 *
 * Заголовок: название + количество.
 * Тело: список карточек заказов.
 *
 * @module supplies-warehouse/admin/components/supplies/kanban-column
 */

import React from "react"
import { KanbanCard } from "./kanban-card"
import { getColumnColorClass } from "./helpers"
import type { KanbanColumn as KanbanColumnType, SuppliesOrder } from "./types"

interface KanbanColumnProps {
  column: KanbanColumnType
  onViewOrder: (orderId: string) => void
  onAction: (orderId: string, action: string) => void
}

/**
 * Колонка канбана.
 */
export function KanbanColumn({ column, onViewOrder, onAction }: KanbanColumnProps) {
  return (
    <div className="flex-shrink-0 w-72 rounded-lg border border-zinc-200 bg-zinc-50 flex flex-col">
      {/* Заголовок */}
      <div className="p-3 border-b border-zinc-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${getColumnColorClass(column.color)}`} />
          <span className="font-medium text-sm text-zinc-900">{column.title}</span>
          <span className="text-xs text-zinc-500">({column.orders.length})</span>
        </div>
      </div>

      {/* Список карточек */}
      <div className="p-2 space-y-2 overflow-y-auto flex-1 max-h-[calc(100vh-220px)]">
        {column.orders.length === 0 ? (
          <div className="text-center text-xs text-zinc-400 py-4">
            Нет заказов
          </div>
        ) : (
          column.orders.map((order) => (
            <KanbanCard
              key={order.id}
              order={order}
              onView={onViewOrder}
              onAction={onAction}
            />
          ))
        )}
      </div>
    </div>
  )
}
