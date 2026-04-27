'use strict'

var test = require('tape')
var have = require('./tools/require-have')()

var NON_OBJS = require('./_constants').NON_OBJS

test('have.with()', function (t) {
  var hewHave

  NON_OBJS.forEach(function (thing) {
    t.throws(function () { have.with(thing) }, /`checkers`.+must to be an object/i,
      'should throw if checkers is ' + Object.prototype.toString.call(thing))
  })

  t.doesNotThrow(function () {
    have.with({})
  }, 'should *not* throws if checkers is empty object')

  hewHave = have.with({ 'foo': function () { return true } })
  t.notStrictEqual(have, hewHave, 'should return new have function')

  t.end()
})

test('have with "Foo" custom checker', function (t) {
  var haveWithBuiltInTypes, haveWithCustomTypes, myHave, SCHEMA1, foo

  function Foo () {
    this.name = 'FooType'
  }

  foo = new Foo()

  myHave = have.with({
    'Name': function (_name) {
      return _name && typeof _name === 'string' && _name.length > 1 &&
        _name.substring(0, 1) === _name.substring(0, 1).toUpperCase()
    },
    'Foo': function (type) {
      return type instanceof Foo
    },
    'foo': 'Foo'
  })

  haveWithBuiltInTypes = require('./tools/case-checker')(have)
  haveWithCustomTypes = require('./tools/case-checker')(myHave)

  SCHEMA1 = { one: 'Foo', tow: 'opt num or foo', three: 'opt Foo' }

  haveWithCustomTypes(t).doesNotThrowIf({
    'check for Foo type with custom checker':
      [[foo, foo, foo], SCHEMA1, { one: foo, tow: foo, three: foo }]
  }, true)

  haveWithBuiltInTypes(t).throwsIf({
    'check for Foo type with parent have (built-in checkers)':
      [[foo, foo, foo], SCHEMA1, /`one`.+is not Foo/i]
  }, true)

  haveWithCustomTypes(t).throwsIf({
    'argument is of neither the Foo type':
      [['str', 10, {}], SCHEMA1, /`one`.+is not Foo/i]
  }, true)

  t.end()
})

// test('', function () {
//   SCHEMA2 = { str: 'str', name: 'opt num or Name', foo: 'foo' }
//   myHave2 = myHave.with({
//     's|str|string': function (str) {
//       return typeof value === 'string' && str.length
//     }
//   })

//   t.doesNotThrow(function () {
//     myHave(['', 'Jake', foo], SCHEMA2)
//   })

//   t.throws(function () {
//     myHave2(['', 'Jake', foo], SCHEMA2)
//   }, /str argument is not str/i)

//   t.end()
// })
