/**
 * @file route.ts
 * POST /admin/supplies/refresh — принудительно обновить кэши WB/Ozon.
 *
 * Body: { marketplace: "wb" | "ozon" | "all" }
 *
 * @module supplies-warehouse/api/admin/supplies/refresh
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getConfiguredTenantId } from "../../../../lib/tenant-context"

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any
  const body = (req.body ?? {}) as { marketplace?: "wb" | "ozon" | "all" }
  const marketplace = body.marketplace ?? "all"

  try {
    await service.refreshMarketplaceCaches(tenantId, marketplace)
    res.json({ success: true, marketplace })
  } catch (err: any) {
    res.status(400).json({ success: false, message: err?.message ?? "Ошибка обновления кэша" })
  }
}
