/**
 * SiMOTO Auto-Docs Generator
 * Автоматическая генерация документации при изменениях в коде
 * 
 * Запускается через: npm run docs
 * Автоматически: npm run precommit (перед коммитом)
 */

const fs = require('fs')
const path = require('path')

const PROJECT_ROOT = path.join(__dirname, '..')
const LIB_DIR = path.join(PROJECT_ROOT, 'lib')
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs')
const MODULES_DOCS_DIR = path.join(DOCS_DIR, 'lib')

// ============================================
// КОНФИГУРАЦИЯ
// ============================================

const MODULE_PATTERNS = {
  'moysklad.md': {
    description: 'Баррел-файл модулей API МойСклад',
    functions: ['initApi', 'getClient', 'createPayment', 'createDemand', 'createReturn', 'cancelOrder']
  },
  'batch.md': {
    description: 'Пакетная обработка с SSE стримингом',
    functions: ['processBatch', 'processNumbers', 'chunkArray']
  },
  'order.md': {
    description: 'Поиск и работа с заказами',
    functions: ['searchOrders', 'getOrderByNumber', 'updateOrderState']
  },
  'check.md': {
    description: 'Проверка статусов заказов',
    functions: ['checkNumber', 'getOrderStatus', 'canCreatePayment', 'canCreateDemand']
  },
  'payment.md': {
    description: 'Создание входящих платежей',
    functions: ['createPayment', 'createPaymentByOrder']
  },
  'demand.md': {
    description: 'Создание отгрузок',
    functions: ['createDemand', 'createDemandByOrder']
  },
  'return.md': {
    description: 'Создание возвратов',
    functions: ['createReturn', 'createReturnByOrder']
  },
  'cancel.md': {
    description: 'Отмена заказов',
    functions: ['cancelOrder', 'cancelOrderByNumber']
  },
  'api-utils.md': {
    description: 'Утилиты для работы с API МойСклад',
    functions: ['initApiClient', 'makeRequest', 'handleResponse']
  },
  'constants.md': {
    description: 'Константы UUID статусов и атрибутов',
    functions: ['STATUS_SHIPPED', 'STATUS_CANCELLED', 'SALES_CHANNEL', 'ATTRIBUTE_STATUS']
  }
}

// ============================================
// ФУНКЦИИ ГЕНЕРАЦИИ
// ============================================

/**
 * Сканирует файл и извлекает JSDoc комментарии
 */
function extractJSDoc(content) {
  const jsdocRegex = /\/\*\*[\s\S]*?\*\/\s*(?:async\s+)?function\s+(\w+)/g
  const functions = []
  let match
  
  while ((match = jsdocRegex.exec(content))) {
    const doc = match[0]
      .replace(/\/\*\*|\*\/|function\s+\w+/g, '')
      .replace(/\*/g, '')
      .trim()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join(' ')
    functions.push({ name: match[1], description: doc })
  }
  return functions
}

/**
 * Извлекает все экспортируемые функции из модуля
 */
function extractExports(content) {
  const exportRegex = /(?:export\s+(?:default\s+)?|module\.exports\s*=\s*)(?:async\s+)?function\s+(\w+)/g
  const exports = []
  let match
  
  while ((match = exportRegex.exec(content))) {
    exports.push(match[1])
  }
  return exports
}

/**
 * Генерирует документацию для модуля
 */
function generateModuleDocs(moduleName, modulePath) {
  const content = fs.readFileSync(modulePath, 'utf8')
  const functions = extractExports(content)
  const jsdoc = extractJSDoc(content)
  
  const pattern = MODULE_PATTERNS[moduleName]
  if (!pattern) return null
  
  let md = `# ${pattern.description}\n\n`
  md += `**Файл**: \`${path.basename(modulePath)}\`\n\n`
  md += '## Экспортируемые функции\n\n'
  md += '| Функция | Описание |\n'
  md += '|--------|----------|\n'
  
  functions.forEach(fn => {
    const doc = jsdoc.find(d => d.name === fn)
    md += `| \`${fn}\` | ${doc ? doc.description : '—'} |\n`
  })
  
  md += '\n## Примеры использования\n\n'
  md += '```javascript\n'
  md += `const { ${functions[0]} } = require('./${moduleName.replace('.md', '.js')}');\n`
  md += '```\n'
  
  return md
}

/**
 * Основная функция генерации документации
 */
function generateDocs() {
  console.log('🔄 Генерация документации SiMOTO...\n')
  
  // Проверка/создание директорий
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true })
    console.log(`✅ Создана директория: ${DOCS_DIR}`)
  }
  
  if (!fs.existsSync(MODULES_DOCS_DIR)) {
    fs.mkdirSync(MODULES_DOCS_DIR, { recursive: true })
    console.log(`✅ Создана директория: ${MODULES_DOCS_DIR}`)
  }
  
  // Генерация документации для каждого модуля
  let updatedCount = 0
  
  for (const [docFile, pattern] of Object.entries(MODULE_PATTERNS)) {
    const moduleFile = docFile.replace('.md', '.js')
    const modulePath = path.join(LIB_DIR, moduleFile)
    
    if (fs.existsSync(modulePath)) {
      const docs = generateModuleDocs(docFile, modulePath)
      if (docs) {
        const docPath = path.join(MODULES_DOCS_DIR, docFile)
        fs.writeFileSync(docPath, docs, 'utf8')
        console.log(`✅ Обновлен: ${docFile}`)
        updatedCount++
      }
    } else {
      console.log(`⚠️ Модуль не найден: ${moduleFile}`)
    }
  }
  
  console.log(`\n✅ Документация обновлена: ${updatedCount} файлов`)
  console.log(`📁 Расположение: ${MODULES_DOCS_DIR}`)
  
  return updatedCount
}

// ============================================
// ЗАПУСК
// ============================================

if (require.main === module) {
  generateDocs()
}

module.exports = { generateDocs, extractExports, extractJSDoc }