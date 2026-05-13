// Product search and management
// Used for sticker printing and future product info display
// Uses entity/assortment to find products, bundles, services, and modifications

const { getApi } = require('./api-utils')
const { info, success, warn, error, debug } = require('./logger')

// In-memory cache for product search by code
const productCache = new Map()

/**
 * Find product by code (searches across all assortment types: product, bundle, service, modification)
 * @param {string} code - Product code
 * @returns {Promise<object|null>} - Product object or null
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
 * Get full product data by code (for future product info module)
 * @param {string} code - Product code
 * @returns {Promise<object|null>} - Full product object or null
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
    console.error('Error getting full product:', e.message)
    return null
  }
}

/**
 * Clear product cache (useful for testing or memory management)
 */
function clearProductCache() {
  productCache.clear()
}

module.exports = {
  findProductByCode,
  getProductFullByCode,
  clearProductCache
}
