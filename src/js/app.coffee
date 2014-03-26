Vue = require 'vue'
nancle = require './router'
templates = require './_templates.js'
vm = require './viewmodel'

router = new nancle.Router {routes: ['home', 'page1', 'page2']}

initialRoute = router.getRoute()

container = new Vue
  el: '#container'
  template: templates.container()
  data:
    currentRoute: initialRoute
    routes: router.routes
    subdata:
      test: '123'
  computed:
    currentView:
      $get: () ->
        'nancle-' + @currentRoute
  created: () ->
    window.addEventListener 'hashchange', () =>
      @currentRoute = router.getRoute()
