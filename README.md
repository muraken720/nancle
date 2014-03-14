nancle
======

This project is a concept project for Single Page Application framework for @vuejs.

# GettingStarted

```
$ npm install
$ gulp
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
│   ├── demo.jade
│   └── list.jade
├── js
│   └── app.coffee
│   └── templates.js
└── styl
    └── app.styl
public
├── css
│   └── app.css
├── index.html
└── js
    └── app.js
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

## build tool
- gulp
- gulp-browserify
- gulp-plumber
- gulp-rename
- gulp-uglify
- gulp-stylus
- gulp-jade
- gulp-connect (LiveReload)
