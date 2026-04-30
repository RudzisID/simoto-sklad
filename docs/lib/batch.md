# Пакетная обработка с SSE стримингом

**Файл**: `batch.js`

Модуль для массовой обработки заказов с поддержкой SSE (Server-Sent Events) для realtime обновлений. Включает цветное логирование для наглядности.

## Экспортируемые функции

| Функция | Описание |
|--------|----------|
| `processBatch(numbers, action, log, onProgress, options)` | Основная функция пакетной обработки |

## Параметры processBatch

| Параметр | Тип | Описание |
|----------|-----|----------|
| `numbers` | `string[]` | Массив номеров заказов |
| `action` | `string` | Действие: `'check'`, `'demand'`, `'payment'`, `'return'`, `'cancel'` |
| `log` | `function` | Функция логирования (из server.js) |
| `onProgress` | `function` | Callback для SSE (вызывается после каждого заказа) |
| `options` | `object` | Дополнительные опции (например, `{ onAbort: () => boolean }`) |

## Цветное логирование

Модуль использует функцию `log` из `server.js`, которая добавляет цветовую кодировку:

| Содержимое сообщения | Цвет | Пример |
|---------------------|------|--------|
| Ошибка / error | 🔴 Красный | `Ошибка: заказ не найден` |
| Успех / created | 🟢 Зеленый | `Платеж создан: Пл-000001` |
| Пропущен / skipped | 🟡 Желтый | `Пропущен: уже оплачено` |
| Завершено / completed | 🔵 Голубой | `Завершено: обработано 10 заказов` |
| Начало / batch | 🟣 Пурпурный | `Начало batch: payment` |

## Примеры использования

### Обычная пакетная обработка

```javascript
const { processBatch } = require('./batch.js')

// Проверка заказов
const result = await processBatch(
  ['0128545550-0011-1', '4965524118'],
  'check',
  (msg) => console.log(msg) // функция логирования
)

console.log(result)
// {
//   orders: [...],
//   created: 0,
//   skipped: 2,
//   errors: 0
// }
```

### SSE стриминг

```javascript
const { processBatch } = require('./batch.js')

// Callback для отправки прогресса через SSE
const onProgress = (result, index, total) => {
  const data = JSON.stringify({
    type: 'progress',
    index: index + 1,
    total: total,
    result: result
  })
  res.write(`data: ${data}\n\n`)
}

// Опции с проверкой отмены
const options = {
  onAbort: () => {
    return abortSignals.get(abortId) // true если отменено
  }
}

await processBatch(numbers, 'payment', log, onProgress, options)
```

## Алгоритм работы

1. **Параллельная обработка** — пакеты по `BATCH_CONCURRENCY=3` одновременно
2. **Задержка между пакетами** — `CHUNK_DELAY_MS=200ms`
3. **Проверка отмены** — перед каждым заказом проверяется `options.onAbort()`
4. **SSE callback** — после каждого заказа вызывается `onProgress()`
5. **Статистика** — подсчет created, skipped, errors

## Константы

| Константа | Значение | Описание |
|-----------|----------|----------|
| `BATCH_CONCURRENCY` | 3 | Максимум параллельных запросов |
| `CHUNK_DELAY_MS` | 200 | Задержка между пакетами (мс) |
