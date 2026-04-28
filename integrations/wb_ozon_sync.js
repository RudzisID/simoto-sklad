'use strict'

// Skeleton implementation for Wildberries / OZON product sync
// This module provides a basic scaffold to fetch, compare and prepare product data
// from Wildberries and OZON. It uses mock functions where real APIs are not available.

const simulateDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchWBData(codeList) {
  // Replace with real WB API calls if available
  await simulateDelay(100)
  // Return mock data for each code
  return codeList.map(code => ({
    code,
    title: `WB Product ${code}`,
    price: 100 + Math.floor(Math.random() * 100),
    stock: Math.floor(Math.random() * 20),
    site: 'Wildberries',
  }))
}

async function fetchOzonData(codeList) {
  await simulateDelay(100)
  return codeList.map(code => ({
    code,
    title: `OZON Product ${code}`,
    price: 90 + Math.floor(Math.random() * 120),
    stock: Math.floor(Math.random() * 25),
    site: 'OZON',
  }))
}

function compareAndAggregate(wbData, ozonData) {
  // Simple merge by code; prefer WB price if both exist
  const map = new Map()
  wbData.forEach(p => map.set(p.code, { ...p, sources: ['WB'] }))
  ozonData.forEach(p => {
    if (map.has(p.code)) {
      const existing = map.get(p.code)
      existing.price = Math.min(existing.price, p.price)
      existing.stock = existing.stock + p.stock
      existing.sources.push('OZON')
    } else {
      map.set(p.code, { ...p, sources: ['OZON'] })
    }
  })
  return Array.from(map.values())
}

function prepareAddForWB(merged) {
  // Transform to payload structure expected by WB import interface
  return merged.map(item => ({
    code: item.code,
    title: item.title,
    price: item.price,
    stock: item.stock,
  }))
}

function prepareAddForOZON(merged) {
  // Similar transformation for OZON upload
  return merged.map(item => ({
    code: item.code,
    name: item.title,
    price: item.price,
    quantity: item.stock,
  }))
}

module.exports = {
  fetchWBData,
  fetchOzonData,
  compareAndAggregate,
  prepareAddForWB,
  prepareAddForOZON
}
