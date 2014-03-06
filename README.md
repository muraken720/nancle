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

## javascript
- coffeescript

## view(html)
- jade
- templatizer
- vue.js

## css
- stylus
- jeet

## build tool
- bower
- gulp
- gulp-shell
- gulp-coffee
- gulp-stylus
- gulp-connect (LiveReload)
