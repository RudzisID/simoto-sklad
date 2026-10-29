/**
 * @file action-toolbar.tsx
 * Панель действий над канбаном.
 *
 * Кнопки: Сканировать, WB кэш, Ozon кэш, Фильтры.
 *
 * @module supplies-warehouse/admin/components/supplies/action-toolbar
 */

import React from "react"
import type { KanbanFilters, Marketplace } from "./types"

interface ActionToolbarProps {
  filters: KanbanFilters
  onFiltersChange: (filters: KanbanFilters) => void
  onScan: () => void
  onRefreshWb: () => void
  onRefreshOzon: () => void
  isScanning: boolean
}

/**
 * Панель действий канбана.
 */
export function ActionToolbar({
  filters,
  onFiltersChange,
  onScan,
  onRefreshWb,
  onRefreshOzon,
  isScanning,
}: ActionToolbarProps) {
  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      {/* Сканировать */}
      <button
        onClick={onScan}
        disabled={isScanning}
        className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {isScanning ? "⏳ Сканирую..." : "🔄 Сканировать"}
      </button>

      {/* Обновление кэшей */}
      <button
        onClick={onRefreshWb}
        className="px-3 py-2 rounded-md border border-zinc-300 text-sm hover:bg-zinc-50"
      >
        🔄 WB кэш
      </button>
      <button
        onClick={onRefreshOzon}
        className="px-3 py-2 rounded-md border border-zinc-300 text-sm hover:bg-zinc-50"
      >
        🔄 Ozon кэш
      </button>

      {/* Разделитель */}
      <div className="w-px h-6 bg-zinc-200" />

      {/* Фильтр площадки */}
      <select
        value={filters.marketplace ?? ""}
        onChange={(e) =>
          onFiltersChange({
            ...filters,
            marketplace: (e.target.value || undefined) as Marketplace | undefined,
          })
        }
        className="px-3 py-2 rounded-md border border-zinc-300 text-sm"
      >
        <option value="">Все площадки</option>
        <option value="wb">Wildberries</option>
        <option value="ozon">Ozon</option>
      </select>

      {/* Даты */}
      <input
        type="date"
        value={filters.dateFrom ?? ""}
        onChange={(e) => onFiltersChange({ ...filters, dateFrom: e.target.value || undefined })}
        className="px-3 py-2 rounded-md border border-zinc-300 text-sm"
        title="Дата от"
      />
      <input
        type="date"
        value={filters.dateTo ?? ""}
        onChange={(e) => onFiltersChange({ ...filters, dateTo: e.target.value || undefined })}
        className="px-3 py-2 rounded-md border border-zinc-300 text-sm"
        title="Дата до"
      />
    </div>
  )
}
