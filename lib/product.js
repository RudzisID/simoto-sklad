// Product search and management
// Used for sticker printing and future product info display

const { getApi } = require('./api-utils')

// In-memory cache for product search by code
const productCache = new Map()

/**
 * Find product by code (searches name, code, article fields)
 * @param {string} code - Product code
 * @returns {Promise<object|null>} - Product object or null
 */
async function findProductByCode(code) {
  if (!code) return null

  // Normalize code: trim whitespace
  const normalizedCode = code.trim()

  // Check cache first (using normalized code)
  if (productCache.has(normalizedCode)) {
    console.log(`Product cache hit: ${normalizedCode}`)
    return productCache.get(normalizedCode)
  }

  try {
    const API = getApi()
    
    // Method 1: Use search parameter (searches across name, code, article)
    // This is more reliable as it uses MoySklad's context search
    const searchQuery = `search=${encodeURIComponent(normalizedCode)}`
    console.log(`Searching product with: ${searchQuery}`)
    
    const result = await API.GET('entity/product?' + searchQuery)

    if (result.rows && result.rows.length > 0) {
      // Find exact code match from search results
      // (search might return partial matches)
      const product = result.rows.find(row => 
        row.code && row.code.toLowerCase() === normalizedCode.toLowerCase()
      ) || result.rows[0] // Fall back to first result if no exact match
      
      console.log(`Found product: ${product.name}, code: ${product.code}, id: ${product.id}`)
      
      // Cache the result
      productCache.set(normalizedCode, product)
      return product
    }

    // Method 2: Fallback to exact filter if search fails
    console.log(`Search failed, trying exact filter for: ${normalizedCode}`)
    const filter = `filter=code=${encodeURIComponent(normalizedCode)}`
    const filterResult = await API.GET('entity/product?' + filter)

    if (filterResult.rows && filterResult.rows.length > 0) {
      const product = filterResult.rows[0]
      console.log(`Found product via filter: ${product.name}, code: ${product.code}`)
      productCache.set(normalizedCode, product)
      return product
    }

    console.log(`Product not found: ${normalizedCode}`)
    return null
  } catch (e) {
    console.error('Error finding product by code:', e.message)
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
  findProductByCode,
  getProductFullByCode,
  clearProductCache
}
