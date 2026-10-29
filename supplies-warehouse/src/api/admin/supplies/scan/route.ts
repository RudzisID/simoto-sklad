/**
 * @file route.ts
 * POST /admin/supplies/scan — запустить сканирование новых заказов МС.
 *
 * Body: { store_id?, marketplaces?: ("wb"|"ozon")[], date_from?, date_to? }
 *
 * @module supplies-warehouse/api/admin/supplies/scan
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getConfiguredTenantId } from "../../../../lib/tenant-context"

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any

  const body = (req.body ?? {}) as {
    store_id?: string
    marketplaces?: ("wb" | "ozon")[]
    date_from?: string
    date_to?: string
  }

  // Fire-and-forget: прогресс доступен через /admin/supplies/scan-progress
  void service
    .scanNewOrders(tenantId, {
      storeId: body.store_id,
      marketplaces: body.marketplaces,
      dateFrom: body.date_from,
      dateTo: body.date_to,
    })
    .catch((err: Error) => {
      console.error("[supplies-warehouse] scan failed:", err.message)
    })

  res.status(202).json({ status: "started" })
}
