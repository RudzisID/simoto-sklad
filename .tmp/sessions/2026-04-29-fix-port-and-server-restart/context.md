# Task Context: Fix port 3002→3000 and server restart issue

Session ID: 2026-04-29-fix-port-and-server-restart
Created: 2026-04-29T15:50:00+07:00
Status: in_progress

## Current Request
1. Исправить порт с 3002 на 3000 во всех файлах (было изменено вручную частично)
2. Исправить проблему EADDRINUSE - сервер не перезапускается, порт остается занятым
3. Проблема проявилась после добавления печати стикеров (но корень проблемы - SSE соединения)

## Context Files (Standards to Follow)
- Code quality standards (to be loaded)

## Reference Files (Source Material to Look At)
- server.js - основной файл сервера
- simoto-sklad.bat - батник запуска
- README.md - документация
- PLAN.md - план проекта
- docs/API.md - документация API

## External Docs Fetched
- None

## Components
1. server.js - порт 3002→3000, SSE tracking, graceful shutdown fix
2. simoto-sklad.bat - порт 3002→3000
3. Документация - проверить актуальность порта

## Constraints
- Порт должен быть 3000 (согласно документации)
- Нужно исправить SSE соединения, которые не закрываются при остановке
- Обработать ошибку EADDRINUSE

## Exit Criteria
- [x] Порт изменен на 3000 в server.js и simoto-sklad.bat
- [x] SSE соединения корректно закрываются при остановке сервера (sseConnections Set)
- [x] Добавлен обработчик ошибки EADDRINUSE с подсказками
- [x] Исправлена логика /api/restart - использует gracefulShutdown с shouldRestart=true
- [x] В gracefulShutdown добавлено закрытие SSE соединений перед остановкой сервера
- [ ] Сервер корректно перезапускается без ошибки EADDRINUSE (требуется тестирование)

## Summary of Changes
1. **server.js**:
   - Порт изменен на 3000 (было 3002)
   - Добавлен `sseConnections` Set для отслеживания SSE соединений
   - В `/api/process/stream` и `/api/batch/stream` добавлено добавление/удаление соединений
   - `gracefulShutdown(signal, shouldRestart)` - закрывает SSE соединения, опционально запускает новый экземпляр
   - `/api/restart` - вызывает `gracefulShutdown('RESTART', true)`
   - Добавлен обработчик `server.on('error')` для EADDRINUSE

2. **simoto-sklad.bat**:
   - Порт изменен на 3000 (было 3002)
