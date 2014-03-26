module.exports =
  Router: class Router
    constructor: (options) ->
      {@routes} = options

    getRoute: () ->
      path = location.hash.replace(/^#!\/?/, '') || 'home'
      return if @routes.indexOf(path) > -1 then path else 'notfound'
