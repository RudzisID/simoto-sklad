'use strict'

/**
 * @file Wildberries / Ozon — синхронизация товаров, цен, остатков, изображений и атрибутов
 * @module wb_ozon_sync
 * @description
 *   Модуль интеграции с API Wildberries (Content, Prices, Stocks, Statistics, Marketplace)
 *   и Ozon Seller API (Product, Import, Prices, Stocks, Returns, Postings).
 *   Реализует двухстороннюю синхронизацию данных между площадками:
 *   поиск товаров, получение/обновление цен, остатков, описаний, характеристик и изображений.
 *   Содержит retry-логику для обработки rate limiting (429) и таймаутов.
 *
 * @see https://dev.wildberries.ru/openapi/work-with-products
 * @see https://docs.ozon.ru/api/seller
 */

// Real implementation for Wildberries / Ozon product sync
const https = require('https')
const { info, success, warn, error, debug } = require('../lib/logger')

/**
 * Кэш названий атрибутов Ozon
 * Ключ: `${descriptionCategoryId}_${typeId}`
 * Значение: Map<attribute_id (number), name (string)>
 * Заполняется в fetchOzonCategoryAttributes
 * @type {Map<string, Map<number, string>>}
 */
const attributesCache = new Map()

/**
 * Базовый помощник для HTTPS-запросов
 * Автоматически добавляет Content-Length при наличии тела запроса.
 * Устанавливает User-Agent, таймаут 30 с. Возвращает разобранный JSON
 * или сырой текст, если ответ не в JSON.
 *
 * @param {object} options - Параметры https.request (hostname, path, method, headers)
 * @param {string|null} [postData=null] - Строка тела POST-запроса (JSON)
 * @returns {Promise<{status: number, headers: object, body: any, isJSON?: boolean}>}
 *   Объект ответа: HTTP-статус, заголовки, тело (JSON или текст), флаг isJSON
 * @throws {Error} При превышении таймаута 30 с или сетевой ошибке
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
    req.setTimeout(30000, () => {
      req.destroy()
      reject(new Error(`Request timeout: ${options.method} ${options.hostname}${options.path}`))
    })
    req.on('error', reject)
    if (postData) req.write(postData)
    req.end()
  })
}

/**
 * Wildberries: поиск товаров по артикулам (vendorCode)
 * Endpoint: POST /content/v2/get/cards/list (Content API)
 * Поиск по textSearch — точное совпадение vendorCode.
 * Для каждого найденного товара также запрашивает розничную цену
 * через Prices API (см. fetchWBPrice).
 *
 * @param {string[]} codes - Массив артикулов (vendorCode) для поиска
 * @param {string} token - WB API токен (Authorization header)
 * @returns {Promise<Array<{
 *   code: string,
 *   title: string,
 *   price: number,
 *   site: string,
 *   vendorCode: string,
 *   brand: string,
 *   nmID: number|string,
 *   barcode: string,
 *   description: string,
 *   characteristics: Array,
 *   subjectName: string,
 *   images: Array<{url: string, c246x328: string, c516x688: string}>,
 *   error?: string,
 *   details?: string
 * }>>} Массив результатов поиска по каждому коду
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
        // media field does not exist in WB API response — removed
        if (Array.isArray(found.photos) && found.photos.length > 0) {
          const first = found.photos[0]
          debug(`[WB] first photo keys: ${Object.keys(first).join(', ')}`)
          debug(`[WB] first photo: big=${String(first.big || '').substring(0, 120)}, c246x328=${String(first.c246x328 || '').substring(0, 120)}, url=${String(first.url || '').substring(0, 120)}`)
          if (found.photos.length >= 2) {
            const second = found.photos[1]
            debug(`[WB] second photo: big=${String(second.big || '').substring(0, 120)}, c246x328=${String(second.c246x328 || '').substring(0, 120)}`)
          }
          // media field does not exist in WB API response — removed
          for (const photo of found.photos) {
            wbImages.push({
              url: photo.big || photo.url || '',
              c246x328: photo.c246x328 || '',
              c516x688: photo.c516x688 || '',
            })
          }
          success(`[WB] Extracted ${wbImages.length} images for ${code}`)
        } else {
          warn(`[WB] No images found for ${code} (photos: ${typeof found.photos})`)
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

/**
 * Wildberries: получение розничной цены товара через Prices API
 * Endpoint: POST /api/v2/list/goods/filter (discounts-prices-api)
 * Требуется токен с правом "Цены и скидки"
 * Цена возвращается в рублях (API отдаёт в копейках — деление на 100)
 *
 * @param {string} token - WB API токен (с правом доступа к ценам)
 * @param {number} nmID - Идентификатор товара WB (nmID)
 * @returns {Promise<number|null>} Цена в рублях или null при ошибке/отсутствии
 */
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
 * Wildberries: получение полной информации о товаре по артикулу
 * Комбинирует fetchWBData (поиск карточки) и fetchWBPrice (розничная цена).
 *
 * @param {string} token - WB API токен
 * @param {string} vendorCode - Артикул товара (vendorCode)
 * @returns {Promise<{
 *   code: string,
 *   title: string,
 *   price: number,
 *   brand: string,
 *   nmID: string,
 *   barcode: string,
 *   description: string,
 *   characteristics: Array,
 *   images: Array,
 *   subjectName: string,
 *   vendorCode: string,
 *   error?: string
 * }>} Полные данные товара или { error: 'Not found in WB' }
 */
async function fetchWBProductFull(token, vendorCode) {
  const results = await fetchWBData([vendorCode], token)
  const product = results[0]

  if (!product || product.error) {
    return { error: 'Not found in WB' }
  }

  if (product.nmID) {
    const retailPrice = await fetchWBPrice(token, product.nmID)
    if (retailPrice !== null) {
      product.price = retailPrice
    }
  }

  return {
    code: product.code,
    title: product.title,
    price: product.price,
    brand: product.brand,
    nmID: product.nmID,
    barcode: product.barcode,
    description: product.description,
    characteristics: product.characteristics,
    images: product.images,
    subjectName: product.subjectName,
    vendorCode: product.vendorCode,
  }
}

/**
 * Ozon: поиск товаров по offer_id (артикулам)
 * Двухшаговый подход:
 *   1. POST /v3/product/list — поиск product_id по offer_id
 *   2. POST /v3/product/info/list — детали по числовому product_id
 * Дополнительно получает описание (fetchOzonDescription),
 * характеристики/габариты (fetchOzonAttributes) и изображения.
 *
 * @param {string[]} codes - Массив артикулов (offer_id) для поиска
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @returns {Promise<Array<{
 *   code: string,
 *   title: string,
 *   price: number,
 *   site: string,
 *   sku: number,
 *   product_id: number,
 *   type_id: number,
 *   description: string,
 *   attributes: Array,
 *   dimensions: object|null,
 *   images: string[],
 *   error?: string
 * }>>} Массив результатов поиска по каждому коду
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
      var primaryDbg = ''
      if (typeof details.primary_image === 'string') primaryDbg = details.primary_image.substring(0, 120)
      else if (Array.isArray(details.primary_image)) primaryDbg = 'array[' + details.primary_image.length + ']'
      else primaryDbg = JSON.stringify(details.primary_image)
      debug(`[Ozon] images debug for ${code}: count=${details.images?.length || 0}, primary=${primaryDbg}`)
      // Ozon API отдаёт обложку (primary_image) отдельно от массива images[]
      let primaryUrl = null
      if (typeof details.primary_image === 'string') {
        primaryUrl = details.primary_image
      } else if (Array.isArray(details.primary_image) && details.primary_image.length > 0) {
        primaryUrl = details.primary_image[0]
      }
      if (primaryUrl && (ozonImages.length === 0 || ozonImages[0] !== primaryUrl)) {
        debug(`[Ozon] Prepending primary_image to images array for ${code}`)
        ozonImages = [primaryUrl, ...ozonImages]
      }
      debug(`[Ozon] Total images for ${code}: ${ozonImages.length}`)

      results.push({
        code: details.offer_id || code,
        title: details.name || 'N/A',
        price: price,
        site: 'Ozon',
        sku: details.id || productId,
        product_id: details.id || productId,
        type_id: details.type_id,            // required for /v3/product/import
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
 * Ozon: получение полной информации о товаре по offer_id
 * Комбинирует findOzonProductIdByOfferId, getOzonProductInfo,
 * fetchOzonDescription и fetchOzonAttributes.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {string} offerId - Артикул товара (offer_id)
 * @returns {Promise<object|null>} Полные данные товара:
 *   { offer_id, product_id, type_id, name, price, description, images, attributes, dimensions }
 *   или null, если товар не найден или ошибка получения деталей
 */
async function fetchOzonProductFull(clientId, apiKey, offerId) {
  const productId = await findOzonProductIdByOfferId(offerId, clientId, apiKey)
  if (!productId) return null

  const details = await getOzonProductInfo(productId, clientId, apiKey)
  if (!details) return null

  const description = await fetchOzonDescription(clientId, apiKey, productId, offerId)
  const attrData = await fetchOzonAttributes(clientId, apiKey, productId)

  let ozonImages = details.images || []
  if (typeof details.primary_image === 'string') {
    ozonImages = [details.primary_image, ...ozonImages]
  } else if (Array.isArray(details.primary_image) && details.primary_image.length > 0) {
    ozonImages = [details.primary_image[0], ...ozonImages]
  }

  return {
    offer_id: details.offer_id || offerId,
    product_id: productId,
    type_id: details.type_id,
    name: details.name || '',
    price: parseFloat(details.price) || 0,
    description,
    images: ozonImages,
    attributes: attrData.attributes,
    dimensions: attrData.dimensions,
  }
}

/**
 * Ozon: поиск числового product_id по строковому offer_id
 * Endpoint: POST /v3/product/list с фильтром offer_id
 * Фильтр: { offer_id: ["SKU-001"], visibility: "ALL" }
 *
 * @param {string} offerId - Артикул товара (offer_id)
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @returns {Promise<number|null>} Числовой product_id или null, если не найден
 * @throws {Error} При HTTP-статусе, отличном от 200
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
 * Ozon: получение детальной информации о товаре по числовому product_id
 * Endpoint: POST /v3/product/info/list
 *
 * @param {number} productId - Числовой идентификатор товара Ozon
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @returns {Promise<object|null>} Объект товара (items[0]) или null, если не найден
 * @throws {Error} При HTTP-статусе, отличном от 200
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

/**
 * Ozon: получение описания товара
 * Endpoint: POST /v1/product/info/description
 * При ошибке возвращает пустую строку (не бросает исключение).
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {number} productId - Числовой идентификатор товара
 * @param {string} offerId - Артикул товара (offer_id)
 * @returns {Promise<string>} HTML-описание товара или пустая строка
 */
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

/**
 * Ozon: получение названий атрибутов категории описания
 * Endpoint: POST /v1/description-category/attribute
 * Возвращает Map<attribute_id, name> для подстановки имён атрибутов.
 * Результат кэшируется в attributesCache по ключу `${descriptionCategoryId}_${typeId}`.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {number} descriptionCategoryId - ID категории описания
 * @param {number} typeId - ID типа товара
 * @returns {Promise<Map<number, string>>} Map { attribute_id → name }
 */
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

/**
 * Ozon: получение характеристик и габаритов товара
 * Endpoint: POST /v4/product/info/attributes
 * Возвращает обогащённый массив атрибутов (с подстановкой имён
 * через fetchOzonCategoryAttributes) и объект габаритов.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {number} productId - Числовой идентификатор товара
 * @returns {Promise<{
 *   attributes: Array<{attribute_id: number, name: string, ...}>,
 *   dimensions: {weight: number|null, weight_unit: string, height: number|null, width: number|null, depth: number|null, dimension_unit: string}|null
 * }>} Характеристики и габариты товара
 */
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
 * Сравнение и агрегация данных из WB и Ozon.
 * Объединяет результаты поиска по обеим площадкам в единый массив.
 * Если товар найден на обеих площадках — берётся минимальная цена
 * и суммируются остатки.
 *
 * @param {Array} wbData - Результаты поиска по WB (из fetchWBData)
 * @param {Array} ozonData - Результаты поиска по Ozon (из fetchOzonData)
 * @returns {Array<{code: string, sources: string[], ...}>}
 *   Агрегированный массив с полем sources (['WB'], ['Ozon'] или ['WB', 'Ozon'])
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

/**
 * Wildberries: обновление цены товара
 * Endpoint: POST /api/v2/upload/task (discounts-prices-api)
 * Цена передаётся в рублях, API ожидает в копейках (умножение на 100).
 *
 * @param {string} token - WB API токен (с правом "Цены и скидки")
 * @param {number} nmId - nmID товара WB
 * @param {number} priceRub - Новая цена в рублях
 * @returns {Promise<void>}
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
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

/**
 * Wildberries: обновление остатков товара
 * Endpoint: PUT /api/v2/stocks/stocks (marketplace-api)
 *
 * @param {string} token - WB API токен (с правами на управление остатками)
 * @param {string} barcode - Штрихкод товара (SKU)
 * @param {number} stock - Количество остатка
 * @returns {Promise<void>}
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
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

/**
 * Ozon: обновление цены товара
 * Endpoint: POST /v1/product/import/prices
 * Важно: API принимает числовой product_id (НЕ offer_id).
 * Цена передаётся строкой в рублях.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {number} productId - Числовой идентификатор товара Ozon
 * @param {number} priceRub - Новая цена в рублях
 * @returns {Promise<void>}
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
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

/**
 * Ozon: обновление остатков товара
 * Endpoint: POST /v2/products/stocks
 * Принимает offer_id И/ИЛИ product_id (хотя бы один обязателен).
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {string|null} offerId - Артикул товара (offer_id) или null
 * @param {number|null} productId - Числовой идентификатор товара или null
 * @param {number} stock - Количество остатка
 * @returns {Promise<void>}
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
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

/**
 * Ozon: импорт/обновление товара (название, описание, изображения)
 * Endpoint: POST /v3/product/import
 * Асинхронная операция — возвращает task_id для отслеживания статуса.
 * Если товар уже существует, загружает текущие данные через fetchOzonProductFull
 * и мержит с переданными полями (частичное обновление).
 * Запускает checkOzonImportStatus для отслеживания результата (неблокирующий).
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {string} offerId - Артикул товара (offer_id)
 * @param {string} [title] - Новое название товара
 * @param {string} [description] - Новое описание товара
 * @param {string[]} [images] - Массив URL изображений
 * @param {number} [typeId] - ID типа товара Ozon
 * @returns {Promise<void>}
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
async function pushOzonImport(clientId, apiKey, offerId, title, description, images, typeId) {
  let item

  try {
    const current = await fetchOzonProductFull(clientId, apiKey, offerId)
    if (current) {
      item = {
        offer_id: offerId,
        name: title || current.name,
        description: description !== undefined ? description : current.description,
        price: current.price,
        type_id: typeId || current.type_id,
        weight: current.dimensions?.weight,
        weight_unit: current.dimensions?.weight_unit,
        height: current.dimensions?.height,
        width: current.dimensions?.width,
        depth: current.dimensions?.depth,
        dimension_unit: current.dimensions?.dimension_unit,
        images: (images && images.length > 0) ? images : current.images,
        attributes: current.attributes,
      }
    }
  } catch (e) {
    warn(`[Ozon] fetchOzonProductFull failed for ${offerId}, using fallback: ${e.message}`)
  }

  if (!item) {
    item = { offer_id: offerId }
    if (typeId) item.type_id = typeId
    if (title) item.name = title
    if (description !== undefined) item.description = description
    if (images && Array.isArray(images) && images.length > 0) {
      item.images = images
    }
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

  const imgCount = item.images && Array.isArray(item.images) ? item.images.length : 0

  const taskId = response.body && response.body.result && response.body.result.task_id

  if (taskId) {
    success(`[Ozon] Import task created: ${taskId} for ${offerId}: title=${!!title}, desc=${!!description}, images=${imgCount}`)
    checkOzonImportStatus(clientId, apiKey, taskId, offerId)
  } else {
    success(`[Ozon] Product import task created for ${offerId}: title=${!!title}, desc=${!!description}, images=${imgCount}`)
  }
}

/**
 * Ozon: проверка статуса задачи импорта товара
 * Endpoint: POST /v1/product/import/info
 * Выполняется с задержкой 3 секунды перед запросом.
 * Неблокирующая — логирует результат, но не бросает исключения.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {string} taskId - ID задачи импорта (из ответа pushOzonImport)
 * @param {string} offerId - Артикул товара (для логирования)
 * @returns {Promise<void>}
 */
async function checkOzonImportStatus(clientId, apiKey, taskId, offerId) {
  try {
    await new Promise(r => setTimeout(r, 3000))

    const statusBody = JSON.stringify({ task_id: taskId })
    const statusOptions = {
      hostname: 'api-seller.ozon.ru',
      path: '/v1/product/import/info',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': clientId,
        'Api-Key': apiKey
      }
    }

    const statusRes = await makeRequest(statusOptions, statusBody)
    debug(`[Ozon] Import status response for task ${taskId}: status=${statusRes.status}, body=${JSON.stringify(statusRes.body)}`)
    if (statusRes.status !== 200) {
      warn(`[Ozon] Import status check failed for task ${taskId}: HTTP ${statusRes.status}`)
      return
    }

    // Extract items from response: { result: { items: [...], total: N } }
    const items = statusRes.body && statusRes.body.result && statusRes.body.result.items
    if (!items || !Array.isArray(items) || items.length === 0) {
      warn(`[Ozon] Import status check: no items for task ${taskId}`)
      return
    }
    // Assuming we queried for a single task_id, take the first item
    const task = items[0]
    const status = task.status || 'unknown'

    if (status === 'imported') {
      success(`[Ozon] Import task ${taskId} completed successfully (${offerId})`)
    } else if (status === 'imported_with_errors') {
      warn(`[Ozon] Import task ${taskId} completed with errors (${offerId}): ${task.error || 'unknown'}`)
    } else if (status === 'failed') {
      error(`[Ozon] Import task ${taskId} FAILED (${offerId}): ${task.error || 'unknown error'}`)
    } else {
      info(`[Ozon] Import task ${taskId} status: ${status} (${offerId}) — task still processing, check later`)
    }
  } catch (e) {
    warn(`[Ozon] Import status check error for task ${taskId}: ${e.message}`)
  }
}

// Alias for backward compatibility
const pushOzonTitle = pushOzonImport

/**
 * Wildberries: обновление карточки товара (описание + характеристики)
 * Endpoint: POST /content/v2/cards/upload (Content API)
 * Если карточка существует, загружает текущие данные через fetchWBProductFull
 * и мержит с переданными полями (частичное обновление).
 *
 * @param {string} token - WB API токен
 * @param {number} nmID - nmID товара WB
 * @param {string} vendorCode - Артикул товара (vendorCode)
 * @param {string} [description] - Новое описание товара
 * @param {Array} [characteristics] - Массив характеристик
 * @returns {Promise<void>}
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
async function pushWBCard(token, nmID, vendorCode, description, characteristics) {
  let current = null
  try {
    current = await fetchWBProductFull(token, vendorCode)
    if (current && current.error) current = null
  } catch (e) {
    current = null
  }

  const card = { nmID: nmID, vendorCode: vendorCode }
  card.description = description !== undefined ? description : (current ? current.description : description)
  card.characteristics = (characteristics && Array.isArray(characteristics) && characteristics.length > 0)
    ? characteristics
    : (current && current.characteristics ? current.characteristics : characteristics)

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

/**
 * Wildberries: загрузка изображений товара по URL
 * Endpoint: POST /content/v3/media/save (Content API)
 * Принимает массив URL-строк или объектов с полями url / big.
 *
 * @param {string} token - WB API токен
 * @param {number} nmId - nmID товара WB
 * @param {Array} images - Массив URL изображений (строки или объекты {url, big})
 * @returns {Promise<object|null>} Ответ API или null, если нет валидных URL
 * @throws {Error} При HTTP-статусе, отличном от 200, или сетевой ошибке
 */
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

/**
 * Sync: синхронизация одного изображения на Wildberries
 * Делегирует pushWBMedia с массивом из одного URL.
 *
 * @param {string} token - WB API токен
 * @param {number} nmId - nmID товара WB
 * @param {string} imageUrl - URL изображения для загрузки
 * @returns {Promise<object|null>} Ответ от pushWBMedia
 * @throws {Error} При отсутствии token, nmId или imageUrl, а также при ошибке API
 */
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

/**
 * Sync: синхронизация одного изображения на Ozon
 * Импортирует URL изображения через /v1/product/import.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {string} offerId - Артикул товара (offer_id)
 * @param {string} imageUrl - URL изображения для загрузки
 * @returns {Promise<string|null>} task_id задачи импорта или null
 * @throws {Error} При отсутствии credentials/offerId/imageUrl или ошибке API
 */
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

/**
 * WB: поиск сборочного задания по коду стикера возврата
 * Endpoint: GET /api/v1/supplier/sales (statistics-api)
 * Ищет по sticker среди продаж за последние daysBack дней.
 *
 * @param {string} stickerCode - Код стикера с возвратной наклейки (например, "51250075718")
 * @param {string} token - WB API токен (raw, без Bearer — statistics-api)
 * @param {number} [daysBack=90] - На сколько дней назад искать
 * @returns {Promise<{srid: string|null, gNumber: string|null, nmId: string|null}>}
 *   Объект с srid, gNumber и nmId найденного заказа или null-поля
 */
async function fetchWBOrderBySticker(stickerCode, token, daysBack = 90) {
  const dateFrom = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  // flag=0: все записи с lastChangeDate >= dateFrom (до 80 000 строк), включая возвраты
  const path = `/api/v1/supplier/sales?dateFrom=${dateFrom}&flag=0`

  const res = await makeRequest({
    hostname: 'statistics-api.wildberries.ru',
    path,
    method: 'GET',
    headers: { 'Authorization': token } // statistics-api: raw token, без Bearer
  })

  if (res.status !== 200 || !Array.isArray(res.body)) {
    return { srid: null, gNumber: null, nmId: null }
  }

  const found = res.body.find(s => String(s.sticker) === String(stickerCode))
  if (!found) return { srid: null, gNumber: null, nmId: null }

  return {
    srid: found.srid || null,
    gNumber: found.gNumber || null,
    nmId: String(found.nmId || '')
  }
}

/**
 * WB: получение номера сборочного задания (orderId) по srid
 * Endpoint: GET /api/v3/orders (marketplace-api)
 * Извлекает orderUid из srid, перебирает заказы постранично.
 *
 * @param {string} srid - Уникальный идентификатор из отчёта продаж (например, "eAz.rdf3f976...04")
 * @param {string} token - WB API токен (с Bearer — marketplace-api)
 * @returns {Promise<string|null>} ID сборочного задания (orderId) или null
 */
async function fetchWBOrderIdBySrid(srid, token) {
  // Извлекаем orderUid из srid: "eAz.ORDERUID" → "ORDERUID"
  // или "eAz.ORDERUID.0.0" → "ORDERUID"
  const parts = srid.split('.')
  const orderUid = parts.length >= 2 ? parts[1] : null
  if (!orderUid) return null

  const bearer = token.startsWith('Bearer ') ? token : 'Bearer ' + token
  let next = 0
  const limit = 1000

  while (next !== null) {
    const path = `/api/v3/orders?next=${next}&limit=${limit}`
    const res = await makeRequest({
      hostname: 'marketplace-api.wildberries.ru',
      path,
      method: 'GET',
      headers: { 'Authorization': bearer }
    })

    if (res.status !== 200 || !res.body || !Array.isArray(res.body.orders)) break

    const matched = res.body.orders.find(order => order.rid && order.rid.includes(orderUid))
    if (matched) return String(matched.id)

    next = res.body.next
    if (next === undefined || next === null) break
  }

  return null
}

// ──────────────────────────────────────────
// Ozon: Returns & Postings API
// ──────────────────────────────────────────

/**
 * Ozon: выполнение HTTP-запроса с повторными попытками при rate limiting (429).
 * Читает заголовок Retry-After, при отсутствии ждёт 60 с.
 * Максимум {maxRetries} повторных попыток.
 *
 * @param {string} hostname - Хост API (например, 'api-seller.ozon.ru')
 * @param {string} path - Путь эндпоинта (например, '/v1/returns/list')
 * @param {string} method - HTTP-метод (GET, POST, PUT)
 * @param {object} headers - Заголовки запроса
 * @param {string} [body] - Тело запроса (JSON-строка)
 * @param {number} [maxRetries=3] - Максимальное количество повторных попыток
 * @returns {Promise<{status: number, headers: object, body: any}>} Ответ API
 * @throws {Error} Если превышено максимальное количество попыток (429)
 */
async function ozonRequestWithRetry(hostname, path, method, headers, body, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await makeRequest({ hostname, path, method, headers }, body)

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(
        response.headers && response.headers['retry-after'],
        10
      ) || 60
      warn(`[Ozon] Rate limited (429), retrying after ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})`)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      continue
    }

    return response
  }

  throw new Error('Ozon API: max retries exceeded (429)')
}

/**
 * Ozon: получение списка возвратов
 * Endpoint: POST /v1/returns/list
 * Курсорная пагинация через last_id.
 * Фильтр по дате возврата: от daysBack дней назад до текущего момента.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {number} [daysBack=120] - Количество дней назад для поиска возвратов
 * @returns {Promise<Array<{
 *   id: number,
 *   posting_number: string,
 *   order_id: number,
 *   order_number: string,
 *   return_reason_name: string,
 *   type: string,
 *   schema: string,
 *   barcode: string,
 *   offer_id: string,
 *   product_name: string,
 *   product_price: number,
 *   status_display: string,
 *   status_sys: string,
 *   return_date: string
 * }>>} Массив возвратов
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
async function fetchOzonReturnsList(clientId, apiKey, daysBack = 120) {
  const returns = []
  const now = new Date()
  const from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000)

  const pad = n => String(n).padStart(2, '0')
  const timeFrom = `${from.getUTCFullYear()}-${pad(from.getUTCMonth() + 1)}-${pad(from.getUTCDate())}T00:00:00Z`
  const timeTo = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T23:59:59Z`

  const headers = {
    'Content-Type': 'application/json',
    'Client-Id': clientId,
    'Api-Key': apiKey
  }

  info(`[Ozon] Fetching returns from ${timeFrom} to ${timeTo}...`)

  let lastId = 0
  let hasNext = true

  try {
    while (hasNext) {
      const body = JSON.stringify({
        filter: {
          logistic_return_date: {
            time_from: timeFrom,
            time_to: timeTo
          }
        },
        limit: 500,
        last_id: lastId
      })

      const response = await ozonRequestWithRetry(
        'api-seller.ozon.ru',
        '/v1/returns/list',
        'POST',
        headers,
        body
      )

      if (response.status !== 200) {
        const snippet = typeof response.body === 'object'
          ? JSON.stringify(response.body).substring(0, 300)
          : String(response.body).substring(0, 300)
        throw new Error(`Ozon Returns List API: HTTP ${response.status} — ${snippet}`)
      }

      const items = response.body?.result?.returns || response.body?.returns || []
      for (const ret of items) {
        returns.push({
          id: ret.id,
          posting_number: ret.posting_number || '',
          order_id: ret.order_id,
          order_number: ret.order_number || '',
          return_reason_name: ret.return_reason_name || '',
          type: ret.type || '',
          schema: ret.schema || '',
          barcode: (ret.logistic && ret.logistic.barcode) || '',
          offer_id: (ret.product && ret.product.offer_id) || '',
          product_name: (ret.product && ret.product.name) || '',
          product_price: (ret.product && ret.product.price && ret.product.price.price) || 0,
          status_display: (ret.visual && ret.visual.status && ret.visual.status.display_name) || '',
          status_sys: (ret.visual && ret.visual.status && ret.visual.status.sys_name) || '',
          return_date: (ret.logistic && ret.logistic.return_date) || ''
        })
      }

      hasNext = response.body?.result?.has_next === true && items.length > 0
      if (hasNext && items.length > 0) {
        lastId = items[items.length - 1].id
        await new Promise(r => setTimeout(r, 1000))
      } else {
        hasNext = false
      }
    }

    success(`[Ozon] Fetched ${returns.length} returns (daysBack=${daysBack})`)
    return returns
  } catch (e) {
    error(`[Ozon] fetchOzonReturnsList error: ${e.message}`)
    throw e
  }
}

/**
 * Ozon: получение списка FBS-отправлений
 * Endpoint: POST /v3/posting/fbs/list
 * Постраничная пагинация через offset.
 * Фильтр по дате: от daysBack дней назад до текущего момента.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {number} [daysBack=120] - Количество дней назад для поиска отправлений
 * @returns {Promise<Array<{
 *   posting_number: string,
 *   order_id: number,
 *   status: string,
 *   products: Array<{offer_id: string, name: string, price: string, sku: number, quantity: number}>,
 *   shipment_date: string,
 *   delivering_date: string,
 *   price: number
 * }>>} Массив отправлений FBS
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
async function fetchOzonPostingsList(clientId, apiKey, daysBack = 120) {
  const postings = []
  const now = new Date()
  const from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000)

  const pad = n => String(n).padStart(2, '0')
  const since = `${from.getUTCFullYear()}-${pad(from.getUTCMonth() + 1)}-${pad(from.getUTCDate())}T00:00:00.000Z`
  const to = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T23:59:59.000Z`

  const headers = {
    'Content-Type': 'application/json',
    'Client-Id': clientId,
    'Api-Key': apiKey
  }

  let offset = 0
  const limit = 1000
  let hasNext = true

  try {
    while (hasNext) {
      const body = JSON.stringify({
        filter: { since, to },
        dir: 'ASC',
        offset,
        limit,
        with: {
          analytics_data: true,
          barcodes: true,
          financial_data: true,
          translit: true
        }
      })

      const response = await ozonRequestWithRetry(
        'api-seller.ozon.ru',
        '/v3/posting/fbs/list',
        'POST',
        headers,
        body
      )

      if (response.status !== 200) {
        const snippet = typeof response.body === 'object'
          ? JSON.stringify(response.body).substring(0, 300)
          : String(response.body).substring(0, 300)
        throw new Error(`Ozon Postings List API: HTTP ${response.status} — ${snippet}`)
      }

      const items = response.body && response.body.result && response.body.result.postings
        ? response.body.result.postings
        : []
      for (const post of items) {
        const firstProduct = post.products && post.products.length > 0 ? post.products[0] : null
        postings.push({
          posting_number: post.posting_number || '',
          order_id: post.order_id,
          status: post.status || '',
          products: (post.products || []).map(p => ({
            offer_id: p.offer_id || '',
            name: p.name || '',
            price: p.price || '0',
            sku: p.sku,
            quantity: p.quantity || 0
          })),
          shipment_date: post.shipment_date || '',
          delivering_date: post.delivering_date || '',
          price: firstProduct ? parseFloat(firstProduct.price) || 0 : 0,
          is_return: post.analytics_data?.is_return ?? false,
          is_cancel: post.analytics_data?.is_cancel ?? false
        })
      }

      hasNext = response.body && response.body.result && response.body.result.has_next === true && items.length >= limit
      if (hasNext) {
        offset += limit
        await new Promise(r => setTimeout(r, 1000))
      } else {
        hasNext = false
      }
    }

    success(`[Ozon] Fetched ${postings.length} postings (daysBack=${daysBack})`)
    return postings
  } catch (e) {
    error(`[Ozon] fetchOzonPostingsList error: ${e.message}`)
    throw e
  }
}

/**
 * Ozon: получение деталей одного FBS-отправления
 * Endpoint: POST /v3/posting/fbs/get
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {string} postingNumber - Номер отправления FBS
 * @returns {Promise<Object|null>} Объект отправления или null при ошибке
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
async function fetchOzonPostingDetail(clientId, apiKey, postingNumber) {
  const headers = {
    'Content-Type': 'application/json',
    'Client-Id': clientId,
    'Api-Key': apiKey
  }

  try {
    const body = JSON.stringify({
      posting_number: postingNumber,
      with: {
        analytics_data: true,
        financial_data: true
      }
    })

    const response = await ozonRequestWithRetry(
      'api-seller.ozon.ru',
      '/v3/posting/fbs/get',
      'POST',
      headers,
      body
    )

    if (response.status !== 200) {
      const snippet = typeof response.body === 'object'
        ? JSON.stringify(response.body).substring(0, 300)
        : String(response.body).substring(0, 300)
      throw new Error(`Ozon Posting Detail API: HTTP ${response.status} — ${snippet}`)
    }

    if (!response.body || !response.body.result) return null
    return response.body.result
  } catch (e) {
    error(`[Ozon] fetchOzonPostingDetail error: ${e.message}`)
    return null
  }
}

/**
 * Ozon: поиск возврата по штрихкоду
 * Endpoint: POST /v1/returns/list с фильтром barcode
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {string} barcode - Штрихкод возврата (например, "ii5275210303")
 * @returns {Promise<Object|null>} Найденный возврат в упрощённом формате или null
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
async function fetchOzonReturnByBarcode(clientId, apiKey, barcode) {
  const headers = {
    'Content-Type': 'application/json',
    'Client-Id': clientId,
    'Api-Key': apiKey
  }

  try {
    const body = JSON.stringify({
      filter: { barcode },
      limit: 10,
      last_id: 0
    })

    const response = await ozonRequestWithRetry(
      'api-seller.ozon.ru',
      '/v1/returns/list',
      'POST',
      headers,
      body
    )

    if (response.status !== 200) {
      const snippet = typeof response.body === 'object'
        ? JSON.stringify(response.body).substring(0, 300)
        : String(response.body).substring(0, 300)
      throw new Error(`Ozon Return By Barcode API: HTTP ${response.status} — ${snippet}`)
    }

    const items = response.body && response.body.returns ? response.body.returns : []
    if (items.length === 0) return null

    const ret = items[0]
    return {
      id: ret.id,
      posting_number: ret.posting_number || '',
      order_id: ret.order_id,
      order_number: ret.order_number || '',
      return_reason_name: ret.return_reason_name || '',
      type: ret.type || '',
      schema: ret.schema || '',
      barcode: (ret.logistic && ret.logistic.barcode) || '',
      offer_id: (ret.product && ret.product.offer_id) || '',
      product_name: (ret.product && ret.product.name) || '',
      product_price: (ret.product && ret.product.price && ret.product.price.price) || 0,
      status_display: (ret.visual && ret.visual.status && ret.visual.status.display_name) || '',
      status_sys: (ret.visual && ret.visual.status && ret.visual.status.sys_name) || '',
      return_date: (ret.logistic && ret.logistic.return_date) || ''
    }
  } catch (e) {
    error(`[Ozon] fetchOzonReturnByBarcode error: ${e.message}`)
    return null
  }
}

/**
 * Ozon: обновление характеристик товара
 * Endpoint: POST /v1/product/attributes/update
 * Принимает offer_id (строка) или product_id (число).
 * Атрибуты должны быть в формате:
 *   [{ id: number, complex_id: number, values: [{ dictionary_value_id?: number, value?: string }] }]
 * Если атрибуты приходят в упрощённом формате { attribute_id, value },
 * функция автоматически преобразует их в нужный вид.
 *
 * @param {string} clientId - Ozon Client-Id
 * @param {string} apiKey - Ozon Api-Key
 * @param {string|number} productId - Артикул (offer_id) или числовой ID товара
 * @param {Array<Object>} attributes - Массив атрибутов
 * @returns {Promise<Object>} Результат обновления
 * @throws {Error} При HTTP-статусе, отличном от 200
 */
async function pushOzonAttributes(clientId, apiKey, productId, attributes) {
  // Преобразование упрощённого формата { attribute_id, value }
  // в формат Ozon API: { id, complex_id, values: [...] }
  const normalized = attributes.map(attr => {
    // Если уже в формате Ozon API (id + values)
    if (attr.id !== undefined && attr.values !== undefined) {
      return attr
    }
    // Если в формате { attribute_id, value } — преобразуем
    if (attr.attribute_id !== undefined) {
      const values = []
      if (attr.dictionary_value_id !== undefined) {
        values.push({ dictionary_value_id: attr.dictionary_value_id })
      } else if (attr.value !== undefined) {
        values.push({ value: String(attr.value) })
      }
      return {
        id: attr.attribute_id,
        complex_id: attr.complex_id || 0,
        values
      }
    }
    // fallback: передаём как есть
    return attr
  }).filter(attr => attr.values && attr.values.length > 0)

  if (normalized.length === 0) {
    warn('[Ozon] pushOzonAttributes: нет атрибутов для отправки')
    return { result: [] }
  }

  const item = {}
  if (typeof productId === 'number' || /^\d+$/.test(String(productId))) {
    item.product_id = Number(productId)
  } else {
    item.offer_id = String(productId)
  }
  item.attributes = normalized

  const body = JSON.stringify({ items: [item] })

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
    throw new Error(`Ozon Attributes Update API: HTTP ${response.status} — ${JSON.stringify(response.body)}`)
  }

  info(`[Ozon] Attributes updated for ${productId}: ${normalized.length} attributes`)
  return response.body
}

module.exports = {
  makeRequest,
  fetchWBData,
  fetchWBPrice,
  fetchWBProductFull,
  fetchOzonData,
  fetchOzonProductFull,
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
  syncImageToOzon,
  fetchWBOrderBySticker,
  fetchWBOrderIdBySrid,
  fetchOzonReturnsList,
  fetchOzonPostingsList,
  fetchOzonPostingDetail,
  fetchOzonReturnByBarcode
}
