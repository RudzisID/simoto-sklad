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
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          resolve(data) // return raw if not JSON
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
 */
async function fetchWBData(codes, token) {
  if (!token) return codes.map(code => ({ code, error: 'No WB token' }))

  const options = {
    hostname: 'suppliers-api.wildberries.ru',
    path: '/api/v2/list/goods/filter',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token // WB uses token in Authorization header
    }
  }

  const body = JSON.stringify({
    'filter': {
      'find': codes.join(',') // Search by article/barcode
    },
    'limit': 1000
  })

  try {
    const response = await makeRequest(options, body)
    console.log('WB API Response:', JSON.stringify(response))
    
    // Response structure: { data: { list: [...] } }
    const items = response?.data?.list || []
    
    return codes.map(code => {
      // WB might return multiple items, find by article
      const found = items.find(item => 
        item.article === code || item.barcode?.includes(code)
      )
      if (!found) return { code, error: 'Not found in WB', details: response }
      
      return {
        code: found.article || code,
        title: found.name || 'N/A',
        price: found.price || 0,
        stock: (found.stocks || []).reduce((sum, s) => sum + (s.quantity || 0), 0),
        site: 'Wildberries',
        vendorCode: found.vendorCode || '',
        brand: found.brand || '',
        // Add more fields as needed
      }
    })
  } catch (e) {
    console.error('WB API Error:', e.message)
    return codes.map(code => ({ code, error: e.message }))
  }
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
      'offer_id': codes // Search by offer_id (which is usually the article)
    },
    'limit': 1000
  })

  try {
    const response = await makeRequest(options, body)
    console.log('Ozon API Response:', JSON.stringify(response))
    
    // Response structure: { result: { items: [...] } }
    const items = response?.result?.items || []
    
    return codes.map(code => {
      const found = items.find(item => 
        item.offer_id === code || item.sku?.toString() === code
      )
      if (!found) return { code, error: 'Not found in Ozon', details: response }
      
      return {
        code: found.offer_id || code,
        title: found.name || 'N/A',
        price: found.price || 0,
        stock: (found.stocks || []).reduce((sum, s) => sum + (s.present || 0), 0),
        site: 'Ozon',
        sku: found.sku || '',
        // Add more fields as needed
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
