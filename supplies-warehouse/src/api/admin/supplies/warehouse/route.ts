/**
 * @file route.ts
 * GET /admin/supplies/warehouse — остатки склада.
 *
 * Query: store_id, oem, low_stock
 *
 * @module supplies-warehouse/api/admin/supplies/warehouse
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getConfiguredTenantId } from "../../../../lib/tenant-context"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any

  const q = req.query as Record<string, string | undefined>
  const items = await service.getWarehouseStock(tenantId, q.store_id, {
    oem: q.oem,
    lowStock: q.low_stock === "true",
  })

  res.json({ items, count: items.length })
}
