nancle
======

This project is a Single Page Application framework.

# GettingStarted

```
$ npm install
$ bower install
$ gulp
```

And now you can edit app.coffee, app.styl, templates/*.jade.

# File Strucure

```
$ tree src public
src
├── coffee
│   └── app.coffee
├── jade
│   ├── index.jade
│   ├── layout.jade
│   └── templates
│       └── demo.jade
└── styl
    └── app.styl
public
├── css
│   └── app.css
├── index.html
└── js
    ├── app.js
    ├── lib
    │   └── vue.min.js
    └── templates.js
```

# Technology Stack

## html
- jade
- templatizer
- vue.js

## javascript
- coffeescript

## css
- stylus
- jeet

## build tool
- bower
- gulp
- gulp-coffee
- gulp-stylus
- gulp-shell
- gulp-connect (LiveReload)

