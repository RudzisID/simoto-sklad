# Task Context: Динамическая сортировка и уменьшение высоты строк

Session ID: 2026-05-05-dynamic-sort-and-row-height
Created: 2026-05-05T19:20:00+03:00
Status: completed

## Changes Made
1. **Cyclic Status Sorting**: Replaced static `statusOrder` with `LIFECYCLE_STATUSES` (21 statuses) + `getLifecycleStatuses()` function
2. **Row Height**: Reduced `.positions-cell` and `.positions-row td` padding by ~25%, font-size reduced
3. **Print Button**: Reduced `.print-btn` size from 24px to 19px, font-size from 0.75rem to 0.6rem
4. **Tests**: Rewrote `test/sort-status.test.js` for cyclic sorting logic (13 tests pass)

## Exit Criteria
- [x] Статический statusOrder удален из app.js
- [x] Добавлен массив LIFECYCLE_STATUSES и функция getLifecycleStatuses()
- [x] sortTable() реализует циклическое переключение статусов
- [x] getSortedOrders() группирует по выбранному статусу
- [x] Высота строк товаров уменьшена на ~20%
- [x] Кнопка печати уменьшена пропорционально
- [x] Тесты обновлены и проходят успешно (13/13)
- [ ] Проверка работоспособности в браузере (рекомендуется)
