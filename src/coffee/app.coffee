_ = require 'underscore'
Backbone = require 'backbone'
Vue = require 'vue'
templates = require './templates'

demo = new Vue
  el: '#container'
  template: templates.demo()
  data:
    message: 'Hello nancle!'

