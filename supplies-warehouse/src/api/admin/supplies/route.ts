/**
 * @file route.ts
 * GET /admin/supplies — список заказов поставок (для таблицы/канбана).
 *
 * Query: status, marketplace, store_id, date_from, date_to, limit, offset
 *
 * @module supplies-warehouse/api/admin/supplies
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getConfiguredTenantId } from "../../../../lib/tenant-context"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any

  const q = req.query as Record<string, string | undefined>
  const orders = await service.getOrdersForKanban(tenantId, {
    status: q.status,
    marketplace: q.marketplace,
    storeId: q.store_id,
    dateFrom: q.date_from,
    dateTo: q.date_to,
  })

  res.json({ orders, count: orders.length })
}
