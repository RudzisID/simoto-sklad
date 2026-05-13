/**
 * SiMOTO-Sklad — Генератор наклеек 58×40 мм
 * ============================================
 *
 * Автономный модуль для создания и печати наклеек со службой доставки и кодом заказа.
 * Не зависит от других модулей, использует чистые функции.
 *
 *
 * Функции
 * -------
 *
 *   buildStickerHtml({ carrier, code, size?, avito? })  →  string
 *     Генерирует HTML-страницу с CSS @page под размер наклейки.
 *     Длинный код автоматически переносится на вторую строку.
 *     Параметры:
 *       carrier (string) — название службы доставки (СДЭК, Почта, Яндекс, Авито…)
 *       code    (string) — код заказа (произвольная строка)
 *       size    (string) — размер в формате "ширинаxвысота" в мм, по умолч. "58x40"
 *       avito   (bool)   — добавить "Авито" вторым словом (игнорируется, если carrier = "Авито")
 *     Возвращает: полный HTML-документ.
 *     Пример:
 *       const html = buildStickerHtml({
 *         carrier: 'СДЭК',
 *         code: '10266080914',
 *         size: '58x40',
 *         avito: true
 *       })
 *       // → "<!DOCTYPE html><html>..."
 *       // Содержимое наклейки:
 *       //   ┌────────────────┐
 *       //   │   СДЭК Авито   │
 *       //   │  ────────────  │
 *       //   │ 10266080914    │
 *       //   └────────────────┘
 *
 *   openStickerPrint(carrier, code, size?, avito?)  →  void
 *     Генерирует наклейку и открывает её в новом окне браузера.
 *     Автоматическая печать НЕ запускается — пользователь нажимает Ctrl+P сам.
 *     Параметры — см. buildStickerHtml().
 *     Пример:
 *       openStickerPrint('Почта', '123456789', '58x40', false)
 *
 *   toggleStickerModal(show)  →  void
 *     Показывает/скрывает штатный попап параметров наклейки.
 *     Вызывается из onclick кнопки в шапке index.html.
 *
 *   generateSticker()  →  void
 *     Читает значения из DOM-полей попапа (stickerCarrier, stickerCode и т.д.),
 *     валидирует их и вызывает openStickerPrint().
 *     Используется как обработчик кнопки "Создать" внутри модального окна.
 *
 *
 * Пример вызова из других модулей
 * --------------------------------
 *   // Вариант 1 — открыть окно с наклейкой одной строкой
 *   openStickerPrint('СДЭК', '10266080914', '58x40', true)
 *
 *   // Вариант 2 — получить HTML и сделать с ним что-то своё
 *   const html = buildStickerHtml({
 *     carrier: 'Яндекс',
 *     code: 'ABC-123-456',
 *     size: '58x40',
 *     avito: false
 *   })
 *   // дальше можно отправить на print, сохранить в файл и т.д.
 *
 *   // Вариант 3 — открыть штатный попап (если нужно только UI)
 *   toggleStickerModal(true)
 */

// ─── buildStickerHtml ────────────────────────────────────────────────────────
// Чистая функция: по параметрам возвращает строку HTML.
// Ничего не читает из DOM, не вызывает alert/window.open.

function buildStickerHtml({ carrier, code, size, avito }) {
  size = size || '58x40';
  let line1 = carrier;
  if (avito && carrier !== 'Авито') {
    line1 += ' Авито';
  }
  const [w, h] = size.split('x');

  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <title>Наклейка ' + w + '\u00D7' + h + '</title>',
    '  <style>',
    '    @page { size: ' + w + 'mm ' + h + 'mm; margin: 0; }',
    '    * { margin: 0; padding: 0; box-sizing: border-box; }',
    '    body {',
    '      width: ' + w + 'mm; height: ' + h + 'mm;',
    '      display: flex; flex-direction: column;',
    '      justify-content: center; align-items: center;',
    '      font-family: Arial, Helvetica, sans-serif;',
    '      background: #fff; overflow: hidden;',
    '    }',
    '    .label {',
    '      text-align: center;',
    '      width: 100%;',
    '      padding: 0 3mm;',
    '    }',
    '    .carrier {',
    '      font-size: 14pt;',
    '      font-weight: bold;',
    '      margin-bottom: 2mm;',
    '      line-height: 1.2;',
    '      word-break: break-word;',
    '      color: #000;',
    '    }',
    '    .divider {',
    '      width: 75%;',
    '      height: 1px;',
    '      background: #000;',
    '      margin: 1mm auto;',
    '    }',
    '    .code {',
    '      font-size: 18pt;',
    '      font-weight: 900;',
    '      letter-spacing: 1px;',
    '      color: #000;',
    '      word-break: break-all;',
    '      overflow-wrap: break-word;',
    '    }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="label">',
    '    <div class="carrier">' + line1 + '</div>',
    '    <div class="divider"></div>',
    '    <div class="code">' + code + '</div>',
    '  </div>',
    '</body>',
    '</html>'
  ].join('\n');
}

// ─── openStickerPrint ────────────────────────────────────────────────────────
// Генерирует наклейку и открывает в новом окне (без автопечати).

function openStickerPrint(carrier, code, size, avito) {
  var html = buildStickerHtml({ carrier: carrier, code: code, size: size, avito: avito });
  var w = window.open('', '_blank', 'width=600,height=450');
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ─── toggleStickerModal ──────────────────────────────────────────────────────
// Показывает/скрывает попап параметров наклейки (по классу .hidden).

function toggleStickerModal(show) {
  var modal = document.getElementById('stickerModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
}

// ─── generateSticker ─────────────────────────────────────────────────────────
// Читает поля из DOM-попапа, валидирует, вызывает openStickerPrint.

function generateSticker() {
  var select = document.getElementById('stickerCarrier');
  var customInput = document.getElementById('stickerCarrierCustom');
  var avitoChecked = document.getElementById('stickerAvito').checked;
  var code = document.getElementById('stickerCode').value.trim();
  var size = document.getElementById('stickerSize').value;

  var carrier;
  if (select.value === '__other__') {
    carrier = customInput.value.trim();
  } else {
    carrier = select.value;
  }

  if (!carrier) {
    alert(
      '\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u043B\u0438 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u043B\u0443\u0436\u0431\u0443 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438!'
    );
    return;
  }
  if (!code) {
    alert(
      '\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u043A\u043E\u0434 \u0437\u0430\u043A\u0430\u0437\u0430!'
    );
    return;
  }

  toggleStickerModal(false);
  openStickerPrint(carrier, code, size, avitoChecked);
}
