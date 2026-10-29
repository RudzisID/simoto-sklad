/**
 * @file warehouse-stock-table.tsx
 * Таблица остатков склада.
 *
 * OEM, наименование, остаток, резерв, в пути, цена.
 * Цветовая индикация: красный (0), жёлтый (<5).
 *
 * @module supplies-warehouse/admin/components/supplies/warehouse-stock-table
 */

import React from "react"
import { formatRubles, getStockColorClass } from "./helpers"
import type { WarehouseStockItem } from "./types"

interface WarehouseStockTableProps {
  items: WarehouseStockItem[]
  isLoading: boolean
}

/**
 * Таблица остатков склада.
 */
export function WarehouseStockTable({ items, isLoading }: WarehouseStockTableProps) {
  if (isLoading) {
    return <div className="text-center text-zinc-500 py-8">Загрузка остатков...</div>
  }

  if (!items.length) {
    return <div className="text-center text-zinc-400 py-8">Нет данных</div>
  }

  return (
    <div className="border border-zinc-200 rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr>
            <th className="text-left px-3 py-2 font-medium">OEM</th>
            <th className="text-left px-3 py-2 font-medium">Наименование</th>
            <th className="text-left px-3 py-2 font-medium">Бренд</th>
            <th className="text-right px-3 py-2 font-medium">Остаток</th>
            <th className="text-right px-3 py-2 font-medium">Резерв</th>
            <th className="text-right px-3 py-2 font-medium">В пути</th>
            <th className="text-right px-3 py-2 font-medium">Цена</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
              <td className="px-3 py-2 font-mono">{item.code}</td>
              <td className="px-3 py-2">{item.name}</td>
              <td className="px-3 py-2 text-zinc-500">{item.article ?? "—"}</td>
              <td className={`px-3 py-2 text-right ${getStockColorClass(item.stock)}`}>
                {item.stock}
              </td>
              <td className="px-3 py-2 text-right">{item.reserve || "—"}</td>
              <td className="px-3 py-2 text-right">{item.in_transit || "—"}</td>
              <td className="px-3 py-2 text-right">{formatRubles(item.sale_price ?? item.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
