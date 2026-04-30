# Поиск и управление товарами

**Файл**: `lib/product.js`

Модуль для поиска товаров по коду в МойСклад. Используется для печати этикеток и отображения информации о товарах.

## Экспортируемые функции

| Функция | Описание |
|---------|----------|
| `findProductByCode(code)` | Поиск товара по коду (name, code, article) |
| `getProductFullByCode(code)` | Получение полных данных товара с расширением полей |
| `clearProductCache()` | Очистка кэша товаров |

## Примеры использования

### Поиск товара по коду

```javascript
const { findProductByCode } = require('./lib/product')

// Поиск товара
const product = await findProductByCode('ABC123')
if (product) {
  console.log(`Товар: ${product.name}, ID: ${product.id}`)
} else {
  console.log('Товар не найден')
}
```

### Получение полных данных товара

```javascript
const { getProductFullByCode } = require('./lib/product')

// Получение полной информации (с единицами измерения, папкой, изображениями)
const fullProduct = await getProductFullByCode('ABC123')
if (fullProduct) {
  console.log(`Цена: ${fullProduct.salePrices[0].value / 100} руб.`)
  console.log(`Единица: ${fullProduct.uom.name}`)
}
```

## Детали реализации

### findProductByCode(code)

Ищет товар по коду, используя два метода:

1. **Поиск (search)** — использует параметр `search=` API МойСклад (поиск по name, code, article)
2. **Фильтр (filter)** — если поиск не дал результатов, использует точный фильтр по полю `code`

Результат кэшируется в памяти (Map) для ускорения повторных запросов.

**Параметры:**
- `code` (string) — код товара

**Возвращает:**
- Объект товара или `null`, если не найден

### getProductFullByCode(code)

Получает полные данные товара с расширением полей:
- `uom` — единица измерения
- `productFolder` — папка товара
- `images` — изображения
- `salePrices` — цены продажи
- `attributes` — дополнительные атрибуты

### clearProductCache()

Очищает кэш товаров. Полезно при тестировании или когда нужно сбросить кэшированные данные.

## Использование в API

Модуль используется в эндпойнте `POST /api/print-sticker` для поиска товара перед генерацией этикетки.
