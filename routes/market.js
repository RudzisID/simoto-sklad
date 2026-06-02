'use strict'

const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')

const { getApi } = require('../lib/api-utils')
const { getProductFullByCode } = require('../lib/product')
const wbOzonSync = require('../integrations/wb_ozon_sync')
const {
  wbUrlToDataUri,
  formatDescriptionForDisplay,
  findSharedAttributes,
  cleanOldUploads
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

  // ─── Multer config ───
  const UPLOAD_DIR = path.join(moduleRoot, 'temp', 'images')
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }

  cleanOldUploads(UPLOAD_DIR, log)

  const imageStorage = multer.diskStorage({
    /**
     * Определяет директорию для сохранения загруженных изображений
     * @param {Object} req - Express Request
     * @param {Object} file - Multer file object
     * @param {Function} cb - Callback (null, dirPath)
     */
    destination: function(req, file, cb) {
      cb(null, UPLOAD_DIR)
    },
    /**
     * Генерирует уникальное имя файла с временной меткой и случайным числом
     * @param {Object} req - Express Request
     * @param {Object} file - Multer file object
     * @param {Function} cb - Callback (null, filename)
     */
    filename: function(req, file, cb) {
      const ext = path.extname(file.originalname) || '.jpg'
      const name = 'upload_' + Date.now() + '_' + Math.round(Math.random() * 1000) + ext
      cb(null, name)
    }
  })

  const imageUpload = multer({
    storage: imageStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    /**
     * Фильтр разрешённых форматов изображений — только jpg, png, webp, gif
     * @param {Object} req - Express Request
     * @param {Object} file - Multer file object
     * @param {Function} cb - Callback (null, boolean) или Error при недопустимом формате
     */
    fileFilter: function(req, file, cb) {
      const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
      const ext = path.extname(file.originalname).toLowerCase()
      if (allowed.includes(ext)) {
        cb(null, true)
      } else {
        cb(new Error('Недопустимый формат файла: ' + ext + '. Разрешены: jpg, png, webp, gif'))
      }
    }
  })

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

  // ─── Market: Push to MS ───
  /**
   * POST /market/push/ms — Обновление товара в МойСклад (цена, название, описание, атрибуты)
   * @header {string} x-api-token - Токен API МойСклад
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.productId - ID товара в МС
   * @param {number} [req.body.price] - Новая цена в рублях
   * @param {string} [req.body.title] - Новое название товара
   * @param {string} [req.body.description] - Новое описание товара
   * @param {Array} [req.body.attributes] - Массив атрибутов [{id, value}]
   * @returns {Promise<void>} { success: boolean, message: string }
   */
  router.post('/push/ms', async (req, res) => {
    const msToken = req.headers['x-api-token']
    const { productId, price, title, description, attributes } = req.body

    if (!msToken) return res.status(401).json({ error: 'Требуется токен МойСклад' })
    if (!productId) return res.status(400).json({ error: 'Нет ID товара' })

    try {
      process.env.MOYSKLAD_TOKEN = msToken
      initApi(msToken)
      const API = getApi()

      const product = await API.GET('entity/product/' + productId, { expand: 'salePrices' })

      const updateData = {}
      if (title) updateData.name = title
      if (description !== undefined) updateData.description = description
      if (attributes && Array.isArray(attributes) && attributes.length > 0) {
        updateData.attributes = attributes.map(function(a) {
          return { id: a.id, value: a.value }
        })
      }
      if (price !== undefined && price > 0) {
        const priceType = product.salePrices?.[0]?.priceType
        updateData.salePrices = [{
          value: Math.round(price * 100),
          priceType: priceType || { meta: { href: 'entity/pricetype/default', type: 'pricetype', mediaType: 'application/json' } }
        }]
      }

      await API.PUT('entity/product/' + productId, updateData)
      log(`[Market] MS push: updated ${productId}`)
      res.json({ success: true, message: 'Товар обновлён в МойСклад' })
    } catch (e) {
      log(`[Market] MS push error: ${e.message}`)
      res.status(500).json({ error: e.message })
    }
  })

  // ─── Market: Push to WB ───
  /**
   * POST /market/push/wb — Обновление товара в Wildberries (описание, характеристики, изображения)
   * @header {string} x-wb-token - Токен API Wildberries
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.vendorCode - Артикул товара (vendorCode)
   * @param {string} [req.body.title] - Название товара
   * @param {string} [req.body.description] - Описание товара
   * @param {Array} [req.body.characteristics] - Характеристики товара
   * @param {string[]} [req.body.images] - URL изображений для загрузки
   * @returns {Promise<void>} { success: boolean, message: string, mediaStatus: string, mediaMessage?: string }
   */
  router.post('/push/wb', async (req, res) => {
    const wbToken = req.headers['x-wb-token']
    const { vendorCode, title, description, characteristics, images } = req.body

    if (!wbToken) return res.status(401).json({ error: 'Требуется токен WB' })
    if (!vendorCode) return res.status(400).json({ error: 'Нет vendorCode' })

    try {
      const wbResults = await wbOzonSync.fetchWBData([vendorCode], wbToken)
      if (!wbResults || wbResults.length === 0 || wbResults[0].error) {
        return res.status(404).json({ error: wbResults?.[0]?.error || 'Товар не найден в WB' })
      }

      const nmId = wbResults[0].nmID
      if (!nmId) return res.status(400).json({ error: 'nmID не получен для товара' })

      const updates = []

      if (description !== undefined || (characteristics && characteristics.length > 0)) {
        updates.push(wbOzonSync.pushWBCard(wbToken, nmId, vendorCode, description, characteristics))
      }

      await Promise.all(updates)

      let mediaStatus = 'skipped'
      let mediaMessage = null
      if (images && Array.isArray(images) && images.length > 0) {
        try {
          const processedImages = await Promise.all(images.map(url => wbUrlToDataUri(url, log)))
          await wbOzonSync.pushWBMedia(wbToken, nmId, processedImages)
          mediaStatus = 'ok'
        } catch (mediaErr) {
          mediaStatus = 'error'
          mediaMessage = mediaErr.message
          log(`[Market] WB media push warning: ${mediaErr.message} — continuing`)
        }
      }

      log(`[Market] WB push: updated ${vendorCode} (nmId: ${nmId})`)
      res.json({ success: true, message: 'Товар обновлён в Wildberries', mediaStatus, mediaMessage })
    } catch (e) {
      log(`[Market] WB push error: ${e.message}`)
      res.status(500).json({ error: e.message })
    }
  })

  // ─── Market: Push to Ozon ───
  /**
   * POST /market/push/ozon — Обновление товара в Ozon (название, описание, атрибуты, изображения)
   * @header {string} x-ozon-client-id - Client-ID Ozon
   * @header {string} x-ozon-api-key - API-Key Ozon
   * @param {Object} req.body - Тело запроса
   * @param {string} [req.body.offerId] - offerId товара
   * @param {string} [req.body.productId] - productId товара
   * @param {string} [req.body.title] - Название товара
   * @param {string} [req.body.description] - Описание товара
   * @param {Array} [req.body.attributes] - Массив атрибутов
   * @param {string[]} [req.body.images] - URL изображений
   * @param {number} [req.body.typeId] - ID типа товара
   * @returns {Promise<void>} { success: boolean, message: string, mediaStatus: string, mediaMessage?: string }
   */
  router.post('/push/ozon', async (req, res) => {
    const ozonClientId = req.headers['x-ozon-client-id']
    const ozonApiKey = req.headers['x-ozon-api-key']
    const { offerId, productId, title, description, attributes, images, typeId } = req.body

    if (!ozonClientId || !ozonApiKey) return res.status(401).json({ error: 'Требуются Client-Id и Api-Key Ozon' })
    if (!offerId && !productId) return res.status(400).json({ error: 'Нет offerId или productId' })

    try {
      const updates = []

      let ozonMediaStatus = 'skipped'
      let ozonMediaMessage = null
      if (title || description || (images && images.length > 0)) {
        try {
          await wbOzonSync.pushOzonImport(ozonClientId, ozonApiKey, offerId, title, description, images, typeId)
          ozonMediaStatus = 'ok'
        } catch (err) {
          ozonMediaStatus = 'error'
          ozonMediaMessage = err.message
          log(`[Market] Ozon import/images warning (non-fatal): ${err.message}`)
        }
      }

      if (attributes && Array.isArray(attributes) && attributes.length > 0 && productId) {
        updates.push(wbOzonSync.pushOzonAttributes(ozonClientId, ozonApiKey, productId, attributes))
      }

      await Promise.all(updates)
      log(`[Market] Ozon push: updated ${offerId}`)
      res.json({ success: true, message: 'Товар обновлён в Ozon', mediaStatus: ozonMediaStatus, mediaMessage: ozonMediaMessage })
    } catch (e) {
      log(`[Market] Ozon push error: ${e.message}`)
      res.status(500).json({ error: e.message })
    }
  })

  // ─── Market: Sync image ───
  /**
   * POST /market/sync/image — Синхронизация изображения между маркетплейсами (WB → Ozon или Ozon → WB)
   * @header {string} [x-wb-token] - Токен WB (для направления Ozon→WB)
   * @header {string} [x-ozon-client-id] - Client-ID Ozon (для направления WB→Ozon)
   * @header {string} [x-ozon-api-key] - API-Key Ozon (для направления WB→Ozon)
   * @param {Object} req.body - Тело запроса
   * @param {string} req.body.sourcePlatform - Платформа-источник ('wb' | 'ozon')
   * @param {string} req.body.targetPlatform - Целевая платформа ('wb' | 'ozon')
   * @param {string} req.body.imageUrl - URL изображения для синхронизации
   * @param {string} [req.body.nmId] - nmId WB (для направления Ozon→WB)
   * @param {string} [req.body.offerId] - offerId Ozon (для направления WB→Ozon)
   * @returns {Promise<void>} { success: boolean, message: string, taskId?: string }
   */
  router.post('/sync/image', async (req, res) => {
    const wbToken = req.headers['x-wb-token']
    const ozonClientId = req.headers['x-ozon-client-id']
    const ozonApiKey = req.headers['x-ozon-api-key']
    const { sourcePlatform, targetPlatform, imageUrl, nmId, offerId } = req.body

    if (!sourcePlatform || !targetPlatform || !imageUrl) {
      return res.status(400).json({ error: 'Требуются sourcePlatform, targetPlatform и imageUrl' })
    }

    if (sourcePlatform === 'ms' || targetPlatform === 'ms') {
      return res.status(400).json({ error: 'MS images not supported' })
    }

    try {
      if (sourcePlatform === 'wb' && targetPlatform === 'ozon') {
        if (!ozonClientId || !ozonApiKey) {
          return res.status(401).json({ error: 'Требуются Client-Id и Api-Key Ozon' })
        }
        if (!offerId) {
          return res.status(400).json({ error: 'Требуется offerId' })
        }

        const taskId = await wbOzonSync.syncImageToOzon(ozonClientId, ozonApiKey, offerId, imageUrl)
        log(`[Market] Image synced WB→Ozon: offer=${offerId}, task=${taskId}`)
        return res.json({ success: true, message: 'Изображение отправлено в Ozon', taskId })
      } else if (sourcePlatform === 'ozon' && targetPlatform === 'wb') {
        if (!wbToken) {
          return res.status(401).json({ error: 'Требуется токен WB' })
        }
        if (!nmId) {
          return res.status(400).json({ error: 'Требуется nmId' })
        }

        await wbOzonSync.syncImageToWB(wbToken, nmId, imageUrl)
        log(`[Market] Image synced Ozon→WB: nmId=${nmId}`)
        return res.json({ success: true, message: 'Изображение отправлено в Wildberries' })
      } else {
        return res.status(400).json({ error: 'Invalid sync direction. Supported: wb→ozon, ozon→wb' })
      }
    } catch (e) {
      log(`[Market] Sync image error: ${e.message}`)
      res.status(500).json({ error: e.message })
    }
  })

  // ─── Market: Upload image ───
  /**
   * POST /market/image/upload — Загрузка изображения на сервер через multer (multipart/form-data)
   * @param {Object} req.file - Загруженный файл (поле 'image')
   * @param {string} [req.body.platform] - Платформа назначения (для логирования)
   * @param {string} [req.body.vendorCode] - Артикул товара (для логирования)
   * @returns {Promise<void>} { success: boolean, filename: string, originalName: string, size: number, url: string }
   */
  router.post('/image/upload', imageUpload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' })
      }

      const fileUrl = '/temp/images/' + req.file.filename
      log(`[Upload] Image saved: ${req.file.filename} (${(req.file.size / 1024).toFixed(1)} KB)`, 'info')

      if (req.body.platform || req.body.vendorCode) {
        log(`[Upload] Metadata: platform=${req.body.platform || '-'}, vendorCode=${req.body.vendorCode || '-'}`, 'info')
      }

      res.json({
        success: true,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        url: fileUrl,
        fullUrl: fileUrl
      })
    } catch (e) {
      log(`[Upload] Error: ${e.message}`, 'error')
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
