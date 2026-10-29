/**
 * @file route.ts
 * GET  /admin/supplies/status-mapping — маппинги статусов МС для тенанта.
 * GET  /admin/supplies/status-mapping?discover=1 — список доступных статусов из МС.
 * POST /admin/supplies/status-mapping — сохранить маппинг.
 *
 * Body: { entity, state_key, state_href, state_name? }
 *
 * @module supplies-warehouse/api/admin/supplies/status-mapping
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getConfiguredTenantId } from "../../../../lib/tenant-context"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any
  const q = req.query as Record<string, string | undefined>

  if (q.discover === "1") {
    const states = await service.discoverMsStates(tenantId, q.entity === "demand" ? "demand" : "customerorder")
    res.json({ states })
    return
  }

  const mappings = await service.listStateMappings(tenantId)
  res.json({ mappings })
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any
  const body = (req.body ?? {}) as {
    entity?: "customerorder" | "demand"
    state_key?: string
    state_href?: string
    state_name?: string
  }

  if (!body.entity || !body.state_key || !body.state_href) {
    res.status(400).json({ message: "entity, state_key и state_href обязательны" })
    return
  }

  const mapping = await service.upsertStateMapping(
    tenantId,
    body.entity,
    body.state_key,
    body.state_href,
    body.state_name
  )
  res.json({ mapping })
}
