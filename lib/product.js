/**
 * @file Поиск товаров по коду в МойСклад
 * @module lib/product
 *
 * Предоставляет функции для поиска товаров в entity/assortment по коду (артикулу).
 * Используется для печати стикеров и отображения информации о товаре.
 * Поддерживает поиск по product, bundle, service, modification.
 *
 * @requires lib/api-utils
 * @requires lib/logger
 */

const { getApi } = require('./api-utils')
const { info, success, warn, error, debug } = require('./logger')

// In-memory cache for product search by code
const productCache = new Map()

/**
 * Поиск товара по коду (по всем типам ассортимента: товар, комплект, услуга, модификация)
 * @param {string} code - Код товара (из карточки товара в МС)
 * @returns {Promise<object|null>} - Объект товара или null
 */
async function findProductByCode(code) {
  if (!code) return null

  // Normalize code: trim whitespace
  const normalizedCode = code.trim()

  // Check cache first (using normalized code)
  if (productCache.has(normalizedCode)) {
    debug(`[Cache] Product cache hit: ${normalizedCode}`)
    return productCache.get(normalizedCode)
  }

  try {
    const API = getApi()

    // Method 1: Exact filter by code via assortment (covers product, bundle, service, modification)
    // Note: entity/assortment does NOT support 'search' parameter, only 'filter'
    info(`Searching product by code: ${normalizedCode}`)

    const filterResult = await API.GET('entity/assortment', { filter: `code=${normalizedCode}`, limit: 10 })
    debug(`Filter results count: ${filterResult.meta?.size || 0}`)

    if (filterResult.rows && filterResult.rows.length > 0) {
      const product = filterResult.rows[0]
      success(`Found product: ${product.name}, code: ${product.code}, type: ${product.meta?.type}, id: ${product.id}`)
      productCache.set(normalizedCode, product)
      return product
    }

    // Method 2: Fallback to search on entity/product (partial match for regular products only)
    warn(`Filter returned no results, trying search on entity/product: ${normalizedCode}`)
    const searchResult = await API.GET('entity/product', { search: normalizedCode, limit: 10 })
    debug(`Search results count: ${searchResult.meta?.size || 0}`)

    if (searchResult.rows && searchResult.rows.length > 0) {
      const product = searchResult.rows.find(row =>
        row.code && row.code.toLowerCase() === normalizedCode.toLowerCase()
      ) || searchResult.rows[0]

      success(`Found product via search: ${product.name}, code: ${product.code}, id: ${product.id}`)
      productCache.set(normalizedCode, product)
      return product
    }

    warn(`Product not found: ${normalizedCode}`)
    return null
  } catch (e) {
    error(`Error finding product by code: ${e.message}`)
    return null
  }
}

/**
 * Получение полных данных товара по коду (для будущего модуля информации о товаре)
 * @param {string} code - Код товара
 * @returns {Promise<object|null>} - Полный объект товара или null
 */
async function getProductFullByCode(code) {
  try {
    const product = await findProductByCode(code)
    if (!product || !product.id) return null

    const API = getApi()
    // Use the entity type from meta (product, bundle, service, etc.)
    const entityType = product.meta?.type || 'product'
    const fullProduct = await API.GET('entity/' + entityType + '/' + product.id, {
      expand: 'uom,productFolder,images,salePrices,attributes'
    })

    return fullProduct
  } catch (e) {
    error('Error getting full product:', e.message)
    return null
  }
}

/**
 * Очистка кэша товаров (полезно для тестирования или управления памятью)
 */
function clearProductCache() {
  productCache.clear()
}

module.exports = {
  findProductByCode,
  getProductFullByCode,
  clearProductCache
}
