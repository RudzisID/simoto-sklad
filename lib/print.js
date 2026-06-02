/**
 * @file Печать стикеров (PDF через API МойСклад)
 * @module lib/print
 *
 * Модуль для генерации PDF-стикеров через API МойСклад.
 * Содержит логику поиска шаблона стикера ("Октябрьский 7"),
 * определения организации и типа цены, а также экспорта PDF.
 *
 * @requires lib/api-utils
 */

const { getApi } = require('./api-utils')
const { debug, info, success, warn, error } = require('./logger')

// In-memory cache for sticker template (full object)
let stickerTemplate = null
let stickerTemplateName = 'Октябрьский 7'

// In-memory cache for organization ID
let organizationId = null

// In-memory cache for price type data (full object)
let priceTypeData = null

/**
 * Получение ID организации через API
 * Ищет организацию с "OZON" в названии (как в веб-интерфейсе)
 * @returns {Promise<string|null>} - Organization ID or null
 * @throws {Error} Если организация не найдена или произошла ошибка API
 */
async function getOrganizationId() {
  if (organizationId) {
    debug(`Organization cache hit: ${organizationId}`)
    return organizationId
  }

  try {
    const API = getApi()
    const result = await API.GET('entity/organization')

    if (result.rows && result.rows.length > 0) {
      // Try to find organization with "OZON" in name (like web interface)
      let org = result.rows.find(o => o.name && o.name.includes('OZON'))

      // Fallback: take first organization
      if (!org) {
        org = result.rows[0]
      }

      organizationId = org.id
      info(`Found organization: ${org.name} (${organizationId})`)
      return organizationId
    }

    throw new Error('No organization found')
  } catch (e) {
    error(`Error getting organization: ${e.message}`)
    throw e
  }
}

/**
 * Получение типа цены по умолчанию — возвращает ПОЛНЫЙ объект (id, name, meta)
 * @returns {Promise<object|null>} - Price type object or null
 * @throws {Error} Если тип цены не найден или произошла ошибка API
 */
async function getPriceType() {
  if (priceTypeData) {
    debug(`Price type cache hit: ${priceTypeData.name} (${priceTypeData.id})`)
    return priceTypeData
  }

  try {
    const API = getApi()
    const result = await API.GET('context/companysettings/pricetype/default')

    if (result && result.id) {
      priceTypeData = {
        id: result.id,
        name: result.name,
        meta: {
          href: `https://api.moysklad.ru/api/remap/1.2/context/companysettings/pricetype/${result.id}`,
          type: 'pricetype',
          mediaType: 'application/json'
        }
      }
      info(`Found default price type: ${result.name} (${result.id})`)
      return priceTypeData
    }

    throw new Error('Default price type not found')
  } catch (e) {
    error(`Error getting price type: ${e.message}`)
    throw e
  }
}

/**
 * Получение шаблона стикера — возвращает ПОЛНЫЙ объект (id, name, type)
 * Ищет шаблон с названием, содержащим "Октябрьский 7"
 * @returns {Promise<object|null>} - Template object or null
 * @throws {Error} Если шаблон не найден или произошла ошибка API
 */
async function getStickerTemplate() {
  // Return cached object if available
  if (stickerTemplate) {
    debug(`Template cache hit: ${stickerTemplate.name} (${stickerTemplate.id})`)
    return stickerTemplate
  }

  try {
    const API = getApi()
    // Templates are in assortment metadata
    const metadata = await API.GET('entity/assortment/metadata/customtemplate')

    // Search in rows array
    if (metadata.rows && Array.isArray(metadata.rows)) {
      const template = metadata.rows.find(
        (t) => t.name && t.name.includes('Октябрьский 7')
      )

      if (template && template.id) {
        stickerTemplate = {
          id: template.id,
          name: template.name,
          type: template.type || 'mxtemplate'  // Use ACTUAL type from API!
        }
        info(`Found template "${stickerTemplate.name}": ${stickerTemplate.id}, type: ${stickerTemplate.type}`)
        return stickerTemplate
      }
    }

    throw new Error(`Template "${stickerTemplateName}" not found in assortment metadata`)
  } catch (e) {
    error(`Error getting sticker template: ${e.message}`)
    throw e
  }
}

/**
 * Экспорт PDF-стикера для товара
 * @param {string} productId - Product UUID
 * @param {string} token - API token (for Authorization header)
 * @param {string} [entityType='product'] - Entity type (product, bundle, service, etc.)
 * @returns {Promise<string|null>} - PDF URL or file path
 * @throws {Error} Если шаблон не найден, организация не определена,
 *                  тип цены отсутствует или экспорт завершился ошибкой (включая 202/ошибки API)
 */
async function exportStickerPdf(productId, token, entityType = 'product') {
  try {
    // Get FULL template object (with id, name, type)
    const template = await getStickerTemplate()
    if (!template) {
      throw new Error('Template not found')
    }

    // Get organization ID (required for export)
    const orgId = await getOrganizationId()
    if (!orgId) {
      throw new Error('Organization ID not found')
    }

    // Get price type (required for product export - error 33009)
    // Returns full object with id, name, meta
    const priceType = await getPriceType()
    if (!priceType) {
      throw new Error('Price type not found')
    }

    const apiBase = 'https://api.moysklad.ru/api/remap/1.2'
    // Use correct endpoint based on entity type (product, bundle, service, etc.)
    const url = `${apiBase}/entity/${entityType}/${productId}/export/`

    // FORMAT for product stickers:
    // Use "template" (singular) + "count" at top level
    // "templates" array is ONLY for document sets (causes error 33011 for products)
    const body = {
      template: {
        meta: {
          href: `${apiBase}/entity/assortment/metadata/customtemplate/${template.id}`,
          type: template.type,  // ← Use ACTUAL type from API (mxtemplate for stickers!)
          mediaType: 'application/json'
        }
      },
      salePrice: {  // ← REQUIRED for stickers/labels (not "priceType"!)
        priceType: {
          meta: {
            href: priceType.meta.href,  // From getPriceType()
            type: 'pricetype'
          }
        }
      },
      count: 1,  // Quantity of stickers at TOP level (required for thermal labels)
      extension: 'pdf',
      organization: {
        meta: {
          href: `${apiBase}/entity/organization/${orgId}`,
          type: 'organization',
          mediaType: 'application/json'
        }
      }
    }

    debug(`Sending request body: ${JSON.stringify(body)}`)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    debug(`Response status: ${response.status}`)

    // MoySklad returns 303 with PDF URL in Location header
    if (response.status === 303) {
      const pdfUrl = response.headers.get('Location')
      if (pdfUrl) {
        success(`PDF generated: ${pdfUrl}`)
        return pdfUrl
      }
    }

    // Handle 200 (PDF returned directly in response body)
    if (response.status === 200) {
      const arrayBuffer = await response.arrayBuffer()
      const pdfBuffer = Buffer.from(arrayBuffer)
      info(`PDF received directly, size: ${pdfBuffer.length} bytes`)

      // Save to temp file
      const fs = require('fs')
      const path = require('path')
      const os = require('os')

      const tempDir = os.tmpdir()
      const fileName = `sticker_${productId}_${Date.now()}.pdf`
      const filePath = path.join(tempDir, fileName)

      fs.writeFileSync(filePath, pdfBuffer)
      info(`PDF saved to: ${filePath}`)
      return filePath
    }

    // Handle 202 (processing) - not implemented yet per docs
    if (response.status === 202) {
      const responseText = await response.text()
      throw new Error(`PDF generation in progress (202). Response: ${responseText}`)
    }

    // For other errors, read response as text
    const responseText = await response.text()
    warn(`Export failed with status ${response.status}: ${responseText}`)
    throw new Error(`Export failed: ${response.status} ${responseText}`)
  } catch (e) {
    error(`Error exporting sticker PDF: ${e.message}`)
    throw e
  }
}

/**
 * Очистка кэша шаблонов (полезно для тестирования)
 */
function clearTemplateCache() {
  stickerTemplate = null
}

module.exports = {
  getStickerTemplate,
  exportStickerPdf,
  clearTemplateCache
}
