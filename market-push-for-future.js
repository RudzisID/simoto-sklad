/**
 * @file market-push-for-future.js
 *
 * ════════════════════════════════════════════════════════════════
 * АРХИВ: Push-функционал и управление изображениями
 * Модуль сравнения товаров (market-tab)
 * ════════════════════════════════════════════════════════════════
 *
 * Этот файл содержит код, вынесенный из market-tab при упрощении
 * до режима просмотра. Код полностью рабочий, сохранён для
 * возможного использования в будущем.
 *
 * Дата архивации: июнь 2026
 *
 * ════════════════════════════════════════════════════════════════
 * СОДЕРЖАНИЕ
 * ════════════════════════════════════════════════════════════════
 *
 * РАЗДЕЛ 1 — Backend: push-эндпоинты (Express, routes/market.js)
 *   1.1  POST /api/market/push/ms — обновление товара в МойСклад
 *   1.2  POST /api/market/push/wb — обновление товара в Wildberries
 *   1.3  POST /api/market/push/ozon — обновление товара в Ozon
 *   1.4  POST /api/market/sync/image — синхронизация изображений WB↔Ozon
 *   1.5  POST /api/market/image/upload — загрузка изображения на сервер
 *   1.6  Multer config (конфигурация загрузки файлов)
 *   1.7  Импорты, необходимые для push-эндпоинтов
 *
 * РАЗДЕЛ 2 — Frontend: push-функции (браузерный JS, public/index.html)
 *   2.1  pushToMS(productId) — отправка данных в МойСклад
 *   2.2  pushToWB(vendorCode) — отправка данных в Wildberries
 *   2.3  pushToOzon(offerId, productId) — отправка данных в Ozon
 *   2.4  getDescriptionValue(textarea) — helper: оригинал или изменения
 *   2.5  collectImageUrls(platform) — сбор URL изображений из DOM
 *
 * РАЗДЕЛ 3 — Frontend: управление изображениями
 *   3.1  _pendingCrossSyncs — система отслеживания незапушенных изображений
 *   3.2  copyImageToPlatform() — копирование изображения между площадками
 *   3.3  addThumbToRow() — добавление превью в DOM
 *   3.4  showAddImagePopup() — попап для вставки URL изображения
 *   3.5  uploadImage() — загрузка файла на сервер
 *
 * РАЗДЕЛ 4 — Frontend: Drag & drop обработчики
 *   4.1  Сортировка thumbnails внутри images-row (reorder)
 *   4.2  Cross-platform копирование через drag на images-row
 *   4.3  Cross-platform копирование через drag на add-new кнопку
 *   4.4  File upload через drag из проводника
 *   4.5  Drag-хендлеры в addThumbToRow (для новых превью)
 *
 * РАЗДЕЛ 5 — Frontend: Push-кнопки (btn-row)
 *   5.1  HTML-шаблон кнопок "💾 Сохранить" для Ozon и WB
 *
 * РАЗДЕЛ 6 — Frontend: AI improve buttons
 *   6.1  Кнопки "✨ Улучшить (AI)" для MS, Ozon, WB
 *
 * ════════════════════════════════════════════════════════════════
 */

'use strict'

// ════════════════════════════════════════════════════════════════
// РАЗДЕЛ 1 — Backend: push-эндпоинты (Express)
// ════════════════════════════════════════════════════════════════
//
// Исходный файл: routes/market.js
// Роутер экспортируется как module.exports = function(deps)
// Зависимости: { log, moduleRoot, wb, ozon }
//   - initApi = require('../lib/api-utils').initApi
//   - getApi  = require('../lib/api-utils').getApi
//   - getProductFullByCode = require('../lib/product')
//   - wbOzonSync = require('../integrations/wb_ozon_sync')
//   - server-utils: wbUrlToDataUri, formatDescriptionForDisplay, findSharedAttributes, cleanOldUploads
//
// ================================================================

// ------------------------------------------------------------------
// 1.7  Импорты, необходимые для push-эндпоинтов
// ------------------------------------------------------------------
// Исходный файл: routes/market.js (строки 1–16)
//
// --- КОД НАЧАЛО ---
// 'use strict'
//
// const express = require('express')
// const path = require('path')
// const fs = require('fs')
// const multer = require('multer')
//
// const { getApi } = require('../lib/api-utils')
// const { getProductFullByCode } = require('../lib/product')
// const wbOzonSync = require('../integrations/wb_ozon_sync')
// const {
//   wbUrlToDataUri,
//   formatDescriptionForDisplay,
//   findSharedAttributes,
//   cleanOldUploads
// } = require('../lib/server-utils')
// --- КОД КОНЕЦ ---
//
// Примечание: initApi импортируется внутри функции-фабрики роутера:
//   const initApi = require('../lib/api-utils').initApi


// ------------------------------------------------------------------
// 1.6  Multer config (конфигурация загрузки файлов)
// ------------------------------------------------------------------
// Исходный файл: routes/market.js (строки 33–82)
//
// Настраивает multer для приёма файлов изображений (jpg, png, webp, gif)
// максимум 10MB. Файлы сохраняются в {moduleRoot}/temp/images/
// с именем upload_{timestamp}_{random}.ext
//
// Глобальные переменные: UPLOAD_DIR = path.join(moduleRoot, 'temp', 'images')
//
// --- КОД НАЧАЛО ---
//   // ─── Multer config ───
//   const UPLOAD_DIR = path.join(moduleRoot, 'temp', 'images')
//   if (!fs.existsSync(UPLOAD_DIR)) {
//     fs.mkdirSync(UPLOAD_DIR, { recursive: true })
//   }
//
//   cleanOldUploads(UPLOAD_DIR, log)
//
//   const imageStorage = multer.diskStorage({
//     /**
//      * Определяет директорию для сохранения загруженных изображений
//      * @param {Object} req - Express Request
//      * @param {Object} file - Multer file object
//      * @param {Function} cb - Callback (null, dirPath)
//      */
//     destination: function(req, file, cb) {
//       cb(null, UPLOAD_DIR)
//     },
//     /**
//      * Генерирует уникальное имя файла с временной меткой и случайным числом
//      * @param {Object} req - Express Request
//      * @param {Object} file - Multer file object
//      * @param {Function} cb - Callback (null, filename)
//      */
//     filename: function(req, file, cb) {
//       const ext = path.extname(file.originalname) || '.jpg'
//       const name = 'upload_' + Date.now() + '_' + Math.round(Math.random() * 1000) + ext
//       cb(null, name)
//     }
//   })
//
//   const imageUpload = multer({
//     storage: imageStorage,
//     limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
//     /**
//      * Фильтр разрешённых форматов изображений — только jpg, png, webp, gif
//      * @param {Object} req - Express Request
//      * @param {Object} file - Multer file object
//      * @param {Function} cb - Callback (null, boolean) или Error при недопустимом формате
//      */
//     fileFilter: function(req, file, cb) {
//       const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
//       const ext = path.extname(file.originalname).toLowerCase()
//       if (allowed.includes(ext)) {
//         cb(null, true)
//       } else {
//         cb(new Error('Недопустимый формат файла: ' + ext + '. Разрешены: jpg, png, webp, gif'))
//       }
//     }
//   })
// --- КОД КОНЕЦ ---


// ================================================================
// 1.1  POST /api/market/push/ms
// ================================================================
// Исходный файл: routes/market.js (строки 310–359)
//
// Что делает: обновляет товар в МойСклад:
//   - Название (name), описание (description)
//   - Атрибуты (attributes) — массив { id, value }
//   - Цена (salePrices) — в копейках, с типом цены из товара
//
// Зависимости: getApi(), initApi() из lib/api-utils
//   process.env.MOYSKLAD_TOKEN = msToken (устанавливается перед initApi)
//
// Эндпоинт: POST /api/market/push/ms
// Заголовки: x-api-token
// Тело: { productId, price?, title?, description?, attributes? }
// Ответ: { success: boolean, message: string }
//
// --- КОД НАЧАЛО ---
//   // ─── Market: Push to MS ───
//   /**
//    * POST /market/push/ms — Обновление товара в МойСклад (цена, название, описание, атрибуты)
//    * @header {string} x-api-token - Токен API МойСклад
//    * @param {Object} req.body - Тело запроса
//    * @param {string} req.body.productId - ID товара в МС
//    * @param {number} [req.body.price] - Новая цена в рублях
//    * @param {string} [req.body.title] - Новое название товара
//    * @param {string} [req.body.description] - Новое описание товара
//    * @param {Array} [req.body.attributes] - Массив атрибутов [{id, value}]
//    * @returns {Promise<void>} { success: boolean, message: string }
//    */
//   router.post('/push/ms', async (req, res) => {
//     const msToken = req.headers['x-api-token']
//     const { productId, price, title, description, attributes } = req.body
//
//     if (!msToken) return res.status(401).json({ error: 'Требуется токен МойСклад' })
//     if (!productId) return res.status(400).json({ error: 'Нет ID товара' })
//
//     try {
//       process.env.MOYSKLAD_TOKEN = msToken
//       initApi(msToken)
//       const API = getApi()
//
//       const product = await API.GET('entity/product/' + productId, { expand: 'salePrices' })
//
//       const updateData = {}
//       if (title) updateData.name = title
//       if (description !== undefined) updateData.description = description
//       if (attributes && Array.isArray(attributes) && attributes.length > 0) {
//         updateData.attributes = attributes.map(function(a) {
//           return { id: a.id, value: a.value }
//         })
//       }
//       if (price !== undefined && price > 0) {
//         const priceType = product.salePrices?.[0]?.priceType
//         updateData.salePrices = [{
//           value: Math.round(price * 100),
//           priceType: priceType || { meta: { href: 'entity/pricetype/default', type: 'pricetype', mediaType: 'application/json' } }
//         }]
//       }
//
//       await API.PUT('entity/product/' + productId, updateData)
//       log(`[Market] MS push: updated ${productId}`)
//       res.json({ success: true, message: 'Товар обновлён в МойСклад' })
//     } catch (e) {
//       log(`[Market] MS push error: ${e.message}`)
//       res.status(500).json({ error: e.message })
//     }
//   })
// --- КОД КОНЕЦ ---


// ================================================================
// 1.2  POST /api/market/push/wb
// ================================================================
// Исходный файл: routes/market.js (строки 361–417)
//
// Что делает: обновляет товар в Wildberries:
//   - Описание (description), характеристики (characteristics)
//   - Изображения (images) — преобразует URL → data URI через wbUrlToDataUri
//     и отправляет через pushWBMedia
//
// Зависимости:
//   - wbOzonSync.fetchWBData() — получает nmID по vendorCode
//   - wbOzonSync.pushWBCard() — обновляет карточку товара
//   - wbOzonSync.pushWBMedia() — загружает изображения
//   - wbUrlToDataUri() — конвертирует URL в data URI для WB API
//
// Эндпоинт: POST /api/market/push/wb
// Заголовки: x-wb-token
// Тело: { vendorCode, title?, description?, characteristics?, images? }
// Ответ: { success, message, mediaStatus, mediaMessage? }
//
// --- КОД НАЧАЛО ---
//   // ─── Market: Push to WB ───
//   /**
//    * POST /market/push/wb — Обновление товара в Wildberries (описание, характеристики, изображения)
//    * @header {string} x-wb-token - Токен API Wildberries
//    * @param {Object} req.body - Тело запроса
//    * @param {string} req.body.vendorCode - Артикул товара (vendorCode)
//    * @param {string} [req.body.title] - Название товара
//    * @param {string} [req.body.description] - Описание товара
//    * @param {Array} [req.body.characteristics] - Характеристики товара
//    * @param {string[]} [req.body.images] - URL изображений для загрузки
//    * @returns {Promise<void>} { success: boolean, message: string, mediaStatus: string, mediaMessage?: string }
//    */
//   router.post('/push/wb', async (req, res) => {
//     const wbToken = req.headers['x-wb-token']
//     const { vendorCode, title, description, characteristics, images } = req.body
//
//     if (!wbToken) return res.status(401).json({ error: 'Требуется токен WB' })
//     if (!vendorCode) return res.status(400).json({ error: 'Нет vendorCode' })
//
//     try {
//       const wbResults = await wbOzonSync.fetchWBData([vendorCode], wbToken)
//       if (!wbResults || wbResults.length === 0 || wbResults[0].error) {
//         return res.status(404).json({ error: wbResults?.[0]?.error || 'Товар не найден в WB' })
//       }
//
//       const nmId = wbResults[0].nmID
//       if (!nmId) return res.status(400).json({ error: 'nmID не получен для товара' })
//
//       const updates = []
//
//       if (description !== undefined || (characteristics && characteristics.length > 0)) {
//         updates.push(wbOzonSync.pushWBCard(wbToken, nmId, vendorCode, description, characteristics))
//       }
//
//       await Promise.all(updates)
//
//       let mediaStatus = 'skipped'
//       let mediaMessage = null
//       if (images && Array.isArray(images) && images.length > 0) {
//         try {
//           const processedImages = await Promise.all(images.map(url => wbUrlToDataUri(url, log)))
//           await wbOzonSync.pushWBMedia(wbToken, nmId, processedImages)
//           mediaStatus = 'ok'
//         } catch (mediaErr) {
//           mediaStatus = 'error'
//           mediaMessage = mediaErr.message
//           log(`[Market] WB media push warning: ${mediaErr.message} — continuing`)
//         }
//       }
//
//       log(`[Market] WB push: updated ${vendorCode} (nmId: ${nmId})`)
//       res.json({ success: true, message: 'Товар обновлён в Wildberries', mediaStatus, mediaMessage })
//     } catch (e) {
//       log(`[Market] WB push error: ${e.message}`)
//       res.status(500).json({ error: e.message })
//     }
//   })
// --- КОД КОНЕЦ ---


// ================================================================
// 1.3  POST /api/market/push/ozon
// ================================================================
// Исходный файл: routes/market.js (строки 419–469)
//
// Что делает: обновляет товар в Ozon:
//   - Название, описание, изображения (через pushOzonImport)
//   - Атрибуты (через pushOzonAttributes)
//
// Зависимости:
//   - wbOzonSync.pushOzonImport() — импорт товара с описанием и изображениями
//   - wbOzonSync.pushOzonAttributes() — обновление атрибутов
//
// Эндпоинт: POST /api/market/push/ozon
// Заголовки: x-ozon-client-id, x-ozon-api-key
// Тело: { offerId?, productId?, title?, description?, attributes?, images?, typeId? }
// Ответ: { success, message, mediaStatus, mediaMessage? }
//
// Особенности:
//   - title/description/images и attributes отправляются раздельно
//   - offerId нужен для pushOzonImport, productId — для pushOzonAttributes
//   - typeId берётся из данных товара (window._ozonData.type_id)
//
// --- КОД НАЧАЛО ---
//   // ─── Market: Push to Ozon ───
//   /**
//    * POST /market/push/ozon — Обновление товара в Ozon (название, описание, атрибуты, изображения)
//    * @header {string} x-ozon-client-id - Client-ID Ozon
//    * @header {string} x-ozon-api-key - API-Key Ozon
//    * @param {Object} req.body - Тело запроса
//    * @param {string} [req.body.offerId] - offerId товара
//    * @param {string} [req.body.productId] - productId товара
//    * @param {string} [req.body.title] - Название товара
//    * @param {string} [req.body.description] - Описание товара
//    * @param {Array} [req.body.attributes] - Массив атрибутов
//    * @param {string[]} [req.body.images] - URL изображений
//    * @param {number} [req.body.typeId] - ID типа товара
//    * @returns {Promise<void>} { success: boolean, message: string, mediaStatus: string, mediaMessage?: string }
//    */
//   router.post('/push/ozon', async (req, res) => {
//     const ozonClientId = req.headers['x-ozon-client-id']
//     const ozonApiKey = req.headers['x-ozon-api-key']
//     const { offerId, productId, title, description, attributes, images, typeId } = req.body
//
//     if (!ozonClientId || !ozonApiKey) return res.status(401).json({ error: 'Требуются Client-Id и Api-Key Ozon' })
//     if (!offerId && !productId) return res.status(400).json({ error: 'Нет offerId или productId' })
//
//     try {
//       const updates = []
//
//       let ozonMediaStatus = 'skipped'
//       let ozonMediaMessage = null
//       if (title || description || (images && images.length > 0)) {
//         try {
//           await wbOzonSync.pushOzonImport(ozonClientId, ozonApiKey, offerId, title, description, images, typeId)
//           ozonMediaStatus = 'ok'
//         } catch (err) {
//           ozonMediaStatus = 'error'
//           ozonMediaMessage = err.message
//           log(`[Market] Ozon import/images warning (non-fatal): ${err.message}`)
//         }
//       }
//
//       if (attributes && Array.isArray(attributes) && attributes.length > 0 && productId) {
//         updates.push(wbOzonSync.pushOzonAttributes(ozonClientId, ozonApiKey, productId, attributes))
//       }
//
//       await Promise.all(updates)
//       log(`[Market] Ozon push: updated ${offerId}`)
//       res.json({ success: true, message: 'Товар обновлён в Ozon', mediaStatus: ozonMediaStatus, mediaMessage: ozonMediaMessage })
//     } catch (e) {
//       log(`[Market] Ozon push error: ${e.message}`)
//       res.status(500).json({ error: e.message })
//     }
//   })
// --- КОД КОНЕЦ ---


// ================================================================
// 1.4  POST /api/market/sync/image
// ================================================================
// Исходный файл: routes/market.js (строки 471–529)
//
// Что делает: синхронизирует одно изображение между маркетплейсами:
//   - WB → Ozon: syncImageToOzon (создаёт задачу)
//   - Ozon → WB: syncImageToWB (загружает напрямую)
//
// Зависимости:
//   - wbOzonSync.syncImageToOzon()
//   - wbOzonSync.syncImageToWB()
//
// Эндпоинт: POST /api/market/sync/image
// Заголовки: x-wb-token (для Ozon→WB), x-ozon-client-id + x-ozon-api-key (для WB→Ozon)
// Тело: { sourcePlatform, targetPlatform, imageUrl, nmId?, offerId? }
// Ответ: { success, message, taskId? }
//
// Ограничения: MS images not supported (sourcePlatform === 'ms' или targetPlatform === 'ms')
//
// --- КОД НАЧАЛО ---
//   // ─── Market: Sync image ───
//   /**
//    * POST /market/sync/image — Синхронизация изображения между маркетплейсами (WB → Ozon или Ozon → WB)
//    * @header {string} [x-wb-token] - Токен WB (для направления Ozon→WB)
//    * @header {string} [x-ozon-client-id] - Client-ID Ozon (для направления WB→Ozon)
//    * @header {string} [x-ozon-api-key] - API-Key Ozon (для направления WB→Ozon)
//    * @param {Object} req.body - Тело запроса
//    * @param {string} req.body.sourcePlatform - Платформа-источник ('wb' | 'ozon')
//    * @param {string} req.body.targetPlatform - Целевая платформа ('wb' | 'ozon')
//    * @param {string} req.body.imageUrl - URL изображения для синхронизации
//    * @param {string} [req.body.nmId] - nmId WB (для направления Ozon→WB)
//    * @param {string} [req.body.offerId] - offerId Ozon (для направления WB→Ozon)
//    * @returns {Promise<void>} { success: boolean, message: string, taskId?: string }
//    */
//   router.post('/sync/image', async (req, res) => {
//     const wbToken = req.headers['x-wb-token']
//     const ozonClientId = req.headers['x-ozon-client-id']
//     const ozonApiKey = req.headers['x-ozon-api-key']
//     const { sourcePlatform, targetPlatform, imageUrl, nmId, offerId } = req.body
//
//     if (!sourcePlatform || !targetPlatform || !imageUrl) {
//       return res.status(400).json({ error: 'Требуются sourcePlatform, targetPlatform и imageUrl' })
//     }
//
//     if (sourcePlatform === 'ms' || targetPlatform === 'ms') {
//       return res.status(400).json({ error: 'MS images not supported' })
//     }
//
//     try {
//       if (sourcePlatform === 'wb' && targetPlatform === 'ozon') {
//         if (!ozonClientId || !ozonApiKey) {
//           return res.status(401).json({ error: 'Требуются Client-Id и Api-Key Ozon' })
//         }
//         if (!offerId) {
//           return res.status(400).json({ error: 'Требуется offerId' })
//         }
//
//         const taskId = await wbOzonSync.syncImageToOzon(ozonClientId, ozonApiKey, offerId, imageUrl)
//         log(`[Market] Image synced WB→Ozon: offer=${offerId}, task=${taskId}`)
//         return res.json({ success: true, message: 'Изображение отправлено в Ozon', taskId })
//       } else if (sourcePlatform === 'ozon' && targetPlatform === 'wb') {
//         if (!wbToken) {
//           return res.status(401).json({ error: 'Требуется токен WB' })
//         }
//         if (!nmId) {
//           return res.status(400).json({ error: 'Требуется nmId' })
//         }
//
//         await wbOzonSync.syncImageToWB(wbToken, nmId, imageUrl)
//         log(`[Market] Image synced Ozon→WB: nmId=${nmId}`)
//         return res.json({ success: true, message: 'Изображение отправлено в Wildberries' })
//       } else {
//         return res.status(400).json({ error: 'Invalid sync direction. Supported: wb→ozon, ozon→wb' })
//       }
//     } catch (e) {
//       log(`[Market] Sync image error: ${e.message}`)
//       res.status(500).json({ error: e.message })
//     }
//   })
// --- КОД КОНЕЦ ---


// ================================================================
// 1.5  POST /api/market/image/upload
// ================================================================
// Исходный файл: routes/market.js (строки 531–564)
//
// Что делает: принимает файл через multer (multipart/form-data),
// сохраняет на сервер, возвращает URL для доступа.
//
// Multer middleware: imageUpload.single('image')
// - поле 'image' — файл
// - поле 'platform' — опционально, для логирования
// - поле 'vendorCode' — опционально, для логирования
//
// Эндпоинт: POST /api/market/image/upload
// Формат: multipart/form-data
// Ответ: { success, filename, originalName, size, url, fullUrl }
//
// --- КОД НАЧАЛО ---
//   // ─── Market: Upload image ───
//   /**
//    * POST /market/image/upload — Загрузка изображения на сервер через multer (multipart/form-data)
//    * @param {Object} req.file - Загруженный файл (поле 'image')
//    * @param {string} [req.body.platform] - Платформа назначения (для логирования)
//    * @param {string} [req.body.vendorCode] - Артикул товара (для логирования)
//    * @returns {Promise<void>} { success: boolean, filename: string, originalName: string, size: number, url: string }
//    */
//   router.post('/image/upload', imageUpload.single('image'), async (req, res) => {
//     try {
//       if (!req.file) {
//         return res.status(400).json({ error: 'Файл не загружен' })
//       }
//
//       const fileUrl = '/temp/images/' + req.file.filename
//       log(`[Upload] Image saved: ${req.file.filename} (${(req.file.size / 1024).toFixed(1)} KB)`, 'info')
//
//       if (req.body.platform || req.body.vendorCode) {
//         log(`[Upload] Metadata: platform=${req.body.platform || '-'}, vendorCode=${req.body.vendorCode || '-'}`, 'info')
//       }
//
//       res.json({
//         success: true,
//         filename: req.file.filename,
//         originalName: req.file.originalname,
//         size: req.file.size,
//         url: fileUrl,
//         fullUrl: fileUrl
//       })
//     } catch (e) {
//       log(`[Upload] Error: ${e.message}`, 'error')
//       res.status(500).json({ error: e.message })
//     }
//   })
// --- КОД КОНЕЦ ---


// ════════════════════════════════════════════════════════════════
// РАЗДЕЛ 2 — Frontend: push-функции (браузерный JS)
// ════════════════════════════════════════════════════════════════
//
// Исходный файл: public/index.html (inline <script> внутри </body>)
// Все функции находятся в глобальной области видимости.
//
// Глобальные переменные, используемые функциями:
//   - _pendingCrossSyncs = { wb: [], ozon: [], ms: [] }
//   - _syncedOemCode = ''
//   - window._wbData, window._ozonData — данные последнего поиска
//
// DOM-элементы, с которыми взаимодействуют функции:
//   - #wb-title, #ozon-title — поля названия товара
//   - .wb-desc, .ozon-desc, .ms-desc — textarea описания
//   - .wb-attr, .ozon-attr, .ms-attr — textarea значений атрибутов
//   - #wb-images, #ozon-images — контейнеры изображений
//   - #marketResults — корневой div результатов
//
// API-эндпоинты, которые вызывают функции:
//   - POST /api/market/push/ms
//   - POST /api/market/push/wb
//   - POST /api/market/push/ozon
//   - POST /api/market/image/upload
//
// ================================================================


// ------------------------------------------------------------------
// 2.4  getDescriptionValue(textarea) — helper: оригинал или изменения
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 1477–1487)
//
// Если значение textarea совпадает с originalClean → возвращает originalHtml
// (неизменённое описание отправляется в исходном HTML-формате).
// Если пользователь изменил текст → возвращает текущее значение (clean text).
//
// Зависимости: data-атрибуты textarea:
//   data-original-html  — оригинальное описание с HTML-тегами
//   data-original-clean — очищенное от HTML описание (для сравнения)
//
// --- КОД НАЧАЛО ---
//       // ── Helper: get description value (if unchanged → original HTML; if changed → clean text) ──
//       function getDescriptionValue(textarea) {
//         if (!textarea) return '';
//         var originalClean = textarea.dataset.originalClean || '';
//         var originalHtml = textarea.dataset.originalHtml || '';
//         var currentValue = textarea.value || '';
//         // If user hasn't changed it, send original HTML; otherwise send clean text
//         if (currentValue === originalClean) {
//           return originalHtml;
//         }
//         return currentValue;
//       }
// --- КОД КОНЕЦ ---


// ------------------------------------------------------------------
// 2.5  collectImageUrls(platform) — сбор URL изображений из DOM
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 485–498)
//
// Собирает URL изображений из images-row в текущем порядке (порядок DOM).
// Используется pushToWB() и pushToOzon() для отправки изображений.
//
// Параметры:
//   @param {string} platform — 'wb', 'ozon' или 'ms'
//   @returns {string[]} — массив URL из data-full атрибутов .thumb элементов
//
// --- КОД НАЧАЛО ---
//       // Collect image URLs from DOM in current order (global — called from push functions)
//       function collectImageUrls(platform) {
//         var imagesRow = document.getElementById(platform + '-images')
//         if (!imagesRow) return []
//         var urls = []
//         var thumbWraps = imagesRow.querySelectorAll('.thumb-wrap:not(.add-new)')
//         thumbWraps.forEach(function(wrap) {
//           var img = wrap.querySelector('.thumb')
//           if (img) {
//             var fullUrl = img.getAttribute('data-full')
//             if (fullUrl) urls.push(fullUrl)
//           }
//         })
//         return urls
//       }
// --- КОД КОНЕЦ ---


// ------------------------------------------------------------------
// 2.1  pushToMS(productId) — отправка данных в МойСклад
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 1491–1544)
//
// Собирает данные из DOM и отправляет POST /api/market/push/ms.
//
// Собираемые данные:
//   - title: из #unified-title или #ms-unified-title (не отрисовано в UI)
//   - attributes: из всех .ms-attr textarea
//   - description: через getDescriptionValue(.ms-desc)
//
// Взаимодействие с DOM:
//   - Создаёт <div class="search-status"> перед результатами для статуса
//   - При успехе: через 2 сек вызывает searchProductByOEM() для обновления
//
// Примечание: @rudiment — функция существует, но кнопка в UI не отрисована
//
// --- КОД НАЧАЛО ---
//       // Push updated data to MoySklad
//       // @rudiment — функция существует, но кнопка в UI не отрисована (намеренно)
//       async function pushToMS(productId) {
//         if (!productId) return;
//
//         const titleEl = document.getElementById('unified-title') || document.getElementById('ms-unified-title');
//         const title = titleEl ? titleEl.value.trim() : '';
//
//         // Collect attributes
//         var msAttrInputs = document.querySelectorAll('.ms-attr');
//         var msAttributes = Array.from(msAttrInputs).map(function (input) {
//           return { id: input.dataset.attrId, value: input.value };
//         });
//
//         // Description: check if changed, use original HTML if unchanged
//         var msTextarea = document.querySelector('.ms-desc');
//         var msDescription = getDescriptionValue(msTextarea);
//
//         const resultsDiv = document.getElementById('marketResults');
//         const statusDiv = document.createElement('div');
//         statusDiv.className = 'search-status';
//         statusDiv.innerHTML = '<span class="search-spinner"></span> Сохранение в МойСклад...';
//         resultsDiv.prepend(statusDiv);
//
//         try {
//           const msToken = localStorage.getItem('ms_token') || '';
//           if (!msToken) throw new Error('Нет токена МойСклад');
//
//           const response = await fetch(`/api/market/push/ms`, {
//             method: 'POST',
//             headers: {
//               'Content-Type': 'application/json',
//               'x-api-token': msToken
//             },
//             body: JSON.stringify({
//               productId: productId,
//               title: title,
//               description: msDescription,
//               attributes: msAttributes
//             })
//           });
//
//           const result = await response.json();
//
//           if (!response.ok) throw new Error(result.error || 'Ошибка отправки');
//
//           statusDiv.className = 'search-status success';
//           statusDiv.innerHTML = `✅ Данные успешно сохранены в МойСклад`;
//
//           // Refresh search after 2 seconds
//           setTimeout(() => searchProductByOEM(), 2000);
//         } catch (error) {
//           statusDiv.className = 'search-status error';
//           statusDiv.innerHTML = `❌ Ошибка отправки в МойСклад: ${error.message}`;
//         }
//       }
// --- КОД КОНЕЦ ---


// ------------------------------------------------------------------
// 2.2  pushToWB(vendorCode) — отправка данных в Wildberries
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 1547–1627)
//
// Собирает данные из DOM и отправляет POST /api/market/push/wb.
//
// Собираемые данные:
//   - title: из #wb-title
//   - characteristics: из всех .wb-attr textarea (id → parseInt, value → [value])
//   - description: через getDescriptionValue(.wb-desc)
//   - images: через collectImageUrls('wb'), с фильтрацией локальных (/temp/) URL
//
// Особенности:
//   - Локальные URL (/temp/) отфильтровываются — WB API не может их загрузить
//   - После успешной отправки изображений: снимает класс thumb-pending и очищает _pendingCrossSyncs.wb
//
// --- КОД НАЧАЛО ---
//       // Push updated data to Wildberries
//        async function pushToWB(vendorCode) {
//          if (!vendorCode) return;
//
//          const titleEl = document.getElementById('wb-title');
//          const title = titleEl ? titleEl.value.trim() : '';
//
//         // Collect characteristics
//         var wbAttrInputs = document.querySelectorAll('.wb-attr');
//         var wbCharacteristics = Array.from(wbAttrInputs).map(function (input) {
//           return { id: parseInt(input.dataset.attrId), value: [input.value] };
//         });
//
//         // Description: check if changed, use original HTML if unchanged
//         var wbTextarea = document.querySelector('.wb-desc');
//         var wbDescription = getDescriptionValue(wbTextarea);
//
//         // Collect images in current order
//         var wbImages = collectImageUrls('wb');
//
//         const resultsDiv = document.getElementById('marketResults');
//         const statusDiv = document.createElement('div');
//         statusDiv.className = 'search-status';
//         statusDiv.innerHTML = '<span class="search-spinner"></span> Сохранение в WB...';
//         resultsDiv.prepend(statusDiv);
//
//         try {
//           const wbToken = localStorage.getItem('wb_token') || '';
//           if (!wbToken) throw new Error('Нет токена WB');
//
//           // Filter out local URLs that marketplaces can't access
//         var wbExternalImages = wbImages.filter(function(url) {
//           return !url.startsWith('/temp/');
//         });
//         if (wbImages.length !== wbExternalImages.length) {
//           var wbSkipped = wbImages.length - wbExternalImages.length;
//           console.warn('[WB] Skipping ' + wbSkipped + ' local image(s) — not accessible by WB API');
//         }
//
//         const response = await fetch('/api/market/push/wb', {
//             method: 'POST',
//             headers: {
//               'Content-Type': 'application/json',
//               'x-wb-token': wbToken
//             },
//             body: JSON.stringify({
//               vendorCode: vendorCode,
//               title: title,
//               description: wbDescription,
//               characteristics: wbCharacteristics,
//               ...(wbExternalImages.length > 0 && { images: wbExternalImages })
//             })
//           });
//
//           const result = await response.json();
//
//           if (!response.ok) throw new Error(result.error || 'Ошибка отправки');
//
//           statusDiv.className = 'search-status success';
//           var wbMsg = `✅ Данные успешно сохранены в WB для ${vendorCode}`;
//           if (result.mediaStatus === 'error') {
//             wbMsg += `<br><span style="color:#e67e22;">⚠️ Изображения: ${result.mediaMessage || 'ошибка загрузки'}</span>`;
//           } else if (result.mediaStatus === 'skipped') {
//             wbMsg += `<br><span style="color:#999;">ℹ️ Изображения: нет для отправки</span>`;
//           } else if (result.mediaStatus === 'ok') {
//             // Remove pending markers from DOM — images were pushed successfully
//             var wbRow = document.getElementById('wb-images');
//             if (wbRow) {
//               wbRow.querySelectorAll('.thumb-wrap.thumb-pending').forEach(function(w) {
//                 w.classList.remove('thumb-pending');
//                 var badge = w.querySelector('.thumb-pending-badge');
//                 if (badge) badge.remove();
//               });
//             }
//             _pendingCrossSyncs.wb = [];
//           }
//           statusDiv.innerHTML = wbMsg;
//         } catch (error) {
//           statusDiv.className = 'search-status error';
//           statusDiv.innerHTML = `❌ Ошибка отправки в WB: ${error.message}`;
//         }
//       }
// --- КОД КОНЕЦ ---


// ------------------------------------------------------------------
// 2.3  pushToOzon(offerId, productId) — отправка данных в Ozon
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 1630–1717)
//
// Собирает данные из DOM и отправляет POST /api/market/push/ozon.
//
// Собираемые данные:
//   - title: из #ozon-title
//   - attributes: из всех .ozon-attr textarea (attribute_id → parseInt, values: [{value: ...}])
//   - description: через getDescriptionValue(.ozon-desc)
//   - images: через collectImageUrls('ozon'), с фильтрацией локальных (/temp/) URL
//   - typeId: из window._ozonData.type_id (если есть)
//
// Особенности:
//   - Локальные URL (/temp/) отфильтровываются — Ozon API не может их загрузить
//   - После успешной отправки изображений: снимает класс thumb-pending и очищает _pendingCrossSyncs.ozon
//
// --- КОД НАЧАЛО ---
//       // Push updated data to Ozon
//        async function pushToOzon(offerId, productId) {
//          if (!offerId && !productId) return;
//
//          const titleEl = document.getElementById('ozon-title');
//          const title = titleEl ? titleEl.value.trim() : '';
//
//         // Collect Ozon attributes
//         var ozonAttrInputs = document.querySelectorAll('.ozon-attr');
//         var ozonAttributes = Array.from(ozonAttrInputs).map(function (input) {
//           return {
//             attribute_id: parseInt(input.dataset.attrId),
//             values: [{ value: input.value }]
//           };
//         });
//
//         // Description: check if changed, use original HTML if unchanged
//         var ozonTextarea = document.querySelector('.ozon-desc');
//         var ozonDescription = getDescriptionValue(ozonTextarea);
//
//         // Collect images in current order
//         var ozonImages = collectImageUrls('ozon');
//
//         const resultsDiv = document.getElementById('marketResults');
//         const statusDiv = document.createElement('div');
//         statusDiv.className = 'search-status';
//         statusDiv.innerHTML = '<span class="search-spinner"></span> Сохранение в Ozon...';
//         resultsDiv.prepend(statusDiv);
//
//         try {
//           const ozonClientId = localStorage.getItem('ozon_client_id') || '';
//           const ozonApiKey = localStorage.getItem('ozon_api_key') || '';
//           if (!ozonClientId || !ozonApiKey) throw new Error('Нет ключей Ozon');
//
//         // Filter out local URLs that marketplaces can't access
//         var ozonExternalImages = ozonImages.filter(function(url) {
//           return !url.startsWith('/temp/');
//         });
//         if (ozonImages.length !== ozonExternalImages.length) {
//           var ozonSkipped = ozonImages.length - ozonExternalImages.length;
//           console.warn('[Ozon] Skipping ' + ozonSkipped + ' local image(s) — not accessible by Ozon API');
//         }
//
//           const response = await fetch('/api/market/push/ozon', {
//             method: 'POST',
//             headers: {
//               'Content-Type': 'application/json',
//               'x-ozon-client-id': ozonClientId,
//               'x-ozon-api-key': ozonApiKey
//             },
//             body: JSON.stringify({
//               offerId: offerId,
//               productId: productId,
//               title: title,
//               description: ozonDescription,
//               attributes: ozonAttributes,
//               ...(ozonExternalImages.length > 0 && { images: ozonExternalImages }),
//               typeId: (window._ozonData && window._ozonData.type_id) || null
//             })
//           });
//
//           const result = await response.json();
//
//           if (!response.ok) throw new Error(result.error || 'Ошибка отправки');
//
//           statusDiv.className = 'search-status success';
//           var ozonPushMsg = `✅ Данные успешно сохранены в Ozon (${offerId || productId})`;
//           if (result.mediaStatus === 'error') {
//             ozonPushMsg += `<br><span style="color:#e67e22;">⚠️ Изображения: ${result.mediaMessage || 'ошибка загрузки'}</span>`;
//           } else if (result.mediaStatus === 'skipped') {
//             ozonPushMsg += `<br><span style="color:#999;">ℹ️ Изображения: нет для отправки</span>`;
//           } else if (result.mediaStatus === 'ok') {
//             // Remove pending markers from DOM — images were pushed successfully
//             var ozonRow = document.getElementById('ozon-images');
//             if (ozonRow) {
//               ozonRow.querySelectorAll('.thumb-wrap.thumb-pending').forEach(function(w) {
//                 w.classList.remove('thumb-pending');
//                 var badge = w.querySelector('.thumb-pending-badge');
//                 if (badge) badge.remove();
//               });
//             }
//             _pendingCrossSyncs.ozon = [];
//           }
//           statusDiv.innerHTML = ozonPushMsg;
//         } catch (error) {
//           statusDiv.className = 'search-status error';
//           statusDiv.innerHTML = `❌ Ошибка отправки в Ozon: ${error.message}`;
//         }
//       }
// --- КОД КОНЕЦ ---


// ════════════════════════════════════════════════════════════════
// РАЗДЕЛ 3 — Frontend: управление изображениями
// ════════════════════════════════════════════════════════════════
//
// Исходный файл: public/index.html (inline <script>)
// Эти функции реализуют UI для добавления, копирования и загрузки
// изображений товаров между маркетплейсами.
//
// ================================================================


// ------------------------------------------------------------------
// 3.1  _pendingCrossSyncs — система отслеживания незапушенных изображений
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 468–471)
//
// Глобальное состояние. Хранит URL изображений, которые были добавлены
// через drag между маркетплейсами (или через попап), но ещё не отправлены
// на целевую площадку через push-функцию.
//
// Очищается:
//   - После успешного pushToWB() / pushToOzon() (соответствующая платформа)
//   - При смене OEM-кода (в searchProductByOEM)
//
// --- КОД НАЧАЛО ---
//       // ── Cross-platform image sync state ──
//       // Хранит URL картинок, добавленных через drag между маркетами (ещё не отправленных на площадку)
//       var _pendingCrossSyncs = { wb: [], ozon: [], ms: [] };
//       var _syncedOemCode = '';
// --- КОД КОНЕЦ ---


// ------------------------------------------------------------------
// 3.2  copyImageToPlatform() — копирование изображения между площадками
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 500–508)
//
// Копирует URL изображения из одной площадки в другую (UI only, без API).
// Добавляет URL в _pendingCrossSyncs[targetPlatform] (если ещё нет).
// Вызывает addThumbToRow() для немедленного отображения.
//
// Параметры:
//   @param {string} imageUrl — URL изображения
//   @param {string} sourcePlatform — откуда ('wb', 'ozon', 'ms')
//   @param {string} targetPlatform — куда ('wb', 'ozon', 'ms')
//
// --- КОД НАЧАЛО ---
//       // Copy image URL from one platform's images to another (UI only, no API call)
//       function copyImageToPlatform(imageUrl, sourcePlatform, targetPlatform) {
//         if (!_pendingCrossSyncs[targetPlatform]) _pendingCrossSyncs[targetPlatform] = [];
//         if (_pendingCrossSyncs[targetPlatform].indexOf(imageUrl) === -1) {
//           _pendingCrossSyncs[targetPlatform].push(imageUrl);
//         }
//         // Direct DOM manipulation — add thumbnail without re-render
//         addThumbToRow(targetPlatform, imageUrl);
//       }
// --- КОД КОНЕЦ ---


// ------------------------------------------------------------------
// 3.3  addThumbToRow() — добавление превью в DOM
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 510–625)
//
// Создаёт элемент .thumb-wrap.thumb-pending и вставляет перед .add-new.
// Содержит:
//   - <img> с data-full URL
//   - Бейдж ⏳ (ожидание отправки)
//   - Попап для увеличения при наведении
//   - Кнопки ⬇ (скачать) и ✕ (удалить)
//   - Drag-хендлеры для перетаскивания
//
// Drag-хендлеры (встроенные):
//   - dragstart: записывает { platform, url } в dataTransfer, подсвечивает все rows
//   - dragend: очищает все drag-классы
//   - dragover: разрешает drop
//   - dragenter/dragleave: подсветка .drag-over
//   - drop: реордеринг thumbnails + обновление data-idx
//
// Параметры:
//   @param {string} platform — 'wb', 'ozon', 'ms'
//   @param {string} imageUrl — URL изображения
//
// --- КОД НАЧАЛО ---
//       // Add a thumbnail element to a platform's images row (no re-render, no flash)
//       function addThumbToRow(platform, imageUrl) {
//         var imagesRow = document.getElementById(platform + '-images');
//         if (!imagesRow) return;
//         var addNew = imagesRow.querySelector('.thumb-wrap.add-new');
//         if (!addNew) return;
//
//         // Skip duplicates
//         var existingImgs = imagesRow.querySelectorAll('.thumb-wrap:not(.add-new) .thumb');
//         for (var ei = 0; ei < existingImgs.length; ei++) {
//           if (existingImgs[ei].getAttribute('data-full') === imageUrl) return;
//         }
//
//         var nextIdx = imagesRow.querySelectorAll('.thumb-wrap:not(.add-new)').length;
//
//         var wrap = document.createElement('div');
//         wrap.className = 'thumb-wrap thumb-pending';
//         wrap.innerHTML =
//           '<div class="thumb-img-container">' +
//             '<img class="thumb" src="' + esc(imageUrl) + '" alt="Фото ' + (nextIdx + 1) + '" data-full="' + esc(imageUrl) + '" />' +
//           '</div>' +
//           '<span class="thumb-pending-badge">⏳</span>' +
//           '<div class="thumb-popup">' +
//             '<img src="' + esc(imageUrl) + '" alt="Фото ' + (nextIdx + 1) + '" />' +
//           '</div>' +
//           '<div class="thumb-actions">' +
//             '<button class="thumb-btn download" title="Скачать" data-url="' + esc(imageUrl) + '">⬇</button>' +
//             '<button class="thumb-btn delete" title="Удалить" data-idx="' + nextIdx + '" data-platform="' + platform + '">✕</button>' +
//           '</div>';
//
//         imagesRow.insertBefore(wrap, addNew);
//
//         // Attach hover-zoom popup on mouseenter
//         wrap.addEventListener('mouseenter', function() {
//           var rect = wrap.getBoundingClientRect();
//           if (rect.top < 420) {
//             wrap.classList.add('popup-bottom');
//           } else {
//             wrap.classList.remove('popup-bottom');
//           }
//         });
//
//         // Make the new thumbnail draggable (for reordering and cross-platform copy)
//         wrap.draggable = true;
//
//         wrap.addEventListener('dragstart', function(e) {
//           var srcPlatform = imagesRow.id.replace('-images', '');
//           var imgEl = this.querySelector('.thumb');
//           var imgUrl = imgEl ? imgEl.getAttribute('data-full') : '';
//           this.classList.add('dragging');
//           e.dataTransfer.effectAllowed = 'move';
//           e.dataTransfer.setData('text/plain', JSON.stringify({
//             platform: srcPlatform,
//             url: imgUrl
//           }));
//           document.querySelectorAll('.images-row').forEach(function(r) {
//             r.classList.add('drag-active');
//             if (r.id === imagesRow.id) r.classList.add('drag-source');
//           });
//         });
//
//         wrap.addEventListener('dragend', function(e) {
//           this.classList.remove('dragging');
//           document.querySelectorAll('.images-row').forEach(function(r) {
//             r.classList.remove('drag-active', 'drag-source');
//           });
//           document.querySelectorAll('.thumb-wrap').forEach(function(w) {
//             w.classList.remove('drag-over');
//           });
//         });
//
//         wrap.addEventListener('dragover', function(e) {
//           e.preventDefault();
//           e.dataTransfer.dropEffect = 'move';
//         });
//
//         wrap.addEventListener('dragenter', function(e) {
//           e.preventDefault();
//           if (!this.classList.contains('dragging')) {
//             this.classList.add('drag-over');
//           }
//         });
//
//         wrap.addEventListener('dragleave', function(e) {
//           if (!this.contains(e.relatedTarget)) {
//             this.classList.remove('drag-over');
//           }
//         });
//
//         wrap.addEventListener('drop', function(e) {
//           e.preventDefault();
//           this.classList.remove('drag-over');
//
//           var dragging = imagesRow.querySelector('.thumb-wrap.dragging');
//           if (!dragging || dragging === this) return;
//
//           var allWraps = Array.from(imagesRow.querySelectorAll('.thumb-wrap:not(.add-new)'));
//           var fromIdx = allWraps.indexOf(dragging);
//           var toIdx = allWraps.indexOf(this);
//
//           if (fromIdx === -1 || toIdx === -1) return;
//
//           if (fromIdx < toIdx) {
//             this.parentNode.insertBefore(dragging, this.nextSibling);
//           } else {
//             this.parentNode.insertBefore(dragging, this);
//           }
//
//           var updatedWraps = imagesRow.querySelectorAll('.thumb-wrap:not(.add-new)');
//           updatedWraps.forEach(function(w, idx) {
//             w.querySelectorAll('.thumb-btn[data-idx]').forEach(function(btn) {
//               btn.dataset.idx = idx;
//             });
//           });
//         });
//       }
// --- КОД КОНЕЦ ---


// ------------------------------------------------------------------
// 3.4  showAddImagePopup() — попап для вставки URL изображения
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 1722–1781)
//
// Создаёт модальный попап с полем для ввода URL изображения.
// При подтверждении: добавляет URL в _pendingCrossSyncs и вызывает addThumbToRow().
//
// Взаимодействие с DOM:
//   - Создаёт overlay + popup динамически
//   - Поле ввода #popupImageUrl (автофокус после открытия)
//   - Кнопка "Добавить" (#popupAddBtn) — проверяет URL (http/https)
//   - Кнопка "Отмена" (#popupCancelBtn) / клик по overlay — закрывает
//   - Enter в поле ввода = клик по "Добавить"
//
// --- КОД НАЧАЛО ---
//       // ── Show popup for adding image by URL ──
//       function showAddImagePopup(platform) {
//         var overlay = document.createElement('div');
//         overlay.className = 'popup-overlay';
//         overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
//
//         var popup = document.createElement('div');
//         popup.className = 'popup-content';
//         popup.style.cssText = 'background:#fff;border-radius:12px;padding:28px;max-width:520px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);font-family:sans-serif;';
//
//         popup.innerHTML =
//           '<div style="font-size:22px;font-weight:700;margin-bottom:16px;">📷 Добавить изображение</div>' +
//           '<div style="color:#555;line-height:1.6;margin-bottom:16px;font-size:14px;">' +
//             'Маркетплейсам нужна публичная ссылка на изображение.<br><br>' +
//             '<strong>Варианты:</strong><br>' +
//             '1. Сначала загрузите в Ozon или Wildberries — потом сможете перетащить картинку в другой маркет<br>' +
//             '2. Или вставьте ссылку с хостинга (Яндекс.Диск, Google Диск и т.д.)' +
//           '</div>' +
//           '<label style="display:block;font-weight:600;margin-bottom:6px;font-size:13px;color:#333;">Ссылка на изображение:</label>' +
//           '<input type="url" id="popupImageUrl" placeholder="https://..." style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:18px;">' +
//           '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
//             '<button id="popupCancelBtn" style="padding:10px 20px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;">Отмена</button>' +
//             '<button id="popupAddBtn" style="padding:10px 20px;border:none;border-radius:8px;background:#5865f2;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">Добавить</button>' +
//           '</div>';
//
//         overlay.appendChild(popup);
//         document.body.appendChild(overlay);
//
//         setTimeout(function() { var inp = document.getElementById('popupImageUrl'); if (inp) inp.focus(); }, 100);
//
//         function closePopup() {
//           if (overlay.parentNode) document.body.removeChild(overlay);
//         }
//
//         document.getElementById('popupCancelBtn').addEventListener('click', closePopup);
//         overlay.addEventListener('click', function(e) {
//           if (e.target === overlay) closePopup();
//         });
//
//         document.getElementById('popupAddBtn').addEventListener('click', function() {
//           var url = document.getElementById('popupImageUrl').value.trim();
//           if (!url) return;
//           if (!url.startsWith('http://') && !url.startsWith('https://')) {
//             document.getElementById('popupImageUrl').style.borderColor = '#e74c3c';
//             return;
//           }
//           document.getElementById('popupImageUrl').style.borderColor = '#ddd';
//           // Add to pending syncs
//           if (!_pendingCrossSyncs[platform]) _pendingCrossSyncs[platform] = [];
//           if (_pendingCrossSyncs[platform].indexOf(url) === -1) {
//             _pendingCrossSyncs[platform].push(url);
//           }
//           // Add thumbnail directly to DOM
//           addThumbToRow(platform, url);
//           closePopup();
//         });
//
//         document.getElementById('popupImageUrl').addEventListener('keydown', function(e) {
//           if (e.key === 'Enter') document.getElementById('popupAddBtn').click();
//         });
//       }
// --- КОД КОНЕЦ ---


// ------------------------------------------------------------------
// 3.5  uploadImage() — загрузка файла на сервер
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 1784–1805)
//
// Загружает файл изображения на сервер через POST /api/market/image/upload
// (multipart/form-data). Вызывает callback с результатом.
//
// Параметры:
//   @param {File} file — файл изображения
//   @param {string} [platform] — платформа для логирования
//   @param {number|null} [replaceIdx] — индекс для замены (не реализован до конца)
//   @param {Function} callback — (err, result) => {}
//
// Используется в drag & drop обработчике (раздел 4.4) для загрузки
// изображений из проводника.
//
// --- КОД НАЧАЛО ---
//       // ── Upload helper function ──
//       function uploadImage(file, platform, replaceIdx, callback) {
//         var formData = new FormData();
//         formData.append('image', file);
//         if (platform) formData.append('platform', platform);
//         if (replaceIdx !== null && replaceIdx !== undefined) formData.append('replaceIdx', replaceIdx);
//
//         fetch('/api/market/image/upload', {
//           method: 'POST',
//           body: formData
//         })
//         .then(function(resp) { return resp.json(); })
//         .then(function(result) {
//           if (result.success) {
//             callback(null, result);
//           } else {
//             callback(result.error || 'Upload failed');
//           }
//         })
//         .catch(function(err) {
//           callback(err.message || 'Upload error');
//         });
//       }
// --- КОД КОНЕЦ ---


// ════════════════════════════════════════════════════════════════
// РАЗДЕЛ 4 — Frontend: Drag & drop обработчики
// ════════════════════════════════════════════════════════════════
//
// Исходный файл: public/index.html (строки 1276–1468)
//
// Все обработчики навешиваются внутри searchProductByOEM() после рендеринга
// результатов. Они работают с .images-row и .thumb-wrap элементами.
//
// ================================================================


// ------------------------------------------------------------------
// 4.1  Сортировка thumbnails внутри images-row (reorder)
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 1276–1361)
//
// Для каждого .thumb-wrap:not(.add-new) внутри .images-row:
//   - Устанавливает draggable = true
//   - На dragstart: сохраняет данные { platform, url } в dataTransfer,
//     подсвечивает все images-row (.drag-active, .drag-source)
//   - На dragend: очищает все drag-классы
//   - На dragover/dragenter/dragleave: управляет .drag-over
//   - На drop: реордеринг через insertBefore, обновляет data-idx
//
// --- КОД НАЧАЛО ---
//           // Drag & drop sorting for thumbnails
//           var imagesRows = resultsDiv.querySelectorAll('.images-row');
//           imagesRows.forEach(function(row) {
//             var wraps = row.querySelectorAll('.thumb-wrap:not(.add-new)');
//             wraps.forEach(function(wrap) {
//               wrap.draggable = true;
//
//               wrap.addEventListener('dragstart', function(e) {
//                 var srcPlatform = row.id.replace('-images', '');
//                 var imgEl = this.querySelector('.thumb');
//                 var imgUrl = imgEl ? imgEl.getAttribute('data-full') : '';
//                 this.classList.add('dragging');
//                 e.dataTransfer.effectAllowed = 'move';
//                 // Store source platform and image URL for cross-platform drag
//                 e.dataTransfer.setData('text/plain', JSON.stringify({
//                   platform: srcPlatform,
//                   url: imgUrl
//                 }));
//                 // Activate drag mode — highlight both rows for cross-platform hint
//                 document.querySelectorAll('.images-row').forEach(function(r) {
//                   r.classList.add('drag-active');
//                   if (r.id === row.id) r.classList.add('drag-source');
//                 });
//               });
//
//               wrap.addEventListener('dragend', function(e) {
//                 this.classList.remove('dragging');
//                 // Remove drag classes from ALL rows (not just this one)
//                 document.querySelectorAll('.images-row').forEach(function(r) {
//                   r.classList.remove('drag-active', 'drag-source');
//                 });
//                 // Remove drag-over from all wraps
//                 document.querySelectorAll('.thumb-wrap').forEach(function(w) {
//                   w.classList.remove('drag-over');
//                 });
//               });
//
//               wrap.addEventListener('dragover', function(e) {
//                 e.preventDefault();
//                 e.dataTransfer.dropEffect = 'move';
//               });
//
//               wrap.addEventListener('dragenter', function(e) {
//                 e.preventDefault();
//                 if (!this.classList.contains('dragging')) {
//                   this.classList.add('drag-over');
//                 }
//               });
//
//               wrap.addEventListener('dragleave', function(e) {
//                 // Only remove if actually leaving this element (not entering a child)
//                 if (!this.contains(e.relatedTarget)) {
//                   this.classList.remove('drag-over');
//                 }
//               });
//
//               wrap.addEventListener('drop', function(e) {
//                 e.preventDefault();
//                 this.classList.remove('drag-over');
//
//                 var dragging = row.querySelector('.thumb-wrap.dragging');
//                 if (!dragging || dragging === this) return;
//
//                 // Get all thumb wraps (excluding add-new)
//                 var allWraps = Array.from(row.querySelectorAll('.thumb-wrap:not(.add-new)'));
//                 var fromIdx = allWraps.indexOf(dragging);
//                 var toIdx = allWraps.indexOf(this);
//
//                 if (fromIdx === -1 || toIdx === -1) return;
//
//                 // Reorder DOM elements
//                 if (fromIdx < toIdx) {
//                   this.parentNode.insertBefore(dragging, this.nextSibling);
//                 } else {
//                   this.parentNode.insertBefore(dragging, this);
//                 }
//
//                 // Update data-idx attributes for all wraps
//                 var updatedWraps = row.querySelectorAll('.thumb-wrap:not(.add-new)');
//                 updatedWraps.forEach(function(w, idx) {
//                   w.querySelectorAll('.thumb-btn[data-idx]').forEach(function(btn) {
//                     btn.dataset.idx = idx;
//                   });
//                 });
//               });
//             });
//           });
// --- КОД КОНЕЦ ---


// ------------------------------------------------------------------
// 4.2 + 4.4  Cross-platform копирование через drag на images-row
//             + File upload через drag из проводника
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 1363–1428)
//
// Обработчики на .images-row (сам row, не .thumb-wrap):
//
// dragover: предотвращает default, добавляет .drag-active
// dragleave: убирает .drag-active (только при полном выходе)
//
// drop: два сценария:
//   1. File drag (e.dataTransfer.files.length > 0):
//      - Фильтр: только image/*
//      - Определяет platform из id row (например, 'wb-images' → 'wb')
//      - Вызывает uploadImage() для каждого файла
//      - После загрузки вызывает searchProductByOEM() для обновления
//
//   2. Cross-platform thumb drag:
//      - Парсит JSON из dataTransfer
//      - Если platform источника !== platform цели → вызывает copyImageToPlatform()
//
// --- КОД НАЧАЛО ---
//           // ── Drag & drop: files OR cross-platform image copy on images-row ──
//           resultsDiv.querySelectorAll('.images-row').forEach(function(row) {
//             // Prevent default drag behaviors on the row
//             row.addEventListener('dragover', function(e) {
//               e.preventDefault();
//               e.stopPropagation();
//               this.classList.add('drag-active');
//             });
//
//             row.addEventListener('dragleave', function(e) {
//               e.preventDefault();
//               e.stopPropagation();
//               // Only deactivate if leaving the row entirely
//               if (!this.contains(e.relatedTarget)) {
//                 this.classList.remove('drag-active');
//               }
//             });
//
//             row.addEventListener('drop', function(e) {
//               e.preventDefault();
//               e.stopPropagation();
//               this.classList.remove('drag-active');
//
//               // Remove drag classes from all rows
//               document.querySelectorAll('.images-row').forEach(function(r) {
//                 r.classList.remove('drag-active', 'drag-source');
//               });
//               document.querySelectorAll('.thumb-wrap').forEach(function(w) {
//                 w.classList.remove('drag-over');
//               });
//
//               // Case 1: File drag from computer
//               var files = e.dataTransfer.files;
//               if (files && files.length > 0) {
//                 for (var fi = 0; fi < files.length; fi++) {
//                   var file = files[fi];
//                   if (!file.type.startsWith('image/')) continue;
//
//                   var platform = this.id ? this.id.replace('-images', '') : '';
//                   if (!platform) continue;
//
//                   uploadImage(file, platform, null, function(err, result) {
//                     if (err) {
//                       console.error('Upload failed:', err);
//                       return;
//                     }
//                     searchProductByOEM();
//                   });
//                 }
//                 return;
//               }
//
//               // Case 2: Cross-platform thumb drag — copy image to this platform
//               try {
//                 var dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
//                 if (dragData && dragData.platform && dragData.url) {
//                   var targetPlatform = this.id.replace('-images', '');
//                   if (dragData.platform !== targetPlatform) {
//                     copyImageToPlatform(dragData.url, dragData.platform, targetPlatform);
//                   }
//                 }
//               } catch (ex) {
//                 // Not a JSON payload — ignore
//               }
//             });
//           });
// --- КОД КОНЕЦ ---


// ------------------------------------------------------------------
// 4.3  Cross-platform копирование через drag на add-new кнопку
// ------------------------------------------------------------------
// Исходный файл: public/index.html (строки 1430–1468)
//
// Обработчики на .thumb-wrap.add-new (кнопка "＋" добавления изображения).
// Позволяет перетаскивать thumbnail из одной площадки на кнопку "+" другой.
//
// dragover/dragenter: разрешает drop, подсвечивает
// dragleave: убирает подсветку
// drop: парсит JSON из dataTransfer, вызывает copyImageToPlatform()
//
// Файлы из проводника на add-new НЕ обрабатываются (возврат в images-row handler).
//
// --- КОД НАЧАЛО ---
//           // ── Cross-platform drag & drop: add image to + button ──
//           resultsDiv.querySelectorAll('.thumb-wrap.add-new').forEach(function(addWrap) {
//             addWrap.addEventListener('dragover', function(e) {
//               e.preventDefault();
//             });
//
//             addWrap.addEventListener('dragenter', function(e) {
//               e.preventDefault();
//               this.classList.add('drag-over');
//             });
//
//             addWrap.addEventListener('dragleave', function(e) {
//               e.preventDefault();
//               if (!this.contains(e.relatedTarget)) {
//                 this.classList.remove('drag-over');
//               }
//             });
//
//             addWrap.addEventListener('drop', function(e) {
//               e.preventDefault();
//               e.stopPropagation();
//
//               // Files from computer — already handled by images-row handler
//               if (e.dataTransfer.files && e.dataTransfer.files.length > 0) return;
//
//               // Cross-platform image copy
//               try {
//                 var dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
//                 if (dragData && dragData.platform && dragData.url) {
//                   var targetPlatform = addWrap.closest('.images-row').id.replace('-images', '');
//                   if (dragData.platform !== targetPlatform) {
//                     copyImageToPlatform(dragData.url, dragData.platform, targetPlatform);
//                   }
//                 }
//               } catch (ex) {
//                 // Not JSON — ignore
//               }
//             });
//           });
// --- КОД КОНЕЦ ---


// ════════════════════════════════════════════════════════════════
// РАЗДЕЛ 5 — Frontend: Push-кнопки (btn-row)
// ════════════════════════════════════════════════════════════════
//
// Исходный файл: public/index.html (строки 1166–1193)
// Рендерятся внутри searchProductByOEM() в составе market-grid.
//
// Кнопки "💾 Сохранить" отображаются в нижней части карточки товара,
// по одной для Ozon и Wildberries (для МойСклад кнопка не отрисована).
//
// CSS-классы кнопок:
//   - .btn-ozon (синий #005BFF) для Ozon
//   - .btn-wb (фиолетово-розовый градиент) для WB
//   - .btn-block — ширина 100%
//   - .push-btn — общий класс для push-кнопок
//
// DOM-структура:
//   .market-row.btn-row
//     .ozon-cell: содержит <button onclick="pushToOzon(...)">
//     .wb-cell:  содержит <button onclick="pushToWB(...)">
//
// ================================================================

// ------------------------------------------------------------------
// 5.1  HTML-шаблон кнопок "💾 Сохранить" для Ozon и WB
// ------------------------------------------------------------------
//
// --- КОД НАЧАЛО ---
//           // ── Push button row (2 колонки) ──
//           html += '<div class="market-row btn-row">';
//
//           // Ozon push button
//           html += '<div class="ozon-cell" style="display:flex;align-items:center;">';
//           if (ozon && !ozon.error) {
//             html +=
// '<button onclick="pushToOzon(\'' +
//               (ozon.code || '') +
//               "', " +
//               (ozon.product_id || 0) +
//               ')" class="btn btn-ozon btn-block push-btn"><img class="btn-icon" src="images/marketplace/ozon-favicon.svg"> 💾 Сохранить</button>';
//           }
//           html += '</div>';
//
//           // WB push button
//           html += '<div class="wb-cell" style="display:flex;align-items:center;">';
//           if (wb && !wb.error) {
//             html +=
// '<button onclick="pushToWB(\'' +
//                (wb.vendorCode || wb.code || '') +
//                '\')" class="btn btn-wb btn-block push-btn"><img class="btn-icon" src="images/marketplace/wb-favicon.svg"> 💾 Сохранить</button>';
//           }
//           html += '</div>';
//
//           html += '</div>'; // end btn-row
// --- КОД КОНЕЦ ---


// ════════════════════════════════════════════════════════════════
// РАЗДЕЛ 6 — Frontend: AI improve buttons
// ════════════════════════════════════════════════════════════════
//
// Исходный файл: public/index.html (строки 783, 803, 823)
//
// Кнопки "✨ Улучшить (AI)" отображаются под textarea описания для каждой
// площадки (МойСклад, Ozon, Wildberries) — disabled по умолчанию.
//
// Планировалось: при клике отправлять описание на AI-сервис для улучшения
// текста (грамматика, стиль, SEO). На момент архивации функционал не реализован.
//
// CSS-класс: .improve-btn
// data-атрибут: data-platform="ms" | "ozon" | "wb"
//
// ================================================================

// ------------------------------------------------------------------
// 6.1  Кнопки "✨ Улучшить (AI)" для MS, Ozon, WB
// ------------------------------------------------------------------
//
// --- КОД НАЧАЛО ---
//             // MS improve button (under ms description textarea)
//             html +=
//               '<button class="improve-btn" data-platform="ms" disabled>✨ Улучшить (AI)</button>';
//
//             // Ozon improve button (under ozon description textarea)
//             html +=
//               '<button class="improve-btn" data-platform="ozon" disabled>✨ Улучшить (AI)</button>';
//
//             // WB improve button (under wb description textarea)
//             html +=
//               '<button class="improve-btn" data-platform="wb" disabled>✨ Улучшить (AI)</button>';
// --- КОД КОНЕЦ ---
