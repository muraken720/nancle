module.exports = (grunt) ->
  grunt.loadNpmTasks 'grunt-mocha-phantomjs'

  grunt.initConfig
    mocha_phantomjs:
      options:
        reporter: 'spec'
      all:
        ['test/assets/test.html']
