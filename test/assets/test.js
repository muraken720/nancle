(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// http://wiki.commonjs.org/wiki/Unit_Testing/1.0
//
// THIS IS NOT TESTED NOR LIKELY TO WORK OUTSIDE V8!
//
// Originally from narwhal.js (http://narwhaljs.org)
// Copyright (c) 2009 Thomas Robinson <280north.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// when used in node, this will actually load the util module we depend on
// versus loading the builtin util module as happens otherwise
// this is a bug in node module loading as far as I am concerned
var util = require('util/');

var pSlice = Array.prototype.slice;
var hasOwn = Object.prototype.hasOwnProperty;

// 1. The assert module provides functions that throw
// AssertionError's when particular conditions are not met. The
// assert module must conform to the following interface.

var assert = module.exports = ok;

// 2. The AssertionError is defined in assert.
// new assert.AssertionError({ message: message,
//                             actual: actual,
//                             expected: expected })

assert.AssertionError = function AssertionError(options) {
  this.name = 'AssertionError';
  this.actual = options.actual;
  this.expected = options.expected;
  this.operator = options.operator;
  if (options.message) {
    this.message = options.message;
    this.generatedMessage = false;
  } else {
    this.message = getMessage(this);
    this.generatedMessage = true;
  }
  var stackStartFunction = options.stackStartFunction || fail;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, stackStartFunction);
  }
  else {
    // non v8 browsers so we can have a stacktrace
    var err = new Error();
    if (err.stack) {
      var out = err.stack;

      // try to strip useless frames
      var fn_name = stackStartFunction.name;
      var idx = out.indexOf('\n' + fn_name);
      if (idx >= 0) {
        // once we have located the function frame
        // we need to strip out everything before it (and its line)
        var next_line = out.indexOf('\n', idx + 1);
        out = out.substring(next_line + 1);
      }

      this.stack = out;
    }
  }
};

// assert.AssertionError instanceof Error
util.inherits(assert.AssertionError, Error);

function replacer(key, value) {
  if (util.isUndefined(value)) {
    return '' + value;
  }
  if (util.isNumber(value) && (isNaN(value) || !isFinite(value))) {
    return value.toString();
  }
  if (util.isFunction(value) || util.isRegExp(value)) {
    return value.toString();
  }
  return value;
}

function truncate(s, n) {
  if (util.isString(s)) {
    return s.length < n ? s : s.slice(0, n);
  } else {
    return s;
  }
}

function getMessage(self) {
  return truncate(JSON.stringify(self.actual, replacer), 128) + ' ' +
         self.operator + ' ' +
         truncate(JSON.stringify(self.expected, replacer), 128);
}

// At present only the three keys mentioned above are used and
// understood by the spec. Implementations or sub modules can pass
// other keys to the AssertionError's constructor - they will be
// ignored.

// 3. All of the following functions must throw an AssertionError
// when a corresponding condition is not met, with a message that
// may be undefined if not provided.  All assertion methods provide
// both the actual and expected values to the assertion error for
// display purposes.

function fail(actual, expected, message, operator, stackStartFunction) {
  throw new assert.AssertionError({
    message: message,
    actual: actual,
    expected: expected,
    operator: operator,
    stackStartFunction: stackStartFunction
  });
}

// EXTENSION! allows for well behaved errors defined elsewhere.
assert.fail = fail;

// 4. Pure assertion tests whether a value is truthy, as determined
// by !!guard.
// assert.ok(guard, message_opt);
// This statement is equivalent to assert.equal(true, !!guard,
// message_opt);. To test strictly for the value true, use
// assert.strictEqual(true, guard, message_opt);.

function ok(value, message) {
  if (!value) fail(value, true, message, '==', assert.ok);
}
assert.ok = ok;

// 5. The equality assertion tests shallow, coercive equality with
// ==.
// assert.equal(actual, expected, message_opt);

assert.equal = function equal(actual, expected, message) {
  if (actual != expected) fail(actual, expected, message, '==', assert.equal);
};

// 6. The non-equality assertion tests for whether two objects are not equal
// with != assert.notEqual(actual, expected, message_opt);

assert.notEqual = function notEqual(actual, expected, message) {
  if (actual == expected) {
    fail(actual, expected, message, '!=', assert.notEqual);
  }
};

// 7. The equivalence assertion tests a deep equality relation.
// assert.deepEqual(actual, expected, message_opt);

assert.deepEqual = function deepEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'deepEqual', assert.deepEqual);
  }
};

function _deepEqual(actual, expected) {
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;

  } else if (util.isBuffer(actual) && util.isBuffer(expected)) {
    if (actual.length != expected.length) return false;

    for (var i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) return false;
    }

    return true;

  // 7.2. If the expected value is a Date object, the actual value is
  // equivalent if it is also a Date object that refers to the same time.
  } else if (util.isDate(actual) && util.isDate(expected)) {
    return actual.getTime() === expected.getTime();

  // 7.3 If the expected value is a RegExp object, the actual value is
  // equivalent if it is also a RegExp object with the same source and
  // properties (`global`, `multiline`, `lastIndex`, `ignoreCase`).
  } else if (util.isRegExp(actual) && util.isRegExp(expected)) {
    return actual.source === expected.source &&
           actual.global === expected.global &&
           actual.multiline === expected.multiline &&
           actual.lastIndex === expected.lastIndex &&
           actual.ignoreCase === expected.ignoreCase;

  // 7.4. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if (!util.isObject(actual) && !util.isObject(expected)) {
    return actual == expected;

  // 7.5 For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else {
    return objEquiv(actual, expected);
  }
}

function isArguments(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
}

function objEquiv(a, b) {
  if (util.isNullOrUndefined(a) || util.isNullOrUndefined(b))
    return false;
  // an identical 'prototype' property.
  if (a.prototype !== b.prototype) return false;
  //~~~I've managed to break Object.keys through screwy arguments passing.
  //   Converting to array solves the problem.
  if (isArguments(a)) {
    if (!isArguments(b)) {
      return false;
    }
    a = pSlice.call(a);
    b = pSlice.call(b);
    return _deepEqual(a, b);
  }
  try {
    var ka = objectKeys(a),
        kb = objectKeys(b),
        key, i;
  } catch (e) {//happens when one is a string literal and the other isn't
    return false;
  }
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!_deepEqual(a[key], b[key])) return false;
  }
  return true;
}

// 8. The non-equivalence assertion tests for any deep inequality.
// assert.notDeepEqual(actual, expected, message_opt);

assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
  if (_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'notDeepEqual', assert.notDeepEqual);
  }
};

// 9. The strict equality assertion tests strict equality, as determined by ===.
// assert.strictEqual(actual, expected, message_opt);

assert.strictEqual = function strictEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(actual, expected, message, '===', assert.strictEqual);
  }
};

// 10. The strict non-equality assertion tests for strict inequality, as
// determined by !==.  assert.notStrictEqual(actual, expected, message_opt);

assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (actual === expected) {
    fail(actual, expected, message, '!==', assert.notStrictEqual);
  }
};

function expectedException(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  if (Object.prototype.toString.call(expected) == '[object RegExp]') {
    return expected.test(actual);
  } else if (actual instanceof expected) {
    return true;
  } else if (expected.call({}, actual) === true) {
    return true;
  }

  return false;
}

function _throws(shouldThrow, block, expected, message) {
  var actual;

  if (util.isString(expected)) {
    message = expected;
    expected = null;
  }

  try {
    block();
  } catch (e) {
    actual = e;
  }

  message = (expected && expected.name ? ' (' + expected.name + ').' : '.') +
            (message ? ' ' + message : '.');

  if (shouldThrow && !actual) {
    fail(actual, expected, 'Missing expected exception' + message);
  }

  if (!shouldThrow && expectedException(actual, expected)) {
    fail(actual, expected, 'Got unwanted exception' + message);
  }

  if ((shouldThrow && actual && expected &&
      !expectedException(actual, expected)) || (!shouldThrow && actual)) {
    throw actual;
  }
}

// 11. Expected to throw an error:
// assert.throws(block, Error_opt, message_opt);

assert.throws = function(block, /*optional*/error, /*optional*/message) {
  _throws.apply(this, [true].concat(pSlice.call(arguments)));
};

// EXTENSION! This is annoying to write outside this module.
assert.doesNotThrow = function(block, /*optional*/message) {
  _throws.apply(this, [false].concat(pSlice.call(arguments)));
};

assert.ifError = function(err) { if (err) {throw err;}};

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    if (hasOwn.call(obj, key)) keys.push(key);
  }
  return keys;
};

},{"util/":3}],2:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],3:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require("/Users/ken/work/nancle/node_modules/gulp-browserify/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":2,"/Users/ken/work/nancle/node_modules/gulp-browserify/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js":5,"inherits":4}],4:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],5:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],6:[function(require,module,exports){
/**
 * power-assert.js - Power Assert in JavaScript.
 *
 * https://github.com/twada/power-assert
 *
 * Copyright (c) 2013-2014 Takuto Wada
 * Licensed under the MIT license.
 *   https://raw.github.com/twada/power-assert/master/MIT-LICENSE.txt
 */
(function (root, factory) {
    'use strict';

    // using returnExports UMD pattern
    if (typeof define === 'function' && define.amd) {
        define(['assert', 'empower', 'power-assert-formatter'], factory);
    } else if (typeof exports === 'object') {
        module.exports = factory(require('assert'), require('empower'), require('power-assert-formatter'));
    } else {
        root.assert = factory(root.assert, root.empower, root.powerAssertFormatter);
    }
}(this, function (baseAssert, empower, formatter) {
    'use strict';

    return empower(baseAssert, formatter(), {modifyMessageOnFail: true, saveContextOnFail: true});
}));

},{"assert":1,"empower":7,"power-assert-formatter":8}],7:[function(require,module,exports){
/**
 * empower.js - Power Assert feature enhancer for assert function/object.
 *
 * https://github.com/twada/empower
 *
 * Copyright (c) 2013-2014 Takuto Wada
 * Licensed under the MIT license.
 *   https://raw.github.com/twada/empower/master/MIT-LICENSE.txt
 *
 * A part of extend function is:
 *   Copyright 2012 jQuery Foundation and other contributors
 *   Released under the MIT license.
 *   http://jquery.org/license
 */
(function (root, factory) {
    'use strict';

    // using returnExports UMD pattern
    if (typeof define === 'function' && define.amd) {
        define(factory);
    } else if (typeof exports === 'object') {
        module.exports = factory();
    } else {
        root.empower = factory();
    }
}(this, function () {
    'use strict';

    var isPhantom = typeof window !== 'undefined' && typeof window.callPhantom === 'function';

    function defaultOptions () {
        return {
            destructive: false,
            modifyMessageOnFail: false,
            saveContextOnFail: false,
            targetMethods: {
                oneArg: [
                    'ok'
                ],
                twoArgs: [
                    'equal',
                    'notEqual',
                    'strictEqual',
                    'notStrictEqual',
                    'deepEqual',
                    'notDeepEqual'
                ]
            }
        };
    }


    /**
     * Enhance Power Assert feature to assert function/object.
     * @param assert target assert function or object to enhance
     * @param formatter power assert format function
     * @param options enhancement options
     * @return enhanced assert function/object
     */
    function empower (assert, formatter, options) {
        var typeOfAssert = (typeof assert),
            config;
        if ((typeOfAssert !== 'object' && typeOfAssert !== 'function') || assert === null) {
            throw new TypeError('empower argument should be a function or object.');
        }
        if (isEmpowered(assert)) {
            return assert;
        }
        config = extend(defaultOptions(), (options || {}));
        switch (typeOfAssert) {
        case 'function':
            return empowerAssertFunction(assert, formatter, config);
        case 'object':
            return empowerAssertObject(assert, formatter, config);
        default:
            throw new Error('Cannot be here');
        }
    }


    function isEmpowered (assertObjectOrFunction) {
        return (typeof assertObjectOrFunction._capt === 'function') && (typeof assertObjectOrFunction._expr === 'function');
    }


    function empowerAssertObject (assertObject, formatter, config) {
        var enhancement = enhance(assertObject, formatter, config),
            target = config.destructive ? assertObject : Object.create(assertObject);
        return extend(target, enhancement);
    }


    function empowerAssertFunction (assertFunction, formatter, config) {
        if (config.destructive) {
            throw new Error('cannot use destructive:true to function.');
        }
        var enhancement = enhance(assertFunction, formatter, config),
            powerAssert = function powerAssert (context, message) {
                enhancement(context, message);
            };
        extend(powerAssert, assertFunction);
        return extend(powerAssert, enhancement);
    }


    function enhance (target, formatter, config) {
        var eagerEvaluation = !(config.modifyMessageOnFail || config.saveContextOnFail),
            doPowerAssert = function (baseAssert, args, message, context) {
                var f;
                if (eagerEvaluation) {
                    args.push(buildPowerAssertText(message, context));
                    return baseAssert.apply(target, args);
                }
                try {
                    args.push(message);
                    return baseAssert.apply(target, args);
                } catch (e) {
                    if (e.name !== 'AssertionError') {
                        throw e;
                    }
                    if (typeof target.AssertionError !== 'function') {
                        throw e;
                    }
                    if (isPhantom) {
                        f = new target.AssertionError({
                            actual: e.actual,
                            expected: e.expected,
                            operator: e.operator,
                            message: e.message
                        });
                    } else {
                        f = e;
                    }
                    if (config.modifyMessageOnFail) {
                        f.message = buildPowerAssertText(message, context);
                        if (typeof e.generatedMessage !== 'undefined') {
                            f.generatedMessage = false;
                        }
                    }
                    if (config.saveContextOnFail) {
                        f.powerAssertContext = context;
                    }
                    throw f;
                }
            },
            enhancement = (typeof target === 'function') ? decorateOneArg(target, target, doPowerAssert) : {},
            events = [];

        function buildPowerAssertText (message, context) {
            var powerAssertText = formatter(context);
            return message ? message + ' ' + powerAssertText : powerAssertText;
        }

        function _capt (value, kind, location) {
            events.push({value: value, kind: kind, location: location});
            return value;
        }

        function _expr (value, location, content) {
            var captured = events;
            events = [];
            return { powerAssertContext: {value: value, location: location, content: content, events: captured} };
        }

        config.targetMethods.oneArg.forEach(function (methodName) {
            if (typeof target[methodName] === 'function') {
                enhancement[methodName] = decorateOneArg(target, target[methodName], doPowerAssert);
            }
        });
        config.targetMethods.twoArgs.forEach(function (methodName) {
            if (typeof target[methodName] === 'function') {
                enhancement[methodName] = decorateTwoArgs(target, target[methodName], doPowerAssert);
            }
        });

        enhancement._capt = _capt;
        enhancement._expr = _expr;
        return enhancement;
    }


    function isEspoweredValue (value) {
        return (typeof value !== 'undefined') && (typeof value.powerAssertContext !== 'undefined');
    }


    function decorateOneArg (target, baseAssert, doPowerAssert) {
        return function (value, message) {
            var context;
            if (! isEspoweredValue(value)) {
                return baseAssert.apply(target, [value, message]);
            }
            context = value.powerAssertContext;
            return doPowerAssert(baseAssert, [context.value], message, context);
        };
    }


    function decorateTwoArgs (target, baseAssert, doPowerAssert) {
        return function (arg1, arg2, message) {
            var context, val1, val2;
            if (!(isEspoweredValue(arg1) || isEspoweredValue(arg2))) {
                return baseAssert.apply(target, [arg1, arg2, message]);
            }

            if (isEspoweredValue(arg1)) {
                context = extend({}, arg1.powerAssertContext);
                val1 = arg1.powerAssertContext.value;
            } else {
                val1 = arg1;
            }

            if (isEspoweredValue(arg2)) {
                if (isEspoweredValue(arg1)) {
                    context.events = context.events.concat(arg2.powerAssertContext.events);
                } else {
                    context = extend({}, arg2.powerAssertContext);
                }
                val2 = arg2.powerAssertContext.value;
            } else {
                val2 = arg2;
            }

            return doPowerAssert(baseAssert, [val1, val2], message, context);
        };
    }


    // borrowed from qunit.js
    function extend (a, b) {
        var prop;
        for (prop in b) {
            if (b.hasOwnProperty(prop)) {
                if (typeof b[prop] === 'undefined') {
                    delete a[prop];
                } else {
                    a[prop] = b[prop];
                }
            }
        }
        return a;
    }


    // using returnExports UMD pattern with substack pattern
    empower.defaultOptions = defaultOptions;
    return empower;
}));

},{}],8:[function(require,module,exports){
/**
 * power-assert-formatter.js - Power Assert output formatter
 *
 * https://github.com/twada/power-assert-formatter
 *
 * Copyright (c) 2013-2014 Takuto Wada
 * Licensed under the MIT license.
 *   https://raw.github.com/twada/power-assert-formatter/master/MIT-LICENSE.txt
 *
 * A part of extend function is:
 *   Copyright 2012 jQuery Foundation and other contributors
 *   Released under the MIT license.
 *   http://jquery.org/license
 */
(function (root, factory) {
    'use strict';

    // using returnExports UMD pattern
    if (typeof define === 'function' && define.amd) {
        define(factory);
    } else if (typeof exports === 'object') {
        module.exports = factory();
    } else {
        root.powerAssertFormatter = factory();
    }
}(this, function () {
    'use strict';


    function defaultOptions () {
        return {
            lineSeparator: '\n',
            dump: jsonDump,
            widthOf: multibyteStringWidthOf
        };
    }


    function PowerAssertContextRenderer (dump, widthOf, context) {
        this.dump = dump;
        this.widthOf = widthOf;
        this.initialVertivalBarLength = 1;
        this.initWithContext(context);
    }

    PowerAssertContextRenderer.prototype.initWithContext = function (context) {
        context.events.sort(rightToLeft);
        this.events = context.events;
        this.assertionLine = context.content;
        this.assertionLocation = context.location;
        this.rows = [];
        for (var i = 0; i <= this.initialVertivalBarLength; i += 1) {
            this.addOneMoreRow();
        }
    };

    PowerAssertContextRenderer.prototype.newRowFor = function (assertionLine) {
        return createRow(this.widthOf(assertionLine), ' ');
    };

    PowerAssertContextRenderer.prototype.addOneMoreRow = function () {
        this.rows.push(this.newRowFor(this.assertionLine));
    };

    PowerAssertContextRenderer.prototype.lastRow = function () {
        return this.rows[this.rows.length - 1];
    };

    PowerAssertContextRenderer.prototype.renderVerticalBarAt = function (columnIndex) {
        var i, lastRowIndex = this.rows.length - 1;
        for (i = 0; i < lastRowIndex; i += 1) {
            this.rows[i].splice(columnIndex, 1, '|');
        }
    };

    PowerAssertContextRenderer.prototype.renderValueAt = function (columnIndex, dumpedValue) {
        var i, width = this.widthOf(dumpedValue);
        for (i = 0; i < width; i += 1) {
            this.lastRow().splice(columnIndex + i, 1, dumpedValue.charAt(i));
        }
    };

    PowerAssertContextRenderer.prototype.isOverlapped = function (prevCapturing, nextCaputuring, dumpedValue) {
        return (typeof prevCapturing !== 'undefined') && this.startColumnFor(prevCapturing) <= (this.startColumnFor(nextCaputuring) + this.widthOf(dumpedValue));
    };

    PowerAssertContextRenderer.prototype.constructRows = function (capturedEvents) {
        var that = this,
            prevCaptured;
        capturedEvents.forEach(function (captured) {
            var dumpedValue = that.dump(captured.value);
            if (that.isOverlapped(prevCaptured, captured, dumpedValue)) {
                that.addOneMoreRow();
            }
            that.renderVerticalBarAt(that.startColumnFor(captured));
            that.renderValueAt(that.startColumnFor(captured), dumpedValue);
            prevCaptured = captured;
        });
    };

    PowerAssertContextRenderer.prototype.startColumnFor = function (captured) {
        return this.widthOf(this.assertionLine.slice(0, captured.location.start.column));
    };

    PowerAssertContextRenderer.prototype.renderLines = function () {
        var lines = [];
        this.constructRows(this.events);
        if (this.assertionLocation.path) {
            lines.push('# ' + [this.assertionLocation.path, this.assertionLocation.start.line].join(':'));
        } else {
            lines.push('# at line: ' + this.assertionLocation.start.line);
        }
        lines.push('');
        lines.push(this.assertionLine);
        this.rows.forEach(function (columns) {
            lines.push(columns.join(''));
        });
        lines.push('');
        return lines;
    };


    function createRow (numCols, initial) {
        var row = [], i;
        for(i = 0; i < numCols; i += 1) {
            row[i] = initial;
        }
        return row;
    }


    function rightToLeft (a, b) {
        return b.location.start.column - a.location.start.column;
    }


    function multibyteStringWidthOf (str) {
        var i, c, width = 0;
        for(i = 0; i < str.length; i+=1){
            c = str.charCodeAt(i);
            if ((0x0 <= c && c < 0x81) || (c === 0xf8f0) || (0xff61 <= c && c < 0xffa0) || (0xf8f1 <= c && c < 0xf8f4)) {
                width += 1;
            } else {
                width += 2;
            }
        }
        return width;
    }


    function jsonDump (obj) {
        var seen = [],
            replacer = function(key, val) {
                if (typeof val === 'object' && val) {
                    if (seen.indexOf(val) !== -1) {
                        return '#Circular#';
                    }
                    seen.push(val);
                }
                return val;
            },
            str = JSON.stringify(obj, replacer);
        if (typeof str === 'undefined') {
            return 'undefined';
        }
        return str;
    }


    // borrowed from qunit.js
    function extend (a, b) {
        var prop;
        for (prop in b) {
            if (b.hasOwnProperty(prop)) {
                if (typeof b[prop] === 'undefined') {
                    delete a[prop];
                } else {
                    a[prop] = b[prop];
                }
            }
        }
        return a;
    }


    function create (options) {
        var config = extend(defaultOptions(), (options || {}));
        return function (context) {
            var renderer = new PowerAssertContextRenderer(config.dump, config.widthOf, context);
            return renderer.renderLines().join(config.lineSeparator);
        };
    }

    create.PowerAssertContextRenderer = PowerAssertContextRenderer;
    return create;
}));

},{}],9:[function(require,module,exports){
var assert;
assert = require('power-assert');
describe('Array#indexOf()', function () {
    beforeEach(function () {
        return this.ary = [
            1,
            2,
            3
        ];
    });
    it('should return index when the value is present', function () {
        var minusOne, who;
        who = 'ariya';
        minusOne = -1;
        return assert(assert._expr(assert._capt(assert._capt(assert._capt(this.ary, 'left/callee/object').indexOf(assert._capt(who, 'left/arguments/0')), 'left') !== assert._capt(minusOne, 'right'), ''), {
            tree: {
                'type': 'BinaryExpression',
                'operator': '!==',
                'left': {
                    'type': 'CallExpression',
                    'callee': {
                        'type': 'MemberExpression',
                        'computed': false,
                        'object': {
                            'type': 'MemberExpression',
                            'computed': false,
                            'object': {
                                'type': 'ThisExpression',
                                'loc': {
                                    'start': {
                                        'line': 13,
                                        'column': 18
                                    },
                                    'end': {
                                        'line': 13,
                                        'column': 22
                                    },
                                    'source': '/Users/ken/work/nancle/test/test.coffee'
                                }
                            },
                            'property': {
                                'type': 'Identifier',
                                'name': 'ary',
                                'loc': {
                                    'start': {
                                        'line': 13,
                                        'column': 23
                                    },
                                    'end': {
                                        'line': 13,
                                        'column': 26
                                    },
                                    'source': '/Users/ken/work/nancle/test/test.coffee'
                                }
                            },
                            'loc': {
                                'start': {
                                    'line': 13,
                                    'column': 18
                                },
                                'end': {
                                    'line': 13,
                                    'column': 26
                                },
                                'source': '/Users/ken/work/nancle/test/test.coffee'
                            }
                        },
                        'property': {
                            'type': 'Identifier',
                            'name': 'indexOf',
                            'loc': {
                                'start': {
                                    'line': 13,
                                    'column': 27
                                },
                                'end': {
                                    'line': 13,
                                    'column': 34
                                },
                                'source': '/Users/ken/work/nancle/test/test.coffee'
                            }
                        },
                        'loc': {
                            'start': {
                                'line': 13,
                                'column': 18
                            },
                            'end': {
                                'line': 13,
                                'column': 34
                            },
                            'source': '/Users/ken/work/nancle/test/test.coffee'
                        }
                    },
                    'arguments': [{
                            'type': 'Identifier',
                            'name': 'who',
                            'loc': {
                                'start': {
                                    'line': 13,
                                    'column': 35
                                },
                                'end': {
                                    'line': 13,
                                    'column': 38
                                },
                                'source': '/Users/ken/work/nancle/test/test.coffee'
                            }
                        }],
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 18
                        },
                        'end': {
                            'line': 13,
                            'column': 39
                        },
                        'source': '/Users/ken/work/nancle/test/test.coffee'
                    }
                },
                'right': {
                    'type': 'Identifier',
                    'name': 'minusOne',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 44
                        },
                        'end': {
                            'line': 13,
                            'column': 52
                        },
                        'source': '/Users/ken/work/nancle/test/test.coffee'
                    }
                },
                'loc': {
                    'start': {
                        'line': 13,
                        'column': 18
                    },
                    'end': {
                        'line': 13,
                        'column': 52
                    },
                    'source': '/Users/ken/work/nancle/test/test.coffee'
                }
            },
            tokens: [
                {
                    'type': 'Keyword',
                    'value': 'this',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 18
                        },
                        'end': {
                            'line': 13,
                            'column': 22
                        }
                    }
                },
                {
                    'type': 'Punctuator',
                    'value': '.',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 22
                        },
                        'end': {
                            'line': 13,
                            'column': 23
                        }
                    }
                },
                {
                    'type': 'Identifier',
                    'value': 'ary',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 23
                        },
                        'end': {
                            'line': 13,
                            'column': 26
                        }
                    }
                },
                {
                    'type': 'Punctuator',
                    'value': '.',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 26
                        },
                        'end': {
                            'line': 13,
                            'column': 27
                        }
                    }
                },
                {
                    'type': 'Identifier',
                    'value': 'indexOf',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 27
                        },
                        'end': {
                            'line': 13,
                            'column': 34
                        }
                    }
                },
                {
                    'type': 'Punctuator',
                    'value': '(',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 34
                        },
                        'end': {
                            'line': 13,
                            'column': 35
                        }
                    }
                },
                {
                    'type': 'Identifier',
                    'value': 'who',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 35
                        },
                        'end': {
                            'line': 13,
                            'column': 38
                        }
                    }
                },
                {
                    'type': 'Punctuator',
                    'value': ')',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 38
                        },
                        'end': {
                            'line': 13,
                            'column': 39
                        }
                    }
                },
                {
                    'type': 'Punctuator',
                    'value': '!==',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 40
                        },
                        'end': {
                            'line': 13,
                            'column': 43
                        }
                    }
                },
                {
                    'type': 'Identifier',
                    'value': 'minusOne',
                    'loc': {
                        'start': {
                            'line': 13,
                            'column': 44
                        },
                        'end': {
                            'line': 13,
                            'column': 52
                        }
                    }
                }
            ],
            content: '    return assert(this.ary.indexOf(who) !== minusOne);',
            filepath: '/Users/ken/work/nancle/test/test.coffee'
        }));
    });
    return it('should return -1 when the value is not present', function () {
        var minusOne, two;
        minusOne = -1;
        two = 2;
        return assert.ok(assert._expr(assert._capt(assert._capt(assert._capt(this.ary, 'left/callee/object').indexOf(assert._capt(two, 'left/arguments/0')), 'left') === assert._capt(minusOne, 'right'), ''), {
            tree: {
                'type': 'BinaryExpression',
                'operator': '===',
                'left': {
                    'type': 'CallExpression',
                    'callee': {
                        'type': 'MemberExpression',
                        'computed': false,
                        'object': {
                            'type': 'MemberExpression',
                            'computed': false,
                            'object': {
                                'type': 'ThisExpression',
                                'loc': {
                                    'start': {
                                        'line': 19,
                                        'column': 21
                                    },
                                    'end': {
                                        'line': 19,
                                        'column': 25
                                    },
                                    'source': '/Users/ken/work/nancle/test/test.coffee'
                                }
                            },
                            'property': {
                                'type': 'Identifier',
                                'name': 'ary',
                                'loc': {
                                    'start': {
                                        'line': 19,
                                        'column': 26
                                    },
                                    'end': {
                                        'line': 19,
                                        'column': 29
                                    },
                                    'source': '/Users/ken/work/nancle/test/test.coffee'
                                }
                            },
                            'loc': {
                                'start': {
                                    'line': 19,
                                    'column': 21
                                },
                                'end': {
                                    'line': 19,
                                    'column': 29
                                },
                                'source': '/Users/ken/work/nancle/test/test.coffee'
                            }
                        },
                        'property': {
                            'type': 'Identifier',
                            'name': 'indexOf',
                            'loc': {
                                'start': {
                                    'line': 19,
                                    'column': 30
                                },
                                'end': {
                                    'line': 19,
                                    'column': 37
                                },
                                'source': '/Users/ken/work/nancle/test/test.coffee'
                            }
                        },
                        'loc': {
                            'start': {
                                'line': 19,
                                'column': 21
                            },
                            'end': {
                                'line': 19,
                                'column': 37
                            },
                            'source': '/Users/ken/work/nancle/test/test.coffee'
                        }
                    },
                    'arguments': [{
                            'type': 'Identifier',
                            'name': 'two',
                            'loc': {
                                'start': {
                                    'line': 19,
                                    'column': 38
                                },
                                'end': {
                                    'line': 19,
                                    'column': 41
                                },
                                'source': '/Users/ken/work/nancle/test/test.coffee'
                            }
                        }],
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 21
                        },
                        'end': {
                            'line': 19,
                            'column': 42
                        },
                        'source': '/Users/ken/work/nancle/test/test.coffee'
                    }
                },
                'right': {
                    'type': 'Identifier',
                    'name': 'minusOne',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 47
                        },
                        'end': {
                            'line': 19,
                            'column': 55
                        },
                        'source': '/Users/ken/work/nancle/test/test.coffee'
                    }
                },
                'loc': {
                    'start': {
                        'line': 19,
                        'column': 21
                    },
                    'end': {
                        'line': 19,
                        'column': 55
                    },
                    'source': '/Users/ken/work/nancle/test/test.coffee'
                }
            },
            tokens: [
                {
                    'type': 'Keyword',
                    'value': 'this',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 21
                        },
                        'end': {
                            'line': 19,
                            'column': 25
                        }
                    }
                },
                {
                    'type': 'Punctuator',
                    'value': '.',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 25
                        },
                        'end': {
                            'line': 19,
                            'column': 26
                        }
                    }
                },
                {
                    'type': 'Identifier',
                    'value': 'ary',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 26
                        },
                        'end': {
                            'line': 19,
                            'column': 29
                        }
                    }
                },
                {
                    'type': 'Punctuator',
                    'value': '.',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 29
                        },
                        'end': {
                            'line': 19,
                            'column': 30
                        }
                    }
                },
                {
                    'type': 'Identifier',
                    'value': 'indexOf',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 30
                        },
                        'end': {
                            'line': 19,
                            'column': 37
                        }
                    }
                },
                {
                    'type': 'Punctuator',
                    'value': '(',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 37
                        },
                        'end': {
                            'line': 19,
                            'column': 38
                        }
                    }
                },
                {
                    'type': 'Identifier',
                    'value': 'two',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 38
                        },
                        'end': {
                            'line': 19,
                            'column': 41
                        }
                    }
                },
                {
                    'type': 'Punctuator',
                    'value': ')',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 41
                        },
                        'end': {
                            'line': 19,
                            'column': 42
                        }
                    }
                },
                {
                    'type': 'Punctuator',
                    'value': '===',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 43
                        },
                        'end': {
                            'line': 19,
                            'column': 46
                        }
                    }
                },
                {
                    'type': 'Identifier',
                    'value': 'minusOne',
                    'loc': {
                        'start': {
                            'line': 19,
                            'column': 47
                        },
                        'end': {
                            'line': 19,
                            'column': 55
                        }
                    }
                }
            ],
            content: '    return assert.ok(this.ary.indexOf(two) === minusOne, \'THIS IS AN ASSERTION MESSAGE\');',
            filepath: '/Users/ken/work/nancle/test/test.coffee'
        }), 'THIS IS AN ASSERTION MESSAGE');
    });
});


},{"power-assert":6}]},{},[9])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlcyI6WyIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYXNzZXJ0L2Fzc2VydC5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYXNzZXJ0L25vZGVfbW9kdWxlcy91dGlsL3N1cHBvcnQvaXNCdWZmZXJCcm93c2VyLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9hc3NlcnQvbm9kZV9tb2R1bGVzL3V0aWwvdXRpbC5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvaW5oZXJpdHMvaW5oZXJpdHNfYnJvd3Nlci5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvaW5zZXJ0LW1vZHVsZS1nbG9iYWxzL25vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy9wb3dlci1hc3NlcnQvbGliL3Bvd2VyLWFzc2VydC5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Bvd2VyLWFzc2VydC9ub2RlX21vZHVsZXMvZW1wb3dlci9saWIvZW1wb3dlci5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Bvd2VyLWFzc2VydC9ub2RlX21vZHVsZXMvcG93ZXItYXNzZXJ0LWZvcm1hdHRlci9saWIvcG93ZXItYXNzZXJ0LWZvcm1hdHRlci5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvdGVzdC90ZXN0LmNvZmZlZSJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hXQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNWtCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpfXZhciBmPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChmLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGYsZi5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvLyBodHRwOi8vd2lraS5jb21tb25qcy5vcmcvd2lraS9Vbml0X1Rlc3RpbmcvMS4wXG4vL1xuLy8gVEhJUyBJUyBOT1QgVEVTVEVEIE5PUiBMSUtFTFkgVE8gV09SSyBPVVRTSURFIFY4IVxuLy9cbi8vIE9yaWdpbmFsbHkgZnJvbSBuYXJ3aGFsLmpzIChodHRwOi8vbmFyd2hhbGpzLm9yZylcbi8vIENvcHlyaWdodCAoYykgMjAwOSBUaG9tYXMgUm9iaW5zb24gPDI4MG5vcnRoLmNvbT5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4vLyBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSAnU29mdHdhcmUnKSwgdG9cbi8vIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlXG4vLyByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Jcbi8vIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4vLyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG4vLyBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgJ0FTIElTJywgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuLy8gSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4vLyBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbi8vIEFVVEhPUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOXG4vLyBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OXG4vLyBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuLy8gd2hlbiB1c2VkIGluIG5vZGUsIHRoaXMgd2lsbCBhY3R1YWxseSBsb2FkIHRoZSB1dGlsIG1vZHVsZSB3ZSBkZXBlbmQgb25cbi8vIHZlcnN1cyBsb2FkaW5nIHRoZSBidWlsdGluIHV0aWwgbW9kdWxlIGFzIGhhcHBlbnMgb3RoZXJ3aXNlXG4vLyB0aGlzIGlzIGEgYnVnIGluIG5vZGUgbW9kdWxlIGxvYWRpbmcgYXMgZmFyIGFzIEkgYW0gY29uY2VybmVkXG52YXIgdXRpbCA9IHJlcXVpcmUoJ3V0aWwvJyk7XG5cbnZhciBwU2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG52YXIgaGFzT3duID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcblxuLy8gMS4gVGhlIGFzc2VydCBtb2R1bGUgcHJvdmlkZXMgZnVuY3Rpb25zIHRoYXQgdGhyb3dcbi8vIEFzc2VydGlvbkVycm9yJ3Mgd2hlbiBwYXJ0aWN1bGFyIGNvbmRpdGlvbnMgYXJlIG5vdCBtZXQuIFRoZVxuLy8gYXNzZXJ0IG1vZHVsZSBtdXN0IGNvbmZvcm0gdG8gdGhlIGZvbGxvd2luZyBpbnRlcmZhY2UuXG5cbnZhciBhc3NlcnQgPSBtb2R1bGUuZXhwb3J0cyA9IG9rO1xuXG4vLyAyLiBUaGUgQXNzZXJ0aW9uRXJyb3IgaXMgZGVmaW5lZCBpbiBhc3NlcnQuXG4vLyBuZXcgYXNzZXJ0LkFzc2VydGlvbkVycm9yKHsgbWVzc2FnZTogbWVzc2FnZSxcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3R1YWw6IGFjdHVhbCxcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogZXhwZWN0ZWQgfSlcblxuYXNzZXJ0LkFzc2VydGlvbkVycm9yID0gZnVuY3Rpb24gQXNzZXJ0aW9uRXJyb3Iob3B0aW9ucykge1xuICB0aGlzLm5hbWUgPSAnQXNzZXJ0aW9uRXJyb3InO1xuICB0aGlzLmFjdHVhbCA9IG9wdGlvbnMuYWN0dWFsO1xuICB0aGlzLmV4cGVjdGVkID0gb3B0aW9ucy5leHBlY3RlZDtcbiAgdGhpcy5vcGVyYXRvciA9IG9wdGlvbnMub3BlcmF0b3I7XG4gIGlmIChvcHRpb25zLm1lc3NhZ2UpIHtcbiAgICB0aGlzLm1lc3NhZ2UgPSBvcHRpb25zLm1lc3NhZ2U7XG4gICAgdGhpcy5nZW5lcmF0ZWRNZXNzYWdlID0gZmFsc2U7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5tZXNzYWdlID0gZ2V0TWVzc2FnZSh0aGlzKTtcbiAgICB0aGlzLmdlbmVyYXRlZE1lc3NhZ2UgPSB0cnVlO1xuICB9XG4gIHZhciBzdGFja1N0YXJ0RnVuY3Rpb24gPSBvcHRpb25zLnN0YWNrU3RhcnRGdW5jdGlvbiB8fCBmYWlsO1xuXG4gIGlmIChFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSkge1xuICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHRoaXMsIHN0YWNrU3RhcnRGdW5jdGlvbik7XG4gIH1cbiAgZWxzZSB7XG4gICAgLy8gbm9uIHY4IGJyb3dzZXJzIHNvIHdlIGNhbiBoYXZlIGEgc3RhY2t0cmFjZVxuICAgIHZhciBlcnIgPSBuZXcgRXJyb3IoKTtcbiAgICBpZiAoZXJyLnN0YWNrKSB7XG4gICAgICB2YXIgb3V0ID0gZXJyLnN0YWNrO1xuXG4gICAgICAvLyB0cnkgdG8gc3RyaXAgdXNlbGVzcyBmcmFtZXNcbiAgICAgIHZhciBmbl9uYW1lID0gc3RhY2tTdGFydEZ1bmN0aW9uLm5hbWU7XG4gICAgICB2YXIgaWR4ID0gb3V0LmluZGV4T2YoJ1xcbicgKyBmbl9uYW1lKTtcbiAgICAgIGlmIChpZHggPj0gMCkge1xuICAgICAgICAvLyBvbmNlIHdlIGhhdmUgbG9jYXRlZCB0aGUgZnVuY3Rpb24gZnJhbWVcbiAgICAgICAgLy8gd2UgbmVlZCB0byBzdHJpcCBvdXQgZXZlcnl0aGluZyBiZWZvcmUgaXQgKGFuZCBpdHMgbGluZSlcbiAgICAgICAgdmFyIG5leHRfbGluZSA9IG91dC5pbmRleE9mKCdcXG4nLCBpZHggKyAxKTtcbiAgICAgICAgb3V0ID0gb3V0LnN1YnN0cmluZyhuZXh0X2xpbmUgKyAxKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5zdGFjayA9IG91dDtcbiAgICB9XG4gIH1cbn07XG5cbi8vIGFzc2VydC5Bc3NlcnRpb25FcnJvciBpbnN0YW5jZW9mIEVycm9yXG51dGlsLmluaGVyaXRzKGFzc2VydC5Bc3NlcnRpb25FcnJvciwgRXJyb3IpO1xuXG5mdW5jdGlvbiByZXBsYWNlcihrZXksIHZhbHVlKSB7XG4gIGlmICh1dGlsLmlzVW5kZWZpbmVkKHZhbHVlKSkge1xuICAgIHJldHVybiAnJyArIHZhbHVlO1xuICB9XG4gIGlmICh1dGlsLmlzTnVtYmVyKHZhbHVlKSAmJiAoaXNOYU4odmFsdWUpIHx8ICFpc0Zpbml0ZSh2YWx1ZSkpKSB7XG4gICAgcmV0dXJuIHZhbHVlLnRvU3RyaW5nKCk7XG4gIH1cbiAgaWYgKHV0aWwuaXNGdW5jdGlvbih2YWx1ZSkgfHwgdXRpbC5pc1JlZ0V4cCh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUudG9TdHJpbmcoKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHRydW5jYXRlKHMsIG4pIHtcbiAgaWYgKHV0aWwuaXNTdHJpbmcocykpIHtcbiAgICByZXR1cm4gcy5sZW5ndGggPCBuID8gcyA6IHMuc2xpY2UoMCwgbik7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHM7XG4gIH1cbn1cblxuZnVuY3Rpb24gZ2V0TWVzc2FnZShzZWxmKSB7XG4gIHJldHVybiB0cnVuY2F0ZShKU09OLnN0cmluZ2lmeShzZWxmLmFjdHVhbCwgcmVwbGFjZXIpLCAxMjgpICsgJyAnICtcbiAgICAgICAgIHNlbGYub3BlcmF0b3IgKyAnICcgK1xuICAgICAgICAgdHJ1bmNhdGUoSlNPTi5zdHJpbmdpZnkoc2VsZi5leHBlY3RlZCwgcmVwbGFjZXIpLCAxMjgpO1xufVxuXG4vLyBBdCBwcmVzZW50IG9ubHkgdGhlIHRocmVlIGtleXMgbWVudGlvbmVkIGFib3ZlIGFyZSB1c2VkIGFuZFxuLy8gdW5kZXJzdG9vZCBieSB0aGUgc3BlYy4gSW1wbGVtZW50YXRpb25zIG9yIHN1YiBtb2R1bGVzIGNhbiBwYXNzXG4vLyBvdGhlciBrZXlzIHRvIHRoZSBBc3NlcnRpb25FcnJvcidzIGNvbnN0cnVjdG9yIC0gdGhleSB3aWxsIGJlXG4vLyBpZ25vcmVkLlxuXG4vLyAzLiBBbGwgb2YgdGhlIGZvbGxvd2luZyBmdW5jdGlvbnMgbXVzdCB0aHJvdyBhbiBBc3NlcnRpb25FcnJvclxuLy8gd2hlbiBhIGNvcnJlc3BvbmRpbmcgY29uZGl0aW9uIGlzIG5vdCBtZXQsIHdpdGggYSBtZXNzYWdlIHRoYXRcbi8vIG1heSBiZSB1bmRlZmluZWQgaWYgbm90IHByb3ZpZGVkLiAgQWxsIGFzc2VydGlvbiBtZXRob2RzIHByb3ZpZGVcbi8vIGJvdGggdGhlIGFjdHVhbCBhbmQgZXhwZWN0ZWQgdmFsdWVzIHRvIHRoZSBhc3NlcnRpb24gZXJyb3IgZm9yXG4vLyBkaXNwbGF5IHB1cnBvc2VzLlxuXG5mdW5jdGlvbiBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UsIG9wZXJhdG9yLCBzdGFja1N0YXJ0RnVuY3Rpb24pIHtcbiAgdGhyb3cgbmV3IGFzc2VydC5Bc3NlcnRpb25FcnJvcih7XG4gICAgbWVzc2FnZTogbWVzc2FnZSxcbiAgICBhY3R1YWw6IGFjdHVhbCxcbiAgICBleHBlY3RlZDogZXhwZWN0ZWQsXG4gICAgb3BlcmF0b3I6IG9wZXJhdG9yLFxuICAgIHN0YWNrU3RhcnRGdW5jdGlvbjogc3RhY2tTdGFydEZ1bmN0aW9uXG4gIH0pO1xufVxuXG4vLyBFWFRFTlNJT04hIGFsbG93cyBmb3Igd2VsbCBiZWhhdmVkIGVycm9ycyBkZWZpbmVkIGVsc2V3aGVyZS5cbmFzc2VydC5mYWlsID0gZmFpbDtcblxuLy8gNC4gUHVyZSBhc3NlcnRpb24gdGVzdHMgd2hldGhlciBhIHZhbHVlIGlzIHRydXRoeSwgYXMgZGV0ZXJtaW5lZFxuLy8gYnkgISFndWFyZC5cbi8vIGFzc2VydC5vayhndWFyZCwgbWVzc2FnZV9vcHQpO1xuLy8gVGhpcyBzdGF0ZW1lbnQgaXMgZXF1aXZhbGVudCB0byBhc3NlcnQuZXF1YWwodHJ1ZSwgISFndWFyZCxcbi8vIG1lc3NhZ2Vfb3B0KTsuIFRvIHRlc3Qgc3RyaWN0bHkgZm9yIHRoZSB2YWx1ZSB0cnVlLCB1c2Vcbi8vIGFzc2VydC5zdHJpY3RFcXVhbCh0cnVlLCBndWFyZCwgbWVzc2FnZV9vcHQpOy5cblxuZnVuY3Rpb24gb2sodmFsdWUsIG1lc3NhZ2UpIHtcbiAgaWYgKCF2YWx1ZSkgZmFpbCh2YWx1ZSwgdHJ1ZSwgbWVzc2FnZSwgJz09JywgYXNzZXJ0Lm9rKTtcbn1cbmFzc2VydC5vayA9IG9rO1xuXG4vLyA1LiBUaGUgZXF1YWxpdHkgYXNzZXJ0aW9uIHRlc3RzIHNoYWxsb3csIGNvZXJjaXZlIGVxdWFsaXR5IHdpdGhcbi8vID09LlxuLy8gYXNzZXJ0LmVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2Vfb3B0KTtcblxuYXNzZXJ0LmVxdWFsID0gZnVuY3Rpb24gZXF1YWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSkge1xuICBpZiAoYWN0dWFsICE9IGV4cGVjdGVkKSBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UsICc9PScsIGFzc2VydC5lcXVhbCk7XG59O1xuXG4vLyA2LiBUaGUgbm9uLWVxdWFsaXR5IGFzc2VydGlvbiB0ZXN0cyBmb3Igd2hldGhlciB0d28gb2JqZWN0cyBhcmUgbm90IGVxdWFsXG4vLyB3aXRoICE9IGFzc2VydC5ub3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlX29wdCk7XG5cbmFzc2VydC5ub3RFcXVhbCA9IGZ1bmN0aW9uIG5vdEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UpIHtcbiAgaWYgKGFjdHVhbCA9PSBleHBlY3RlZCkge1xuICAgIGZhaWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSwgJyE9JywgYXNzZXJ0Lm5vdEVxdWFsKTtcbiAgfVxufTtcblxuLy8gNy4gVGhlIGVxdWl2YWxlbmNlIGFzc2VydGlvbiB0ZXN0cyBhIGRlZXAgZXF1YWxpdHkgcmVsYXRpb24uXG4vLyBhc3NlcnQuZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2Vfb3B0KTtcblxuYXNzZXJ0LmRlZXBFcXVhbCA9IGZ1bmN0aW9uIGRlZXBFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIGlmICghX2RlZXBFcXVhbChhY3R1YWwsIGV4cGVjdGVkKSkge1xuICAgIGZhaWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSwgJ2RlZXBFcXVhbCcsIGFzc2VydC5kZWVwRXF1YWwpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBfZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQpIHtcbiAgLy8gNy4xLiBBbGwgaWRlbnRpY2FsIHZhbHVlcyBhcmUgZXF1aXZhbGVudCwgYXMgZGV0ZXJtaW5lZCBieSA9PT0uXG4gIGlmIChhY3R1YWwgPT09IGV4cGVjdGVkKSB7XG4gICAgcmV0dXJuIHRydWU7XG5cbiAgfSBlbHNlIGlmICh1dGlsLmlzQnVmZmVyKGFjdHVhbCkgJiYgdXRpbC5pc0J1ZmZlcihleHBlY3RlZCkpIHtcbiAgICBpZiAoYWN0dWFsLmxlbmd0aCAhPSBleHBlY3RlZC5sZW5ndGgpIHJldHVybiBmYWxzZTtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYWN0dWFsLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYWN0dWFsW2ldICE9PSBleHBlY3RlZFtpXSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xuXG4gIC8vIDcuMi4gSWYgdGhlIGV4cGVjdGVkIHZhbHVlIGlzIGEgRGF0ZSBvYmplY3QsIHRoZSBhY3R1YWwgdmFsdWUgaXNcbiAgLy8gZXF1aXZhbGVudCBpZiBpdCBpcyBhbHNvIGEgRGF0ZSBvYmplY3QgdGhhdCByZWZlcnMgdG8gdGhlIHNhbWUgdGltZS5cbiAgfSBlbHNlIGlmICh1dGlsLmlzRGF0ZShhY3R1YWwpICYmIHV0aWwuaXNEYXRlKGV4cGVjdGVkKSkge1xuICAgIHJldHVybiBhY3R1YWwuZ2V0VGltZSgpID09PSBleHBlY3RlZC5nZXRUaW1lKCk7XG5cbiAgLy8gNy4zIElmIHRoZSBleHBlY3RlZCB2YWx1ZSBpcyBhIFJlZ0V4cCBvYmplY3QsIHRoZSBhY3R1YWwgdmFsdWUgaXNcbiAgLy8gZXF1aXZhbGVudCBpZiBpdCBpcyBhbHNvIGEgUmVnRXhwIG9iamVjdCB3aXRoIHRoZSBzYW1lIHNvdXJjZSBhbmRcbiAgLy8gcHJvcGVydGllcyAoYGdsb2JhbGAsIGBtdWx0aWxpbmVgLCBgbGFzdEluZGV4YCwgYGlnbm9yZUNhc2VgKS5cbiAgfSBlbHNlIGlmICh1dGlsLmlzUmVnRXhwKGFjdHVhbCkgJiYgdXRpbC5pc1JlZ0V4cChleHBlY3RlZCkpIHtcbiAgICByZXR1cm4gYWN0dWFsLnNvdXJjZSA9PT0gZXhwZWN0ZWQuc291cmNlICYmXG4gICAgICAgICAgIGFjdHVhbC5nbG9iYWwgPT09IGV4cGVjdGVkLmdsb2JhbCAmJlxuICAgICAgICAgICBhY3R1YWwubXVsdGlsaW5lID09PSBleHBlY3RlZC5tdWx0aWxpbmUgJiZcbiAgICAgICAgICAgYWN0dWFsLmxhc3RJbmRleCA9PT0gZXhwZWN0ZWQubGFzdEluZGV4ICYmXG4gICAgICAgICAgIGFjdHVhbC5pZ25vcmVDYXNlID09PSBleHBlY3RlZC5pZ25vcmVDYXNlO1xuXG4gIC8vIDcuNC4gT3RoZXIgcGFpcnMgdGhhdCBkbyBub3QgYm90aCBwYXNzIHR5cGVvZiB2YWx1ZSA9PSAnb2JqZWN0JyxcbiAgLy8gZXF1aXZhbGVuY2UgaXMgZGV0ZXJtaW5lZCBieSA9PS5cbiAgfSBlbHNlIGlmICghdXRpbC5pc09iamVjdChhY3R1YWwpICYmICF1dGlsLmlzT2JqZWN0KGV4cGVjdGVkKSkge1xuICAgIHJldHVybiBhY3R1YWwgPT0gZXhwZWN0ZWQ7XG5cbiAgLy8gNy41IEZvciBhbGwgb3RoZXIgT2JqZWN0IHBhaXJzLCBpbmNsdWRpbmcgQXJyYXkgb2JqZWN0cywgZXF1aXZhbGVuY2UgaXNcbiAgLy8gZGV0ZXJtaW5lZCBieSBoYXZpbmcgdGhlIHNhbWUgbnVtYmVyIG9mIG93bmVkIHByb3BlcnRpZXMgKGFzIHZlcmlmaWVkXG4gIC8vIHdpdGggT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKSwgdGhlIHNhbWUgc2V0IG9mIGtleXNcbiAgLy8gKGFsdGhvdWdoIG5vdCBuZWNlc3NhcmlseSB0aGUgc2FtZSBvcmRlciksIGVxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeVxuICAvLyBjb3JyZXNwb25kaW5nIGtleSwgYW5kIGFuIGlkZW50aWNhbCAncHJvdG90eXBlJyBwcm9wZXJ0eS4gTm90ZTogdGhpc1xuICAvLyBhY2NvdW50cyBmb3IgYm90aCBuYW1lZCBhbmQgaW5kZXhlZCBwcm9wZXJ0aWVzIG9uIEFycmF5cy5cbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gb2JqRXF1aXYoYWN0dWFsLCBleHBlY3RlZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNBcmd1bWVudHMob2JqZWN0KSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqZWN0KSA9PSAnW29iamVjdCBBcmd1bWVudHNdJztcbn1cblxuZnVuY3Rpb24gb2JqRXF1aXYoYSwgYikge1xuICBpZiAodXRpbC5pc051bGxPclVuZGVmaW5lZChhKSB8fCB1dGlsLmlzTnVsbE9yVW5kZWZpbmVkKGIpKVxuICAgIHJldHVybiBmYWxzZTtcbiAgLy8gYW4gaWRlbnRpY2FsICdwcm90b3R5cGUnIHByb3BlcnR5LlxuICBpZiAoYS5wcm90b3R5cGUgIT09IGIucHJvdG90eXBlKSByZXR1cm4gZmFsc2U7XG4gIC8vfn5+SSd2ZSBtYW5hZ2VkIHRvIGJyZWFrIE9iamVjdC5rZXlzIHRocm91Z2ggc2NyZXd5IGFyZ3VtZW50cyBwYXNzaW5nLlxuICAvLyAgIENvbnZlcnRpbmcgdG8gYXJyYXkgc29sdmVzIHRoZSBwcm9ibGVtLlxuICBpZiAoaXNBcmd1bWVudHMoYSkpIHtcbiAgICBpZiAoIWlzQXJndW1lbnRzKGIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGEgPSBwU2xpY2UuY2FsbChhKTtcbiAgICBiID0gcFNsaWNlLmNhbGwoYik7XG4gICAgcmV0dXJuIF9kZWVwRXF1YWwoYSwgYik7XG4gIH1cbiAgdHJ5IHtcbiAgICB2YXIga2EgPSBvYmplY3RLZXlzKGEpLFxuICAgICAgICBrYiA9IG9iamVjdEtleXMoYiksXG4gICAgICAgIGtleSwgaTtcbiAgfSBjYXRjaCAoZSkgey8vaGFwcGVucyB3aGVuIG9uZSBpcyBhIHN0cmluZyBsaXRlcmFsIGFuZCB0aGUgb3RoZXIgaXNuJ3RcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy8gaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChrZXlzIGluY29ycG9yYXRlc1xuICAvLyBoYXNPd25Qcm9wZXJ0eSlcbiAgaWYgKGthLmxlbmd0aCAhPSBrYi5sZW5ndGgpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvL3RoZSBzYW1lIHNldCBvZiBrZXlzIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLFxuICBrYS5zb3J0KCk7XG4gIGtiLnNvcnQoKTtcbiAgLy9+fn5jaGVhcCBrZXkgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmIChrYVtpXSAhPSBrYltpXSlcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvL2VxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeSBjb3JyZXNwb25kaW5nIGtleSwgYW5kXG4gIC8vfn5+cG9zc2libHkgZXhwZW5zaXZlIGRlZXAgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghX2RlZXBFcXVhbChhW2tleV0sIGJba2V5XSkpIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gOC4gVGhlIG5vbi1lcXVpdmFsZW5jZSBhc3NlcnRpb24gdGVzdHMgZm9yIGFueSBkZWVwIGluZXF1YWxpdHkuXG4vLyBhc3NlcnQubm90RGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2Vfb3B0KTtcblxuYXNzZXJ0Lm5vdERlZXBFcXVhbCA9IGZ1bmN0aW9uIG5vdERlZXBFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIGlmIChfZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQpKSB7XG4gICAgZmFpbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlLCAnbm90RGVlcEVxdWFsJywgYXNzZXJ0Lm5vdERlZXBFcXVhbCk7XG4gIH1cbn07XG5cbi8vIDkuIFRoZSBzdHJpY3QgZXF1YWxpdHkgYXNzZXJ0aW9uIHRlc3RzIHN0cmljdCBlcXVhbGl0eSwgYXMgZGV0ZXJtaW5lZCBieSA9PT0uXG4vLyBhc3NlcnQuc3RyaWN0RXF1YWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZV9vcHQpO1xuXG5hc3NlcnQuc3RyaWN0RXF1YWwgPSBmdW5jdGlvbiBzdHJpY3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIGlmIChhY3R1YWwgIT09IGV4cGVjdGVkKSB7XG4gICAgZmFpbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlLCAnPT09JywgYXNzZXJ0LnN0cmljdEVxdWFsKTtcbiAgfVxufTtcblxuLy8gMTAuIFRoZSBzdHJpY3Qgbm9uLWVxdWFsaXR5IGFzc2VydGlvbiB0ZXN0cyBmb3Igc3RyaWN0IGluZXF1YWxpdHksIGFzXG4vLyBkZXRlcm1pbmVkIGJ5ICE9PS4gIGFzc2VydC5ub3RTdHJpY3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlX29wdCk7XG5cbmFzc2VydC5ub3RTdHJpY3RFcXVhbCA9IGZ1bmN0aW9uIG5vdFN0cmljdEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UpIHtcbiAgaWYgKGFjdHVhbCA9PT0gZXhwZWN0ZWQpIHtcbiAgICBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UsICchPT0nLCBhc3NlcnQubm90U3RyaWN0RXF1YWwpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBleHBlY3RlZEV4Y2VwdGlvbihhY3R1YWwsIGV4cGVjdGVkKSB7XG4gIGlmICghYWN0dWFsIHx8ICFleHBlY3RlZCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoZXhwZWN0ZWQpID09ICdbb2JqZWN0IFJlZ0V4cF0nKSB7XG4gICAgcmV0dXJuIGV4cGVjdGVkLnRlc3QoYWN0dWFsKTtcbiAgfSBlbHNlIGlmIChhY3R1YWwgaW5zdGFuY2VvZiBleHBlY3RlZCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9IGVsc2UgaWYgKGV4cGVjdGVkLmNhbGwoe30sIGFjdHVhbCkgPT09IHRydWUpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gX3Rocm93cyhzaG91bGRUaHJvdywgYmxvY2ssIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIHZhciBhY3R1YWw7XG5cbiAgaWYgKHV0aWwuaXNTdHJpbmcoZXhwZWN0ZWQpKSB7XG4gICAgbWVzc2FnZSA9IGV4cGVjdGVkO1xuICAgIGV4cGVjdGVkID0gbnVsbDtcbiAgfVxuXG4gIHRyeSB7XG4gICAgYmxvY2soKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFjdHVhbCA9IGU7XG4gIH1cblxuICBtZXNzYWdlID0gKGV4cGVjdGVkICYmIGV4cGVjdGVkLm5hbWUgPyAnICgnICsgZXhwZWN0ZWQubmFtZSArICcpLicgOiAnLicpICtcbiAgICAgICAgICAgIChtZXNzYWdlID8gJyAnICsgbWVzc2FnZSA6ICcuJyk7XG5cbiAgaWYgKHNob3VsZFRocm93ICYmICFhY3R1YWwpIHtcbiAgICBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsICdNaXNzaW5nIGV4cGVjdGVkIGV4Y2VwdGlvbicgKyBtZXNzYWdlKTtcbiAgfVxuXG4gIGlmICghc2hvdWxkVGhyb3cgJiYgZXhwZWN0ZWRFeGNlcHRpb24oYWN0dWFsLCBleHBlY3RlZCkpIHtcbiAgICBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsICdHb3QgdW53YW50ZWQgZXhjZXB0aW9uJyArIG1lc3NhZ2UpO1xuICB9XG5cbiAgaWYgKChzaG91bGRUaHJvdyAmJiBhY3R1YWwgJiYgZXhwZWN0ZWQgJiZcbiAgICAgICFleHBlY3RlZEV4Y2VwdGlvbihhY3R1YWwsIGV4cGVjdGVkKSkgfHwgKCFzaG91bGRUaHJvdyAmJiBhY3R1YWwpKSB7XG4gICAgdGhyb3cgYWN0dWFsO1xuICB9XG59XG5cbi8vIDExLiBFeHBlY3RlZCB0byB0aHJvdyBhbiBlcnJvcjpcbi8vIGFzc2VydC50aHJvd3MoYmxvY2ssIEVycm9yX29wdCwgbWVzc2FnZV9vcHQpO1xuXG5hc3NlcnQudGhyb3dzID0gZnVuY3Rpb24oYmxvY2ssIC8qb3B0aW9uYWwqL2Vycm9yLCAvKm9wdGlvbmFsKi9tZXNzYWdlKSB7XG4gIF90aHJvd3MuYXBwbHkodGhpcywgW3RydWVdLmNvbmNhdChwU2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG59O1xuXG4vLyBFWFRFTlNJT04hIFRoaXMgaXMgYW5ub3lpbmcgdG8gd3JpdGUgb3V0c2lkZSB0aGlzIG1vZHVsZS5cbmFzc2VydC5kb2VzTm90VGhyb3cgPSBmdW5jdGlvbihibG9jaywgLypvcHRpb25hbCovbWVzc2FnZSkge1xuICBfdGhyb3dzLmFwcGx5KHRoaXMsIFtmYWxzZV0uY29uY2F0KHBTbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbn07XG5cbmFzc2VydC5pZkVycm9yID0gZnVuY3Rpb24oZXJyKSB7IGlmIChlcnIpIHt0aHJvdyBlcnI7fX07XG5cbnZhciBvYmplY3RLZXlzID0gT2JqZWN0LmtleXMgfHwgZnVuY3Rpb24gKG9iaikge1xuICB2YXIga2V5cyA9IFtdO1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgaWYgKGhhc093bi5jYWxsKG9iaiwga2V5KSkga2V5cy5wdXNoKGtleSk7XG4gIH1cbiAgcmV0dXJuIGtleXM7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpc0J1ZmZlcihhcmcpIHtcbiAgcmV0dXJuIGFyZyAmJiB0eXBlb2YgYXJnID09PSAnb2JqZWN0J1xuICAgICYmIHR5cGVvZiBhcmcuY29weSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICYmIHR5cGVvZiBhcmcuZmlsbCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICYmIHR5cGVvZiBhcmcucmVhZFVJbnQ4ID09PSAnZnVuY3Rpb24nO1xufSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwpe1xuLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbnZhciBmb3JtYXRSZWdFeHAgPSAvJVtzZGolXS9nO1xuZXhwb3J0cy5mb3JtYXQgPSBmdW5jdGlvbihmKSB7XG4gIGlmICghaXNTdHJpbmcoZikpIHtcbiAgICB2YXIgb2JqZWN0cyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBvYmplY3RzLnB1c2goaW5zcGVjdChhcmd1bWVudHNbaV0pKTtcbiAgICB9XG4gICAgcmV0dXJuIG9iamVjdHMuam9pbignICcpO1xuICB9XG5cbiAgdmFyIGkgPSAxO1xuICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgdmFyIGxlbiA9IGFyZ3MubGVuZ3RoO1xuICB2YXIgc3RyID0gU3RyaW5nKGYpLnJlcGxhY2UoZm9ybWF0UmVnRXhwLCBmdW5jdGlvbih4KSB7XG4gICAgaWYgKHggPT09ICclJScpIHJldHVybiAnJSc7XG4gICAgaWYgKGkgPj0gbGVuKSByZXR1cm4geDtcbiAgICBzd2l0Y2ggKHgpIHtcbiAgICAgIGNhc2UgJyVzJzogcmV0dXJuIFN0cmluZyhhcmdzW2krK10pO1xuICAgICAgY2FzZSAnJWQnOiByZXR1cm4gTnVtYmVyKGFyZ3NbaSsrXSk7XG4gICAgICBjYXNlICclaic6XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGFyZ3NbaSsrXSk7XG4gICAgICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgICAgICByZXR1cm4gJ1tDaXJjdWxhcl0nO1xuICAgICAgICB9XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4geDtcbiAgICB9XG4gIH0pO1xuICBmb3IgKHZhciB4ID0gYXJnc1tpXTsgaSA8IGxlbjsgeCA9IGFyZ3NbKytpXSkge1xuICAgIGlmIChpc051bGwoeCkgfHwgIWlzT2JqZWN0KHgpKSB7XG4gICAgICBzdHIgKz0gJyAnICsgeDtcbiAgICB9IGVsc2Uge1xuICAgICAgc3RyICs9ICcgJyArIGluc3BlY3QoeCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBzdHI7XG59O1xuXG5cbi8vIE1hcmsgdGhhdCBhIG1ldGhvZCBzaG91bGQgbm90IGJlIHVzZWQuXG4vLyBSZXR1cm5zIGEgbW9kaWZpZWQgZnVuY3Rpb24gd2hpY2ggd2FybnMgb25jZSBieSBkZWZhdWx0LlxuLy8gSWYgLS1uby1kZXByZWNhdGlvbiBpcyBzZXQsIHRoZW4gaXQgaXMgYSBuby1vcC5cbmV4cG9ydHMuZGVwcmVjYXRlID0gZnVuY3Rpb24oZm4sIG1zZykge1xuICAvLyBBbGxvdyBmb3IgZGVwcmVjYXRpbmcgdGhpbmdzIGluIHRoZSBwcm9jZXNzIG9mIHN0YXJ0aW5nIHVwLlxuICBpZiAoaXNVbmRlZmluZWQoZ2xvYmFsLnByb2Nlc3MpKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIGV4cG9ydHMuZGVwcmVjYXRlKGZuLCBtc2cpLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfVxuXG4gIGlmIChwcm9jZXNzLm5vRGVwcmVjYXRpb24gPT09IHRydWUpIHtcbiAgICByZXR1cm4gZm47XG4gIH1cblxuICB2YXIgd2FybmVkID0gZmFsc2U7XG4gIGZ1bmN0aW9uIGRlcHJlY2F0ZWQoKSB7XG4gICAgaWYgKCF3YXJuZWQpIHtcbiAgICAgIGlmIChwcm9jZXNzLnRocm93RGVwcmVjYXRpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MudHJhY2VEZXByZWNhdGlvbikge1xuICAgICAgICBjb25zb2xlLnRyYWNlKG1zZyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICB9XG4gICAgICB3YXJuZWQgPSB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfVxuXG4gIHJldHVybiBkZXByZWNhdGVkO1xufTtcblxuXG52YXIgZGVidWdzID0ge307XG52YXIgZGVidWdFbnZpcm9uO1xuZXhwb3J0cy5kZWJ1Z2xvZyA9IGZ1bmN0aW9uKHNldCkge1xuICBpZiAoaXNVbmRlZmluZWQoZGVidWdFbnZpcm9uKSlcbiAgICBkZWJ1Z0Vudmlyb24gPSBwcm9jZXNzLmVudi5OT0RFX0RFQlVHIHx8ICcnO1xuICBzZXQgPSBzZXQudG9VcHBlckNhc2UoKTtcbiAgaWYgKCFkZWJ1Z3Nbc2V0XSkge1xuICAgIGlmIChuZXcgUmVnRXhwKCdcXFxcYicgKyBzZXQgKyAnXFxcXGInLCAnaScpLnRlc3QoZGVidWdFbnZpcm9uKSkge1xuICAgICAgdmFyIHBpZCA9IHByb2Nlc3MucGlkO1xuICAgICAgZGVidWdzW3NldF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIG1zZyA9IGV4cG9ydHMuZm9ybWF0LmFwcGx5KGV4cG9ydHMsIGFyZ3VtZW50cyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJyVzICVkOiAlcycsIHNldCwgcGlkLCBtc2cpO1xuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgZGVidWdzW3NldF0gPSBmdW5jdGlvbigpIHt9O1xuICAgIH1cbiAgfVxuICByZXR1cm4gZGVidWdzW3NldF07XG59O1xuXG5cbi8qKlxuICogRWNob3MgdGhlIHZhbHVlIG9mIGEgdmFsdWUuIFRyeXMgdG8gcHJpbnQgdGhlIHZhbHVlIG91dFxuICogaW4gdGhlIGJlc3Qgd2F5IHBvc3NpYmxlIGdpdmVuIHRoZSBkaWZmZXJlbnQgdHlwZXMuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9iaiBUaGUgb2JqZWN0IHRvIHByaW50IG91dC5cbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRzIE9wdGlvbmFsIG9wdGlvbnMgb2JqZWN0IHRoYXQgYWx0ZXJzIHRoZSBvdXRwdXQuXG4gKi9cbi8qIGxlZ2FjeTogb2JqLCBzaG93SGlkZGVuLCBkZXB0aCwgY29sb3JzKi9cbmZ1bmN0aW9uIGluc3BlY3Qob2JqLCBvcHRzKSB7XG4gIC8vIGRlZmF1bHQgb3B0aW9uc1xuICB2YXIgY3R4ID0ge1xuICAgIHNlZW46IFtdLFxuICAgIHN0eWxpemU6IHN0eWxpemVOb0NvbG9yXG4gIH07XG4gIC8vIGxlZ2FjeS4uLlxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+PSAzKSBjdHguZGVwdGggPSBhcmd1bWVudHNbMl07XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID49IDQpIGN0eC5jb2xvcnMgPSBhcmd1bWVudHNbM107XG4gIGlmIChpc0Jvb2xlYW4ob3B0cykpIHtcbiAgICAvLyBsZWdhY3kuLi5cbiAgICBjdHguc2hvd0hpZGRlbiA9IG9wdHM7XG4gIH0gZWxzZSBpZiAob3B0cykge1xuICAgIC8vIGdvdCBhbiBcIm9wdGlvbnNcIiBvYmplY3RcbiAgICBleHBvcnRzLl9leHRlbmQoY3R4LCBvcHRzKTtcbiAgfVxuICAvLyBzZXQgZGVmYXVsdCBvcHRpb25zXG4gIGlmIChpc1VuZGVmaW5lZChjdHguc2hvd0hpZGRlbikpIGN0eC5zaG93SGlkZGVuID0gZmFsc2U7XG4gIGlmIChpc1VuZGVmaW5lZChjdHguZGVwdGgpKSBjdHguZGVwdGggPSAyO1xuICBpZiAoaXNVbmRlZmluZWQoY3R4LmNvbG9ycykpIGN0eC5jb2xvcnMgPSBmYWxzZTtcbiAgaWYgKGlzVW5kZWZpbmVkKGN0eC5jdXN0b21JbnNwZWN0KSkgY3R4LmN1c3RvbUluc3BlY3QgPSB0cnVlO1xuICBpZiAoY3R4LmNvbG9ycykgY3R4LnN0eWxpemUgPSBzdHlsaXplV2l0aENvbG9yO1xuICByZXR1cm4gZm9ybWF0VmFsdWUoY3R4LCBvYmosIGN0eC5kZXB0aCk7XG59XG5leHBvcnRzLmluc3BlY3QgPSBpbnNwZWN0O1xuXG5cbi8vIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvQU5TSV9lc2NhcGVfY29kZSNncmFwaGljc1xuaW5zcGVjdC5jb2xvcnMgPSB7XG4gICdib2xkJyA6IFsxLCAyMl0sXG4gICdpdGFsaWMnIDogWzMsIDIzXSxcbiAgJ3VuZGVybGluZScgOiBbNCwgMjRdLFxuICAnaW52ZXJzZScgOiBbNywgMjddLFxuICAnd2hpdGUnIDogWzM3LCAzOV0sXG4gICdncmV5JyA6IFs5MCwgMzldLFxuICAnYmxhY2snIDogWzMwLCAzOV0sXG4gICdibHVlJyA6IFszNCwgMzldLFxuICAnY3lhbicgOiBbMzYsIDM5XSxcbiAgJ2dyZWVuJyA6IFszMiwgMzldLFxuICAnbWFnZW50YScgOiBbMzUsIDM5XSxcbiAgJ3JlZCcgOiBbMzEsIDM5XSxcbiAgJ3llbGxvdycgOiBbMzMsIDM5XVxufTtcblxuLy8gRG9uJ3QgdXNlICdibHVlJyBub3QgdmlzaWJsZSBvbiBjbWQuZXhlXG5pbnNwZWN0LnN0eWxlcyA9IHtcbiAgJ3NwZWNpYWwnOiAnY3lhbicsXG4gICdudW1iZXInOiAneWVsbG93JyxcbiAgJ2Jvb2xlYW4nOiAneWVsbG93JyxcbiAgJ3VuZGVmaW5lZCc6ICdncmV5JyxcbiAgJ251bGwnOiAnYm9sZCcsXG4gICdzdHJpbmcnOiAnZ3JlZW4nLFxuICAnZGF0ZSc6ICdtYWdlbnRhJyxcbiAgLy8gXCJuYW1lXCI6IGludGVudGlvbmFsbHkgbm90IHN0eWxpbmdcbiAgJ3JlZ2V4cCc6ICdyZWQnXG59O1xuXG5cbmZ1bmN0aW9uIHN0eWxpemVXaXRoQ29sb3Ioc3RyLCBzdHlsZVR5cGUpIHtcbiAgdmFyIHN0eWxlID0gaW5zcGVjdC5zdHlsZXNbc3R5bGVUeXBlXTtcblxuICBpZiAoc3R5bGUpIHtcbiAgICByZXR1cm4gJ1xcdTAwMWJbJyArIGluc3BlY3QuY29sb3JzW3N0eWxlXVswXSArICdtJyArIHN0ciArXG4gICAgICAgICAgICdcXHUwMDFiWycgKyBpbnNwZWN0LmNvbG9yc1tzdHlsZV1bMV0gKyAnbSc7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHN0cjtcbiAgfVxufVxuXG5cbmZ1bmN0aW9uIHN0eWxpemVOb0NvbG9yKHN0ciwgc3R5bGVUeXBlKSB7XG4gIHJldHVybiBzdHI7XG59XG5cblxuZnVuY3Rpb24gYXJyYXlUb0hhc2goYXJyYXkpIHtcbiAgdmFyIGhhc2ggPSB7fTtcblxuICBhcnJheS5mb3JFYWNoKGZ1bmN0aW9uKHZhbCwgaWR4KSB7XG4gICAgaGFzaFt2YWxdID0gdHJ1ZTtcbiAgfSk7XG5cbiAgcmV0dXJuIGhhc2g7XG59XG5cblxuZnVuY3Rpb24gZm9ybWF0VmFsdWUoY3R4LCB2YWx1ZSwgcmVjdXJzZVRpbWVzKSB7XG4gIC8vIFByb3ZpZGUgYSBob29rIGZvciB1c2VyLXNwZWNpZmllZCBpbnNwZWN0IGZ1bmN0aW9ucy5cbiAgLy8gQ2hlY2sgdGhhdCB2YWx1ZSBpcyBhbiBvYmplY3Qgd2l0aCBhbiBpbnNwZWN0IGZ1bmN0aW9uIG9uIGl0XG4gIGlmIChjdHguY3VzdG9tSW5zcGVjdCAmJlxuICAgICAgdmFsdWUgJiZcbiAgICAgIGlzRnVuY3Rpb24odmFsdWUuaW5zcGVjdCkgJiZcbiAgICAgIC8vIEZpbHRlciBvdXQgdGhlIHV0aWwgbW9kdWxlLCBpdCdzIGluc3BlY3QgZnVuY3Rpb24gaXMgc3BlY2lhbFxuICAgICAgdmFsdWUuaW5zcGVjdCAhPT0gZXhwb3J0cy5pbnNwZWN0ICYmXG4gICAgICAvLyBBbHNvIGZpbHRlciBvdXQgYW55IHByb3RvdHlwZSBvYmplY3RzIHVzaW5nIHRoZSBjaXJjdWxhciBjaGVjay5cbiAgICAgICEodmFsdWUuY29uc3RydWN0b3IgJiYgdmFsdWUuY29uc3RydWN0b3IucHJvdG90eXBlID09PSB2YWx1ZSkpIHtcbiAgICB2YXIgcmV0ID0gdmFsdWUuaW5zcGVjdChyZWN1cnNlVGltZXMsIGN0eCk7XG4gICAgaWYgKCFpc1N0cmluZyhyZXQpKSB7XG4gICAgICByZXQgPSBmb3JtYXRWYWx1ZShjdHgsIHJldCwgcmVjdXJzZVRpbWVzKTtcbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbiAgfVxuXG4gIC8vIFByaW1pdGl2ZSB0eXBlcyBjYW5ub3QgaGF2ZSBwcm9wZXJ0aWVzXG4gIHZhciBwcmltaXRpdmUgPSBmb3JtYXRQcmltaXRpdmUoY3R4LCB2YWx1ZSk7XG4gIGlmIChwcmltaXRpdmUpIHtcbiAgICByZXR1cm4gcHJpbWl0aXZlO1xuICB9XG5cbiAgLy8gTG9vayB1cCB0aGUga2V5cyBvZiB0aGUgb2JqZWN0LlxuICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKHZhbHVlKTtcbiAgdmFyIHZpc2libGVLZXlzID0gYXJyYXlUb0hhc2goa2V5cyk7XG5cbiAgaWYgKGN0eC5zaG93SGlkZGVuKSB7XG4gICAga2V5cyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHZhbHVlKTtcbiAgfVxuXG4gIC8vIElFIGRvZXNuJ3QgbWFrZSBlcnJvciBmaWVsZHMgbm9uLWVudW1lcmFibGVcbiAgLy8gaHR0cDovL21zZG4ubWljcm9zb2Z0LmNvbS9lbi11cy9saWJyYXJ5L2llL2R3dzUyc2J0KHY9dnMuOTQpLmFzcHhcbiAgaWYgKGlzRXJyb3IodmFsdWUpXG4gICAgICAmJiAoa2V5cy5pbmRleE9mKCdtZXNzYWdlJykgPj0gMCB8fCBrZXlzLmluZGV4T2YoJ2Rlc2NyaXB0aW9uJykgPj0gMCkpIHtcbiAgICByZXR1cm4gZm9ybWF0RXJyb3IodmFsdWUpO1xuICB9XG5cbiAgLy8gU29tZSB0eXBlIG9mIG9iamVjdCB3aXRob3V0IHByb3BlcnRpZXMgY2FuIGJlIHNob3J0Y3V0dGVkLlxuICBpZiAoa2V5cy5sZW5ndGggPT09IDApIHtcbiAgICBpZiAoaXNGdW5jdGlvbih2YWx1ZSkpIHtcbiAgICAgIHZhciBuYW1lID0gdmFsdWUubmFtZSA/ICc6ICcgKyB2YWx1ZS5uYW1lIDogJyc7XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoJ1tGdW5jdGlvbicgKyBuYW1lICsgJ10nLCAnc3BlY2lhbCcpO1xuICAgIH1cbiAgICBpZiAoaXNSZWdFeHAodmFsdWUpKSB7XG4gICAgICByZXR1cm4gY3R4LnN0eWxpemUoUmVnRXhwLnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHZhbHVlKSwgJ3JlZ2V4cCcpO1xuICAgIH1cbiAgICBpZiAoaXNEYXRlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIGN0eC5zdHlsaXplKERhdGUucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodmFsdWUpLCAnZGF0ZScpO1xuICAgIH1cbiAgICBpZiAoaXNFcnJvcih2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBmb3JtYXRFcnJvcih2YWx1ZSk7XG4gICAgfVxuICB9XG5cbiAgdmFyIGJhc2UgPSAnJywgYXJyYXkgPSBmYWxzZSwgYnJhY2VzID0gWyd7JywgJ30nXTtcblxuICAvLyBNYWtlIEFycmF5IHNheSB0aGF0IHRoZXkgYXJlIEFycmF5XG4gIGlmIChpc0FycmF5KHZhbHVlKSkge1xuICAgIGFycmF5ID0gdHJ1ZTtcbiAgICBicmFjZXMgPSBbJ1snLCAnXSddO1xuICB9XG5cbiAgLy8gTWFrZSBmdW5jdGlvbnMgc2F5IHRoYXQgdGhleSBhcmUgZnVuY3Rpb25zXG4gIGlmIChpc0Z1bmN0aW9uKHZhbHVlKSkge1xuICAgIHZhciBuID0gdmFsdWUubmFtZSA/ICc6ICcgKyB2YWx1ZS5uYW1lIDogJyc7XG4gICAgYmFzZSA9ICcgW0Z1bmN0aW9uJyArIG4gKyAnXSc7XG4gIH1cblxuICAvLyBNYWtlIFJlZ0V4cHMgc2F5IHRoYXQgdGhleSBhcmUgUmVnRXhwc1xuICBpZiAoaXNSZWdFeHAodmFsdWUpKSB7XG4gICAgYmFzZSA9ICcgJyArIFJlZ0V4cC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSk7XG4gIH1cblxuICAvLyBNYWtlIGRhdGVzIHdpdGggcHJvcGVydGllcyBmaXJzdCBzYXkgdGhlIGRhdGVcbiAgaWYgKGlzRGF0ZSh2YWx1ZSkpIHtcbiAgICBiYXNlID0gJyAnICsgRGF0ZS5wcm90b3R5cGUudG9VVENTdHJpbmcuY2FsbCh2YWx1ZSk7XG4gIH1cblxuICAvLyBNYWtlIGVycm9yIHdpdGggbWVzc2FnZSBmaXJzdCBzYXkgdGhlIGVycm9yXG4gIGlmIChpc0Vycm9yKHZhbHVlKSkge1xuICAgIGJhc2UgPSAnICcgKyBmb3JtYXRFcnJvcih2YWx1ZSk7XG4gIH1cblxuICBpZiAoa2V5cy5sZW5ndGggPT09IDAgJiYgKCFhcnJheSB8fCB2YWx1ZS5sZW5ndGggPT0gMCkpIHtcbiAgICByZXR1cm4gYnJhY2VzWzBdICsgYmFzZSArIGJyYWNlc1sxXTtcbiAgfVxuXG4gIGlmIChyZWN1cnNlVGltZXMgPCAwKSB7XG4gICAgaWYgKGlzUmVnRXhwKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIGN0eC5zdHlsaXplKFJlZ0V4cC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSksICdyZWdleHAnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGN0eC5zdHlsaXplKCdbT2JqZWN0XScsICdzcGVjaWFsJyk7XG4gICAgfVxuICB9XG5cbiAgY3R4LnNlZW4ucHVzaCh2YWx1ZSk7XG5cbiAgdmFyIG91dHB1dDtcbiAgaWYgKGFycmF5KSB7XG4gICAgb3V0cHV0ID0gZm9ybWF0QXJyYXkoY3R4LCB2YWx1ZSwgcmVjdXJzZVRpbWVzLCB2aXNpYmxlS2V5cywga2V5cyk7XG4gIH0gZWxzZSB7XG4gICAgb3V0cHV0ID0ga2V5cy5tYXAoZnVuY3Rpb24oa2V5KSB7XG4gICAgICByZXR1cm4gZm9ybWF0UHJvcGVydHkoY3R4LCB2YWx1ZSwgcmVjdXJzZVRpbWVzLCB2aXNpYmxlS2V5cywga2V5LCBhcnJheSk7XG4gICAgfSk7XG4gIH1cblxuICBjdHguc2Vlbi5wb3AoKTtcblxuICByZXR1cm4gcmVkdWNlVG9TaW5nbGVTdHJpbmcob3V0cHV0LCBiYXNlLCBicmFjZXMpO1xufVxuXG5cbmZ1bmN0aW9uIGZvcm1hdFByaW1pdGl2ZShjdHgsIHZhbHVlKSB7XG4gIGlmIChpc1VuZGVmaW5lZCh2YWx1ZSkpXG4gICAgcmV0dXJuIGN0eC5zdHlsaXplKCd1bmRlZmluZWQnLCAndW5kZWZpbmVkJyk7XG4gIGlmIChpc1N0cmluZyh2YWx1ZSkpIHtcbiAgICB2YXIgc2ltcGxlID0gJ1xcJycgKyBKU09OLnN0cmluZ2lmeSh2YWx1ZSkucmVwbGFjZSgvXlwifFwiJC9nLCAnJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8nL2csIFwiXFxcXCdcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC9cXFxcXCIvZywgJ1wiJykgKyAnXFwnJztcbiAgICByZXR1cm4gY3R4LnN0eWxpemUoc2ltcGxlLCAnc3RyaW5nJyk7XG4gIH1cbiAgaWYgKGlzTnVtYmVyKHZhbHVlKSlcbiAgICByZXR1cm4gY3R4LnN0eWxpemUoJycgKyB2YWx1ZSwgJ251bWJlcicpO1xuICBpZiAoaXNCb29sZWFuKHZhbHVlKSlcbiAgICByZXR1cm4gY3R4LnN0eWxpemUoJycgKyB2YWx1ZSwgJ2Jvb2xlYW4nKTtcbiAgLy8gRm9yIHNvbWUgcmVhc29uIHR5cGVvZiBudWxsIGlzIFwib2JqZWN0XCIsIHNvIHNwZWNpYWwgY2FzZSBoZXJlLlxuICBpZiAoaXNOdWxsKHZhbHVlKSlcbiAgICByZXR1cm4gY3R4LnN0eWxpemUoJ251bGwnLCAnbnVsbCcpO1xufVxuXG5cbmZ1bmN0aW9uIGZvcm1hdEVycm9yKHZhbHVlKSB7XG4gIHJldHVybiAnWycgKyBFcnJvci5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSkgKyAnXSc7XG59XG5cblxuZnVuY3Rpb24gZm9ybWF0QXJyYXkoY3R4LCB2YWx1ZSwgcmVjdXJzZVRpbWVzLCB2aXNpYmxlS2V5cywga2V5cykge1xuICB2YXIgb3V0cHV0ID0gW107XG4gIGZvciAodmFyIGkgPSAwLCBsID0gdmFsdWUubGVuZ3RoOyBpIDwgbDsgKytpKSB7XG4gICAgaWYgKGhhc093blByb3BlcnR5KHZhbHVlLCBTdHJpbmcoaSkpKSB7XG4gICAgICBvdXRwdXQucHVzaChmb3JtYXRQcm9wZXJ0eShjdHgsIHZhbHVlLCByZWN1cnNlVGltZXMsIHZpc2libGVLZXlzLFxuICAgICAgICAgIFN0cmluZyhpKSwgdHJ1ZSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvdXRwdXQucHVzaCgnJyk7XG4gICAgfVxuICB9XG4gIGtleXMuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICBpZiAoIWtleS5tYXRjaCgvXlxcZCskLykpIHtcbiAgICAgIG91dHB1dC5wdXNoKGZvcm1hdFByb3BlcnR5KGN0eCwgdmFsdWUsIHJlY3Vyc2VUaW1lcywgdmlzaWJsZUtleXMsXG4gICAgICAgICAga2V5LCB0cnVlKSk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIG91dHB1dDtcbn1cblxuXG5mdW5jdGlvbiBmb3JtYXRQcm9wZXJ0eShjdHgsIHZhbHVlLCByZWN1cnNlVGltZXMsIHZpc2libGVLZXlzLCBrZXksIGFycmF5KSB7XG4gIHZhciBuYW1lLCBzdHIsIGRlc2M7XG4gIGRlc2MgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHZhbHVlLCBrZXkpIHx8IHsgdmFsdWU6IHZhbHVlW2tleV0gfTtcbiAgaWYgKGRlc2MuZ2V0KSB7XG4gICAgaWYgKGRlc2Muc2V0KSB7XG4gICAgICBzdHIgPSBjdHguc3R5bGl6ZSgnW0dldHRlci9TZXR0ZXJdJywgJ3NwZWNpYWwnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3RyID0gY3R4LnN0eWxpemUoJ1tHZXR0ZXJdJywgJ3NwZWNpYWwnKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgaWYgKGRlc2Muc2V0KSB7XG4gICAgICBzdHIgPSBjdHguc3R5bGl6ZSgnW1NldHRlcl0nLCAnc3BlY2lhbCcpO1xuICAgIH1cbiAgfVxuICBpZiAoIWhhc093blByb3BlcnR5KHZpc2libGVLZXlzLCBrZXkpKSB7XG4gICAgbmFtZSA9ICdbJyArIGtleSArICddJztcbiAgfVxuICBpZiAoIXN0cikge1xuICAgIGlmIChjdHguc2Vlbi5pbmRleE9mKGRlc2MudmFsdWUpIDwgMCkge1xuICAgICAgaWYgKGlzTnVsbChyZWN1cnNlVGltZXMpKSB7XG4gICAgICAgIHN0ciA9IGZvcm1hdFZhbHVlKGN0eCwgZGVzYy52YWx1ZSwgbnVsbCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzdHIgPSBmb3JtYXRWYWx1ZShjdHgsIGRlc2MudmFsdWUsIHJlY3Vyc2VUaW1lcyAtIDEpO1xuICAgICAgfVxuICAgICAgaWYgKHN0ci5pbmRleE9mKCdcXG4nKSA+IC0xKSB7XG4gICAgICAgIGlmIChhcnJheSkge1xuICAgICAgICAgIHN0ciA9IHN0ci5zcGxpdCgnXFxuJykubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICAgIHJldHVybiAnICAnICsgbGluZTtcbiAgICAgICAgICB9KS5qb2luKCdcXG4nKS5zdWJzdHIoMik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc3RyID0gJ1xcbicgKyBzdHIuc3BsaXQoJ1xcbicpLm1hcChmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgICByZXR1cm4gJyAgICcgKyBsaW5lO1xuICAgICAgICAgIH0pLmpvaW4oJ1xcbicpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHN0ciA9IGN0eC5zdHlsaXplKCdbQ2lyY3VsYXJdJywgJ3NwZWNpYWwnKTtcbiAgICB9XG4gIH1cbiAgaWYgKGlzVW5kZWZpbmVkKG5hbWUpKSB7XG4gICAgaWYgKGFycmF5ICYmIGtleS5tYXRjaCgvXlxcZCskLykpIHtcbiAgICAgIHJldHVybiBzdHI7XG4gICAgfVxuICAgIG5hbWUgPSBKU09OLnN0cmluZ2lmeSgnJyArIGtleSk7XG4gICAgaWYgKG5hbWUubWF0Y2goL15cIihbYS16QS1aX11bYS16QS1aXzAtOV0qKVwiJC8pKSB7XG4gICAgICBuYW1lID0gbmFtZS5zdWJzdHIoMSwgbmFtZS5sZW5ndGggLSAyKTtcbiAgICAgIG5hbWUgPSBjdHguc3R5bGl6ZShuYW1lLCAnbmFtZScpO1xuICAgIH0gZWxzZSB7XG4gICAgICBuYW1lID0gbmFtZS5yZXBsYWNlKC8nL2csIFwiXFxcXCdcIilcbiAgICAgICAgICAgICAgICAgLnJlcGxhY2UoL1xcXFxcIi9nLCAnXCInKVxuICAgICAgICAgICAgICAgICAucmVwbGFjZSgvKF5cInxcIiQpL2csIFwiJ1wiKTtcbiAgICAgIG5hbWUgPSBjdHguc3R5bGl6ZShuYW1lLCAnc3RyaW5nJyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5hbWUgKyAnOiAnICsgc3RyO1xufVxuXG5cbmZ1bmN0aW9uIHJlZHVjZVRvU2luZ2xlU3RyaW5nKG91dHB1dCwgYmFzZSwgYnJhY2VzKSB7XG4gIHZhciBudW1MaW5lc0VzdCA9IDA7XG4gIHZhciBsZW5ndGggPSBvdXRwdXQucmVkdWNlKGZ1bmN0aW9uKHByZXYsIGN1cikge1xuICAgIG51bUxpbmVzRXN0Kys7XG4gICAgaWYgKGN1ci5pbmRleE9mKCdcXG4nKSA+PSAwKSBudW1MaW5lc0VzdCsrO1xuICAgIHJldHVybiBwcmV2ICsgY3VyLnJlcGxhY2UoL1xcdTAwMWJcXFtcXGRcXGQ/bS9nLCAnJykubGVuZ3RoICsgMTtcbiAgfSwgMCk7XG5cbiAgaWYgKGxlbmd0aCA+IDYwKSB7XG4gICAgcmV0dXJuIGJyYWNlc1swXSArXG4gICAgICAgICAgIChiYXNlID09PSAnJyA/ICcnIDogYmFzZSArICdcXG4gJykgK1xuICAgICAgICAgICAnICcgK1xuICAgICAgICAgICBvdXRwdXQuam9pbignLFxcbiAgJykgK1xuICAgICAgICAgICAnICcgK1xuICAgICAgICAgICBicmFjZXNbMV07XG4gIH1cblxuICByZXR1cm4gYnJhY2VzWzBdICsgYmFzZSArICcgJyArIG91dHB1dC5qb2luKCcsICcpICsgJyAnICsgYnJhY2VzWzFdO1xufVxuXG5cbi8vIE5PVEU6IFRoZXNlIHR5cGUgY2hlY2tpbmcgZnVuY3Rpb25zIGludGVudGlvbmFsbHkgZG9uJ3QgdXNlIGBpbnN0YW5jZW9mYFxuLy8gYmVjYXVzZSBpdCBpcyBmcmFnaWxlIGFuZCBjYW4gYmUgZWFzaWx5IGZha2VkIHdpdGggYE9iamVjdC5jcmVhdGUoKWAuXG5mdW5jdGlvbiBpc0FycmF5KGFyKSB7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGFyKTtcbn1cbmV4cG9ydHMuaXNBcnJheSA9IGlzQXJyYXk7XG5cbmZ1bmN0aW9uIGlzQm9vbGVhbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdib29sZWFuJztcbn1cbmV4cG9ydHMuaXNCb29sZWFuID0gaXNCb29sZWFuO1xuXG5mdW5jdGlvbiBpc051bGwoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IG51bGw7XG59XG5leHBvcnRzLmlzTnVsbCA9IGlzTnVsbDtcblxuZnVuY3Rpb24gaXNOdWxsT3JVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT0gbnVsbDtcbn1cbmV4cG9ydHMuaXNOdWxsT3JVbmRlZmluZWQgPSBpc051bGxPclVuZGVmaW5lZDtcblxuZnVuY3Rpb24gaXNOdW1iZXIoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJztcbn1cbmV4cG9ydHMuaXNOdW1iZXIgPSBpc051bWJlcjtcblxuZnVuY3Rpb24gaXNTdHJpbmcoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3RyaW5nJztcbn1cbmV4cG9ydHMuaXNTdHJpbmcgPSBpc1N0cmluZztcblxuZnVuY3Rpb24gaXNTeW1ib2woYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3ltYm9sJztcbn1cbmV4cG9ydHMuaXNTeW1ib2wgPSBpc1N5bWJvbDtcblxuZnVuY3Rpb24gaXNVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IHZvaWQgMDtcbn1cbmV4cG9ydHMuaXNVbmRlZmluZWQgPSBpc1VuZGVmaW5lZDtcblxuZnVuY3Rpb24gaXNSZWdFeHAocmUpIHtcbiAgcmV0dXJuIGlzT2JqZWN0KHJlKSAmJiBvYmplY3RUb1N0cmluZyhyZSkgPT09ICdbb2JqZWN0IFJlZ0V4cF0nO1xufVxuZXhwb3J0cy5pc1JlZ0V4cCA9IGlzUmVnRXhwO1xuXG5mdW5jdGlvbiBpc09iamVjdChhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbDtcbn1cbmV4cG9ydHMuaXNPYmplY3QgPSBpc09iamVjdDtcblxuZnVuY3Rpb24gaXNEYXRlKGQpIHtcbiAgcmV0dXJuIGlzT2JqZWN0KGQpICYmIG9iamVjdFRvU3RyaW5nKGQpID09PSAnW29iamVjdCBEYXRlXSc7XG59XG5leHBvcnRzLmlzRGF0ZSA9IGlzRGF0ZTtcblxuZnVuY3Rpb24gaXNFcnJvcihlKSB7XG4gIHJldHVybiBpc09iamVjdChlKSAmJlxuICAgICAgKG9iamVjdFRvU3RyaW5nKGUpID09PSAnW29iamVjdCBFcnJvcl0nIHx8IGUgaW5zdGFuY2VvZiBFcnJvcik7XG59XG5leHBvcnRzLmlzRXJyb3IgPSBpc0Vycm9yO1xuXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJztcbn1cbmV4cG9ydHMuaXNGdW5jdGlvbiA9IGlzRnVuY3Rpb247XG5cbmZ1bmN0aW9uIGlzUHJpbWl0aXZlKGFyZykge1xuICByZXR1cm4gYXJnID09PSBudWxsIHx8XG4gICAgICAgICB0eXBlb2YgYXJnID09PSAnYm9vbGVhbicgfHxcbiAgICAgICAgIHR5cGVvZiBhcmcgPT09ICdudW1iZXInIHx8XG4gICAgICAgICB0eXBlb2YgYXJnID09PSAnc3RyaW5nJyB8fFxuICAgICAgICAgdHlwZW9mIGFyZyA9PT0gJ3N5bWJvbCcgfHwgIC8vIEVTNiBzeW1ib2xcbiAgICAgICAgIHR5cGVvZiBhcmcgPT09ICd1bmRlZmluZWQnO1xufVxuZXhwb3J0cy5pc1ByaW1pdGl2ZSA9IGlzUHJpbWl0aXZlO1xuXG5leHBvcnRzLmlzQnVmZmVyID0gcmVxdWlyZSgnLi9zdXBwb3J0L2lzQnVmZmVyJyk7XG5cbmZ1bmN0aW9uIG9iamVjdFRvU3RyaW5nKG8pIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvKTtcbn1cblxuXG5mdW5jdGlvbiBwYWQobikge1xuICByZXR1cm4gbiA8IDEwID8gJzAnICsgbi50b1N0cmluZygxMCkgOiBuLnRvU3RyaW5nKDEwKTtcbn1cblxuXG52YXIgbW9udGhzID0gWydKYW4nLCAnRmViJywgJ01hcicsICdBcHInLCAnTWF5JywgJ0p1bicsICdKdWwnLCAnQXVnJywgJ1NlcCcsXG4gICAgICAgICAgICAgICdPY3QnLCAnTm92JywgJ0RlYyddO1xuXG4vLyAyNiBGZWIgMTY6MTk6MzRcbmZ1bmN0aW9uIHRpbWVzdGFtcCgpIHtcbiAgdmFyIGQgPSBuZXcgRGF0ZSgpO1xuICB2YXIgdGltZSA9IFtwYWQoZC5nZXRIb3VycygpKSxcbiAgICAgICAgICAgICAgcGFkKGQuZ2V0TWludXRlcygpKSxcbiAgICAgICAgICAgICAgcGFkKGQuZ2V0U2Vjb25kcygpKV0uam9pbignOicpO1xuICByZXR1cm4gW2QuZ2V0RGF0ZSgpLCBtb250aHNbZC5nZXRNb250aCgpXSwgdGltZV0uam9pbignICcpO1xufVxuXG5cbi8vIGxvZyBpcyBqdXN0IGEgdGhpbiB3cmFwcGVyIHRvIGNvbnNvbGUubG9nIHRoYXQgcHJlcGVuZHMgYSB0aW1lc3RhbXBcbmV4cG9ydHMubG9nID0gZnVuY3Rpb24oKSB7XG4gIGNvbnNvbGUubG9nKCclcyAtICVzJywgdGltZXN0YW1wKCksIGV4cG9ydHMuZm9ybWF0LmFwcGx5KGV4cG9ydHMsIGFyZ3VtZW50cykpO1xufTtcblxuXG4vKipcbiAqIEluaGVyaXQgdGhlIHByb3RvdHlwZSBtZXRob2RzIGZyb20gb25lIGNvbnN0cnVjdG9yIGludG8gYW5vdGhlci5cbiAqXG4gKiBUaGUgRnVuY3Rpb24ucHJvdG90eXBlLmluaGVyaXRzIGZyb20gbGFuZy5qcyByZXdyaXR0ZW4gYXMgYSBzdGFuZGFsb25lXG4gKiBmdW5jdGlvbiAobm90IG9uIEZ1bmN0aW9uLnByb3RvdHlwZSkuIE5PVEU6IElmIHRoaXMgZmlsZSBpcyB0byBiZSBsb2FkZWRcbiAqIGR1cmluZyBib290c3RyYXBwaW5nIHRoaXMgZnVuY3Rpb24gbmVlZHMgdG8gYmUgcmV3cml0dGVuIHVzaW5nIHNvbWUgbmF0aXZlXG4gKiBmdW5jdGlvbnMgYXMgcHJvdG90eXBlIHNldHVwIHVzaW5nIG5vcm1hbCBKYXZhU2NyaXB0IGRvZXMgbm90IHdvcmsgYXNcbiAqIGV4cGVjdGVkIGR1cmluZyBib290c3RyYXBwaW5nIChzZWUgbWlycm9yLmpzIGluIHIxMTQ5MDMpLlxuICpcbiAqIEBwYXJhbSB7ZnVuY3Rpb259IGN0b3IgQ29uc3RydWN0b3IgZnVuY3Rpb24gd2hpY2ggbmVlZHMgdG8gaW5oZXJpdCB0aGVcbiAqICAgICBwcm90b3R5cGUuXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBzdXBlckN0b3IgQ29uc3RydWN0b3IgZnVuY3Rpb24gdG8gaW5oZXJpdCBwcm90b3R5cGUgZnJvbS5cbiAqL1xuZXhwb3J0cy5pbmhlcml0cyA9IHJlcXVpcmUoJ2luaGVyaXRzJyk7XG5cbmV4cG9ydHMuX2V4dGVuZCA9IGZ1bmN0aW9uKG9yaWdpbiwgYWRkKSB7XG4gIC8vIERvbid0IGRvIGFueXRoaW5nIGlmIGFkZCBpc24ndCBhbiBvYmplY3RcbiAgaWYgKCFhZGQgfHwgIWlzT2JqZWN0KGFkZCkpIHJldHVybiBvcmlnaW47XG5cbiAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhhZGQpO1xuICB2YXIgaSA9IGtleXMubGVuZ3RoO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgb3JpZ2luW2tleXNbaV1dID0gYWRkW2tleXNbaV1dO1xuICB9XG4gIHJldHVybiBvcmlnaW47XG59O1xuXG5mdW5jdGlvbiBoYXNPd25Qcm9wZXJ0eShvYmosIHByb3ApIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApO1xufVxuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvaW5zZXJ0LW1vZHVsZS1nbG9iYWxzL25vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanNcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9KSIsImlmICh0eXBlb2YgT2JqZWN0LmNyZWF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAvLyBpbXBsZW1lbnRhdGlvbiBmcm9tIHN0YW5kYXJkIG5vZGUuanMgJ3V0aWwnIG1vZHVsZVxuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgY3Rvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHN1cGVyQ3Rvci5wcm90b3R5cGUsIHtcbiAgICAgIGNvbnN0cnVjdG9yOiB7XG4gICAgICAgIHZhbHVlOiBjdG9yLFxuICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuICB9O1xufSBlbHNlIHtcbiAgLy8gb2xkIHNjaG9vbCBzaGltIGZvciBvbGQgYnJvd3NlcnNcbiAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbmhlcml0cyhjdG9yLCBzdXBlckN0b3IpIHtcbiAgICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvclxuICAgIHZhciBUZW1wQ3RvciA9IGZ1bmN0aW9uICgpIHt9XG4gICAgVGVtcEN0b3IucHJvdG90eXBlID0gc3VwZXJDdG9yLnByb3RvdHlwZVxuICAgIGN0b3IucHJvdG90eXBlID0gbmV3IFRlbXBDdG9yKClcbiAgICBjdG9yLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IGN0b3JcbiAgfVxufVxuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcblxucHJvY2Vzcy5uZXh0VGljayA9IChmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGNhblNldEltbWVkaWF0ZSA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnXG4gICAgJiYgd2luZG93LnNldEltbWVkaWF0ZTtcbiAgICB2YXIgY2FuUG9zdCA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnXG4gICAgJiYgd2luZG93LnBvc3RNZXNzYWdlICYmIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyXG4gICAgO1xuXG4gICAgaWYgKGNhblNldEltbWVkaWF0ZSkge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGYpIHsgcmV0dXJuIHdpbmRvdy5zZXRJbW1lZGlhdGUoZikgfTtcbiAgICB9XG5cbiAgICBpZiAoY2FuUG9zdCkge1xuICAgICAgICB2YXIgcXVldWUgPSBbXTtcbiAgICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbiAoZXYpIHtcbiAgICAgICAgICAgIHZhciBzb3VyY2UgPSBldi5zb3VyY2U7XG4gICAgICAgICAgICBpZiAoKHNvdXJjZSA9PT0gd2luZG93IHx8IHNvdXJjZSA9PT0gbnVsbCkgJiYgZXYuZGF0YSA9PT0gJ3Byb2Nlc3MtdGljaycpIHtcbiAgICAgICAgICAgICAgICBldi5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgICAgICBpZiAocXVldWUubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZm4gPSBxdWV1ZS5zaGlmdCgpO1xuICAgICAgICAgICAgICAgICAgICBmbigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgdHJ1ZSk7XG5cbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIG5leHRUaWNrKGZuKSB7XG4gICAgICAgICAgICBxdWV1ZS5wdXNoKGZuKTtcbiAgICAgICAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZSgncHJvY2Vzcy10aWNrJywgJyonKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gZnVuY3Rpb24gbmV4dFRpY2soZm4pIHtcbiAgICAgICAgc2V0VGltZW91dChmbiwgMCk7XG4gICAgfTtcbn0pKCk7XG5cbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn1cblxuLy8gVE9ETyhzaHR5bG1hbilcbnByb2Nlc3MuY3dkID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gJy8nIH07XG5wcm9jZXNzLmNoZGlyID0gZnVuY3Rpb24gKGRpcikge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5jaGRpciBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuIiwiLyoqXG4gKiBwb3dlci1hc3NlcnQuanMgLSBQb3dlciBBc3NlcnQgaW4gSmF2YVNjcmlwdC5cbiAqXG4gKiBodHRwczovL2dpdGh1Yi5jb20vdHdhZGEvcG93ZXItYXNzZXJ0XG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDEzLTIwMTQgVGFrdXRvIFdhZGFcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBNSVQgbGljZW5zZS5cbiAqICAgaHR0cHM6Ly9yYXcuZ2l0aHViLmNvbS90d2FkYS9wb3dlci1hc3NlcnQvbWFzdGVyL01JVC1MSUNFTlNFLnR4dFxuICovXG4oZnVuY3Rpb24gKHJvb3QsIGZhY3RvcnkpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICAvLyB1c2luZyByZXR1cm5FeHBvcnRzIFVNRCBwYXR0ZXJuXG4gICAgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuICAgICAgICBkZWZpbmUoWydhc3NlcnQnLCAnZW1wb3dlcicsICdwb3dlci1hc3NlcnQtZm9ybWF0dGVyJ10sIGZhY3RvcnkpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeShyZXF1aXJlKCdhc3NlcnQnKSwgcmVxdWlyZSgnZW1wb3dlcicpLCByZXF1aXJlKCdwb3dlci1hc3NlcnQtZm9ybWF0dGVyJykpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJvb3QuYXNzZXJ0ID0gZmFjdG9yeShyb290LmFzc2VydCwgcm9vdC5lbXBvd2VyLCByb290LnBvd2VyQXNzZXJ0Rm9ybWF0dGVyKTtcbiAgICB9XG59KHRoaXMsIGZ1bmN0aW9uIChiYXNlQXNzZXJ0LCBlbXBvd2VyLCBmb3JtYXR0ZXIpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICByZXR1cm4gZW1wb3dlcihiYXNlQXNzZXJ0LCBmb3JtYXR0ZXIoKSwge21vZGlmeU1lc3NhZ2VPbkZhaWw6IHRydWUsIHNhdmVDb250ZXh0T25GYWlsOiB0cnVlfSk7XG59KSk7XG4iLCIvKipcbiAqIGVtcG93ZXIuanMgLSBQb3dlciBBc3NlcnQgZmVhdHVyZSBlbmhhbmNlciBmb3IgYXNzZXJ0IGZ1bmN0aW9uL29iamVjdC5cbiAqXG4gKiBodHRwczovL2dpdGh1Yi5jb20vdHdhZGEvZW1wb3dlclxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxMy0yMDE0IFRha3V0byBXYWRhXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2UuXG4gKiAgIGh0dHBzOi8vcmF3LmdpdGh1Yi5jb20vdHdhZGEvZW1wb3dlci9tYXN0ZXIvTUlULUxJQ0VOU0UudHh0XG4gKlxuICogQSBwYXJ0IG9mIGV4dGVuZCBmdW5jdGlvbiBpczpcbiAqICAgQ29weXJpZ2h0IDIwMTIgalF1ZXJ5IEZvdW5kYXRpb24gYW5kIG90aGVyIGNvbnRyaWJ1dG9yc1xuICogICBSZWxlYXNlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2UuXG4gKiAgIGh0dHA6Ly9qcXVlcnkub3JnL2xpY2Vuc2VcbiAqL1xuKGZ1bmN0aW9uIChyb290LCBmYWN0b3J5KSB7XG4gICAgJ3VzZSBzdHJpY3QnO1xuXG4gICAgLy8gdXNpbmcgcmV0dXJuRXhwb3J0cyBVTUQgcGF0dGVyblxuICAgIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcbiAgICAgICAgZGVmaW5lKGZhY3RvcnkpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJvb3QuZW1wb3dlciA9IGZhY3RvcnkoKTtcbiAgICB9XG59KHRoaXMsIGZ1bmN0aW9uICgpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICB2YXIgaXNQaGFudG9tID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5jYWxsUGhhbnRvbSA9PT0gJ2Z1bmN0aW9uJztcblxuICAgIGZ1bmN0aW9uIGRlZmF1bHRPcHRpb25zICgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGRlc3RydWN0aXZlOiBmYWxzZSxcbiAgICAgICAgICAgIG1vZGlmeU1lc3NhZ2VPbkZhaWw6IGZhbHNlLFxuICAgICAgICAgICAgc2F2ZUNvbnRleHRPbkZhaWw6IGZhbHNlLFxuICAgICAgICAgICAgdGFyZ2V0TWV0aG9kczoge1xuICAgICAgICAgICAgICAgIG9uZUFyZzogW1xuICAgICAgICAgICAgICAgICAgICAnb2snXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB0d29BcmdzOiBbXG4gICAgICAgICAgICAgICAgICAgICdlcXVhbCcsXG4gICAgICAgICAgICAgICAgICAgICdub3RFcXVhbCcsXG4gICAgICAgICAgICAgICAgICAgICdzdHJpY3RFcXVhbCcsXG4gICAgICAgICAgICAgICAgICAgICdub3RTdHJpY3RFcXVhbCcsXG4gICAgICAgICAgICAgICAgICAgICdkZWVwRXF1YWwnLFxuICAgICAgICAgICAgICAgICAgICAnbm90RGVlcEVxdWFsJ1xuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEVuaGFuY2UgUG93ZXIgQXNzZXJ0IGZlYXR1cmUgdG8gYXNzZXJ0IGZ1bmN0aW9uL29iamVjdC5cbiAgICAgKiBAcGFyYW0gYXNzZXJ0IHRhcmdldCBhc3NlcnQgZnVuY3Rpb24gb3Igb2JqZWN0IHRvIGVuaGFuY2VcbiAgICAgKiBAcGFyYW0gZm9ybWF0dGVyIHBvd2VyIGFzc2VydCBmb3JtYXQgZnVuY3Rpb25cbiAgICAgKiBAcGFyYW0gb3B0aW9ucyBlbmhhbmNlbWVudCBvcHRpb25zXG4gICAgICogQHJldHVybiBlbmhhbmNlZCBhc3NlcnQgZnVuY3Rpb24vb2JqZWN0XG4gICAgICovXG4gICAgZnVuY3Rpb24gZW1wb3dlciAoYXNzZXJ0LCBmb3JtYXR0ZXIsIG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHR5cGVPZkFzc2VydCA9ICh0eXBlb2YgYXNzZXJ0KSxcbiAgICAgICAgICAgIGNvbmZpZztcbiAgICAgICAgaWYgKCh0eXBlT2ZBc3NlcnQgIT09ICdvYmplY3QnICYmIHR5cGVPZkFzc2VydCAhPT0gJ2Z1bmN0aW9uJykgfHwgYXNzZXJ0ID09PSBudWxsKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdlbXBvd2VyIGFyZ3VtZW50IHNob3VsZCBiZSBhIGZ1bmN0aW9uIG9yIG9iamVjdC4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoaXNFbXBvd2VyZWQoYXNzZXJ0KSkge1xuICAgICAgICAgICAgcmV0dXJuIGFzc2VydDtcbiAgICAgICAgfVxuICAgICAgICBjb25maWcgPSBleHRlbmQoZGVmYXVsdE9wdGlvbnMoKSwgKG9wdGlvbnMgfHwge30pKTtcbiAgICAgICAgc3dpdGNoICh0eXBlT2ZBc3NlcnQpIHtcbiAgICAgICAgY2FzZSAnZnVuY3Rpb24nOlxuICAgICAgICAgICAgcmV0dXJuIGVtcG93ZXJBc3NlcnRGdW5jdGlvbihhc3NlcnQsIGZvcm1hdHRlciwgY29uZmlnKTtcbiAgICAgICAgY2FzZSAnb2JqZWN0JzpcbiAgICAgICAgICAgIHJldHVybiBlbXBvd2VyQXNzZXJ0T2JqZWN0KGFzc2VydCwgZm9ybWF0dGVyLCBjb25maWcpO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgYmUgaGVyZScpO1xuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICBmdW5jdGlvbiBpc0VtcG93ZXJlZCAoYXNzZXJ0T2JqZWN0T3JGdW5jdGlvbikge1xuICAgICAgICByZXR1cm4gKHR5cGVvZiBhc3NlcnRPYmplY3RPckZ1bmN0aW9uLl9jYXB0ID09PSAnZnVuY3Rpb24nKSAmJiAodHlwZW9mIGFzc2VydE9iamVjdE9yRnVuY3Rpb24uX2V4cHIgPT09ICdmdW5jdGlvbicpO1xuICAgIH1cblxuXG4gICAgZnVuY3Rpb24gZW1wb3dlckFzc2VydE9iamVjdCAoYXNzZXJ0T2JqZWN0LCBmb3JtYXR0ZXIsIGNvbmZpZykge1xuICAgICAgICB2YXIgZW5oYW5jZW1lbnQgPSBlbmhhbmNlKGFzc2VydE9iamVjdCwgZm9ybWF0dGVyLCBjb25maWcpLFxuICAgICAgICAgICAgdGFyZ2V0ID0gY29uZmlnLmRlc3RydWN0aXZlID8gYXNzZXJ0T2JqZWN0IDogT2JqZWN0LmNyZWF0ZShhc3NlcnRPYmplY3QpO1xuICAgICAgICByZXR1cm4gZXh0ZW5kKHRhcmdldCwgZW5oYW5jZW1lbnQpO1xuICAgIH1cblxuXG4gICAgZnVuY3Rpb24gZW1wb3dlckFzc2VydEZ1bmN0aW9uIChhc3NlcnRGdW5jdGlvbiwgZm9ybWF0dGVyLCBjb25maWcpIHtcbiAgICAgICAgaWYgKGNvbmZpZy5kZXN0cnVjdGl2ZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdjYW5ub3QgdXNlIGRlc3RydWN0aXZlOnRydWUgdG8gZnVuY3Rpb24uJyk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGVuaGFuY2VtZW50ID0gZW5oYW5jZShhc3NlcnRGdW5jdGlvbiwgZm9ybWF0dGVyLCBjb25maWcpLFxuICAgICAgICAgICAgcG93ZXJBc3NlcnQgPSBmdW5jdGlvbiBwb3dlckFzc2VydCAoY29udGV4dCwgbWVzc2FnZSkge1xuICAgICAgICAgICAgICAgIGVuaGFuY2VtZW50KGNvbnRleHQsIG1lc3NhZ2UpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgZXh0ZW5kKHBvd2VyQXNzZXJ0LCBhc3NlcnRGdW5jdGlvbik7XG4gICAgICAgIHJldHVybiBleHRlbmQocG93ZXJBc3NlcnQsIGVuaGFuY2VtZW50KTtcbiAgICB9XG5cblxuICAgIGZ1bmN0aW9uIGVuaGFuY2UgKHRhcmdldCwgZm9ybWF0dGVyLCBjb25maWcpIHtcbiAgICAgICAgdmFyIGVhZ2VyRXZhbHVhdGlvbiA9ICEoY29uZmlnLm1vZGlmeU1lc3NhZ2VPbkZhaWwgfHwgY29uZmlnLnNhdmVDb250ZXh0T25GYWlsKSxcbiAgICAgICAgICAgIGRvUG93ZXJBc3NlcnQgPSBmdW5jdGlvbiAoYmFzZUFzc2VydCwgYXJncywgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICAgICAgICAgIHZhciBmO1xuICAgICAgICAgICAgICAgIGlmIChlYWdlckV2YWx1YXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgYXJncy5wdXNoKGJ1aWxkUG93ZXJBc3NlcnRUZXh0KG1lc3NhZ2UsIGNvbnRleHQpKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGJhc2VBc3NlcnQuYXBwbHkodGFyZ2V0LCBhcmdzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgYXJncy5wdXNoKG1lc3NhZ2UpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYmFzZUFzc2VydC5hcHBseSh0YXJnZXQsIGFyZ3MpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGUubmFtZSAhPT0gJ0Fzc2VydGlvbkVycm9yJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHRhcmdldC5Bc3NlcnRpb25FcnJvciAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAoaXNQaGFudG9tKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmID0gbmV3IHRhcmdldC5Bc3NlcnRpb25FcnJvcih7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0dWFsOiBlLmFjdHVhbCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogZS5leHBlY3RlZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcGVyYXRvcjogZS5vcGVyYXRvcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBlLm1lc3NhZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgZiA9IGU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5tb2RpZnlNZXNzYWdlT25GYWlsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmLm1lc3NhZ2UgPSBidWlsZFBvd2VyQXNzZXJ0VGV4dChtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgZS5nZW5lcmF0ZWRNZXNzYWdlICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGYuZ2VuZXJhdGVkTWVzc2FnZSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChjb25maWcuc2F2ZUNvbnRleHRPbkZhaWwpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGYucG93ZXJBc3NlcnRDb250ZXh0ID0gY29udGV4dDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBmO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBlbmhhbmNlbWVudCA9ICh0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nKSA/IGRlY29yYXRlT25lQXJnKHRhcmdldCwgdGFyZ2V0LCBkb1Bvd2VyQXNzZXJ0KSA6IHt9LFxuICAgICAgICAgICAgZXZlbnRzID0gW107XG5cbiAgICAgICAgZnVuY3Rpb24gYnVpbGRQb3dlckFzc2VydFRleHQgKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgICAgIHZhciBwb3dlckFzc2VydFRleHQgPSBmb3JtYXR0ZXIoY29udGV4dCk7XG4gICAgICAgICAgICByZXR1cm4gbWVzc2FnZSA/IG1lc3NhZ2UgKyAnICcgKyBwb3dlckFzc2VydFRleHQgOiBwb3dlckFzc2VydFRleHQ7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBfY2FwdCAodmFsdWUsIGtpbmQsIGxvY2F0aW9uKSB7XG4gICAgICAgICAgICBldmVudHMucHVzaCh7dmFsdWU6IHZhbHVlLCBraW5kOiBraW5kLCBsb2NhdGlvbjogbG9jYXRpb259KTtcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIF9leHByICh2YWx1ZSwgbG9jYXRpb24sIGNvbnRlbnQpIHtcbiAgICAgICAgICAgIHZhciBjYXB0dXJlZCA9IGV2ZW50cztcbiAgICAgICAgICAgIGV2ZW50cyA9IFtdO1xuICAgICAgICAgICAgcmV0dXJuIHsgcG93ZXJBc3NlcnRDb250ZXh0OiB7dmFsdWU6IHZhbHVlLCBsb2NhdGlvbjogbG9jYXRpb24sIGNvbnRlbnQ6IGNvbnRlbnQsIGV2ZW50czogY2FwdHVyZWR9IH07XG4gICAgICAgIH1cblxuICAgICAgICBjb25maWcudGFyZ2V0TWV0aG9kcy5vbmVBcmcuZm9yRWFjaChmdW5jdGlvbiAobWV0aG9kTmFtZSkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB0YXJnZXRbbWV0aG9kTmFtZV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgICBlbmhhbmNlbWVudFttZXRob2ROYW1lXSA9IGRlY29yYXRlT25lQXJnKHRhcmdldCwgdGFyZ2V0W21ldGhvZE5hbWVdLCBkb1Bvd2VyQXNzZXJ0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbmZpZy50YXJnZXRNZXRob2RzLnR3b0FyZ3MuZm9yRWFjaChmdW5jdGlvbiAobWV0aG9kTmFtZSkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB0YXJnZXRbbWV0aG9kTmFtZV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgICBlbmhhbmNlbWVudFttZXRob2ROYW1lXSA9IGRlY29yYXRlVHdvQXJncyh0YXJnZXQsIHRhcmdldFttZXRob2ROYW1lXSwgZG9Qb3dlckFzc2VydCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGVuaGFuY2VtZW50Ll9jYXB0ID0gX2NhcHQ7XG4gICAgICAgIGVuaGFuY2VtZW50Ll9leHByID0gX2V4cHI7XG4gICAgICAgIHJldHVybiBlbmhhbmNlbWVudDtcbiAgICB9XG5cblxuICAgIGZ1bmN0aW9uIGlzRXNwb3dlcmVkVmFsdWUgKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiAodHlwZW9mIHZhbHVlICE9PSAndW5kZWZpbmVkJykgJiYgKHR5cGVvZiB2YWx1ZS5wb3dlckFzc2VydENvbnRleHQgIT09ICd1bmRlZmluZWQnKTtcbiAgICB9XG5cblxuICAgIGZ1bmN0aW9uIGRlY29yYXRlT25lQXJnICh0YXJnZXQsIGJhc2VBc3NlcnQsIGRvUG93ZXJBc3NlcnQpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICh2YWx1ZSwgbWVzc2FnZSkge1xuICAgICAgICAgICAgdmFyIGNvbnRleHQ7XG4gICAgICAgICAgICBpZiAoISBpc0VzcG93ZXJlZFZhbHVlKHZhbHVlKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBiYXNlQXNzZXJ0LmFwcGx5KHRhcmdldCwgW3ZhbHVlLCBtZXNzYWdlXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250ZXh0ID0gdmFsdWUucG93ZXJBc3NlcnRDb250ZXh0O1xuICAgICAgICAgICAgcmV0dXJuIGRvUG93ZXJBc3NlcnQoYmFzZUFzc2VydCwgW2NvbnRleHQudmFsdWVdLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgfTtcbiAgICB9XG5cblxuICAgIGZ1bmN0aW9uIGRlY29yYXRlVHdvQXJncyAodGFyZ2V0LCBiYXNlQXNzZXJ0LCBkb1Bvd2VyQXNzZXJ0KSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoYXJnMSwgYXJnMiwgbWVzc2FnZSkge1xuICAgICAgICAgICAgdmFyIGNvbnRleHQsIHZhbDEsIHZhbDI7XG4gICAgICAgICAgICBpZiAoIShpc0VzcG93ZXJlZFZhbHVlKGFyZzEpIHx8IGlzRXNwb3dlcmVkVmFsdWUoYXJnMikpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGJhc2VBc3NlcnQuYXBwbHkodGFyZ2V0LCBbYXJnMSwgYXJnMiwgbWVzc2FnZV0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoaXNFc3Bvd2VyZWRWYWx1ZShhcmcxKSkge1xuICAgICAgICAgICAgICAgIGNvbnRleHQgPSBleHRlbmQoe30sIGFyZzEucG93ZXJBc3NlcnRDb250ZXh0KTtcbiAgICAgICAgICAgICAgICB2YWwxID0gYXJnMS5wb3dlckFzc2VydENvbnRleHQudmFsdWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhbDEgPSBhcmcxO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoaXNFc3Bvd2VyZWRWYWx1ZShhcmcyKSkge1xuICAgICAgICAgICAgICAgIGlmIChpc0VzcG93ZXJlZFZhbHVlKGFyZzEpKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRleHQuZXZlbnRzID0gY29udGV4dC5ldmVudHMuY29uY2F0KGFyZzIucG93ZXJBc3NlcnRDb250ZXh0LmV2ZW50cyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGV4dCA9IGV4dGVuZCh7fSwgYXJnMi5wb3dlckFzc2VydENvbnRleHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB2YWwyID0gYXJnMi5wb3dlckFzc2VydENvbnRleHQudmFsdWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhbDIgPSBhcmcyO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gZG9Qb3dlckFzc2VydChiYXNlQXNzZXJ0LCBbdmFsMSwgdmFsMl0sIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgICAgICB9O1xuICAgIH1cblxuXG4gICAgLy8gYm9ycm93ZWQgZnJvbSBxdW5pdC5qc1xuICAgIGZ1bmN0aW9uIGV4dGVuZCAoYSwgYikge1xuICAgICAgICB2YXIgcHJvcDtcbiAgICAgICAgZm9yIChwcm9wIGluIGIpIHtcbiAgICAgICAgICAgIGlmIChiLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBiW3Byb3BdID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgYVtwcm9wXTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBhW3Byb3BdID0gYltwcm9wXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGE7XG4gICAgfVxuXG5cbiAgICAvLyB1c2luZyByZXR1cm5FeHBvcnRzIFVNRCBwYXR0ZXJuIHdpdGggc3Vic3RhY2sgcGF0dGVyblxuICAgIGVtcG93ZXIuZGVmYXVsdE9wdGlvbnMgPSBkZWZhdWx0T3B0aW9ucztcbiAgICByZXR1cm4gZW1wb3dlcjtcbn0pKTtcbiIsIi8qKlxuICogcG93ZXItYXNzZXJ0LWZvcm1hdHRlci5qcyAtIFBvd2VyIEFzc2VydCBvdXRwdXQgZm9ybWF0dGVyXG4gKlxuICogaHR0cHM6Ly9naXRodWIuY29tL3R3YWRhL3Bvd2VyLWFzc2VydC1mb3JtYXR0ZXJcbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTMtMjAxNCBUYWt1dG8gV2FkYVxuICogTGljZW5zZWQgdW5kZXIgdGhlIE1JVCBsaWNlbnNlLlxuICogICBodHRwczovL3Jhdy5naXRodWIuY29tL3R3YWRhL3Bvd2VyLWFzc2VydC1mb3JtYXR0ZXIvbWFzdGVyL01JVC1MSUNFTlNFLnR4dFxuICpcbiAqIEEgcGFydCBvZiBleHRlbmQgZnVuY3Rpb24gaXM6XG4gKiAgIENvcHlyaWdodCAyMDEyIGpRdWVyeSBGb3VuZGF0aW9uIGFuZCBvdGhlciBjb250cmlidXRvcnNcbiAqICAgUmVsZWFzZWQgdW5kZXIgdGhlIE1JVCBsaWNlbnNlLlxuICogICBodHRwOi8vanF1ZXJ5Lm9yZy9saWNlbnNlXG4gKi9cbihmdW5jdGlvbiAocm9vdCwgZmFjdG9yeSkge1xuICAgICd1c2Ugc3RyaWN0JztcblxuICAgIC8vIHVzaW5nIHJldHVybkV4cG9ydHMgVU1EIHBhdHRlcm5cbiAgICBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XG4gICAgICAgIGRlZmluZShmYWN0b3J5KTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xuICAgICAgICBtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICByb290LnBvd2VyQXNzZXJ0Rm9ybWF0dGVyID0gZmFjdG9yeSgpO1xuICAgIH1cbn0odGhpcywgZnVuY3Rpb24gKCkge1xuICAgICd1c2Ugc3RyaWN0JztcblxuXG4gICAgZnVuY3Rpb24gZGVmYXVsdE9wdGlvbnMgKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgbGluZVNlcGFyYXRvcjogJ1xcbicsXG4gICAgICAgICAgICBkdW1wOiBqc29uRHVtcCxcbiAgICAgICAgICAgIHdpZHRoT2Y6IG11bHRpYnl0ZVN0cmluZ1dpZHRoT2ZcbiAgICAgICAgfTtcbiAgICB9XG5cblxuICAgIGZ1bmN0aW9uIFBvd2VyQXNzZXJ0Q29udGV4dFJlbmRlcmVyIChkdW1wLCB3aWR0aE9mLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZHVtcCA9IGR1bXA7XG4gICAgICAgIHRoaXMud2lkdGhPZiA9IHdpZHRoT2Y7XG4gICAgICAgIHRoaXMuaW5pdGlhbFZlcnRpdmFsQmFyTGVuZ3RoID0gMTtcbiAgICAgICAgdGhpcy5pbml0V2l0aENvbnRleHQoY29udGV4dCk7XG4gICAgfVxuXG4gICAgUG93ZXJBc3NlcnRDb250ZXh0UmVuZGVyZXIucHJvdG90eXBlLmluaXRXaXRoQ29udGV4dCA9IGZ1bmN0aW9uIChjb250ZXh0KSB7XG4gICAgICAgIGNvbnRleHQuZXZlbnRzLnNvcnQocmlnaHRUb0xlZnQpO1xuICAgICAgICB0aGlzLmV2ZW50cyA9IGNvbnRleHQuZXZlbnRzO1xuICAgICAgICB0aGlzLmFzc2VydGlvbkxpbmUgPSBjb250ZXh0LmNvbnRlbnQ7XG4gICAgICAgIHRoaXMuYXNzZXJ0aW9uTG9jYXRpb24gPSBjb250ZXh0LmxvY2F0aW9uO1xuICAgICAgICB0aGlzLnJvd3MgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPD0gdGhpcy5pbml0aWFsVmVydGl2YWxCYXJMZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgdGhpcy5hZGRPbmVNb3JlUm93KCk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgUG93ZXJBc3NlcnRDb250ZXh0UmVuZGVyZXIucHJvdG90eXBlLm5ld1Jvd0ZvciA9IGZ1bmN0aW9uIChhc3NlcnRpb25MaW5lKSB7XG4gICAgICAgIHJldHVybiBjcmVhdGVSb3codGhpcy53aWR0aE9mKGFzc2VydGlvbkxpbmUpLCAnICcpO1xuICAgIH07XG5cbiAgICBQb3dlckFzc2VydENvbnRleHRSZW5kZXJlci5wcm90b3R5cGUuYWRkT25lTW9yZVJvdyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5yb3dzLnB1c2godGhpcy5uZXdSb3dGb3IodGhpcy5hc3NlcnRpb25MaW5lKSk7XG4gICAgfTtcblxuICAgIFBvd2VyQXNzZXJ0Q29udGV4dFJlbmRlcmVyLnByb3RvdHlwZS5sYXN0Um93ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5yb3dzW3RoaXMucm93cy5sZW5ndGggLSAxXTtcbiAgICB9O1xuXG4gICAgUG93ZXJBc3NlcnRDb250ZXh0UmVuZGVyZXIucHJvdG90eXBlLnJlbmRlclZlcnRpY2FsQmFyQXQgPSBmdW5jdGlvbiAoY29sdW1uSW5kZXgpIHtcbiAgICAgICAgdmFyIGksIGxhc3RSb3dJbmRleCA9IHRoaXMucm93cy5sZW5ndGggLSAxO1xuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgbGFzdFJvd0luZGV4OyBpICs9IDEpIHtcbiAgICAgICAgICAgIHRoaXMucm93c1tpXS5zcGxpY2UoY29sdW1uSW5kZXgsIDEsICd8Jyk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgUG93ZXJBc3NlcnRDb250ZXh0UmVuZGVyZXIucHJvdG90eXBlLnJlbmRlclZhbHVlQXQgPSBmdW5jdGlvbiAoY29sdW1uSW5kZXgsIGR1bXBlZFZhbHVlKSB7XG4gICAgICAgIHZhciBpLCB3aWR0aCA9IHRoaXMud2lkdGhPZihkdW1wZWRWYWx1ZSk7XG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCB3aWR0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICB0aGlzLmxhc3RSb3coKS5zcGxpY2UoY29sdW1uSW5kZXggKyBpLCAxLCBkdW1wZWRWYWx1ZS5jaGFyQXQoaSkpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIFBvd2VyQXNzZXJ0Q29udGV4dFJlbmRlcmVyLnByb3RvdHlwZS5pc092ZXJsYXBwZWQgPSBmdW5jdGlvbiAocHJldkNhcHR1cmluZywgbmV4dENhcHV0dXJpbmcsIGR1bXBlZFZhbHVlKSB7XG4gICAgICAgIHJldHVybiAodHlwZW9mIHByZXZDYXB0dXJpbmcgIT09ICd1bmRlZmluZWQnKSAmJiB0aGlzLnN0YXJ0Q29sdW1uRm9yKHByZXZDYXB0dXJpbmcpIDw9ICh0aGlzLnN0YXJ0Q29sdW1uRm9yKG5leHRDYXB1dHVyaW5nKSArIHRoaXMud2lkdGhPZihkdW1wZWRWYWx1ZSkpO1xuICAgIH07XG5cbiAgICBQb3dlckFzc2VydENvbnRleHRSZW5kZXJlci5wcm90b3R5cGUuY29uc3RydWN0Um93cyA9IGZ1bmN0aW9uIChjYXB0dXJlZEV2ZW50cykge1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXMsXG4gICAgICAgICAgICBwcmV2Q2FwdHVyZWQ7XG4gICAgICAgIGNhcHR1cmVkRXZlbnRzLmZvckVhY2goZnVuY3Rpb24gKGNhcHR1cmVkKSB7XG4gICAgICAgICAgICB2YXIgZHVtcGVkVmFsdWUgPSB0aGF0LmR1bXAoY2FwdHVyZWQudmFsdWUpO1xuICAgICAgICAgICAgaWYgKHRoYXQuaXNPdmVybGFwcGVkKHByZXZDYXB0dXJlZCwgY2FwdHVyZWQsIGR1bXBlZFZhbHVlKSkge1xuICAgICAgICAgICAgICAgIHRoYXQuYWRkT25lTW9yZVJvdygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhhdC5yZW5kZXJWZXJ0aWNhbEJhckF0KHRoYXQuc3RhcnRDb2x1bW5Gb3IoY2FwdHVyZWQpKTtcbiAgICAgICAgICAgIHRoYXQucmVuZGVyVmFsdWVBdCh0aGF0LnN0YXJ0Q29sdW1uRm9yKGNhcHR1cmVkKSwgZHVtcGVkVmFsdWUpO1xuICAgICAgICAgICAgcHJldkNhcHR1cmVkID0gY2FwdHVyZWQ7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBQb3dlckFzc2VydENvbnRleHRSZW5kZXJlci5wcm90b3R5cGUuc3RhcnRDb2x1bW5Gb3IgPSBmdW5jdGlvbiAoY2FwdHVyZWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMud2lkdGhPZih0aGlzLmFzc2VydGlvbkxpbmUuc2xpY2UoMCwgY2FwdHVyZWQubG9jYXRpb24uc3RhcnQuY29sdW1uKSk7XG4gICAgfTtcblxuICAgIFBvd2VyQXNzZXJ0Q29udGV4dFJlbmRlcmVyLnByb3RvdHlwZS5yZW5kZXJMaW5lcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGxpbmVzID0gW107XG4gICAgICAgIHRoaXMuY29uc3RydWN0Um93cyh0aGlzLmV2ZW50cyk7XG4gICAgICAgIGlmICh0aGlzLmFzc2VydGlvbkxvY2F0aW9uLnBhdGgpIHtcbiAgICAgICAgICAgIGxpbmVzLnB1c2goJyMgJyArIFt0aGlzLmFzc2VydGlvbkxvY2F0aW9uLnBhdGgsIHRoaXMuYXNzZXJ0aW9uTG9jYXRpb24uc3RhcnQubGluZV0uam9pbignOicpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxpbmVzLnB1c2goJyMgYXQgbGluZTogJyArIHRoaXMuYXNzZXJ0aW9uTG9jYXRpb24uc3RhcnQubGluZSk7XG4gICAgICAgIH1cbiAgICAgICAgbGluZXMucHVzaCgnJyk7XG4gICAgICAgIGxpbmVzLnB1c2godGhpcy5hc3NlcnRpb25MaW5lKTtcbiAgICAgICAgdGhpcy5yb3dzLmZvckVhY2goZnVuY3Rpb24gKGNvbHVtbnMpIHtcbiAgICAgICAgICAgIGxpbmVzLnB1c2goY29sdW1ucy5qb2luKCcnKSk7XG4gICAgICAgIH0pO1xuICAgICAgICBsaW5lcy5wdXNoKCcnKTtcbiAgICAgICAgcmV0dXJuIGxpbmVzO1xuICAgIH07XG5cblxuICAgIGZ1bmN0aW9uIGNyZWF0ZVJvdyAobnVtQ29scywgaW5pdGlhbCkge1xuICAgICAgICB2YXIgcm93ID0gW10sIGk7XG4gICAgICAgIGZvcihpID0gMDsgaSA8IG51bUNvbHM7IGkgKz0gMSkge1xuICAgICAgICAgICAgcm93W2ldID0gaW5pdGlhbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcm93O1xuICAgIH1cblxuXG4gICAgZnVuY3Rpb24gcmlnaHRUb0xlZnQgKGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIGIubG9jYXRpb24uc3RhcnQuY29sdW1uIC0gYS5sb2NhdGlvbi5zdGFydC5jb2x1bW47XG4gICAgfVxuXG5cbiAgICBmdW5jdGlvbiBtdWx0aWJ5dGVTdHJpbmdXaWR0aE9mIChzdHIpIHtcbiAgICAgICAgdmFyIGksIGMsIHdpZHRoID0gMDtcbiAgICAgICAgZm9yKGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSs9MSl7XG4gICAgICAgICAgICBjID0gc3RyLmNoYXJDb2RlQXQoaSk7XG4gICAgICAgICAgICBpZiAoKDB4MCA8PSBjICYmIGMgPCAweDgxKSB8fCAoYyA9PT0gMHhmOGYwKSB8fCAoMHhmZjYxIDw9IGMgJiYgYyA8IDB4ZmZhMCkgfHwgKDB4ZjhmMSA8PSBjICYmIGMgPCAweGY4ZjQpKSB7XG4gICAgICAgICAgICAgICAgd2lkdGggKz0gMTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgd2lkdGggKz0gMjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gd2lkdGg7XG4gICAgfVxuXG5cbiAgICBmdW5jdGlvbiBqc29uRHVtcCAob2JqKSB7XG4gICAgICAgIHZhciBzZWVuID0gW10sXG4gICAgICAgICAgICByZXBsYWNlciA9IGZ1bmN0aW9uKGtleSwgdmFsKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWwgPT09ICdvYmplY3QnICYmIHZhbCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoc2Vlbi5pbmRleE9mKHZhbCkgIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJyNDaXJjdWxhciMnO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHNlZW4ucHVzaCh2YWwpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN0ciA9IEpTT04uc3RyaW5naWZ5KG9iaiwgcmVwbGFjZXIpO1xuICAgICAgICBpZiAodHlwZW9mIHN0ciA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgIHJldHVybiAndW5kZWZpbmVkJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc3RyO1xuICAgIH1cblxuXG4gICAgLy8gYm9ycm93ZWQgZnJvbSBxdW5pdC5qc1xuICAgIGZ1bmN0aW9uIGV4dGVuZCAoYSwgYikge1xuICAgICAgICB2YXIgcHJvcDtcbiAgICAgICAgZm9yIChwcm9wIGluIGIpIHtcbiAgICAgICAgICAgIGlmIChiLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBiW3Byb3BdID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgYVtwcm9wXTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBhW3Byb3BdID0gYltwcm9wXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGE7XG4gICAgfVxuXG5cbiAgICBmdW5jdGlvbiBjcmVhdGUgKG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IGV4dGVuZChkZWZhdWx0T3B0aW9ucygpLCAob3B0aW9ucyB8fCB7fSkpO1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGNvbnRleHQpIHtcbiAgICAgICAgICAgIHZhciByZW5kZXJlciA9IG5ldyBQb3dlckFzc2VydENvbnRleHRSZW5kZXJlcihjb25maWcuZHVtcCwgY29uZmlnLndpZHRoT2YsIGNvbnRleHQpO1xuICAgICAgICAgICAgcmV0dXJuIHJlbmRlcmVyLnJlbmRlckxpbmVzKCkuam9pbihjb25maWcubGluZVNlcGFyYXRvcik7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgY3JlYXRlLlBvd2VyQXNzZXJ0Q29udGV4dFJlbmRlcmVyID0gUG93ZXJBc3NlcnRDb250ZXh0UmVuZGVyZXI7XG4gICAgcmV0dXJuIGNyZWF0ZTtcbn0pKTtcbiIsInZhciBhc3NlcnQ7XG5hc3NlcnQgPSByZXF1aXJlKCdwb3dlci1hc3NlcnQnKTtcbmRlc2NyaWJlKCdBcnJheSNpbmRleE9mKCknLCBmdW5jdGlvbiAoKSB7XG4gICAgYmVmb3JlRWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmFyeSA9IFtcbiAgICAgICAgICAgIDEsXG4gICAgICAgICAgICAyLFxuICAgICAgICAgICAgM1xuICAgICAgICBdO1xuICAgIH0pO1xuICAgIGl0KCdzaG91bGQgcmV0dXJuIGluZGV4IHdoZW4gdGhlIHZhbHVlIGlzIHByZXNlbnQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBtaW51c09uZSwgd2hvO1xuICAgICAgICB3aG8gPSAnYXJpeWEnO1xuICAgICAgICBtaW51c09uZSA9IC0xO1xuICAgICAgICByZXR1cm4gYXNzZXJ0KGFzc2VydC5fZXhwcihhc3NlcnQuX2NhcHQoYXNzZXJ0Ll9jYXB0KGFzc2VydC5fY2FwdCh0aGlzLmFyeSwgJ2xlZnQvY2FsbGVlL29iamVjdCcpLmluZGV4T2YoYXNzZXJ0Ll9jYXB0KHdobywgJ2xlZnQvYXJndW1lbnRzLzAnKSksICdsZWZ0JykgIT09IGFzc2VydC5fY2FwdChtaW51c09uZSwgJ3JpZ2h0JyksICcnKSwge1xuICAgICAgICAgICAgdHJlZToge1xuICAgICAgICAgICAgICAgICd0eXBlJzogJ0JpbmFyeUV4cHJlc3Npb24nLFxuICAgICAgICAgICAgICAgICdvcGVyYXRvcic6ICchPT0nLFxuICAgICAgICAgICAgICAgICdsZWZ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdDYWxsRXhwcmVzc2lvbicsXG4gICAgICAgICAgICAgICAgICAgICdjYWxsZWUnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdNZW1iZXJFeHByZXNzaW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdjb21wdXRlZCc6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ29iamVjdCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdNZW1iZXJFeHByZXNzaW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29tcHV0ZWQnOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnb2JqZWN0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdUaGlzRXhwcmVzc2lvbicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMThcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDIyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3NvdXJjZSc6ICcvVXNlcnMva2VuL3dvcmsvbmFuY2xlL3Rlc3QvdGVzdC5jb2ZmZWUnXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdwcm9wZXJ0eSc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnSWRlbnRpZmllcicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICduYW1lJzogJ2FyeScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMjNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDI2XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3NvdXJjZSc6ICcvVXNlcnMva2VuL3dvcmsvbmFuY2xlL3Rlc3QvdGVzdC5jb2ZmZWUnXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMThcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMjZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3NvdXJjZSc6ICcvVXNlcnMva2VuL3dvcmsvbmFuY2xlL3Rlc3QvdGVzdC5jb2ZmZWUnXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdwcm9wZXJ0eSc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdJZGVudGlmaWVyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbmFtZSc6ICdpbmRleE9mJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDI3XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDM0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzb3VyY2UnOiAnL1VzZXJzL2tlbi93b3JrL25hbmNsZS90ZXN0L3Rlc3QuY29mZmVlJ1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDE4XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMzRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzb3VyY2UnOiAnL1VzZXJzL2tlbi93b3JrL25hbmNsZS90ZXN0L3Rlc3QuY29mZmVlJ1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAnYXJndW1lbnRzJzogW3tcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdJZGVudGlmaWVyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbmFtZSc6ICd3aG8nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMzVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMzhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3NvdXJjZSc6ICcvVXNlcnMva2VuL3dvcmsvbmFuY2xlL3Rlc3QvdGVzdC5jb2ZmZWUnXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMThcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDM5XG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3NvdXJjZSc6ICcvVXNlcnMva2VuL3dvcmsvbmFuY2xlL3Rlc3QvdGVzdC5jb2ZmZWUnXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICdyaWdodCc6IHtcbiAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnSWRlbnRpZmllcicsXG4gICAgICAgICAgICAgICAgICAgICduYW1lJzogJ21pbnVzT25lJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiA0NFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogNTJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAnc291cmNlJzogJy9Vc2Vycy9rZW4vd29yay9uYW5jbGUvdGVzdC90ZXN0LmNvZmZlZSdcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAxOFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiA1MlxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAnc291cmNlJzogJy9Vc2Vycy9rZW4vd29yay9uYW5jbGUvdGVzdC90ZXN0LmNvZmZlZSdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdG9rZW5zOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdLZXl3b3JkJyxcbiAgICAgICAgICAgICAgICAgICAgJ3ZhbHVlJzogJ3RoaXMnLFxuICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDE4XG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAyMlxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICd0eXBlJzogJ1B1bmN0dWF0b3InLFxuICAgICAgICAgICAgICAgICAgICAndmFsdWUnOiAnLicsXG4gICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMjJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDIzXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnSWRlbnRpZmllcicsXG4gICAgICAgICAgICAgICAgICAgICd2YWx1ZSc6ICdhcnknLFxuICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDIzXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAyNlxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICd0eXBlJzogJ1B1bmN0dWF0b3InLFxuICAgICAgICAgICAgICAgICAgICAndmFsdWUnOiAnLicsXG4gICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMjZcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDI3XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnSWRlbnRpZmllcicsXG4gICAgICAgICAgICAgICAgICAgICd2YWx1ZSc6ICdpbmRleE9mJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAyN1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMzRcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdQdW5jdHVhdG9yJyxcbiAgICAgICAgICAgICAgICAgICAgJ3ZhbHVlJzogJygnLFxuICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDM0XG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAzNVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICd0eXBlJzogJ0lkZW50aWZpZXInLFxuICAgICAgICAgICAgICAgICAgICAndmFsdWUnOiAnd2hvJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAzNVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMzhcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdQdW5jdHVhdG9yJyxcbiAgICAgICAgICAgICAgICAgICAgJ3ZhbHVlJzogJyknLFxuICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDM4XG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAzOVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICd0eXBlJzogJ1B1bmN0dWF0b3InLFxuICAgICAgICAgICAgICAgICAgICAndmFsdWUnOiAnIT09JyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiA0MFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogNDNcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdJZGVudGlmaWVyJyxcbiAgICAgICAgICAgICAgICAgICAgJ3ZhbHVlJzogJ21pbnVzT25lJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDEzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiA0NFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxMyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogNTJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBjb250ZW50OiAnICAgIHJldHVybiBhc3NlcnQodGhpcy5hcnkuaW5kZXhPZih3aG8pICE9PSBtaW51c09uZSk7JyxcbiAgICAgICAgICAgIGZpbGVwYXRoOiAnL1VzZXJzL2tlbi93b3JrL25hbmNsZS90ZXN0L3Rlc3QuY29mZmVlJ1xuICAgICAgICB9KSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGl0KCdzaG91bGQgcmV0dXJuIC0xIHdoZW4gdGhlIHZhbHVlIGlzIG5vdCBwcmVzZW50JywgZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgbWludXNPbmUsIHR3bztcbiAgICAgICAgbWludXNPbmUgPSAtMTtcbiAgICAgICAgdHdvID0gMjtcbiAgICAgICAgcmV0dXJuIGFzc2VydC5vayhhc3NlcnQuX2V4cHIoYXNzZXJ0Ll9jYXB0KGFzc2VydC5fY2FwdChhc3NlcnQuX2NhcHQodGhpcy5hcnksICdsZWZ0L2NhbGxlZS9vYmplY3QnKS5pbmRleE9mKGFzc2VydC5fY2FwdCh0d28sICdsZWZ0L2FyZ3VtZW50cy8wJykpLCAnbGVmdCcpID09PSBhc3NlcnQuX2NhcHQobWludXNPbmUsICdyaWdodCcpLCAnJyksIHtcbiAgICAgICAgICAgIHRyZWU6IHtcbiAgICAgICAgICAgICAgICAndHlwZSc6ICdCaW5hcnlFeHByZXNzaW9uJyxcbiAgICAgICAgICAgICAgICAnb3BlcmF0b3InOiAnPT09JyxcbiAgICAgICAgICAgICAgICAnbGVmdCc6IHtcbiAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnQ2FsbEV4cHJlc3Npb24nLFxuICAgICAgICAgICAgICAgICAgICAnY2FsbGVlJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnTWVtYmVyRXhwcmVzc2lvbicsXG4gICAgICAgICAgICAgICAgICAgICAgICAnY29tcHV0ZWQnOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdvYmplY3QnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnTWVtYmVyRXhwcmVzc2lvbicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbXB1dGVkJzogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ29iamVjdCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnVGhpc0V4cHJlc3Npb24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDIxXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAyNVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzb3VyY2UnOiAnL1VzZXJzL2tlbi93b3JrL25hbmNsZS90ZXN0L3Rlc3QuY29mZmVlJ1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAncHJvcGVydHknOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICd0eXBlJzogJ0lkZW50aWZpZXInLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbmFtZSc6ICdhcnknLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDI2XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAyOVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzb3VyY2UnOiAnL1VzZXJzL2tlbi93b3JrL25hbmNsZS90ZXN0L3Rlc3QuY29mZmVlJ1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDIxXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDI5XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzb3VyY2UnOiAnL1VzZXJzL2tlbi93b3JrL25hbmNsZS90ZXN0L3Rlc3QuY29mZmVlJ1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAncHJvcGVydHknOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnSWRlbnRpZmllcicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ25hbWUnOiAnaW5kZXhPZicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAzMFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAzN1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc291cmNlJzogJy9Vc2Vycy9rZW4vd29yay9uYW5jbGUvdGVzdC90ZXN0LmNvZmZlZSdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAyMVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDM3XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc291cmNlJzogJy9Vc2Vycy9rZW4vd29yay9uYW5jbGUvdGVzdC90ZXN0LmNvZmZlZSdcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgJ2FyZ3VtZW50cyc6IFt7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnSWRlbnRpZmllcicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ25hbWUnOiAndHdvJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDM4XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDQxXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzb3VyY2UnOiAnL1VzZXJzL2tlbi93b3JrL25hbmNsZS90ZXN0L3Rlc3QuY29mZmVlJ1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDIxXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiA0MlxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzb3VyY2UnOiAnL1VzZXJzL2tlbi93b3JrL25hbmNsZS90ZXN0L3Rlc3QuY29mZmVlJ1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAncmlnaHQnOiB7XG4gICAgICAgICAgICAgICAgICAgICd0eXBlJzogJ0lkZW50aWZpZXInLFxuICAgICAgICAgICAgICAgICAgICAnbmFtZSc6ICdtaW51c09uZScsXG4gICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogNDdcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDU1XG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3NvdXJjZSc6ICcvVXNlcnMva2VuL3dvcmsvbmFuY2xlL3Rlc3QvdGVzdC5jb2ZmZWUnXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMjFcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogNTVcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgJ3NvdXJjZSc6ICcvVXNlcnMva2VuL3dvcmsvbmFuY2xlL3Rlc3QvdGVzdC5jb2ZmZWUnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHRva2VuczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnS2V5d29yZCcsXG4gICAgICAgICAgICAgICAgICAgICd2YWx1ZSc6ICd0aGlzJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAyMVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMjVcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdQdW5jdHVhdG9yJyxcbiAgICAgICAgICAgICAgICAgICAgJ3ZhbHVlJzogJy4nLFxuICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDI1XG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAyNlxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICd0eXBlJzogJ0lkZW50aWZpZXInLFxuICAgICAgICAgICAgICAgICAgICAndmFsdWUnOiAnYXJ5JyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAyNlxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMjlcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdQdW5jdHVhdG9yJyxcbiAgICAgICAgICAgICAgICAgICAgJ3ZhbHVlJzogJy4nLFxuICAgICAgICAgICAgICAgICAgICAnbG9jJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXJ0Jzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDI5XG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VuZCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAzMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICd0eXBlJzogJ0lkZW50aWZpZXInLFxuICAgICAgICAgICAgICAgICAgICAndmFsdWUnOiAnaW5kZXhPZicsXG4gICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMzBcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDM3XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnUHVuY3R1YXRvcicsXG4gICAgICAgICAgICAgICAgICAgICd2YWx1ZSc6ICcoJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiAzN1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMzhcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdJZGVudGlmaWVyJyxcbiAgICAgICAgICAgICAgICAgICAgJ3ZhbHVlJzogJ3R3bycsXG4gICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogMzhcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDQxXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnUHVuY3R1YXRvcicsXG4gICAgICAgICAgICAgICAgICAgICd2YWx1ZSc6ICcpJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xvYyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGFydCc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbGluZSc6IDE5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjb2x1bW4nOiA0MVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbmQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogNDJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAndHlwZSc6ICdQdW5jdHVhdG9yJyxcbiAgICAgICAgICAgICAgICAgICAgJ3ZhbHVlJzogJz09PScsXG4gICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogNDNcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDQ2XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnSWRlbnRpZmllcicsXG4gICAgICAgICAgICAgICAgICAgICd2YWx1ZSc6ICdtaW51c09uZScsXG4gICAgICAgICAgICAgICAgICAgICdsb2MnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RhcnQnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2xpbmUnOiAxOSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnY29sdW1uJzogNDdcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW5kJzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdsaW5lJzogMTksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbHVtbic6IDU1XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgY29udGVudDogJyAgICByZXR1cm4gYXNzZXJ0Lm9rKHRoaXMuYXJ5LmluZGV4T2YodHdvKSA9PT0gbWludXNPbmUsIFxcJ1RISVMgSVMgQU4gQVNTRVJUSU9OIE1FU1NBR0VcXCcpOycsXG4gICAgICAgICAgICBmaWxlcGF0aDogJy9Vc2Vycy9rZW4vd29yay9uYW5jbGUvdGVzdC90ZXN0LmNvZmZlZSdcbiAgICAgICAgfSksICdUSElTIElTIEFOIEFTU0VSVElPTiBNRVNTQUdFJyk7XG4gICAgfSk7XG59KTtcbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWRhdGE6YXBwbGljYXRpb24vanNvbjtiYXNlNjQsZXlKMlpYSnphVzl1SWpvekxDSnpiM1Z5WTJWeklqcGJJaTlWYzJWeWN5OXJaVzR2ZDI5eWF5OXVZVzVqYkdVdmRHVnpkQzkwWlhOMExtTnZabVpsWlNKZExDSnVZVzFsY3lJNld5SmhjM05sY25RaUxDSnlaWEYxYVhKbElpd2laR1Z6WTNKcFltVWlMQ0ppWldadmNtVkZZV05vSWl3aVlYSjVJaXdpYVhRaUxDSnRhVzUxYzA5dVpTSXNJbmRvYnlJc0lsOWxlSEJ5SWl3aVgyTmhjSFFpTENKcGJtUmxlRTltSWl3aWRISmxaU0lzSW5SdmEyVnVjeUlzSW1OdmJuUmxiblFpTENKbWFXeGxjR0YwYUNJc0luUjNieUlzSW05cklsMHNJbTFoY0hCcGJtZHpJam9pUVVGQlFTeEpRVUZKUVN4TlFVRktPMEZCUlVGQkxFMUJRVUVzUjBGQlUwTXNUMEZCUVN4RFFVRlJMR05CUVZJc1EwRkJWQ3hEUVVaQk8wRkJTVUZETEZGQlFVRXNRMEZCVXl4cFFrRkJWQ3hGUVVFMFFpeFpRVUZYTzBGQlFVRXNTVUZEY2tORExGVkJRVUVzUTBGQlZ5eFpRVUZYTzBGQlFVRXNVVUZEY0VJc1QwRkJUeXhMUVVGTFF5eEhRVUZNTEVkQlFWYzdRVUZCUVN4WlFVRkRMRU5CUVVRN1FVRkJRU3haUVVGSkxFTkJRVW83UVVGQlFTeFpRVUZQTEVOQlFWQTdRVUZCUVN4VFFVRnNRaXhEUVVSdlFqdEJRVUZCTEV0QlFYUkNMRVZCUkhGRE8wRkJRVUVzU1VGSmNrTkRMRVZCUVVFc1EwRkJSeXdyUTBGQlNDeEZRVUZ2UkN4WlFVRlhPMEZCUVVFc1VVRkROMFFzU1VGQlNVTXNVVUZCU2l4RlFVRmpReXhIUVVGa0xFTkJSRFpFTzBGQlFVRXNVVUZGTjBSQkxFZEJRVUVzUjBGQlRTeFBRVUZPTEVOQlJqWkVPMEZCUVVFc1VVRkhOMFJFTEZGQlFVRXNSMEZCVnl4RFFVRkRMRU5CUVZvc1EwRklOa1E3UVVGQlFTeFJRVWszUkN4UFFVRlBUaXhOUVVGQkxFTkJRVTlCTEUxQlFVRXNRMEZCUVZFc1MwRkJRU3hEUVVGQlVpeE5RVUZCTEVOQlFVRlRMRXRCUVVFc1EwRkJRVlFzVFVGQlFTeERRVUZCVXl4TFFVRkJMRU5CUVVGVUxFMUJRVUVzUTBGQlFWTXNTMEZCUVN4TlFVRkxUQ3hIUVVGTUxIZENRVUZUVFN4UFFVRlVMRU5CUVdsQ1ZpeE5RVUZCTEVOQlFVRlRMRXRCUVVFc1EwRkJRVVlzUjBGQlFTeHhRa0ZCYWtJc1pVRkJNRUpRTEUxQlFVRXNRMEZCUVZNc1MwRkJRU3hEUVVGQlNDeFJRVUZCTEZWQlFURkNPMEZCUVVFc1dVRkJRVXNzU1VGQlFTeEZPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN1lVRkJRVHRCUVVGQkxGbEJRVUZETEUxQlFVRXNSVHM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN08yRkJRVUU3UVVGQlFTeFpRVUZCUXl4UFFVRkJPMEZCUVVFc1dVRkJRVU1zVVVGQlFUdEJRVUZCTEZWQlFWQXNRMEZCVUN4RFFVbzJSRHRCUVVGQkxFdEJRUzlFTEVWQlNuRkRPMEZCUVVFc1NVRlZja01zVDBGQlQxUXNSVUZCUVN4RFFVRkhMR2RFUVVGSUxFVkJRWEZFTEZsQlFWYzdRVUZCUVN4UlFVTnlSU3hKUVVGSlF5eFJRVUZLTEVWQlFXTlRMRWRCUVdRc1EwRkVjVVU3UVVGQlFTeFJRVVZ5UlZRc1VVRkJRU3hIUVVGWExFTkJRVU1zUTBGQldpeERRVVp4UlR0QlFVRkJMRkZCUjNKRlV5eEhRVUZCTEVkQlFVMHNRMEZCVGl4RFFVaHhSVHRCUVVGQkxGRkJTWEpGTEU5QlFVOW1MRTFCUVVFc1EwRkJUMmRDTEVWQlFWQXNRMEZCVldoQ0xFMUJRVUVzUTBGQlFWRXNTMEZCUVN4RFFVRkJVaXhOUVVGQkxFTkJRVUZUTEV0QlFVRXNRMEZCUVZRc1RVRkJRU3hEUVVGQlV5eExRVUZCTEVOQlFVRlVMRTFCUVVFc1EwRkJRVk1zUzBGQlFTeE5RVUZMVEN4SFFVRk1MSGRDUVVGVFRTeFBRVUZVTEVOQlFXbENWaXhOUVVGQkxFTkJRVUZUTEV0QlFVRXNRMEZCUVUwc1IwRkJRU3h4UWtGQmFrSXNaVUZCTUVKbUxFMUJRVUVzUTBGQlFWTXNTMEZCUVN4RFFVRkJTQ3hSUVVGQkxGVkJRVEZDTzBGQlFVRXNXVUZCUVVzc1NVRkJRU3hGT3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdZVUZCUVR0QlFVRkJMRmxCUVVGRExFMUJRVUVzUlRzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPenM3T3pzN096czdPMkZCUVVFN1FVRkJRU3haUVVGQlF5eFBRVUZCTzBGQlFVRXNXVUZCUVVNc1VVRkJRVHRCUVVGQkxGVkJRVllzUlVGQk9FTXNPRUpCUVRsRExFTkJRVkFzUTBGS2NVVTdRVUZCUVN4TFFVRm9SU3hEUVVGUUxFTkJWbkZETzBGQlFVRXNRMEZCZGtNaWZRPT1cbiJdfQ==
