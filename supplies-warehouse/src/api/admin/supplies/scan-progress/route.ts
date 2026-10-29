/**
 * @file route.ts
 * GET /admin/supplies/scan-progress — прогресс сканирования.
 * POST /admin/supplies/scan-progress — отменить сканирование (body: { cancel: true }).
 *
 * @module supplies-warehouse/api/admin/supplies/scan-progress
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getConfiguredTenantId } from "../../../../lib/tenant-context"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any

  const progress = await service.getScanStatus(tenantId)
  res.json(progress ?? { status: "idle" })
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any
  const body = (req.body ?? {}) as { cancel?: boolean }

  if (body.cancel) {
    await service.cancelScan(tenantId)
  }

  const progress = await service.getScanStatus(tenantId)
  res.json(progress ?? { status: "idle" })
}
