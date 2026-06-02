'use strict';

/**
 * @file Хранилище значений с таймаутом (TTL-кэш).
 * Каждый ключ имеет собственный таймер, который запускается при set()
 * и отменяется при delete() или перезаписи ключа.
 * Реализует Map-подобный интерфейс: set, get, has, delete, clear, size.
 */

/**
 * Хранилище значений с автоматическим удалением по таймауту (TTL).
 * Каждый ключ имеет собственный таймер, который запускается при set()
 * и отменяется при delete() или перезаписи ключа.
 * @property {number} defaultTtlMs - Таймаут по умолчанию в миллисекундах
 * @property {number} size - Количество активных ключей
 */
class TtlMap {
  /**
   * @param {number} [defaultTtlMs=60000] - Таймаут по умолчанию в миллисекундах
   */
  constructor(defaultTtlMs = 60000) {
    /** @type {number} */
    this._defaultTtlMs = defaultTtlMs;

    /** @type {Map<string|number, {value: *, timerId: ReturnType<typeof setTimeout>|null}>} */
    this._map = new Map();
  }

  /**
   * Сохраняет значение с опциональным таймаутом.
   * Если ключ уже существует, предыдущий таймер отменяется.
   * @param {string|number} key - Ключ
   * @param {*} value - Значение
   * @param {number} [ttlMs] - Таймаут в мс (если не указан, используется defaultTtlMs)
   * @returns {void}
   */
  set(key, value, ttlMs) {
    const timeout = ttlMs !== undefined ? ttlMs : this._defaultTtlMs;

    // Отменяем существующий таймер перед перезаписью
    if (this._map.has(key)) {
      clearTimeout(this._map.get(key).timerId);
    }

    const timerId = setTimeout(() => {
      this.delete(key);
    }, timeout);

    // Не блокируем завершение процесса (Node.js)
    if (timerId && typeof timerId.unref === 'function') {
      timerId.unref();
    }

    this._map.set(key, { value, timerId });
  }

  /**
   * Возвращает значение по ключу без сброса таймера.
   * @param {string|number} key - Ключ
   * @returns {*|undefined} Значение или undefined, если ключ не найден
   */
  get(key) {
    const entry = this._map.get(key);
    return entry ? entry.value : undefined;
  }

  /**
   * Удаляет ключ и отменяет его таймер.
   * @param {string|number} key - Ключ
   * @returns {boolean} true если ключ существовал и удалён, иначе false
   */
  delete(key) {
    if (!this._map.has(key)) {
      return false;
    }

    const { timerId } = this._map.get(key);
    clearTimeout(timerId);
    return this._map.delete(key);
  }

  /**
   * Проверяет существование ключа.
   * @param {string|number} key - Ключ
   * @returns {boolean} true если ключ существует
   */
  has(key) {
    return this._map.has(key);
  }

  /**
   * Удаляет все ключи и отменяет все активные таймеры.
   * @returns {void}
   */
  clear() {
    for (const entry of this._map.values()) {
      clearTimeout(entry.timerId);
    }
    this._map.clear();
  }

  /**
   * Количество активных ключей.
   * @returns {number}
   */
  get size() {
    return this._map.size;
  }
}

module.exports = { TtlMap };
