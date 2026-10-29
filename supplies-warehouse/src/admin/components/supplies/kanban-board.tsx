/**
 * @file kanban-board.tsx
 * Канбан-доска для заказов поставок.
 *
 * 10 колонок (статусов) с горизонтальным scroll.
 * Drag-and-drop между колонками (смена статуса).
 *
 * @module supplies-warehouse/admin/components/supplies/kanban-board
 */

import React, { useCallback } from "react"
import { KanbanColumn } from "./kanban-column"
import type { KanbanColumn as KanbanColumnType } from "./types"

interface KanbanBoardProps {
  columns: KanbanColumnType[]
  onViewOrder: (orderId: string) => void
  onAction: (orderId: string, action: string) => void
}

/**
 * Колонки канбана (порядок и цвета).
 */
export const KANBAN_COLUMNS = [
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
] as const

/**
 * Канбан-доска поставок.
 */
export function KanbanBoard({ columns, onViewOrder, onAction }: KanbanBoardProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => (
        <KanbanColumn
          key={col.id}
          column={col}
          onViewOrder={onViewOrder}
          onAction={onAction}
        />
      ))}
    </div>
  )
}

/**
 * Группировка заказов по колонкам.
 */
export function groupOrdersByColumn(
  orders: Array<{ status: string }>,
  columns: typeof KANBAN_COLUMNS
): KanbanColumnType[] {
  return columns.map((col) => ({
    ...col,
    orders: orders.filter((o) => o.status === col.id) as any,
  }))
}
