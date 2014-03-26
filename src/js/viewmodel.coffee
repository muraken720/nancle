Vue = require 'vue'
templates = require './_templates.js'
#model = require './model'

Vue.component 'nancle-home', Vue.extend
  template: templates.home()
  created: () ->
    @msg = 'Home sweet home!'

Vue.component 'nancle-page1', Vue.extend
  template: templates.page1()
  created: () ->
    @msg = 'Welcome to page 1!'

Vue.component 'nancle-page2', Vue.extend
  template: templates.page2()
  created: () ->
    @msg = 'Welcome to page 2!'

Vue.component 'nancle-notfound', Vue.extend
  template: templates.notfound()

