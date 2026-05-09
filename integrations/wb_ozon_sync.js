'use strict'

// Real implementation for Wildberries / Ozon product sync
const https = require('https')

/**
 * Generic HTTPS request helper
 */
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        console.log(`WB Request to ${options.hostname}${options.path} - Status: ${res.statusCode}`)
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
      
      console.log(`WB Search for ${code}:`, { endpoint: options.path, textSearch: code })
      
      const response = await makeRequest(options, body)
      
      console.log(`WB API Full Response for ${code}:`, JSON.stringify(response).substring(0, 1000))
      
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
        const wbPrice = firstSize.price ? firstSize.price / 100 : 0
        results.push({
          code: found.vendorCode || code,
          title: found.title || 'N/A',
          price: wbPrice,
          stock: (found.sizes || []).reduce((sum, s) => sum + (s.quantity || 0), 0),
          site: 'Wildberries',
          vendorCode: found.vendorCode || '',
          brand: found.brand || '',
          nmID: found.nmID || ''
        })
      } else {
        results.push({ 
          code, 
          error: 'Not found in WB',
          details: 'Product not found. Verify vendorCode exists and is not in trash. Try checking WB cabinet.'
        })
      }
    } catch (e) {
      console.error('WB API Error:', e.message)
      results.push({ code, error: e.message })
    }
  }
  
  return results
}

/**
 * Ozon: Search product by offer_id (SKU/Article)
 * Docs: https://docs.ozon.ru/api/seller/
 */
async function fetchOzonData(codes, clientId, apiKey) {
  if (!clientId || !apiKey) return codes.map(code => ({ code, error: 'No Ozon credentials' }))

  const options = {
    hostname: 'api-seller.ozon.ru',
    path: '/v2/product/info/list',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': clientId,
      'Api-Key': apiKey
    }
  }

  const body = JSON.stringify({
    'filter': {
      'offer_id': codes
    },
    'limit': 1000
  })

  try {
    const response = await makeRequest(options, body)
    
    console.log('Ozon API Full Response:', JSON.stringify(response))
    
    if (response.status !== 200) {
      return codes.map(code => ({ 
        code, 
        error: `Ozon API Error: HTTP ${response.status}`, 
        details: response.body 
      }))
    }
    
    const items = response.body?.result?.items || []
    
    return codes.map(code => {
      const found = items.find(item => 
        item.offer_id === code || item.sku?.toString() === code
      )
      
      if (!found) return { 
        code, 
        error: 'Not found in Ozon', 
        details: response.body 
      }
      
      return {
        code: found.offer_id || code,
        title: found.name || 'N/A',
        price: found.price || 0,
        stock: (found.stocks || []).reduce((sum, s) => sum + (s.present || 0), 0),
        site: 'Ozon',
        sku: found.sku || '',
      }
    })
  } catch (e) {
    console.error('Ozon API Error:', e.message)
    return codes.map(code => ({ code, error: e.message }))
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

module.exports = {
  fetchWBData,
  fetchOzonData,
  compareAndAggregate
}
