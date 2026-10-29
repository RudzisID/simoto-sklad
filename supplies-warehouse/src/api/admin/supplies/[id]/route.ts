/**
 * @file route.ts
 * GET /admin/supplies/:id — детали заказа поставки.
 *
 * @module supplies-warehouse/api/admin/supplies/[id]
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getConfiguredTenantId } from "../../../../lib/tenant-context"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any
  const id = req.params.id

  const [order] = await service.listSuppliesOrders({ id, tenant_id: tenantId })
  if (!order) {
    res.status(404).json({ message: "Заказ не найден" })
    return
  }

  res.json({ order })
}
