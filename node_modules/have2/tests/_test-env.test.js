'use strict'

var test = require('tape')
var requireHave = require('./tools/require-have')
var caseChecker = require('./tools/case-checker')

test('require-have', function (t) {
  var have, have2

  have = requireHave()
  t.ok(have, 'should return have module')
  have.foo = 'bar'

  have2 = requireHave()
  t.notEqual(have, have2, 'should return new module instance')
  t.notOk(have2.foo, 'should not foo property in have')

  t.end()
})

test('case-checker', function (t) {
  var check = caseChecker(requireHave())
  t.ok(check, 'should return checker module')

  // TODO

  t.end()
})
