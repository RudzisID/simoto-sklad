'use strict'

var test = require('tape')
var have = require('./tools/require-have')()

test('have.assert()', function (t) {
  var called = false
  var spy = function () { called = true }
  var haveAssert = have.assert()

  t.equal(typeof have.assert, 'function', 'should to be function')

  have.assert(spy)
  have([123], { one: 'string' })
  t.ok(called, 'should use given function as assert() replacement')

  have.assert(haveAssert)
  t.end()
})
