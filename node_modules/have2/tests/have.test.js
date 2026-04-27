'use strict'

var test = require('tape')
var have = require('./tools/require-have')()
var check = require('./tools/case-checker')(have)

var constants = require('./_constants')
var NON_ARGS = constants.NON_ARGS
var NON_OBJS = constants.NON_OBJS
var FUNC = constants.FUNC

// --- TESTS --- //

test('have module', function (t) {
  t.equal(typeof have, 'function', 'should exports a function')
  t.end()
})

test('have throws if `args` argument does not looks like an array or an object', function (t) {
  NON_ARGS.forEach(function (thing) {
    t.throws(function () { have(thing, {}) }, /argument should be/i,
      'should throws with ' + Object.prototype.toString.call(thing))
  })
  t.end()
})

test('have *not* throws if `args` is function `arguments`', function (t) {
  t.doesNotThrow(function () {
    var func = function () { have(arguments, { }) }
    func.call(this)
  })
  t.end()
})

test('have throws if `schema` argument does not looks like an object or non empty array',
  function (t) {
    NON_OBJS.concat([[]]).forEach(function (thing) {
      t.throws(function () { have([], thing) }, /schema/i, 'should throw with ' +
        Object.prototype.toString.call(thing))
    })
    t.end()
  }
)

test('have with empty schema', function (t) {
  [
    [[], {}],
    [[], [{}]],
    [[], [{}, {}]],
    [[], [[{}], {}]]
  ].forEach(function (args) {
    t.doesNotThrow(function () {
      have.apply(null, args)
    }, 'should *not* throws with ' + JSON.stringify(args[1]) + ' schema')

    t.doesNotThrow(function () {
      have.strict.apply(null, args)
    }, 'should *not* throws with ' + JSON.stringify(args[1]) + ' schema (in strict mode)')
  })

  t.end()
})

test('have with basic schema', function (t) {
  var SCHEMA = {
    one: 'string',
    two: 'number',
    three: 'function',
    four: 'object',
    five: 'boolean'
  }
  var args = ['str', 123, FUNC, { }, true]

  check(t).doesNotThrowIf({ 'all arguments given correctly': [
    args, SCHEMA,
    { one: args[0], two: args[1], three: args[2], four: args[3], five: args[4] }]
  })

  check(t).throwsIf({
    'first argument is missing':
      [[], SCHEMA, /one/i],
    'second argument is missing':
      [['str'], SCHEMA, /two/i],
    'third argument is missing':
      [['str', 123], SCHEMA, /three/i],
    'fourth argument is missing':
      [['str', 123, FUNC], SCHEMA, /four/i],
    'fifth argument is missing':
      [['str', 123, FUNC, {}], SCHEMA, /five/i],
    'first argument is of invalid type':
      [[123], SCHEMA, /one/i],
    'second argument is of invalid type':
      [['str', 'str'], SCHEMA, /two/i],
    'third argument is of invalid type':
      [['str', 123, 'str'], SCHEMA, /three/i],
    'fourth argument is of invalid type':
      [['str', 123, FUNC, 123], SCHEMA, /four/i],
    'fifth argument is of invalid type':
      [['str', 123, FUNC, /rx/i, 123], SCHEMA, /five/i]
  })

  t.end()
})

test('have with RegExp schema', function (t) {
  var SCHEMA = { one: 'regex' }
  var args = [new RegExp(), /test/i]

  check(t).doesNotThrowIf({
    'RegExp instance given as argument':
      [[args[0]], SCHEMA, { one: args[0] }],
    'regular expression literal given as argument':
      [[args[1]], SCHEMA, { one: args[1] }]
  })

  check(t).throwsIf({
    'regex argument is missing':
      [[], SCHEMA, /one/i],
    'regex argument is *not* a RegExp':
      [['123'], SCHEMA, /one/i]
  })

  t.end()
})

test('have with Date schema', function (t) {
  var args = [new Date()]
  var SCHEMA = { one: 'date' }

  check(t).doesNotThrowIf({
    'date argument is given correctly':
      [args, SCHEMA, { one: args[0] }]
  })

  check(t).throwsIf({
    'date argument is *not* a Date instance':
      [[{ }], SCHEMA, /one/i],
    'date argument is missing':
      [[], SCHEMA, /one/i],
    'date argument is a string':
      [['' + new Date()], SCHEMA, /one/i]
  })

  t.end()
})

test('have with array schema', function (t) {
  var SCHEMA = { arr: 'array' }
  var args = [[123, 456]]

  check(t).doesNotThrowIf({
    'array argument given correctly':
      [args, SCHEMA, { arr: args[0] }]
  })

  check(t).throwsIf({
    'array argument is missing':
      [[], SCHEMA, /arr/i],
    'array argument is *not* an array':
      [['str'], SCHEMA, /arr/i]
  })

  t.end()
})

test('have with array member type specified schema', function (t) {
  var SCHEMA = { nums: 'number array' }
  var args = [[123, 456]]

  check(t).doesNotThrowIf({
    'array argument with members given correctly':
      [args, SCHEMA, { nums: args[0] }]
  })

  check(t).throwsIf({
    'array member is falsy':
      [[[null]], SCHEMA, /element/i],
    'array member is of invalid type':
      [[['str']], SCHEMA, /nums/i]
  })

  t.end()
})

test('have with OR argument schema', function (t) {
  var SCHEMA = { str: 'string or number' }

  check(t).doesNotThrowIf({
    'argument is of the first type':
      [['str'], SCHEMA, { str: 'str' }],
    'argument is of the second type':
      [[123], SCHEMA, { str: 123 }]
  })

  check(t).throwsIf({
    'argument is missing or falsy':
      [[null], SCHEMA, /str/i],
    'argument is of neither the specified type':
      [[FUNC], SCHEMA, /str/i]
  })

  t.end()
})

test('have with optional argument schema', function (t) {
  var SCHEMA = {
    str: 'string',
    num: 'optional number',
    cb: 'function'
  }
  var cases = [
    ['str', FUNC],
    ['str', 123, FUNC],
    ['str', null, FUNC],
    ['str', undefined, FUNC]
  ]

  check(t).doesNotThrowIf({
    'optional argument omitted but other arguments are given correctly':
      [cases[0], SCHEMA, { str: cases[0][0], cb: cases[0][1] }],
    'optional arguments specified and all other arguments are given correctly':
      [cases[1], SCHEMA, { str: cases[1][0], num: cases[1][1], cb: cases[1][2] }],
    'optional argument is specified as `null`':
      [cases[2], SCHEMA, { str: cases[2][0], num: cases[2][1], cb: cases[2][2] }],
    'optional argument is specified as `undefined`':
      [cases[3], SCHEMA, { str: cases[3][0], num: cases[3][1], cb: cases[3][2] }]
  })

  check(t).throwsIf({
    'arguments before the optional arg is missing':
      [[], SCHEMA, /str/i],
    'arguments after the optional arg is missing':
      [['str', 123], SCHEMA, /cb/i],
    'arguments before the optional arg is of invalid type':
      [[123], SCHEMA, /str/i],
    'arguments after the optional arg is of invalid type':
      [['str', 123, 'str'], SCHEMA, /cb/i]
  })

  t.end()
})

test('have with complex `string array or number array` schema', function (t) {
  var SCHEMA = { arg: 'string array or number array' }

  NON_ARGS.forEach(function (thing) {
    t.throws(function () {
      have([thing], SCHEMA)
    }, /array/i, 'should throws if ' + Object.prototype.toString.call(thing) + ' is given')
  })

  t.throws(function () { have([{ }], SCHEMA) }, /neither/i,
    'should throws if array given but element is of neither type')

  t.doesNotThrow(function () { have([['string']], SCHEMA) },
    'should *not* throws if element is of string type')

  t.doesNotThrow(function () { have([[123]], SCHEMA) },
    'should *not* throws if element is of number type')

  t.end()
})

test('have with complex `opt num, str, opt str, str, opt num` schema (ambiguous optionals)',
  function (t) {
    var SCHEMA = {
      one: 'opt num',
      two: 'str',
      three: 'opt str',
      four: 'str',
      five: 'opt num',
      six: 'opt str'
    }

    // WARN: explicit check for `undefined` is slippery, better to not rely on this.
    check(t).doesNotThrowIf({
      'three strings are given': [
        ['str', 'abc', 'def'], SCHEMA,
        { two: 'str', three: 'abc', four: 'def', five: undefined, six: undefined }],

      'a number and three strings are given': [
        [123, 'a', 'b', 'c'], SCHEMA,
        { one: 123, two: 'a', three: 'b', four: 'c', five: undefined, six: undefined }],

      'a number, three strings and undefined are given': [
        [123, 'a', 'b', 'c', undefined], SCHEMA,
        { one: 123, two: 'a', three: 'b', four: 'c', five: undefined, six: undefined }],

      'undefined, three strings and number are given': [
        [undefined, 'a', 'b', 'c', 456], SCHEMA,
        { one: undefined, two: 'a', three: 'b', four: 'c', five: 456, six: undefined }],

      'only the 3rd argument is undefined': [
        [123, 'a', undefined, 'c', 456, 'd'], SCHEMA,
        { one: 123, two: 'a', three: undefined, four: 'c', five: 456, six: 'd' }],

      'everything is given': [
        [123, 'a', 'b', 'c', 456, 'd'], SCHEMA,
        { one: 123, two: 'a', three: 'b', four: 'c', five: 456, six: 'd' }]
    })

    check(t).throwsIf({
      'nothing is given':
        [[], SCHEMA, /two/i],
      'a single argument is given':
        [['two'], SCHEMA, /four/i],
      'two numbers are given':
        [[123, 456], SCHEMA, /two/i],
      'two strings are given':
        [['str', 'abc'], SCHEMA, /four/i],
      'only the 3rd arg is omitted':
        [[123, 'str', 'abc', 456, 'def'], SCHEMA, /four/i]
    })

    t.end()
  }
)

// actually an invalid type but we're testing it to make sure nonetheless
test('have with complex `str or opt num` type (nested optional)', function (t) {
  var SCHEMA = { one: 'str or opt num' }

  check(t).doesNotThrowIf({
    'argument is given but of neither type':
      [[{ }], SCHEMA],
    'string argument is given':
      [['str'], SCHEMA],
    'number argument is given':
      [[123], SCHEMA]
  })

  t.end()
})

test('have with complex `str or num or arr or func` type (nested ORs)', function (t) {
  var SCHEMA = { one: 'str or num or arr or func' }

  check(t).doesNotThrowIf({
    'string is given':
      [['str'], SCHEMA],
    'number is given':
      [[123], SCHEMA],
    'array is given':
      [[[]], SCHEMA],
    'function is given':
      [[FUNC], SCHEMA]
  })

  check(t).throwsIf({
    'object is given':
      [[{ }], SCHEMA]
  })

  t.end()
})

test('have with complex `num arr arr arr` type (nested arrays)', function (t) {
  var SCHEMA = { one: 'num arr arr arr' }

  var ARR_1L = []
  var ARR_2L = [[]]
  var ARR_3L = [[[]]]
  var ARR_4L = [[[[]]]]
  var ARR_EXAMPLE_1 = [[[123]]]
  var ARR_EXAMPLE_2 = [[[123], [456]], [[789]]]

  check(t).doesNotThrowIf({
    'an empty array is given': [
      [ ARR_1L ], SCHEMA, { one: ARR_1L }],
    'a nested empty array is given': [
      [ ARR_2L ], SCHEMA, { one: ARR_2L }],
    'deeply nested empty array is given': [
      [ ARR_3L ], SCHEMA, { one: ARR_3L }],
    'multiple nested empty arrays are given': [
      [ ARR_1L, ARR_2L, ARR_3L, ARR_4L ], SCHEMA, { one: ARR_1L }],
    'number array is given at correct depth': [
      [ ARR_EXAMPLE_1 ], SCHEMA, { one: ARR_EXAMPLE_1 }],
    'multiple nested number arrays are given': [
      [ ARR_EXAMPLE_2 ], SCHEMA, { one: ARR_EXAMPLE_2 }]
  })

  check(t).throwsIf({
    'non-array is given at first nesting level':
      [[ [123] ], SCHEMA, /one/i],
    'non-array is given at second nesting level':
      [[ [[123]] ], SCHEMA, /one/i]
  })

  t.end()
})

test('have with schema matchers variants', function (t) {
  var m, v, variants, arg
  var cases = {}

  var matchers = {
    's|str|string': 'str',
    'n|num|number': 1,
    'b|bool|boolean': true,
    'f|fun|func|function': function () {},
    'a|arr|array': [],
    'o|obj|object|Object': {},
    'r|rx|regex|regexp': /regex/,
    'd|date': new Date(),
    'opt str|optional str': 'str'
  }

  for (m in matchers) {
    variants = m.split(/\|/)
    for (v in variants) {
      arg = matchers[m]
      cases['built-in "' + variants[v] + '" matcher specified'] =
        [[arg], { arg: variants[v] }, { arg: arg }]
    }
  }
  check(t).doesNotThrowIf(cases)

  check(t).throwsIf({
    'unknown matcher specified':
      [['str'], { arg: 'foo' }, /`arg`.+is not foo/i]
  })

  check(t).throwsIf({
    'argument not correspond to matcher alias in schema':
      [[1], { arg: 's' }, /`arg`.+is not string/i]
  })

  t.end()
})

test('have with unexpected and extra arguments (strict mode)', function (t) {
  var SCHEMA = { one: 'str', tow: 'num', three: 'opt str' }

  check(t).throwsIf({
    'wrong optional argument specified':
      [['str', 1, 777], SCHEMA, /Unexpected argument "777"/i],
    'extra argument specified':
      [['str', 1, 'str', 'extra'], SCHEMA, /Unexpected argument "extra"/i],
    'extra undefined argument specified':
      [['str', 1, 'str', undefined], SCHEMA, /Unexpected argument "undefined"/i],
    'wrong argument specified in named arguments':
      [{ one: 'str', tow: 2, extra: 3 }, SCHEMA, /Unexpected `extra` argument/i],
    'extra argument specified in named arguments':
      [{ one: 'str', tow: 2, three: 'str', extra: 55 }, SCHEMA, /Unexpected `extra` argument/i],
    'extra undefined argument specified in named arguments':
      [{ one: 'str', tow: 2, three: 'str', extra: undefined }, SCHEMA,
        /Unexpected `extra` argument/i]
  }, true)

  t.end()
})

test('have with several schemas', function (t) {
  var obj = {}
  var date = new Date()

  var SCHEMA = [
    { one1: 'obj', tow1: 'opt bool' },
    { one2: 'str', tow2: 'opt obj', three2: 'opt bool' },
    { one3: 'str', tow3: 'opt str', three3: 'opt bool' }
  ]

  check(t).doesNotThrowIf({
    '[str, str, boot] arguments correspond to third schema in list':
      [['str1', 'str2', true], SCHEMA, { one3: 'str1', tow3: 'str2', three3: true }],
    '[str, obj, bool] arguments correspond to second schema in list':
      [['str1', obj, true], SCHEMA, { one2: 'str1', tow2: obj, three2: true }],
    '[str, obj] arguments correspond to second schema in list':
      [['str1', obj], SCHEMA, { one2: 'str1', tow2: obj }],
    '[str, date] arguments correspond to second schema in list':
      [['str1', date], SCHEMA, { one2: 'str1' }]
  })

  check(t).throwsIf({
    '[num] arguments not correspond to any schema in list':
      [[1], SCHEMA, /one1/i]
  })

  t.end()
})

test('have with several schemas (strict mode)', function (t) {
  var obj = {}

  var SCHEMA = [
    { one1: 'obj', tow1: 'opt bool' },
    { one2: 'str', tow2: 'opt obj', three2: 'opt bool' },
    { one3: 'str', tow3: 'opt str', three3: 'opt bool' }
  ]

  var cases = {
    '[str, str, boot] arguments correspond to third schema in list':
      [['str1', 'str2', true], SCHEMA, { one3: 'str1', tow3: 'str2', three3: true }],
    '[str, obj, bool] arguments correspond to second schema in list':
      [['str1', obj, true], SCHEMA, { one2: 'str1', tow2: obj, three2: true }],
    '[str, obj] arguments correspond to second schema in list':
      [['str1', obj], SCHEMA, { one2: 'str1', tow2: obj }]
  }

  check(t).throwsIf({
    '[num] arguments not correspond to any schema in list':
      [[1], SCHEMA, /one1/i],
    '[str, num] arguments not correspond to any schema in list':
      [['str1', 555], SCHEMA, /"555"/i],
    'long string arguments not correspond to any schema in list':
      [['str1', 'str2', 'This string argument is longer when 15 characters'], SCHEMA,
        /"This string arg\.\."/i]
  }, true)

  check(t).doesNotThrowIf(cases, true)

  t.end()
})

test('have with named arguments object', function (t) {
  var SCHEMA = { one: 'str', tow: 'str', three: 'opt num or num arr' }

  check(t).doesNotThrowIf({
    '{ one: String, tow: String, three: Number } object correspond to schema': [
      { one: 'one', tow: 'tow', three: 3 }, SCHEMA,
      { one: 'one', tow: 'tow', three: 3 }]
  })

  check(t).throwsIf({
    '{ one: String, tow: Number, three: Number } object not correspond to schema': [
      { one: 'one', tow: 2, three: 3 }, SCHEMA, /`tow`.+is not/i]
  })

  check(t).throwsIf({
    '{ one: String, tow: Number, three: Number } object not correspond to schema': [
      { one: 'one', tou: 2, three: 3 }, SCHEMA, /foo/i]
  })

  t.end()
})

test('have with array like arguments or named arguments object', function (t) {
  var SCHEMA = [
    { one: 'str', tow: 'str', three: 'opt num or num arr' },
    have.argumentsObject
  ]

  check(t).doesNotThrowIf({
    '[String, String, Number] object correspond to schema': [
      ['one', 'tow', 3], SCHEMA,
      { one: 'one', tow: 'tow', three: 3 }]
  }, true)

  check(t).doesNotThrowIf({
    '{ one: String, tow: String, three: Number } object correspond to schema': [
      { one: 'one', tow: 'tow', three: 3 }, SCHEMA,
      { one: 'one', tow: 'tow', three: 3 }]
  }, true)

  check(t).doesNotThrowIf({
    '{ one: String, tow: String, three: Number } object correspond to schema': [
      [{ one: 'one', tow: 'tow', three: 3 }], SCHEMA,
      { one: 'one', tow: 'tow', three: 3 }]
  }, true)

  check(t).throwsIf({
    '{ one: String, tow: Number, three: Number } object not correspond to schema': [
      [{ one: 'one', tow: 2, three: 3 }], SCHEMA, /`tow`.+is not/i]
  }, true)

  t.end()
})
