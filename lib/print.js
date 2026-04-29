// Sticker printing module
// Handles template lookup and PDF export via MoySklad API

const { getApi } = require('./api-utils')

// In-memory cache for sticker template ID
let stickerTemplateId = null
let stickerTemplateName = 'Октябрьский 7'

/**
 * Get sticker template ID from product metadata
 * Looks for custom template with name "Октябрьский 7"
 * @returns {Promise<string|null>} - Template ID or null
 */
async function getStickerTemplateId() {
  // Return cached ID if available
  if (stickerTemplateId) {
    console.log(`Template cache hit: ${stickerTemplateName} (${stickerTemplateId})`)
    return stickerTemplateId
  }

  try {
    const API = getApi()
    const metadata = await API.GET('entity/product/metadata')

    // Search in customTemplates array
    if (metadata.customTemplates && Array.isArray(metadata.customTemplates)) {
      const template = metadata.customTemplates.find(
        (t) => t.name === stickerTemplateName
      )

      if (template && template.id) {
        stickerTemplateId = template.id
        console.log(`Found template "${stickerTemplateName}": ${stickerTemplateId}`)
        return stickerTemplateId
      }
    }

    throw new Error(`Template "${stickerTemplateName}" not found in product metadata`)
  } catch (e) {
    console.error('Error getting sticker template:', e.message)
    throw e
  }
}

/**
 * Export sticker PDF for a product
 * @param {string} productId - Product UUID
 * @param {string} token - API token (for Authorization header)
 * @returns {Promise<string|null>} - PDF URL or null
 */
async function exportStickerPdf(productId, token) {
  try {
    const templateId = await getStickerTemplateId()
    if (!templateId) {
      throw new Error('Template ID not found')
    }

    const apiBase = 'https://api.moysklad.ru/api/remap/1.2'
    const url = `${apiBase}/entity/product/${productId}/export/`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        template: {
          meta: {
            href: `${apiBase}/entity/product/metadata/customtemplate/${templateId}`,
            type: 'customtemplate',
            mediaType: 'application/json'
          }
        },
        extension: 'pdf'
      })
    })

    // MoySklad returns 303 with PDF URL in Location header
    if (response.status === 303) {
      const pdfUrl = response.headers.get('Location')
      if (pdfUrl) {
        console.log('PDF generated:', pdfUrl)
        return pdfUrl
      }
    }

    // Handle 202 (processing) - not implemented yet per docs
    if (response.status === 202) {
      throw new Error('PDF generation in progress (202). Poling not implemented yet.')
    }

    const errorText = await response.text()
    throw new Error(`Export failed: ${response.status} ${errorText}`)
  } catch (e) {
    console.error('Error exporting sticker PDF:', e.message)
    throw e
  }
}

/**
 * Clear template cache (useful for testing)
 */
function clearTemplateCache() {
  stickerTemplateId = null
}

module.exports = {
  getStickerTemplateId,
  exportStickerPdf,
  clearTemplateCache
}
