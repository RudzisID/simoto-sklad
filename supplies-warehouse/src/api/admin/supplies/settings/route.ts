/**
 * @file route.ts
 * GET  /admin/supplies/settings — настройки WB/Ozon (без секретов).
 * POST /admin/supplies/settings — сохранить настройки (токены шифруются).
 *
 * Body:
 * {
 *   wb?: { token?, ms_counterparty_href?, is_active?, cache_ttl_minutes?, sync_enabled? },
 *   ozon?: { client_id?, api_key?, ms_counterparty_href?, is_active?, cache_ttl_minutes?, sync_enabled? }
 * }
 *
 * @module supplies-warehouse/api/admin/supplies/settings
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getConfiguredTenantId } from "../../../../lib/tenant-context"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any

  const [wb] = await service.listWbConfigs({ tenant_id: tenantId })
  const [ozon] = await service.listOzonConfigs({ tenant_id: tenantId })

  res.json({
    wb: wb
      ? {
          configured: !!wb.token_encrypted,
          ms_counterparty_href: wb.ms_counterparty_href,
          is_active: wb.is_active,
          cache_ttl_minutes: wb.cache_ttl_minutes,
          sync_enabled: wb.sync_enabled,
        }
      : { configured: false },
    ozon: ozon
      ? {
          configured: !!ozon.credentials_encrypted,
          ms_counterparty_href: ozon.ms_counterparty_href,
          is_active: ozon.is_active,
          cache_ttl_minutes: ozon.cache_ttl_minutes,
          sync_enabled: ozon.sync_enabled,
        }
      : { configured: false },
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any
  const body = (req.body ?? {}) as {
    wb?: {
      token?: string
      ms_counterparty_href?: string
      is_active?: boolean
      cache_ttl_minutes?: number
      sync_enabled?: boolean
    }
    ozon?: {
      client_id?: string
      api_key?: string
      ms_counterparty_href?: string
      is_active?: boolean
      cache_ttl_minutes?: number
      sync_enabled?: boolean
      performance_enabled?: boolean
    }
  }

  await service.saveMarketplaceSettings(tenantId, body)
  res.json({ success: true })
}
