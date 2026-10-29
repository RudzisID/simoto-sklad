/**
 * @file progress-modal.tsx
 * Модальное окно прогресса сканирования.
 *
 * Прогресс-бар + статистика (processed/total, WB/Ozon).
 * Кнопка отмены.
 *
 * @module supplies-warehouse/admin/components/supplies/progress-modal
 */

import React from "react"
import type { ScanProgress } from "./types"

interface ProgressModalProps {
  isOpen: boolean
  progress: ScanProgress | null
  onClose: () => void
  onCancel: () => void
}

/**
 * Модальное окно прогресса.
 */
export function ProgressModal({ isOpen, progress, onClose, onCancel }: ProgressModalProps) {
  if (!isOpen || !progress) return null

  const percent = progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0

  const isRunning = progress.status === "running"
  const isCompleted = progress.status === "completed"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold mb-4">
          {isCompleted ? "✅ Сканирование завершено" : "🔄 Сканирование поставок"}
        </h3>

        {/* Progress bar */}
        <div className="w-full bg-zinc-200 rounded-full h-3 mb-3">
          <div
            className="bg-blue-600 h-3 rounded-full transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="text-sm text-zinc-600 mb-4">
          <div>Проверено {progress.processed} из {progress.total} заказов</div>
          <div className="text-xs text-zinc-500 mt-1">
            WB: {progress.wb} | Ozon: {progress.ozon}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          {isRunning && (
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-md border border-red-300 text-red-600 text-sm hover:bg-red-50"
            >
              Отменить
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-zinc-300 text-sm hover:bg-zinc-50"
          >
            {isCompleted ? "Закрыть" : "Свернуть"}
          </button>
        </div>
      </div>
    </div>
  )
}
