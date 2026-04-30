# Печать этикеток (стикеров)

**Файл**: `lib/print.js`

Модуль для генерации PDF-этикеток товаров через API МойСклад. Использует шаблоны (custom templates) для печати.

## Экспортируемые функции

| Функция | Описание |
|---------|----------|
| `exportStickerPdf(productId, token)` | Экспорт этикетки товара в PDF |
| `getStickerTemplate()` | Получение шаблона этикетки (кэшируется) |
| `getOrganizationId()` | Получение ID организации (кэшируется) |
| `getPriceType()` | Получение типа цены по умолчанию (кэшируется) |
| `clearTemplateCache()` | Очистка кэша шаблона |

## Примеры использования

### Генерация этикетки

```javascript
const { exportStickerPdf } = require('./lib/print')

// productId — UUID товара в МойСклад
// token — API токен (для заголовка Authorization)
const result = await exportStickerPdf('12345678-1234-1234-1234-123456789012', 'ваш_токен')

if (result.startsWith('http')) {
  // Вернулся URL (статус 303)
  console.log('PDF URL:', result)
} else {
  // Вернулся путь к файлу (статус 200)
  console.log('PDF файл:', result)
}
```

### Использование в server.js

```javascript
// POST /api/print-sticker
const product = await findProductByCode(code)
const result = await exportStickerPdf(product.id, token)

if (result.startsWith('http')) {
  res.json({ success: true, pdfUrl: result })
} else {
  res.sendFile(result, { headers: { 'Content-Type': 'application/pdf' } })
}
```

## Детали реализации

### exportStickerPdf(productId, token)

Экспортирует этикетку товара в PDF через API МойСклад.

**Параметры:**
- `productId` (string) — UUID товара
- `token` (string) — токен API для авторизации

**Возвращает:**
- URL (начинается с `http`) — если МойСклад вернул 303 (Location header)
- Путь к файлу — если МойСклад вернул 200 (PDF в теле ответа)

**Формат запроса к API:**
```json
{
  "template": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/assortment/metadata/customtemplate/{id}",
      "type": "mxtemplate",
      "mediaType": "application/json"
    }
  },
  "salePrice": {
    "priceType": {
      "meta": { "href": "...", "type": "pricetype" }
    }
  },
  "count": 1,
  "extension": "pdf",
  "organization": {
    "meta": { "href": "...", "type": "organization" }
  }
}
```

### Кэширование

Модуль кэширует в памяти:
- **Шаблон этикетки** — ищет шаблон с именем "Октябрьский 7" в метаданных assortment
- **Организацию** — ищет организацию с "OZON" в названии, иначе берет первую
- **Тип цены** — берет тип цены по умолчанию из настроек компании

### Особенности

- Использует `fetch` (native) для запроса к API МойСклад
- Обрабатывает статусы: 303 (URL), 200 (файл), 202 (в обработке — пока не реализовано)
- При получении файла сохраняет его во временную папку ОС
