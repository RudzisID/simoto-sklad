---
source: Web Search + Official Documentation
library: MoySklad JSON API
package: moysklad-api
topic: sticker-label-printing
fetched: 2026-04-28T12:00:00Z
official_docs: https://dev.moysklad.ru/doc/api/remap/1.2/
---

# Печать стикеров/этикеток через API МойСклад

## Общая информация

Для печати стикеров (этикеток) товаров в МойСклад используется механизм экспорта с шаблонами печатных форм.

**Базовый URL API:** `https://api.moysklad.ru/api/remap/1.2`

**Аутентификация:**
- Basic Auth: `login:password`
- Token Auth: Заголовок `Authorization: Bearer {token}`

## Эндпоинт для печати стикеров товаров

### Шаг 1: Получение списка доступных шаблонов этикеток

Для товаров шаблоны этикеток находятся в метаданных сущности `product`:

```bash
GET https://api.moysklad.ru/api/remap/1.2/entity/product/metadata
```

Заголовки:
```
Authorization: Bearer a0f694d5d0267d8411a767fd9f8d6317fdf9ed71
Accept: application/json
```

В ответе будут поля:
- `customTemplates` - пользовательские шаблоны
- `embeddedTemplates` - встроенные шаблоны

### Шаг 2: Создание задачи на печать (экспорт)

**Эндпоинт:** `POST https://api.moysklad.ru/api/remap/1.2/entity/product/{product-id}/export`

**Тело запроса:**
```json
{
  "template": {
    "meta": {
      "href": "https://api.moysklad.ru/api/remap/1.2/entity/product/metadata/customtemplate/{template-id}",
      "type": "customtemplate",
      "mediaType": "application/json"
    }
  },
  "extension": "pdf"
}
```

**Заголовки:**
```
Authorization: Bearer a0f694d5d0267d8411a767fd9f8d6317fdf9ed71
Content-Type: application/json
```

**Ответ:** HTTP 303 Redirect
- Заголовок `Location` содержит URL для скачивания PDF

### Шаг 3: Скачивание PDF файла

Полученный URL (обычно вида `https://print-prod.moysklad.ru/temp/.../filename.pdf`) используется для скачивания готового PDF файла.

```bash
GET {location-url}
```

## Информация о шаблоне "Октябрьский 7 (58x40mm)"

### Важное примечание
Конкретный ID шаблона "Октябрьский 7 (58x40mm)" не может быть определен без запроса к API конкретного аккаунта, так как пользовательские шаблоны создаются индивидуально.

### Как найти ID шаблона "Октябрьский 7"

1. **Через API (рекомендуемый способ):**
```bash
curl -X GET \
  "https://api.moysklad.ru/api/remap/1.2/entity/product/metadata" \
  -H "Authorization: Bearer a0f694d5d0267d8411a767fd9f8d6317fdf9ed71" \
  -H "Accept: application/json"
```

В ответе найдите в `customTemplates` шаблон с именем, содержащим "Октябрьский" или "58x40".

2. **Через веб-интерфейс МойСклад:**
   - Перейти в Товары → Список товаров
   - Выбрать товар, нажать Печать → Настроить
   - В открывшемся окне найти нужный шаблон, его ID будет в URL или через инструменты разработчика (Network)

### Пример структуры шаблона в метаданных

```json
{
  "customTemplates": [
    {
      "meta": {
        "href": "https://api.moysklad.ru/api/remap/1.2/entity/product/metadata/customtemplate/8a686b8a-9e4a-11e5-7a69-97110004af3e",
        "type": "customtemplate",
        "mediaType": "application/json"
      },
      "id": "8a686b8a-9e4a-11e5-7a69-97110004af3e",
      "name": "Октябрьский 7 (58x40mm)",
      "type": "custom",
      "content": "..."
    }
  ]
}
```

## Полный пример запроса (JavaScript)

```javascript
const token = 'a0f694d5d0267d8411a767fd9f8d6317fdf9ed71';
const productId = 'PUT_PRODUCT_ID_HERE';
const templateId = 'PUT_TEMPLATE_ID_HERE'; // ID шаблона "Октябрьский 7"

async function printSticker() {
  // 1. Создаем задачу на печать
  const exportResponse = await fetch(
    `https://api.moysklad.ru/api/remap/1.2/entity/product/${productId}/export`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        template: {
          meta: {
            href: `https://api.moysklad.ru/api/remap/1.2/entity/product/metadata/customtemplate/${templateId}`,
            type: 'customtemplate',
            mediaType: 'application/json'
          }
        },
        extension: 'pdf'
      }),
      redirect: 'manual' // Важно: не следовать за редиректом автоматически
    }
  );

  // 2. Получаем URL для скачивания
  const pdfUrl = exportResponse.headers.get('location');
  console.log('PDF URL:', pdfUrl);

  // 3. Скачиваем PDF
  const pdfResponse = await fetch(pdfUrl);
  const pdfBlob = await pdfResponse.blob();
  
  // Сохранение файла...
  return pdfBlob;
}
```

## Печать стикеров для нескольких товаров

Для массовой печати стикеров нескольких товаров используйте тот же эндпоинт, но с массивом товаров (если API поддерживает) или делайте последовательные запросы.

### Альтернативный способ - через документы

Иногда стикеры печатаются через документы (например, заказы). В этом случае используется эндпоинт документа:

```bash
POST https://api.moysklad.ru/api/remap/1.2/entity/{document-type}/{document-id}/export
```

## Полезные ссылки

- Официальная документация API: https://dev.moysklad.ru/doc/api/remap/1.2/
- Публикация документов: https://dev.moysklad.ru/workbook/api/remap/1.1/ru/publication.html
- Пример на GitHub: https://github.com/wmakeev/moysklad/blob/master/examples/download-print-form.js

## Ограничения

- Лимит: не более 100 запросов за 5 секунд
- Не более 5 параллельных запросов от одного пользователя
- Размер этикетки 58x40 мм соответствует стандарту для маркетплейсов (Wildberries, Ozon)
