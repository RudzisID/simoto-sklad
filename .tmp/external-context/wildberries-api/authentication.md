---
source: Official Wildberries Documentation + Web Search
library: Wildberries Seller API
package: wildberries-api
topic: authentication
fetched: 2026-05-04T12:00:00Z
official_docs: https://dev.wildberries.ru/en/docs/openapi/api-information
---

# Wildberries Seller API - Аутентификация

## Типы токенов
Wildberries использует систему токенов для контроля доступа к данным. Доступны четыре типа токенов:

### 1. Personal Access Token (Персональный токен)
- Предоставляет доступ к данным продавца
- Может быть ограничен конкретными категориями данных
- Подходит для: собственной интеграции, доверенных сервисов
- **Срок действия**: 180 дней (после истечения нужно перевыпустить)

### 2. Service Token (Сервисный токен)
- Предоставляет доступ к ограниченному набору данных продавца
- Используется когда персональный токен не подходит
- Подходит для: тестирования интеграции, разработки

### 3. Test Token (Тестовый токен)
- Для тестирования и отладки интеграций

### 4. OAuth 2.0 (для SaaS партнеров)
- Используется сервисами-партнерами
- Требует client_id и client_secret

## Формат токена и заголовок авторизации

### Для основного Seller API:
```
Authorization: HeaderApiKey <api_token>
```
или
```
Authorization: Bearer <api_token>
```

**Пример**:
```http
GET /api/v1/seller-info HTTP/1.1
Host: common-api.wildberries.ru
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Для Wildberries Digital (WBD) API:
Используется JWT токен:
```
Authorization: Bearer <jwt_token>
```
- Срок жизни JWT токена: 365 дней
- Получение: через сайт WBD (кнопка "Get token")

## Как получить токен в личном кабинете продавца

### Пошаговая инструкция:
1. Войти в личный кабинет продавца на WB Partners
2. Перейти в раздел **Настройки** → **Доступ к API** (или Настройки пользователя → Доступ к API)
3. Нажать кнопку **Создать новый токен**
4. Ввести имя токена (например, "API Integration")
5. Выбрать категории данных (методы API), к которым токен будет иметь доступ:
   - Контент
   - Маркетплейс
   - Статистика
   - Аналитика
   - Цены и скидки
   - Вопросы и отзывы
   - Чат с покупателем
   - Поставки
   - Возвраты
   - Документы
   - Тарифы
   - Продвижение
6. При необходимости отметить галочку **"Только на чтение"** (read-only)
7. Нажать **Создать токен**
8. Скопировать сгенерированный токен (он отображается только один раз!)

### Важные примечания:
- Токен — это аналог пароля, храните его в безопасности
- Не передавайте токен третьим лицам без необходимости
- Используйте только доверенные сервисы
- При обнаружении подозрительной активности — удалите и замените токен
- Создавать и удалять токены может только владелец личного кабинета
- При смене владельца все токены перестают работать, нужно создавать заново

## Безопасность
- Не передавайте токен в URL параметрах
- Не публикуйте токен в открытом доступе
- Используйте HTTPS для всех запросов
- Регулярно обновляйте токены (раз в 180 дней для персональных)

## Проверка токена (Ping методы)
Для проверки работоспособности токена используйте методы ping:

| Категория | URL для проверки |
|-----------|------------------|
| Content | `https://content-api.wildberries.ru/ping` |
| Analytics | `https://seller-analytics-api.wildberries.ru/ping` |
| Prices and Discounts | `https://discounts-prices-api.wildberries.ru/ping` |
| Marketplace | `https://marketplace-api.wildberries.ru/ping` |
| Statistics | `https://statistics-api.wildberries.ru/ping` |
| Advertising | `https://advert-api.wildberries.ru/ping` |
| Feedbacks and Questions | `https://feedbacks-api.wildberries.ru/ping` |
| Buyers Chat | `https://buyer-chat-api.wildberries.ru/ping` |
| Returns | `https://returns-api.wildberries.ru/ping` |
| Documents | `https://documents-api.wildberries.ru/ping` |
| Finance | `https://finance-api.wildberries.ru/ping` |
| Tariffs, News, Seller Info | `https://common-api.wildberries.ru/ping` |
| User Management | `https://user-management-api.wildberries.ru/ping` |

**Лимит**: максимум 3 запроса каждые 30 секунд. При программном использовании метод будет временно заблокирован.
