'use strict'

const express = require('express')
const fs = require('fs')

const { loadOrdersState } = require('../lib/server-utils')

/**
 * Debug роутер
 * @param {Object} deps - Зависимости
 * @param {string} deps.STATE_FILE - Путь к файлу состояния заказов
 * @param {Function} deps.log - Функция логирования
 * @returns {import('express').Router}
 */
module.exports = function(deps) {
  const router = express.Router()
  const { STATE_FILE, log } = deps

  // ─── Debug: check state file ───
  /**
   * GET /api/debug-state — Просмотр содержимого файла состояния заказов (orders_state.json)
   * @returns {Object} JSON с информацией о файле: путь, существование, количество записей, ключи, полное состояние
   */
  router.get('/debug-state', (req, res) => {
    const state = loadOrdersState(STATE_FILE, log)
    res.json({
      file: STATE_FILE,
      exists: fs.existsSync(STATE_FILE),
      count: Object.keys(state).length,
      keys: Object.keys(state).slice(0, 5),
      state: state
    })
  })

  return router
}
