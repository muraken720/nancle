gulp = require 'gulp'
templatizer = require 'templatizer'
browserify = require 'gulp-browserify'
plumber = require 'gulp-plumber'
rename = require 'gulp-rename'
uglify = require 'gulp-uglify'
stylus = require 'gulp-stylus'
jade = require 'gulp-jade'
connect = require 'gulp-connect'
require('gulp-grunt')(gulp, {prefix: ''})

gulp.task 'templatizer', ->
  templatizer(__dirname + '/src/jade-templates', __dirname + '/src/js/_templates.js', null, { doctype: '5' })

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

  gulp.src('test/test.coffee', {read: false})
    .pipe(plumber())
    .pipe(browserify(
      debug: true
      transform: ['coffeeify', 'espowerify']
      extensions: ['.coffee']
      ))
    .pipe(rename('test.js'))
    .pipe(gulp.dest('test/assets'))

gulp.task 'stylus', ->
  gulp.src('src/styl/*.styl')
    .pipe(stylus(
      use: ['jeet']
    ))
    .pipe(gulp.dest('public/css'))
    .pipe(connect.reload())

gulp.task 'jade', ->
  gulp.src('src/jade/index.jade')
    .pipe(jade(
      pretty: true
    ))
    .pipe(gulp.dest('public'))
    .pipe(connect.reload())
  gulp.src('test/test.jade')
    .pipe(jade(
        pretty: true
      ))
    .pipe(gulp.dest('test/assets'))

gulp.task 'connect', connect.server(
  root: ['public']
  port: 1337
  livereload: true
  open:
    browser: 'Google Chrome'
)

#exec grunt-mocha-phantomjs in gruntfile.coffee
gulp.task 'phantomjs', [
  'mocha_phantomjs'
]

gulp.task 'watch', ->
  gulp.watch ['src/jade-templates/**/*.jade'], ['templatizer']
  gulp.watch ['src/js/**/*.coffee', 'src/js/_templates.js', 'test/**/*.coffee'], ['browserify']
  gulp.watch ['src/styl/*.styl'], ['stylus']
  gulp.watch ['src/jade/**/*.jade', 'test/test.jade'], ['jade']

gulp.task 'default', [
  'templatizer'
  'browserify'
  'stylus'
  'jade'
  'connect'
  'watch'
]

