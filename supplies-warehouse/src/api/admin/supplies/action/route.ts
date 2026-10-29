/**
 * @file route.ts
 * POST /admin/supplies/action — выполнить действие над заказом.
 *
 * Body: { order_id, action: "demand"|"payment"|"return"|"cancel", selected_offer_ids?: string[] }
 *
 * Действия выполняются user-токеном МС (ms_user_token) текущего админа.
 *
 * @module supplies-warehouse/api/admin/supplies/action
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getConfiguredTenantId } from "../../../../lib/tenant-context"

type ActionType = "demand" | "payment" | "return" | "cancel"

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const tenantId = getConfiguredTenantId()
  const service = req.scope.resolve("suppliesWarehouse") as any

  const authContext = (req as any).auth_context as { actor_id?: string } | undefined
  const userId = authContext?.actor_id
  if (!userId) {
    res.status(401).json({ message: "Не удалось определить пользователя" })
    return
  }

  const body = (req.body ?? {}) as {
    order_id?: string
    action?: ActionType
    selected_offer_ids?: string[]
  }

  if (!body.order_id || !body.action) {
    res.status(400).json({ message: "order_id и action обязательны" })
    return
  }

  try {
    let result: unknown
    switch (body.action) {
      case "demand":
        result = await service.createDemand(tenantId, body.order_id, userId)
        break
      case "payment":
        result = await service.createPayment(tenantId, body.order_id, userId)
        break
      case "return":
        result = await service.createReturn(tenantId, body.order_id, userId, body.selected_offer_ids)
        break
      case "cancel":
        result = await service.cancelOrder(tenantId, body.order_id, userId)
        break
      default:
        res.status(400).json({ message: `Неизвестное действие: ${body.action}` })
        return
    }

    res.json({ success: true, result })
  } catch (err: any) {
    res.status(400).json({ success: false, message: err?.message ?? "Ошибка выполнения действия" })
  }
}
