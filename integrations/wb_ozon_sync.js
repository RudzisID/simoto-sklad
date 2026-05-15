'use strict'

// Real implementation for Wildberries / Ozon product sync
const https = require('https')
const { info, success, warn, error, debug } = require('../lib/logger')

// ──────────────────────────────────────────
// Ozon attribute name cache
// Ключ: `${descriptionCategoryId}_${typeId}`
// Значение: Map<attribute_id, name>
// ──────────────────────────────────────────
const attributesCache = new Map()

/**
 * Generic HTTPS request helper
 * Автоматически добавляет Content-Length при наличии тела запроса
 */
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    // Content-Length обязателен для Ozon API (не поддерживает chunked encoding)
    if (postData) {
      options.headers = options.headers || {}
      options.headers['Content-Length'] = Buffer.byteLength(postData)
    }
    // User-Agent для совместимости с API
    options.headers = options.headers || {}
    if (!options.headers['User-Agent']) {
      options.headers['User-Agent'] = 'SiMOTO/1.0'
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        debug(`[HTTP] ${options.method} ${options.hostname}${options.path} → ${res.statusCode}`)
        try {
          resolve({ 
            status: res.statusCode, 
            headers: res.headers, 
            body: JSON.parse(data) 
          })
        } catch (e) {
          // If not JSON, return raw text
          resolve({ 
            status: res.statusCode, 
            headers: res.headers, 
            body: data,
            isJSON: false 
          })
        }
      })
    })
    req.on('error', reject)
    if (postData) req.write(postData)
    req.end()
  })
}

/**
 * Wildberries: Search product by article (OEM)
 * Docs: https://dev.wildberries.ru/openapi/work-with-products/
 * Endpoint: POST /content/v2/get/cards/list
 * Search: textSearch (exact vendorCode match)
 */
async function fetchWBData(codes, token) {
  if (!token) return codes.map(code => ({ code, error: 'No WB token' }))

  const results = []
  
  for (const code of codes) {
    try {
      // WB Content API: correct endpoint and structure
      const body = JSON.stringify({
        settings: {
          filter: {
            textSearch: code,  // Exact vendorCode match only
            withPhoto: -1       // Return all cards regardless of photo status
          },
          cursor: {
            limit: 10
          }
        }
      })
      
      const options = {
        hostname: 'content-api.wildberries.ru',
        path: '/content/v2/get/cards/list',  // Correct endpoint for searching by vendorCode
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token
        }
      }
      
      info(`WB: Search for ${code} (textSearch=${code}, endpoint=${options.path})`)
      
      const response = await makeRequest(options, body)
      
      debug(`WB: Full Response for ${code}: ${JSON.stringify(response).substring(0, 1000)}`)
      
      // Check HTTP status
      if (response.status !== 200) {
        results.push({ 
          code, 
          error: `WB API Error: HTTP ${response.status}`, 
          details: response.body 
        })
        continue
      }
      
      // WB API response structure: { cards: [...] }
      const cards = response.body?.cards || []
      
      if (cards.length > 0) {
        const found = cards[0]
        // Price and stock are in sizes array
        // WB API returns price in cents (like MS), need to divide by 100
        const firstSize = found.sizes?.[0] || {}
        let wbPrice = firstSize.price ? firstSize.price / 100 : 0
        const barcode = firstSize.skus?.[0] || ''

        // Extract images from card.photos (WB: photos — верхнеуровневый массив фото)
        const wbImages = []
        debug(`[WB] photos debug for ${code}: type=${typeof found.photos}, isArray=${Array.isArray(found.photos)}, count=${Array.isArray(found.photos) ? found.photos.length : 'N/A'}`)
        debug(`[WB] media debug for ${code}: type=${typeof found.media}, isArray=${Array.isArray(found.media)}, count=${Array.isArray(found.media) ? found.media.length : 'N/A'}`)
        if (Array.isArray(found.photos) && found.photos.length > 0) {
          const first = found.photos[0]
          debug(`[WB] first photo keys: ${Object.keys(first).join(', ')}`)
          debug(`[WB] first photo: big=${String(first.big || '').substring(0, 120)}, c246x328=${String(first.c246x328 || '').substring(0, 120)}, url=${String(first.url || '').substring(0, 120)}`)
          if (found.photos.length >= 2) {
            const second = found.photos[1]
            debug(`[WB] second photo: big=${String(second.big || '').substring(0, 120)}, c246x328=${String(second.c246x328 || '').substring(0, 120)}`)
          }
          // Если photos содержит 1 элемент, а media больше — возможно все фото в media
          if (found.photos.length === 1 && Array.isArray(found.media) && found.media.length > 1) {
            warn(`[WB] photos has 1 item but media has ${found.media.length} — checking media for images`)
          }
          for (const photo of found.photos) {
            wbImages.push({
              url: photo.big || photo.url || '',
              c246x328: photo.c246x328 || '',
              c516x688: photo.c516x688 || '',
            })
          }
          success(`[WB] Extracted ${wbImages.length} images for ${code}`)
        } else {
          warn(`[WB] No images found for ${code} (photos: ${typeof found.photos}, media: ${typeof found.media})`)
        }

        // Try to get retail price from Prices API (more accurate)
        if (found.nmID) {
          const retailPrice = await fetchWBPrice(token, found.nmID)
          if (retailPrice !== null) {
            wbPrice = retailPrice
          }
        }

        results.push({
          code: found.vendorCode || code,
          title: found.title || 'N/A',
          price: wbPrice,
          site: 'Wildberries',
          vendorCode: found.vendorCode || '',
          brand: found.brand || '',
          nmID: found.nmID || '',
          barcode: barcode,
          description: found.description || '',
          characteristics: found.characteristics || [],
          subjectName: found.subjectName || '',
          images: wbImages,
        })
      } else {
        results.push({ 
          code, 
          error: 'Not found in WB',
          details: 'Product not found. Verify vendorCode exists and is not in trash. Try checking WB cabinet.'
        })
      }
    } catch (e) {
      error(`WB API Error: ${e.message}`)
      results.push({ code, error: e.message })
    }
  }
  
  return results
}

// ──────────────────────────────────────────
// Wildberries: Get retail price via Prices API
// Docs: https://dev.wildberries.ru/openapi/prices
// Endpoint: POST /api/v2/list/goods/filter (discounts-prices-api)
// Требуется токен с правом "Цены и скидки"
// ──────────────────────────────────────────
async function fetchWBPrice(token, nmID) {
  try {
    const options = {
      hostname: 'discounts-prices-api.wildberries.ru',
      path: '/api/v2/list/goods/filter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      }
    }

    const body = JSON.stringify({ nmIDs: [nmID] })
    const response = await makeRequest(options, body)

    if (response.status !== 200) {
      warn(`[WB] Price API: HTTP ${response.status}, using card price`)
      return null
    }

    const goods = response.body?.data?.listGoods || []
    if (goods.length > 0 && goods[0].price) {
      const retailPrice = goods[0].price / 100 // cents → rubles
      success(`[WB] Price API: nmID=${nmID}, retail price=${retailPrice} rub`)
      return retailPrice
    }

    return null
  } catch (e) {
    warn(`[WB] Price API error: ${e.message}, using card price`)
    return null
  }
}

/**
 * Ozon: Search product by offer_id (SKU/Article)
 * Docs: см. .opencode/context/external/ozon-api.md
 *
 * Ozon API не имеет прямого поиска по offer_id.
 * Используем двухшаговый подход:
 *   1. POST /v3/product/list — ищем offer_id по страницам
 *   2. POST /v3/product/info/list — детали по numeric product_id
 */
async function fetchOzonData(codes, clientId, apiKey) {
  if (!clientId || !apiKey) return codes.map(code => ({ code, error: 'No Ozon credentials' }))

  const results = []

  for (const code of codes) {
    try {
      // ── Шаг 1: Ищем product_id по offer_id через список товаров ──
      const productId = await findOzonProductIdByOfferId(code, clientId, apiKey)

      if (!productId) {
        results.push({ code, error: 'Not found in Ozon' })
        continue
      }

      // ── Шаг 2: Получаем детальную информацию по product_id ──
      const details = await getOzonProductInfo(productId, clientId, apiKey)

      if (!details) {
        results.push({ code, error: 'Product found but failed to get details' })
        continue
      }

      // Парсим цену (приходит строкой "2999.00")
      const price = parseFloat(details.price) || 0

      success(`[Ozon] Found ${code}: id=${productId}, price=${price} rub`)

      // ── Шаг 3: Получаем описание товара ──
      const description = await fetchOzonDescription(clientId, apiKey, productId, code)

      // ── Шаг 4: Получаем характеристики товара ──
      const attrData = await fetchOzonAttributes(clientId, apiKey, productId)

      // ── Извлекаем изображения ──
      let ozonImages = details.images || []
      // Debug: посмотреть, что приходит в details
      debug(`[Ozon] images debug for ${code}: count=${details.images?.length || 0}, primary=${typeof details.primary_image === 'string' ? details.primary_image.substring(0, 120) : JSON.stringify(details.primary_image)}`)
      // Ozon API отдаёт обложку (primary_image) отдельно от массива images[]
      if (details.primary_image && typeof details.primary_image === 'string') {
        if (ozonImages.length === 0 || ozonImages[0] !== details.primary_image) {
          debug(`[Ozon] Prepending primary_image to images array for ${code}`)
          ozonImages = [details.primary_image, ...ozonImages]
        }
      }
      debug(`[Ozon] Total images for ${code}: ${ozonImages.length}`)

      results.push({
        code: details.offer_id || code,
        title: details.name || 'N/A',
        price: price,
        site: 'Ozon',
        sku: details.id || productId,        // numeric product_id
        product_id: details.id || productId,  // для push-запросов
        description: description,
        attributes: attrData.attributes,
        dimensions: attrData.dimensions,
        images: ozonImages,
      })
    } catch (e) {
      error(`[Ozon] Error searching ${code}: ${e.message}`)
      results.push({ code, error: e.message })
    }
  }

  return results
}

/**
 * Поиск product_id по offer_id через /v3/product/list с фильтром offer_id
 * Docs: .opencode/context/external/ozon-api.md
 * 
 * /v3/product/list поддерживает прямую фильтрацию по offer_id:
 * { filter: { offer_id: ["SKU-001"], visibility: "ALL" }, limit: 100 }
 */
async function findOzonProductIdByOfferId(offerId, clientId, apiKey) {
  const options = {
    hostname: 'api-seller.ozon.ru',
    path: '/v3/product/list',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': clientId,
      'Api-Key': apiKey
    }
  }

  const postData = JSON.stringify({
    filter: {
      offer_id: [offerId],
      visibility: 'ALL'
    },
    limit: 100
  })

  const response = await makeRequest(options, postData)

  if (response.status !== 200) {
    const bodySnippet = typeof response.body === 'object'
      ? JSON.stringify(response.body).substring(0, 300)
      : String(response.body).substring(0, 300)
    throw new Error(`Ozon List API: HTTP ${response.status} — ${bodySnippet}`)
  }

  const items = response.body?.result?.items || []
  if (items.length > 0) {
    success(`[Ozon] Found product_id ${items[0].product_id} for offer_id ${offerId}`)
    return items[0].product_id
  }

  warn(`[Ozon] offer_id ${offerId} not found`)
  return null
}

/**
 * Получение детальной информации о товаре по product_id
 */
async function getOzonProductInfo(productId, clientId, apiKey) {
  const options = {
    hostname: 'api-seller.ozon.ru',
    path: '/v3/product/info/list',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': clientId,
      'Api-Key': apiKey
    }
  }

  const body = JSON.stringify({
    product_id: [Number(productId)],
    sku: []
  })

  const response = await makeRequest(options, body)

  if (response.status !== 200) {
    throw new Error(`Ozon Info API: HTTP ${response.status}`)
  }

  // v3 response: items — массив на верхнем уровне (не result.items)
  const items = response.body?.items || []
  return items.length > 0 ? items[0] : null
}

// ──────────────────────────────────────────
// Ozon: Get product description
// Docs: .opencode/context/external/ozon-api.md
// Endpoint: POST /v1/product/info/description
// ──────────────────────────────────────────
async function fetchOzonDescription(clientId, apiKey, productId, offerId) {
  try {
    const options = {
      hostname: 'api-seller.ozon.ru',
      path: '/v1/product/info/description',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': clientId,
        'Api-Key': apiKey
      }
    }

    const body = JSON.stringify({
      product_id: Number(productId),
      offer_id: offerId
    })

    const response = await makeRequest(options, body)

    if (response.status !== 200) {
      warn(`[Ozon] Description API: HTTP ${response.status}`)
      return ''
    }

    return response.body?.result?.description || ''
  } catch (e) {
    warn(`[Ozon] Description API error: ${e.message}`)
    return ''
  }
}

// ──────────────────────────────────────────
// Ozon: Get attribute names by description category
// Docs: .opencode/context/external/ozon-api.md
// Endpoint: POST /v1/description-category/attribute
// Возвращает Map<attribute_id, name> для подстановки имён атрибутов
// Результат кэшируется по ключу `${descriptionCategoryId}_${typeId}`
// ──────────────────────────────────────────
async function fetchOzonCategoryAttributes(clientId, apiKey, descriptionCategoryId, typeId) {
  const cacheKey = `${descriptionCategoryId}_${typeId}`

  // Проверяем кэш
  if (attributesCache.has(cacheKey)) {
    debug(`[Ozon] Attribute name cache HIT: ${cacheKey}`)
    return attributesCache.get(cacheKey)
  }

  info(`[Ozon] Attribute name cache MISS: ${cacheKey}, fetching...`)

  try {
    const options = {
      hostname: 'api-seller.ozon.ru',
      path: '/v1/description-category/attribute',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': clientId,
        'Api-Key': apiKey
      }
    }

    const body = JSON.stringify({
      description_category_id: descriptionCategoryId,
      type_id: typeId,
      language: 'DEFAULT'
    })

    const response = await makeRequest(options, body)

    if (response.status !== 200) {
      warn(`[Ozon] Category Attributes API: HTTP ${response.status}`)
      return new Map()
    }

    const result = response.body?.result || []
    const nameMap = new Map()

    for (const attr of result) {
      if (attr.id && attr.name) {
        nameMap.set(attr.id, attr.name)
      }
    }

    success(`[Ozon] Cached ${nameMap.size} attribute names for category ${descriptionCategoryId}`)
    attributesCache.set(cacheKey, nameMap)
    return nameMap
  } catch (e) {
    error(`[Ozon] Category Attributes API error: ${e.message}`)
    return new Map()
  }
}

// ──────────────────────────────────────────
// Ozon: Get product attributes (characteristics + dimensions)
// Docs: .opencode/context/external/ozon-api.md
// Endpoint: POST /v4/product/info/attributes
// Возвращает характеристики товара + габариты (weight, height, width, depth)
// Так же извлекает description_category_id и type_id для получения имён атрибутов
// ──────────────────────────────────────────
async function fetchOzonAttributes(clientId, apiKey, productId) {
  try {
    const options = {
      hostname: 'api-seller.ozon.ru',
      path: '/v4/product/info/attributes',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': clientId,
        'Api-Key': apiKey
      }
    }

    const body = JSON.stringify({
      filter: {
        product_id: [Number(productId)],
        visibility: 'ALL'
      },
      limit: 100
    })

    const response = await makeRequest(options, body)

    if (response.status !== 200) {
      warn(`[Ozon] Attributes API: HTTP ${response.status}`)
      return { attributes: [], dimensions: null }
    }

    const result = response.body?.result || []
    // result — массив, каждый элемент содержит attributes[] и поля габаритов
    if (result.length > 0) {
      const item = result[0]
      const attributes = item.attributes || []

      // Пытаемся получить имена атрибутов через /v1/description-category/attribute
      const descCategoryId = item.description_category_id
      const typeId = item.type_id
      let nameMap = null

      if (descCategoryId && typeId) {
        nameMap = await fetchOzonCategoryAttributes(clientId, apiKey, descCategoryId, typeId)
      }

      // Добавляем name к каждому атрибуту
      const enrichedAttributes = attributes.map(function(attr) {
        const attrId = attr.attribute_id || attr.id
        const name = (nameMap && nameMap.has(attrId)) ? nameMap.get(attrId) : ('ID:' + (attrId || '?'))
        return { ...attr, name: name, attribute_id: attrId }
      })

      return {
        attributes: enrichedAttributes,
        dimensions: {
          weight: item.weight || null,
          weight_unit: item.weight_unit || '',
          height: item.height || null,
          width: item.width || null,
          depth: item.depth || null,
          dimension_unit: item.dimension_unit || '',
        }
      }
    }

    return { attributes: [], dimensions: null }
  } catch (e) {
    error(`[Ozon] Attributes API error: ${e.message}`)
    return { attributes: [], dimensions: null }
  }
}

/**
 * Compare and aggregate data from WB and Ozon
 */
function compareAndAggregate(wbData, ozonData) {
  const map = new Map()
  
  wbData.forEach(p => {
    if (!p.error) map.set(p.code, { ...p, sources: ['WB'] })
  })
  
  ozonData.forEach(p => {
    if (p.error) return
    if (map.has(p.code)) {
      const existing = map.get(p.code)
      existing.price = Math.min(existing.price, p.price)
      existing.stock = existing.stock + p.stock
      existing.sources.push('Ozon')
    } else {
      map.set(p.code, { ...p, sources: ['Ozon'] })
    }
  })
  
  return Array.from(map.values())
}

// ──────────────────────────────────────────
// Wildberries: Push price update
// Docs: https://dev.wildberries.ru/openapi/prices
// Endpoint: POST /api/v2/upload/task
// ──────────────────────────────────────────
async function pushWBPrice(token, nmId, priceRub) {
  const body = JSON.stringify({
    data: [{
      nmID: nmId,
      price: Math.round(priceRub * 100) // WB expects price in cents
    }]
  })

  const options = {
    hostname: 'discounts-prices-api.wildberries.ru',
    path: '/api/v2/upload/task',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    }
  }

  const response = await makeRequest(options, body)
  if (response.status !== 200) {
    throw new Error(`WB Price API: HTTP ${response.status} — ${JSON.stringify(response.body)}`)
  }
  success(`[WB] Price updated for nmID ${nmId}: ${priceRub} rub`)
}

// ──────────────────────────────────────────
// Wildberries: Push stock update
// Docs: https://dev.wildberries.ru/openapi/stocks
// Endpoint: PUT /api/v2/stocks/stocks
// ──────────────────────────────────────────
async function pushWBStock(token, barcode, stock) {
  const body = JSON.stringify({
    stocks: [{
      sku: barcode,
      amount: stock
    }]
  })

  const options = {
    hostname: 'marketplace-api.wildberries.ru',
    path: '/api/v2/stocks/stocks',
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    }
  }

  const response = await makeRequest(options, body)
  if (response.status !== 200) {
    throw new Error(`WB Stocks API: HTTP ${response.status} — ${JSON.stringify(response.body)}`)
  }
  success(`[WB] Stock updated for barcode ${barcode}: ${stock} pcs`)
}

// ──────────────────────────────────────────
// Ozon: Push price update
// Docs: .opencode/context/external/ozon-api.md
// Endpoint: POST /v1/product/import/prices
// Важно: API принимает product_id (числовой), НЕ offer_id
// ──────────────────────────────────────────
async function pushOzonPrice(clientId, apiKey, productId, priceRub) {
  const body = JSON.stringify({
    prices: [{
      product_id: Number(productId),
      price: String(priceRub),
      currency_code: 'RUB'
    }]
  })

  const options = {
    hostname: 'api-seller.ozon.ru',
    path: '/v1/product/import/prices',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': clientId,
      'Api-Key': apiKey
    }
  }

  const response = await makeRequest(options, body)
  if (response.status !== 200) {
    throw new Error(`Ozon Price API: HTTP ${response.status} — ${JSON.stringify(response.body)}`)
  }
  success(`[Ozon] Price updated for product_id ${productId}: ${priceRub} rub`)
}

// ──────────────────────────────────────────
// Ozon: Push stock update
// Docs: .opencode/context/external/ozon-api.md
// Endpoint: POST /v2/products/stocks
// Принимает offer_id И/ИЛИ product_id
// ──────────────────────────────────────────
async function pushOzonStock(clientId, apiKey, offerId, productId, stock) {
  const stockEntry = { stock: stock }
  if (offerId) stockEntry.offer_id = offerId
  if (productId) stockEntry.product_id = Number(productId)

  const body = JSON.stringify({
    stocks: [stockEntry]
  })

  const options = {
    hostname: 'api-seller.ozon.ru',
    path: '/v2/products/stocks',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': clientId,
      'Api-Key': apiKey
    }
  }

  const response = await makeRequest(options, body)
  if (response.status !== 200) {
    throw new Error(`Ozon Stocks API: HTTP ${response.status} — ${JSON.stringify(response.body)}`)
  }
  success(`[Ozon] Stock updated for ${offerId || productId}: ${stock} pcs`)
}

// ──────────────────────────────────────────
// Ozon: Push product import (title, description, images)
// Docs: .opencode/context/external/ozon-api.md
// Endpoint: POST /v3/product/import
// ⚠ Асинхронная операция — возвращает task_id
// Принимает опциональный массив images (URL-строки)
// ──────────────────────────────────────────
async function pushOzonImport(clientId, apiKey, offerId, title, description, images) {
  const item = { offer_id: offerId }
  if (title) item.name = title
  if (description !== undefined) item.description = description
  if (images && Array.isArray(images) && images.length > 0) {
    item.images = images
  }

  const body = JSON.stringify({ items: [item] })

  const options = {
    hostname: 'api-seller.ozon.ru',
    path: '/v3/product/import',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': clientId,
      'Api-Key': apiKey
    }
  }

  const response = await makeRequest(options, body)
  if (response.status !== 200) {
    throw new Error(`Ozon Import API: HTTP ${response.status} — ${JSON.stringify(response.body)}`)
  }
  const imgCount = images && Array.isArray(images) ? images.length : 0
  success(`[Ozon] Product import task created for ${offerId}: title=${!!title}, desc=${!!description}, images=${imgCount}`)
}

// Alias for backward compatibility
const pushOzonTitle = pushOzonImport

// ──────────────────────────────────────────
// Wildberries: Update card data (description + characteristics)
// Docs: https://dev.wildberries.ru/openapi/work-with-products
// Endpoint: POST /content/v2/cards/upload
// ──────────────────────────────────────────
async function pushWBCard(token, nmID, vendorCode, description, characteristics) {
  const card = { nmID: nmID, vendorCode: vendorCode }
  if (description !== undefined) card.description = description
  if (characteristics && Array.isArray(characteristics)) {
    card.characteristics = characteristics
  }

  const body = JSON.stringify({ cards: [card] })

  const options = {
    hostname: 'content-api.wildberries.ru',
    path: '/content/v2/cards/upload',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    }
  }

  const response = await makeRequest(options, body)
  if (response.status !== 200) {
    throw new Error(`WB Card Upload: HTTP ${response.status} — ${JSON.stringify(response.body)}`)
  }
  success(`[WB] Card updated for nmID ${nmID}: desc=${description ? 'yes' : 'no'}, chars=${characteristics ? characteristics.length : 0}`)
}

// ──────────────────────────────────────────
// Ozon: Update product attributes (via attributes/update endpoint)
// Docs: .opencode/context/external/ozon-api.md
// Endpoint: POST /v1/product/attributes/update
// ──────────────────────────────────────────
async function pushOzonAttributes(clientId, apiKey, productId, attributes) {
  if (!attributes || !Array.isArray(attributes) || attributes.length === 0) return

  const body = JSON.stringify({
    items: [{
      product_id: Number(productId),
      attributes: attributes
    }]
  })

  const options = {
    hostname: 'api-seller.ozon.ru',
    path: '/v1/product/attributes/update',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': clientId,
      'Api-Key': apiKey
    }
  }

  const response = await makeRequest(options, body)
  if (response.status !== 200) {
    throw new Error(`Ozon Attributes Update: HTTP ${response.status} — ${JSON.stringify(response.body)}`)
  }
  success(`[Ozon] Attributes updated for product_id ${productId}: ${attributes.length} attrs`)
}

// ──────────────────────────────────────────
// Wildberries: Upload media files by URLs
// Docs: https://dev.wildberries.ru/openapi/content-service
// Endpoint: POST /content/v3/media/save
// Принимает массив URL-строк или объектов с полем url / big
// ──────────────────────────────────────────
async function pushWBMedia(token, nmId, images) {
  try {
    // Извлекаем URL из массива (поддерживает строки и объекты { url, name })
    const urls = (images || [])
      .map(img => {
        if (typeof img === 'string') return img
        if (img && typeof img.url === 'string') return img.url
        if (img && typeof img.big === 'string') return img.big
        return null
      })
      .filter(Boolean)

    if (urls.length === 0) {
      warn(`[WB] No valid image URLs to upload for nmID ${nmId}`)
      return null
    }

    const body = JSON.stringify({
      nmId: Number(nmId),
      data: urls
    })

    const options = {
      hostname: 'content-api.wildberries.ru',
      path: '/content/v3/media/save',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      }
    }

    info(`[WB] Uploading ${urls.length} images for nmID ${nmId}`)
    const response = await makeRequest(options, body)

    if (response.status !== 200) {
      throw new Error(`WB Media Save: HTTP ${response.status} — ${JSON.stringify(response.body)}`)
    }

    success(`[WB] Media saved for nmID ${nmId}: ${urls.length} images`)
    return response
  } catch (e) {
    error(`[WB] Media save error for nmID ${nmId}: ${e.message}`)
    throw e
  }
}

// ──────────────────────────────────────────
// Sync single image to Wildberries
// Reuses pushWBMedia with a single-element array
// ──────────────────────────────────────────
async function syncImageToWB(token, nmId, imageUrl) {
  try {
    if (!token) throw new Error('WB token is required')
    if (!nmId) throw new Error('nmId is required')
    if (!imageUrl) throw new Error('imageUrl is required')

    info(`[WB] Syncing image to nmID ${nmId}: ${imageUrl}`)

    const result = await pushWBMedia(token, nmId, [imageUrl])

    success(`[WB] Image synced to nmID ${nmId}`)
    return result
  } catch (e) {
    error(`[WB] Image sync error for nmID ${nmId}: ${e.message}`)
    throw e
  }
}

// ──────────────────────────────────────────
// Sync single image to Ozon
// Imports image URL via /v1/product/import
// Returns task_id from API response
// ──────────────────────────────────────────
async function syncImageToOzon(clientId, apiKey, offerId, imageUrl) {
  try {
    if (!clientId || !apiKey) throw new Error('Ozon credentials are required')
    if (!offerId) throw new Error('offerId is required')
    if (!imageUrl) throw new Error('imageUrl is required')

    info(`[Ozon] Syncing image to offer_id ${offerId}: ${imageUrl}`)

    const body = JSON.stringify({
      items: [{
        offer_id: offerId,
        images: [imageUrl]
      }]
    })

    const options = {
      hostname: 'api-seller.ozon.ru',
      path: '/v1/product/import',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': clientId,
        'Api-Key': apiKey
      }
    }

    const response = await makeRequest(options, body)

    if (response.status !== 200) {
      throw new Error(`Ozon Import API: HTTP ${response.status} — ${JSON.stringify(response.body)}`)
    }

    const taskId = response.body?.result?.task_id || null
    success(`[Ozon] Image sync task created for ${offerId}: task_id=${taskId}`)
    return taskId
  } catch (e) {
    error(`[Ozon] Image sync error for ${offerId}: ${e.message}`)
    throw e
  }
}

module.exports = {
  fetchWBData,
  fetchWBPrice,
  fetchOzonData,
  fetchOzonDescription,
  fetchOzonAttributes,
  fetchOzonCategoryAttributes,
  compareAndAggregate,
  pushWBPrice,
  pushWBStock,
  pushWBCard,
  pushWBMedia,
  pushOzonPrice,
  pushOzonStock,
  pushOzonImport,
  pushOzonTitle,
  pushOzonAttributes,
  syncImageToWB,
  syncImageToOzon
}
