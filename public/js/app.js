(function() {
  var demo;

  demo = new Vue({
    el: '#container',
    template: templatizer.demo(),
    data: {
      message: 'Hello nancle!'
    }
  });

}).call(this);
