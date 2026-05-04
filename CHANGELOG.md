# Changelog

## [1.3.2] - 2026-05-04

### Added
- **V2 Complete**: Tests (38 tests, 5 suites), ESLint + Prettier, JSDoc types
- Graphify integration for code knowledge graph visualization
- WB/Ozon sync documentation (docs/integrations/wb_ozon_sync.md)

### Changed
- Code quality improvements (linting, formatting)
- Added JSDoc types to lib/payment.js, lib/order.js, lib/batch.js
- Created lib/types.js with typedefs for Order, Demand, Payment, APIResponse

### Technical Details
- V2 execution checklist completed (see docs/adr/v2-execution.md)
- ESLint v10+ config (eslint.config.js)
- Prettier config (.prettierrc)

## [Unreleased]

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
