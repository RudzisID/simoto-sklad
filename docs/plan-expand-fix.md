# План реализации: исправление expand возвратов

> Устраняет медленный глобальный кеш возвратов (7 проблем) путём замены `{ expand: '...' }` на `?expand=...` в URL запросов к API МойСклад.

## Changes Overview

При проверке заказов (SSE-сканировании) каждый раз выполнялось полное сканирование **всех 4182 возвратов** из API МойСклад в функцию `findSalesReturnsByDemand()`, чтобы найти возврат для конкретной отгрузки. Это занимало ~58 секунд, выполнялось многократно (до 3 раз в параллельных проверках) и сохраняло устаревший кеш на диск.

**Коренная причина**: библиотека `moysklad@0.21.1` некорректно обрабатывает `expand` через опции объекта (`{ expand: 'returns' }`), но expand через URL-строку (`?expand=returns`) работает корректно.

**Решение**: исправить expand во всех функциях на URL-строку, удалить глобальный кеш возвратов, упростить связанную логику.

**Исправляемые проблемы:**
1. expand через объект опций не работает (баг `moysklad@0.21.1`)
2. `findSalesReturnsByDemand()` строит глобальный кеш из 4182 возвратов (~58 сек)
3. Кеш сохраняется на диск (устаревает между сессиями)
4. Race condition при параллельных проверках — 3 запроса строят кеш одновременно
5. `findOrderByShipmentNum()` ищет `name` раньше `description` (неправильный приоритет)
6. Дублирование возвратов в `check.js` (`allReturns` без дедупликации)
7. Двойной вызов `loadOrdersState()` в `public/app.js` (`loadSavedOrdersAndRender`)

---

## File: `lib/order.js`

### 2.1 Исправить expand во всех функциях

Заменить форму `{ expand: '...' }` на `?expand=...` в URL:

**getDemand (сейчас ~line 154):**
```js
// БЫЛО:
return await API.GET('entity/demand/' + demandId, {
  expand: 'positions,salesChannel,returns'
})

// СТАЛО:
return await API.GET('entity/demand/' + demandId + '?expand=positions,salesChannel,returns')
```

**getOrderFull (сейчас ~line 119):**
```js
// БЫЛО:
return await API.GET('entity/customerorder/' + orderId, {
  expand: 'demands,positions.assortment,state,returns,payments'
})

// СТАЛО:
return await API.GET('entity/customerorder/' + orderId + '?expand=demands,positions.assortment,state,returns,payments')
```

**getOrderFullForCreate (сейчас ~line 136):**
```js
// БЫЛО:
return await API.GET('entity/customerorder/' + orderId, {
  expand: 'demands,positions.assortment,salesChannel,agent,organization,organizationAccount,state,returns,payments'
})

// СТАЛО:
return await API.GET('entity/customerorder/' + orderId + '?expand=demands,positions.assortment,salesChannel,agent,organization,organizationAccount,state,returns,payments')
```

**findSalesReturnsByOrder (сейчас ~line 317):**
```js
// БЫЛО:
const order = await API.GET('entity/customerorder/' + orderId, {
  expand: 'demands'
})

// СТАЛО:
const order = await API.GET('entity/customerorder/' + orderId + '?expand=demands')
```

### 2.2 Удалить кеш возвратов

**Удалить строки ~166-211**, содержащие:
- `returnsByDemandCache`
- `returnsCacheFullyLoaded`
- `loadReturnsCacheFromFile()`
- `saveReturnsCacheToFile()`
- `CACHE_DIR`, `CACHE_FILE`
- `require('fs')` и `require('path')` — **только если** они больше не используются в файле

**Упростить `findSalesReturnsByDemand()`** — убрать всю логику кеша, асинхронное ожидание, мутекс:

```js
async function findSalesReturnsByDemand(demandId) {
  try {
    const API = getApi()
    const demand = await API.GET('entity/demand/' + demandId + '?expand=returns')
    const returns = Array.isArray(demand.returns) ? demand.returns : (demand.returns?.rows || [])
    return { rows: returns }
  } catch (e) {
    console.error('Error finding sales returns by demand:', e.message)
    return { rows: [] }
  }
}
```

**Сделать `invalidateReturnsCache()` no-op:**

```js
function invalidateReturnsCache() {
  // Кеш больше не используется, функция оставлена для совместимости
}
```

### 2.3 Поменять порядок поиска в `findOrderByShipmentNum()`

Поменять местами блоки поиска:
1. Сначала `description~shipmentNum` (частичное совпадение — основной поиск)
2. Потом `name=shipmentNum` (точное совпадение — запасной вариант)
3. Вернуть `foundBy` соответственно

---

## File: `lib/check.js`

### 2.4 Упростить возвраты

**Удалить блок ~строки 91-104** — вызов `findSalesReturnsByDemand()` и вливание в `demand.returns`.

**После `const demand = await getDemand(demandId)` (сейчас ~line 89) добавить:**

```js
// Проверяем, что demand.returns существуют (expand должен их вернуть)
if (!demand.returns || !Array.isArray(demand.returns)) {
  demand.returns = []
} else if (!Array.isArray(demand.returns)) {
  demand.returns = demand.returns.rows || []
}
```

**Упростить сбор `allReturns` (сейчас ~line 204-207):**

```js
const allReturns = [
  ...(Array.isArray(demand?.returns) ? demand.returns : (demand?.returns?.rows || [])),
  ...(orderFull?.returns?.rows || [])
]
// Дедупликация по id
const seen = new Map()
allReturns.forEach(r => { if (!seen.has(r.id)) seen.set(r.id, r) })
const uniqueReturns = [...seen.values()]
```

> Использовать `uniqueReturns` для расчёта `returnSumKopeks` вместо `allReturns`.

**Удалить все вызовы `findSalesReturnsByDemand_v2`** (строки ~152-165, ~193-200) — они были запасными для случаев, когда expand не работал. С исправленным expand они не нужны.

### 2.5 Исправить `statusName` (опционально)

Строка ~52: заменить `statusName = 'Новый'` на `const statusName = 'Новый'`

---

## File: `lib/return.js`

### 2.6 Убрать `invalidateReturnsCache()`

1. Удалить `invalidateReturnsCache` из деструктуризации `require('./order')`:

```js
// БЫЛО:
const { ..., invalidateReturnsCache } = require('./order')

// СТАЛО:
const { ... } = require('./order')  // без invalidateReturnsCache
```

2. Удалить вызов `invalidateReturnsCache()` (сейчас ~line 92)

---

## File: `public/app.js`

### 2.7 Исправить двойной вызов `loadOrdersState()`

В функции `loadSavedOrdersAndRender()` (сейчас ~line 380-391):

```js
// БЫЛО:
function loadSavedOrdersAndRender() {
  currentPage = 0;
  loadOrdersState().then(() => {
    loadSavedOrders().then(function (orders) {
      // ...
    });
  });
}

// СТАЛО:
function loadSavedOrdersAndRender() {
  currentPage = 0;
  // loadSavedOrders() сам вызывает loadOrdersState() внутри
  loadSavedOrders().then(function (orders) {
    // ...
  });
}
```

---

## Tests

### `test/check.test.js`

Тесты мокают `findSalesReturnsByDemand` и `findSalesReturnsByDemand_v2`. С упрощением `check.js`:

- Мок `findSalesReturnsByDemand` больше не нужен в `check.test.js` (он вызывается только в `order.js`, если остался вызов)
- Мок `findSalesReturnsByDemand_v2` можно удалить (функция удалена из `check.js`)
- Проверить, какие моки реально используются после изменений

**Перед запуском тестов:** убедиться, что моки обновлены в соответствии с новой логикой.

---

## Verification Checklist

После реализации проверить:

1. **`npm test`** — тесты проходят
2. **Лог сервера** — нет сообщения `"Building returns cache from API..."`
3. **SSE-сканирование** заказа `4952104790` — возврат `04194` найден корректно
4. **Файл `cache/returns_cache.json`** — не создаётся (если существовал — можно удалить вручную)
5. **Лог загрузки** — нет трёхкратного `"Loaded orders state from file"` при загрузке страницы

---

## Важные замечания

- **Обратная совместимость**: все изменения обратно совместимы (формат ответов API не меняется)
- **Память**: после удаления глобального кеша может потребоваться перезапуск сервера для очистки памяти
- **`cache/returns_cache.json`**: можно удалить вручную после применения изменений
- **Библиотека `moysklad`**: остаётся на версии `^0.21.1` — мы просто обходим её баг через URL-строку
- **Если баг будет исправлен**: URL-строка всё равно будет работать, можно будет вернуться к стандартному синтаксису опций
