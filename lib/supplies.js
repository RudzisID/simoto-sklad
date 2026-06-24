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

  // 5. Дождаться обновления кэшей и запросить WB-статусы у API
  if (cachePromise) {
    await cachePromise
    log('Supplies: WB/Ozon caches refreshed')
  }

  // 5b. Собрать WB orderId из заказов и запросить статусы (POST /api/v3/orders/status)
  /** @type {Map<number,{wbStatus:string,supplierStatus:string}>} */
  const wbStatusMap = new Map()
  if (wbToken && showWb) {
    const wbOrderIds = new Set()
    for (const order of allOrders) {
      const desc = order.description || ''
      const sn = extractShipmentNumFromDescription(desc)
      const mp = detectMarketplaceFromDescription(desc)
      if (mp === 'wb' && sn) {
        const rec = wb.wbOrdersCache?.byId?.get(String(sn))
        if (rec?.id) wbOrderIds.add(rec.id)
      }
    }
    if (wbOrderIds.size > 0) {
      const ids = [...wbOrderIds]
      log(`Supplies: запрос статусов для ${ids.length} WB orderId...`)
      const statusMap = await wb.getWBOrdersStatus(wbToken, ids, log).catch(e => {
        log(`Supplies: WB orders status error: ${e.message}`)
        return new Map()
      })
      for (const [id, info] of statusMap) {
        wbStatusMap.set(id, info)
      }
      log(`Supplies: получено статусов для ${wbStatusMap.size} orderId`)
    }
  }

  // 6. Для каждого заказа — детальная проверка
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
      let marketplaceSupplyId = ''

      if (marketplace === 'wb') {
        // Прямой поиск по каждому кэшу независимо (вместо цепочки findInCache)
        const salesRec = wb.wbSalesCache?.bySticker?.get(String(shipmentNum))
        const returnsRec = wb.wbReturnsCache?.bySticker?.get(String(shipmentNum))

        // Поиск в стикерах: перебираем bySrid, ищем stickerVal === shipmentNum
        let stickerInfo = null
        const stickersBySrid = wb.wbOrdersStickersCache?.bySrid || new Map()
        for (const [srid, stickerObj] of stickersBySrid) {
          const stickerVal = stickerObj.sticker || srid
          if (String(stickerVal) === String(shipmentNum) || String(srid) === String(shipmentNum)) {
            stickerInfo = stickerObj
            break
          }
        }

        // analyticsRec — поиск по wbAnalyticsReturnsCache.byOrderId
        const analyticsRec = wb.wbAnalyticsReturnsCache?.byOrderId?.get(String(shipmentNum))

        // ═══════════════════════════════════════════════════════════
        // Поиск в wbOrdersCache (Marketplace API v3) — самый точный источник статуса
        // ═══════════════════════════════════════════════════════════
        let orderRec = null
        // Прямой поиск по byId (если shipmentNum = id сборочного задания)
        orderRec = wb.wbOrdersCache?.byId?.get(String(shipmentNum))
        // Поиск через stickers → byRid (если shipmentNum = стикер)
        if (!orderRec) {
          for (const [srid, stickerObj] of stickersBySrid) {
            const stickerVal = stickerObj.sticker || srid
            if (String(stickerVal) === String(shipmentNum)) {
              orderRec = wb.wbOrdersCache?.byRid?.get(srid)
              break
            }
          }
        }
        // Прямой lookup стикера по orderRec.rid (rid === srid в stickersCache)
        // Основной источник isCancel / isRealization для заказов, найденных по byId
        if (orderRec?.rid && !stickerInfo) {
          stickerInfo = wb.wbOrdersStickersCache?.bySrid?.get(orderRec.rid)
        }
        marketplaceSupplyId = orderRec?.supplyId || ''
        const mpStatus = orderRec?.status || orderRec?.orderStatus || ''
        // wbStatus из POST /api/v3/orders/status (самый точный источник)
        const wbStatusInfo = wbStatusMap.get(orderRec?.id) || null
        const wbStatus = wbStatusInfo?.wbStatus || ''

        marketplaceFound = !!(salesRec || returnsRec || stickerInfo || analyticsRec || orderRec)

        if (marketplaceFound) {
          if (shipmentNum === '5201087379' || shipmentNum === '5201087380') {
            log(`[SUPPLIES DEBUG] Заказ ${order.name} (shipment=${shipmentNum}):`)
            log(`[SUPPLIES DEBUG]   salesRec: ${!!salesRec}, returnsRec: ${!!returnsRec}, stickerInfo: ${!!stickerInfo}, analyticsRec: ${!!analyticsRec}, orderRec: ${!!orderRec}, mpStatus: ${mpStatus}, wbStatus: ${wbStatus}`)
          }

          // Определяем статус по приоритету (первое совпадение)
          // Приоритет: return → cancel(orders) → cancel(sticker) →
          //   → wbStatus=sold → wbStatus=canceled → complete(orders) →
          //   → delivered(sales) → delivered(sticker) → wbStatus(другие) → mpStatus(другие) → processing
          if (returnsRec) {
            marketplaceIsReturn = true
            marketplaceStatus = 'return'
          } else if (mpStatus === 'cancel') {
            marketplaceIsCancelled = true
            marketplaceStatus = 'cancelled'
          } else if (stickerInfo?.isCancel) {
            marketplaceIsCancelled = true
            marketplaceStatus = 'cancelled'
          } else if (wbStatus === 'sold') {
            marketplaceIsDelivered = true
            marketplaceStatus = 'delivered'
          } else if (wbStatus === 'canceled_by_client') {
            marketplaceIsCancelled = true
            marketplaceStatus = 'cancelled'
          } else if (mpStatus === 'complete') {
            marketplaceIsDelivered = true
            marketplaceStatus = 'delivered'
          } else if (salesRec && (salesRec.status === 'sale' || salesRec.status === 'delivered')) {
            marketplaceIsDelivered = true
            marketplaceStatus = 'delivered'
          } else if (stickerInfo?.isRealization && orderRec?.supplyId) {
            marketplaceIsDelivered = true
            marketplaceStatus = 'delivered'
          } else if (wbStatus && !['new', 'accepted', 'confirm'].includes(wbStatus)) {
            marketplaceStatus = wbStatus
          } else if (mpStatus && !['new', 'accepted', 'confirm'].includes(mpStatus)) {
            marketplaceStatus = mpStatus
          }

          if (shipmentNum === '5201087379' || shipmentNum === '5201087380') {
            log(`[SUPPLIES DEBUG]   marketplaceFound=${marketplaceFound}, marketplaceIsCancelled=${marketplaceIsCancelled}, marketplaceIsDelivered=${marketplaceIsDelivered}, marketplaceIsReturn=${marketplaceIsReturn}, marketplaceStatus=${marketplaceStatus}`)
          }
        }
      } else if (marketplace === 'ozon') {
        // Independent search: check each cache separately, apply priority
        const codeStr = String(shipmentNum)
        const ozonPosting = ozon.ozonPostingsCache?.byPostingNumber?.get(codeStr)
        const ozonReturn = ozon.ozonReturnsCache?.byReturnId?.get(codeStr) ||
          ozon.ozonReturnsCache?.byPostingNumber?.get(codeStr)

        let ozonReturnByData = null
        if (!ozonReturn && ozon.ozonReturnsCache?.data) {
          ozonReturnByData = ozon.ozonReturnsCache.data.find(r =>
            String(r.barcode) === codeStr || String(r.id) === codeStr
          )
        }

        const ozonReturnInfo = ozonReturn || ozonReturnByData
        const ozonData = ozonPosting || ozonReturnInfo

        if (ozonData) {
          marketplaceFound = true

          // Collect all statuses for priority resolution
          const hasReturn = !!(ozonReturnInfo?.return_reason_name || ozonReturnInfo?.status === 'return' || ozonReturnInfo?.status === 'returned' || ozonReturnInfo?.status === 'returning')

          // Priority: return → cancelled → delivered → processing
          if (hasReturn || ozonPosting?.status === 'cancelled') {
            // cancelled also means the delivery chain was interrupted
            marketplaceIsReturn = !!hasReturn
            marketplaceIsCancelled = !hasReturn && (ozonPosting?.status === 'cancelled')
            marketplaceIsDelivered = false
          } else if (ozonPosting?.status === 'delivered' || ozonPosting?.status === 'delivering') {
            marketplaceIsDelivered = true
            marketplaceIsCancelled = false
            marketplaceIsReturn = false
          }

          // Derive status string from the best available data
          if (marketplaceIsReturn) {
            marketplaceStatus = 'return'
          } else if (marketplaceIsCancelled) {
            marketplaceStatus = 'cancelled'
          } else if (marketplaceIsDelivered) {
            marketplaceStatus = 'delivered'
          } else {
            marketplaceStatus = ozonPosting?.status || ''
          }
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
          recommendation = '✅ Оформить отгрузку' + (marketplaceSupplyId ? ' (' + marketplaceSupplyId + ')' : '')
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
        marketplaceSupplyId,
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
  var marketplaceSupplyId = ''

  if (marketplace === 'wb') {
    // Прямой поиск по каждому кэшу независимо (вместо цепочки findInCache)
    var salesRec = wb.wbSalesCache?.bySticker?.get(String(shipmentNum))
    var returnsRec = wb.wbReturnsCache?.bySticker?.get(String(shipmentNum))

    // Поиск в стикерах: перебираем bySrid, ищем stickerVal === shipmentNum
    var stickerInfo = null
    var stickersBySrid = wb.wbOrdersStickersCache?.bySrid || new Map()
    for (var _entry of stickersBySrid) {
      var srid = _entry[0], stickerObj = _entry[1]
      var stickerVal = stickerObj.sticker || srid
      if (String(stickerVal) === String(shipmentNum) || String(srid) === String(shipmentNum)) {
        stickerInfo = stickerObj
        break
      }
    }

    // analyticsRec — поиск по wbAnalyticsReturnsCache.byOrderId
    var analyticsRec = wb.wbAnalyticsReturnsCache?.byOrderId?.get(String(shipmentNum))

    // ═══════════════════════════════════════════════════════════
    // Поиск в wbOrdersCache (Marketplace API v3) — самый точный источник статуса
    // ═══════════════════════════════════════════════════════════
    var orderRec = null
    // Прямой поиск по byId (если shipmentNum = id сборочного задания)
    orderRec = wb.wbOrdersCache?.byId?.get(String(shipmentNum))
    // Поиск через stickers → byRid (если shipmentNum = стикер)
    if (!orderRec) {
      for (var _entry2 of stickersBySrid) {
        var srid2 = _entry2[0], stickerObj2 = _entry2[1]
        var stickerVal2 = stickerObj2.sticker || srid2
        if (String(stickerVal2) === String(shipmentNum)) {
          orderRec = wb.wbOrdersCache?.byRid?.get(srid2)
          break
        }
      }
    }
    // Прямой lookup стикера по orderRec.rid (rid === srid в stickersCache)
    if (orderRec?.rid && !stickerInfo) {
      stickerInfo = wb.wbOrdersStickersCache?.bySrid?.get(orderRec.rid)
    }
    marketplaceSupplyId = orderRec?.supplyId || ''
    var mpStatus = orderRec?.status || orderRec?.orderStatus || ''
    // wbStatus из кэша POST /api/v3/orders/status (заполняется scanNewOrders)
    var wbStatusRec = wb.wbOrdersStatusCache?.byOrderId?.get(orderRec?.id) || null
    var wbStatus = wbStatusRec?.wbStatus || ''

    marketplaceFound = !!(salesRec || returnsRec || stickerInfo || analyticsRec || orderRec)

    if (marketplaceFound) {
      // Определяем статус по приоритету (первое совпадение)
      // Приоритет: return → cancel(orders) → cancel(sticker) →
      //   → wbStatus=sold → wbStatus=canceled → complete(orders) →
      //   → delivered(sales) → delivered(sticker) → wbStatus(другие) → mpStatus(другие) → processing
      if (returnsRec) {
        marketplaceIsReturn = true
        marketplaceStatus = 'return'
      } else if (mpStatus === 'cancel') {
        marketplaceIsCancelled = true
        marketplaceStatus = 'cancelled'
      } else if (stickerInfo?.isCancel) {
        marketplaceIsCancelled = true
        marketplaceStatus = 'cancelled'
      } else if (wbStatus === 'sold') {
        marketplaceIsDelivered = true
        marketplaceStatus = 'delivered'
      } else if (wbStatus === 'canceled_by_client') {
        marketplaceIsCancelled = true
        marketplaceStatus = 'cancelled'
      } else if (mpStatus === 'complete') {
        marketplaceIsDelivered = true
        marketplaceStatus = 'delivered'
      } else if (salesRec && (salesRec.status === 'sale' || salesRec.status === 'delivered')) {
        marketplaceIsDelivered = true
        marketplaceStatus = 'delivered'
      } else if (stickerInfo?.isRealization && orderRec?.supplyId) {
        marketplaceIsDelivered = true
        marketplaceStatus = 'delivered'
      } else if (wbStatus && !['new', 'accepted', 'confirm'].includes(wbStatus)) {
        marketplaceStatus = wbStatus
      } else if (mpStatus && !['new', 'accepted', 'confirm'].includes(mpStatus)) {
        marketplaceStatus = mpStatus
      }
    }
  } else if (marketplace === 'ozon') {
    // Independent search: check each cache separately, apply priority
    var codeStr = String(shipmentNum)
    var ozonPosting = ozon.ozonPostingsCache?.byPostingNumber?.get(codeStr)
    var ozonReturn = ozon.ozonReturnsCache?.byReturnId?.get(codeStr) ||
      ozon.ozonReturnsCache?.byPostingNumber?.get(codeStr)

    var ozonReturnByData = null
    if (!ozonReturn && ozon.ozonReturnsCache?.data) {
      ozonReturnByData = ozon.ozonReturnsCache.data.find(function(r) {
        return String(r.barcode) === codeStr || String(r.id) === codeStr
      })
    }

    var ozonReturnInfo = ozonReturn || ozonReturnByData
    var ozonData = ozonPosting || ozonReturnInfo

    if (ozonData) {
      marketplaceFound = true

      var hasReturn = !!(ozonReturnInfo?.return_reason_name || ozonReturnInfo?.status === 'return' || ozonReturnInfo?.status === 'returned' || ozonReturnInfo?.status === 'returning')

      // Priority: return → cancelled → delivered → processing
      if (hasReturn || ozonPosting?.status === 'cancelled') {
        marketplaceIsReturn = !!hasReturn
        marketplaceIsCancelled = !hasReturn && (ozonPosting?.status === 'cancelled')
        marketplaceIsDelivered = false
      } else if (ozonPosting?.status === 'delivered' || ozonPosting?.status === 'delivering') {
        marketplaceIsDelivered = true
        marketplaceIsCancelled = false
        marketplaceIsReturn = false
      }

      if (marketplaceIsReturn) {
        marketplaceStatus = 'return'
      } else if (marketplaceIsCancelled) {
        marketplaceStatus = 'cancelled'
      } else if (marketplaceIsDelivered) {
        marketplaceStatus = 'delivered'
      } else {
        marketplaceStatus = ozonPosting?.status || ''
      }
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
      recommendation = '✅ Оформить отгрузку' + (marketplaceSupplyId ? ' (' + marketplaceSupplyId + ')' : '')
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
    marketplaceSupplyId: marketplaceSupplyId,
    recommendation: recommendation,
    recommendationType: recommendationType,
    canDemand: canDemand,
    canCancel: canCancel,
    canReturn: canReturn
  }
}

module.exports = { scanNewOrders, recheckOrder, WB_COUNTERPARTY_ID, OZON_COUNTERPARTY_ID }
