/**
 * @file Модуль поставок — сканирование новых заказов WB/Ozon в МойСклад
 * @module supplies
 */

const { getApi } = require('./api-utils')
const { getOrderFull } = require('./order')
const { extractShipmentNumFromDescription } = require('./order')
const { detectMarketplaceFromDescription } = require('./check')
const { ORDER_STATUS } = require('./constants')
const wb = require('./wb')
const ozon = require('./ozon')

const SUPPLIES_CACHE_COOLDOWN = 10 * 60 * 1000 // 10 минут
let lastWbRefresh = 0
let lastOzonRefresh = 0

const WB_COUNTERPARTY_ID = '675a3513-0998-11f1-0a80-07df001a8afa'
const OZON_COUNTERPARTY_ID = '7a1594c7-d19b-11ed-0a80-078d001904ee'

/**
 * Сканирует новые заказы поставок — запрашивает из МойСклад заказы со статусом "Новый"
 * за последние 5 дней от контрагентов WB и Ozon, сверяет с кэшами маркетплейсов
 * и формирует рекомендации по decision matrix. При повторном вызове загружает только
 * новые заказы, начиная с максимального moment предыдущего скана.
 *
 * @param {string} msToken - Токен API МойСклад
 * @param {string} wbToken - Токен API Wildberries
 * @param {string} ozonClientId - Client-ID Ozon
 * @param {string} ozonApiKey - API-Key Ozon
 * @param {Function} log - Функция логирования
 * @param {Function} [onProgress] - Колбэк прогресса (order, index, total)
 * @returns {Promise<{orders: Array, stats: Object}>}
 */
async function scanNewOrders(msToken, wbToken, ozonClientId, ozonApiKey, log, onProgress, filterStoreId = '_all', filterMarketplaces = 'wb,ozon', filterDateFrom = '', filterDateTo = '') {
  // 1. Фоновое обновление кэшей (если прошло > 10 мин) — не ждём, сканирование идёт сразу
  let cachePromise = null
  const now = Date.now()
  const refreshPromises = []

  if (wbToken && now - lastWbRefresh > SUPPLIES_CACHE_COOLDOWN) {
    lastWbRefresh = now
    refreshPromises.push(
      wb.refreshIfStale(wbToken, log).catch(e => {
        log(`Supplies: WB cache error: ${e.message}`)
      })
    )
  }

  if (ozonClientId && ozonApiKey && now - lastOzonRefresh > SUPPLIES_CACHE_COOLDOWN) {
    lastOzonRefresh = now
    refreshPromises.push(
      ozon.refreshSupplies(ozonClientId, ozonApiKey, log).catch(e => {
        log(`Supplies: Ozon cache error: ${e.message}`)
      })
    )
  }

  if (refreshPromises.length > 0) {
    cachePromise = Promise.all(refreshPromises)
  }

  // 2. Инициализация API
  process.env.MOYSKLAD_TOKEN = msToken
  const { initApi } = require('./moysklad')
  initApi(msToken)

  // 3. Запрос заказов из МС
  const API = getApi()

  // Окно сканирования: всегда сканируем за последние 14 дней
  // (без lastScanMoment — чтобы при рескане перезапрашивать все заказы из МС)
  var momentFilter
  if (filterDateFrom) {
    momentFilter = filterDateFrom + ' 00:00:00'
  } else {
    const lookbackDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    momentFilter = lookbackDate.toISOString().slice(0, 19).replace('T', ' ')
  }

  // Загрузка справочника складов (для отображения названия вместо UUID)
  const storesRes = await API.GET('entity/store?limit=100').catch(() => ({ rows: [] }))
  /** @type {Object<string, string>} */
  const storeMap = {}
  for (const s of storesRes.rows || []) {
    storeMap[s.id] = s.name
  }

  // Фильтр по складу (если указан)
  var storeFilterStr = ''
  if (filterStoreId && filterStoreId !== '_all') {
    storeFilterStr = `;store=https://api.moysklad.ru/api/remap/1.2/entity/store/${filterStoreId}`
  }
  // Верхняя граница даты (если указана)
  var momentToFilterStr = ''
  if (filterDateTo) {
    momentToFilterStr = `;moment<=${filterDateTo} 23:59:59`
  }

  const wbFilter = `moment>=${momentFilter}${momentToFilterStr};agent=https://api.moysklad.ru/api/remap/1.2/entity/counterparty/${WB_COUNTERPARTY_ID}${storeFilterStr}`
  const ozonFilter = `moment>=${momentFilter}${momentToFilterStr};agent=https://api.moysklad.ru/api/remap/1.2/entity/counterparty/${OZON_COUNTERPARTY_ID}${storeFilterStr}`

  const marketplacesArr = filterMarketplaces.split(',').map(function(m) { return m.trim() })
  const showWb = marketplacesArr.includes('wb')
  const showOzon = marketplacesArr.includes('ozon')

  const [wbResult, ozonResult] = await Promise.all([
    showWb
      ? API.GET(`entity/customerorder?limit=500&filter=${encodeURIComponent(wbFilter)}&expand=agent,positions,state,store`).catch(e => {
          log(`Supplies: WB orders fetch error: ${e.message}`)
          return { rows: [] }
        })
      : Promise.resolve({ rows: [] }),
    showOzon
      ? API.GET(`entity/customerorder?limit=500&filter=${encodeURIComponent(ozonFilter)}&expand=agent,positions,state,store`).catch(e => {
          log(`Supplies: Ozon orders fetch error: ${e.message}`)
          return { rows: [] }
        })
      : Promise.resolve({ rows: [] })
  ])

  // 4. Объединить, убрать дубли по id
  const seenIds = new Set()
  const allOrders = []
  for (const row of [...(wbResult.rows || []), ...(ozonResult.rows || [])]) {
    if (!seenIds.has(row.id)) {
      seenIds.add(row.id)
      allOrders.push(row)
    }
  }

  log(`Supplies: найдено ${allOrders.length} новых заказов (WB: ${(wbResult.rows || []).length}, Ozon: ${(ozonResult.rows || []).length})`)

  // 5. Для каждого заказа — детальная проверка
  const orders = []
  let wbCount = 0
  let ozonCount = 0
  let withDemand = 0
  let withoutDemand = 0
  let skippedStatus = 0
  let skippedDesc = 0

  for (let i = 0; i < allOrders.length; i++) {
    const order = allOrders[i]
    try {
      const orderFull = await getOrderFull(order.id)
      if (!orderFull) continue

      // Пропускаем заказы не в статусе "Новый" (фильтр на клиенте, а не в API — UUID статуса может отличаться от хардкодного)
      const stateId = orderFull.state?.meta?.href?.split('/').pop()
      if (stateId !== ORDER_STATUS.NEW) {
        skippedStatus++
        continue
      }

      const desc = orderFull.description || ''
      const shipmentNum = extractShipmentNumFromDescription(desc)
      const marketplace = detectMarketplaceFromDescription(desc)

      if (!marketplace || !shipmentNum) {
        skippedDesc++
        var reason = !marketplace && !shipmentNum ? 'нет маркетплейса и номера отправления'
          : !marketplace ? 'не определён маркетплейс'
          : 'не определён номер отправления'
        log(`Supplies: пропущен заказ ${order.name} (${orderFull.name || ''}) — ${reason}`)
        log(`Supplies:   description: "${desc.substring(0, 200)}"`)
        continue
      }

      if (marketplace === 'wb') wbCount++
      else if (marketplace === 'ozon') ozonCount++

      const hasDemand = (orderFull.demands?.length || 0) > 0
      if (hasDemand) withDemand++
      else withoutDemand++

      // Поиск в кэшах маркетплейса
      let marketplaceStatus = ''
      let marketplaceFound = false
      let marketplaceIsCancelled = false
      let marketplaceIsReturn = false
      let marketplaceIsDelivered = false

      if (marketplace === 'wb') {
        let wbDataSource = ''
        let wbData = wb.findInCache(shipmentNum) || wb.wbOrdersCache?.byId?.get(shipmentNum)
        if (wbData) wbDataSource = 'findInCache'
        // Fallback: ищем в кэше продаж — WB v1/supplier/sales
        if (!wbData) {
          const saleRec = wb.wbSalesCache?.bySticker?.get(String(shipmentNum))
          if (saleRec) {
            wbData = saleRec
            wbDataSource = 'rawSalesFallback'
          }
        }
        if (wbData) {
          // Debug: отладочный лог для заказов 85586/85587
          if (shipmentNum === '5201087379' || shipmentNum === '5201087380') {
            log(`[SUPPLIES DEBUG] Заказ ${order.name} (shipment=${shipmentNum}):`)
            log(`[SUPPLIES DEBUG]   wbDataSource: ${wbDataSource}`)
            log(`[SUPPLIES DEBUG]   wbData.type: ${typeof wbData}, keys: ${Object.keys(wbData).join(', ')}`)
            log(`[SUPPLIES DEBUG]   wbData.isCancel: ${wbData.isCancel}, isRealization: ${wbData.isRealization}`)
            log(`[SUPPLIES DEBUG]   wbData.status: ${wbData.status}, orderStatus: ${wbData.orderStatus}`)
            log(`[SUPPLIES DEBUG]   wbData._source: ${wbData._source}`)
          }
          marketplaceFound = true
          // Приоритет: isCancel из stickers кэша (join по srid=rid)
          // Если findInCache вернул объект с полями:
          if (wbData.isCancel !== undefined) {
            marketplaceIsCancelled = !!wbData.isCancel
            // isRealization из stickers cache (flag=0) = "заказ принят в обработку", не "доставлен".
            // Проверяем sales cache (flag=1) для реального статуса доставки.
            const saleRec = wb.wbSalesCache?.bySticker?.get(String(shipmentNum))
            const isActuallyDelivered = !!(saleRec && (saleRec.status === 'sale' || saleRec.status === 'delivered'))
            marketplaceIsDelivered = isActuallyDelivered && !wbData.isCancel
            marketplaceStatus = wbData.isCancel ? 'cancelled'
              : isActuallyDelivered ? 'delivered'
              : ''
          } else {
            // Fallback: определяем по полю status (для старых записей или raw данных)
            const status = wbData.status || wbData.orderStatus || ''
            marketplaceStatus = status
            marketplaceIsCancelled = status === 'cancel' || status === 'cancelled'
            marketplaceIsDelivered = status === 'sale' || status === 'delivered'
          }
          if (shipmentNum === '5201087379' || shipmentNum === '5201087380') {
            log(`[SUPPLIES DEBUG]   marketplaceFound=${marketplaceFound}, marketplaceIsCancelled=${marketplaceIsCancelled}, marketplaceIsDelivered=${marketplaceIsDelivered}`)
          }
          marketplaceIsReturn = !!(wbData.returnType)
          // Дополнительная проверка возврата: есть ли запись в кэшах возвратов
          if (!marketplaceIsReturn) {
            marketplaceIsReturn = !!(
              wb.wbAnalyticsReturnsCache?.byOrderId?.get(shipmentNum) ||
              wb.wbReturnsCache?.bySticker?.get(shipmentNum)
            )
          }
        }
      } else if (marketplace === 'ozon') {
        const ozonData = ozon.findInCache(shipmentNum) || ozon.ozonPostingsCache?.byPostingNumber?.get(shipmentNum)
        if (ozonData) {
          marketplaceFound = true
          const status = ozonData.status || ''
          marketplaceStatus = status
          marketplaceIsCancelled = status === 'cancelled'
          marketplaceIsReturn = !!(
            ozon.ozonReturnsCache?.byPostingNumber?.get(shipmentNum) ||
            ozonData.return_reason_name
          )
          marketplaceIsDelivered = status === 'delivered' || status === 'delivering'
        }
      }

      // Decision Matrix
      let recommendation = ''
      let recommendationType = ''
      let canDemand = false
      let canCancel = false
      let canReturn = false

      if (!hasDemand) {
        if (!marketplaceFound) {
          recommendationType = 'waiting'
          recommendation = '⏳ Ожидание данных маркета'
          canCancel = false
        } else if (marketplaceIsCancelled) {
          recommendationType = 'action_cancel'
          recommendation = '❌ Отменить в МС'
          canCancel = true
        } else if (marketplaceIsReturn) {
          recommendationType = 'action_cancel'
          recommendation = '↩️ Отменить в МС'
          canCancel = true
        } else if (marketplaceIsDelivered) {
          recommendationType = 'action_demand'
          recommendation = '✅ Оформить отгрузку'
          canDemand = true
        } else {
          recommendationType = 'waiting'
          recommendation = '📦 Ожидает на маркете'
          canDemand = false
        }
      } else {
        // hasDemand = true
        if (marketplaceIsReturn) {
          recommendationType = 'action_return'
          recommendation = '↩️ Оформить возврат'
          canReturn = true
        } else if (marketplaceIsCancelled) {
          recommendationType = 'action_cancel_demand'
          recommendation = '⚠️ Проверить отгрузку'
          canCancel = false
        } else if (marketplaceIsDelivered || !marketplaceFound) {
          recommendationType = 'ok'
          recommendation = '✅ Всё ок'
        } else {
          recommendationType = 'ok'
          recommendation = '✅ Всё ок'
        }
      }

      const storeId = order.store?.meta?.href?.split('/').pop() || ''
      const storeName = storeMap[storeId] || '—'

      const supplyItem = {
        orderId: order.id,
        orderName: order.name || '',
        description: desc,
        shipmentNum: shipmentNum || '',
        orderMoment: order.moment || '',
        sum: order.sum ? Math.round(order.sum / 100) : 0,
        marketplace,
        hasDemand,
        demandName: hasDemand ? (orderFull.demands[0]?.name || null) : null,
        storeName,
        storeId,
        marketplaceStatus,
        marketplaceFound,
        marketplaceIsCancelled,
        marketplaceIsReturn,
        marketplaceIsDelivered,
        recommendation,
        recommendationType,
        canDemand,
        canCancel,
        canReturn
      }

      orders.push(supplyItem)

      if (onProgress) {
        onProgress(supplyItem, i + 1, allOrders.length)
      }
    } catch (e) {
      log(`Supplies: ошибка обработки заказа ${order.name}: ${e.message}`)
    }
  }

  // Дебаг: статистика прохождения фильтров
  log(`Supplies: статистика фильтрации: из API=${allOrders.length}, не прошли статус "Новый"=${skippedStatus}, не прошли описание=${skippedDesc}, итого=${orders.length}`)

  return {
    orders,
    cachePromise: cachePromise || undefined,
    stats: {
      total: orders.length,
      wb: wbCount,
      ozon: ozonCount,
      withDemand,
      withoutDemand,
      filterStats: {
        totalFromAPI: allOrders.length,
        skippedStatus: skippedStatus,
        skippedDesc: skippedDesc,
        passed: orders.length
      }
    }
  }
}

/**
 * Перепроверяет заказ поставки по обновлённому кэшу маркетплейса.
 * Вызывается после завершения фонового обновления кэша WB/Ozon.
 *
 * @param {Object} order - Объект поставки из результата scanNewOrders
 * @returns {Object} Обновлённый объект поставки (или исходный, если ничего не изменилось)
 */
function recheckOrder(order) {
  var shipmentNum = order.shipmentNum
  var marketplace = order.marketplace
  var hasDemand = order.hasDemand
  if (!shipmentNum || !marketplace) return order

  var marketplaceStatus = ''
  var marketplaceFound = false
  var marketplaceIsCancelled = false
  var marketplaceIsReturn = false
  var marketplaceIsDelivered = false

  if (marketplace === 'wb') {
    var wbData = wb.findInCache(shipmentNum) || wb.wbOrdersCache?.byId?.get(shipmentNum)
    if (!wbData) {
      var saleRec = wb.wbSalesCache?.bySticker?.get(String(shipmentNum))
      if (saleRec) wbData = saleRec
    }
    if (wbData) {
      marketplaceFound = true
      if (wbData.isCancel !== undefined) {
        marketplaceIsCancelled = !!wbData.isCancel
        var sr = wb.wbSalesCache?.bySticker?.get(String(shipmentNum))
        var isActuallyDelivered = !!(sr && (sr.status === 'sale' || sr.status === 'delivered'))
        marketplaceIsDelivered = isActuallyDelivered && !wbData.isCancel
        marketplaceStatus = wbData.isCancel ? 'cancelled'
          : isActuallyDelivered ? 'delivered' : ''
      } else {
        var status = wbData.status || wbData.orderStatus || ''
        marketplaceStatus = status
        marketplaceIsCancelled = status === 'cancel' || status === 'cancelled'
        marketplaceIsDelivered = status === 'sale' || status === 'delivered'
      }
      marketplaceIsReturn = !!(
        wbData.returnType ||
        wb.wbAnalyticsReturnsCache?.byOrderId?.get(shipmentNum) ||
        wb.wbReturnsCache?.bySticker?.get(shipmentNum)
      )
    }
  } else if (marketplace === 'ozon') {
    var ozonData = ozon.findInCache(shipmentNum) || ozon.ozonPostingsCache?.byPostingNumber?.get(shipmentNum)
    if (ozonData) {
      marketplaceFound = true
      var st = ozonData.status || ''
      marketplaceStatus = st
      marketplaceIsCancelled = st === 'cancelled'
      marketplaceIsReturn = !!(
        ozon.ozonReturnsCache?.byPostingNumber?.get(shipmentNum) ||
        ozonData.return_reason_name
      )
      marketplaceIsDelivered = st === 'delivered' || st === 'delivering'
    }
  }

  // Decision Matrix
  var recommendation = ''
  var recommendationType = ''
  var canDemand = false
  var canCancel = false
  var canReturn = false

  if (!hasDemand) {
    if (!marketplaceFound) {
      recommendationType = 'waiting'
      recommendation = '⏳ Ожидание данных маркета'
    } else if (marketplaceIsCancelled) {
      recommendationType = 'action_cancel'
      recommendation = '❌ Отменить в МС'
      canCancel = true
    } else if (marketplaceIsReturn) {
      recommendationType = 'action_cancel'
      recommendation = '↩️ Отменить в МС'
      canCancel = true
    } else if (marketplaceIsDelivered) {
      recommendationType = 'action_demand'
      recommendation = '✅ Оформить отгрузку'
      canDemand = true
    } else {
      recommendationType = 'waiting'
      recommendation = '📦 Ожидает на маркете'
    }
  } else {
    if (marketplaceIsReturn) {
      recommendationType = 'action_return'
      recommendation = '↩️ Оформить возврат'
      canReturn = true
    } else if (marketplaceIsCancelled) {
      recommendationType = 'action_cancel_demand'
      recommendation = '⚠️ Проверить отгрузку'
    } else if (marketplaceIsDelivered || !marketplaceFound) {
      recommendationType = 'ok'
      recommendation = '✅ Всё ок'
    } else {
      recommendationType = 'ok'
      recommendation = '✅ Всё ок'
    }
  }

  var changed =
    order.marketplaceStatus !== marketplaceStatus ||
    order.marketplaceFound !== marketplaceFound ||
    order.marketplaceIsCancelled !== marketplaceIsCancelled ||
    order.marketplaceIsReturn !== marketplaceIsReturn ||
    order.marketplaceIsDelivered !== marketplaceIsDelivered ||
    order.recommendation !== recommendation ||
    order.recommendationType !== recommendationType ||
    order.canDemand !== canDemand ||
    order.canCancel !== canCancel ||
    order.canReturn !== canReturn

  if (!changed) return order

  return { ...order,
    marketplaceStatus: marketplaceStatus,
    marketplaceFound: marketplaceFound,
    marketplaceIsCancelled: marketplaceIsCancelled,
    marketplaceIsReturn: marketplaceIsReturn,
    marketplaceIsDelivered: marketplaceIsDelivered,
    recommendation: recommendation,
    recommendationType: recommendationType,
    canDemand: canDemand,
    canCancel: canCancel,
    canReturn: canReturn
  }
}

module.exports = { scanNewOrders, recheckOrder, WB_COUNTERPARTY_ID, OZON_COUNTERPARTY_ID }
