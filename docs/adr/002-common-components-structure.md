# 002. Структура общих компонентов

**Status**: proposed

**Date**: 2026-05-04

**Context**: frontend (планируется) | **Module**: public/components/

**Related Tasks**: V3 — Новые фичи (PLAN.md)

**Related ADRs**: 001 (Реализация навигации вкладок)

---

## Context

При переходе к многовкладочному интерфейсу необходимо выделить общие компоненты, которые будут переиспользоваться across вкладок. Текущий `app.js` содержит смешанный код UI и бизнес-логики (2000+ строк).

Компоненты, которые нуждаются в переиспользовании:
- **Заголовок (Header)** — логотип, название, переключатель темы
- **Панель вкладок (Tab Bar)** — навигация между разделами
- **Компонент ввода токенов (Token Input)** — поле ввода с валидацией и сохранением
- **Панель статуса (Status Panel)** — отображение сообщений пользователю
- **Счетчики состояния (Stats Panel)** — статистика заказов/товаров

## Decision

Принято решение выделить общие компоненты в отдельные Vanilla JS модули с следующими принципами:

1. **Компоненты как ES модули**: каждый компонент экспортирует функцию `render(container)` и `update(data)`
2. **Паттерн композиции**: вкладки собираются из общих компонентов
3. **Общий стейт**: токены и настройки хранятся в централизованном хранилище `AppState`
4. **CSS переиспользование**: общие стили через CSS custom properties (уже есть dark theme)

### Структура компонентов:
```
public/components/
├── header.js          # Заголовок приложения
├── tab-bar.js         # Панель навигации вкладок
├── token-input.js     # Поле ввода токена с валидацией
├── status-panel.js    # Панель уведомлений
├── stats-panel.js     # Счетчики и статистика
└── base-component.js  # Базовый класс (опционально)
```

## Alternatives Considered

### Option 1: Web Components (Custom Elements)
- **Pros**: Нативная изоляция, переиспользование, стандартный API
- **Cons**: Сложнее интеграция с существующим Vanilla JS кодом, поддержка IE отсутствует (не критично)
- **Why rejected**: Избыточно для внутреннего инструмента, требует переписывания существующих компонентов

### Option 2: Копирование кода (Copy-paste)
- **Pros**: Быстро, нет необходимости рефакторинга
- **Cons**: Дублирование кода, сложность поддержки, несогласованность
- **Why rejected**: Нарушает принцип DRY, усложнит поддержку при расширении

### Option 3: Vanilla JS модули с композицией (Выбрано)
- **Pros**: Минимальные изменения, переиспользование без overhead, простота
- **Cons**: Нет строгой изоляции (как у Web Components)
- **Why chosen**: Баланс между переиспользованием и простотой внедрения

## Consequences

### Positive
- Упрощение поддержки за счет устранения дублирования
- Единый внешний вид (заголовок, панель вкладок) across всех вкладок
- Общий компонент ввода токенов с валидацией и сохранением в localStorage
- Возможность независимого тестирования компонентов

### Negative
- Необходимость рефакторинга существующего `app.js`
- Усложнение структуры фронтенда (больше файлов)
- Нет строгой инкапсуляции (как у фреймворков)

## Implementation Notes

### Пример компонента token-input.js:
```javascript
// components/token-input.js
export function createTokenInput({ 
  id = 'tokenInput', 
  placeholder = 'Введите токен...',
  storageKey = 'apiToken' 
}) {
  const container = document.createElement('div');
  container.className = 'token-input-wrapper';
  
  const input = document.createElement('input');
  input.type = 'password';
  input.id = id;
  input.placeholder = placeholder;
  input.value = localStorage.getItem(storageKey) || '';
  
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.textContent = '👁';
  toggleBtn.onclick = () => {
    input.type = input.type === 'password' ? 'text' : 'password';
  };
  
  container.appendChild(input);
  container.appendChild(toggleBtn);
  
  return { container, input };
}
```

### Использование в вкладках:
```javascript
// tabs/wb.js
import { createTokenInput } from '../components/token-input.js';

export function initTab(container) {
  const { container: tokenInput, input } = createTokenInput({
    storageKey: 'wbToken',
    placeholder: 'Токен Wildberries API...'
  });
  container.appendChild(tokenInput);
}
```

### Централизованное хранилище (AppState):
```javascript
// app-state.js
export const AppState = {
  tokens: {
    get moysklad() { return localStorage.getItem('moyskladToken'); },
    get wb() { return localStorage.getItem('wbToken'); },
    get ozon() { return localStorage.getItem('ozonToken'); }
  },
  
  setToken(service, token) {
    localStorage.setItem(`${service}Token`, token);
    window.dispatchEvent(new CustomEvent('token-changed', { detail: { service } }));
  }
};
```
