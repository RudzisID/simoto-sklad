# V2 Execution Checklist

**Версия:** 1.0
**Дата:** 2026-04-27
**Статус:** ВСЕ ШАГИ ЗАВЕРШЕНЫ ✅ (V2 готов к коммиту)

---

## Порядок выполнения

Выполнять строго по порядку. После каждого пункта — проверка и отметка `[x]`.

### Шаг 1: V2.1 Тесты
**Агент:** `TestEngineer`
**task_id:** `ses_v2_tests`

```
Напиши тесты для lib/payment.js

Требования:
- Используй jest с jest-mock
- Моки для moysklad API (не обращаться к реальному API)
- Файл: test/mocks/payment_data.json (примеры ответов API)
- Положительные кейсы: создание платежа, успех
- Отрицательные кейсы: уже оплачен, ошибка API, неверные данные
- Обязательно: skip если уже оплачен (payedSum >= sum)

В конце: npm test должен проходить
```

- [x] test/payment.test.js — Тесты для payment.js
- [x] test/mocks/ — Папка с моками API ответов
- [x] test/demand.test.js — Тесты для demand.js
- [x] test/return.test.js — Тесты для return.js
- [x] test/cancel.test.js — Тесты для cancel.js
- [x] test/batch.test.js — Тесты для batch.js
- [x] `npm test` — Все тесты проходят ✅ (38 тестов, 5 наборов)

---

### Шаг 2: V2.2 ESLint + Prettier
**Агент:** `OpenDevopsSpecialist`
**depends_on:** Шаг 1 завершён

```
Настрой ESLint + Prettier

Требования:
- Установить: eslint, prettier
- Конфиг .eslintrc.js: простой, без лишних правил
- Конфиг .prettierrc: 2 spaces, single quotes, LF endings
- .gitattributes: * text=auto (LF для всех текстовых)
- precommit hook: prettier --write && eslint --fix
- Прогнать по всему коду (src/, lib/, test/)

В конце: npm run lint проходит, код отформатирован
```

- [x] `npm install --save-dev eslint prettier`
- [x] `eslint.config.js` создан (ESLint v10+)
- [x] `.prettierrc` создан
- [x] `.gitattributes` создан
- [x] precommit hook настроен (в package.json)
- [x] `npm run lint:fix` выполнен
- [x] `npm run format` выполнен

---

### Шаг 3: V2.3 JSDoc типы
**Агент:** `DocWriter`
**depends_on:** Шаг 2 завершён

```
Добавь JSDoc типы

Файлы:
- lib/types.js (создать) — typedef для всех сущностей
- lib/payment.js — JSDoc для функций
- lib/order.js — JSDoc для функций
- lib/batch.js — JSDoc для функций

Типы:
- @typedef {Object} Order — заказ
- @typedef {Object} Demand — отгрузка
- @typedef {Object} Payment — платёж
- @typedef {Object} APIResponse — ответ API
```

- [x] lib/types.js создан
- [x] JSDoc добавлен в lib/payment.js
- [x] JSDoc добавлен в lib/order.js
- [x] JSDoc добавлен в lib/batch.js

---

### Шаг 4: Финальная проверка
**Агент:** `CodeReviewer`
**depends_on:** Шаг 1, 2, 3 завершены

```
Проверь V2 перед коммитом

1. Все тесты проходят: npm test
2. ESLint чисто: npm run lint
3. Код отформатирован: npm run format
4. Review: lib/payment.js, lib/demand.js критичны

Ожидаемый результат: ✅ Всё чисто
```

- [x] `npm test` — ✅ (38 тестов, 5 наборов)
- [x] `npm run lint` — ✅ (0 errors, только warnings)
- [x] CodeReviewer одобрил (исправления внесены: JSDoc для demand.js, try/catch в payment.js и demand.js)
- [x] Коммит: "feat(V2): tests, lint, jsdoc" (готов к созданию)

---

## Продолжение сессий

### Как продолжить (новый день):
```
task(task_id="ses_v2_tests")  // продолжить тесты
// или
@TestEngineer продолжи тесты из сессии ses_v2_tests
```

### Статус трекинга:
```
✓ =.done     — выполнено
✗ = pending — в процессе
− = blocked  — заблокировано (зависимость)
```

| Шаг | Агент | task_id | Статус |
|-----|-------|---------|--------|
| 1. Тесты | TestEngineer | ses_v2_tests | ✓ (завершён) |
| 2. ESLint | OpenDevopsSpecialist | — | ✓ (завершён) |
| 3. JSDoc | DocWriter | — | ✓ (завершён) |
| 4. Review | CodeReviewer | — | ✓ (завершён) |

---

## Переиспользование

Этот чеклист можно переиспользовать для V3/V4:
- Скопировать файл
- Переименовать в v3-execution.md
- Обновить шаги

```
cp .opencode/context/plans/v2-execution.md .opencode/context/plans/v3-execution.md
```