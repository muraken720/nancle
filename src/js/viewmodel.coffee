Vue = require 'vue'
templates = require './_templates.js'

module.exports =
  Demo: Vue.extend
    template: templates.demo()

  Menu: Vue.extend
    template: templates.list()
