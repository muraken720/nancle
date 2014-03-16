vm = require './viewmodel'
model = require './model'

demo = new vm.Demo
  el: '#container'
  data:
    message: 'Hello nancle!'

menu = new vm.Menu
  el: '#list'
  data:
    people: []

ken = new model.Person
  firstName: 'Kenichiro'
  lastName: 'Murata'

menu.$data.people.push ken

console.log JSON.stringify(menu.$data)

acro = new model.Person
  firstName: 'Acroquest'
  lastName: 'Technology'

menu.$data.people.push acro

console.log JSON.stringify(menu.$data)

ken.firstName = 'Ken'

console.log JSON.stringify(menu.$data)
