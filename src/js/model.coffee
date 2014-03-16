module.exports =
  Person: class Person
    constructor: (options) ->
      {@firstName, @lastName} = options
