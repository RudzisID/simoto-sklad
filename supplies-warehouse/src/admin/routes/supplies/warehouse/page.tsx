/**
 * @file warehouse/page.tsx
 * Страница склада (остатки).
 *
 * Таблица остатков с фильтрами, экспорт XLSX.
 *
 * @route GET /app/warehouse
 */

import React, { useCallback, useState } from "react"
import { WarehouseStockTable } from "../../components/supplies/warehouse-stock-table"
import { useWarehouseStock } from "../../components/supplies/use-supplies-polling"

/**
 * Страница склада.
 */
export default function WarehousePage() {
  const [filters, setFilters] = useState<{
    storeId?: string
    oem?: string
    lowStock?: boolean
  }>({})

  const { data: stock, isLoading, refetch } = useWarehouseStock(filters.storeId, filters)

  const handleExport = useCallback(async () => {
    // TODO: fetch("/admin/supplies/warehouse/export", { ... })
    // downloadFile(data, "stock.xlsx")
  }, [])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Склад</h1>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          onClick={() => refetch()}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
        >
          🔄 Обновить
        </button>
        <button
          onClick={handleExport}
          className="px-3 py-2 rounded-md border border-zinc-300 text-sm hover:bg-zinc-50"
        >
          📥 Экспорт XLSX
        </button>

        {/* OEM поиск */}
        <input
          type="text"
          placeholder="Поиск по OEM..."
          value={filters.oem ?? ""}
          onChange={(e) => setFilters({ ...filters, oem: e.target.value || undefined })}
          className="px-3 py-2 rounded-md border border-zinc-300 text-sm"
        />

        {/* Малый остаток */}
        <button
          onClick={() => setFilters({ ...filters, lowStock: !filters.lowStock })}
          className={`px-3 py-2 rounded-md text-sm ${
            filters.lowStock
              ? "bg-amber-100 text-amber-800 border border-amber-300"
              : "border border-zinc-300 hover:bg-zinc-50"
          }`}
        >
          ⚠️ Малый остаток
        </button>
      </div>

      {/* Таблица */}
      <WarehouseStockTable items={stock ?? []} isLoading={isLoading} />
    </div>
  )
}
