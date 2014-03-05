gulp = require 'gulp'
templatizer = require 'templatizer'
shell = require 'gulp-shell'
coffee = require 'gulp-coffee'
stylus = require 'gulp-stylus'
connect = require 'gulp-connect'

gulp.task 'connect', connect.server(
  root: ['public']
  port: 1337
  livereload: true
  open:
    browser: 'Google Chrome'
)

gulp.task 'templatizer', ->
  templatizer(__dirname + '/src/jade/templates', __dirname + '/public/js/templates.js')

gulp.task('createIndex', shell.task([
  'jade -P src/jade/index.jade -o public'
]))

gulp.task 'copy', ->
  gulp.src('bower_components/vue/dist/vue.min.js')
    .pipe(gulp.dest('public/js/lib'))

gulp.task 'coffee', ->
  gulp.src('src/coffee/**/*.coffee')
    .pipe(coffee())
    .pipe(gulp.dest('public/js'))

gulp.task 'stylus', ->
  gulp.src('src/styl/*.styl')
    .pipe(stylus(
      use: ['jeet']
    ))
    .pipe(gulp.dest('public/css'))
    .pipe(connect.reload())

gulp.task 'js', ->
  gulp.src('public/js/*.js')
    .pipe(connect.reload())

gulp.task 'html', ->
  gulp.src('public/index.html')
    .pipe(connect.reload())

gulp.task 'watch', ->
  gulp.watch ['src/jade/*.jade'], ['createIndex']
  gulp.watch ['src/jade/templates/**/*.jade'], ['templatizer']
  gulp.watch ['src/coffee/**/*.coffee'], ['coffee']
  gulp.watch ['src/styl/*.styl'], ['stylus']
  gulp.watch ['public/js/*.js'], ['js']
  gulp.watch ['public/index.html'], ['html']

gulp.task 'default', [
  'connect'
  'templatizer'
  'coffee'
  'stylus'
  'watch'
]

