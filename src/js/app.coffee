Vue = require 'vue'
nancle = require './router'
templates = require './_templates.js'
vm = require './viewmodel'

router = new nancle.Router {routes: ['home', 'page1', 'page2']}

initialView = router.getRoute()

container = new Vue
  el: '#container'
  template: templates.container()
  data:
    currentView: initialView
    routes: router.routes
    subdata:
      test: 'Vert.x'
  created: () ->
    window.addEventListener 'hashchange', () =>
      @currentView = router.getRoute()
