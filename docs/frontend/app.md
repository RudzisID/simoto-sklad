# Frontend: Логика веб-интерфейса

**Файл**: `public/app.js`

Vanilla JavaScript логика для веб-интерфейса SiMOTO-sklad. Тёмная тема, SSE стриминг, управление состоянием заказов.

## Основные возможности

- **Проверка заказов** — одиночная и массовая (SSE streaming)
- **Создание документов** — платежи, отгрузки, возвраты, отмена
- **Управление состоянием** — сохранение/загрузка состояния заказов
- **Realtime обновления** — SSE для отображения прогресса
- **Тёмная тема** — переключение темы с сохранением в localStorage
- **Печать этикеток** — поиск товара и генерация PDF

## Глобальные переменные

| Переменная | Описание |
|------------|----------|
| `ordersData` | Массив данных о заказах |
| `ordersState` | Состояние заказов (из `/api/orders-state`) |
| `currentPage` | Текущая страница (пагинация) |
| `PAGE_SIZE` | Размер страницы (1000) |
| `currentSort` | Текущая сортировка |
| `isWorking` | Флаг выполнения операции |
| `realtimeMode` | Флаг добавления строк без перерисовки |

## Основные функции

### Работа с заказами

| Функция | Описание |
|---------|----------|
| `parseNumbers()` | Парсинг номеров из текстового поля |
| `loadSavedOrders()` | Загрузка сохраненных заказов |
| `saveScanState()` | Сохранение текущего сканирования |
| `isOrderProcessed(shipmentNum)` | Проверка, обработан ли заказ |

### API запросы

| Функция | Описание |
|---------|----------|
| `processCheck(numbers, onProgress)` | Проверка заказов (с SSE) |
| `processBatch(numbers, action, onProgress)` | Массовая операция (с SSE) |
| `createPayment(shipmentNum)` | Создание платежа |
| `createDemand(shipmentNum)` | Создание отгрузки |
| `createReturn(shipmentNum)` | Создание возврата |
| `cancelOrder(shipmentNum)` | Отмена заказа |
| `printSticker(code)` | Печать этикетки товара |

### UI функции

| Функция | Описание |
|---------|----------|
| `showStatus(message, type)` | Показ сообщения статуса |
| `showConfirm(message, title)` | Кастомный диалог подтверждения |
| `renderTable()` | Отрисовка таблицы заказов |
| `updateStats()` | Обновление статистики |
| `startOperationTimer()` | Запуск секундомера операции |
| `stopOperationTimer()` | Остановка секундомера |

### SSE (Server-Sent Events)

| Функция | Описание |
|---------|----------|
| `connectSSE(url, onProgress, onDone, onAbort)` | Подключение к SSE потоку |
| `abortOperation()` | Отмена текущей операции |

## Примеры использования

### Проверка заказа с SSE

```javascript
const token = document.getElementById('tokenInput').value
const numbers = parseNumbers()

await processCheck(numbers, (data) => {
  // Вызывается для каждого проверенного заказа
  console.log(`Проверен: ${data.order.shipmentNum}`)
  updateRow(data.order)
})
```

### Создание платежа

```javascript
const token = loadToken()
const shipmentNum = '0128545550-0011-1'

const result = await createPayment(shipmentNum)
if (result.success) {
  showStatus(`Платеж создан: ${result.paymentName}`)
} else {
  showStatus(`Ошибка: ${result.error}`, 'error')
}
```

### Печать этикетки

```javascript
const code = document.getElementById('stickerCode').value
const result = await printSticker(code)

if (result.pdfUrl) {
  // Открываем PDF в новом окне
  window.open(result.pdfUrl, '_blank')
} else if (result.file) {
  // Файл отправлен напрямую
  showStatus('Этикетка отправлена на печать')
}
```

## Управление темой

```javascript
// Переключение темы
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const newTheme = isDark ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', newTheme)
  localStorage.setItem('theme', newTheme)
}
```

## События и обработчики

- `DOMContentLoaded` — инициализация при загрузке страницы
- `click` на кнопках — обработка действий пользователя
- `progress` от SSE — обновление прогресса в реальном времени

## Хранение данных

| Ключ localStorage | Описание |
|-------------------|----------|
| `moyskladToken` | Токен API МойСклад |
| `theme` | Текущая тема (dark/light) |

## Интеграция с сервером

Фронтенд взаимодействует со следующими эндпойнтами:
- `POST /api/process` — проверка заказов
- `GET /api/process/stream` — SSE проверка
- `POST /api/batch` — массовая операция
- `GET /api/batch/stream` — SSE массовая операция
- `POST /api/create-payment` — создание платежа
- `POST /api/create-demand` — создание отгрузки
- `POST /api/create-return` — создание возврата
- `POST /api/cancel-order` — отмена заказа
- `POST /api/print-sticker` — печать этикетки
- `GET/POST/DELETE /api/orders-state` — состояние заказов
