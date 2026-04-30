# Синхронизация WB / Ozon

**Файл**: `integrations/wb_ozon_sync.js`

Скелетная реализация для синхронизации товаров между Wildberries, Ozon и МойСклад. В текущей версии использует заглушки (mock data).

## Экспортируемые функции

| Функция | Описание |
|---------|----------|
| `fetchWBData(codeList)` | Получение данных о товарах из Wildberries |
| `fetchOzonData(codeList)` | Получение данных о товарах из Ozon |
| `compareAndAggregate(wbData, ozonData)` | Сравнение и объединение данных |
| `prepareAddForWB(merged)` | Подготовка данных для импорта в WB |
| `prepareAddForOZON(merged)` | Подготовка данных для импорта в Ozon |

## Примеры использования

### Синхронизация товаров

```javascript
const wbOzonSync = require('./integrations/wb_ozon_sync')

// Коды товаров для синхронизации
const codes = ['ABC123', 'DEF456']

// Получение данных (в текущей версии — заглушки)
const wbData = await wbOzonSync.fetchWBData(codes)
const ozonData = await wbOzonSync.fetchOzonData(codes)

// Объединение данных
const merged = wbOzonSync.compareAndAggregate(wbData, ozonData)
console.log(merged)
// [
//   {
//     code: 'ABC123',
//     title: 'WB Product ABC123',
//     price: 120,
//     stock: 25,
//     site: 'Wildberries',
//     sources: ['WB', 'OZON']
//   }
// ]

// Подготовка для импорта
const forWB = wbOzonSync.prepareAddForWB(merged)
const forOzon = wbOzonSync.prepareAddForOZON(merged)
```

### Использование в API

```javascript
// POST /api/sync-products
app.post('/api/sync-products', async (req, res) => {
  const { wbCodes, ozonCodes } = req.body
  const wbData = await wbOzonSync.fetchWBData(wbCodes || [])
  const ozonData = await wbOzonSync.fetchOzonData(ozonCodes || [])
  const merged = wbOzonSync.compareAndAggregate(wbData, ozonData)
  res.json({ success: true, merged })
})
```

## Детали реализации

### fetchWBData(codeList)

В текущей версии возвращает mock-данные для каждого кода:
- `code` — код товара
- `title` — название (заглушка)
- `price` — цена (случайное число 100-200)
- `stock` — остаток (случайное число 0-20)
- `site` — 'Wildberries'

**TODO**: Заменить на реальный API Wildberries.

### fetchOzonData(codeList)

Аналогично WB, возвращает mock-данные:
- `site` — 'OZON'
- Цена в диапазоне 90-210

**TODO**: Заменить на реальный API Ozon.

### compareAndAggregate(wbData, ozonData)

Объединяет данные по коду товара:
- Если товар есть в обеих системах — берется минимальная цена и суммируются остатки
- Добавляется поле `sources` — список источников

### prepareAddForWB(merged) / prepareAddForOZON(merged)

Трансформируют объединенные данные в формат, ожидаемый интерфейсом импорта соответствующей площадки.

## Статус

⚠️ **Скелетная реализация** — требует подключения реальных API WB и Ozon.
