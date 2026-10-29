/**
 * @file order-detail-modal.tsx
 * Модальное окно деталей заказа.
 *
 * Информация о заказе, позиции, история.
 * Кнопки действий (отгрузить/оплатить/вернуть/отменить).
 *
 * @module supplies-warehouse/admin/components/supplies/order-detail-modal
 */

import React, { useState } from "react"
import { MarketplaceBadge } from "./marketplace-badge"
import { formatRubles, formatDateTime } from "./helpers"
import { useOrderDetail } from "./use-supplies-polling"
import type { SuppliesOrder } from "./types"

interface OrderDetailModalProps {
  orderId: string | null
  onClose: () => void
  onAction: (orderId: string, action: string) => void
}

/**
 * Модальное окно деталей заказа поставки.
 */
export function OrderDetailModal({ orderId, onClose, onAction }: OrderDetailModalProps) {
  const { data: order, isLoading, error } = useOrderDetail(orderId)

  if (!orderId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Заказ {order?.shipment_number ?? "..."}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-100 text-zinc-500"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {isLoading && (
            <div className="text-center text-zinc-500 py-8">Загрузка...</div>
          )}

          {error && (
            <div className="text-center text-red-600 py-8">
              Ошибка: {(error as Error).message}
            </div>
          )}

          {order && (
            <>
              {/* Основная информация */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <InfoRow label="Заказ МС" value={order.ms_order_name} />
                <InfoRow label="Сумма" value={formatRubles(order.order_sum)} />
                <InfoRow label="Оплачено" value={formatRubles(order.paid_sum)} />
                <InfoRow label="Отгружено" value={formatRubles(order.shipped_sum)} />
                <InfoRow label="Статус" value={order.lifecycle_status ?? order.status} />
                <InfoRow
                  label="Площадка"
                  value={<MarketplaceBadge marketplace={order.marketplace} />}
                />
                <InfoRow label="Дата" value={formatDateTime(order.ms_order_moment)} />
                <InfoRow
                  label="Проверен"
                  value={formatDateTime(order.last_checked_at)}
                />
              </div>

              {/* Позиции */}
              <h3 className="font-medium mb-2">Позиции</h3>
              <div className="border border-zinc-200 rounded-md overflow-hidden mb-6">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b border-zinc-200">
                    <tr>
                      <th className="text-left px-3 py-2">OEM</th>
                      <th className="text-left px-3 py-2">Наименование</th>
                      <th className="text-right px-3 py-2">Кол-во</th>
                      <th className="text-right px-3 py-2">Цена</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.positions?.map((pos, idx) => (
                      <tr key={idx} className="border-b border-zinc-100 last:border-0">
                        <td className="px-3 py-2 font-mono">{pos.code}</td>
                        <td className="px-3 py-2">{pos.name}</td>
                        <td className="px-3 py-2 text-right">{pos.quantity}</td>
                        <td className="px-3 py-2 text-right">{formatRubles(pos.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Кнопки действий */}
              <div className="flex gap-2">
                {order.can_demand && (
                  <button
                    onClick={() => onAction(order.id, "demand")}
                    className="px-4 py-2 rounded-md bg-sky-600 text-white text-sm hover:bg-sky-700"
                  >
                    📦 Отгрузить
                  </button>
                )}
                {order.can_payment && (
                  <button
                    onClick={() => onAction(order.id, "payment")}
                    className="px-4 py-2 rounded-md bg-violet-600 text-white text-sm hover:bg-violet-700"
                  >
                    💰 Оплатить
                  </button>
                )}
                {order.can_return && (
                  <button
                    onClick={() => onAction(order.id, "return")}
                    className="px-4 py-2 rounded-md bg-orange-600 text-white text-sm hover:bg-orange-700"
                  >
                    ↩️ Вернуть
                  </button>
                )}
                {order.can_cancel && (
                  <button
                    onClick={() => onAction(order.id, "cancel")}
                    className="px-4 py-2 rounded-md border border-red-300 text-red-600 text-sm hover:bg-red-50"
                  >
                    ✕ Отменить
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Строка информационной таблицы.
 */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-0.5">{label}</div>
      <div className="text-sm text-zinc-900">
        {value && value !== "—" ? value : <span className="text-zinc-400">—</span>}
      </div>
    </div>
  )
}
