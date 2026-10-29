/**
 * @file decision-matrix.ts
 * Матрица решений для заказов поставок.
 *
 * Определяет доступные действия (canDemand, canPayment, canReturn, canCancel)
 * на основе данных customerorder из МойСклад и WB/Ozon кэшей.
 *
 * Портированная логика из lib/check.js и lib/supplies.js SiMOTO-sklad.
 *
 * @module supplies-warehouse/utils/decision-matrix
 */

import { SUPPLIES_ORDER_STATUS, type SuppliesOrderStatus } from "../models/supplies-order"

/**
 * UUID статусов customerorder в МойСклад (берётся из config/statuses.json или переменных окружения).
 * Эти значения специфичны для каждого аккаунта МС.
 */
export const CUSTOMER_ORDER_STATES = {
  NEW: process.env.MS_STATE_NEW ?? "",
  DELAYED: process.env.MS_STATE_DELAYED ?? "",
  SHIPPED: process.env.MS_STATE_SHIPPED ?? "",
  CANCELLED: process.env.MS_STATE_CANCELLED ?? "",
  RETURN: process.env.MS_STATE_RETURN ?? "",
  PARTIAL_CANCEL: process.env.MS_STATE_PARTIAL_CANCEL ?? "",
}

/**
 * UUID статусов demand в МойСклад.
 */
export const DEMAND_STATES = {
  ON_PAYMENT: process.env.MS_DEMAND_ON_PAYMENT ?? "",
  CANCELLED: process.env.MS_DEMAND_CANCELLED ?? "",
}

/**
 * Входные данные для расчёта матрицы решений.
 */
export interface DecisionInput {
  // Статус заказа в МС
  orderStateHref: string | null
  orderStateName: string | null

  // Наличие операций
  hasDemand: boolean
  hasReturn: boolean
  hasPayment: boolean

  // Финансы (рубли)
  orderSum: number
  paidSum: number
  shippedSum: number

  // Данные из кэшей маркетплейсов
  wbReturnDetected: boolean
  ozonReturnDetected: boolean

  // Позиции с резервами
  hasReserves: boolean
}

/**
 * Результат расчёта матрицы решений.
 */
export interface DecisionResult {
  canDemand: boolean
  canPayment: boolean
  canReturn: boolean
  canCancel: boolean
  status: SuppliesOrderStatus
  reason: string
}

/**
 * Рассчитать матрицу решений для заказа.
 *
 * Логика:
 * 1. Если отменён → ничего нельзя
 * 2. Если возврат создан → ничего нельзя
 * 3. Если оплачен полностью → финальный статус
 * 4. Если есть отгрузка + WB/Ozon возврат → можно вернуть
 * 5. Если есть отгрузка + не оплачен → можно оплатить
 * 6. Если новый + не отгружен → можно отгрузить
 * 7. Если новый + нет резервов → можно отменить
 *
 * @param input — Данные заказа и кэшей.
 * @returns Матрица решений + статус для канбана.
 */
export function calculateDecision(input: DecisionInput): DecisionResult {
  const {
    orderStateHref,
    orderStateName,
    hasDemand,
    hasReturn,
    hasPayment,
    orderSum,
    paidSum,
    shippedSum,
    wbReturnDetected,
    ozonReturnDetected,
    hasReserves,
  } = input

  const stateId = orderStateHref?.split("/").pop() ?? ""
  const normalizedStateName = (orderStateName ?? "").toLowerCase()

  // === 1. Отменённый ===
  if (
    stateId === CUSTOMER_ORDER_STATES.CANCELLED ||
    stateId === CUSTOMER_ORDER_STATES.PARTIAL_CANCEL ||
    (!!orderStateName && normalizedStateName.includes("отмен") && !normalizedStateName.includes("частич"))
  ) {
    return {
      canDemand: false,
      canPayment: false,
      canReturn: false,
      canCancel: false,
      status: SUPPLIES_ORDER_STATUS.CANCELLED,
      reason: "Заказ отменён",
    }
  }

  // === 2. Возврат создан ===
  if (hasReturn || stateId === CUSTOMER_ORDER_STATES.RETURN) {
    return {
      canDemand: false,
      canPayment: false,
      canReturn: false,
      canCancel: false,
      status: SUPPLIES_ORDER_STATUS.RETURNED,
      reason: "Возврат создан",
    }
  }

  // === 3. Полностью оплачен ===
  if (paidSum >= orderSum && orderSum > 0) {
    return {
      canDemand: false,
      canPayment: false,
      canReturn: false,
      canCancel: false,
      status: SUPPLIES_ORDER_STATUS.PAID,
      reason: "Полностью оплачен",
    }
  }

  // === 4. Есть отгрузка + возврат в маркетплейсе ===
  if (hasDemand && (wbReturnDetected || ozonReturnDetected)) {
    return {
      canDemand: false,
      canPayment: false,
      canReturn: true,
      canCancel: false,
      status: SUPPLIES_ORDER_STATUS.CAN_RETURN,
      reason: "Обнаружен возврат в WB/Ozon",
    }
  }

  // === 5. Есть отгрузка + не оплачен ===
  if (hasDemand && paidSum < orderSum) {
    return {
      canDemand: false,
      canPayment: true,
      canReturn: false,
      canCancel: false,
      status: SUPPLIES_ORDER_STATUS.CAN_PAY,
      reason: "Отгружен, ожидает оплаты",
    }
  }

  // === 6. Есть отгрузка + оплачен (частично?) — уже обработано выше ===
  if (hasDemand) {
    return {
      canDemand: false,
      canPayment: false,
      canReturn: false,
      canCancel: false,
      status: SUPPLIES_ORDER_STATUS.SHIPPED,
      reason: "Отгружен",
    }
  }

  // === 7. Статус "На отправке с отсрочкой" ===
  if (stateId === CUSTOMER_ORDER_STATES.DELAYED) {
    return {
      canDemand: true,
      canPayment: false,
      canReturn: false,
      canCancel: true,
      status: SUPPLIES_ORDER_STATUS.DELAYED,
      reason: "На отправке с отсрочкой платежа",
    }
  }

  // === 8. Новый заказ ===
  return {
    canDemand: true,
    canPayment: false,
    canReturn: false,
    canCancel: hasReserves, // Можно отменить только если есть резервы
    status: SUPPLIES_ORDER_STATUS.CAN_SHIP,
    reason: "Новый заказ, готов к отгрузке",
  }
}

/**
 * Извлечь номер отправления из description customerorder.
 *
 * Поддерживает форматы:
 * - "Заказ WB-1234567"
 * - "WB-1234567"
 * - "OZ1234567"
 * - "№WB1234567"
 *
 * @param description — Description заказа из МС.
 * @returns Номер отправления или null.
 */
export function extractShipmentNum(description: string | null): string | null {
  if (!description) return null

  // WB: WB-1234567, WB1234567, №WB-1234567
  const wbMatch = description.match(/(?:WB|wb)[-]?(\d{5,20})/)
  if (wbMatch) return `WB-${wbMatch[1]}`

  // Ozon: OZ1234567, OZ-1234567, №OZ1234567
  const ozonMatch = description.match(/(?:OZ|oz)[-]?(\d{5,20})/)
  if (ozonMatch) return `OZ-${ozonMatch[1]}`

  // Унивариант: 10+ цифр подряд (сборочное задание)
  const genericMatch = description.match(/(\d{10,20})/)
  if (genericMatch) return genericMatch[1]

  return null
}

/**
 * Определить площадку по контрагенту или description.
 *
 * @param counterpartyName — Имя контрагента.
 * @param description — Description заказа.
 * @returns Площадка: "wb" | "ozon" | "unknown".
 */
export function detectMarketplace(
  counterpartyName: string | null,
  description: string | null
): "wb" | "ozon" | "unknown" {
  const text = `${counterpartyName ?? ""} ${description ?? ""}`.toLowerCase()

  if (text.includes("wildberries") || text.includes("вб") || text.includes("wb")) {
    return "wb"
  }
  if (text.includes("ozon") || text.includes("озон")) {
    return "ozon"
  }

  return "unknown"
}

/**
 * Проверить, содержит ли description номер отправления.
 */
export function hasShipmentNum(description: string | null): boolean {
  return extractShipmentNum(description) !== null
}
