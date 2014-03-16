gulp = require 'gulp'
templatizer = require 'templatizer'
browserify = require 'gulp-browserify'
plumber = require 'gulp-plumber'
rename = require 'gulp-rename'
uglify = require 'gulp-uglify'
stylus = require 'gulp-stylus'
jade = require 'gulp-jade'
connect = require 'gulp-connect'

gulp.task 'templatizer', ->
  templatizer(__dirname + '/src/jade-templates', __dirname + '/src/js/_templates.js')

gulp.task 'browserify', ->
  gulp.src('src/js/app.coffee', {read: false})
  .pipe(plumber())
  .pipe(browserify(
      debug: true
      transform: ['coffeeify']
      extensions: ['.coffee']
    ))
  .pipe(rename('app.js'))
#    .pipe(uglify())
  .pipe(gulp.dest('public/js'))
  .pipe(connect.reload())

gulp.task 'stylus', ->
  gulp.src('src/styl/*.styl')
    .pipe(stylus(
      use: ['jeet']
    ))
    .pipe(gulp.dest('public/css'))
    .pipe(connect.reload())

gulp.task 'jade', ->
  gulp.src('src/jade/**/*.jade')
    .pipe(jade(
      pretty: true
    ))
    .pipe(gulp.dest('public'))
    .pipe(connect.reload())

gulp.task 'connect', connect.server(
  root: ['public']
  port: 1337
  livereload: true
  open:
    browser: 'Google Chrome'
)

gulp.task 'watch', ->
  gulp.watch ['src/jade-templates/**/*.jade'], ['templatizer']
  gulp.watch ['src/js/**/*.coffee', 'src/js/templates.js'], ['browserify']
  gulp.watch ['src/styl/*.styl'], ['stylus']
  gulp.watch ['src/jade/**/*.jade'], ['jade']

gulp.task 'default', [
  'templatizer'
  'browserify'
  'stylus'
  'jade'
  'connect'
  'watch'
]

