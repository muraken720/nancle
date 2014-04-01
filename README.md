nancle
======

This project is a concept project for Single Page Application framework for @vuejs.

# GettingStarted

```
$ npm install
$ gulp

$ gulp phantomjs
```

And now you can edit app.coffee, app.styl, templates/*.jade.

# File Strucure

```
$ tree src public
src
├── jade
│   ├── index.jade
│   └── layout.jade
├── jade-templates
│   ├── container.jade
│   ├── home.jade
│   ├── notfound.jade
│   ├── page1.jade
│   └── page2.jade
├── js
│   ├── _templates.js
│   ├── app.coffee
│   ├── model.coffee
│   ├── router.coffee
│   └── viewmodel.coffee
└── styl
    └── app.styl
public
├── css
│   └── app.css
├── index.html
└── js
    └── app.js
test/
├── assets
│   ├── test.html
│   └── test.js
├── test.coffee
└── test.jade
```

# Technology Stack

## html
- jade

## javascript
- coffeescript
- templatizer
- vue.js

## css
- stylus
- jeet

## test
- mocha
- power-assert
- espowerify
- mocha-phantomjs

## build tool
- gulp
- gulp-browserify
- gulp-plumber
- gulp-rename
- gulp-uglify
- gulp-stylus
- gulp-jade
- gulp-connect (LiveReload)
- gulp-grunt
- grunt-mocha-phantomjs
