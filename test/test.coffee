assert = require 'power-assert'

describe 'Array#indexOf()', ->
  beforeEach ->
    this.ary = [1, 2, 3]

  it 'should return index when the value is present', ->
    who = 'ariya'
    minusOne = -1
    assert this.ary.indexOf(who) isnt minusOne

  it 'should return -1 when the value is not present', ->
    minusOne = -1
    two = 2
    assert.ok this.ary.indexOf(two) is minusOne, 'THIS IS AN ASSERTION MESSAGE'
