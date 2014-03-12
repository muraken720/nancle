_ = require 'underscore'
Backbone = require 'backbone'
Vue = require 'vue'
templates = require './templates'

demo = new Vue
  el: '#container'
  template: templates.demo()
  data:
    message: 'Hello nancle!'

class Person
  constructor: (options) ->
    {@firstName, @lastName} = options

ken = new Person
  firstName: 'Kenichiro'
  lastName: 'Murata'

console.log(JSON.stringify(ken))

menu = new Vue
  el: '#list'
  template: templates.list()
  data:
    people: []

menu.$data.people.push ken

acro = new Person
  firstName: 'Acroquest'
  lastName: 'Technology'

ken.firstName = 'Ken'

menu.$data.people.push acro
