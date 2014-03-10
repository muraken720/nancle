gulp = require 'gulp'
templatizer = require 'templatizer'
shell = require 'gulp-shell'
coffee = require 'gulp-coffee'
stylus = require 'gulp-stylus'
connect = require 'gulp-connect'
browserify = require 'gulp-browserify'

gulp.task 'connect', connect.server(
  root: ['public']
  port: 1337
  livereload: true
  open:
    browser: 'Google Chrome'
)

gulp.task 'templatizer', ->
  templatizer(__dirname + '/src/jade/templates', __dirname + '/src/js/templates.js')

gulp.task('jade', shell.task([
  'jade -P src/jade/index.jade -o public'
]))

gulp.task 'coffee', ->
  gulp.src('src/coffee/**/*.coffee')
    .pipe(coffee())
    .pipe(gulp.dest('src/js'))

gulp.task 'stylus', ->
  gulp.src('src/styl/*.styl')
    .pipe(stylus(
      use: ['jeet']
    ))
    .pipe(gulp.dest('public/css'))
    .pipe(connect.reload())

gulp.task 'browserify', ->
  gulp.src('src/js/app.js')
    .pipe(browserify(
      insertGlobals: true
    ))
    .pipe(gulp.dest('public/js'))
    .pipe(connect.reload())

gulp.task 'html', ->
  gulp.src('public/index.html')
    .pipe(connect.reload())

gulp.task 'watch', ->
  gulp.watch ['src/jade/*.jade'], ['jade']
  gulp.watch ['src/jade/templates/**/*.jade'], ['templatizer']
  gulp.watch ['src/coffee/**/*.coffee'], ['coffee']
  gulp.watch ['src/styl/*.styl'], ['stylus']
  gulp.watch ['src/js/*.js'], ['browserify']
  gulp.watch ['public/index.html'], ['html']

gulp.task 'default', [
  'connect'
  'templatizer'
  'jade'
  'coffee'
  'stylus'
  'watch'
]

