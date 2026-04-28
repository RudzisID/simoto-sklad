# Task Context: Fix Cancel, Return and Make Functions Self-Sufficient

Session ID: 2026-04-28-fix-cancel-return-self-sufficient
Created: 2026-04-28T21:10:00Z
Status: completed

## Current Request
Исправить критические ошибки в модулях `cancel.js`, `return.js`, `check.js` и обеспечить самодостаточность функций (`createDemand`, `createPayment`, `createReturn`, `cancelOrder`) с обновлением тестов.

## Context Files (Standards to Follow)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\constants.js — константы статусов и атрибутов
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\api-utils.js — утилиты API (getSalesChannelObj, getChannelAttrValue, getATTR_ORDER_CHANNEL, getATTR_DEMAND_CHANNEL)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\INSTRUCTION.md — инструкции по логике работы
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\ms-api-doc\ — документация API МойСклад

## Reference Files (Source Material to Look At)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\cancel.js — отмена заказов (КРИТИЧЕСКИЕ ОШИБКИ)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\return.js — возвраты (ошибка пути к статусу)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\check.js — проверка заказов (мёртвый код)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\demand.js — создание отгрузок
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\payment.js — создание платежей
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\order.js — функции получения данных
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\batch.js — массовая обработка
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\test\ — существующие тесты

## External Docs Fetched
- API МойСклад: Путь к статусу должен быть `metadata/states/`, а не `metadata/attributes/`
- Обязательные поля при обновлении: `salesChannel` (всегда) + `attributes` с `ORDER_CHANNEL`/`DEMAND_CHANNEL`
- Сброс резервов: POST с `reserve:0` (без удаления позиций)

## Components
1. **cancel.js** — исправление констант, добавление attributes + salesChannel
2. **return.js** — исправление констант, исправление пути к статусу отгрузки
3. **check.js** — удаление мёртвого кода (строки 109-129)
4. **Самодостаточность** — функции должны принимать orderId или orderFull, сами получать данные через getOrderFullForCreate()
5. **Тесты** — обновление существующих и создание новых тестов

## Constraints
- Функции должны оставаться совместимыми с batch.js (который передаёт orderFull)
- При передаче orderId функция сама вызывает getOrderFullForCreate()
- Всегда включать salesChannel и attributes в запросы обновления
- Проверка на demandId в cancel.js должна остаться (отмена невозможна при наличии отгрузки)

## Exit Criteria
- [ ] cancel.js исправлен: константы ORDER_STATUS.CANCELLED, DEMAND_STATUS.CANCELLED, добавлены attributes + salesChannel
- [ ] return.js исправлен: константы ORDER_STATUS.RETURN, DEMAND_STATUS.CANCELLED, путь metadata/states/
- [ ] check.js очищен от мёртвого кода
- [ ] Функции (createDemand, createPayment, createReturn, cancelOrder) принимают orderId или orderFull
- [ ] Тесты обновлены и проходят успешно
- [ ] batch.js и server.js работают корректно с новыми функциями
