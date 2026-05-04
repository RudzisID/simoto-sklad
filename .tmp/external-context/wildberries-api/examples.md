---
source: Official Wildberries Documentation + Web Search
library: Wildberries Seller API
package: wildberries-api
topic: examples
fetched: 2026-05-04T12:00:00Z
official_docs: https://dev.wildberries.ru
---

# Wildberries Seller API - Примеры использования

## 1. Получение информации о продавце

```bash
curl -X GET "https://common-api.wildberries.ru/api/v1/seller-info" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json"
```

**Ответ**:
```json
{
  "name": "Название магазина",
  "tin": "1234567890",
  "rating": 4.5,
  ...
}
```

## 2. Проверка соединения (Ping)

```bash
curl -X GET "https://content-api.wildberries.ru/ping" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

**Ответ при успехе**:
```json
{
  "status": "ok",
  "timestamp": "2026-05-04T12:00:00Z"
}
```

## 3. Получение списка карточек товаров

```bash
curl -X POST "https://content-api.wildberries.ru/content/v2/get/cards/list" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "cursor": {
        "limit": 100
      }
    }
  }'
```

## 4. Создание карточки товара

```bash
curl -X POST "https://content-api.wildberries.ru/content/v2/cards/upload" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cards": [
      {
        "userId": 12345,
        "vendorCode": "TEST-001",
        "subjectId": 123,
        "brandId": 456,
        "title": "Тестовый товар",
        "description": "Описание товара",
        "sizes": [
          {
            "techSize": "S",
            "wbSize": "S",
            "price": 1000,
            "skus": ["123456789012"]
          }
        ]
      }
    ]
  }'
```

## 5. Получение остатков товаров

```bash
curl -X GET "https://content-api.wildberries.ru/api/v2/list/goods/filter" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json"
```

## 6. Работа с заказами FBS (через sandbox)

```bash
# Создание тестового заказа (только в sandbox)
curl -X POST "https://marketplace-api-sandbox.wildberries.ru/api/v3/test/fbs/orders/make" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "barcode": "123456789012",
    "quantity": 1
  }'
```

## 7. Получение списка вопросов

```bash
curl -X GET "https://feedbacks-api.wildberries.ru/api/v1/questions?limit=50&sort=created&order=desc" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json"
```

## 8. Ответ на отзыв

```bash
curl -X POST "https://feedbacks-api.wildberries.ru/api/v1/feedbacks/answer" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "feedback_id_here",
    "answer": "Спасибо за ваш отзыв!"
  }'
```

## 9. Получение новостей продавца

```bash
curl -X GET "https://common-api.wildberries.ru/api/communications/v2/news?from=2026-05-01&limit=10" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

## 10. Пример на Python (с использованием requests)

```python
import requests
import time

API_TOKEN = "YOUR_API_TOKEN"
BASE_URL = "https://content-api.wildberries.ru"

headers = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json"
}

# Получение списка карточек с пагинацией
def get_cards(limit=100):
    url = f"{BASE_URL}/content/v2/get/cards/list"
    payload = {
        "settings": {
            "cursor": {
                "limit": limit
            }
        }
    }
    
    response = requests.post(url, json=payload, headers=headers)
    
    if response.status_code == 200:
        return response.json()
    elif response.status_code == 429:
        # Обработка превышения лимита
        retry_after = response.headers.get('X-Ratelimit-Retry', 2)
        print(f"Лимит превышен. Ждем {retry_after} секунд...")
        time.sleep(int(retry_after))
        return get_cards(limit)  # Повторный запрос
    else:
        print(f"Ошибка: {response.status_code}")
        print(response.text)
        return None

# Использование
cards_data = get_cards(limit=50)
if cards_data:
    print(f"Получено карточек: {len(cards_data.get('cards', []))}")
```

## 11. Пример на JavaScript (Node.js с fetch)

```javascript
const API_TOKEN = 'YOUR_API_TOKEN';
const BASE_URL = 'https://common-api.wildberries.ru';

async function getSellerInfo() {
    const response = await fetch(`${BASE_URL}/api/v1/seller-info`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });

    if (response.status === 429) {
        const retryAfter = response.headers.get('X-Ratelimit-Retry');
        console.log(`Лимит превышен. Повтор через ${retryAfter} сек.`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return getSellerInfo(); // Повторный запрос
    }

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
}

// Использование
getSellerInfo()
    .then(data => console.log('Информация о продавце:', data))
    .catch(error => console.error('Ошибка:', error));
```

## 12. Пример использования WBD API (Wildberries Digital)

```bash
curl -X GET "https://devapi-digital.wildberries.ru/api/v1/offers/author?limit=50" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

## Полезные советы
1. **Храните токен в переменных окружения**, не хардкодьте в коде
2. **Используйте библиотеки для работы с API** (например, `Dakword/WBSeller` для PHP)
3. **Обрабатывайте ошибки 429** (превышение лимита) с помощью retry логики
4. **Используйте sandbox** для тестирования интеграции
5. **Проверяйте заголовки X-Ratelimit-Remaining** перед отправкой запросов
6. **Используйте Postman** для тестирования (готовые коллекции доступны в документации)

## Готовые решения и библиотеки
- **PHP**: [Dakword/WBSeller](https://github.com/Dakword/WBSeller) — обертка для WB API
- **Postman коллекции**: доступны в [дигестах обновлений](https://dev.wildberries.ru/en/news/302)
- **1C интеграция**: кейс интеграции доступен в базе знаний

## Ссылки на документацию с примерами
- [Официальная документация](https://dev.wildberries.ru) — включает примеры запросов и ответов
- [LLMs.txt](https://context7.com/websites/dev_wildberries_ru_openapi_api-information/llms.txt) — текстовый формат документации
- [База знаний](https://dev.wildberries.ru/en/news/301) — статьи с примерами для разных ролей
