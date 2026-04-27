'use strict'

var ARR_RX = /^(.+) a(rr(ay)?)?$/i
var OR_RX = /^(.+) or (.+)$/i
var OPT_RX = /^opt(ional)? (.+)$/i

var isArray = function (value) { return Array.isArray(value) }
var isObject = function (value) { return value != null && typeof value === 'object' }
var isPlainObject = function (value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}
var isArguments = function (value) {
  return isObject(value) && value.hasOwnProperty('callee') && !value.propertyIsEnumerable('callee')
}

var BUILT_IN_MATCHERS = {
  // string
  'string': function (value) {
    return typeof value === 'string'
  },
  's|str': 'string',

  // number
  'number': function (value) {
    return typeof value === 'number'
  },
  'n|num': 'number',

  // boolean
  'boolean': function (value) {
    return typeof value === 'boolean'
  },
  'b|bool': 'boolean',

  // function
  'function': function (value) {
    return typeof value === 'function'
  },
  'f|fun|func': 'function',

  // array
  'array': isArray,
  'a|arr': 'array',

  // object
  'object': isObject,
  'o|obj': 'object',

  // regexp
  'regexp': function (value) {
    return value && value instanceof RegExp
  },
  'r|rx|regex': 'regexp',

  // date
  'date': function (value) {
    return value && value instanceof Date
  },
  'd': 'date',

  // Object
  'Object': isPlainObject,
  'Obj': 'Object'
}
// TODO Add "any" matcher


var customAssert = function (test, msg) {
  if (!test) {
    if (msg === void 0) throw new Error(test + ' == true')
    else throw new Error(msg)
  }
}

var HAVE_ARGUMENTS_OBJECT = '@@have/argumentsObject'
var HAVE_DEFAULT_MATCHER = '@@have/defaultMatcher'
var ARGUMENTS_OBJECT_MATCHER = {}
var DEFAULT_MATCHER = {}
ARGUMENTS_OBJECT_MATCHER[HAVE_ARGUMENTS_OBJECT] = 'Object'
DEFAULT_MATCHER[HAVE_DEFAULT_MATCHER] = function () { return false }

// Object assign
function assign () {
  var args = Array.prototype.slice.call(arguments, 0)
  var target = args[0]
  var source = args.slice(1)
  var i, len, p

  for (i = 0, len = source.length; i < len; i++) {
    for (p in source[i]) {
      if (source[i].hasOwnProperty(p)) {
        target[p] = source[i][p]
      }
    }
  }
  return target
}

// { 's|str': val1 } -> { 's': val1, 'str': val1 }
function unfoldMatchers (matchers) {
  var unfolded = {}
  var variants, p, i, len

  for (p in matchers) {
    if (matchers.hasOwnProperty(p)) {
      variants = p.split(/\|/)
      for (i = 0, len = variants.length; i < len; i++) {
        unfolded[variants[i]] = matchers[p]
      }
    }
  }
  return unfolded
}

// core recursive check
function ensure (matchers, argName, argType, value, check) {
  var memberType = null
  var valid = true
  var reason = null
  var match = null
  var typeValidator = null
  var i = 0

  function softAssert (cond, reason_) {
    if (!(valid = cond)) reason = reason_
  }

  match = argType.match(OPT_RX)
  if (match) {
    memberType = match[2]
    ensure(matchers, argName, memberType, value, softAssert)
    return valid || value === null || value === void 0
  }

  match = argType.match(OR_RX)
  if (match) {
    memberType = match[1]
    ensure(matchers, argName, memberType, value, softAssert)
    if (valid) return true
    valid = true // reset previous softAssert

    memberType = match[2]
    ensure(matchers, argName, memberType, value, softAssert)
    check(valid, '`' + argName + '` is neither a ' + match[1] + ' nor ' + match[2])
    return true
  }

  match = argType.match(ARR_RX)
  if (match) {
    ensure(matchers, argName, 'array', value, softAssert)
    if (!valid) {
      check(false, reason)
      return false
    }
    memberType = match[1]
    for (i = 0; i < value.length; i++) {
      ensure(matchers, argName, memberType, value[i], softAssert)
      if (!valid) {
        check(false, '`' + argName + '` element is falsy or not a ' + memberType)
        return false
      }
    }
    return true
  }

  typeValidator = (function getValidator (t) {
    var validator = null
    argType = t
    if (matchers.hasOwnProperty(t)) validator = matchers[t]
    return typeof validator === 'string' ? getValidator(validator) : validator
  })(argType)

  valid = typeValidator ? typeValidator(value) : matchers[HAVE_DEFAULT_MATCHER](value)

  check(valid, '`' + argName + '` is not ' + argType)
  return true
}

function ensureArgs (args, schema, matchers, strict) {
  var ensureResults = []
  var parsedArgs = {}
  var argIndex = 0
  var argsKeys = []
  var fail = null
  var p, i, len, argName, ensured, argStr

  // have schema check
  if (schema instanceof Array) {
    if (!schema.length) { throw new Error('have() called with empty schema list') }

    for (i = 0, len = schema.length; i < len; i++) {
      ensureResults[i] = ensureArgs(args, schema[i], matchers, strict)
    }

    ensureResults.sort(function (a, b) {
      if (a.argIndex > b.argIndex) return -1
      if (a.argIndex < b.argIndex) return 1
      return 0
    })

    for (i = 0; i < ensureResults.length; i++) {
      if (!ensureResults[i].fail) return ensureResults[i]
    }

    return ensureResults[0]
  } else if (isPlainObject(schema)) {
    // have `arguments` check
    if (isArguments(args) || isArray(args)) {
      for (i = 0, len = args.length; i < len; i++) { argsKeys[i] = i }
    } else if (isPlainObject(args)) {
      i = 0
      for (p in args) {
        if (args.hasOwnProperty(p)) { argsKeys[i++] = p }
      }
    } else {
      throw new Error('have() `arguments` argument should be function arguments, array or object')
    }

    for (argName in schema) {
      if (schema.hasOwnProperty(argName)) {
        ensured = ensure(matchers, argName, schema[argName], args[argsKeys[argIndex]],
          function (cond, fail_) { if (!cond) fail = fail_ })
        if (fail) break
        if (ensured) {
          parsedArgs[argName] = args[argsKeys[argIndex]]
          argIndex++
        }
      }
    }

    if (strict && !fail && argIndex < argsKeys.length) {
      if (typeof argsKeys[argIndex] === 'string') {
        fail = 'Unexpected `' + argsKeys[argIndex] + '` argument'
      } else {
        argStr = '' + args[argsKeys[argIndex]]
        fail = 'Unexpected argument "' + (argStr.length > 15
            ? argStr.substring(0, 15) + '..'
            : argStr) + '"'
      }
    }

    return { fail: fail, parsedArgs: parsedArgs, argIndex: argIndex }
  } else {
    throw new Error('have() `schema` should be an array or an object')
  }
}

// have.js - Main have.js exports
module.exports = (function () {
  var assert = customAssert

  function have (args, schema, strict) {
    var res = ensureArgs(args, schema, this.matchers, strict)
    if (HAVE_ARGUMENTS_OBJECT in res.parsedArgs) {
      return have.call(this, res.parsedArgs[HAVE_ARGUMENTS_OBJECT], schema, strict)
    }
    assert(!res.fail, res.fail)
    return res.parsedArgs
  }

  have.assert = function (assert_) {
    return (assert_ === void 0) ? assert : (assert = assert_)
  }

  have.strict = function (args, schema) {
    return this(args, schema, true)
  }

  have.matchers = assign({}, ARGUMENTS_OBJECT_MATCHER, DEFAULT_MATCHER)

  have.argumentsObject = ARGUMENTS_OBJECT_MATCHER

  have.with = function (matchers) {
    var _have = function () { return have.apply(_have, arguments) } // TODO Test

    if (!isPlainObject(matchers)) {
      throw new Error('`checkers` argument must to be an object')
    }

    return assign(_have, {
      assert: have.assert,
      strict: have.strict.bind(_have),
      with: have.with,
      matchers: assign({}, unfoldMatchers(this.matchers), unfoldMatchers(matchers)),
      argumentsObject: have.argumentsObject
    })
  }

  return have.with(BUILT_IN_MATCHERS)
})()

