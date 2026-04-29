// Product search and management
// Used for sticker printing and future product info display

const { getApi } = require('./api-utils')

// In-memory cache for product search by article
const productCache = new Map()

/**
 * Find product by article (exact match)
 * @param {string} article - Product article
 * @returns {Promise<object|null>} - Product object or null
 */
async function findProductByArticle(article) {
  if (!article) return null

  // Check cache first
  if (productCache.has(article)) {
    console.log(`Product cache hit: ${article}`)
    return productCache.get(article)
  }

  try {
    const API = getApi()
    const filter = `article=${article}`
    const result = await API.GET('entity/product?' + filter)

    if (result.rows && result.rows.length > 0) {
      const product = result.rows[0]
      // Cache the result
      productCache.set(article, product)
      return product
    }

    return null
  } catch (e) {
    console.error('Error finding product by article:', e.message)
    return null
  }
}

/**
 * Get full product data by article (for future product info module)
 * @param {string} article - Product article
 * @returns {Promise<object|null>} - Full product object or null
 */
async function getProductFullByArticle(article) {
  try {
    const product = await findProductByArticle(article)
    if (!product || !product.id) return null

    const API = getApi()
    // Expand necessary fields for future use
    const fullProduct = await API.GET('entity/product/' + product.id, {
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
  findProductByArticle,
  getProductFullByArticle,
  clearProductCache
}
