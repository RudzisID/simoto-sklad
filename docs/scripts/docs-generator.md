# Docs Generator: Генератор документации

**Файл**: `scripts/docs-generator.js`

Автоматическая генерация документации для модулей `lib/` на основе JSDoc комментариев и экспортируемых функций.

## Использование

```bash
# Через npm script
npm run docs

# Напрямую
node scripts/docs-generator.js
```

Также запускается автоматически перед коммитом через `npm run precommit`.

## Что делает

1. **Сканирует** файлы в папке `lib/`
2. **Извлекает** JSDoc комментарии и список экспортируемых функций
3. **Генерирует** `.md` файлы в папку `docs/lib/`
4. **Обновляет** существующую документацию

## Генерируемые файлы

| Файл документации | Модуль | Функции |
|-------------------|--------|---------|
| `docs/lib/moysklad.md` | `lib/moysklad.js` | `initApi`, `getApi` |
| `docs/lib/batch.md` | `lib/batch.js` | `processBatch` |
| `docs/lib/order.md` | `lib/order.js` | `findOrderByShipmentNum`, `getOrderFull`, ... |
| `docs/lib/check.md` | `lib/check.js` | `checkOrder` |
| `docs/lib/payment.md` | `lib/payment.js` | `createPayment` |
| `docs/lib/demand.md` | `lib/demand.js` | `createDemand` |
| `docs/lib/return.md` | `lib/return.js` | `createReturn` |
| `docs/lib/cancel.md` | `lib/cancel.js` | `cancelOrder` |
| `docs/lib/api-utils.md` | `lib/api-utils.js` | `initApi`, `getApi`, `getChannelAttrValue` |
| `docs/lib/constants.md` | `lib/constants.js` | `ORDER_STATUS`, `DEMAND_STATUS`, ... |

## Формат документации

Для каждого модуля создается Markdown файл:

```markdown
# Описание модуля

**Файл**: `module.js`

## Экспортируемые функции

| Функция | Описание |
|---------|----------|
| `functionName` | Описание из JSDoc |

## Примеры использования

\```javascript
const { functionName } = require('./module');
\```
```

## Пример JSDoc для документирования

```javascript
/**
 * Поиск товара по коду
 * @param {string} code - Код товара
 * @returns {Promise<object|null>} - Товар или null
 */
async function findProductByCode(code) {
  // ...
}
```

## Экспортируемые функции

Модуль экспортирует:
- `generateDocs()` — основная функция генерации
- `extractExports(content)` — извлечение экспортов из кода
- `extractJSDoc(content)` — извлечение JSDoc комментариев

## Примечание

⚠️ **Внимание**: Текущая реализация не покрывает все модули (например, `product.js`, `print.js`). Для полного покрытия добавьте их в `MODULE_PATTERNS` в коде генератора.
