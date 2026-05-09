# Changelog

## [Unreleased]

### Added
- **OpenAPI/Swagger спецификация**: Создан `docs/openapi.yaml` с полным описанием API
- **Централизованная обработка ошибок**: Добавлен error handler middleware в `server.js`

### Fixed
- **SSE disconnect handling**: Исправлена обработка отключения клиента (добавлен флаг `serverClosed`)
- **Сортировка таблицы**: Исправлена логика сортировки булевых колонок (true наверху при asc=true)
- **Отображение сумм в таблице**: Исправлено отображение сумм оплат и возвратов (вместо номеров документов)
- **Калькулятор**: Добавлено логирование для отладки `returnSum` в `lib/check.js`

### Changed
- **UI таблицы**: `renderTable()` и `appendOrderRow()` теперь используют `paymentDisplay` и `returnDisplay`
- **SSE логика**: В `lib/batch.js` добавлена функция очистки abort signals

### Technical Details
- `server.js`: Добавлен centralized error handler (4 параметра: err, req, res, next)
- `docs/openapi.yaml`: Полная спецификация OpenAPI 3.0.0 на основе `docs/API.md`
- `server.js`: Закомментированный код для подключения Swagger UI (требуется `npm install swagger-jsdoc swagger-ui-express`)

## [1.3.2] - 2026-05-04

### Fixed
- **Счетчики в блоке "Текущее состояние" больше не "замерзают"** при сканировании и массовых операциях
  - Добавлено принудительное обновление через `renderCurrentStats(true)` в SSE циклах
  - Удален лишний вызов `refreshSpecificOrders()` после массовых операций
  - Счетчики обновляются в реальном времени после каждого действия

- **Устранено повторное сканирование после батча**
  - Данные обновляются напрямую из `ordersData`, который актуализируется в SSE цикле
  - Исключена лишняя нагрузка на API МойСклад

- **Инкрементальное сохранение состояния**
  - `saveOrderAction()` вызывается при каждом изменении статуса заказа
  - Файл `logs/orders_state.json` обновляется без полной перезаписи

### Changed
- **Логика завершения массовой операции**
  - Вместо `refreshSpecificOrders()` теперь выполняется:
    ```javascript
    realtimeMode = false
    renderTable()
    updateTotals()
    renderCurrentStats()
    ```
  - Данные берутся из уже обновленного `ordersData`

### Technical Details
- `renderCurrentStats(force)` — с `force=true` обновляет счетчики даже в `realtimeMode`
- `updateTotals()` — обновляет общие суммы и количество заказов
- `saveOrderAction()` — POST запрос к `/api/orders-state` для инкрементального сохранения
- `realtimeMode` — флаг, блокирующий перерисовку таблицы при добавлении строк

## [1.0.9] - 2026-04-28

### Added
- SSE стриминг для сканирования и массовых операций
- Тёмная тема с переключением
- Печать этикеток товаров

### Fixed
- Исправлена ошибка отображения старых результатов после массовых операций
