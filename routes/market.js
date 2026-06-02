'use strict'

const express = require('express')
const path = require('path')
const fs = require('fs')

const { getApi } = require('../lib/api-utils')
const { getProductFullByCode } = require('../lib/product')
const wbOzonSync = require('../integrations/wb_ozon_sync')
const {
  formatDescriptionForDisplay,
  findSharedAttributes
} = require('../lib/server-utils')

/**
 * Market роутер
 * @param {Object} deps - Зависимости
 * @param {Function} deps.log - Функция логирования
 * @param {string} deps.moduleRoot - Корневая директория модуля
 * @param {Object} deps.wb - WB модуль
 * @param {Object} deps.ozon - Ozon модуль
 * @returns {import('express').Router}
 */
module.exports = function(deps) {
  const router = express.Router()
  const { log, moduleRoot, wb, ozon } = deps

  const initApi = require('../lib/api-utils').initApi

  // ─── Market: Product search ───
  /**
   * GET /market/product — Поиск товара на МС, WB и Ozon по OEM-коду
   * @header {string} x-api-token - Токен API МойСклад (обязательно)
   * @header {string} [x-wb-token] - Токен API Wildberries
   * @header {string} [x-ozon-client-id] - Client-ID Ozon
   * @header {string} [x-ozon-api-key] - API-Key Ozon
   * @query {string} code - OEM-код товара для поиска
   * @returns {Promise<void>} JSON с объединёнными данными товара (moysklad, wildberries, ozon, sharedAttributes)
   */
  router.get('/product', async (req, res) => {
    const msToken = req.headers['x-api-token']
    const wbToken = req.headers['x-wb-token']
    const ozonClientId = req.headers['x-ozon-client-id']
    const ozonApiKey = req.headers['x-ozon-api-key']
    const oemCode = req.query.code

    if (!msToken) {
      return res.status(401).json({ error: 'Требуется токен API МойСклад' })
    }

    if (!oemCode) {
      return res.status(400).json({ error: 'Требуется код товара (OEM)' })
    }

    try {
      process.env.MOYSKLAD_TOKEN = msToken
      initApi(msToken)

      const msProduct = await getProductFullByCode(oemCode.trim())

      let msPrice = 0
      if (msProduct) {
        log(`[Market] MS Direct API: ${msProduct.name}, salePrices: ${JSON.stringify(msProduct.salePrices)}`)
        if (msProduct.salePrices && msProduct.salePrices.length > 0) {
          const rawCents = msProduct.salePrices[0].value
          msPrice = rawCents / 100
          log(`[Market] MS Price Debug: raw=${rawCents}, calculated=${msPrice}`)
        } else if (msProduct.price) {
          msPrice = msProduct.price / 100
          log(`[Market] MS Price fallback: ${msPrice} rub (no salePrices array)`)
        }
        log(`[Market] MS Price Final: ${msPrice} rub`)

        msProduct._priceTypeMeta = msProduct.salePrices?.[0]?.priceType?.meta || null
      }

      let wbResults = []
      let wbError = null
      if (wbToken) {
        try {
          wbResults = await wbOzonSync.fetchWBData([oemCode.trim()], wbToken)
        } catch (e) {
          wbError = e.message
          wbResults = [{ code: oemCode, error: 'WB API Error: ' + e.message }]
        }
      } else {
        wbResults = [{ code: oemCode, error: 'Токен WB не предоставлен' }]
      }

      let ozonResults = []
      let ozonError = null
      if (ozonClientId && ozonApiKey) {
        try {
          ozonResults = await wbOzonSync.fetchOzonData([oemCode.trim()], ozonClientId, ozonApiKey)
        } catch (e) {
          ozonError = e.message
          ozonResults = [{ code: oemCode, error: 'Ozon API Error: ' + e.message }]
        }
      } else {
        ozonResults = [{ code: oemCode, error: 'Не указаны Client-Id и Api-Key для Ozon' }]
      }

      // Получение остатков по складам
      let stockByStore = []
      if (msProduct && msProduct.id) {
        try {
          const API = getApi()
          const [stockResult, storesResult] = await Promise.all([
            API.GET('entity/product/' + msProduct.id + '/stock'),
            API.GET('entity/store', { limit: 100 })
          ])
          const storeMap = {}
          if (storesResult && storesResult.rows) {
            storesResult.rows.forEach(s => { if (s.id) storeMap[s.id] = s.name })
          }
          if (stockResult && stockResult.rows) {
            stockByStore = stockResult.rows
              .map(row => ({
                storeName: row.storeName || (row.stock?.meta?.href ? storeMap[row.stock.meta.href.split('/').pop()] : null) || 'Неизвестный склад',
                quantity: row.quantity || 0,
                reserve: row.reserve || 0
              }))
              .filter(s => s.quantity > 0 || s.reserve > 0)
          }
        } catch (e) {
          log(`[Market] Stock fetch error: ${e.message}`)
        }
      }

      const msData = msProduct ? {
        id: msProduct.id,
        name: msProduct.name,
        code: msProduct.code,
        article: msProduct.article || '',
        price: msPrice,
        stock: msProduct.quantity || 0,
        _priceTypeMeta: msProduct._priceTypeMeta,
        description: msProduct.description || '',
        descriptionClean: formatDescriptionForDisplay(msProduct.description),
        attributes: msProduct.attributes || [],
        images: [],
        stockByStore: stockByStore,
      } : null

      const wbData = (wbResults && wbResults.length > 0) ? {
        ...wbResults[0],
        descriptionClean: formatDescriptionForDisplay(wbResults[0].description)
      } : null

      const ozonData = (ozonResults && ozonResults.length > 0) ? {
        ...ozonResults[0],
        descriptionClean: formatDescriptionForDisplay(ozonResults[0].description)
      } : null

      const result = {
        oem: oemCode,
        moysklad: msData,
        wildberries: wbData,
        ozon: ozonData,
        sharedAttributes: findSharedAttributes(msData, wbData, ozonData),
        _debug: { wbError, ozonError }
      }

      res.json(result)
    } catch (e) {
      log(`Ошибка поиска товара: ${e.message}`)
      res.status(500).json({ error: e.message })
    }
  })

  // ─── Market: Full product ───
  /**
   * GET /market/product/full — Полные данные товара с МС, WB и Ozon (аналогично /product)
   * @header {string} x-api-token - Токен API МойСклад (обязательно)
   * @header {string} [x-wb-token] - Токен API Wildberries
   * @header {string} [x-ozon-client-id] - Client-ID Ozon
   * @header {string} [x-ozon-api-key] - API-Key Ozon
   * @query {string} code - OEM-код товара
   * @returns {Promise<void>} JSON с полными данными товара со всех площадок
   */
  router.get('/product/full', async (req, res) => {
    const msToken = req.headers['x-api-token']
    const wbToken = req.headers['x-wb-token']
    const ozonClientId = req.headers['x-ozon-client-id']
    const ozonApiKey = req.headers['x-ozon-api-key']
    const oemCode = req.query.code

    if (!msToken) {
      return res.status(401).json({ error: 'Требуется токен API МойСклад' })
    }

    if (!oemCode) {
      return res.status(400).json({ error: 'Требуется код товара (OEM)' })
    }

    try {
      process.env.MOYSKLAD_TOKEN = msToken
      initApi(msToken)

      const msProduct = await getProductFullByCode(oemCode.trim())

      let msPrice = 0
      if (msProduct) {
        log(`[Market] MS Direct API: ${msProduct.name}, salePrices: ${JSON.stringify(msProduct.salePrices)}`)
        if (msProduct.salePrices && msProduct.salePrices.length > 0) {
          const rawCents = msProduct.salePrices[0].value
          msPrice = rawCents / 100
          log(`[Market] MS Price Debug: raw=${rawCents}, calculated=${msPrice}`)
        } else if (msProduct.price) {
          msPrice = msProduct.price / 100
          log(`[Market] MS Price fallback: ${msPrice} rub (no salePrices array)`)
        }
        log(`[Market] MS Price Final: ${msPrice} rub`)

        msProduct._priceTypeMeta = msProduct.salePrices?.[0]?.priceType?.meta || null
      }

      let wbResults = []
      let wbError = null
      if (wbToken) {
        try {
          wbResults = await wbOzonSync.fetchWBData([oemCode.trim()], wbToken)
        } catch (e) {
          wbError = e.message
          wbResults = [{ code: oemCode, error: 'WB API Error: ' + e.message }]
        }
      } else {
        wbResults = [{ code: oemCode, error: 'Токен WB не предоставлен' }]
      }

      let ozonResults = []
      let ozonError = null
      if (ozonClientId && ozonApiKey) {
        try {
          ozonResults = await wbOzonSync.fetchOzonData([oemCode.trim()], ozonClientId, ozonApiKey)
        } catch (e) {
          ozonError = e.message
          ozonResults = [{ code: oemCode, error: 'Ozon API Error: ' + e.message }]
        }
      } else {
        ozonResults = [{ code: oemCode, error: 'Не указаны Client-Id и Api-Key для Ozon' }]
      }

      // Получение остатков по складам
      let stockByStore = []
      if (msProduct && msProduct.id) {
        try {
          const API = getApi()
          const [stockResult, storesResult] = await Promise.all([
            API.GET('entity/product/' + msProduct.id + '/stock'),
            API.GET('entity/store', { limit: 100 })
          ])
          const storeMap = {}
          if (storesResult && storesResult.rows) {
            storesResult.rows.forEach(s => { if (s.id) storeMap[s.id] = s.name })
          }
          if (stockResult && stockResult.rows) {
            stockByStore = stockResult.rows
              .map(row => ({
                storeName: row.storeName || (row.stock?.meta?.href ? storeMap[row.stock.meta.href.split('/').pop()] : null) || 'Неизвестный склад',
                quantity: row.quantity || 0,
                reserve: row.reserve || 0
              }))
              .filter(s => s.quantity > 0 || s.reserve > 0)
          }
        } catch (e) {
          log(`[Market] Stock fetch error: ${e.message}`)
        }
      }

      const msData = msProduct ? {
        id: msProduct.id,
        name: msProduct.name,
        code: msProduct.code,
        article: msProduct.article || '',
        price: msPrice,
        stock: msProduct.quantity || 0,
        _priceTypeMeta: msProduct._priceTypeMeta,
        description: msProduct.description || '',
        descriptionClean: formatDescriptionForDisplay(msProduct.description),
        attributes: msProduct.attributes || [],
        images: [],
        stockByStore: stockByStore,
      } : null

      const wbData = (wbResults && wbResults.length > 0) ? {
        ...wbResults[0],
        descriptionClean: formatDescriptionForDisplay(wbResults[0].description)
      } : null

      const ozonData = (ozonResults && ozonResults.length > 0) ? {
        ...ozonResults[0],
        descriptionClean: formatDescriptionForDisplay(ozonResults[0].description)
      } : null

      const result = {
        oem: oemCode,
        moysklad: msData,
        wildberries: wbData,
        ozon: ozonData,
        sharedAttributes: findSharedAttributes(msData, wbData, ozonData),
        _debug: { wbError, ozonError }
      }

      res.json(result)
    } catch (e) {
      log(`Ошибка поиска товара: ${e.message}`)
      res.status(500).json({ error: e.message })
    }
  })









  // ─── Market: Push archive (read-only) ───
  /**
   * GET /market/push-archive — Возвращает содержимое файла market-push-for-future.js
   * @returns {Object} { content: string } — содержимое архивного файла
   */
  router.get('/push-archive', async (req, res) => {
    try {
      const archivePath = path.join(__dirname, '..', 'market-push-for-future.js')
      if (!fs.existsSync(archivePath)) {
        return res.status(404).json({ error: 'Архив не найден' })
      }
      const content = fs.readFileSync(archivePath, 'utf-8')
      res.json({ content })
    } catch (e) {
      log(`[Market] Push archive error: ${e.message}`)
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
