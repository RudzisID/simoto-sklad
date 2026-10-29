/**
 * @file kanban-card.tsx
 * Карточка заказа в колонке канбана.
 *
 * Отображает: номер отправления, сумму, площадку, дату, позицию.
 * Контекстное меню с действиями (просмотр/отгрузить/оплатить/вернуть/отменить).
 *
 * @module supplies-warehouse/admin/components/supplies/kanban-card
 */

import React, { useState } from "react"
import { MarketplaceBadge } from "./marketplace-badge"
import { formatRubles, formatDate } from "./helpers"
import type { SuppliesOrder } from "./types"

interface KanbanCardProps {
  order: SuppliesOrder
  onView: (orderId: string) => void
  onAction: (orderId: string, action: string) => void
}

/**
 * Карточка заказа поставки.
 */
export function KanbanCard({ order, onView, onAction }: KanbanCardProps) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="bg-white rounded-md shadow-sm border border-zinc-200 p-3 hover:shadow-md transition-shadow group">
      {/* Заголовок */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {order.thumbnail_url && (
            <img
              src={order.thumbnail_url}
              alt=""
              className="w-8 h-8 rounded object-cover flex-shrink-0"
            />
          )}
          <span className="font-mono text-sm font-medium text-zinc-900">
            {order.shipment_number}
          </span>
        </div>

        {/* Context menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded hover:bg-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ⋯
          </button>

          {showMenu && (
            <div className="absolute right-0 top-6 z-10 w-40 bg-white border border-zinc-200 rounded-md shadow-lg">
              <button
                onClick={() => { onView(order.id); setShowMenu(false) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50"
              >
                👁️ Просмотр
              </button>
              {order.can_demand && (
                <button
                  onClick={() => { onAction(order.id, "demand"); setShowMenu(false) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50"
                >
                  📦 Отгрузить
                </button>
              )}
              {order.can_payment && (
                <button
                  onClick={() => { onAction(order.id, "payment"); setShowMenu(false) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50"
                >
                  💰 Оплатить
                </button>
              )}
              {order.can_return && (
                <button
                  onClick={() => { onAction(order.id, "return"); setShowMenu(false) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50"
                >
                  ↩️ Вернуть
                </button>
              )}
              {order.can_cancel && (
                <button
                  onClick={() => { onAction(order.id, "cancel"); setShowMenu(false) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 text-red-600"
                >
                  ✕ Отменить
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Сумма и позиции */}
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="font-medium text-zinc-900">{formatRubles(order.order_sum)}</span>
        <span className="text-zinc-500">
          {order.positions?.length ?? 0} поз.
        </span>
      </div>

      {/* Площадка и дата */}
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <MarketplaceBadge marketplace={order.marketplace} size="sm" />
        <span>{formatDate(order.ms_order_moment)}</span>
      </div>

      {/* Quick action buttons (visible on hover) */}
      <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {order.can_demand && (
          <button
            onClick={() => onAction(order.id, "demand")}
            className="flex-1 text-xs py-1 px-2 rounded bg-sky-50 text-sky-700 hover:bg-sky-100"
            title="Отгрузить"
          >
            📦
          </button>
        )}
        {order.can_payment && (
          <button
            onClick={() => onAction(order.id, "payment")}
            className="flex-1 text-xs py-1 px-2 rounded bg-violet-50 text-violet-700 hover:bg-violet-100"
            title="Оплатить"
          >
            💰
          </button>
        )}
        {order.can_return && (
          <button
            onClick={() => onAction(order.id, "return")}
            className="flex-1 text-xs py-1 px-2 rounded bg-orange-50 text-orange-700 hover:bg-orange-100"
            title="Вернуть"
          >
            ↩️
          </button>
        )}
      </div>
    </div>
  )
}
