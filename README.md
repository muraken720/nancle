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
