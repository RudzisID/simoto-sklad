---
source: Official Wildberries Documentation + Web Search
library: Wildberries Seller API
package: wildberries-api
topic: openapi-specs
fetched: 2026-05-04T12:00:00Z
official_docs: https://dev.wildberries.ru
---

# Wildberries Seller API - OpenAPI/Swagger спецификации

## Формат документации
Wildberries предоставляет документацию в формате **Swagger OpenAPI**, что позволяет:
- Импортировать спецификации в Postman
- Генерировать клиентский код на различных языках программирования с помощью Swagger CodeGen
- Использовать для автоматической генерации документации

## Ссылки на Swagger UI и спецификации

### Основные ссылки:
1. **Главная страница документации**: https://dev.wildberries.ru
2. **Swagger UI для WBD (Wildberries Digital)**: https://dev.wildberries.ru/swagger/wbd
3. **Документация OpenAPI (общая)**: https://dev.wildberries.ru/en/openapi/api-information
4. **Документация OpenAPI (товары)**: https://dev.wildberries.ru/en/openapi/work-with-products/
5. **Документация OpenAPI (коммуникация)**: https://dev.wildberries.ru/openapi/user-communication/

### Прямые ссылки на спецификации (предполагаемые):
Хотя прямые ссылки на `.json` или `.yaml` файлы не были найдены в открытом доступе, спецификации обычно доступны по шаблонам:
- `https://dev.wildberries.ru/swagger/{api-name}/swagger.json`
- `https://dev.wildberries.ru/openapi/{api-name}/spec.json`

**Проверенные ссылки**:
- Swagger WBD: https://dev.wildberries.ru/swagger/wbd (интерактивная документация)

## Доступные категории API в формате OpenAPI

Согласно документации, следующие категории имеют спецификации OpenAPI:

### 1. API Information (Общая информация)
- URL: https://dev.wildberries.ru/en/openapi/api-information
- Включает: начало работы, аутентификация, коды ошибок, лимиты, поддержка

### 2. Product Management (Товары / Content API)
- URL: https://dev.wildberries.ru/en/openapi/work-with-products/
- Включает: карточки товаров, справочники, цены, остатки

### 3. Marketplace (Маркетплейс - FBS, DBS, заказы)
- Включает: FBS заказы, DBS заказы, In-Store Pickup, FBW поставки

### 4. Customer Communication (Отзывы и вопросы)
- URL: https://dev.wildberries.ru/openapi/user-communication/
- Включает: вопросы, отзывы, чат с покупателями

### 5. Reports (Отчеты)
- URL: https://dev.wildberries.ru/en/openapi/reports/
- Включает: товары, холдбэки, расходы, хранение

### 6. Wildberries Digital (WBD)
- URL: https://dev.wildberries.ru/en/openapi/wbd
- Swagger UI: https://dev.wildberries.ru/swagger/wbd
- Включает: цифровой контент, офферы

### 7. Sandbox Environment (Песочница)
- URL: https://dev.wildberries.ru/en/openapi-other/sandbox-environment
- Включает: тестовые методы для FBS, DBS, In-Store Pickup

## Как импортировать в Postman

1. Откройте Postman
2. Нажмите **Import** → **Link**
3. Вставьте ссылку на Swagger JSON (например, `https://dev.wildberries.ru/swagger/wbd`)
4. Или скачайте JSON и импортируйте файл

## Генерация клиента (Swagger CodeGen)

Пример генерации клиента на Python:
```bash
# Установка swagger-codegen
brew install swagger-codegen  # для macOS
# или скачайте JAR файл

# Генерация Python клиента
swagger-codegen generate \
  -i https://dev.wildberries.ru/swagger/wbd \
  -l python \
  -o ./wb_api_client
```

Пример генерации клиента на JavaScript:
```bash
swagger-codegen generate \
  -i https://dev.wildberries.ru/swagger/wbd \
  -l javascript \
  -o ./wb_api_client_js
```

## Дополнительные ресурсы

### LLMs.txt (текстовый формат для LLM)
- https://context7.com/websites/dev_wildberries_ru_openapi_api-information/llms.txt
- Содержит структурированную информацию о API в текстовом формате

### База знаний WB API
- https://dev.wildberries.ru/en/news/301
- Включает 64 статьи по различным темам API

### Полезные ссылки из дайджестов:
- [WB API Digest March 2026](https://dev.wildberries.ru/en/news/302) — содержит готовую Postman коллекцию методов
- [Knowledge Base Launch](https://dev.wildberries.ru/en/news/301) — все гайды и кейсы

## Примечание
Если прямые ссылки на файлы спецификаций (.json/.yaml) недоступны публично, рекомендуется:
1. Использовать интерактивный Swagger UI на https://dev.wildberries.ru/swagger/wbd
2. Обратиться в техподдержку WB API для получения файлов спецификаций
3. Использовать готовые библиотеки-обертки (например, Dakword/WBSeller для PHP)

## Официальные репозитории и библиотеки
- **GitHub**: Поиск по "wildberries api" или "wb api" на GitHub
- **Dakword/WBSeller**: https://github.com/Dakword/WBSeller — PHP обертка с документацией по эндпоинтам
