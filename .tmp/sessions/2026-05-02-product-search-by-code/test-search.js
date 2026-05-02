/**
 * Тестовый скрипт для диагностики поиска товара по коду с кириллицей
 * 
 * Использование:
 *   node .tmp/sessions/2026-05-02-product-search-by-code/test-search.js <token> [code]
 * 
 * Пример:
 *   node .tmp/sessions/2026-05-02-product-search-by-code/test-search.js "your-token-here" "0180-051003-0003комплект"
 */

const Moysklad = require('moysklad')

const token = process.argv[2]
const testCode = process.argv[3] || '0180-051003-0003комплект'

if (!token) {
  console.error('Ошибка: укажите токен первым аргументом')
  console.error('Использование: node test-search.js <token> [code]')
  process.exit(1)
}

const ms = Moysklad({ token })

async function testSearch() {
  console.log('=== Тест поиска товара по коду ===')
  console.log(`Код для поиска: "${testCode}"`)
  console.log(`Длина кода: ${testCode.length}`)
  console.log(`Кодированный: ${encodeURIComponent(testCode)}`)
  console.log('')

  // Тест 1: search через query объект (правильный способ)
  console.log('--- Тест 1: search через query объект ---')
  try {
    const result1 = await ms.GET('entity/product', { search: testCode, limit: 10 })
    console.log(`Результатов search: ${result1.meta?.size || 0}`)
    if (result1.rows && result1.rows.length > 0) {
      result1.rows.forEach((row, i) => {
        console.log(`  [${i}] name: "${row.name}"`)
        console.log(`      code: "${row.code}"`)
        console.log(`      article: "${row.article}"`)
        console.log(`      id: "${row.id}"`)
        console.log(`      code === testCode: ${row.code === testCode}`)
        console.log(`      article === testCode: ${row.article === testCode}`)
        console.log('')
      })
    } else {
      console.log('  Нет результатов')
    }
  } catch (e) {
    console.error(`  Ошибка: ${e.message}`)
  }
  console.log('')

  // Тест 2: filter=code через query объект
  console.log('--- Тест 2: filter=code через query объект ---')
  try {
    const filterStr = `code=${testCode}`
    const result2 = await ms.GET('entity/product', { filter: filterStr, limit: 10 })
    console.log(`Результатов filter=code: ${result2.meta?.size || 0}`)
    if (result2.rows && result2.rows.length > 0) {
      result2.rows.forEach((row, i) => {
        console.log(`  [${i}] name: "${row.name}"`)
        console.log(`      code: "${row.code}"`)
        console.log(`      article: "${row.article}"`)
        console.log(`      id: "${row.id}"`)
        console.log('')
      })
    } else {
      console.log('  Нет результатов')
    }
  } catch (e) {
    console.error(`  Ошибка: ${e.message}`)
  }
  console.log('')

  // Тест 3: filter=article через query объект
  console.log('--- Тест 3: filter=article через query объект ---')
  try {
    const filterStr = `article=${testCode}`
    const result3 = await ms.GET('entity/product', { filter: filterStr, limit: 10 })
    console.log(`Результатов filter=article: ${result3.meta?.size || 0}`)
    if (result3.rows && result3.rows.length > 0) {
      result3.rows.forEach((row, i) => {
        console.log(`  [${i}] name: "${row.name}"`)
        console.log(`      code: "${row.code}"`)
        console.log(`      article: "${row.article}"`)
        console.log(`      id: "${row.id}"`)
        console.log('')
      })
    } else {
      console.log('  Нет результатов')
    }
  } catch (e) {
    console.error(`  Ошибка: ${e.message}`)
  }
  console.log('')

  // Тест 4: search через строку URL (текущий способ в product.js)
  console.log('--- Тест 4: search через строку URL (текущий способ) ---')
  try {
    const searchQuery = `search=${encodeURIComponent(testCode)}`
    const url = 'entity/product?' + searchQuery
    console.log(`URL: ${url}`)
    const result4 = await ms.GET(url)
    console.log(`Результатов: ${result4.meta?.size || 0}`)
    if (result4.rows && result4.rows.length > 0) {
      result4.rows.forEach((row, i) => {
        console.log(`  [${i}] name: "${row.name}"`)
        console.log(`      code: "${row.code}"`)
        console.log(`      article: "${row.article}"`)
        console.log(`      id: "${row.id}"`)
        console.log('')
      })
    } else {
      console.log('  Нет результатов')
    }
  } catch (e) {
    console.error(`  Ошибка: ${e.message}`)
  }
  console.log('')

  // Тест 5: filter=code через строку URL (текущий способ в product.js)
  console.log('--- Тест 5: filter=code через строку URL (текущий способ) ---')
  try {
    const filter = `filter=code=${encodeURIComponent(testCode)}`
    const url = 'entity/product?' + filter
    console.log(`URL: ${url}`)
    const result5 = await ms.GET(url)
    console.log(`Результатов: ${result5.meta?.size || 0}`)
    if (result5.rows && result5.rows.length > 0) {
      result5.rows.forEach((row, i) => {
        console.log(`  [${i}] name: "${row.name}"`)
        console.log(`      code: "${row.code}"`)
        console.log(`      article: "${row.article}"`)
        console.log(`      id: "${row.id}"`)
        console.log('')
      })
    } else {
      console.log('  Нет результатов')
    }
  } catch (e) {
    console.error(`  Ошибка: ${e.message}`)
  }
  console.log('')

  console.log('=== Тест завершён ===')
}

testSearch().catch(console.error)
