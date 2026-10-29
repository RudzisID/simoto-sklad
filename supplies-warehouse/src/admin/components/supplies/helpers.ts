/**
 * @file helpers.ts
 * Вспомогательные функции для UI supplies-warehouse.
 *
 * @module supplies-warehouse/admin/components/supplies/helpers
 */

/**
 * Форматировать сумму в рублях.
 */
export function formatRubles(amount: number | null | undefined): string {
  if (amount == null) return "—"
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Форматировать дату.
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "—"
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    })
  } catch {
    return "—"
  }
}

/**
 * Форматировать дату и время.
 */
export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "—"
  try {
    const date = new Date(dateString)
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return "—"
  }
}

/**
 * CSS-класс цвета колонки канбана.
 */
export function getColumnColorClass(color: string): string {
  const colors: Record<string, string> = {
    zinc: "bg-zinc-500",
    amber: "bg-amber-500",
    sky: "bg-sky-500",
    indigo: "bg-indigo-500",
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    orange: "bg-orange-500",
    red: "bg-red-500",
  }
  return colors[color] ?? "bg-zinc-500"
}

/**
 * CSS-класса для остатка (color-coded).
 */
export function getStockColorClass(stock: number): string {
  if (stock === 0) return "text-red-600 font-bold bg-red-50"
  if (stock < 5) return "text-amber-600 bg-amber-50"
  return ""
}
