// Product search and management
// Used for sticker printing and future product info display

const { getApi } = require('./api-utils')

// In-memory cache for product search by article
const productCache = new Map()

/**
 * Find product by article using search (searches name, code, article fields)
 * @param {string} article - Product article
 * @returns {Promise<object|null>} - Product object or null
 */
async function findProductByArticle(article) {
  if (!article) return null

  // Normalize article: trim whitespace
  const normalizedArticle = article.trim()

  // Check cache first (using normalized article)
  if (productCache.has(normalizedArticle)) {
    console.log(`Product cache hit: ${normalizedArticle}`)
    return productCache.get(normalizedArticle)
  }

  try {
    const API = getApi()
    
    // Method 1: Use search parameter (searches across name, code, article)
    // This is more reliable as it uses MoySklad's context search
    const searchQuery = `search=${encodeURIComponent(normalizedArticle)}`
    console.log(`Searching product with: ${searchQuery}`)
    
    const result = await API.GET('entity/product?' + searchQuery)

    if (result.rows && result.rows.length > 0) {
      // Find exact article match from search results
      // (search might return partial matches)
      const product = result.rows.find(row => 
        row.article && row.article.toLowerCase() === normalizedArticle.toLowerCase()
      ) || result.rows[0] // Fall back to first result if no exact match
      
      console.log(`Found product: ${product.name}, article: ${product.article}, id: ${product.id}`)
      
      // Cache the result
      productCache.set(normalizedArticle, product)
      return product
    }

    // Method 2: Fallback to exact filter if search fails
    console.log(`Search failed, trying exact filter for: ${normalizedArticle}`)
    const filter = `filter=article=${encodeURIComponent(normalizedArticle)}`
    const filterResult = await API.GET('entity/product?' + filter)

    if (filterResult.rows && filterResult.rows.length > 0) {
      const product = filterResult.rows[0]
      console.log(`Found product via filter: ${product.name}, article: ${product.article}`)
      productCache.set(normalizedArticle, product)
      return product
    }

    console.log(`Product not found: ${normalizedArticle}`)
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
