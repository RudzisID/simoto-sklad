/**
 * @file sticker.js — Генератор наклеек 58×40 мм
 * ==============================================
 *
 * Автономный модуль для создания и печати наклеек со службой доставки и кодом заказа.
 * Не зависит от других модулей, использует чистые функции.
 * Размер по умолчанию — 58×40 мм, поддерживается кастомизация.
 *
 * @module StickerGenerator
 *
 * Примеры использования:
 *   const html = buildStickerHtml({ carrier: 'СДЭК', code: '10266080914' });
 *   openStickerPrint('Почта', '123456789', '58x40', false);
 *   toggleStickerModal(true);
 */

/**
 * Создаёт HTML-страницу наклейки с CSS @page под заданный размер.
 * Чистая функция: не читает DOM, не вызывает alert/window.open.
 * Длинный код заказа автоматически переносится на вторую строку.
 *
 * @param {Object} params - Параметры наклейки
 * @param {string} params.carrier - Название службы доставки (СДЭК, Почта, Яндекс, Авито…)
 * @param {string} params.code - Код заказа (произвольная строка)
 * @param {string} [params.size='58x40'] - Размер в формате "ширинаxвысота" в мм
 * @param {boolean} [params.avito=false] - Добавить "Авито" вторым словом (если carrier !== 'Авито')
 * @returns {string} Полный HTML-документ для печати наклейки
 */
function buildStickerHtml({ carrier, code, size, avito }) {
  size = size || '58x40'
  let line1 = carrier
  if (avito && carrier !== 'Авито') {
    line1 += ' Авито'
  }
  const [w, h] = size.split('x')

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
  ].join('\n')
}

/**
 * Генерирует наклейку и открывает её в новом окне браузера.
 * Автоматическая печать НЕ запускается — пользователь нажимает Ctrl+P самостоятельно.
 *
 * @param {string} carrier - Название службы доставки
 * @param {string} code - Код заказа
 * @param {string} [size] - Размер наклейки (по умолч. "58x40")
 * @param {boolean} [avito] - Флаг "Авито"
 * @returns {void}
 */
function openStickerPrint(carrier, code, size, avito) {
  var html = buildStickerHtml({ carrier: carrier, code: code, size: size, avito: avito })
  var w = window.open('', '_blank', 'width=600,height=450')
  w.document.open()
  w.document.write(html)
  w.document.close()
}

/**
 * Показывает или скрывает модальное окно параметров наклейки.
 * При открытии сбрасывает поля ввода (carrier, code, avito).
 * Вызывается из onclick кнопки "Печать стикеров" в шапке index.html.
 *
 * @param {boolean} show - true = показать, false = скрыть
 * @returns {void}
 */
function toggleStickerModal(show) {
  var modal = document.getElementById('stickerModal')
  if (!modal) return
  modal.classList.toggle('hidden', !show)
  if (show) {
    document.getElementById('stickerCarrier').value = ''
    document.getElementById('stickerCode').value = ''
    document.getElementById('stickerAvito').checked = false
  }
}

/**
 * Читает значения из DOM-полей модального окна наклейки (stickerCarrier,
 * stickerCode, stickerSize, stickerAvito), валидирует их и вызывает openStickerPrint().
 * Используется как обработчик кнопки "Создать" внутри модального окна.
 *
 * @returns {void}
 */
function generateSticker() {
  var carrier = document.getElementById('stickerCarrier').value.trim()
  var avitoChecked = document.getElementById('stickerAvito').checked
  var code = document.getElementById('stickerCode').value.trim()
  var size = document.getElementById('stickerSize').value

  if (!carrier) {
    alert(
      '\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u043B\u0438 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u043B\u0443\u0436\u0431\u0443 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438!'
    )
    return
  }
  if (!code) {
    alert(
      '\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u043A\u043E\u0434 \u0437\u0430\u043A\u0430\u0437\u0430!'
    )
    return
  }

  toggleStickerModal(false)
  openStickerPrint(carrier, code, size, avitoChecked)
}
