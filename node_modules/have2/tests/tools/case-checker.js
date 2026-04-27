'use strict'

module.exports = function (have) {
  function casesCheck (t, shouldFail, cases, strict) {
    var p, result, description, caseItem, args, schema, expectedTest, assertArgs, testPass

    for (description in cases) {
      caseItem = cases[description]
      args = caseItem[0]
      schema = caseItem[1]
      expectedTest = caseItem[2]

      assertArgs = [function () {
        result = strict
          ? have.strict.call(null, args, schema)
          : have(args, schema)
      }]

      if (shouldFail && expectedTest != null && expectedTest instanceof RegExp) {
        assertArgs.push(expectedTest)
      }
      assertArgs.push('should ' + (shouldFail ? 'throw if ' : '*not* throw if ') + description +
        (strict ? ' [strict mode]' : ''))

      t[shouldFail ? 'throws' : 'doesNotThrow'].apply(t, assertArgs)

      if (!shouldFail && typeof expectedTest === 'object') {
        testPass = true
        if (result == null) {
          t.fail('should return result object')
          return
        }
        for (p in expectedTest) {
          if (!result.hasOwnProperty(p)) {
            t.fail('result should have property `' + p + '`')
            return
          }
          if (result[p] !== expectedTest[p]) {
            t.equal(result[p], expectedTest[p])
            testPass = false
          }
        }
        if (testPass) { t.ok(true, '.. and result should be equivalent') }
      }
    }
  }

  return function (t) {
    return {
      throwsIf: function (cases, strict) {
        casesCheck(t, true, cases, strict)
      },
      doesNotThrowIf: function (cases, strict) {
        casesCheck(t, false, cases, strict)
      }
    }
  }
}

