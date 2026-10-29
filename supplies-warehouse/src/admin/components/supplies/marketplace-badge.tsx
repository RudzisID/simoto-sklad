/**
 * @file marketplace-badge.tsx
 * Бейдж площадки (WB/Ozon) для карточек заказов.
 *
 * Использует цвета из AGENTS.md:
 * - WB: фиолетовый (#6F01FB → #FF49D7)
 * - Ozon: синий (#005BFF)
 *
 * @module supplies-warehouse/admin/components/supplies/marketplace-badge
 */

import React from "react"

type Marketplace = "wb" | "ozon" | "unknown"

interface MarketplaceBadgeProps {
  marketplace: Marketplace
  size?: "sm" | "md"
}

const CONFIG: Record<Marketplace, { label: string; className: string }> = {
  wb: {
    label: "WB",
    className: "bg-violet-100 text-violet-800 border-violet-200",
  },
  ozon: {
    label: "Ozon",
    className: "bg-blue-100 text-blue-800 border-blue-200",
  },
  unknown: {
    label: "?",
    className: "bg-zinc-100 text-zinc-600 border-zinc-200",
  },
}

/**
 * Бейдж площадки маркетплейса.
 */
export function MarketplaceBadge({ marketplace, size = "sm" }: MarketplaceBadgeProps) {
  const config = CONFIG[marketplace] ?? CONFIG.unknown
  const sizeClass = size === "sm" ? "text-xs px-1.5 py-0.5" : "text-sm px-2 py-1"

  return (
    <span
      className={`inline-flex items-center rounded border font-medium ${config.className} ${sizeClass}`}
    >
      {config.label}
    </span>
  )
}
