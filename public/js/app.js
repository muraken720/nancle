(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
var utils = require('./utils')

function Batcher () {
    this.reset()
}

var BatcherProto = Batcher.prototype

BatcherProto.push = function (job) {
    if (!job.id || !this.has[job.id]) {
        this.queue.push(job)
        this.has[job.id] = job
        if (!this.waiting) {
            this.waiting = true
            utils.nextTick(utils.bind(this.flush, this))
        }
    } else if (job.override) {
        var oldJob = this.has[job.id]
        oldJob.cancelled = true
        this.queue.push(job)
        this.has[job.id] = job
    }
}

BatcherProto.flush = function () {
    // before flush hook
    if (this._preFlush) this._preFlush()
    // do not cache length because more jobs might be pushed
    // as we execute existing jobs
    for (var i = 0; i < this.queue.length; i++) {
        var job = this.queue[i]
        if (!job.cancelled) {
            job.execute()
        }
    }
    this.reset()
}

BatcherProto.reset = function () {
    this.has = utils.hash()
    this.queue = []
    this.waiting = false
}

module.exports = Batcher
},{"./utils":25}],3:[function(require,module,exports){
var Batcher        = require('./batcher'),
    bindingBatcher = new Batcher(),
    bindingId      = 1

/**
 *  Binding class.
 *
 *  each property on the viewmodel has one corresponding Binding object
 *  which has multiple directive instances on the DOM
 *  and multiple computed property dependents
 */
function Binding (compiler, key, isExp, isFn) {
    this.id = bindingId++
    this.value = undefined
    this.isExp = !!isExp
    this.isFn = isFn
    this.root = !this.isExp && key.indexOf('.') === -1
    this.compiler = compiler
    this.key = key
    this.dirs = []
    this.subs = []
    this.deps = []
    this.unbound = false
}

var BindingProto = Binding.prototype

/**
 *  Update value and queue instance updates.
 */
BindingProto.update = function (value) {
    if (!this.isComputed || this.isFn) {
        this.value = value
    }
    if (this.dirs.length || this.subs.length) {
        var self = this
        bindingBatcher.push({
            id: this.id,
            execute: function () {
                if (!self.unbound) {
                    self._update()
                }
            }
        })
    }
}

/**
 *  Actually update the directives.
 */
BindingProto._update = function () {
    var i = this.dirs.length,
        value = this.val()
    while (i--) {
        this.dirs[i].update(value)
    }
    this.pub()
}

/**
 *  Return the valuated value regardless
 *  of whether it is computed or not
 */
BindingProto.val = function () {
    return this.isComputed && !this.isFn
        ? this.value.$get()
        : this.value
}

/**
 *  Notify computed properties that depend on this binding
 *  to update themselves
 */
BindingProto.pub = function () {
    var i = this.subs.length
    while (i--) {
        this.subs[i].update()
    }
}

/**
 *  Unbind the binding, remove itself from all of its dependencies
 */
BindingProto.unbind = function () {
    // Indicate this has been unbound.
    // It's possible this binding will be in
    // the batcher's flush queue when its owner
    // compiler has already been destroyed.
    this.unbound = true
    var i = this.dirs.length
    while (i--) {
        this.dirs[i].unbind()
    }
    i = this.deps.length
    var subs
    while (i--) {
        subs = this.deps[i].subs
        subs.splice(subs.indexOf(this), 1)
    }
}

module.exports = Binding
},{"./batcher":2}],4:[function(require,module,exports){
var Emitter     = require('./emitter'),
    Observer    = require('./observer'),
    config      = require('./config'),
    utils       = require('./utils'),
    Binding     = require('./binding'),
    Directive   = require('./directive'),
    TextParser  = require('./text-parser'),
    DepsParser  = require('./deps-parser'),
    ExpParser   = require('./exp-parser'),
    ViewModel,
    
    // cache methods
    slice       = [].slice,
    extend      = utils.extend,
    hasOwn      = ({}).hasOwnProperty,
    def         = Object.defineProperty,

    // hooks to register
    hooks = [
        'created', 'ready',
        'beforeDestroy', 'afterDestroy',
        'attached', 'detached'
    ],

    // list of priority directives
    // that needs to be checked in specific order
    priorityDirectives = [
        'if',
        'repeat',
        'view',
        'component'
    ]

/**
 *  The DOM compiler
 *  scans a DOM node and compile bindings for a ViewModel
 */
function Compiler (vm, options) {

    var compiler = this,
        key, i

    // default state
    compiler.init       = true
    compiler.destroyed  = false

    // process and extend options
    options = compiler.options = options || {}
    utils.processOptions(options)

    // copy compiler options
    extend(compiler, options.compilerOptions)
    // repeat indicates this is a v-repeat instance
    compiler.repeat   = compiler.repeat || false
    // expCache will be shared between v-repeat instances
    compiler.expCache = compiler.expCache || {}

    // initialize element
    var el = compiler.el = compiler.setupElement(options)
    utils.log('\nnew VM instance: ' + el.tagName + '\n')

    // set other compiler properties
    compiler.vm       = el.vue_vm = vm
    compiler.bindings = utils.hash()
    compiler.dirs     = []
    compiler.deferred = []
    compiler.computed = []
    compiler.children = []
    compiler.emitter  = new Emitter(vm)

    // create bindings for computed properties
    if (options.methods) {
        for (key in options.methods) {
            compiler.createBinding(key)
        }
    }

    // create bindings for methods
    if (options.computed) {
        for (key in options.computed) {
            compiler.createBinding(key)
        }
    }

    // VM ---------------------------------------------------------------------

    // set VM properties
    vm.$         = {}
    vm.$el       = el
    vm.$options  = options
    vm.$compiler = compiler
    vm.$event    = null

    // set parent & root
    var parentVM = options.parent
    if (parentVM) {
        compiler.parent = parentVM.$compiler
        parentVM.$compiler.children.push(compiler)
        vm.$parent = parentVM
    }
    vm.$root = getRoot(compiler).vm

    // DATA -------------------------------------------------------------------

    // setup observer
    // this is necesarry for all hooks and data observation events
    compiler.setupObserver()

    // initialize data
    var data = compiler.data = options.data || {},
        defaultData = options.defaultData
    if (defaultData) {
        for (key in defaultData) {
            if (!hasOwn.call(data, key)) {
                data[key] = defaultData[key]
            }
        }
    }

    // copy paramAttributes
    var params = options.paramAttributes
    if (params) {
        i = params.length
        while (i--) {
            data[params[i]] = utils.checkNumber(
                compiler.eval(
                    el.getAttribute(params[i])
                )
            )
        }
    }

    // copy data properties to vm
    // so user can access them in the created hook
    extend(vm, data)
    vm.$data = data

    // beforeCompile hook
    compiler.execHook('created')

    // the user might have swapped the data ...
    data = compiler.data = vm.$data

    // user might also set some properties on the vm
    // in which case we should copy back to $data
    var vmProp
    for (key in vm) {
        vmProp = vm[key]
        if (
            key.charAt(0) !== '$' &&
            data[key] !== vmProp &&
            typeof vmProp !== 'function'
        ) {
            data[key] = vmProp
        }
    }

    // now we can observe the data.
    // this will convert data properties to getter/setters
    // and emit the first batch of set events, which will
    // in turn create the corresponding bindings.
    compiler.observeData(data)

    // COMPILE ----------------------------------------------------------------

    // before compiling, resolve content insertion points
    if (options.template) {
        this.resolveContent()
    }

    // now parse the DOM and bind directives.
    // During this stage, we will also create bindings for
    // encountered keypaths that don't have a binding yet.
    compiler.compile(el, true)

    // Any directive that creates child VMs are deferred
    // so that when they are compiled, all bindings on the
    // parent VM have been created.
    i = compiler.deferred.length
    while (i--) {
        compiler.bindDirective(compiler.deferred[i])
    }
    compiler.deferred = null

    // extract dependencies for computed properties.
    // this will evaluated all collected computed bindings
    // and collect get events that are emitted.
    if (this.computed.length) {
        DepsParser.parse(this.computed)
    }

    // done!
    compiler.init = false

    // post compile / ready hook
    compiler.execHook('ready')
}

var CompilerProto = Compiler.prototype

/**
 *  Initialize the VM/Compiler's element.
 *  Fill it in with the template if necessary.
 */
CompilerProto.setupElement = function (options) {
    // create the node first
    var el = typeof options.el === 'string'
        ? document.querySelector(options.el)
        : options.el || document.createElement(options.tagName || 'div')

    var template = options.template,
        child, replacer, i, attr, attrs

    if (template) {
        // collect anything already in there
        if (el.hasChildNodes()) {
            this.rawContent = document.createElement('div')
            /* jshint boss: true */
            while (child = el.firstChild) {
                this.rawContent.appendChild(child)
            }
        }
        // replace option: use the first node in
        // the template directly
        if (options.replace && template.childNodes.length === 1) {
            replacer = template.childNodes[0].cloneNode(true)
            if (el.parentNode) {
                el.parentNode.insertBefore(replacer, el)
                el.parentNode.removeChild(el)
            }
            // copy over attributes
            if (el.hasAttributes()) {
                i = el.attributes.length
                while (i--) {
                    attr = el.attributes[i]
                    replacer.setAttribute(attr.name, attr.value)
                }
            }
            // replace
            el = replacer
        } else {
            el.appendChild(template.cloneNode(true))
        }

    }

    // apply element options
    if (options.id) el.id = options.id
    if (options.className) el.className = options.className
    attrs = options.attributes
    if (attrs) {
        for (attr in attrs) {
            el.setAttribute(attr, attrs[attr])
        }
    }

    return el
}

/**
 *  Deal with <content> insertion points
 *  per the Web Components spec
 */
CompilerProto.resolveContent = function () {

    var outlets = slice.call(this.el.getElementsByTagName('content')),
        raw = this.rawContent,
        outlet, select, i, j, main

    i = outlets.length
    if (i) {
        // first pass, collect corresponding content
        // for each outlet.
        while (i--) {
            outlet = outlets[i]
            if (raw) {
                select = outlet.getAttribute('select')
                if (select) { // select content
                    outlet.content =
                        slice.call(raw.querySelectorAll(select))
                } else { // default content
                    main = outlet
                }
            } else { // fallback content
                outlet.content =
                    slice.call(outlet.childNodes)
            }
        }
        // second pass, actually insert the contents
        for (i = 0, j = outlets.length; i < j; i++) {
            outlet = outlets[i]
            if (outlet === main) continue
            insert(outlet, outlet.content)
        }
        // finally insert the main content
        if (raw && main) {
            insert(main, slice.call(raw.childNodes))
        }
    }

    function insert (outlet, contents) {
        var parent = outlet.parentNode,
            i = 0, j = contents.length
        for (; i < j; i++) {
            parent.insertBefore(contents[i], outlet)
        }
        parent.removeChild(outlet)
    }

    this.rawContent = null
}

/**
 *  Setup observer.
 *  The observer listens for get/set/mutate events on all VM
 *  values/objects and trigger corresponding binding updates.
 *  It also listens for lifecycle hooks.
 */
CompilerProto.setupObserver = function () {

    var compiler = this,
        bindings = compiler.bindings,
        options  = compiler.options,
        observer = compiler.observer = new Emitter(compiler.vm)

    // a hash to hold event proxies for each root level key
    // so they can be referenced and removed later
    observer.proxies = {}

    // add own listeners which trigger binding updates
    observer
        .on('get', onGet)
        .on('set', onSet)
        .on('mutate', onSet)

    // register hooks
    var i = hooks.length, j, hook, fns
    while (i--) {
        hook = hooks[i]
        fns = options[hook]
        if (Array.isArray(fns)) {
            j = fns.length
            // since hooks were merged with child at head,
            // we loop reversely.
            while (j--) {
                registerHook(hook, fns[j])
            }
        } else if (fns) {
            registerHook(hook, fns)
        }
    }

    // broadcast attached/detached hooks
    observer
        .on('hook:attached', function () {
            broadcast(1)
        })
        .on('hook:detached', function () {
            broadcast(0)
        })

    function onGet (key) {
        check(key)
        DepsParser.catcher.emit('get', bindings[key])
    }

    function onSet (key, val, mutation) {
        observer.emit('change:' + key, val, mutation)
        check(key)
        bindings[key].update(val)
    }

    function registerHook (hook, fn) {
        observer.on('hook:' + hook, function () {
            fn.call(compiler.vm)
        })
    }

    function broadcast (event) {
        var children = compiler.children
        if (children) {
            var child, i = children.length
            while (i--) {
                child = children[i]
                if (child.el.parentNode) {
                    event = 'hook:' + (event ? 'attached' : 'detached')
                    child.observer.emit(event)
                    child.emitter.emit(event)
                }
            }
        }
    }

    function check (key) {
        if (!bindings[key]) {
            compiler.createBinding(key)
        }
    }
}

CompilerProto.observeData = function (data) {

    var compiler = this,
        observer = compiler.observer

    // recursively observe nested properties
    Observer.observe(data, '', observer)

    // also create binding for top level $data
    // so it can be used in templates too
    var $dataBinding = compiler.bindings['$data'] = new Binding(compiler, '$data')
    $dataBinding.update(data)

    // allow $data to be swapped
    def(compiler.vm, '$data', {
        get: function () {
            compiler.observer.emit('get', '$data')
            return compiler.data
        },
        set: function (newData) {
            var oldData = compiler.data
            Observer.unobserve(oldData, '', observer)
            compiler.data = newData
            Observer.copyPaths(newData, oldData)
            Observer.observe(newData, '', observer)
            update()
        }
    })

    // emit $data change on all changes
    observer
        .on('set', onSet)
        .on('mutate', onSet)

    function onSet (key) {
        if (key !== '$data') update()
    }

    function update () {
        $dataBinding.update(compiler.data)
        observer.emit('change:$data', compiler.data)
    }
}

/**
 *  Compile a DOM node (recursive)
 */
CompilerProto.compile = function (node, root) {
    var nodeType = node.nodeType
    if (nodeType === 1 && node.tagName !== 'SCRIPT') { // a normal node
        this.compileElement(node, root)
    } else if (nodeType === 3 && config.interpolate) {
        this.compileTextNode(node)
    }
}

/**
 *  Check for a priority directive
 *  If it is present and valid, return true to skip the rest
 */
CompilerProto.checkPriorityDir = function (dirname, node, root) {
    var expression, directive, Ctor
    if (
        dirname === 'component' &&
        root !== true &&
        (Ctor = this.resolveComponent(node, undefined, true))
    ) {
        directive = Directive.build(dirname, '', this, node)
        directive.Ctor = Ctor
    } else {
        expression = utils.attr(node, dirname)
        directive = expression && Directive.build(dirname, expression, this, node)
    }
    if (directive) {
        if (root === true) {
            utils.warn(
                'Directive v-' + dirname + ' cannot be used on an already instantiated ' +
                'VM\'s root node. Use it from the parent\'s template instead.'
            )
            return
        }
        this.deferred.push(directive)
        return true
    }
}

/**
 *  Compile normal directives on a node
 */
CompilerProto.compileElement = function (node, root) {

    // textarea is pretty annoying
    // because its value creates childNodes which
    // we don't want to compile.
    if (node.tagName === 'TEXTAREA' && node.value) {
        node.value = this.eval(node.value)
    }

    // only compile if this element has attributes
    // or its tagName contains a hyphen (which means it could
    // potentially be a custom element)
    if (node.hasAttributes() || node.tagName.indexOf('-') > -1) {

        // skip anything with v-pre
        if (utils.attr(node, 'pre') !== null) {
            return
        }

        // check priority directives.
        // if any of them are present, it will take over the node with a childVM
        // so we can skip the rest
        for (var i = 0, l = priorityDirectives.length; i < l; i++) {
            if (this.checkPriorityDir(priorityDirectives[i], node, root)) {
                return
            }
        }

        // check transition & animation properties
        node.vue_trans  = utils.attr(node, 'transition')
        node.vue_anim   = utils.attr(node, 'animation')
        node.vue_effect = this.eval(utils.attr(node, 'effect'))

        var prefix = config.prefix + '-',
            attrs = slice.call(node.attributes),
            params = this.options.paramAttributes,
            attr, isDirective, exps, exp, directive, dirname

        i = attrs.length
        while (i--) {

            attr = attrs[i]
            isDirective = false

            if (attr.name.indexOf(prefix) === 0) {
                // a directive - split, parse and bind it.
                isDirective = true
                exps = Directive.split(attr.value)
                // loop through clauses (separated by ",")
                // inside each attribute
                l = exps.length
                while (l--) {
                    exp = exps[l]
                    dirname = attr.name.slice(prefix.length)
                    directive = Directive.build(dirname, exp, this, node)

                    if (dirname === 'with') {
                        this.bindDirective(directive, this.parent)
                    } else {
                        this.bindDirective(directive)
                    }
                    
                }
            } else if (config.interpolate) {
                // non directive attribute, check interpolation tags
                exp = TextParser.parseAttr(attr.value)
                if (exp) {
                    directive = Directive.build('attr', attr.name + ':' + exp, this, node)
                    if (params && params.indexOf(attr.name) > -1) {
                        // a param attribute... we should use the parent binding
                        // to avoid circular updates like size={{size}}
                        this.bindDirective(directive, this.parent)
                    } else {
                        this.bindDirective(directive)
                    }
                }
            }

            if (isDirective && dirname !== 'cloak') {
                node.removeAttribute(attr.name)
            }
        }

    }

    // recursively compile childNodes
    if (node.hasChildNodes()) {
        slice.call(node.childNodes).forEach(this.compile, this)
    }
}

/**
 *  Compile a text node
 */
CompilerProto.compileTextNode = function (node) {

    var tokens = TextParser.parse(node.nodeValue)
    if (!tokens) return
    var el, token, directive

    for (var i = 0, l = tokens.length; i < l; i++) {

        token = tokens[i]
        directive = null

        if (token.key) { // a binding
            if (token.key.charAt(0) === '>') { // a partial
                el = document.createComment('ref')
                directive = Directive.build('partial', token.key.slice(1), this, el)
            } else {
                if (!token.html) { // text binding
                    el = document.createTextNode('')
                    directive = Directive.build('text', token.key, this, el)
                } else { // html binding
                    el = document.createComment(config.prefix + '-html')
                    directive = Directive.build('html', token.key, this, el)
                }
            }
        } else { // a plain string
            el = document.createTextNode(token)
        }

        // insert node
        node.parentNode.insertBefore(el, node)
        // bind directive
        this.bindDirective(directive)

    }
    node.parentNode.removeChild(node)
}

/**
 *  Add a directive instance to the correct binding & viewmodel
 */
CompilerProto.bindDirective = function (directive, bindingOwner) {

    if (!directive) return

    // keep track of it so we can unbind() later
    this.dirs.push(directive)

    // for empty or literal directives, simply call its bind()
    // and we're done.
    if (directive.isEmpty || directive.isLiteral) {
        if (directive.bind) directive.bind()
        return
    }

    // otherwise, we got more work to do...
    var binding,
        compiler = bindingOwner || this,
        key      = directive.key

    if (directive.isExp) {
        // expression bindings are always created on current compiler
        binding = compiler.createBinding(key, directive)
    } else {
        // recursively locate which compiler owns the binding
        while (compiler) {
            if (compiler.hasKey(key)) {
                break
            } else {
                compiler = compiler.parent
            }
        }
        compiler = compiler || this
        binding = compiler.bindings[key] || compiler.createBinding(key)
    }
    binding.dirs.push(directive)
    directive.binding = binding

    var value = binding.val()
    // invoke bind hook if exists
    if (directive.bind) {
        directive.bind(value)
    }
    // set initial value
    directive.update(value, true)
}

/**
 *  Create binding and attach getter/setter for a key to the viewmodel object
 */
CompilerProto.createBinding = function (key, directive) {

    utils.log('  created binding: ' + key)

    var compiler = this,
        methods  = compiler.options.methods,
        isExp    = directive && directive.isExp,
        isFn     = (directive && directive.isFn) || (methods && methods[key]),
        bindings = compiler.bindings,
        computed = compiler.options.computed,
        binding  = new Binding(compiler, key, isExp, isFn)

    if (isExp) {
        // expression bindings are anonymous
        compiler.defineExp(key, binding, directive)
    } else if (isFn) {
        bindings[key] = binding
        binding.value = compiler.vm[key] = methods[key]
    } else {
        bindings[key] = binding
        if (binding.root) {
            // this is a root level binding. we need to define getter/setters for it.
            if (computed && computed[key]) {
                // computed property
                compiler.defineComputed(key, binding, computed[key])
            } else if (key.charAt(0) !== '$') {
                // normal property
                compiler.defineProp(key, binding)
            } else {
                compiler.defineMeta(key, binding)
            }
        } else if (computed && computed[utils.baseKey(key)]) {
            // nested path on computed property
            compiler.defineExp(key, binding)
        } else {
            // ensure path in data so that computed properties that
            // access the path don't throw an error and can collect
            // dependencies
            Observer.ensurePath(compiler.data, key)
            var parentKey = key.slice(0, key.lastIndexOf('.'))
            if (!bindings[parentKey]) {
                // this is a nested value binding, but the binding for its parent
                // has not been created yet. We better create that one too.
                compiler.createBinding(parentKey)
            }
        }
    }
    return binding
}

/**
 *  Define the getter/setter for a root-level property on the VM
 *  and observe the initial value
 */
CompilerProto.defineProp = function (key, binding) {
    var compiler = this,
        data     = compiler.data,
        ob       = data.__emitter__

    // make sure the key is present in data
    // so it can be observed
    if (!(hasOwn.call(data, key))) {
        data[key] = undefined
    }

    // if the data object is already observed, but the key
    // is not observed, we need to add it to the observed keys.
    if (ob && !(hasOwn.call(ob.values, key))) {
        Observer.convertKey(data, key)
    }

    binding.value = data[key]

    def(compiler.vm, key, {
        get: function () {
            return compiler.data[key]
        },
        set: function (val) {
            compiler.data[key] = val
        }
    })
}

/**
 *  Define a meta property, e.g. $index or $key,
 *  which is bindable but only accessible on the VM,
 *  not in the data.
 */
CompilerProto.defineMeta = function (key, binding) {
    var ob = this.observer
    binding.value = this.data[key]
    delete this.data[key]
    def(this.vm, key, {
        get: function () {
            if (Observer.shouldGet) ob.emit('get', key)
            return binding.value
        },
        set: function (val) {
            ob.emit('set', key, val)
        }
    })
}

/**
 *  Define an expression binding, which is essentially
 *  an anonymous computed property
 */
CompilerProto.defineExp = function (key, binding, directive) {
    var computedKey = directive && directive.computedKey,
        exp         = computedKey ? directive.expression : key,
        getter      = this.expCache[exp]
    if (!getter) {
        getter = this.expCache[exp] = ExpParser.parse(computedKey || key, this)
    }
    if (getter) {
        this.markComputed(binding, getter)
    }
}

/**
 *  Define a computed property on the VM
 */
CompilerProto.defineComputed = function (key, binding, value) {
    this.markComputed(binding, value)
    def(this.vm, key, {
        get: binding.value.$get,
        set: binding.value.$set
    })
}

/**
 *  Process a computed property binding
 *  so its getter/setter are bound to proper context
 */
CompilerProto.markComputed = function (binding, value) {
    binding.isComputed = true
    // bind the accessors to the vm
    if (binding.isFn) {
        binding.value = value
    } else {
        if (typeof value === 'function') {
            value = { $get: value }
        }
        binding.value = {
            $get: utils.bind(value.$get, this.vm),
            $set: value.$set
                ? utils.bind(value.$set, this.vm)
                : undefined
        }
    }
    // keep track for dep parsing later
    this.computed.push(binding)
}

/**
 *  Retrive an option from the compiler
 */
CompilerProto.getOption = function (type, id, silent) {
    var opts = this.options,
        parent = this.parent,
        globalAssets = config.globalAssets,
        res = (opts[type] && opts[type][id]) || (
            parent
                ? parent.getOption(type, id, silent)
                : globalAssets[type] && globalAssets[type][id]
        )
    if (!res && !silent && typeof id === 'string') {
        utils.warn('Unknown ' + type.slice(0, -1) + ': ' + id)
    }
    return res
}

/**
 *  Emit lifecycle events to trigger hooks
 */
CompilerProto.execHook = function (event) {
    event = 'hook:' + event
    this.observer.emit(event)
    this.emitter.emit(event)
}

/**
 *  Check if a compiler's data contains a keypath
 */
CompilerProto.hasKey = function (key) {
    var baseKey = utils.baseKey(key)
    return hasOwn.call(this.data, baseKey) ||
        hasOwn.call(this.vm, baseKey)
}

/**
 *  Do a one-time eval of a string that potentially
 *  includes bindings. It accepts additional raw data
 *  because we need to dynamically resolve v-component
 *  before a childVM is even compiled...
 */
CompilerProto.eval = function (exp, data) {
    var parsed = TextParser.parseAttr(exp)
    return parsed
        ? ExpParser.eval(parsed, this, data)
        : exp
}

/**
 *  Resolve a Component constructor for an element
 *  with the data to be used
 */
CompilerProto.resolveComponent = function (node, data, test) {

    // late require to avoid circular deps
    ViewModel = ViewModel || require('./viewmodel')

    var exp     = utils.attr(node, 'component'),
        tagName = node.tagName,
        id      = this.eval(exp, data),
        tagId   = (tagName.indexOf('-') > 0 && tagName.toLowerCase()),
        Ctor    = this.getOption('components', id || tagId, true)

    if (id && !Ctor) {
        utils.warn('Unknown component: ' + id)
    }

    return test
        ? exp === ''
            ? ViewModel
            : Ctor
        : Ctor || ViewModel
}

/**
 *  Unbind and remove element
 */
CompilerProto.destroy = function () {

    // avoid being called more than once
    // this is irreversible!
    if (this.destroyed) return

    var compiler = this,
        i, key, dir, dirs, binding,
        vm          = compiler.vm,
        el          = compiler.el,
        directives  = compiler.dirs,
        computed    = compiler.computed,
        bindings    = compiler.bindings,
        children    = compiler.children,
        parent      = compiler.parent

    compiler.execHook('beforeDestroy')

    // unobserve data
    Observer.unobserve(compiler.data, '', compiler.observer)

    // unbind all direcitves
    i = directives.length
    while (i--) {
        dir = directives[i]
        // if this directive is an instance of an external binding
        // e.g. a directive that refers to a variable on the parent VM
        // we need to remove it from that binding's directives
        // * empty and literal bindings do not have binding.
        if (dir.binding && dir.binding.compiler !== compiler) {
            dirs = dir.binding.dirs
            if (dirs) dirs.splice(dirs.indexOf(dir), 1)
        }
        dir.unbind()
    }

    // unbind all computed, anonymous bindings
    i = computed.length
    while (i--) {
        computed[i].unbind()
    }

    // unbind all keypath bindings
    for (key in bindings) {
        binding = bindings[key]
        if (binding) {
            binding.unbind()
        }
    }

    // destroy all children
    i = children.length
    while (i--) {
        children[i].destroy()
    }

    // remove self from parent
    if (parent) {
        parent.children.splice(parent.children.indexOf(compiler), 1)
    }

    // finally remove dom element
    if (el === document.body) {
        el.innerHTML = ''
    } else {
        vm.$remove()
    }
    el.vue_vm = null

    compiler.destroyed = true
    // emit destroy hook
    compiler.execHook('afterDestroy')

    // finally, unregister all listeners
    compiler.observer.off()
    compiler.emitter.off()
}

// Helpers --------------------------------------------------------------------

/**
 *  shorthand for getting root compiler
 */
function getRoot (compiler) {
    while (compiler.parent) {
        compiler = compiler.parent
    }
    return compiler
}

module.exports = Compiler
},{"./binding":3,"./config":5,"./deps-parser":6,"./directive":7,"./emitter":18,"./exp-parser":19,"./observer":22,"./text-parser":23,"./utils":25,"./viewmodel":26}],5:[function(require,module,exports){
var TextParser = require('./text-parser')

module.exports = {
    prefix         : 'v',
    debug          : false,
    silent         : false,
    enterClass     : 'v-enter',
    leaveClass     : 'v-leave',
    interpolate    : true
}

Object.defineProperty(module.exports, 'delimiters', {
    get: function () {
        return TextParser.delimiters
    },
    set: function (delimiters) {
        TextParser.setDelimiters(delimiters)
    }
})
},{"./text-parser":23}],6:[function(require,module,exports){
var Emitter  = require('./emitter'),
    utils    = require('./utils'),
    Observer = require('./observer'),
    catcher  = new Emitter()

/**
 *  Auto-extract the dependencies of a computed property
 *  by recording the getters triggered when evaluating it.
 */
function catchDeps (binding) {
    if (binding.isFn) return
    utils.log('\n- ' + binding.key)
    var got = utils.hash()
    binding.deps = []
    catcher.on('get', function (dep) {
        var has = got[dep.key]
        if (
            // avoid duplicate bindings
            (has && has.compiler === dep.compiler) ||
            // avoid repeated items as dependency
            // since all inside changes trigger array change too
            (dep.compiler.repeat && dep.compiler.parent === binding.compiler)
        ) {
            return
        }
        got[dep.key] = dep
        utils.log('  - ' + dep.key)
        binding.deps.push(dep)
        dep.subs.push(binding)
    })
    binding.value.$get()
    catcher.off('get')
}

module.exports = {

    /**
     *  the observer that catches events triggered by getters
     */
    catcher: catcher,

    /**
     *  parse a list of computed property bindings
     */
    parse: function (bindings) {
        utils.log('\nparsing dependencies...')
        Observer.shouldGet = true
        bindings.forEach(catchDeps)
        Observer.shouldGet = false
        utils.log('\ndone.')
    }
    
}
},{"./emitter":18,"./observer":22,"./utils":25}],7:[function(require,module,exports){
var utils      = require('./utils'),
    dirId      = 1,

    // Regexes!
    // regex to split multiple directive expressions
    // split by commas, but ignore commas within quotes, parens and escapes.
    SPLIT_RE        = /(?:['"](?:\\.|[^'"])*['"]|\((?:\\.|[^\)])*\)|\\.|[^,])+/g,
    // match up to the first single pipe, ignore those within quotes.
    KEY_RE          = /^(?:['"](?:\\.|[^'"])*['"]|\\.|[^\|]|\|\|)+/,
    ARG_RE          = /^([\w-$ ]+):(.+)$/,
    FILTERS_RE      = /\|[^\|]+/g,
    FILTER_TOKEN_RE = /[^\s']+|'[^']+'|[^\s"]+|"[^"]+"/g,
    NESTING_RE      = /^\$(parent|root)\./,
    SINGLE_VAR_RE   = /^[\w\.$]+$/,
    QUOTE_RE        = /"/g

/**
 *  Directive class
 *  represents a single directive instance in the DOM
 */
function Directive (dirname, definition, expression, rawKey, compiler, node) {

    this.id             = dirId++
    this.name           = dirname
    this.compiler       = compiler
    this.vm             = compiler.vm
    this.el             = node
    this.computeFilters = false

    var isEmpty   = expression === ''

    // mix in properties from the directive definition
    if (typeof definition === 'function') {
        this[isEmpty ? 'bind' : '_update'] = definition
    } else {
        for (var prop in definition) {
            if (prop === 'unbind' || prop === 'update') {
                this['_' + prop] = definition[prop]
            } else {
                this[prop] = definition[prop]
            }
        }
    }

    // empty expression, we're done.
    if (isEmpty || this.isEmpty) {
        this.isEmpty = true
        return
    }

    this.expression = (
        this.isLiteral
            ? compiler.eval(expression)
            : expression
    ).trim()
    
    var parsed = Directive.parseArg(rawKey)
    this.key = parsed.key
    this.arg = parsed.arg
    
    var filters = Directive.parseFilters(this.expression.slice(rawKey.length)),
        filter, fn, i, l, computed
    if (filters) {
        this.filters = []
        for (i = 0, l = filters.length; i < l; i++) {
            filter = filters[i]
            fn = this.compiler.getOption('filters', filter.name)
            if (fn) {
                filter.apply = fn
                this.filters.push(filter)
                if (fn.computed) {
                    computed = true
                }
            }
        }
    }

    if (!this.filters || !this.filters.length) {
        this.filters = null
    }

    if (computed) {
        this.computedKey = Directive.inlineFilters(this.key, this.filters)
        this.filters = null
    }

    this.isExp =
        computed ||
        !SINGLE_VAR_RE.test(this.key) ||
        NESTING_RE.test(this.key)

}

var DirProto = Directive.prototype

/**
 *  called when a new value is set 
 *  for computed properties, this will only be called once
 *  during initialization.
 */
DirProto.update = function (value, init) {
    if (init || value !== this.value || (value && typeof value === 'object')) {
        this.value = value
        if (this._update) {
            this._update(
                this.filters && !this.computeFilters
                    ? this.applyFilters(value)
                    : value,
                init
            )
        }
    }
}

/**
 *  pipe the value through filters
 */
DirProto.applyFilters = function (value) {
    var filtered = value, filter
    for (var i = 0, l = this.filters.length; i < l; i++) {
        filter = this.filters[i]
        filtered = filter.apply.apply(this.vm, [filtered].concat(filter.args))
    }
    return filtered
}

/**
 *  Unbind diretive
 */
DirProto.unbind = function () {
    // this can be called before the el is even assigned...
    if (!this.el || !this.vm) return
    if (this._unbind) this._unbind()
    this.vm = this.el = this.binding = this.compiler = null
}

// Exposed static methods -----------------------------------------------------

/**
 *  split a unquoted-comma separated expression into
 *  multiple clauses
 */
Directive.split = function (exp) {
    return exp.indexOf(',') > -1
        ? exp.match(SPLIT_RE) || ['']
        : [exp]
}

/**
 *  parse a key, extract argument
 */
Directive.parseArg = function (rawKey) {
    var key = rawKey,
        arg = null
    if (rawKey.indexOf(':') > -1) {
        var argMatch = rawKey.match(ARG_RE)
        key = argMatch
            ? argMatch[2].trim()
            : key
        arg = argMatch
            ? argMatch[1].trim()
            : arg
    }
    return {
        key: key,
        arg: arg
    }
}

/**
 *  parse a the filters
 */
Directive.parseFilters = function (exp) {
    if (exp.indexOf('|') < 0) {
        return
    }
    var filters = exp.match(FILTERS_RE),
        res, i, l, tokens
    if (filters) {
        res = []
        for (i = 0, l = filters.length; i < l; i++) {
            tokens = filters[i].slice(1).match(FILTER_TOKEN_RE)
            if (tokens) {
                res.push({
                    name: tokens[0],
                    args: tokens.length > 1
                        ? tokens.slice(1)
                        : null
                })
            }
        }
    }
    return res
}

/**
 *  Inline computed filters so they become part
 *  of the expression
 */
Directive.inlineFilters = function (key, filters) {
    var args, filter
    for (var i = 0, l = filters.length; i < l; i++) {
        filter = filters[i]
        args = filter.args
            ? ',"' + filter.args.map(escapeQuote).join('","') + '"'
            : ''
        key = 'this.$compiler.getOption("filters", "' +
                filter.name +
            '").call(this,' +
                key + args +
            ')'
    }
    return key
}

/**
 *  Convert double quotes to single quotes
 *  so they don't mess up the generated function body
 */
function escapeQuote (v) {
    return v.indexOf('"') > -1
        ? v.replace(QUOTE_RE, '\'')
        : v
}

/**
 *  Parse the key from a directive raw expression
 */
Directive.parseKey = function (expression) {
    if (expression.indexOf('|') > -1) {
        var keyMatch = expression.match(KEY_RE)
        if (keyMatch) {
            return keyMatch[0].trim()
        }
    } else {
        return expression.trim()
    }
}

/**
 *  make sure the directive and expression is valid
 *  before we create an instance
 */
Directive.build = function (dirname, expression, compiler, node) {

    var dir = compiler.getOption('directives', dirname)
    if (!dir) return

    var rawKey = Directive.parseKey(expression)
    // have a valid raw key, or be an empty directive
    if (rawKey || expression === '') {
        return new Directive(dirname, dir, expression, rawKey, compiler, node)
    } else {
        utils.warn('Invalid directive expression: ' + expression)
    }
}

module.exports = Directive
},{"./utils":25}],8:[function(require,module,exports){
var guard = require('../utils').guard,
    slice = [].slice

/**
 *  Binding for innerHTML
 */
module.exports = {

    bind: function () {
        // a comment node means this is a binding for
        // {{{ inline unescaped html }}}
        if (this.el.nodeType === 8) {
            // hold nodes
            this.holder = document.createElement('div')
            this.nodes = []
        }
    },

    update: function (value) {
        value = guard(value)
        if (this.holder) {
            this.swap(value)
        } else {
            this.el.innerHTML = value
        }
    },

    swap: function (value) {
        var parent = this.el.parentNode,
            holder = this.holder,
            nodes = this.nodes,
            i = nodes.length, l
        while (i--) {
            parent.removeChild(nodes[i])
        }
        holder.innerHTML = value
        nodes = this.nodes = slice.call(holder.childNodes)
        for (i = 0, l = nodes.length; i < l; i++) {
            parent.insertBefore(nodes[i], this.el)
        }
    }
}
},{"../utils":25}],9:[function(require,module,exports){
var utils    = require('../utils')

/**
 *  Manages a conditional child VM
 */
module.exports = {

    bind: function () {
        
        this.parent = this.el.parentNode
        this.ref    = document.createComment('vue-if')
        this.Ctor   = this.compiler.resolveComponent(this.el)

        // insert ref
        this.parent.insertBefore(this.ref, this.el)
        this.parent.removeChild(this.el)

        if (utils.attr(this.el, 'view')) {
            utils.warn(
                'Conflict: v-if cannot be used together with v-view. ' +
                'Just set v-view\'s binding value to empty string to empty it.'
            )
        }
        if (utils.attr(this.el, 'repeat')) {
            utils.warn(
                'Conflict: v-if cannot be used together with v-repeat. ' +
                'Use `v-show` or the `filterBy` filter instead.'
            )
        }
    },

    update: function (value) {

        if (!value) {
            this._unbind()
        } else if (!this.childVM) {
            this.childVM = new this.Ctor({
                el: this.el.cloneNode(true),
                parent: this.vm
            })
            if (this.compiler.init) {
                this.parent.insertBefore(this.childVM.$el, this.ref)
            } else {
                this.childVM.$before(this.ref)
            }
        }
        
    },

    unbind: function () {
        if (this.childVM) {
            this.childVM.$destroy()
            this.childVM = null
        }
    }
}
},{"../utils":25}],10:[function(require,module,exports){
var utils      = require('../utils'),
    config     = require('../config'),
    transition = require('../transition'),
    directives = module.exports = utils.hash()

/**
 *  Nest and manage a Child VM
 */
directives.component = {
    isLiteral: true,
    bind: function () {
        if (!this.el.vue_vm) {
            this.childVM = new this.Ctor({
                el: this.el,
                parent: this.vm
            })
        }
    },
    unbind: function () {
        if (this.childVM) {
            this.childVM.$destroy()
        }
    }
}

/**
 *  Binding HTML attributes
 */
directives.attr = {
    bind: function () {
        var params = this.vm.$options.paramAttributes
        this.isParam = params && params.indexOf(this.arg) > -1
    },
    update: function (value) {
        if (value || value === 0) {
            this.el.setAttribute(this.arg, value)
        } else {
            this.el.removeAttribute(this.arg)
        }
        if (this.isParam) {
            this.vm[this.arg] = utils.checkNumber(value)
        }
    }
}

/**
 *  Binding textContent
 */
directives.text = {
    bind: function () {
        this.attr = this.el.nodeType === 3
            ? 'nodeValue'
            : 'textContent'
    },
    update: function (value) {
        this.el[this.attr] = utils.guard(value)
    }
}

/**
 *  Binding CSS display property
 */
directives.show = function (value) {
    var el = this.el,
        target = value ? '' : 'none',
        change = function () {
            el.style.display = target
        }
    transition(el, value ? 1 : -1, change, this.compiler)
}

/**
 *  Binding CSS classes
 */
directives['class'] = function (value) {
    if (this.arg) {
        utils[value ? 'addClass' : 'removeClass'](this.el, this.arg)
    } else {
        if (this.lastVal) {
            utils.removeClass(this.el, this.lastVal)
        }
        if (value) {
            utils.addClass(this.el, value)
            this.lastVal = value
        }
    }
}

/**
 *  Only removed after the owner VM is ready
 */
directives.cloak = {
    isEmpty: true,
    bind: function () {
        var el = this.el
        this.compiler.observer.once('hook:ready', function () {
            el.removeAttribute(config.prefix + '-cloak')
        })
    }
}

/**
 *  Store a reference to self in parent VM's $
 */
directives.ref = {
    isLiteral: true,
    bind: function () {
        var id = this.expression
        if (id) {
            this.vm.$parent.$[id] = this.vm
        }
    },
    unbind: function () {
        var id = this.expression
        if (id) {
            delete this.vm.$parent.$[id]
        }
    }
}

directives.on      = require('./on')
directives.repeat  = require('./repeat')
directives.model   = require('./model')
directives['if']   = require('./if')
directives['with'] = require('./with')
directives.html    = require('./html')
directives.style   = require('./style')
directives.partial = require('./partial')
directives.view    = require('./view')
},{"../config":5,"../transition":24,"../utils":25,"./html":8,"./if":9,"./model":11,"./on":12,"./partial":13,"./repeat":14,"./style":15,"./view":16,"./with":17}],11:[function(require,module,exports){
var utils = require('../utils'),
    isIE9 = navigator.userAgent.indexOf('MSIE 9.0') > 0,
    filter = [].filter

/**
 *  Returns an array of values from a multiple select
 */
function getMultipleSelectOptions (select) {
    return filter
        .call(select.options, function (option) {
            return option.selected
        })
        .map(function (option) {
            return option.value || option.text
        })
}

/**
 *  Two-way binding for form input elements
 */
module.exports = {

    bind: function () {

        var self = this,
            el   = self.el,
            type = el.type,
            tag  = el.tagName

        self.lock = false
        self.ownerVM = self.binding.compiler.vm

        // determine what event to listen to
        self.event =
            (self.compiler.options.lazy ||
            tag === 'SELECT' ||
            type === 'checkbox' || type === 'radio')
                ? 'change'
                : 'input'

        // determine the attribute to change when updating
        self.attr = type === 'checkbox'
            ? 'checked'
            : (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')
                ? 'value'
                : 'innerHTML'

        // select[multiple] support
        if(tag === 'SELECT' && el.hasAttribute('multiple')) {
            this.multi = true
        }

        var compositionLock = false
        self.cLock = function () {
            compositionLock = true
        }
        self.cUnlock = function () {
            compositionLock = false
        }
        el.addEventListener('compositionstart', this.cLock)
        el.addEventListener('compositionend', this.cUnlock)

        // attach listener
        self.set = self.filters
            ? function () {
                if (compositionLock) return
                // if this directive has filters
                // we need to let the vm.$set trigger
                // update() so filters are applied.
                // therefore we have to record cursor position
                // so that after vm.$set changes the input
                // value we can put the cursor back at where it is
                var cursorPos
                try { cursorPos = el.selectionStart } catch (e) {}

                self._set()

                // since updates are async
                // we need to reset cursor position async too
                utils.nextTick(function () {
                    if (cursorPos !== undefined) {
                        el.setSelectionRange(cursorPos, cursorPos)
                    }
                })
            }
            : function () {
                if (compositionLock) return
                // no filters, don't let it trigger update()
                self.lock = true

                self._set()

                utils.nextTick(function () {
                    self.lock = false
                })
            }
        el.addEventListener(self.event, self.set)

        // fix shit for IE9
        // since it doesn't fire input on backspace / del / cut
        if (isIE9) {
            self.onCut = function () {
                // cut event fires before the value actually changes
                utils.nextTick(function () {
                    self.set()
                })
            }
            self.onDel = function (e) {
                if (e.keyCode === 46 || e.keyCode === 8) {
                    self.set()
                }
            }
            el.addEventListener('cut', self.onCut)
            el.addEventListener('keyup', self.onDel)
        }
    },

    _set: function () {
        this.ownerVM.$set(
            this.key, this.multi
                ? getMultipleSelectOptions(this.el)
                : this.el[this.attr]
        )
    },

    update: function (value, init) {
        /* jshint eqeqeq: false */
        // sync back inline value if initial data is undefined
        if (init && value === undefined) {
            return this._set()
        }
        if (this.lock) return
        var el = this.el
        if (el.tagName === 'SELECT') { // select dropdown
            el.selectedIndex = -1
            if(this.multi && Array.isArray(value)) {
                value.forEach(this.updateSelect, this)
            } else {
                this.updateSelect(value)
            }
        } else if (el.type === 'radio') { // radio button
            el.checked = value == el.value
        } else if (el.type === 'checkbox') { // checkbox
            el.checked = !!value
        } else {
            el[this.attr] = utils.guard(value)
        }
    },

    updateSelect: function (value) {
        /* jshint eqeqeq: false */
        // setting <select>'s value in IE9 doesn't work
        // we have to manually loop through the options
        var options = this.el.options,
            i = options.length
        while (i--) {
            if (options[i].value == value) {
                options[i].selected = true
                break
            }
        }
    },

    unbind: function () {
        var el = this.el
        el.removeEventListener(this.event, this.set)
        el.removeEventListener('compositionstart', this.cLock)
        el.removeEventListener('compositionend', this.cUnlock)
        if (isIE9) {
            el.removeEventListener('cut', this.onCut)
            el.removeEventListener('keyup', this.onDel)
        }
    }
}
},{"../utils":25}],12:[function(require,module,exports){
var utils    = require('../utils')

/**
 *  Binding for event listeners
 */
module.exports = {

    isFn: true,

    bind: function () {
        this.context = this.binding.isExp
            ? this.vm
            : this.binding.compiler.vm
    },

    update: function (handler) {
        if (typeof handler !== 'function') {
            utils.warn('Directive "v-on:' + this.expression + '" expects a method.')
            return
        }
        this._unbind()
        var vm = this.vm,
            context = this.context
        this.handler = function (e) {
            e.targetVM = vm
            context.$event = e
            var res = handler.call(context, e)
            context.$event = null
            return res
        }
        this.el.addEventListener(this.arg, this.handler)
    },

    unbind: function () {
        this.el.removeEventListener(this.arg, this.handler)
    }
}
},{"../utils":25}],13:[function(require,module,exports){
var utils = require('../utils')

/**
 *  Binding for partials
 */
module.exports = {

    isLiteral: true,

    bind: function () {

        var id = this.expression
        if (!id) return

        var el       = this.el,
            compiler = this.compiler,
            partial  = compiler.getOption('partials', id)

        if (!partial) {
            if (id === 'yield') {
                utils.warn('{{>yield}} syntax has been deprecated. Use <content> tag instead.')
            }
            return
        }

        partial = partial.cloneNode(true)

        // comment ref node means inline partial
        if (el.nodeType === 8) {

            // keep a ref for the partial's content nodes
            var nodes = [].slice.call(partial.childNodes),
                parent = el.parentNode
            parent.insertBefore(partial, el)
            parent.removeChild(el)
            // compile partial after appending, because its children's parentNode
            // will change from the fragment to the correct parentNode.
            // This could affect directives that need access to its element's parentNode.
            nodes.forEach(compiler.compile, compiler)

        } else {

            // just set innerHTML...
            el.innerHTML = ''
            el.appendChild(partial.cloneNode(true))

        }
    }

}
},{"../utils":25}],14:[function(require,module,exports){
var utils      = require('../utils'),
    config     = require('../config')

/**
 *  Binding that manages VMs based on an Array
 */
module.exports = {

    bind: function () {

        this.identifier = '$r' + this.id

        // a hash to cache the same expressions on repeated instances
        // so they don't have to be compiled for every single instance
        this.expCache = utils.hash()

        var el   = this.el,
            ctn  = this.container = el.parentNode

        // extract child Id, if any
        this.childId = this.compiler.eval(utils.attr(el, 'ref'))

        // create a comment node as a reference node for DOM insertions
        this.ref = document.createComment(config.prefix + '-repeat-' + this.key)
        ctn.insertBefore(this.ref, el)
        ctn.removeChild(el)

        this.collection = null
        this.vms = null

    },

    update: function (collection) {

        if (!Array.isArray(collection)) {
            if (utils.isObject(collection)) {
                collection = utils.objectToArray(collection)
            } else {
                utils.warn('v-repeat only accepts Array or Object values.')
            }
        }

        // keep reference of old data and VMs
        // so we can reuse them if possible
        this.oldVMs = this.vms
        this.oldCollection = this.collection
        collection = this.collection = collection || []

        var isObject = collection[0] && utils.isObject(collection[0])
        this.vms = this.oldCollection
            ? this.diff(collection, isObject)
            : this.init(collection, isObject)

        if (this.childId) {
            this.vm.$[this.childId] = this.vms
        }

    },

    init: function (collection, isObject) {
        var vm, vms = []
        for (var i = 0, l = collection.length; i < l; i++) {
            vm = this.build(collection[i], i, isObject)
            vms.push(vm)
            if (this.compiler.init) {
                this.container.insertBefore(vm.$el, this.ref)
            } else {
                vm.$before(this.ref)
            }
        }
        return vms
    },

    /**
     *  Diff the new array with the old
     *  and determine the minimum amount of DOM manipulations.
     */
    diff: function (newCollection, isObject) {

        var i, l, item, vm,
            oldIndex,
            targetNext,
            currentNext,
            nextEl,
            ctn    = this.container,
            oldVMs = this.oldVMs,
            vms    = []

        vms.length = newCollection.length

        // first pass, collect new reused and new created
        for (i = 0, l = newCollection.length; i < l; i++) {
            item = newCollection[i]
            if (isObject) {
                item.$index = i
                if (item.__emitter__ && item.__emitter__[this.identifier]) {
                    // this piece of data is being reused.
                    // record its final position in reused vms
                    item.$reused = true
                } else {
                    vms[i] = this.build(item, i, isObject)
                }
            } else {
                // we can't attach an identifier to primitive values
                // so have to do an indexOf...
                oldIndex = indexOf(oldVMs, item)
                if (oldIndex > -1) {
                    // record the position on the existing vm
                    oldVMs[oldIndex].$reused = true
                    oldVMs[oldIndex].$data.$index = i
                } else {
                    vms[i] = this.build(item, i, isObject)
                }
            }
        }

        // second pass, collect old reused and destroy unused
        for (i = 0, l = oldVMs.length; i < l; i++) {
            vm = oldVMs[i]
            item = this.arg
                ? vm.$data[this.arg]
                : vm.$data
            if (item.$reused) {
                vm.$reused = true
                delete item.$reused
            }
            if (vm.$reused) {
                // update the index to latest
                vm.$index = item.$index
                // the item could have had a new key
                if (item.$key && item.$key !== vm.$key) {
                    vm.$key = item.$key
                }
                vms[vm.$index] = vm
            } else {
                // this one can be destroyed.
                if (item.__emitter__) {
                    delete item.__emitter__[this.identifier]
                }
                vm.$destroy()
            }
        }

        // final pass, move/insert DOM elements
        i = vms.length
        while (i--) {
            vm = vms[i]
            item = vm.$data
            targetNext = vms[i + 1]
            if (vm.$reused) {
                nextEl = vm.$el.nextSibling
                // destroyed VMs' element might still be in the DOM
                // due to transitions
                while (!nextEl.vue_vm && nextEl !== this.ref) {
                    nextEl = nextEl.nextSibling
                }
                currentNext = nextEl.vue_vm
                if (currentNext !== targetNext) {
                    if (!targetNext) {
                        ctn.insertBefore(vm.$el, this.ref)
                    } else {
                        nextEl = targetNext.$el
                        // new VMs' element might not be in the DOM yet
                        // due to transitions
                        while (!nextEl.parentNode) {
                            targetNext = vms[nextEl.vue_vm.$index + 1]
                            nextEl = targetNext
                                ? targetNext.$el
                                : this.ref
                        }
                        ctn.insertBefore(vm.$el, nextEl)
                    }
                }
                delete vm.$reused
                delete item.$index
                delete item.$key
            } else { // a new vm
                vm.$before(targetNext ? targetNext.$el : this.ref)
            }
        }

        return vms
    },

    build: function (data, index, isObject) {

        // wrap non-object values
        var raw, alias,
            wrap = !isObject || this.arg
        if (wrap) {
            raw = data
            alias = this.arg || '$value'
            data = {}
            data[alias] = raw
        }
        data.$index = index

        var el = this.el.cloneNode(true),
            Ctor = this.compiler.resolveComponent(el, data),
            vm = new Ctor({
                el: el,
                data: data,
                parent: this.vm,
                compilerOptions: {
                    repeat: true,
                    expCache: this.expCache
                }
            })

        if (isObject) {
            // attach an ienumerable identifier to the raw data
            (raw || data).__emitter__[this.identifier] = true
        }

        if (wrap) {
            var self = this,
                sync = function (val) {
                    self.lock = true
                    self.collection.$set(vm.$index, val)
                    self.lock = false
                }
            vm.$compiler.observer.on('change:' + alias, sync)
        }

        return vm

    },

    unbind: function () {
        if (this.childId) {
            delete this.vm.$[this.childId]
        }
        if (this.vms) {
            var i = this.vms.length
            while (i--) {
                this.vms[i].$destroy()
            }
        }
    }
}

// Helpers --------------------------------------------------------------------

/**
 *  Find an object or a wrapped data object
 *  from an Array
 */
function indexOf (vms, obj) {
    for (var vm, i = 0, l = vms.length; i < l; i++) {
        vm = vms[i]
        if (!vm.$reused && vm.$value === obj) {
            return i
        }
    }
    return -1
}
},{"../config":5,"../utils":25}],15:[function(require,module,exports){
var camelRE = /-([a-z])/g,
    prefixes = ['webkit', 'moz', 'ms']

function camelReplacer (m) {
    return m[1].toUpperCase()
}

/**
 *  Binding for CSS styles
 */
module.exports = {

    bind: function () {
        var prop = this.arg
        if (!prop) return
        var first = prop.charAt(0)
        if (first === '$') {
            // properties that start with $ will be auto-prefixed
            prop = prop.slice(1)
            this.prefixed = true
        } else if (first === '-') {
            // normal starting hyphens should not be converted
            prop = prop.slice(1)
        }
        this.prop = prop.replace(camelRE, camelReplacer)
    },

    update: function (value) {
        var prop = this.prop
        if (prop) {
            this.el.style[prop] = value
            if (this.prefixed) {
                prop = prop.charAt(0).toUpperCase() + prop.slice(1)
                var i = prefixes.length
                while (i--) {
                    this.el.style[prefixes[i] + prop] = value
                }
            }
        } else {
            this.el.style.cssText = value
        }
    }

}
},{}],16:[function(require,module,exports){
/**
 *  Manages a conditional child VM using the
 *  binding's value as the component ID.
 */
module.exports = {

    bind: function () {

        // track position in DOM with a ref node
        var el       = this.raw = this.el,
            parent   = el.parentNode,
            ref      = this.ref = document.createComment('v-view')
        parent.insertBefore(ref, el)
        parent.removeChild(el)

        // cache original content
        /* jshint boss: true */
        var node,
            frag = this.inner = document.createElement('div')
        while (node = el.firstChild) {
            frag.appendChild(node)
        }

    },

    update: function(value) {

        this._unbind()

        var Ctor  = this.compiler.getOption('components', value)
        if (!Ctor) return

        this.childVM = new Ctor({
            el: this.raw.cloneNode(true),
            parent: this.vm,
            compilerOptions: {
                rawContent: this.inner.cloneNode(true)
            }
        })

        this.el = this.childVM.$el
        if (this.compiler.init) {
            this.ref.parentNode.insertBefore(this.el, this.ref)
        } else {
            this.childVM.$before(this.ref)
        }

    },

    unbind: function() {
        if (this.childVM) {
            this.childVM.$destroy()
        }
    }

}
},{}],17:[function(require,module,exports){
var utils = require('../utils')

/**
 *  Binding for inheriting data from parent VMs.
 */
module.exports = {

    bind: function () {

        var self      = this,
            childKey  = self.arg,
            parentKey = self.key,
            compiler  = self.compiler,
            owner     = self.binding.compiler

        if (compiler === owner) {
            this.alone = true
            return
        }

        if (childKey) {
            if (!compiler.bindings[childKey]) {
                compiler.createBinding(childKey)
            }
            // sync changes on child back to parent
            compiler.observer.on('change:' + childKey, function (val) {
                if (compiler.init) return
                if (!self.lock) {
                    self.lock = true
                    utils.nextTick(function () {
                        self.lock = false
                    })
                }
                owner.vm.$set(parentKey, val)
            })
        }
    },

    update: function (value) {
        // sync from parent
        if (!this.alone && !this.lock) {
            if (this.arg) {
                this.vm.$set(this.arg, value)
            } else {
                this.vm.$data = value
            }
        }
    }

}
},{"../utils":25}],18:[function(require,module,exports){
function Emitter (ctx) {
    this._ctx = ctx || this
}

var EmitterProto = Emitter.prototype

EmitterProto.on = function(event, fn){
    this._cbs = this._cbs || {}
    ;(this._cbs[event] = this._cbs[event] || [])
        .push(fn)
    return this
}

EmitterProto.once = function(event, fn){
    var self = this
    this._cbs = this._cbs || {}

    function on () {
        self.off(event, on)
        fn.apply(this, arguments)
    }

    on.fn = fn
    this.on(event, on)
    return this
}

EmitterProto.off = function(event, fn){
    this._cbs = this._cbs || {}

    // all
    if (!arguments.length) {
        this._cbs = {}
        return this
    }

    // specific event
    var callbacks = this._cbs[event]
    if (!callbacks) return this

    // remove all handlers
    if (arguments.length === 1) {
        delete this._cbs[event]
        return this
    }

    // remove specific handler
    var cb
    for (var i = 0; i < callbacks.length; i++) {
        cb = callbacks[i]
        if (cb === fn || cb.fn === fn) {
            callbacks.splice(i, 1)
            break
        }
    }
    return this
}

EmitterProto.emit = function(event, a, b, c){
    this._cbs = this._cbs || {}
    var callbacks = this._cbs[event]

    if (callbacks) {
        callbacks = callbacks.slice(0)
        for (var i = 0, len = callbacks.length; i < len; i++) {
            callbacks[i].call(this._ctx, a, b, c)
        }
    }

    return this
}

module.exports = Emitter
},{}],19:[function(require,module,exports){
var utils           = require('./utils'),
    STR_SAVE_RE     = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
    STR_RESTORE_RE  = /"(\d+)"/g,
    NEWLINE_RE      = /\n/g,
    CTOR_RE         = new RegExp('constructor'.split('').join('[\'"+, ]*')),
    UNICODE_RE      = /\\u\d\d\d\d/

// Variable extraction scooped from https://github.com/RubyLouvre/avalon

var KEYWORDS =
        // keywords
        'break,case,catch,continue,debugger,default,delete,do,else,false' +
        ',finally,for,function,if,in,instanceof,new,null,return,switch,this' +
        ',throw,true,try,typeof,var,void,while,with,undefined' +
        // reserved
        ',abstract,boolean,byte,char,class,const,double,enum,export,extends' +
        ',final,float,goto,implements,import,int,interface,long,native' +
        ',package,private,protected,public,short,static,super,synchronized' +
        ',throws,transient,volatile' +
        // ECMA 5 - use strict
        ',arguments,let,yield' +
        // allow using Math in expressions
        ',Math',
        
    KEYWORDS_RE = new RegExp(["\\b" + KEYWORDS.replace(/,/g, '\\b|\\b') + "\\b"].join('|'), 'g'),
    REMOVE_RE   = /\/\*(?:.|\n)*?\*\/|\/\/[^\n]*\n|\/\/[^\n]*$|'[^']*'|"[^"]*"|[\s\t\n]*\.[\s\t\n]*[$\w\.]+/g,
    SPLIT_RE    = /[^\w$]+/g,
    NUMBER_RE   = /\b\d[^,]*/g,
    BOUNDARY_RE = /^,+|,+$/g

/**
 *  Strip top level variable names from a snippet of JS expression
 */
function getVariables (code) {
    code = code
        .replace(REMOVE_RE, '')
        .replace(SPLIT_RE, ',')
        .replace(KEYWORDS_RE, '')
        .replace(NUMBER_RE, '')
        .replace(BOUNDARY_RE, '')
    return code
        ? code.split(/,+/)
        : []
}

/**
 *  A given path could potentially exist not on the
 *  current compiler, but up in the parent chain somewhere.
 *  This function generates an access relationship string
 *  that can be used in the getter function by walking up
 *  the parent chain to check for key existence.
 *
 *  It stops at top parent if no vm in the chain has the
 *  key. It then creates any missing bindings on the
 *  final resolved vm.
 */
function traceScope (path, compiler, data) {
    var rel  = '',
        dist = 0,
        self = compiler

    if (data && utils.get(data, path) !== undefined) {
        // hack: temporarily attached data
        return '$temp.'
    }

    while (compiler) {
        if (compiler.hasKey(path)) {
            break
        } else {
            compiler = compiler.parent
            dist++
        }
    }
    if (compiler) {
        while (dist--) {
            rel += '$parent.'
        }
        if (!compiler.bindings[path] && path.charAt(0) !== '$') {
            compiler.createBinding(path)
        }
    } else {
        self.createBinding(path)
    }
    return rel
}

/**
 *  Create a function from a string...
 *  this looks like evil magic but since all variables are limited
 *  to the VM's data it's actually properly sandboxed
 */
function makeGetter (exp, raw) {
    var fn
    try {
        fn = new Function(exp)
    } catch (e) {
        utils.warn('Error parsing expression: ' + raw)
    }
    return fn
}

/**
 *  Escape a leading dollar sign for regex construction
 */
function escapeDollar (v) {
    return v.charAt(0) === '$'
        ? '\\' + v
        : v
}

/**
 *  Parse and return an anonymous computed property getter function
 *  from an arbitrary expression, together with a list of paths to be
 *  created as bindings.
 */
exports.parse = function (exp, compiler, data) {
    // unicode and 'constructor' are not allowed for XSS security.
    if (UNICODE_RE.test(exp) || CTOR_RE.test(exp)) {
        utils.warn('Unsafe expression: ' + exp)
        return
    }
    // extract variable names
    var vars = getVariables(exp)
    if (!vars.length) {
        return makeGetter('return ' + exp, exp)
    }
    vars = utils.unique(vars)

    var accessors = '',
        has       = utils.hash(),
        strings   = [],
        // construct a regex to extract all valid variable paths
        // ones that begin with "$" are particularly tricky
        // because we can't use \b for them
        pathRE = new RegExp(
            "[^$\\w\\.](" +
            vars.map(escapeDollar).join('|') +
            ")[$\\w\\.]*\\b", 'g'
        ),
        body = (' ' + exp)
            .replace(STR_SAVE_RE, saveStrings)
            .replace(pathRE, replacePath)
            .replace(STR_RESTORE_RE, restoreStrings)

    body = accessors + 'return ' + body

    function saveStrings (str) {
        var i = strings.length
        // escape newlines in strings so the expression
        // can be correctly evaluated
        strings[i] = str.replace(NEWLINE_RE, '\\n')
        return '"' + i + '"'
    }

    function replacePath (path) {
        // keep track of the first char
        var c = path.charAt(0)
        path = path.slice(1)
        var val = 'this.' + traceScope(path, compiler, data) + path
        if (!has[path]) {
            accessors += val + ';'
            has[path] = 1
        }
        // don't forget to put that first char back
        return c + val
    }

    function restoreStrings (str, i) {
        return strings[i]
    }

    return makeGetter(body, exp)
}

/**
 *  Evaluate an expression in the context of a compiler.
 *  Accepts additional data.
 */
exports.eval = function (exp, compiler, data) {
    var getter = exports.parse(exp, compiler, data), res
    if (getter) {
        // hack: temporarily attach the additional data so
        // it can be accessed in the getter
        compiler.vm.$temp = data
        res = getter.call(compiler.vm)
        delete compiler.vm.$temp
    }
    return res
}
},{"./utils":25}],20:[function(require,module,exports){
var utils    = require('./utils'),
    get      = utils.get,
    slice    = [].slice,
    QUOTE_RE = /^'.*'$/,
    filters  = module.exports = utils.hash()

/**
 *  'abc' => 'Abc'
 */
filters.capitalize = function (value) {
    if (!value && value !== 0) return ''
    value = value.toString()
    return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 *  'abc' => 'ABC'
 */
filters.uppercase = function (value) {
    return (value || value === 0)
        ? value.toString().toUpperCase()
        : ''
}

/**
 *  'AbC' => 'abc'
 */
filters.lowercase = function (value) {
    return (value || value === 0)
        ? value.toString().toLowerCase()
        : ''
}

/**
 *  12345 => $12,345.00
 */
filters.currency = function (value, sign) {
    if (!value && value !== 0) return ''
    sign = sign || '$'
    var s = Math.floor(value).toString(),
        i = s.length % 3,
        h = i > 0 ? (s.slice(0, i) + (s.length > 3 ? ',' : '')) : '',
        f = '.' + value.toFixed(2).slice(-2)
    return sign + h + s.slice(i).replace(/(\d{3})(?=\d)/g, '$1,') + f
}

/**
 *  args: an array of strings corresponding to
 *  the single, double, triple ... forms of the word to
 *  be pluralized. When the number to be pluralized
 *  exceeds the length of the args, it will use the last
 *  entry in the array.
 *
 *  e.g. ['single', 'double', 'triple', 'multiple']
 */
filters.pluralize = function (value) {
    var args = slice.call(arguments, 1)
    return args.length > 1
        ? (args[value - 1] || args[args.length - 1])
        : (args[value - 1] || args[0] + 's')
}

/**
 *  A special filter that takes a handler function,
 *  wraps it so it only gets triggered on specific keypresses.
 *
 *  v-on only
 */

var keyCodes = {
    enter    : 13,
    tab      : 9,
    'delete' : 46,
    up       : 38,
    left     : 37,
    right    : 39,
    down     : 40,
    esc      : 27
}

filters.key = function (handler, key) {
    if (!handler) return
    var code = keyCodes[key]
    if (!code) {
        code = parseInt(key, 10)
    }
    return function (e) {
        if (e.keyCode === code) {
            return handler.call(this, e)
        }
    }
}

/**
 *  Filter filter for v-repeat
 */
filters.filterBy = function (arr, searchKey, delimiter, dataKey) {

    // allow optional `in` delimiter
    // because why not
    if (delimiter && delimiter !== 'in') {
        dataKey = delimiter
    }

    // get the search string
    var search = stripQuotes(searchKey) || this.$get(searchKey)
    if (!search) return arr
    search = search.toLowerCase()

    // get the optional dataKey
    dataKey = dataKey && (stripQuotes(dataKey) || this.$get(dataKey))

    // convert object to array
    if (!Array.isArray(arr)) {
        arr = utils.objectToArray(arr)
    }

    return arr.filter(function (item) {
        return dataKey
            ? contains(get(item, dataKey), search)
            : contains(item, search)
    })

}

filters.filterBy.computed = true

/**
 *  Sort fitler for v-repeat
 */
filters.orderBy = function (arr, sortKey, reverseKey) {

    var key = stripQuotes(sortKey) || this.$get(sortKey)
    if (!key) return arr

    // convert object to array
    if (!Array.isArray(arr)) {
        arr = utils.objectToArray(arr)
    }

    var order = 1
    if (reverseKey) {
        if (reverseKey === '-1') {
            order = -1
        } else if (reverseKey.charAt(0) === '!') {
            reverseKey = reverseKey.slice(1)
            order = this.$get(reverseKey) ? 1 : -1
        } else {
            order = this.$get(reverseKey) ? -1 : 1
        }
    }

    // sort on a copy to avoid mutating original array
    return arr.slice().sort(function (a, b) {
        a = get(a, key)
        b = get(b, key)
        return a === b ? 0 : a > b ? order : -order
    })

}

filters.orderBy.computed = true

// Array filter helpers -------------------------------------------------------

/**
 *  String contain helper
 */
function contains (val, search) {
    /* jshint eqeqeq: false */
    if (utils.isObject(val)) {
        for (var key in val) {
            if (contains(val[key], search)) {
                return true
            }
        }
    } else if (val != null) {
        return val.toString().toLowerCase().indexOf(search) > -1
    }
}

/**
 *  Test whether a string is in quotes,
 *  if yes return stripped string
 */
function stripQuotes (str) {
    if (QUOTE_RE.test(str)) {
        return str.slice(1, -1)
    }
}
},{"./utils":25}],21:[function(require,module,exports){
var config      = require('./config'),
    ViewModel   = require('./viewmodel'),
    utils       = require('./utils'),
    makeHash    = utils.hash,
    assetTypes  = ['directive', 'filter', 'partial', 'effect', 'component']

// require these so Browserify can catch them
// so they can be used in Vue.require
require('./observer')
require('./transition')

ViewModel.options = config.globalAssets = {
    directives  : require('./directives'),
    filters     : require('./filters'),
    partials    : makeHash(),
    effects     : makeHash(),
    components  : makeHash()
}

/**
 *  Expose asset registration methods
 */
assetTypes.forEach(function (type) {
    ViewModel[type] = function (id, value) {
        var hash = this.options[type + 's']
        if (!hash) {
            hash = this.options[type + 's'] = makeHash()
        }
        if (!value) return hash[id]
        if (type === 'partial') {
            value = utils.toFragment(value)
        } else if (type === 'component') {
            value = utils.toConstructor(value)
        } else if (type === 'filter') {
            utils.checkFilter(value)
        }
        hash[id] = value
        return this
    }
})

/**
 *  Set config options
 */
ViewModel.config = function (opts, val) {
    if (typeof opts === 'string') {
        if (val === undefined) {
            return config[opts]
        } else {
            config[opts] = val
        }
    } else {
        utils.extend(config, opts)
    }
    return this
}

/**
 *  Expose an interface for plugins
 */
ViewModel.use = function (plugin) {
    if (typeof plugin === 'string') {
        try {
            plugin = require(plugin)
        } catch (e) {
            utils.warn('Cannot find plugin: ' + plugin)
            return
        }
    }

    // additional parameters
    var args = [].slice.call(arguments, 1)
    args.unshift(this)

    if (typeof plugin.install === 'function') {
        plugin.install.apply(plugin, args)
    } else {
        plugin.apply(null, args)
    }
    return this
}

/**
 *  Expose internal modules for plugins
 */
ViewModel.require = function (path) {
    return require('./' + path)
}

ViewModel.extend = extend
ViewModel.nextTick = utils.nextTick

/**
 *  Expose the main ViewModel class
 *  and add extend method
 */
function extend (options) {

    var ParentVM = this

    // extend data options need to be copied
    // on instantiation
    if (options.data) {
        options.defaultData = options.data
        delete options.data
    }

    // inherit options
    options = inheritOptions(options, ParentVM.options, true)
    utils.processOptions(options)

    var ExtendedVM = function (opts, asParent) {
        if (!asParent) {
            opts = inheritOptions(opts, options, true)
        }
        ParentVM.call(this, opts, true)
    }

    // inherit prototype props
    var proto = ExtendedVM.prototype = Object.create(ParentVM.prototype)
    utils.defProtected(proto, 'constructor', ExtendedVM)

    // allow extended VM to be further extended
    ExtendedVM.extend  = extend
    ExtendedVM.super   = ParentVM
    ExtendedVM.options = options

    // allow extended VM to add its own assets
    assetTypes.forEach(function (type) {
        ExtendedVM[type] = ViewModel[type]
    })

    // allow extended VM to use plugins
    ExtendedVM.use     = ViewModel.use
    ExtendedVM.require = ViewModel.require

    return ExtendedVM
}

/**
 *  Inherit options
 *
 *  For options such as `data`, `vms`, `directives`, 'partials',
 *  they should be further extended. However extending should only
 *  be done at top level.
 *  
 *  `proto` is an exception because it's handled directly on the
 *  prototype.
 *
 *  `el` is an exception because it's not allowed as an
 *  extension option, but only as an instance option.
 */
function inheritOptions (child, parent, topLevel) {
    child = child || {}
    if (!parent) return child
    for (var key in parent) {
        if (key === 'el') continue
        var val = child[key],
            parentVal = parent[key]
        if (topLevel && typeof val === 'function' && parentVal) {
            // merge hook functions into an array
            child[key] = [val]
            if (Array.isArray(parentVal)) {
                child[key] = child[key].concat(parentVal)
            } else {
                child[key].push(parentVal)
            }
        } else if (
            topLevel &&
            (utils.isTrueObject(val) || utils.isTrueObject(parentVal))
            && !(parentVal instanceof ViewModel)
        ) {
            // merge toplevel object options
            child[key] = inheritOptions(val, parentVal)
        } else if (val === undefined) {
            // inherit if child doesn't override
            child[key] = parentVal
        }
    }
    return child
}

module.exports = ViewModel
},{"./config":5,"./directives":10,"./filters":20,"./observer":22,"./transition":24,"./utils":25,"./viewmodel":26}],22:[function(require,module,exports){
/* jshint proto:true */

var Emitter  = require('./emitter'),
    utils    = require('./utils'),
    // cache methods
    def      = utils.defProtected,
    isObject = utils.isObject,
    isArray  = Array.isArray,
    hasOwn   = ({}).hasOwnProperty,
    oDef     = Object.defineProperty,
    slice    = [].slice,
    // fix for IE + __proto__ problem
    // define methods as inenumerable if __proto__ is present,
    // otherwise enumerable so we can loop through and manually
    // attach to array instances
    hasProto = ({}).__proto__

// Array Mutation Handlers & Augmentations ------------------------------------

// The proxy prototype to replace the __proto__ of
// an observed array
var ArrayProxy = Object.create(Array.prototype)

// intercept mutation methods
;[
    'push',
    'pop',
    'shift',
    'unshift',
    'splice',
    'sort',
    'reverse'
].forEach(watchMutation)

// Augment the ArrayProxy with convenience methods
def(ArrayProxy, '$set', function (index, data) {
    return this.splice(index, 1, data)[0]
}, !hasProto)

def(ArrayProxy, '$remove', function (index) {
    if (typeof index !== 'number') {
        index = this.indexOf(index)
    }
    if (index > -1) {
        return this.splice(index, 1)[0]
    }
}, !hasProto)

/**
 *  Intercep a mutation event so we can emit the mutation info.
 *  we also analyze what elements are added/removed and link/unlink
 *  them with the parent Array.
 */
function watchMutation (method) {
    def(ArrayProxy, method, function () {

        var args = slice.call(arguments),
            result = Array.prototype[method].apply(this, args),
            inserted, removed

        // determine new / removed elements
        if (method === 'push' || method === 'unshift') {
            inserted = args
        } else if (method === 'pop' || method === 'shift') {
            removed = [result]
        } else if (method === 'splice') {
            inserted = args.slice(2)
            removed = result
        }
        
        // link & unlink
        linkArrayElements(this, inserted)
        unlinkArrayElements(this, removed)

        // emit the mutation event
        this.__emitter__.emit('mutate', '', this, {
            method   : method,
            args     : args,
            result   : result,
            inserted : inserted,
            removed  : removed
        })

        return result
        
    }, !hasProto)
}

/**
 *  Link new elements to an Array, so when they change
 *  and emit events, the owner Array can be notified.
 */
function linkArrayElements (arr, items) {
    if (items) {
        var i = items.length, item, owners
        while (i--) {
            item = items[i]
            if (isWatchable(item)) {
                // if object is not converted for observing
                // convert it...
                if (!item.__emitter__) {
                    convert(item)
                    watch(item)
                }
                owners = item.__emitter__.owners
                if (owners.indexOf(arr) < 0) {
                    owners.push(arr)
                }
            }
        }
    }
}

/**
 *  Unlink removed elements from the ex-owner Array.
 */
function unlinkArrayElements (arr, items) {
    if (items) {
        var i = items.length, item
        while (i--) {
            item = items[i]
            if (item && item.__emitter__) {
                var owners = item.__emitter__.owners
                if (owners) owners.splice(owners.indexOf(arr))
            }
        }
    }
}

// Object add/delete key augmentation -----------------------------------------

var ObjProxy = Object.create(Object.prototype)

def(ObjProxy, '$add', function (key, val) {
    if (hasOwn.call(this, key)) return
    this[key] = val
    convertKey(this, key)
    // emit a propagating set event
    this.__emitter__.emit('set', key, val, true)
}, !hasProto)

def(ObjProxy, '$delete', function (key) {
    if (!(hasOwn.call(this, key))) return
    // trigger set events
    this[key] = undefined
    delete this[key]
    this.__emitter__.emit('delete', key)
}, !hasProto)

// Watch Helpers --------------------------------------------------------------

/**
 *  Check if a value is watchable
 */
function isWatchable (obj) {
    return typeof obj === 'object' && obj && !obj.$compiler
}

/**
 *  Convert an Object/Array to give it a change emitter.
 */
function convert (obj) {
    if (obj.__emitter__) return true
    var emitter = new Emitter()
    def(obj, '__emitter__', emitter)
    emitter
        .on('set', function (key, val, propagate) {
            if (propagate) propagateChange(obj)
        })
        .on('mutate', function () {
            propagateChange(obj)
        })
    emitter.values = utils.hash()
    emitter.owners = []
    return false
}

/**
 *  Propagate an array element's change to its owner arrays
 */
function propagateChange (obj) {
    var owners = obj.__emitter__.owners,
        i = owners.length
    while (i--) {
        owners[i].__emitter__.emit('set', '', '', true)
    }
}

/**
 *  Watch target based on its type
 */
function watch (obj) {
    if (isArray(obj)) {
        watchArray(obj)
    } else {
        watchObject(obj)
    }
}

/**
 *  Augment target objects with modified
 *  methods
 */
function augment (target, src) {
    if (hasProto) {
        target.__proto__ = src
    } else {
        for (var key in src) {
            def(target, key, src[key])
        }
    }
}

/**
 *  Watch an Object, recursive.
 */
function watchObject (obj) {
    augment(obj, ObjProxy)
    for (var key in obj) {
        convertKey(obj, key)
    }
}

/**
 *  Watch an Array, overload mutation methods
 *  and add augmentations by intercepting the prototype chain
 */
function watchArray (arr) {
    augment(arr, ArrayProxy)
    linkArrayElements(arr, arr)
}

/**
 *  Define accessors for a property on an Object
 *  so it emits get/set events.
 *  Then watch the value itself.
 */
function convertKey (obj, key) {
    var keyPrefix = key.charAt(0)
    if (keyPrefix === '$' || keyPrefix === '_') {
        return
    }
    // emit set on bind
    // this means when an object is observed it will emit
    // a first batch of set events.
    var emitter = obj.__emitter__,
        values  = emitter.values

    init(obj[key])

    oDef(obj, key, {
        enumerable: true,
        configurable: true,
        get: function () {
            var value = values[key]
            // only emit get on tip values
            if (pub.shouldGet) {
                emitter.emit('get', key)
            }
            return value
        },
        set: function (newVal) {
            var oldVal = values[key]
            unobserve(oldVal, key, emitter)
            copyPaths(newVal, oldVal)
            // an immediate property should notify its parent
            // to emit set for itself too
            init(newVal, true)
        }
    })

    function init (val, propagate) {
        values[key] = val
        emitter.emit('set', key, val, propagate)
        if (isArray(val)) {
            emitter.emit('set', key + '.length', val.length, propagate)
        }
        observe(val, key, emitter)
    }
}

/**
 *  When a value that is already converted is
 *  observed again by another observer, we can skip
 *  the watch conversion and simply emit set event for
 *  all of its properties.
 */
function emitSet (obj) {
    var emitter = obj && obj.__emitter__
    if (!emitter) return
    if (isArray(obj)) {
        emitter.emit('set', 'length', obj.length)
    } else {
        var key, val
        for (key in obj) {
            val = obj[key]
            emitter.emit('set', key, val)
            emitSet(val)
        }
    }
}

/**
 *  Make sure all the paths in an old object exists
 *  in a new object.
 *  So when an object changes, all missing keys will
 *  emit a set event with undefined value.
 */
function copyPaths (newObj, oldObj) {
    if (!isObject(newObj) || !isObject(oldObj)) {
        return
    }
    var path, oldVal, newVal
    for (path in oldObj) {
        if (!(hasOwn.call(newObj, path))) {
            oldVal = oldObj[path]
            if (isArray(oldVal)) {
                newObj[path] = []
            } else if (isObject(oldVal)) {
                newVal = newObj[path] = {}
                copyPaths(newVal, oldVal)
            } else {
                newObj[path] = undefined
            }
        }
    }
}

/**
 *  walk along a path and make sure it can be accessed
 *  and enumerated in that object
 */
function ensurePath (obj, key) {
    var path = key.split('.'), sec
    for (var i = 0, d = path.length - 1; i < d; i++) {
        sec = path[i]
        if (!obj[sec]) {
            obj[sec] = {}
            if (obj.__emitter__) convertKey(obj, sec)
        }
        obj = obj[sec]
    }
    if (isObject(obj)) {
        sec = path[i]
        if (!(hasOwn.call(obj, sec))) {
            obj[sec] = undefined
            if (obj.__emitter__) convertKey(obj, sec)
        }
    }
}

// Main API Methods -----------------------------------------------------------

/**
 *  Observe an object with a given path,
 *  and proxy get/set/mutate events to the provided observer.
 */
function observe (obj, rawPath, observer) {

    if (!isWatchable(obj)) return

    var path = rawPath ? rawPath + '.' : '',
        alreadyConverted = convert(obj),
        emitter = obj.__emitter__

    // setup proxy listeners on the parent observer.
    // we need to keep reference to them so that they
    // can be removed when the object is un-observed.
    observer.proxies = observer.proxies || {}
    var proxies = observer.proxies[path] = {
        get: function (key) {
            observer.emit('get', path + key)
        },
        set: function (key, val, propagate) {
            if (key) observer.emit('set', path + key, val)
            // also notify observer that the object itself changed
            // but only do so when it's a immediate property. this
            // avoids duplicate event firing.
            if (rawPath && propagate) {
                observer.emit('set', rawPath, obj, true)
            }
        },
        mutate: function (key, val, mutation) {
            // if the Array is a root value
            // the key will be null
            var fixedPath = key ? path + key : rawPath
            observer.emit('mutate', fixedPath, val, mutation)
            // also emit set for Array's length when it mutates
            var m = mutation.method
            if (m !== 'sort' && m !== 'reverse') {
                observer.emit('set', fixedPath + '.length', val.length)
            }
        }
    }

    // attach the listeners to the child observer.
    // now all the events will propagate upwards.
    emitter
        .on('get', proxies.get)
        .on('set', proxies.set)
        .on('mutate', proxies.mutate)

    if (alreadyConverted) {
        // for objects that have already been converted,
        // emit set events for everything inside
        emitSet(obj)
    } else {
        watch(obj)
    }
}

/**
 *  Cancel observation, turn off the listeners.
 */
function unobserve (obj, path, observer) {

    if (!obj || !obj.__emitter__) return

    path = path ? path + '.' : ''
    var proxies = observer.proxies[path]
    if (!proxies) return

    // turn off listeners
    obj.__emitter__
        .off('get', proxies.get)
        .off('set', proxies.set)
        .off('mutate', proxies.mutate)

    // remove reference
    observer.proxies[path] = null
}

// Expose API -----------------------------------------------------------------

var pub = module.exports = {

    // whether to emit get events
    // only enabled during dependency parsing
    shouldGet   : false,

    observe     : observe,
    unobserve   : unobserve,
    ensurePath  : ensurePath,
    copyPaths   : copyPaths,
    watch       : watch,
    convert     : convert,
    convertKey  : convertKey
}
},{"./emitter":18,"./utils":25}],23:[function(require,module,exports){
var openChar        = '{',
    endChar         = '}',
    ESCAPE_RE       = /[-.*+?^${}()|[\]\/\\]/g,
    BINDING_RE      = buildInterpolationRegex(),
    // lazy require
    Directive

function buildInterpolationRegex () {
    var open = escapeRegex(openChar),
        end  = escapeRegex(endChar)
    return new RegExp(open + open + open + '?(.+?)' + end + '?' + end + end)
}

function escapeRegex (str) {
    return str.replace(ESCAPE_RE, '\\$&')
}

function setDelimiters (delimiters) {
    exports.delimiters = delimiters
    openChar = delimiters[0]
    endChar = delimiters[1]
    BINDING_RE = buildInterpolationRegex()
}

/** 
 *  Parse a piece of text, return an array of tokens
 *  token types:
 *  1. plain string
 *  2. object with key = binding key
 *  3. object with key & html = true
 */
function parse (text) {
    if (!BINDING_RE.test(text)) return null
    var m, i, token, match, tokens = []
    /* jshint boss: true */
    while (m = text.match(BINDING_RE)) {
        i = m.index
        if (i > 0) tokens.push(text.slice(0, i))
        token = { key: m[1].trim() }
        match = m[0]
        token.html =
            match.charAt(2) === openChar &&
            match.charAt(match.length - 3) === endChar
        tokens.push(token)
        text = text.slice(i + m[0].length)
    }
    if (text.length) tokens.push(text)
    return tokens
}

/**
 *  Parse an attribute value with possible interpolation tags
 *  return a Directive-friendly expression
 *
 *  e.g.  a {{b}} c  =>  "a " + b + " c"
 */
function parseAttr (attr) {
    Directive = Directive || require('./directive')
    var tokens = parse(attr)
    if (!tokens) return null
    if (tokens.length === 1) return tokens[0].key
    var res = [], token
    for (var i = 0, l = tokens.length; i < l; i++) {
        token = tokens[i]
        res.push(
            token.key
                ? inlineFilters(token.key)
                : ('"' + token + '"')
        )
    }
    return res.join('+')
}

/**
 *  Inlines any possible filters in a binding
 *  so that we can combine everything into a huge expression
 */
function inlineFilters (key) {
    var filters = Directive.parseFilters(key)
    if (filters) {
        key = Directive.inlineFilters(
            Directive.parseKey(key),
            filters
        )
    }
    return '(' + key + ')'
}

exports.parse         = parse
exports.parseAttr     = parseAttr
exports.setDelimiters = setDelimiters
exports.delimiters    = [openChar, endChar]
},{"./directive":7}],24:[function(require,module,exports){
var endEvents  = sniffEndEvents(),
    config     = require('./config'),
    // batch enter animations so we only force the layout once
    Batcher    = require('./batcher'),
    batcher    = new Batcher(),
    // cache timer functions
    setTO      = window.setTimeout,
    clearTO    = window.clearTimeout,
    // exit codes for testing
    codes = {
        CSS_E     : 1,
        CSS_L     : 2,
        JS_E      : 3,
        JS_L      : 4,
        CSS_SKIP  : -1,
        JS_SKIP   : -2,
        JS_SKIP_E : -3,
        JS_SKIP_L : -4,
        INIT      : -5,
        SKIP      : -6
    }

// force layout before triggering transitions/animations
batcher._preFlush = function () {
    /* jshint unused: false */
    var f = document.body.offsetHeight
}

/**
 *  stage:
 *    1 = enter
 *    2 = leave
 */
var transition = module.exports = function (el, stage, cb, compiler) {

    var changeState = function () {
        cb()
        compiler.execHook(stage > 0 ? 'attached' : 'detached')
    }

    if (compiler.init) {
        changeState()
        return codes.INIT
    }

    var hasTransition = el.vue_trans === '',
        hasAnimation  = el.vue_anim === '',
        effectId      = el.vue_effect

    if (effectId) {
        return applyTransitionFunctions(
            el,
            stage,
            changeState,
            effectId,
            compiler
        )
    } else if (hasTransition || hasAnimation) {
        return applyTransitionClass(
            el,
            stage,
            changeState,
            hasAnimation
        )
    } else {
        changeState()
        return codes.SKIP
    }

}

transition.codes = codes

/**
 *  Togggle a CSS class to trigger transition
 */
function applyTransitionClass (el, stage, changeState, hasAnimation) {

    if (!endEvents.trans) {
        changeState()
        return codes.CSS_SKIP
    }

    // if the browser supports transition,
    // it must have classList...
    var onEnd,
        classList        = el.classList,
        existingCallback = el.vue_trans_cb,
        enterClass       = config.enterClass,
        leaveClass       = config.leaveClass,
        endEvent         = hasAnimation ? endEvents.anim : endEvents.trans

    // cancel unfinished callbacks and jobs
    if (existingCallback) {
        el.removeEventListener(endEvent, existingCallback)
        classList.remove(enterClass)
        classList.remove(leaveClass)
        el.vue_trans_cb = null
    }

    if (stage > 0) { // enter

        // set to enter state before appending
        classList.add(enterClass)
        // append
        changeState()
        // trigger transition
        if (!hasAnimation) {
            batcher.push({
                execute: function () {
                    classList.remove(enterClass)
                }
            })
        } else {
            onEnd = function (e) {
                if (e.target === el) {
                    el.removeEventListener(endEvent, onEnd)
                    el.vue_trans_cb = null
                    classList.remove(enterClass)
                }
            }
            el.addEventListener(endEvent, onEnd)
            el.vue_trans_cb = onEnd
        }
        return codes.CSS_E

    } else { // leave

        if (el.offsetWidth || el.offsetHeight) {
            // trigger hide transition
            classList.add(leaveClass)
            onEnd = function (e) {
                if (e.target === el) {
                    el.removeEventListener(endEvent, onEnd)
                    el.vue_trans_cb = null
                    // actually remove node here
                    changeState()
                    classList.remove(leaveClass)
                }
            }
            // attach transition end listener
            el.addEventListener(endEvent, onEnd)
            el.vue_trans_cb = onEnd
        } else {
            // directly remove invisible elements
            changeState()
        }
        return codes.CSS_L
        
    }

}

function applyTransitionFunctions (el, stage, changeState, effectId, compiler) {

    var funcs = compiler.getOption('effects', effectId)
    if (!funcs) {
        changeState()
        return codes.JS_SKIP
    }

    var enter = funcs.enter,
        leave = funcs.leave,
        timeouts = el.vue_timeouts

    // clear previous timeouts
    if (timeouts) {
        var i = timeouts.length
        while (i--) {
            clearTO(timeouts[i])
        }
    }

    timeouts = el.vue_timeouts = []
    function timeout (cb, delay) {
        var id = setTO(function () {
            cb()
            timeouts.splice(timeouts.indexOf(id), 1)
            if (!timeouts.length) {
                el.vue_timeouts = null
            }
        }, delay)
        timeouts.push(id)
    }

    if (stage > 0) { // enter
        if (typeof enter !== 'function') {
            changeState()
            return codes.JS_SKIP_E
        }
        enter(el, changeState, timeout)
        return codes.JS_E
    } else { // leave
        if (typeof leave !== 'function') {
            changeState()
            return codes.JS_SKIP_L
        }
        leave(el, changeState, timeout)
        return codes.JS_L
    }

}

/**
 *  Sniff proper transition end event name
 */
function sniffEndEvents () {
    var el = document.createElement('vue'),
        defaultEvent = 'transitionend',
        events = {
            'transition'       : defaultEvent,
            'mozTransition'    : defaultEvent,
            'webkitTransition' : 'webkitTransitionEnd'
        },
        ret = {}
    for (var name in events) {
        if (el.style[name] !== undefined) {
            ret.trans = events[name]
            break
        }
    }
    ret.anim = el.style.animation === ''
        ? 'animationend'
        : 'webkitAnimationEnd'
    return ret
}
},{"./batcher":2,"./config":5}],25:[function(require,module,exports){
var config    = require('./config'),
    toString  = ({}).toString,
    win       = window,
    console   = win.console,
    timeout   = win.setTimeout,
    def       = Object.defineProperty,
    THIS_RE   = /[^\w]this[^\w]/,
    OBJECT    = 'object',
    hasClassList = 'classList' in document.documentElement,
    ViewModel // late def

var utils = module.exports = {

    /**
     *  get a value from an object keypath
     */
    get: function (obj, key) {
        /* jshint eqeqeq: false */
        if (key.indexOf('.') < 0) {
            return obj[key]
        }
        var path = key.split('.'),
            d = -1, l = path.length
        while (++d < l && obj != null) {
            obj = obj[path[d]]
        }
        return obj
    },

    /**
     *  set a value to an object keypath
     */
    set: function (obj, key, val) {
        /* jshint eqeqeq: false */
        if (key.indexOf('.') < 0) {
            obj[key] = val
            return
        }
        var path = key.split('.'),
            d = -1, l = path.length - 1
        while (++d < l) {
            if (obj[path[d]] == null) {
                obj[path[d]] = {}
            }
            obj = obj[path[d]]
        }
        obj[path[d]] = val
    },

    /**
     *  return the base segment of a keypath
     */
    baseKey: function (key) {
        return key.indexOf('.') > 0
            ? key.split('.')[0]
            : key
    },

    /**
     *  Create a prototype-less object
     *  which is a better hash/map
     */
    hash: function () {
        return Object.create(null)
    },

    /**
     *  get an attribute and remove it.
     */
    attr: function (el, type) {
        var attr = config.prefix + '-' + type,
            val = el.getAttribute(attr)
        if (val !== null) {
            el.removeAttribute(attr)
        }
        return val
    },

    /**
     *  Define an ienumerable property
     *  This avoids it being included in JSON.stringify
     *  or for...in loops.
     */
    defProtected: function (obj, key, val, enumerable, writable) {
        def(obj, key, {
            value        : val,
            enumerable   : enumerable,
            writable     : writable,
            configurable : true
        })
    },

    /**
     *  A less bullet-proof but more efficient type check
     *  than Object.prototype.toString
     */
    isObject: function (obj) {
        return typeof obj === OBJECT && obj && !Array.isArray(obj)
    },

    /**
     *  A more accurate but less efficient type check
     */
    isTrueObject: function (obj) {
        return toString.call(obj) === '[object Object]'
    },

    /**
     *  Most simple bind
     *  enough for the usecase and fast than native bind()
     */
    bind: function (fn, ctx) {
        return function (arg) {
            return fn.call(ctx, arg)
        }
    },

    /**
     *  Make sure null and undefined output empty string
     */
    guard: function (value) {
        /* jshint eqeqeq: false, eqnull: true */
        return value == null
            ? ''
            : (typeof value == 'object')
                ? JSON.stringify(value)
                : value
    },

    /**
     *  When setting value on the VM, parse possible numbers
     */
    checkNumber: function (value) {
        return (isNaN(value) || value === null || typeof value === 'boolean')
            ? value
            : Number(value)
    },

    /**
     *  simple extend
     */
    extend: function (obj, ext) {
        for (var key in ext) {
            if (obj[key] !== ext[key]) {
                obj[key] = ext[key]
            }
        }
        return obj
    },

    /**
     *  filter an array with duplicates into uniques
     */
    unique: function (arr) {
        var hash = utils.hash(),
            i = arr.length,
            key, res = []
        while (i--) {
            key = arr[i]
            if (hash[key]) continue
            hash[key] = 1
            res.push(key)
        }
        return res
    },

    /**
     *  Convert a string template to a dom fragment
     */
    toFragment: function (template) {
        if (typeof template !== 'string') {
            return template
        }
        if (template.charAt(0) === '#') {
            var templateNode = document.getElementById(template.slice(1))
            if (!templateNode) return
            // if its a template tag and the browser supports it,
            // its content is already a document fragment!
            if (templateNode.tagName === 'TEMPLATE' && templateNode.content) {
                return templateNode.content
            }
            template = templateNode.innerHTML
        }
        var node = document.createElement('div'),
            frag = document.createDocumentFragment(),
            child
        node.innerHTML = template.trim()
        /* jshint boss: true */
        while (child = node.firstChild) {
            if (node.nodeType === 1) {
                frag.appendChild(child)
            }
        }
        return frag
    },

    /**
     *  Convert the object to a ViewModel constructor
     *  if it is not already one
     */
    toConstructor: function (obj) {
        ViewModel = ViewModel || require('./viewmodel')
        return utils.isObject(obj)
            ? ViewModel.extend(obj)
            : typeof obj === 'function'
                ? obj
                : null
    },

    /**
     *  Check if a filter function contains references to `this`
     *  If yes, mark it as a computed filter.
     */
    checkFilter: function (filter) {
        if (THIS_RE.test(filter.toString())) {
            filter.computed = true
        }
    },

    /**
     *  convert certain option values to the desired format.
     */
    processOptions: function (options) {
        var components = options.components,
            partials   = options.partials,
            template   = options.template,
            filters    = options.filters,
            key
        if (components) {
            for (key in components) {
                components[key] = utils.toConstructor(components[key])
            }
        }
        if (partials) {
            for (key in partials) {
                partials[key] = utils.toFragment(partials[key])
            }
        }
        if (filters) {
            for (key in filters) {
                utils.checkFilter(filters[key])
            }
        }
        if (template) {
            options.template = utils.toFragment(template)
        }
    },

    /**
     *  used to defer batch updates
     */
    nextTick: function (cb) {
        timeout(cb, 0)
    },

    /**
     *  add class for IE9
     *  uses classList if available
     */
    addClass: function (el, cls) {
        if (hasClassList) {
            el.classList.add(cls)
        } else {
            var cur = ' ' + el.className + ' '
            if (cur.indexOf(' ' + cls + ' ') < 0) {
                el.className = (cur + cls).trim()
            }
        }
    },

    /**
     *  remove class for IE9
     */
    removeClass: function (el, cls) {
        if (hasClassList) {
            el.classList.remove(cls)
        } else {
            var cur = ' ' + el.className + ' ',
                tar = ' ' + cls + ' '
            while (cur.indexOf(tar) >= 0) {
                cur = cur.replace(tar, ' ')
            }
            el.className = cur.trim()
        }
    },

    /**
     *  Convert an object to Array
     *  used in v-repeat and array filters
     */
    objectToArray: function (obj) {
        var res = [], val, data
        for (var key in obj) {
            val = obj[key]
            data = utils.isObject(val)
                ? val
                : { $value: val }
            data.$key = key
            res.push(data)
        }
        return res
    }
}

enableDebug()
function enableDebug () {
    /**
     *  log for debugging
     */
    utils.log = function (msg) {
        if (config.debug && console) {
            console.log(msg)
        }
    }
    
    /**
     *  warnings, traces by default
     *  can be suppressed by `silent` option.
     */
    utils.warn = function (msg) {
        if (!config.silent && console) {
            console.warn(msg)
            if (config.debug && console.trace) {
                console.trace()
            }
        }
    }
}
},{"./config":5,"./viewmodel":26}],26:[function(require,module,exports){
var Compiler   = require('./compiler'),
    utils      = require('./utils'),
    transition = require('./transition'),
    Batcher    = require('./batcher'),
    slice      = [].slice,
    def        = utils.defProtected,
    nextTick   = utils.nextTick,

    // batch $watch callbacks
    watcherBatcher = new Batcher(),
    watcherId      = 1

/**
 *  ViewModel exposed to the user that holds data,
 *  computed properties, event handlers
 *  and a few reserved methods
 */
function ViewModel (options) {
    // just compile. options are passed directly to compiler
    new Compiler(this, options)
}

// All VM prototype methods are inenumerable
// so it can be stringified/looped through as raw data
var VMProto = ViewModel.prototype

/**
 *  Convenience function to get a value from
 *  a keypath
 */
def(VMProto, '$get', function (key) {
    var val = utils.get(this, key)
    return val === undefined && this.$parent
        ? this.$parent.$get(key)
        : val
})

/**
 *  Convenience function to set an actual nested value
 *  from a flat key string. Used in directives.
 */
def(VMProto, '$set', function (key, value) {
    utils.set(this, key, value)
})

/**
 *  watch a key on the viewmodel for changes
 *  fire callback with new value
 */
def(VMProto, '$watch', function (key, callback) {
    // save a unique id for each watcher
    var id = watcherId++,
        self = this
    function on () {
        var args = slice.call(arguments)
        watcherBatcher.push({
            id: id,
            override: true,
            execute: function () {
                callback.apply(self, args)
            }
        })
    }
    callback._fn = on
    self.$compiler.observer.on('change:' + key, on)
})

/**
 *  unwatch a key
 */
def(VMProto, '$unwatch', function (key, callback) {
    // workaround here
    // since the emitter module checks callback existence
    // by checking the length of arguments
    var args = ['change:' + key],
        ob = this.$compiler.observer
    if (callback) args.push(callback._fn)
    ob.off.apply(ob, args)
})

/**
 *  unbind everything, remove everything
 */
def(VMProto, '$destroy', function () {
    this.$compiler.destroy()
})

/**
 *  broadcast an event to all child VMs recursively.
 */
def(VMProto, '$broadcast', function () {
    var children = this.$compiler.children,
        i = children.length,
        child
    while (i--) {
        child = children[i]
        child.emitter.emit.apply(child.emitter, arguments)
        child.vm.$broadcast.apply(child.vm, arguments)
    }
})

/**
 *  emit an event that propagates all the way up to parent VMs.
 */
def(VMProto, '$dispatch', function () {
    var compiler = this.$compiler,
        emitter = compiler.emitter,
        parent = compiler.parent
    emitter.emit.apply(emitter, arguments)
    if (parent) {
        parent.vm.$dispatch.apply(parent.vm, arguments)
    }
})

/**
 *  delegate on/off/once to the compiler's emitter
 */
;['emit', 'on', 'off', 'once'].forEach(function (method) {
    def(VMProto, '$' + method, function () {
        var emitter = this.$compiler.emitter
        emitter[method].apply(emitter, arguments)
    })
})

// DOM convenience methods

def(VMProto, '$appendTo', function (target, cb) {
    target = query(target)
    var el = this.$el
    transition(el, 1, function () {
        target.appendChild(el)
        if (cb) nextTick(cb)
    }, this.$compiler)
})

def(VMProto, '$remove', function (cb) {
    var el = this.$el
    transition(el, -1, function () {
        if (el.parentNode) {
            el.parentNode.removeChild(el)
        }
        if (cb) nextTick(cb)
    }, this.$compiler)
})

def(VMProto, '$before', function (target, cb) {
    target = query(target)
    var el = this.$el
    transition(el, 1, function () {
        target.parentNode.insertBefore(el, target)
        if (cb) nextTick(cb)
    }, this.$compiler)
})

def(VMProto, '$after', function (target, cb) {
    target = query(target)
    var el = this.$el
    transition(el, 1, function () {
        if (target.nextSibling) {
            target.parentNode.insertBefore(el, target.nextSibling)
        } else {
            target.parentNode.appendChild(el)
        }
        if (cb) nextTick(cb)
    }, this.$compiler)
})

function query (el) {
    return typeof el === 'string'
        ? document.querySelector(el)
        : el
}

module.exports = ViewModel
},{"./batcher":2,"./compiler":4,"./transition":24,"./utils":25}],27:[function(require,module,exports){
(function () {
var root = this, exports = {};

// The jade runtime:
var jade = exports.jade=function(exports){Array.isArray||(Array.isArray=function(arr){return"[object Array]"==Object.prototype.toString.call(arr)}),Object.keys||(Object.keys=function(obj){var arr=[];for(var key in obj)obj.hasOwnProperty(key)&&arr.push(key);return arr}),exports.merge=function merge(a,b){var ac=a["class"],bc=b["class"];if(ac||bc)ac=ac||[],bc=bc||[],Array.isArray(ac)||(ac=[ac]),Array.isArray(bc)||(bc=[bc]),ac=ac.filter(nulls),bc=bc.filter(nulls),a["class"]=ac.concat(bc).join(" ");for(var key in b)key!="class"&&(a[key]=b[key]);return a};function nulls(val){return val!=null}return exports.attrs=function attrs(obj,escaped){var buf=[],terse=obj.terse;delete obj.terse;var keys=Object.keys(obj),len=keys.length;if(len){buf.push("");for(var i=0;i<len;++i){var key=keys[i],val=obj[key];"boolean"==typeof val||null==val?val&&(terse?buf.push(key):buf.push(key+'="'+key+'"')):0==key.indexOf("data")&&"string"!=typeof val?buf.push(key+"='"+JSON.stringify(val)+"'"):"class"==key&&Array.isArray(val)?buf.push(key+'="'+exports.escape(val.join(" "))+'"'):escaped&&escaped[key]?buf.push(key+'="'+exports.escape(val)+'"'):buf.push(key+'="'+val+'"')}}return buf.join(" ")},exports.escape=function escape(html){return String(html).replace(/&(?!(\w+|\#\d+);)/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")},exports.rethrow=function rethrow(err,filename,lineno){if(!filename)throw err;var context=3,str=require("fs").readFileSync(filename,"utf8"),lines=str.split("\n"),start=Math.max(lineno-context,0),end=Math.min(lines.length,lineno+context),context=lines.slice(start,end).map(function(line,i){var curr=i+start+1;return(curr==lineno?"  > ":"    ")+curr+"| "+line}).join("\n");throw err.path=filename,err.message=(filename||"Jade")+":"+lineno+"\n"+context+"\n\n"+err.message,err},exports}({});


// create our folder objects

// container.jade compiled template
exports["container"] = function tmpl_container() {
    return '<header><h1>Nancle Demo</h1><nav><ul><li v-repeat="routes"><a href="#!/{{$value}}" v-class="current:currentRoute == $value">{{$value}}</a></li></ul></nav></header><article v-view="currentView" v-with="global: subdata" v-transition class="view"></article>';
};

// home.jade compiled template
exports["home"] = function tmpl_home() {
    return '<h1>Home</h1><p>Hello! {{msg}} {{global.test}}</p><input v-model="message"><p>{{message}}</p>';
};

// notfound.jade compiled template
exports["notfound"] = function tmpl_notfound() {
    return '<h1>404</h1>';
};

// page1.jade compiled template
exports["page1"] = function tmpl_page1() {
    return '<h1>Page1</h1><p>Hello! {{msg}} {{global.test}}</p>';
};

// page2.jade compiled template
exports["page2"] = function tmpl_page2() {
    return '<h1>Page2</h1><p>Hello! {{msg}} {{global.test}}</p>';
};


// attach to window or export with commonJS
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = exports;
} else if (typeof define === "function" && define.amd) {
    define(exports);
} else {
    root.templatizer = exports;
}

})();
},{"fs":1}],28:[function(require,module,exports){
var Vue, container, initialRoute, nancle, router, templates, vm;

Vue = require('vue');

nancle = require('./router');

templates = require('./_templates.js');

vm = require('./viewmodel');

router = new nancle.Router({
  routes: ['home', 'page1', 'page2']
});

initialRoute = router.getRoute();

container = new Vue({
  el: '#container',
  template: templates.container(),
  data: {
    currentRoute: initialRoute,
    routes: router.routes,
    subdata: {
      test: '123'
    }
  },
  computed: {
    currentView: {
      $get: function() {
        return 'nancle-' + this.currentRoute;
      }
    }
  },
  created: function() {
    return window.addEventListener('hashchange', (function(_this) {
      return function() {
        return _this.currentRoute = router.getRoute();
      };
    })(this));
  }
});


},{"./_templates.js":27,"./router":29,"./viewmodel":30,"vue":21}],29:[function(require,module,exports){
var Router;

module.exports = {
  Router: Router = (function() {
    function Router(options) {
      this.routes = options.routes;
    }

    Router.prototype.getRoute = function() {
      var path;
      path = location.hash.replace(/^#!\/?/, '') || 'home';
      if (this.routes.indexOf(path) > -1) {
        return path;
      } else {
        return 'notfound';
      }
    };

    return Router;

  })()
};


},{}],30:[function(require,module,exports){
var Vue, templates;

Vue = require('vue');

templates = require('./_templates.js');

Vue.component('nancle-home', Vue.extend({
  template: templates.home(),
  created: function() {
    return this.msg = 'Home sweet home!';
  }
}));

Vue.component('nancle-page1', Vue.extend({
  template: templates.page1(),
  created: function() {
    return this.msg = 'Welcome to page 1!';
  }
}));

Vue.component('nancle-page2', Vue.extend({
  template: templates.page2(),
  created: function() {
    return this.msg = 'Welcome to page 2!';
  }
}));

Vue.component('nancle-notfound', Vue.extend({
  template: templates.notfound()
}));


},{"./_templates.js":27,"vue":21}]},{},[28])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlcyI6WyIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9saWIvX2VtcHR5LmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9iYXRjaGVyLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9iaW5kaW5nLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9jb21waWxlci5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Z1ZS9zcmMvY29uZmlnLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9kZXBzLXBhcnNlci5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Z1ZS9zcmMvZGlyZWN0aXZlLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9kaXJlY3RpdmVzL2h0bWwuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvaWYuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvaW5kZXguanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvbW9kZWwuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvb24uanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvcGFydGlhbC5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Z1ZS9zcmMvZGlyZWN0aXZlcy9yZXBlYXQuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvc3R5bGUuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvdmlldy5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Z1ZS9zcmMvZGlyZWN0aXZlcy93aXRoLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9lbWl0dGVyLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9leHAtcGFyc2VyLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9maWx0ZXJzLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9tYWluLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9vYnNlcnZlci5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Z1ZS9zcmMvdGV4dC1wYXJzZXIuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL3RyYW5zaXRpb24uanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL3V0aWxzLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy92aWV3bW9kZWwuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL3NyYy9qcy9fdGVtcGxhdGVzLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9zcmMvanMvYXBwLmNvZmZlZSIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvc3JjL2pzL3JvdXRlci5jb2ZmZWUiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL3NyYy9qcy92aWV3bW9kZWwuY29mZmVlIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbCtCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pPQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2VUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBLElBQUEsMkRBQUE7O0FBQUEsR0FBQSxHQUFNLE9BQUEsQ0FBUSxLQUFSLENBQU4sQ0FBQTs7QUFBQSxNQUNBLEdBQVMsT0FBQSxDQUFRLFVBQVIsQ0FEVCxDQUFBOztBQUFBLFNBRUEsR0FBWSxPQUFBLENBQVEsaUJBQVIsQ0FGWixDQUFBOztBQUFBLEVBR0EsR0FBSyxPQUFBLENBQVEsYUFBUixDQUhMLENBQUE7O0FBQUEsTUFLQSxHQUFhLElBQUEsTUFBTSxDQUFDLE1BQVAsQ0FBYztBQUFBLEVBQUMsTUFBQSxFQUFRLENBQUMsTUFBRCxFQUFTLE9BQVQsRUFBa0IsT0FBbEIsQ0FBVDtDQUFkLENBTGIsQ0FBQTs7QUFBQSxZQU9BLEdBQWUsTUFBTSxDQUFDLFFBQVAsQ0FBQSxDQVBmLENBQUE7O0FBQUEsU0FTQSxHQUFnQixJQUFBLEdBQUEsQ0FDZDtBQUFBLEVBQUEsRUFBQSxFQUFJLFlBQUo7QUFBQSxFQUNBLFFBQUEsRUFBVSxTQUFTLENBQUMsU0FBVixDQUFBLENBRFY7QUFBQSxFQUVBLElBQUEsRUFDRTtBQUFBLElBQUEsWUFBQSxFQUFjLFlBQWQ7QUFBQSxJQUNBLE1BQUEsRUFBUSxNQUFNLENBQUMsTUFEZjtBQUFBLElBRUEsT0FBQSxFQUNFO0FBQUEsTUFBQSxJQUFBLEVBQU0sS0FBTjtLQUhGO0dBSEY7QUFBQSxFQU9BLFFBQUEsRUFDRTtBQUFBLElBQUEsV0FBQSxFQUNFO0FBQUEsTUFBQSxJQUFBLEVBQU0sU0FBQSxHQUFBO2VBQ0osU0FBQSxHQUFZLElBQUMsQ0FBQSxhQURUO01BQUEsQ0FBTjtLQURGO0dBUkY7QUFBQSxFQVdBLE9BQUEsRUFBUyxTQUFBLEdBQUE7V0FDUCxNQUFNLENBQUMsZ0JBQVAsQ0FBd0IsWUFBeEIsRUFBc0MsQ0FBQSxTQUFBLEtBQUEsR0FBQTthQUFBLFNBQUEsR0FBQTtlQUNwQyxLQUFDLENBQUEsWUFBRCxHQUFnQixNQUFNLENBQUMsUUFBUCxDQUFBLEVBRG9CO01BQUEsRUFBQTtJQUFBLENBQUEsQ0FBQSxDQUFBLElBQUEsQ0FBdEMsRUFETztFQUFBLENBWFQ7Q0FEYyxDQVRoQixDQUFBOzs7O0FDQUEsSUFBQSxNQUFBOztBQUFBLE1BQU0sQ0FBQyxPQUFQLEdBQ0U7QUFBQSxFQUFBLE1BQUEsRUFBYztBQUNDLElBQUEsZ0JBQUMsT0FBRCxHQUFBO0FBQ1gsTUFBQyxJQUFDLENBQUEsU0FBVSxRQUFWLE1BQUYsQ0FEVztJQUFBLENBQWI7O0FBQUEscUJBR0EsUUFBQSxHQUFVLFNBQUEsR0FBQTtBQUNSLFVBQUEsSUFBQTtBQUFBLE1BQUEsSUFBQSxHQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBZCxDQUFzQixRQUF0QixFQUFnQyxFQUFoQyxDQUFBLElBQXVDLE1BQTlDLENBQUE7QUFDTyxNQUFBLElBQUcsSUFBQyxDQUFBLE1BQU0sQ0FBQyxPQUFSLENBQWdCLElBQWhCLENBQUEsR0FBd0IsQ0FBQSxDQUEzQjtlQUFtQyxLQUFuQztPQUFBLE1BQUE7ZUFBNkMsV0FBN0M7T0FGQztJQUFBLENBSFYsQ0FBQTs7a0JBQUE7O01BREY7Q0FERixDQUFBOzs7O0FDQUEsSUFBQSxjQUFBOztBQUFBLEdBQUEsR0FBTSxPQUFBLENBQVEsS0FBUixDQUFOLENBQUE7O0FBQUEsU0FDQSxHQUFZLE9BQUEsQ0FBUSxpQkFBUixDQURaLENBQUE7O0FBQUEsR0FJRyxDQUFDLFNBQUosQ0FBYyxhQUFkLEVBQTZCLEdBQUcsQ0FBQyxNQUFKLENBQzNCO0FBQUEsRUFBQSxRQUFBLEVBQVUsU0FBUyxDQUFDLElBQVYsQ0FBQSxDQUFWO0FBQUEsRUFDQSxPQUFBLEVBQVMsU0FBQSxHQUFBO1dBQ1AsSUFBQyxDQUFBLEdBQUQsR0FBTyxtQkFEQTtFQUFBLENBRFQ7Q0FEMkIsQ0FBN0IsQ0FKQSxDQUFBOztBQUFBLEdBU0csQ0FBQyxTQUFKLENBQWMsY0FBZCxFQUE4QixHQUFHLENBQUMsTUFBSixDQUM1QjtBQUFBLEVBQUEsUUFBQSxFQUFVLFNBQVMsQ0FBQyxLQUFWLENBQUEsQ0FBVjtBQUFBLEVBQ0EsT0FBQSxFQUFTLFNBQUEsR0FBQTtXQUNQLElBQUMsQ0FBQSxHQUFELEdBQU8scUJBREE7RUFBQSxDQURUO0NBRDRCLENBQTlCLENBVEEsQ0FBQTs7QUFBQSxHQWNHLENBQUMsU0FBSixDQUFjLGNBQWQsRUFBOEIsR0FBRyxDQUFDLE1BQUosQ0FDNUI7QUFBQSxFQUFBLFFBQUEsRUFBVSxTQUFTLENBQUMsS0FBVixDQUFBLENBQVY7QUFBQSxFQUNBLE9BQUEsRUFBUyxTQUFBLEdBQUE7V0FDUCxJQUFDLENBQUEsR0FBRCxHQUFPLHFCQURBO0VBQUEsQ0FEVDtDQUQ0QixDQUE5QixDQWRBLENBQUE7O0FBQUEsR0FtQkcsQ0FBQyxTQUFKLENBQWMsaUJBQWQsRUFBaUMsR0FBRyxDQUFDLE1BQUosQ0FDL0I7QUFBQSxFQUFBLFFBQUEsRUFBVSxTQUFTLENBQUMsUUFBVixDQUFBLENBQVY7Q0FEK0IsQ0FBakMsQ0FuQkEsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKX12YXIgZj1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwoZi5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxmLGYuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIixudWxsLCJ2YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJylcblxuZnVuY3Rpb24gQmF0Y2hlciAoKSB7XG4gICAgdGhpcy5yZXNldCgpXG59XG5cbnZhciBCYXRjaGVyUHJvdG8gPSBCYXRjaGVyLnByb3RvdHlwZVxuXG5CYXRjaGVyUHJvdG8ucHVzaCA9IGZ1bmN0aW9uIChqb2IpIHtcbiAgICBpZiAoIWpvYi5pZCB8fCAhdGhpcy5oYXNbam9iLmlkXSkge1xuICAgICAgICB0aGlzLnF1ZXVlLnB1c2goam9iKVxuICAgICAgICB0aGlzLmhhc1tqb2IuaWRdID0gam9iXG4gICAgICAgIGlmICghdGhpcy53YWl0aW5nKSB7XG4gICAgICAgICAgICB0aGlzLndhaXRpbmcgPSB0cnVlXG4gICAgICAgICAgICB1dGlscy5uZXh0VGljayh1dGlscy5iaW5kKHRoaXMuZmx1c2gsIHRoaXMpKVxuICAgICAgICB9XG4gICAgfSBlbHNlIGlmIChqb2Iub3ZlcnJpZGUpIHtcbiAgICAgICAgdmFyIG9sZEpvYiA9IHRoaXMuaGFzW2pvYi5pZF1cbiAgICAgICAgb2xkSm9iLmNhbmNlbGxlZCA9IHRydWVcbiAgICAgICAgdGhpcy5xdWV1ZS5wdXNoKGpvYilcbiAgICAgICAgdGhpcy5oYXNbam9iLmlkXSA9IGpvYlxuICAgIH1cbn1cblxuQmF0Y2hlclByb3RvLmZsdXNoID0gZnVuY3Rpb24gKCkge1xuICAgIC8vIGJlZm9yZSBmbHVzaCBob29rXG4gICAgaWYgKHRoaXMuX3ByZUZsdXNoKSB0aGlzLl9wcmVGbHVzaCgpXG4gICAgLy8gZG8gbm90IGNhY2hlIGxlbmd0aCBiZWNhdXNlIG1vcmUgam9icyBtaWdodCBiZSBwdXNoZWRcbiAgICAvLyBhcyB3ZSBleGVjdXRlIGV4aXN0aW5nIGpvYnNcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMucXVldWUubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIGpvYiA9IHRoaXMucXVldWVbaV1cbiAgICAgICAgaWYgKCFqb2IuY2FuY2VsbGVkKSB7XG4gICAgICAgICAgICBqb2IuZXhlY3V0ZSgpXG4gICAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5yZXNldCgpXG59XG5cbkJhdGNoZXJQcm90by5yZXNldCA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLmhhcyA9IHV0aWxzLmhhc2goKVxuICAgIHRoaXMucXVldWUgPSBbXVxuICAgIHRoaXMud2FpdGluZyA9IGZhbHNlXG59XG5cbm1vZHVsZS5leHBvcnRzID0gQmF0Y2hlciIsInZhciBCYXRjaGVyICAgICAgICA9IHJlcXVpcmUoJy4vYmF0Y2hlcicpLFxuICAgIGJpbmRpbmdCYXRjaGVyID0gbmV3IEJhdGNoZXIoKSxcbiAgICBiaW5kaW5nSWQgICAgICA9IDFcblxuLyoqXG4gKiAgQmluZGluZyBjbGFzcy5cbiAqXG4gKiAgZWFjaCBwcm9wZXJ0eSBvbiB0aGUgdmlld21vZGVsIGhhcyBvbmUgY29ycmVzcG9uZGluZyBCaW5kaW5nIG9iamVjdFxuICogIHdoaWNoIGhhcyBtdWx0aXBsZSBkaXJlY3RpdmUgaW5zdGFuY2VzIG9uIHRoZSBET01cbiAqICBhbmQgbXVsdGlwbGUgY29tcHV0ZWQgcHJvcGVydHkgZGVwZW5kZW50c1xuICovXG5mdW5jdGlvbiBCaW5kaW5nIChjb21waWxlciwga2V5LCBpc0V4cCwgaXNGbikge1xuICAgIHRoaXMuaWQgPSBiaW5kaW5nSWQrK1xuICAgIHRoaXMudmFsdWUgPSB1bmRlZmluZWRcbiAgICB0aGlzLmlzRXhwID0gISFpc0V4cFxuICAgIHRoaXMuaXNGbiA9IGlzRm5cbiAgICB0aGlzLnJvb3QgPSAhdGhpcy5pc0V4cCAmJiBrZXkuaW5kZXhPZignLicpID09PSAtMVxuICAgIHRoaXMuY29tcGlsZXIgPSBjb21waWxlclxuICAgIHRoaXMua2V5ID0ga2V5XG4gICAgdGhpcy5kaXJzID0gW11cbiAgICB0aGlzLnN1YnMgPSBbXVxuICAgIHRoaXMuZGVwcyA9IFtdXG4gICAgdGhpcy51bmJvdW5kID0gZmFsc2Vcbn1cblxudmFyIEJpbmRpbmdQcm90byA9IEJpbmRpbmcucHJvdG90eXBlXG5cbi8qKlxuICogIFVwZGF0ZSB2YWx1ZSBhbmQgcXVldWUgaW5zdGFuY2UgdXBkYXRlcy5cbiAqL1xuQmluZGluZ1Byb3RvLnVwZGF0ZSA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgIGlmICghdGhpcy5pc0NvbXB1dGVkIHx8IHRoaXMuaXNGbikge1xuICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWVcbiAgICB9XG4gICAgaWYgKHRoaXMuZGlycy5sZW5ndGggfHwgdGhpcy5zdWJzLmxlbmd0aCkge1xuICAgICAgICB2YXIgc2VsZiA9IHRoaXNcbiAgICAgICAgYmluZGluZ0JhdGNoZXIucHVzaCh7XG4gICAgICAgICAgICBpZDogdGhpcy5pZCxcbiAgICAgICAgICAgIGV4ZWN1dGU6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXNlbGYudW5ib3VuZCkge1xuICAgICAgICAgICAgICAgICAgICBzZWxmLl91cGRhdGUoKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG59XG5cbi8qKlxuICogIEFjdHVhbGx5IHVwZGF0ZSB0aGUgZGlyZWN0aXZlcy5cbiAqL1xuQmluZGluZ1Byb3RvLl91cGRhdGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGkgPSB0aGlzLmRpcnMubGVuZ3RoLFxuICAgICAgICB2YWx1ZSA9IHRoaXMudmFsKClcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIHRoaXMuZGlyc1tpXS51cGRhdGUodmFsdWUpXG4gICAgfVxuICAgIHRoaXMucHViKClcbn1cblxuLyoqXG4gKiAgUmV0dXJuIHRoZSB2YWx1YXRlZCB2YWx1ZSByZWdhcmRsZXNzXG4gKiAgb2Ygd2hldGhlciBpdCBpcyBjb21wdXRlZCBvciBub3RcbiAqL1xuQmluZGluZ1Byb3RvLnZhbCA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gdGhpcy5pc0NvbXB1dGVkICYmICF0aGlzLmlzRm5cbiAgICAgICAgPyB0aGlzLnZhbHVlLiRnZXQoKVxuICAgICAgICA6IHRoaXMudmFsdWVcbn1cblxuLyoqXG4gKiAgTm90aWZ5IGNvbXB1dGVkIHByb3BlcnRpZXMgdGhhdCBkZXBlbmQgb24gdGhpcyBiaW5kaW5nXG4gKiAgdG8gdXBkYXRlIHRoZW1zZWx2ZXNcbiAqL1xuQmluZGluZ1Byb3RvLnB1YiA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgaSA9IHRoaXMuc3Vicy5sZW5ndGhcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIHRoaXMuc3Vic1tpXS51cGRhdGUoKVxuICAgIH1cbn1cblxuLyoqXG4gKiAgVW5iaW5kIHRoZSBiaW5kaW5nLCByZW1vdmUgaXRzZWxmIGZyb20gYWxsIG9mIGl0cyBkZXBlbmRlbmNpZXNcbiAqL1xuQmluZGluZ1Byb3RvLnVuYmluZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAvLyBJbmRpY2F0ZSB0aGlzIGhhcyBiZWVuIHVuYm91bmQuXG4gICAgLy8gSXQncyBwb3NzaWJsZSB0aGlzIGJpbmRpbmcgd2lsbCBiZSBpblxuICAgIC8vIHRoZSBiYXRjaGVyJ3MgZmx1c2ggcXVldWUgd2hlbiBpdHMgb3duZXJcbiAgICAvLyBjb21waWxlciBoYXMgYWxyZWFkeSBiZWVuIGRlc3Ryb3llZC5cbiAgICB0aGlzLnVuYm91bmQgPSB0cnVlXG4gICAgdmFyIGkgPSB0aGlzLmRpcnMubGVuZ3RoXG4gICAgd2hpbGUgKGktLSkge1xuICAgICAgICB0aGlzLmRpcnNbaV0udW5iaW5kKClcbiAgICB9XG4gICAgaSA9IHRoaXMuZGVwcy5sZW5ndGhcbiAgICB2YXIgc3Vic1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgc3VicyA9IHRoaXMuZGVwc1tpXS5zdWJzXG4gICAgICAgIHN1YnMuc3BsaWNlKHN1YnMuaW5kZXhPZih0aGlzKSwgMSlcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gQmluZGluZyIsInZhciBFbWl0dGVyICAgICA9IHJlcXVpcmUoJy4vZW1pdHRlcicpLFxuICAgIE9ic2VydmVyICAgID0gcmVxdWlyZSgnLi9vYnNlcnZlcicpLFxuICAgIGNvbmZpZyAgICAgID0gcmVxdWlyZSgnLi9jb25maWcnKSxcbiAgICB1dGlscyAgICAgICA9IHJlcXVpcmUoJy4vdXRpbHMnKSxcbiAgICBCaW5kaW5nICAgICA9IHJlcXVpcmUoJy4vYmluZGluZycpLFxuICAgIERpcmVjdGl2ZSAgID0gcmVxdWlyZSgnLi9kaXJlY3RpdmUnKSxcbiAgICBUZXh0UGFyc2VyICA9IHJlcXVpcmUoJy4vdGV4dC1wYXJzZXInKSxcbiAgICBEZXBzUGFyc2VyICA9IHJlcXVpcmUoJy4vZGVwcy1wYXJzZXInKSxcbiAgICBFeHBQYXJzZXIgICA9IHJlcXVpcmUoJy4vZXhwLXBhcnNlcicpLFxuICAgIFZpZXdNb2RlbCxcbiAgICBcbiAgICAvLyBjYWNoZSBtZXRob2RzXG4gICAgc2xpY2UgICAgICAgPSBbXS5zbGljZSxcbiAgICBleHRlbmQgICAgICA9IHV0aWxzLmV4dGVuZCxcbiAgICBoYXNPd24gICAgICA9ICh7fSkuaGFzT3duUHJvcGVydHksXG4gICAgZGVmICAgICAgICAgPSBPYmplY3QuZGVmaW5lUHJvcGVydHksXG5cbiAgICAvLyBob29rcyB0byByZWdpc3RlclxuICAgIGhvb2tzID0gW1xuICAgICAgICAnY3JlYXRlZCcsICdyZWFkeScsXG4gICAgICAgICdiZWZvcmVEZXN0cm95JywgJ2FmdGVyRGVzdHJveScsXG4gICAgICAgICdhdHRhY2hlZCcsICdkZXRhY2hlZCdcbiAgICBdLFxuXG4gICAgLy8gbGlzdCBvZiBwcmlvcml0eSBkaXJlY3RpdmVzXG4gICAgLy8gdGhhdCBuZWVkcyB0byBiZSBjaGVja2VkIGluIHNwZWNpZmljIG9yZGVyXG4gICAgcHJpb3JpdHlEaXJlY3RpdmVzID0gW1xuICAgICAgICAnaWYnLFxuICAgICAgICAncmVwZWF0JyxcbiAgICAgICAgJ3ZpZXcnLFxuICAgICAgICAnY29tcG9uZW50J1xuICAgIF1cblxuLyoqXG4gKiAgVGhlIERPTSBjb21waWxlclxuICogIHNjYW5zIGEgRE9NIG5vZGUgYW5kIGNvbXBpbGUgYmluZGluZ3MgZm9yIGEgVmlld01vZGVsXG4gKi9cbmZ1bmN0aW9uIENvbXBpbGVyICh2bSwgb3B0aW9ucykge1xuXG4gICAgdmFyIGNvbXBpbGVyID0gdGhpcyxcbiAgICAgICAga2V5LCBpXG5cbiAgICAvLyBkZWZhdWx0IHN0YXRlXG4gICAgY29tcGlsZXIuaW5pdCAgICAgICA9IHRydWVcbiAgICBjb21waWxlci5kZXN0cm95ZWQgID0gZmFsc2VcblxuICAgIC8vIHByb2Nlc3MgYW5kIGV4dGVuZCBvcHRpb25zXG4gICAgb3B0aW9ucyA9IGNvbXBpbGVyLm9wdGlvbnMgPSBvcHRpb25zIHx8IHt9XG4gICAgdXRpbHMucHJvY2Vzc09wdGlvbnMob3B0aW9ucylcblxuICAgIC8vIGNvcHkgY29tcGlsZXIgb3B0aW9uc1xuICAgIGV4dGVuZChjb21waWxlciwgb3B0aW9ucy5jb21waWxlck9wdGlvbnMpXG4gICAgLy8gcmVwZWF0IGluZGljYXRlcyB0aGlzIGlzIGEgdi1yZXBlYXQgaW5zdGFuY2VcbiAgICBjb21waWxlci5yZXBlYXQgICA9IGNvbXBpbGVyLnJlcGVhdCB8fCBmYWxzZVxuICAgIC8vIGV4cENhY2hlIHdpbGwgYmUgc2hhcmVkIGJldHdlZW4gdi1yZXBlYXQgaW5zdGFuY2VzXG4gICAgY29tcGlsZXIuZXhwQ2FjaGUgPSBjb21waWxlci5leHBDYWNoZSB8fCB7fVxuXG4gICAgLy8gaW5pdGlhbGl6ZSBlbGVtZW50XG4gICAgdmFyIGVsID0gY29tcGlsZXIuZWwgPSBjb21waWxlci5zZXR1cEVsZW1lbnQob3B0aW9ucylcbiAgICB1dGlscy5sb2coJ1xcbm5ldyBWTSBpbnN0YW5jZTogJyArIGVsLnRhZ05hbWUgKyAnXFxuJylcblxuICAgIC8vIHNldCBvdGhlciBjb21waWxlciBwcm9wZXJ0aWVzXG4gICAgY29tcGlsZXIudm0gICAgICAgPSBlbC52dWVfdm0gPSB2bVxuICAgIGNvbXBpbGVyLmJpbmRpbmdzID0gdXRpbHMuaGFzaCgpXG4gICAgY29tcGlsZXIuZGlycyAgICAgPSBbXVxuICAgIGNvbXBpbGVyLmRlZmVycmVkID0gW11cbiAgICBjb21waWxlci5jb21wdXRlZCA9IFtdXG4gICAgY29tcGlsZXIuY2hpbGRyZW4gPSBbXVxuICAgIGNvbXBpbGVyLmVtaXR0ZXIgID0gbmV3IEVtaXR0ZXIodm0pXG5cbiAgICAvLyBjcmVhdGUgYmluZGluZ3MgZm9yIGNvbXB1dGVkIHByb3BlcnRpZXNcbiAgICBpZiAob3B0aW9ucy5tZXRob2RzKSB7XG4gICAgICAgIGZvciAoa2V5IGluIG9wdGlvbnMubWV0aG9kcykge1xuICAgICAgICAgICAgY29tcGlsZXIuY3JlYXRlQmluZGluZyhrZXkpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBjcmVhdGUgYmluZGluZ3MgZm9yIG1ldGhvZHNcbiAgICBpZiAob3B0aW9ucy5jb21wdXRlZCkge1xuICAgICAgICBmb3IgKGtleSBpbiBvcHRpb25zLmNvbXB1dGVkKSB7XG4gICAgICAgICAgICBjb21waWxlci5jcmVhdGVCaW5kaW5nKGtleSlcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFZNIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gICAgLy8gc2V0IFZNIHByb3BlcnRpZXNcbiAgICB2bS4kICAgICAgICAgPSB7fVxuICAgIHZtLiRlbCAgICAgICA9IGVsXG4gICAgdm0uJG9wdGlvbnMgID0gb3B0aW9uc1xuICAgIHZtLiRjb21waWxlciA9IGNvbXBpbGVyXG4gICAgdm0uJGV2ZW50ICAgID0gbnVsbFxuXG4gICAgLy8gc2V0IHBhcmVudCAmIHJvb3RcbiAgICB2YXIgcGFyZW50Vk0gPSBvcHRpb25zLnBhcmVudFxuICAgIGlmIChwYXJlbnRWTSkge1xuICAgICAgICBjb21waWxlci5wYXJlbnQgPSBwYXJlbnRWTS4kY29tcGlsZXJcbiAgICAgICAgcGFyZW50Vk0uJGNvbXBpbGVyLmNoaWxkcmVuLnB1c2goY29tcGlsZXIpXG4gICAgICAgIHZtLiRwYXJlbnQgPSBwYXJlbnRWTVxuICAgIH1cbiAgICB2bS4kcm9vdCA9IGdldFJvb3QoY29tcGlsZXIpLnZtXG5cbiAgICAvLyBEQVRBIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAgIC8vIHNldHVwIG9ic2VydmVyXG4gICAgLy8gdGhpcyBpcyBuZWNlc2FycnkgZm9yIGFsbCBob29rcyBhbmQgZGF0YSBvYnNlcnZhdGlvbiBldmVudHNcbiAgICBjb21waWxlci5zZXR1cE9ic2VydmVyKClcblxuICAgIC8vIGluaXRpYWxpemUgZGF0YVxuICAgIHZhciBkYXRhID0gY29tcGlsZXIuZGF0YSA9IG9wdGlvbnMuZGF0YSB8fCB7fSxcbiAgICAgICAgZGVmYXVsdERhdGEgPSBvcHRpb25zLmRlZmF1bHREYXRhXG4gICAgaWYgKGRlZmF1bHREYXRhKSB7XG4gICAgICAgIGZvciAoa2V5IGluIGRlZmF1bHREYXRhKSB7XG4gICAgICAgICAgICBpZiAoIWhhc093bi5jYWxsKGRhdGEsIGtleSkpIHtcbiAgICAgICAgICAgICAgICBkYXRhW2tleV0gPSBkZWZhdWx0RGF0YVtrZXldXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBjb3B5IHBhcmFtQXR0cmlidXRlc1xuICAgIHZhciBwYXJhbXMgPSBvcHRpb25zLnBhcmFtQXR0cmlidXRlc1xuICAgIGlmIChwYXJhbXMpIHtcbiAgICAgICAgaSA9IHBhcmFtcy5sZW5ndGhcbiAgICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICAgICAgZGF0YVtwYXJhbXNbaV1dID0gdXRpbHMuY2hlY2tOdW1iZXIoXG4gICAgICAgICAgICAgICAgY29tcGlsZXIuZXZhbChcbiAgICAgICAgICAgICAgICAgICAgZWwuZ2V0QXR0cmlidXRlKHBhcmFtc1tpXSlcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBjb3B5IGRhdGEgcHJvcGVydGllcyB0byB2bVxuICAgIC8vIHNvIHVzZXIgY2FuIGFjY2VzcyB0aGVtIGluIHRoZSBjcmVhdGVkIGhvb2tcbiAgICBleHRlbmQodm0sIGRhdGEpXG4gICAgdm0uJGRhdGEgPSBkYXRhXG5cbiAgICAvLyBiZWZvcmVDb21waWxlIGhvb2tcbiAgICBjb21waWxlci5leGVjSG9vaygnY3JlYXRlZCcpXG5cbiAgICAvLyB0aGUgdXNlciBtaWdodCBoYXZlIHN3YXBwZWQgdGhlIGRhdGEgLi4uXG4gICAgZGF0YSA9IGNvbXBpbGVyLmRhdGEgPSB2bS4kZGF0YVxuXG4gICAgLy8gdXNlciBtaWdodCBhbHNvIHNldCBzb21lIHByb3BlcnRpZXMgb24gdGhlIHZtXG4gICAgLy8gaW4gd2hpY2ggY2FzZSB3ZSBzaG91bGQgY29weSBiYWNrIHRvICRkYXRhXG4gICAgdmFyIHZtUHJvcFxuICAgIGZvciAoa2V5IGluIHZtKSB7XG4gICAgICAgIHZtUHJvcCA9IHZtW2tleV1cbiAgICAgICAgaWYgKFxuICAgICAgICAgICAga2V5LmNoYXJBdCgwKSAhPT0gJyQnICYmXG4gICAgICAgICAgICBkYXRhW2tleV0gIT09IHZtUHJvcCAmJlxuICAgICAgICAgICAgdHlwZW9mIHZtUHJvcCAhPT0gJ2Z1bmN0aW9uJ1xuICAgICAgICApIHtcbiAgICAgICAgICAgIGRhdGFba2V5XSA9IHZtUHJvcFxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gbm93IHdlIGNhbiBvYnNlcnZlIHRoZSBkYXRhLlxuICAgIC8vIHRoaXMgd2lsbCBjb252ZXJ0IGRhdGEgcHJvcGVydGllcyB0byBnZXR0ZXIvc2V0dGVyc1xuICAgIC8vIGFuZCBlbWl0IHRoZSBmaXJzdCBiYXRjaCBvZiBzZXQgZXZlbnRzLCB3aGljaCB3aWxsXG4gICAgLy8gaW4gdHVybiBjcmVhdGUgdGhlIGNvcnJlc3BvbmRpbmcgYmluZGluZ3MuXG4gICAgY29tcGlsZXIub2JzZXJ2ZURhdGEoZGF0YSlcblxuICAgIC8vIENPTVBJTEUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gICAgLy8gYmVmb3JlIGNvbXBpbGluZywgcmVzb2x2ZSBjb250ZW50IGluc2VydGlvbiBwb2ludHNcbiAgICBpZiAob3B0aW9ucy50ZW1wbGF0ZSkge1xuICAgICAgICB0aGlzLnJlc29sdmVDb250ZW50KClcbiAgICB9XG5cbiAgICAvLyBub3cgcGFyc2UgdGhlIERPTSBhbmQgYmluZCBkaXJlY3RpdmVzLlxuICAgIC8vIER1cmluZyB0aGlzIHN0YWdlLCB3ZSB3aWxsIGFsc28gY3JlYXRlIGJpbmRpbmdzIGZvclxuICAgIC8vIGVuY291bnRlcmVkIGtleXBhdGhzIHRoYXQgZG9uJ3QgaGF2ZSBhIGJpbmRpbmcgeWV0LlxuICAgIGNvbXBpbGVyLmNvbXBpbGUoZWwsIHRydWUpXG5cbiAgICAvLyBBbnkgZGlyZWN0aXZlIHRoYXQgY3JlYXRlcyBjaGlsZCBWTXMgYXJlIGRlZmVycmVkXG4gICAgLy8gc28gdGhhdCB3aGVuIHRoZXkgYXJlIGNvbXBpbGVkLCBhbGwgYmluZGluZ3Mgb24gdGhlXG4gICAgLy8gcGFyZW50IFZNIGhhdmUgYmVlbiBjcmVhdGVkLlxuICAgIGkgPSBjb21waWxlci5kZWZlcnJlZC5sZW5ndGhcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIGNvbXBpbGVyLmJpbmREaXJlY3RpdmUoY29tcGlsZXIuZGVmZXJyZWRbaV0pXG4gICAgfVxuICAgIGNvbXBpbGVyLmRlZmVycmVkID0gbnVsbFxuXG4gICAgLy8gZXh0cmFjdCBkZXBlbmRlbmNpZXMgZm9yIGNvbXB1dGVkIHByb3BlcnRpZXMuXG4gICAgLy8gdGhpcyB3aWxsIGV2YWx1YXRlZCBhbGwgY29sbGVjdGVkIGNvbXB1dGVkIGJpbmRpbmdzXG4gICAgLy8gYW5kIGNvbGxlY3QgZ2V0IGV2ZW50cyB0aGF0IGFyZSBlbWl0dGVkLlxuICAgIGlmICh0aGlzLmNvbXB1dGVkLmxlbmd0aCkge1xuICAgICAgICBEZXBzUGFyc2VyLnBhcnNlKHRoaXMuY29tcHV0ZWQpXG4gICAgfVxuXG4gICAgLy8gZG9uZSFcbiAgICBjb21waWxlci5pbml0ID0gZmFsc2VcblxuICAgIC8vIHBvc3QgY29tcGlsZSAvIHJlYWR5IGhvb2tcbiAgICBjb21waWxlci5leGVjSG9vaygncmVhZHknKVxufVxuXG52YXIgQ29tcGlsZXJQcm90byA9IENvbXBpbGVyLnByb3RvdHlwZVxuXG4vKipcbiAqICBJbml0aWFsaXplIHRoZSBWTS9Db21waWxlcidzIGVsZW1lbnQuXG4gKiAgRmlsbCBpdCBpbiB3aXRoIHRoZSB0ZW1wbGF0ZSBpZiBuZWNlc3NhcnkuXG4gKi9cbkNvbXBpbGVyUHJvdG8uc2V0dXBFbGVtZW50ID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAvLyBjcmVhdGUgdGhlIG5vZGUgZmlyc3RcbiAgICB2YXIgZWwgPSB0eXBlb2Ygb3B0aW9ucy5lbCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKG9wdGlvbnMuZWwpXG4gICAgICAgIDogb3B0aW9ucy5lbCB8fCBkb2N1bWVudC5jcmVhdGVFbGVtZW50KG9wdGlvbnMudGFnTmFtZSB8fCAnZGl2JylcblxuICAgIHZhciB0ZW1wbGF0ZSA9IG9wdGlvbnMudGVtcGxhdGUsXG4gICAgICAgIGNoaWxkLCByZXBsYWNlciwgaSwgYXR0ciwgYXR0cnNcblxuICAgIGlmICh0ZW1wbGF0ZSkge1xuICAgICAgICAvLyBjb2xsZWN0IGFueXRoaW5nIGFscmVhZHkgaW4gdGhlcmVcbiAgICAgICAgaWYgKGVsLmhhc0NoaWxkTm9kZXMoKSkge1xuICAgICAgICAgICAgdGhpcy5yYXdDb250ZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JylcbiAgICAgICAgICAgIC8qIGpzaGludCBib3NzOiB0cnVlICovXG4gICAgICAgICAgICB3aGlsZSAoY2hpbGQgPSBlbC5maXJzdENoaWxkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5yYXdDb250ZW50LmFwcGVuZENoaWxkKGNoaWxkKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIHJlcGxhY2Ugb3B0aW9uOiB1c2UgdGhlIGZpcnN0IG5vZGUgaW5cbiAgICAgICAgLy8gdGhlIHRlbXBsYXRlIGRpcmVjdGx5XG4gICAgICAgIGlmIChvcHRpb25zLnJlcGxhY2UgJiYgdGVtcGxhdGUuY2hpbGROb2Rlcy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgIHJlcGxhY2VyID0gdGVtcGxhdGUuY2hpbGROb2Rlc1swXS5jbG9uZU5vZGUodHJ1ZSlcbiAgICAgICAgICAgIGlmIChlbC5wYXJlbnROb2RlKSB7XG4gICAgICAgICAgICAgICAgZWwucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUocmVwbGFjZXIsIGVsKVxuICAgICAgICAgICAgICAgIGVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoZWwpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBjb3B5IG92ZXIgYXR0cmlidXRlc1xuICAgICAgICAgICAgaWYgKGVsLmhhc0F0dHJpYnV0ZXMoKSkge1xuICAgICAgICAgICAgICAgIGkgPSBlbC5hdHRyaWJ1dGVzLmxlbmd0aFxuICAgICAgICAgICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgICAgICAgICAgYXR0ciA9IGVsLmF0dHJpYnV0ZXNbaV1cbiAgICAgICAgICAgICAgICAgICAgcmVwbGFjZXIuc2V0QXR0cmlidXRlKGF0dHIubmFtZSwgYXR0ci52YWx1ZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyByZXBsYWNlXG4gICAgICAgICAgICBlbCA9IHJlcGxhY2VyXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBlbC5hcHBlbmRDaGlsZCh0ZW1wbGF0ZS5jbG9uZU5vZGUodHJ1ZSkpXG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIC8vIGFwcGx5IGVsZW1lbnQgb3B0aW9uc1xuICAgIGlmIChvcHRpb25zLmlkKSBlbC5pZCA9IG9wdGlvbnMuaWRcbiAgICBpZiAob3B0aW9ucy5jbGFzc05hbWUpIGVsLmNsYXNzTmFtZSA9IG9wdGlvbnMuY2xhc3NOYW1lXG4gICAgYXR0cnMgPSBvcHRpb25zLmF0dHJpYnV0ZXNcbiAgICBpZiAoYXR0cnMpIHtcbiAgICAgICAgZm9yIChhdHRyIGluIGF0dHJzKSB7XG4gICAgICAgICAgICBlbC5zZXRBdHRyaWJ1dGUoYXR0ciwgYXR0cnNbYXR0cl0pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZWxcbn1cblxuLyoqXG4gKiAgRGVhbCB3aXRoIDxjb250ZW50PiBpbnNlcnRpb24gcG9pbnRzXG4gKiAgcGVyIHRoZSBXZWIgQ29tcG9uZW50cyBzcGVjXG4gKi9cbkNvbXBpbGVyUHJvdG8ucmVzb2x2ZUNvbnRlbnQgPSBmdW5jdGlvbiAoKSB7XG5cbiAgICB2YXIgb3V0bGV0cyA9IHNsaWNlLmNhbGwodGhpcy5lbC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnY29udGVudCcpKSxcbiAgICAgICAgcmF3ID0gdGhpcy5yYXdDb250ZW50LFxuICAgICAgICBvdXRsZXQsIHNlbGVjdCwgaSwgaiwgbWFpblxuXG4gICAgaSA9IG91dGxldHMubGVuZ3RoXG4gICAgaWYgKGkpIHtcbiAgICAgICAgLy8gZmlyc3QgcGFzcywgY29sbGVjdCBjb3JyZXNwb25kaW5nIGNvbnRlbnRcbiAgICAgICAgLy8gZm9yIGVhY2ggb3V0bGV0LlxuICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICBvdXRsZXQgPSBvdXRsZXRzW2ldXG4gICAgICAgICAgICBpZiAocmF3KSB7XG4gICAgICAgICAgICAgICAgc2VsZWN0ID0gb3V0bGV0LmdldEF0dHJpYnV0ZSgnc2VsZWN0JylcbiAgICAgICAgICAgICAgICBpZiAoc2VsZWN0KSB7IC8vIHNlbGVjdCBjb250ZW50XG4gICAgICAgICAgICAgICAgICAgIG91dGxldC5jb250ZW50ID1cbiAgICAgICAgICAgICAgICAgICAgICAgIHNsaWNlLmNhbGwocmF3LnF1ZXJ5U2VsZWN0b3JBbGwoc2VsZWN0KSlcbiAgICAgICAgICAgICAgICB9IGVsc2UgeyAvLyBkZWZhdWx0IGNvbnRlbnRcbiAgICAgICAgICAgICAgICAgICAgbWFpbiA9IG91dGxldFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7IC8vIGZhbGxiYWNrIGNvbnRlbnRcbiAgICAgICAgICAgICAgICBvdXRsZXQuY29udGVudCA9XG4gICAgICAgICAgICAgICAgICAgIHNsaWNlLmNhbGwob3V0bGV0LmNoaWxkTm9kZXMpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gc2Vjb25kIHBhc3MsIGFjdHVhbGx5IGluc2VydCB0aGUgY29udGVudHNcbiAgICAgICAgZm9yIChpID0gMCwgaiA9IG91dGxldHMubGVuZ3RoOyBpIDwgajsgaSsrKSB7XG4gICAgICAgICAgICBvdXRsZXQgPSBvdXRsZXRzW2ldXG4gICAgICAgICAgICBpZiAob3V0bGV0ID09PSBtYWluKSBjb250aW51ZVxuICAgICAgICAgICAgaW5zZXJ0KG91dGxldCwgb3V0bGV0LmNvbnRlbnQpXG4gICAgICAgIH1cbiAgICAgICAgLy8gZmluYWxseSBpbnNlcnQgdGhlIG1haW4gY29udGVudFxuICAgICAgICBpZiAocmF3ICYmIG1haW4pIHtcbiAgICAgICAgICAgIGluc2VydChtYWluLCBzbGljZS5jYWxsKHJhdy5jaGlsZE5vZGVzKSlcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGluc2VydCAob3V0bGV0LCBjb250ZW50cykge1xuICAgICAgICB2YXIgcGFyZW50ID0gb3V0bGV0LnBhcmVudE5vZGUsXG4gICAgICAgICAgICBpID0gMCwgaiA9IGNvbnRlbnRzLmxlbmd0aFxuICAgICAgICBmb3IgKDsgaSA8IGo7IGkrKykge1xuICAgICAgICAgICAgcGFyZW50Lmluc2VydEJlZm9yZShjb250ZW50c1tpXSwgb3V0bGV0KVxuICAgICAgICB9XG4gICAgICAgIHBhcmVudC5yZW1vdmVDaGlsZChvdXRsZXQpXG4gICAgfVxuXG4gICAgdGhpcy5yYXdDb250ZW50ID0gbnVsbFxufVxuXG4vKipcbiAqICBTZXR1cCBvYnNlcnZlci5cbiAqICBUaGUgb2JzZXJ2ZXIgbGlzdGVucyBmb3IgZ2V0L3NldC9tdXRhdGUgZXZlbnRzIG9uIGFsbCBWTVxuICogIHZhbHVlcy9vYmplY3RzIGFuZCB0cmlnZ2VyIGNvcnJlc3BvbmRpbmcgYmluZGluZyB1cGRhdGVzLlxuICogIEl0IGFsc28gbGlzdGVucyBmb3IgbGlmZWN5Y2xlIGhvb2tzLlxuICovXG5Db21waWxlclByb3RvLnNldHVwT2JzZXJ2ZXIgPSBmdW5jdGlvbiAoKSB7XG5cbiAgICB2YXIgY29tcGlsZXIgPSB0aGlzLFxuICAgICAgICBiaW5kaW5ncyA9IGNvbXBpbGVyLmJpbmRpbmdzLFxuICAgICAgICBvcHRpb25zICA9IGNvbXBpbGVyLm9wdGlvbnMsXG4gICAgICAgIG9ic2VydmVyID0gY29tcGlsZXIub2JzZXJ2ZXIgPSBuZXcgRW1pdHRlcihjb21waWxlci52bSlcblxuICAgIC8vIGEgaGFzaCB0byBob2xkIGV2ZW50IHByb3hpZXMgZm9yIGVhY2ggcm9vdCBsZXZlbCBrZXlcbiAgICAvLyBzbyB0aGV5IGNhbiBiZSByZWZlcmVuY2VkIGFuZCByZW1vdmVkIGxhdGVyXG4gICAgb2JzZXJ2ZXIucHJveGllcyA9IHt9XG5cbiAgICAvLyBhZGQgb3duIGxpc3RlbmVycyB3aGljaCB0cmlnZ2VyIGJpbmRpbmcgdXBkYXRlc1xuICAgIG9ic2VydmVyXG4gICAgICAgIC5vbignZ2V0Jywgb25HZXQpXG4gICAgICAgIC5vbignc2V0Jywgb25TZXQpXG4gICAgICAgIC5vbignbXV0YXRlJywgb25TZXQpXG5cbiAgICAvLyByZWdpc3RlciBob29rc1xuICAgIHZhciBpID0gaG9va3MubGVuZ3RoLCBqLCBob29rLCBmbnNcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIGhvb2sgPSBob29rc1tpXVxuICAgICAgICBmbnMgPSBvcHRpb25zW2hvb2tdXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZucykpIHtcbiAgICAgICAgICAgIGogPSBmbnMubGVuZ3RoXG4gICAgICAgICAgICAvLyBzaW5jZSBob29rcyB3ZXJlIG1lcmdlZCB3aXRoIGNoaWxkIGF0IGhlYWQsXG4gICAgICAgICAgICAvLyB3ZSBsb29wIHJldmVyc2VseS5cbiAgICAgICAgICAgIHdoaWxlIChqLS0pIHtcbiAgICAgICAgICAgICAgICByZWdpc3Rlckhvb2soaG9vaywgZm5zW2pdKVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGZucykge1xuICAgICAgICAgICAgcmVnaXN0ZXJIb29rKGhvb2ssIGZucylcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGJyb2FkY2FzdCBhdHRhY2hlZC9kZXRhY2hlZCBob29rc1xuICAgIG9ic2VydmVyXG4gICAgICAgIC5vbignaG9vazphdHRhY2hlZCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGJyb2FkY2FzdCgxKVxuICAgICAgICB9KVxuICAgICAgICAub24oJ2hvb2s6ZGV0YWNoZWQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBicm9hZGNhc3QoMClcbiAgICAgICAgfSlcblxuICAgIGZ1bmN0aW9uIG9uR2V0IChrZXkpIHtcbiAgICAgICAgY2hlY2soa2V5KVxuICAgICAgICBEZXBzUGFyc2VyLmNhdGNoZXIuZW1pdCgnZ2V0JywgYmluZGluZ3Nba2V5XSlcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBvblNldCAoa2V5LCB2YWwsIG11dGF0aW9uKSB7XG4gICAgICAgIG9ic2VydmVyLmVtaXQoJ2NoYW5nZTonICsga2V5LCB2YWwsIG11dGF0aW9uKVxuICAgICAgICBjaGVjayhrZXkpXG4gICAgICAgIGJpbmRpbmdzW2tleV0udXBkYXRlKHZhbClcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZWdpc3Rlckhvb2sgKGhvb2ssIGZuKSB7XG4gICAgICAgIG9ic2VydmVyLm9uKCdob29rOicgKyBob29rLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBmbi5jYWxsKGNvbXBpbGVyLnZtKVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJyb2FkY2FzdCAoZXZlbnQpIHtcbiAgICAgICAgdmFyIGNoaWxkcmVuID0gY29tcGlsZXIuY2hpbGRyZW5cbiAgICAgICAgaWYgKGNoaWxkcmVuKSB7XG4gICAgICAgICAgICB2YXIgY2hpbGQsIGkgPSBjaGlsZHJlbi5sZW5ndGhcbiAgICAgICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGNoaWxkcmVuW2ldXG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkLmVsLnBhcmVudE5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgZXZlbnQgPSAnaG9vazonICsgKGV2ZW50ID8gJ2F0dGFjaGVkJyA6ICdkZXRhY2hlZCcpXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkLm9ic2VydmVyLmVtaXQoZXZlbnQpXG4gICAgICAgICAgICAgICAgICAgIGNoaWxkLmVtaXR0ZXIuZW1pdChldmVudClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjaGVjayAoa2V5KSB7XG4gICAgICAgIGlmICghYmluZGluZ3Nba2V5XSkge1xuICAgICAgICAgICAgY29tcGlsZXIuY3JlYXRlQmluZGluZyhrZXkpXG4gICAgICAgIH1cbiAgICB9XG59XG5cbkNvbXBpbGVyUHJvdG8ub2JzZXJ2ZURhdGEgPSBmdW5jdGlvbiAoZGF0YSkge1xuXG4gICAgdmFyIGNvbXBpbGVyID0gdGhpcyxcbiAgICAgICAgb2JzZXJ2ZXIgPSBjb21waWxlci5vYnNlcnZlclxuXG4gICAgLy8gcmVjdXJzaXZlbHkgb2JzZXJ2ZSBuZXN0ZWQgcHJvcGVydGllc1xuICAgIE9ic2VydmVyLm9ic2VydmUoZGF0YSwgJycsIG9ic2VydmVyKVxuXG4gICAgLy8gYWxzbyBjcmVhdGUgYmluZGluZyBmb3IgdG9wIGxldmVsICRkYXRhXG4gICAgLy8gc28gaXQgY2FuIGJlIHVzZWQgaW4gdGVtcGxhdGVzIHRvb1xuICAgIHZhciAkZGF0YUJpbmRpbmcgPSBjb21waWxlci5iaW5kaW5nc1snJGRhdGEnXSA9IG5ldyBCaW5kaW5nKGNvbXBpbGVyLCAnJGRhdGEnKVxuICAgICRkYXRhQmluZGluZy51cGRhdGUoZGF0YSlcblxuICAgIC8vIGFsbG93ICRkYXRhIHRvIGJlIHN3YXBwZWRcbiAgICBkZWYoY29tcGlsZXIudm0sICckZGF0YScsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBjb21waWxlci5vYnNlcnZlci5lbWl0KCdnZXQnLCAnJGRhdGEnKVxuICAgICAgICAgICAgcmV0dXJuIGNvbXBpbGVyLmRhdGFcbiAgICAgICAgfSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbiAobmV3RGF0YSkge1xuICAgICAgICAgICAgdmFyIG9sZERhdGEgPSBjb21waWxlci5kYXRhXG4gICAgICAgICAgICBPYnNlcnZlci51bm9ic2VydmUob2xkRGF0YSwgJycsIG9ic2VydmVyKVxuICAgICAgICAgICAgY29tcGlsZXIuZGF0YSA9IG5ld0RhdGFcbiAgICAgICAgICAgIE9ic2VydmVyLmNvcHlQYXRocyhuZXdEYXRhLCBvbGREYXRhKVxuICAgICAgICAgICAgT2JzZXJ2ZXIub2JzZXJ2ZShuZXdEYXRhLCAnJywgb2JzZXJ2ZXIpXG4gICAgICAgICAgICB1cGRhdGUoKVxuICAgICAgICB9XG4gICAgfSlcblxuICAgIC8vIGVtaXQgJGRhdGEgY2hhbmdlIG9uIGFsbCBjaGFuZ2VzXG4gICAgb2JzZXJ2ZXJcbiAgICAgICAgLm9uKCdzZXQnLCBvblNldClcbiAgICAgICAgLm9uKCdtdXRhdGUnLCBvblNldClcblxuICAgIGZ1bmN0aW9uIG9uU2V0IChrZXkpIHtcbiAgICAgICAgaWYgKGtleSAhPT0gJyRkYXRhJykgdXBkYXRlKClcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGUgKCkge1xuICAgICAgICAkZGF0YUJpbmRpbmcudXBkYXRlKGNvbXBpbGVyLmRhdGEpXG4gICAgICAgIG9ic2VydmVyLmVtaXQoJ2NoYW5nZTokZGF0YScsIGNvbXBpbGVyLmRhdGEpXG4gICAgfVxufVxuXG4vKipcbiAqICBDb21waWxlIGEgRE9NIG5vZGUgKHJlY3Vyc2l2ZSlcbiAqL1xuQ29tcGlsZXJQcm90by5jb21waWxlID0gZnVuY3Rpb24gKG5vZGUsIHJvb3QpIHtcbiAgICB2YXIgbm9kZVR5cGUgPSBub2RlLm5vZGVUeXBlXG4gICAgaWYgKG5vZGVUeXBlID09PSAxICYmIG5vZGUudGFnTmFtZSAhPT0gJ1NDUklQVCcpIHsgLy8gYSBub3JtYWwgbm9kZVxuICAgICAgICB0aGlzLmNvbXBpbGVFbGVtZW50KG5vZGUsIHJvb3QpXG4gICAgfSBlbHNlIGlmIChub2RlVHlwZSA9PT0gMyAmJiBjb25maWcuaW50ZXJwb2xhdGUpIHtcbiAgICAgICAgdGhpcy5jb21waWxlVGV4dE5vZGUobm9kZSlcbiAgICB9XG59XG5cbi8qKlxuICogIENoZWNrIGZvciBhIHByaW9yaXR5IGRpcmVjdGl2ZVxuICogIElmIGl0IGlzIHByZXNlbnQgYW5kIHZhbGlkLCByZXR1cm4gdHJ1ZSB0byBza2lwIHRoZSByZXN0XG4gKi9cbkNvbXBpbGVyUHJvdG8uY2hlY2tQcmlvcml0eURpciA9IGZ1bmN0aW9uIChkaXJuYW1lLCBub2RlLCByb290KSB7XG4gICAgdmFyIGV4cHJlc3Npb24sIGRpcmVjdGl2ZSwgQ3RvclxuICAgIGlmIChcbiAgICAgICAgZGlybmFtZSA9PT0gJ2NvbXBvbmVudCcgJiZcbiAgICAgICAgcm9vdCAhPT0gdHJ1ZSAmJlxuICAgICAgICAoQ3RvciA9IHRoaXMucmVzb2x2ZUNvbXBvbmVudChub2RlLCB1bmRlZmluZWQsIHRydWUpKVxuICAgICkge1xuICAgICAgICBkaXJlY3RpdmUgPSBEaXJlY3RpdmUuYnVpbGQoZGlybmFtZSwgJycsIHRoaXMsIG5vZGUpXG4gICAgICAgIGRpcmVjdGl2ZS5DdG9yID0gQ3RvclxuICAgIH0gZWxzZSB7XG4gICAgICAgIGV4cHJlc3Npb24gPSB1dGlscy5hdHRyKG5vZGUsIGRpcm5hbWUpXG4gICAgICAgIGRpcmVjdGl2ZSA9IGV4cHJlc3Npb24gJiYgRGlyZWN0aXZlLmJ1aWxkKGRpcm5hbWUsIGV4cHJlc3Npb24sIHRoaXMsIG5vZGUpXG4gICAgfVxuICAgIGlmIChkaXJlY3RpdmUpIHtcbiAgICAgICAgaWYgKHJvb3QgPT09IHRydWUpIHtcbiAgICAgICAgICAgIHV0aWxzLndhcm4oXG4gICAgICAgICAgICAgICAgJ0RpcmVjdGl2ZSB2LScgKyBkaXJuYW1lICsgJyBjYW5ub3QgYmUgdXNlZCBvbiBhbiBhbHJlYWR5IGluc3RhbnRpYXRlZCAnICtcbiAgICAgICAgICAgICAgICAnVk1cXCdzIHJvb3Qgbm9kZS4gVXNlIGl0IGZyb20gdGhlIHBhcmVudFxcJ3MgdGVtcGxhdGUgaW5zdGVhZC4nXG4gICAgICAgICAgICApXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICB0aGlzLmRlZmVycmVkLnB1c2goZGlyZWN0aXZlKVxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cbn1cblxuLyoqXG4gKiAgQ29tcGlsZSBub3JtYWwgZGlyZWN0aXZlcyBvbiBhIG5vZGVcbiAqL1xuQ29tcGlsZXJQcm90by5jb21waWxlRWxlbWVudCA9IGZ1bmN0aW9uIChub2RlLCByb290KSB7XG5cbiAgICAvLyB0ZXh0YXJlYSBpcyBwcmV0dHkgYW5ub3lpbmdcbiAgICAvLyBiZWNhdXNlIGl0cyB2YWx1ZSBjcmVhdGVzIGNoaWxkTm9kZXMgd2hpY2hcbiAgICAvLyB3ZSBkb24ndCB3YW50IHRvIGNvbXBpbGUuXG4gICAgaWYgKG5vZGUudGFnTmFtZSA9PT0gJ1RFWFRBUkVBJyAmJiBub2RlLnZhbHVlKSB7XG4gICAgICAgIG5vZGUudmFsdWUgPSB0aGlzLmV2YWwobm9kZS52YWx1ZSlcbiAgICB9XG5cbiAgICAvLyBvbmx5IGNvbXBpbGUgaWYgdGhpcyBlbGVtZW50IGhhcyBhdHRyaWJ1dGVzXG4gICAgLy8gb3IgaXRzIHRhZ05hbWUgY29udGFpbnMgYSBoeXBoZW4gKHdoaWNoIG1lYW5zIGl0IGNvdWxkXG4gICAgLy8gcG90ZW50aWFsbHkgYmUgYSBjdXN0b20gZWxlbWVudClcbiAgICBpZiAobm9kZS5oYXNBdHRyaWJ1dGVzKCkgfHwgbm9kZS50YWdOYW1lLmluZGV4T2YoJy0nKSA+IC0xKSB7XG5cbiAgICAgICAgLy8gc2tpcCBhbnl0aGluZyB3aXRoIHYtcHJlXG4gICAgICAgIGlmICh1dGlscy5hdHRyKG5vZGUsICdwcmUnKSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICAvLyBjaGVjayBwcmlvcml0eSBkaXJlY3RpdmVzLlxuICAgICAgICAvLyBpZiBhbnkgb2YgdGhlbSBhcmUgcHJlc2VudCwgaXQgd2lsbCB0YWtlIG92ZXIgdGhlIG5vZGUgd2l0aCBhIGNoaWxkVk1cbiAgICAgICAgLy8gc28gd2UgY2FuIHNraXAgdGhlIHJlc3RcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSBwcmlvcml0eURpcmVjdGl2ZXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5jaGVja1ByaW9yaXR5RGlyKHByaW9yaXR5RGlyZWN0aXZlc1tpXSwgbm9kZSwgcm9vdCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNoZWNrIHRyYW5zaXRpb24gJiBhbmltYXRpb24gcHJvcGVydGllc1xuICAgICAgICBub2RlLnZ1ZV90cmFucyAgPSB1dGlscy5hdHRyKG5vZGUsICd0cmFuc2l0aW9uJylcbiAgICAgICAgbm9kZS52dWVfYW5pbSAgID0gdXRpbHMuYXR0cihub2RlLCAnYW5pbWF0aW9uJylcbiAgICAgICAgbm9kZS52dWVfZWZmZWN0ID0gdGhpcy5ldmFsKHV0aWxzLmF0dHIobm9kZSwgJ2VmZmVjdCcpKVxuXG4gICAgICAgIHZhciBwcmVmaXggPSBjb25maWcucHJlZml4ICsgJy0nLFxuICAgICAgICAgICAgYXR0cnMgPSBzbGljZS5jYWxsKG5vZGUuYXR0cmlidXRlcyksXG4gICAgICAgICAgICBwYXJhbXMgPSB0aGlzLm9wdGlvbnMucGFyYW1BdHRyaWJ1dGVzLFxuICAgICAgICAgICAgYXR0ciwgaXNEaXJlY3RpdmUsIGV4cHMsIGV4cCwgZGlyZWN0aXZlLCBkaXJuYW1lXG5cbiAgICAgICAgaSA9IGF0dHJzLmxlbmd0aFxuICAgICAgICB3aGlsZSAoaS0tKSB7XG5cbiAgICAgICAgICAgIGF0dHIgPSBhdHRyc1tpXVxuICAgICAgICAgICAgaXNEaXJlY3RpdmUgPSBmYWxzZVxuXG4gICAgICAgICAgICBpZiAoYXR0ci5uYW1lLmluZGV4T2YocHJlZml4KSA9PT0gMCkge1xuICAgICAgICAgICAgICAgIC8vIGEgZGlyZWN0aXZlIC0gc3BsaXQsIHBhcnNlIGFuZCBiaW5kIGl0LlxuICAgICAgICAgICAgICAgIGlzRGlyZWN0aXZlID0gdHJ1ZVxuICAgICAgICAgICAgICAgIGV4cHMgPSBEaXJlY3RpdmUuc3BsaXQoYXR0ci52YWx1ZSlcbiAgICAgICAgICAgICAgICAvLyBsb29wIHRocm91Z2ggY2xhdXNlcyAoc2VwYXJhdGVkIGJ5IFwiLFwiKVxuICAgICAgICAgICAgICAgIC8vIGluc2lkZSBlYWNoIGF0dHJpYnV0ZVxuICAgICAgICAgICAgICAgIGwgPSBleHBzLmxlbmd0aFxuICAgICAgICAgICAgICAgIHdoaWxlIChsLS0pIHtcbiAgICAgICAgICAgICAgICAgICAgZXhwID0gZXhwc1tsXVxuICAgICAgICAgICAgICAgICAgICBkaXJuYW1lID0gYXR0ci5uYW1lLnNsaWNlKHByZWZpeC5sZW5ndGgpXG4gICAgICAgICAgICAgICAgICAgIGRpcmVjdGl2ZSA9IERpcmVjdGl2ZS5idWlsZChkaXJuYW1lLCBleHAsIHRoaXMsIG5vZGUpXG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGRpcm5hbWUgPT09ICd3aXRoJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5iaW5kRGlyZWN0aXZlKGRpcmVjdGl2ZSwgdGhpcy5wYXJlbnQpXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJpbmREaXJlY3RpdmUoZGlyZWN0aXZlKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoY29uZmlnLmludGVycG9sYXRlKSB7XG4gICAgICAgICAgICAgICAgLy8gbm9uIGRpcmVjdGl2ZSBhdHRyaWJ1dGUsIGNoZWNrIGludGVycG9sYXRpb24gdGFnc1xuICAgICAgICAgICAgICAgIGV4cCA9IFRleHRQYXJzZXIucGFyc2VBdHRyKGF0dHIudmFsdWUpXG4gICAgICAgICAgICAgICAgaWYgKGV4cCkge1xuICAgICAgICAgICAgICAgICAgICBkaXJlY3RpdmUgPSBEaXJlY3RpdmUuYnVpbGQoJ2F0dHInLCBhdHRyLm5hbWUgKyAnOicgKyBleHAsIHRoaXMsIG5vZGUpXG4gICAgICAgICAgICAgICAgICAgIGlmIChwYXJhbXMgJiYgcGFyYW1zLmluZGV4T2YoYXR0ci5uYW1lKSA+IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBhIHBhcmFtIGF0dHJpYnV0ZS4uLiB3ZSBzaG91bGQgdXNlIHRoZSBwYXJlbnQgYmluZGluZ1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gdG8gYXZvaWQgY2lyY3VsYXIgdXBkYXRlcyBsaWtlIHNpemU9e3tzaXplfX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYmluZERpcmVjdGl2ZShkaXJlY3RpdmUsIHRoaXMucGFyZW50KVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5iaW5kRGlyZWN0aXZlKGRpcmVjdGl2ZSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGlzRGlyZWN0aXZlICYmIGRpcm5hbWUgIT09ICdjbG9haycpIHtcbiAgICAgICAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZShhdHRyLm5hbWUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIC8vIHJlY3Vyc2l2ZWx5IGNvbXBpbGUgY2hpbGROb2Rlc1xuICAgIGlmIChub2RlLmhhc0NoaWxkTm9kZXMoKSkge1xuICAgICAgICBzbGljZS5jYWxsKG5vZGUuY2hpbGROb2RlcykuZm9yRWFjaCh0aGlzLmNvbXBpbGUsIHRoaXMpXG4gICAgfVxufVxuXG4vKipcbiAqICBDb21waWxlIGEgdGV4dCBub2RlXG4gKi9cbkNvbXBpbGVyUHJvdG8uY29tcGlsZVRleHROb2RlID0gZnVuY3Rpb24gKG5vZGUpIHtcblxuICAgIHZhciB0b2tlbnMgPSBUZXh0UGFyc2VyLnBhcnNlKG5vZGUubm9kZVZhbHVlKVxuICAgIGlmICghdG9rZW5zKSByZXR1cm5cbiAgICB2YXIgZWwsIHRva2VuLCBkaXJlY3RpdmVcblxuICAgIGZvciAodmFyIGkgPSAwLCBsID0gdG9rZW5zLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuXG4gICAgICAgIHRva2VuID0gdG9rZW5zW2ldXG4gICAgICAgIGRpcmVjdGl2ZSA9IG51bGxcblxuICAgICAgICBpZiAodG9rZW4ua2V5KSB7IC8vIGEgYmluZGluZ1xuICAgICAgICAgICAgaWYgKHRva2VuLmtleS5jaGFyQXQoMCkgPT09ICc+JykgeyAvLyBhIHBhcnRpYWxcbiAgICAgICAgICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUNvbW1lbnQoJ3JlZicpXG4gICAgICAgICAgICAgICAgZGlyZWN0aXZlID0gRGlyZWN0aXZlLmJ1aWxkKCdwYXJ0aWFsJywgdG9rZW4ua2V5LnNsaWNlKDEpLCB0aGlzLCBlbClcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaWYgKCF0b2tlbi5odG1sKSB7IC8vIHRleHQgYmluZGluZ1xuICAgICAgICAgICAgICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKVxuICAgICAgICAgICAgICAgICAgICBkaXJlY3RpdmUgPSBEaXJlY3RpdmUuYnVpbGQoJ3RleHQnLCB0b2tlbi5rZXksIHRoaXMsIGVsKVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7IC8vIGh0bWwgYmluZGluZ1xuICAgICAgICAgICAgICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUNvbW1lbnQoY29uZmlnLnByZWZpeCArICctaHRtbCcpXG4gICAgICAgICAgICAgICAgICAgIGRpcmVjdGl2ZSA9IERpcmVjdGl2ZS5idWlsZCgnaHRtbCcsIHRva2VuLmtleSwgdGhpcywgZWwpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgeyAvLyBhIHBsYWluIHN0cmluZ1xuICAgICAgICAgICAgZWwgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSh0b2tlbilcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGluc2VydCBub2RlXG4gICAgICAgIG5vZGUucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZWwsIG5vZGUpXG4gICAgICAgIC8vIGJpbmQgZGlyZWN0aXZlXG4gICAgICAgIHRoaXMuYmluZERpcmVjdGl2ZShkaXJlY3RpdmUpXG5cbiAgICB9XG4gICAgbm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG5vZGUpXG59XG5cbi8qKlxuICogIEFkZCBhIGRpcmVjdGl2ZSBpbnN0YW5jZSB0byB0aGUgY29ycmVjdCBiaW5kaW5nICYgdmlld21vZGVsXG4gKi9cbkNvbXBpbGVyUHJvdG8uYmluZERpcmVjdGl2ZSA9IGZ1bmN0aW9uIChkaXJlY3RpdmUsIGJpbmRpbmdPd25lcikge1xuXG4gICAgaWYgKCFkaXJlY3RpdmUpIHJldHVyblxuXG4gICAgLy8ga2VlcCB0cmFjayBvZiBpdCBzbyB3ZSBjYW4gdW5iaW5kKCkgbGF0ZXJcbiAgICB0aGlzLmRpcnMucHVzaChkaXJlY3RpdmUpXG5cbiAgICAvLyBmb3IgZW1wdHkgb3IgbGl0ZXJhbCBkaXJlY3RpdmVzLCBzaW1wbHkgY2FsbCBpdHMgYmluZCgpXG4gICAgLy8gYW5kIHdlJ3JlIGRvbmUuXG4gICAgaWYgKGRpcmVjdGl2ZS5pc0VtcHR5IHx8IGRpcmVjdGl2ZS5pc0xpdGVyYWwpIHtcbiAgICAgICAgaWYgKGRpcmVjdGl2ZS5iaW5kKSBkaXJlY3RpdmUuYmluZCgpXG4gICAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8vIG90aGVyd2lzZSwgd2UgZ290IG1vcmUgd29yayB0byBkby4uLlxuICAgIHZhciBiaW5kaW5nLFxuICAgICAgICBjb21waWxlciA9IGJpbmRpbmdPd25lciB8fCB0aGlzLFxuICAgICAgICBrZXkgICAgICA9IGRpcmVjdGl2ZS5rZXlcblxuICAgIGlmIChkaXJlY3RpdmUuaXNFeHApIHtcbiAgICAgICAgLy8gZXhwcmVzc2lvbiBiaW5kaW5ncyBhcmUgYWx3YXlzIGNyZWF0ZWQgb24gY3VycmVudCBjb21waWxlclxuICAgICAgICBiaW5kaW5nID0gY29tcGlsZXIuY3JlYXRlQmluZGluZyhrZXksIGRpcmVjdGl2ZSlcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyByZWN1cnNpdmVseSBsb2NhdGUgd2hpY2ggY29tcGlsZXIgb3ducyB0aGUgYmluZGluZ1xuICAgICAgICB3aGlsZSAoY29tcGlsZXIpIHtcbiAgICAgICAgICAgIGlmIChjb21waWxlci5oYXNLZXkoa2V5KSkge1xuICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbXBpbGVyID0gY29tcGlsZXIucGFyZW50XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY29tcGlsZXIgPSBjb21waWxlciB8fCB0aGlzXG4gICAgICAgIGJpbmRpbmcgPSBjb21waWxlci5iaW5kaW5nc1trZXldIHx8IGNvbXBpbGVyLmNyZWF0ZUJpbmRpbmcoa2V5KVxuICAgIH1cbiAgICBiaW5kaW5nLmRpcnMucHVzaChkaXJlY3RpdmUpXG4gICAgZGlyZWN0aXZlLmJpbmRpbmcgPSBiaW5kaW5nXG5cbiAgICB2YXIgdmFsdWUgPSBiaW5kaW5nLnZhbCgpXG4gICAgLy8gaW52b2tlIGJpbmQgaG9vayBpZiBleGlzdHNcbiAgICBpZiAoZGlyZWN0aXZlLmJpbmQpIHtcbiAgICAgICAgZGlyZWN0aXZlLmJpbmQodmFsdWUpXG4gICAgfVxuICAgIC8vIHNldCBpbml0aWFsIHZhbHVlXG4gICAgZGlyZWN0aXZlLnVwZGF0ZSh2YWx1ZSwgdHJ1ZSlcbn1cblxuLyoqXG4gKiAgQ3JlYXRlIGJpbmRpbmcgYW5kIGF0dGFjaCBnZXR0ZXIvc2V0dGVyIGZvciBhIGtleSB0byB0aGUgdmlld21vZGVsIG9iamVjdFxuICovXG5Db21waWxlclByb3RvLmNyZWF0ZUJpbmRpbmcgPSBmdW5jdGlvbiAoa2V5LCBkaXJlY3RpdmUpIHtcblxuICAgIHV0aWxzLmxvZygnICBjcmVhdGVkIGJpbmRpbmc6ICcgKyBrZXkpXG5cbiAgICB2YXIgY29tcGlsZXIgPSB0aGlzLFxuICAgICAgICBtZXRob2RzICA9IGNvbXBpbGVyLm9wdGlvbnMubWV0aG9kcyxcbiAgICAgICAgaXNFeHAgICAgPSBkaXJlY3RpdmUgJiYgZGlyZWN0aXZlLmlzRXhwLFxuICAgICAgICBpc0ZuICAgICA9IChkaXJlY3RpdmUgJiYgZGlyZWN0aXZlLmlzRm4pIHx8IChtZXRob2RzICYmIG1ldGhvZHNba2V5XSksXG4gICAgICAgIGJpbmRpbmdzID0gY29tcGlsZXIuYmluZGluZ3MsXG4gICAgICAgIGNvbXB1dGVkID0gY29tcGlsZXIub3B0aW9ucy5jb21wdXRlZCxcbiAgICAgICAgYmluZGluZyAgPSBuZXcgQmluZGluZyhjb21waWxlciwga2V5LCBpc0V4cCwgaXNGbilcblxuICAgIGlmIChpc0V4cCkge1xuICAgICAgICAvLyBleHByZXNzaW9uIGJpbmRpbmdzIGFyZSBhbm9ueW1vdXNcbiAgICAgICAgY29tcGlsZXIuZGVmaW5lRXhwKGtleSwgYmluZGluZywgZGlyZWN0aXZlKVxuICAgIH0gZWxzZSBpZiAoaXNGbikge1xuICAgICAgICBiaW5kaW5nc1trZXldID0gYmluZGluZ1xuICAgICAgICBiaW5kaW5nLnZhbHVlID0gY29tcGlsZXIudm1ba2V5XSA9IG1ldGhvZHNba2V5XVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGJpbmRpbmdzW2tleV0gPSBiaW5kaW5nXG4gICAgICAgIGlmIChiaW5kaW5nLnJvb3QpIHtcbiAgICAgICAgICAgIC8vIHRoaXMgaXMgYSByb290IGxldmVsIGJpbmRpbmcuIHdlIG5lZWQgdG8gZGVmaW5lIGdldHRlci9zZXR0ZXJzIGZvciBpdC5cbiAgICAgICAgICAgIGlmIChjb21wdXRlZCAmJiBjb21wdXRlZFtrZXldKSB7XG4gICAgICAgICAgICAgICAgLy8gY29tcHV0ZWQgcHJvcGVydHlcbiAgICAgICAgICAgICAgICBjb21waWxlci5kZWZpbmVDb21wdXRlZChrZXksIGJpbmRpbmcsIGNvbXB1dGVkW2tleV0pXG4gICAgICAgICAgICB9IGVsc2UgaWYgKGtleS5jaGFyQXQoMCkgIT09ICckJykge1xuICAgICAgICAgICAgICAgIC8vIG5vcm1hbCBwcm9wZXJ0eVxuICAgICAgICAgICAgICAgIGNvbXBpbGVyLmRlZmluZVByb3Aoa2V5LCBiaW5kaW5nKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb21waWxlci5kZWZpbmVNZXRhKGtleSwgYmluZGluZylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChjb21wdXRlZCAmJiBjb21wdXRlZFt1dGlscy5iYXNlS2V5KGtleSldKSB7XG4gICAgICAgICAgICAvLyBuZXN0ZWQgcGF0aCBvbiBjb21wdXRlZCBwcm9wZXJ0eVxuICAgICAgICAgICAgY29tcGlsZXIuZGVmaW5lRXhwKGtleSwgYmluZGluZylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIGVuc3VyZSBwYXRoIGluIGRhdGEgc28gdGhhdCBjb21wdXRlZCBwcm9wZXJ0aWVzIHRoYXRcbiAgICAgICAgICAgIC8vIGFjY2VzcyB0aGUgcGF0aCBkb24ndCB0aHJvdyBhbiBlcnJvciBhbmQgY2FuIGNvbGxlY3RcbiAgICAgICAgICAgIC8vIGRlcGVuZGVuY2llc1xuICAgICAgICAgICAgT2JzZXJ2ZXIuZW5zdXJlUGF0aChjb21waWxlci5kYXRhLCBrZXkpXG4gICAgICAgICAgICB2YXIgcGFyZW50S2V5ID0ga2V5LnNsaWNlKDAsIGtleS5sYXN0SW5kZXhPZignLicpKVxuICAgICAgICAgICAgaWYgKCFiaW5kaW5nc1twYXJlbnRLZXldKSB7XG4gICAgICAgICAgICAgICAgLy8gdGhpcyBpcyBhIG5lc3RlZCB2YWx1ZSBiaW5kaW5nLCBidXQgdGhlIGJpbmRpbmcgZm9yIGl0cyBwYXJlbnRcbiAgICAgICAgICAgICAgICAvLyBoYXMgbm90IGJlZW4gY3JlYXRlZCB5ZXQuIFdlIGJldHRlciBjcmVhdGUgdGhhdCBvbmUgdG9vLlxuICAgICAgICAgICAgICAgIGNvbXBpbGVyLmNyZWF0ZUJpbmRpbmcocGFyZW50S2V5KVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBiaW5kaW5nXG59XG5cbi8qKlxuICogIERlZmluZSB0aGUgZ2V0dGVyL3NldHRlciBmb3IgYSByb290LWxldmVsIHByb3BlcnR5IG9uIHRoZSBWTVxuICogIGFuZCBvYnNlcnZlIHRoZSBpbml0aWFsIHZhbHVlXG4gKi9cbkNvbXBpbGVyUHJvdG8uZGVmaW5lUHJvcCA9IGZ1bmN0aW9uIChrZXksIGJpbmRpbmcpIHtcbiAgICB2YXIgY29tcGlsZXIgPSB0aGlzLFxuICAgICAgICBkYXRhICAgICA9IGNvbXBpbGVyLmRhdGEsXG4gICAgICAgIG9iICAgICAgID0gZGF0YS5fX2VtaXR0ZXJfX1xuXG4gICAgLy8gbWFrZSBzdXJlIHRoZSBrZXkgaXMgcHJlc2VudCBpbiBkYXRhXG4gICAgLy8gc28gaXQgY2FuIGJlIG9ic2VydmVkXG4gICAgaWYgKCEoaGFzT3duLmNhbGwoZGF0YSwga2V5KSkpIHtcbiAgICAgICAgZGF0YVtrZXldID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgLy8gaWYgdGhlIGRhdGEgb2JqZWN0IGlzIGFscmVhZHkgb2JzZXJ2ZWQsIGJ1dCB0aGUga2V5XG4gICAgLy8gaXMgbm90IG9ic2VydmVkLCB3ZSBuZWVkIHRvIGFkZCBpdCB0byB0aGUgb2JzZXJ2ZWQga2V5cy5cbiAgICBpZiAob2IgJiYgIShoYXNPd24uY2FsbChvYi52YWx1ZXMsIGtleSkpKSB7XG4gICAgICAgIE9ic2VydmVyLmNvbnZlcnRLZXkoZGF0YSwga2V5KVxuICAgIH1cblxuICAgIGJpbmRpbmcudmFsdWUgPSBkYXRhW2tleV1cblxuICAgIGRlZihjb21waWxlci52bSwga2V5LCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNvbXBpbGVyLmRhdGFba2V5XVxuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uICh2YWwpIHtcbiAgICAgICAgICAgIGNvbXBpbGVyLmRhdGFba2V5XSA9IHZhbFxuICAgICAgICB9XG4gICAgfSlcbn1cblxuLyoqXG4gKiAgRGVmaW5lIGEgbWV0YSBwcm9wZXJ0eSwgZS5nLiAkaW5kZXggb3IgJGtleSxcbiAqICB3aGljaCBpcyBiaW5kYWJsZSBidXQgb25seSBhY2Nlc3NpYmxlIG9uIHRoZSBWTSxcbiAqICBub3QgaW4gdGhlIGRhdGEuXG4gKi9cbkNvbXBpbGVyUHJvdG8uZGVmaW5lTWV0YSA9IGZ1bmN0aW9uIChrZXksIGJpbmRpbmcpIHtcbiAgICB2YXIgb2IgPSB0aGlzLm9ic2VydmVyXG4gICAgYmluZGluZy52YWx1ZSA9IHRoaXMuZGF0YVtrZXldXG4gICAgZGVsZXRlIHRoaXMuZGF0YVtrZXldXG4gICAgZGVmKHRoaXMudm0sIGtleSwge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChPYnNlcnZlci5zaG91bGRHZXQpIG9iLmVtaXQoJ2dldCcsIGtleSlcbiAgICAgICAgICAgIHJldHVybiBiaW5kaW5nLnZhbHVlXG4gICAgICAgIH0sXG4gICAgICAgIHNldDogZnVuY3Rpb24gKHZhbCkge1xuICAgICAgICAgICAgb2IuZW1pdCgnc2V0Jywga2V5LCB2YWwpXG4gICAgICAgIH1cbiAgICB9KVxufVxuXG4vKipcbiAqICBEZWZpbmUgYW4gZXhwcmVzc2lvbiBiaW5kaW5nLCB3aGljaCBpcyBlc3NlbnRpYWxseVxuICogIGFuIGFub255bW91cyBjb21wdXRlZCBwcm9wZXJ0eVxuICovXG5Db21waWxlclByb3RvLmRlZmluZUV4cCA9IGZ1bmN0aW9uIChrZXksIGJpbmRpbmcsIGRpcmVjdGl2ZSkge1xuICAgIHZhciBjb21wdXRlZEtleSA9IGRpcmVjdGl2ZSAmJiBkaXJlY3RpdmUuY29tcHV0ZWRLZXksXG4gICAgICAgIGV4cCAgICAgICAgID0gY29tcHV0ZWRLZXkgPyBkaXJlY3RpdmUuZXhwcmVzc2lvbiA6IGtleSxcbiAgICAgICAgZ2V0dGVyICAgICAgPSB0aGlzLmV4cENhY2hlW2V4cF1cbiAgICBpZiAoIWdldHRlcikge1xuICAgICAgICBnZXR0ZXIgPSB0aGlzLmV4cENhY2hlW2V4cF0gPSBFeHBQYXJzZXIucGFyc2UoY29tcHV0ZWRLZXkgfHwga2V5LCB0aGlzKVxuICAgIH1cbiAgICBpZiAoZ2V0dGVyKSB7XG4gICAgICAgIHRoaXMubWFya0NvbXB1dGVkKGJpbmRpbmcsIGdldHRlcilcbiAgICB9XG59XG5cbi8qKlxuICogIERlZmluZSBhIGNvbXB1dGVkIHByb3BlcnR5IG9uIHRoZSBWTVxuICovXG5Db21waWxlclByb3RvLmRlZmluZUNvbXB1dGVkID0gZnVuY3Rpb24gKGtleSwgYmluZGluZywgdmFsdWUpIHtcbiAgICB0aGlzLm1hcmtDb21wdXRlZChiaW5kaW5nLCB2YWx1ZSlcbiAgICBkZWYodGhpcy52bSwga2V5LCB7XG4gICAgICAgIGdldDogYmluZGluZy52YWx1ZS4kZ2V0LFxuICAgICAgICBzZXQ6IGJpbmRpbmcudmFsdWUuJHNldFxuICAgIH0pXG59XG5cbi8qKlxuICogIFByb2Nlc3MgYSBjb21wdXRlZCBwcm9wZXJ0eSBiaW5kaW5nXG4gKiAgc28gaXRzIGdldHRlci9zZXR0ZXIgYXJlIGJvdW5kIHRvIHByb3BlciBjb250ZXh0XG4gKi9cbkNvbXBpbGVyUHJvdG8ubWFya0NvbXB1dGVkID0gZnVuY3Rpb24gKGJpbmRpbmcsIHZhbHVlKSB7XG4gICAgYmluZGluZy5pc0NvbXB1dGVkID0gdHJ1ZVxuICAgIC8vIGJpbmQgdGhlIGFjY2Vzc29ycyB0byB0aGUgdm1cbiAgICBpZiAoYmluZGluZy5pc0ZuKSB7XG4gICAgICAgIGJpbmRpbmcudmFsdWUgPSB2YWx1ZVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHZhbHVlID0geyAkZ2V0OiB2YWx1ZSB9XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZy52YWx1ZSA9IHtcbiAgICAgICAgICAgICRnZXQ6IHV0aWxzLmJpbmQodmFsdWUuJGdldCwgdGhpcy52bSksXG4gICAgICAgICAgICAkc2V0OiB2YWx1ZS4kc2V0XG4gICAgICAgICAgICAgICAgPyB1dGlscy5iaW5kKHZhbHVlLiRzZXQsIHRoaXMudm0pXG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgIH1cbiAgICAvLyBrZWVwIHRyYWNrIGZvciBkZXAgcGFyc2luZyBsYXRlclxuICAgIHRoaXMuY29tcHV0ZWQucHVzaChiaW5kaW5nKVxufVxuXG4vKipcbiAqICBSZXRyaXZlIGFuIG9wdGlvbiBmcm9tIHRoZSBjb21waWxlclxuICovXG5Db21waWxlclByb3RvLmdldE9wdGlvbiA9IGZ1bmN0aW9uICh0eXBlLCBpZCwgc2lsZW50KSB7XG4gICAgdmFyIG9wdHMgPSB0aGlzLm9wdGlvbnMsXG4gICAgICAgIHBhcmVudCA9IHRoaXMucGFyZW50LFxuICAgICAgICBnbG9iYWxBc3NldHMgPSBjb25maWcuZ2xvYmFsQXNzZXRzLFxuICAgICAgICByZXMgPSAob3B0c1t0eXBlXSAmJiBvcHRzW3R5cGVdW2lkXSkgfHwgKFxuICAgICAgICAgICAgcGFyZW50XG4gICAgICAgICAgICAgICAgPyBwYXJlbnQuZ2V0T3B0aW9uKHR5cGUsIGlkLCBzaWxlbnQpXG4gICAgICAgICAgICAgICAgOiBnbG9iYWxBc3NldHNbdHlwZV0gJiYgZ2xvYmFsQXNzZXRzW3R5cGVdW2lkXVxuICAgICAgICApXG4gICAgaWYgKCFyZXMgJiYgIXNpbGVudCAmJiB0eXBlb2YgaWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHV0aWxzLndhcm4oJ1Vua25vd24gJyArIHR5cGUuc2xpY2UoMCwgLTEpICsgJzogJyArIGlkKVxuICAgIH1cbiAgICByZXR1cm4gcmVzXG59XG5cbi8qKlxuICogIEVtaXQgbGlmZWN5Y2xlIGV2ZW50cyB0byB0cmlnZ2VyIGhvb2tzXG4gKi9cbkNvbXBpbGVyUHJvdG8uZXhlY0hvb2sgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICBldmVudCA9ICdob29rOicgKyBldmVudFxuICAgIHRoaXMub2JzZXJ2ZXIuZW1pdChldmVudClcbiAgICB0aGlzLmVtaXR0ZXIuZW1pdChldmVudClcbn1cblxuLyoqXG4gKiAgQ2hlY2sgaWYgYSBjb21waWxlcidzIGRhdGEgY29udGFpbnMgYSBrZXlwYXRoXG4gKi9cbkNvbXBpbGVyUHJvdG8uaGFzS2V5ID0gZnVuY3Rpb24gKGtleSkge1xuICAgIHZhciBiYXNlS2V5ID0gdXRpbHMuYmFzZUtleShrZXkpXG4gICAgcmV0dXJuIGhhc093bi5jYWxsKHRoaXMuZGF0YSwgYmFzZUtleSkgfHxcbiAgICAgICAgaGFzT3duLmNhbGwodGhpcy52bSwgYmFzZUtleSlcbn1cblxuLyoqXG4gKiAgRG8gYSBvbmUtdGltZSBldmFsIG9mIGEgc3RyaW5nIHRoYXQgcG90ZW50aWFsbHlcbiAqICBpbmNsdWRlcyBiaW5kaW5ncy4gSXQgYWNjZXB0cyBhZGRpdGlvbmFsIHJhdyBkYXRhXG4gKiAgYmVjYXVzZSB3ZSBuZWVkIHRvIGR5bmFtaWNhbGx5IHJlc29sdmUgdi1jb21wb25lbnRcbiAqICBiZWZvcmUgYSBjaGlsZFZNIGlzIGV2ZW4gY29tcGlsZWQuLi5cbiAqL1xuQ29tcGlsZXJQcm90by5ldmFsID0gZnVuY3Rpb24gKGV4cCwgZGF0YSkge1xuICAgIHZhciBwYXJzZWQgPSBUZXh0UGFyc2VyLnBhcnNlQXR0cihleHApXG4gICAgcmV0dXJuIHBhcnNlZFxuICAgICAgICA/IEV4cFBhcnNlci5ldmFsKHBhcnNlZCwgdGhpcywgZGF0YSlcbiAgICAgICAgOiBleHBcbn1cblxuLyoqXG4gKiAgUmVzb2x2ZSBhIENvbXBvbmVudCBjb25zdHJ1Y3RvciBmb3IgYW4gZWxlbWVudFxuICogIHdpdGggdGhlIGRhdGEgdG8gYmUgdXNlZFxuICovXG5Db21waWxlclByb3RvLnJlc29sdmVDb21wb25lbnQgPSBmdW5jdGlvbiAobm9kZSwgZGF0YSwgdGVzdCkge1xuXG4gICAgLy8gbGF0ZSByZXF1aXJlIHRvIGF2b2lkIGNpcmN1bGFyIGRlcHNcbiAgICBWaWV3TW9kZWwgPSBWaWV3TW9kZWwgfHwgcmVxdWlyZSgnLi92aWV3bW9kZWwnKVxuXG4gICAgdmFyIGV4cCAgICAgPSB1dGlscy5hdHRyKG5vZGUsICdjb21wb25lbnQnKSxcbiAgICAgICAgdGFnTmFtZSA9IG5vZGUudGFnTmFtZSxcbiAgICAgICAgaWQgICAgICA9IHRoaXMuZXZhbChleHAsIGRhdGEpLFxuICAgICAgICB0YWdJZCAgID0gKHRhZ05hbWUuaW5kZXhPZignLScpID4gMCAmJiB0YWdOYW1lLnRvTG93ZXJDYXNlKCkpLFxuICAgICAgICBDdG9yICAgID0gdGhpcy5nZXRPcHRpb24oJ2NvbXBvbmVudHMnLCBpZCB8fCB0YWdJZCwgdHJ1ZSlcblxuICAgIGlmIChpZCAmJiAhQ3Rvcikge1xuICAgICAgICB1dGlscy53YXJuKCdVbmtub3duIGNvbXBvbmVudDogJyArIGlkKVxuICAgIH1cblxuICAgIHJldHVybiB0ZXN0XG4gICAgICAgID8gZXhwID09PSAnJ1xuICAgICAgICAgICAgPyBWaWV3TW9kZWxcbiAgICAgICAgICAgIDogQ3RvclxuICAgICAgICA6IEN0b3IgfHwgVmlld01vZGVsXG59XG5cbi8qKlxuICogIFVuYmluZCBhbmQgcmVtb3ZlIGVsZW1lbnRcbiAqL1xuQ29tcGlsZXJQcm90by5kZXN0cm95ID0gZnVuY3Rpb24gKCkge1xuXG4gICAgLy8gYXZvaWQgYmVpbmcgY2FsbGVkIG1vcmUgdGhhbiBvbmNlXG4gICAgLy8gdGhpcyBpcyBpcnJldmVyc2libGUhXG4gICAgaWYgKHRoaXMuZGVzdHJveWVkKSByZXR1cm5cblxuICAgIHZhciBjb21waWxlciA9IHRoaXMsXG4gICAgICAgIGksIGtleSwgZGlyLCBkaXJzLCBiaW5kaW5nLFxuICAgICAgICB2bSAgICAgICAgICA9IGNvbXBpbGVyLnZtLFxuICAgICAgICBlbCAgICAgICAgICA9IGNvbXBpbGVyLmVsLFxuICAgICAgICBkaXJlY3RpdmVzICA9IGNvbXBpbGVyLmRpcnMsXG4gICAgICAgIGNvbXB1dGVkICAgID0gY29tcGlsZXIuY29tcHV0ZWQsXG4gICAgICAgIGJpbmRpbmdzICAgID0gY29tcGlsZXIuYmluZGluZ3MsXG4gICAgICAgIGNoaWxkcmVuICAgID0gY29tcGlsZXIuY2hpbGRyZW4sXG4gICAgICAgIHBhcmVudCAgICAgID0gY29tcGlsZXIucGFyZW50XG5cbiAgICBjb21waWxlci5leGVjSG9vaygnYmVmb3JlRGVzdHJveScpXG5cbiAgICAvLyB1bm9ic2VydmUgZGF0YVxuICAgIE9ic2VydmVyLnVub2JzZXJ2ZShjb21waWxlci5kYXRhLCAnJywgY29tcGlsZXIub2JzZXJ2ZXIpXG5cbiAgICAvLyB1bmJpbmQgYWxsIGRpcmVjaXR2ZXNcbiAgICBpID0gZGlyZWN0aXZlcy5sZW5ndGhcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIGRpciA9IGRpcmVjdGl2ZXNbaV1cbiAgICAgICAgLy8gaWYgdGhpcyBkaXJlY3RpdmUgaXMgYW4gaW5zdGFuY2Ugb2YgYW4gZXh0ZXJuYWwgYmluZGluZ1xuICAgICAgICAvLyBlLmcuIGEgZGlyZWN0aXZlIHRoYXQgcmVmZXJzIHRvIGEgdmFyaWFibGUgb24gdGhlIHBhcmVudCBWTVxuICAgICAgICAvLyB3ZSBuZWVkIHRvIHJlbW92ZSBpdCBmcm9tIHRoYXQgYmluZGluZydzIGRpcmVjdGl2ZXNcbiAgICAgICAgLy8gKiBlbXB0eSBhbmQgbGl0ZXJhbCBiaW5kaW5ncyBkbyBub3QgaGF2ZSBiaW5kaW5nLlxuICAgICAgICBpZiAoZGlyLmJpbmRpbmcgJiYgZGlyLmJpbmRpbmcuY29tcGlsZXIgIT09IGNvbXBpbGVyKSB7XG4gICAgICAgICAgICBkaXJzID0gZGlyLmJpbmRpbmcuZGlyc1xuICAgICAgICAgICAgaWYgKGRpcnMpIGRpcnMuc3BsaWNlKGRpcnMuaW5kZXhPZihkaXIpLCAxKVxuICAgICAgICB9XG4gICAgICAgIGRpci51bmJpbmQoKVxuICAgIH1cblxuICAgIC8vIHVuYmluZCBhbGwgY29tcHV0ZWQsIGFub255bW91cyBiaW5kaW5nc1xuICAgIGkgPSBjb21wdXRlZC5sZW5ndGhcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIGNvbXB1dGVkW2ldLnVuYmluZCgpXG4gICAgfVxuXG4gICAgLy8gdW5iaW5kIGFsbCBrZXlwYXRoIGJpbmRpbmdzXG4gICAgZm9yIChrZXkgaW4gYmluZGluZ3MpIHtcbiAgICAgICAgYmluZGluZyA9IGJpbmRpbmdzW2tleV1cbiAgICAgICAgaWYgKGJpbmRpbmcpIHtcbiAgICAgICAgICAgIGJpbmRpbmcudW5iaW5kKClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGRlc3Ryb3kgYWxsIGNoaWxkcmVuXG4gICAgaSA9IGNoaWxkcmVuLmxlbmd0aFxuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgY2hpbGRyZW5baV0uZGVzdHJveSgpXG4gICAgfVxuXG4gICAgLy8gcmVtb3ZlIHNlbGYgZnJvbSBwYXJlbnRcbiAgICBpZiAocGFyZW50KSB7XG4gICAgICAgIHBhcmVudC5jaGlsZHJlbi5zcGxpY2UocGFyZW50LmNoaWxkcmVuLmluZGV4T2YoY29tcGlsZXIpLCAxKVxuICAgIH1cblxuICAgIC8vIGZpbmFsbHkgcmVtb3ZlIGRvbSBlbGVtZW50XG4gICAgaWYgKGVsID09PSBkb2N1bWVudC5ib2R5KSB7XG4gICAgICAgIGVsLmlubmVySFRNTCA9ICcnXG4gICAgfSBlbHNlIHtcbiAgICAgICAgdm0uJHJlbW92ZSgpXG4gICAgfVxuICAgIGVsLnZ1ZV92bSA9IG51bGxcblxuICAgIGNvbXBpbGVyLmRlc3Ryb3llZCA9IHRydWVcbiAgICAvLyBlbWl0IGRlc3Ryb3kgaG9va1xuICAgIGNvbXBpbGVyLmV4ZWNIb29rKCdhZnRlckRlc3Ryb3knKVxuXG4gICAgLy8gZmluYWxseSwgdW5yZWdpc3RlciBhbGwgbGlzdGVuZXJzXG4gICAgY29tcGlsZXIub2JzZXJ2ZXIub2ZmKClcbiAgICBjb21waWxlci5lbWl0dGVyLm9mZigpXG59XG5cbi8vIEhlbHBlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiAgc2hvcnRoYW5kIGZvciBnZXR0aW5nIHJvb3QgY29tcGlsZXJcbiAqL1xuZnVuY3Rpb24gZ2V0Um9vdCAoY29tcGlsZXIpIHtcbiAgICB3aGlsZSAoY29tcGlsZXIucGFyZW50KSB7XG4gICAgICAgIGNvbXBpbGVyID0gY29tcGlsZXIucGFyZW50XG4gICAgfVxuICAgIHJldHVybiBjb21waWxlclxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IENvbXBpbGVyIiwidmFyIFRleHRQYXJzZXIgPSByZXF1aXJlKCcuL3RleHQtcGFyc2VyJylcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgcHJlZml4ICAgICAgICAgOiAndicsXG4gICAgZGVidWcgICAgICAgICAgOiBmYWxzZSxcbiAgICBzaWxlbnQgICAgICAgICA6IGZhbHNlLFxuICAgIGVudGVyQ2xhc3MgICAgIDogJ3YtZW50ZXInLFxuICAgIGxlYXZlQ2xhc3MgICAgIDogJ3YtbGVhdmUnLFxuICAgIGludGVycG9sYXRlICAgIDogdHJ1ZVxufVxuXG5PYmplY3QuZGVmaW5lUHJvcGVydHkobW9kdWxlLmV4cG9ydHMsICdkZWxpbWl0ZXJzJywge1xuICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gVGV4dFBhcnNlci5kZWxpbWl0ZXJzXG4gICAgfSxcbiAgICBzZXQ6IGZ1bmN0aW9uIChkZWxpbWl0ZXJzKSB7XG4gICAgICAgIFRleHRQYXJzZXIuc2V0RGVsaW1pdGVycyhkZWxpbWl0ZXJzKVxuICAgIH1cbn0pIiwidmFyIEVtaXR0ZXIgID0gcmVxdWlyZSgnLi9lbWl0dGVyJyksXG4gICAgdXRpbHMgICAgPSByZXF1aXJlKCcuL3V0aWxzJyksXG4gICAgT2JzZXJ2ZXIgPSByZXF1aXJlKCcuL29ic2VydmVyJyksXG4gICAgY2F0Y2hlciAgPSBuZXcgRW1pdHRlcigpXG5cbi8qKlxuICogIEF1dG8tZXh0cmFjdCB0aGUgZGVwZW5kZW5jaWVzIG9mIGEgY29tcHV0ZWQgcHJvcGVydHlcbiAqICBieSByZWNvcmRpbmcgdGhlIGdldHRlcnMgdHJpZ2dlcmVkIHdoZW4gZXZhbHVhdGluZyBpdC5cbiAqL1xuZnVuY3Rpb24gY2F0Y2hEZXBzIChiaW5kaW5nKSB7XG4gICAgaWYgKGJpbmRpbmcuaXNGbikgcmV0dXJuXG4gICAgdXRpbHMubG9nKCdcXG4tICcgKyBiaW5kaW5nLmtleSlcbiAgICB2YXIgZ290ID0gdXRpbHMuaGFzaCgpXG4gICAgYmluZGluZy5kZXBzID0gW11cbiAgICBjYXRjaGVyLm9uKCdnZXQnLCBmdW5jdGlvbiAoZGVwKSB7XG4gICAgICAgIHZhciBoYXMgPSBnb3RbZGVwLmtleV1cbiAgICAgICAgaWYgKFxuICAgICAgICAgICAgLy8gYXZvaWQgZHVwbGljYXRlIGJpbmRpbmdzXG4gICAgICAgICAgICAoaGFzICYmIGhhcy5jb21waWxlciA9PT0gZGVwLmNvbXBpbGVyKSB8fFxuICAgICAgICAgICAgLy8gYXZvaWQgcmVwZWF0ZWQgaXRlbXMgYXMgZGVwZW5kZW5jeVxuICAgICAgICAgICAgLy8gc2luY2UgYWxsIGluc2lkZSBjaGFuZ2VzIHRyaWdnZXIgYXJyYXkgY2hhbmdlIHRvb1xuICAgICAgICAgICAgKGRlcC5jb21waWxlci5yZXBlYXQgJiYgZGVwLmNvbXBpbGVyLnBhcmVudCA9PT0gYmluZGluZy5jb21waWxlcilcbiAgICAgICAgKSB7XG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICBnb3RbZGVwLmtleV0gPSBkZXBcbiAgICAgICAgdXRpbHMubG9nKCcgIC0gJyArIGRlcC5rZXkpXG4gICAgICAgIGJpbmRpbmcuZGVwcy5wdXNoKGRlcClcbiAgICAgICAgZGVwLnN1YnMucHVzaChiaW5kaW5nKVxuICAgIH0pXG4gICAgYmluZGluZy52YWx1ZS4kZ2V0KClcbiAgICBjYXRjaGVyLm9mZignZ2V0Jylcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICAvKipcbiAgICAgKiAgdGhlIG9ic2VydmVyIHRoYXQgY2F0Y2hlcyBldmVudHMgdHJpZ2dlcmVkIGJ5IGdldHRlcnNcbiAgICAgKi9cbiAgICBjYXRjaGVyOiBjYXRjaGVyLFxuXG4gICAgLyoqXG4gICAgICogIHBhcnNlIGEgbGlzdCBvZiBjb21wdXRlZCBwcm9wZXJ0eSBiaW5kaW5nc1xuICAgICAqL1xuICAgIHBhcnNlOiBmdW5jdGlvbiAoYmluZGluZ3MpIHtcbiAgICAgICAgdXRpbHMubG9nKCdcXG5wYXJzaW5nIGRlcGVuZGVuY2llcy4uLicpXG4gICAgICAgIE9ic2VydmVyLnNob3VsZEdldCA9IHRydWVcbiAgICAgICAgYmluZGluZ3MuZm9yRWFjaChjYXRjaERlcHMpXG4gICAgICAgIE9ic2VydmVyLnNob3VsZEdldCA9IGZhbHNlXG4gICAgICAgIHV0aWxzLmxvZygnXFxuZG9uZS4nKVxuICAgIH1cbiAgICBcbn0iLCJ2YXIgdXRpbHMgICAgICA9IHJlcXVpcmUoJy4vdXRpbHMnKSxcbiAgICBkaXJJZCAgICAgID0gMSxcblxuICAgIC8vIFJlZ2V4ZXMhXG4gICAgLy8gcmVnZXggdG8gc3BsaXQgbXVsdGlwbGUgZGlyZWN0aXZlIGV4cHJlc3Npb25zXG4gICAgLy8gc3BsaXQgYnkgY29tbWFzLCBidXQgaWdub3JlIGNvbW1hcyB3aXRoaW4gcXVvdGVzLCBwYXJlbnMgYW5kIGVzY2FwZXMuXG4gICAgU1BMSVRfUkUgICAgICAgID0gLyg/OlsnXCJdKD86XFxcXC58W14nXCJdKSpbJ1wiXXxcXCgoPzpcXFxcLnxbXlxcKV0pKlxcKXxcXFxcLnxbXixdKSsvZyxcbiAgICAvLyBtYXRjaCB1cCB0byB0aGUgZmlyc3Qgc2luZ2xlIHBpcGUsIGlnbm9yZSB0aG9zZSB3aXRoaW4gcXVvdGVzLlxuICAgIEtFWV9SRSAgICAgICAgICA9IC9eKD86WydcIl0oPzpcXFxcLnxbXidcIl0pKlsnXCJdfFxcXFwufFteXFx8XXxcXHxcXHwpKy8sXG4gICAgQVJHX1JFICAgICAgICAgID0gL14oW1xcdy0kIF0rKTooLispJC8sXG4gICAgRklMVEVSU19SRSAgICAgID0gL1xcfFteXFx8XSsvZyxcbiAgICBGSUxURVJfVE9LRU5fUkUgPSAvW15cXHMnXSt8J1teJ10rJ3xbXlxcc1wiXSt8XCJbXlwiXStcIi9nLFxuICAgIE5FU1RJTkdfUkUgICAgICA9IC9eXFwkKHBhcmVudHxyb290KVxcLi8sXG4gICAgU0lOR0xFX1ZBUl9SRSAgID0gL15bXFx3XFwuJF0rJC8sXG4gICAgUVVPVEVfUkUgICAgICAgID0gL1wiL2dcblxuLyoqXG4gKiAgRGlyZWN0aXZlIGNsYXNzXG4gKiAgcmVwcmVzZW50cyBhIHNpbmdsZSBkaXJlY3RpdmUgaW5zdGFuY2UgaW4gdGhlIERPTVxuICovXG5mdW5jdGlvbiBEaXJlY3RpdmUgKGRpcm5hbWUsIGRlZmluaXRpb24sIGV4cHJlc3Npb24sIHJhd0tleSwgY29tcGlsZXIsIG5vZGUpIHtcblxuICAgIHRoaXMuaWQgICAgICAgICAgICAgPSBkaXJJZCsrXG4gICAgdGhpcy5uYW1lICAgICAgICAgICA9IGRpcm5hbWVcbiAgICB0aGlzLmNvbXBpbGVyICAgICAgID0gY29tcGlsZXJcbiAgICB0aGlzLnZtICAgICAgICAgICAgID0gY29tcGlsZXIudm1cbiAgICB0aGlzLmVsICAgICAgICAgICAgID0gbm9kZVxuICAgIHRoaXMuY29tcHV0ZUZpbHRlcnMgPSBmYWxzZVxuXG4gICAgdmFyIGlzRW1wdHkgICA9IGV4cHJlc3Npb24gPT09ICcnXG5cbiAgICAvLyBtaXggaW4gcHJvcGVydGllcyBmcm9tIHRoZSBkaXJlY3RpdmUgZGVmaW5pdGlvblxuICAgIGlmICh0eXBlb2YgZGVmaW5pdGlvbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aGlzW2lzRW1wdHkgPyAnYmluZCcgOiAnX3VwZGF0ZSddID0gZGVmaW5pdGlvblxuICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAodmFyIHByb3AgaW4gZGVmaW5pdGlvbikge1xuICAgICAgICAgICAgaWYgKHByb3AgPT09ICd1bmJpbmQnIHx8IHByb3AgPT09ICd1cGRhdGUnKSB7XG4gICAgICAgICAgICAgICAgdGhpc1snXycgKyBwcm9wXSA9IGRlZmluaXRpb25bcHJvcF1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpc1twcm9wXSA9IGRlZmluaXRpb25bcHJvcF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGVtcHR5IGV4cHJlc3Npb24sIHdlJ3JlIGRvbmUuXG4gICAgaWYgKGlzRW1wdHkgfHwgdGhpcy5pc0VtcHR5KSB7XG4gICAgICAgIHRoaXMuaXNFbXB0eSA9IHRydWVcbiAgICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5leHByZXNzaW9uID0gKFxuICAgICAgICB0aGlzLmlzTGl0ZXJhbFxuICAgICAgICAgICAgPyBjb21waWxlci5ldmFsKGV4cHJlc3Npb24pXG4gICAgICAgICAgICA6IGV4cHJlc3Npb25cbiAgICApLnRyaW0oKVxuICAgIFxuICAgIHZhciBwYXJzZWQgPSBEaXJlY3RpdmUucGFyc2VBcmcocmF3S2V5KVxuICAgIHRoaXMua2V5ID0gcGFyc2VkLmtleVxuICAgIHRoaXMuYXJnID0gcGFyc2VkLmFyZ1xuICAgIFxuICAgIHZhciBmaWx0ZXJzID0gRGlyZWN0aXZlLnBhcnNlRmlsdGVycyh0aGlzLmV4cHJlc3Npb24uc2xpY2UocmF3S2V5Lmxlbmd0aCkpLFxuICAgICAgICBmaWx0ZXIsIGZuLCBpLCBsLCBjb21wdXRlZFxuICAgIGlmIChmaWx0ZXJzKSB7XG4gICAgICAgIHRoaXMuZmlsdGVycyA9IFtdXG4gICAgICAgIGZvciAoaSA9IDAsIGwgPSBmaWx0ZXJzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICAgICAgZmlsdGVyID0gZmlsdGVyc1tpXVxuICAgICAgICAgICAgZm4gPSB0aGlzLmNvbXBpbGVyLmdldE9wdGlvbignZmlsdGVycycsIGZpbHRlci5uYW1lKVxuICAgICAgICAgICAgaWYgKGZuKSB7XG4gICAgICAgICAgICAgICAgZmlsdGVyLmFwcGx5ID0gZm5cbiAgICAgICAgICAgICAgICB0aGlzLmZpbHRlcnMucHVzaChmaWx0ZXIpXG4gICAgICAgICAgICAgICAgaWYgKGZuLmNvbXB1dGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbXB1dGVkID0gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmICghdGhpcy5maWx0ZXJzIHx8ICF0aGlzLmZpbHRlcnMubGVuZ3RoKSB7XG4gICAgICAgIHRoaXMuZmlsdGVycyA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoY29tcHV0ZWQpIHtcbiAgICAgICAgdGhpcy5jb21wdXRlZEtleSA9IERpcmVjdGl2ZS5pbmxpbmVGaWx0ZXJzKHRoaXMua2V5LCB0aGlzLmZpbHRlcnMpXG4gICAgICAgIHRoaXMuZmlsdGVycyA9IG51bGxcbiAgICB9XG5cbiAgICB0aGlzLmlzRXhwID1cbiAgICAgICAgY29tcHV0ZWQgfHxcbiAgICAgICAgIVNJTkdMRV9WQVJfUkUudGVzdCh0aGlzLmtleSkgfHxcbiAgICAgICAgTkVTVElOR19SRS50ZXN0KHRoaXMua2V5KVxuXG59XG5cbnZhciBEaXJQcm90byA9IERpcmVjdGl2ZS5wcm90b3R5cGVcblxuLyoqXG4gKiAgY2FsbGVkIHdoZW4gYSBuZXcgdmFsdWUgaXMgc2V0IFxuICogIGZvciBjb21wdXRlZCBwcm9wZXJ0aWVzLCB0aGlzIHdpbGwgb25seSBiZSBjYWxsZWQgb25jZVxuICogIGR1cmluZyBpbml0aWFsaXphdGlvbi5cbiAqL1xuRGlyUHJvdG8udXBkYXRlID0gZnVuY3Rpb24gKHZhbHVlLCBpbml0KSB7XG4gICAgaWYgKGluaXQgfHwgdmFsdWUgIT09IHRoaXMudmFsdWUgfHwgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpKSB7XG4gICAgICAgIHRoaXMudmFsdWUgPSB2YWx1ZVxuICAgICAgICBpZiAodGhpcy5fdXBkYXRlKSB7XG4gICAgICAgICAgICB0aGlzLl91cGRhdGUoXG4gICAgICAgICAgICAgICAgdGhpcy5maWx0ZXJzICYmICF0aGlzLmNvbXB1dGVGaWx0ZXJzXG4gICAgICAgICAgICAgICAgICAgID8gdGhpcy5hcHBseUZpbHRlcnModmFsdWUpXG4gICAgICAgICAgICAgICAgICAgIDogdmFsdWUsXG4gICAgICAgICAgICAgICAgaW5pdFxuICAgICAgICAgICAgKVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqICBwaXBlIHRoZSB2YWx1ZSB0aHJvdWdoIGZpbHRlcnNcbiAqL1xuRGlyUHJvdG8uYXBwbHlGaWx0ZXJzID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgdmFyIGZpbHRlcmVkID0gdmFsdWUsIGZpbHRlclxuICAgIGZvciAodmFyIGkgPSAwLCBsID0gdGhpcy5maWx0ZXJzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBmaWx0ZXIgPSB0aGlzLmZpbHRlcnNbaV1cbiAgICAgICAgZmlsdGVyZWQgPSBmaWx0ZXIuYXBwbHkuYXBwbHkodGhpcy52bSwgW2ZpbHRlcmVkXS5jb25jYXQoZmlsdGVyLmFyZ3MpKVxuICAgIH1cbiAgICByZXR1cm4gZmlsdGVyZWRcbn1cblxuLyoqXG4gKiAgVW5iaW5kIGRpcmV0aXZlXG4gKi9cbkRpclByb3RvLnVuYmluZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAvLyB0aGlzIGNhbiBiZSBjYWxsZWQgYmVmb3JlIHRoZSBlbCBpcyBldmVuIGFzc2lnbmVkLi4uXG4gICAgaWYgKCF0aGlzLmVsIHx8ICF0aGlzLnZtKSByZXR1cm5cbiAgICBpZiAodGhpcy5fdW5iaW5kKSB0aGlzLl91bmJpbmQoKVxuICAgIHRoaXMudm0gPSB0aGlzLmVsID0gdGhpcy5iaW5kaW5nID0gdGhpcy5jb21waWxlciA9IG51bGxcbn1cblxuLy8gRXhwb3NlZCBzdGF0aWMgbWV0aG9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqICBzcGxpdCBhIHVucXVvdGVkLWNvbW1hIHNlcGFyYXRlZCBleHByZXNzaW9uIGludG9cbiAqICBtdWx0aXBsZSBjbGF1c2VzXG4gKi9cbkRpcmVjdGl2ZS5zcGxpdCA9IGZ1bmN0aW9uIChleHApIHtcbiAgICByZXR1cm4gZXhwLmluZGV4T2YoJywnKSA+IC0xXG4gICAgICAgID8gZXhwLm1hdGNoKFNQTElUX1JFKSB8fCBbJyddXG4gICAgICAgIDogW2V4cF1cbn1cblxuLyoqXG4gKiAgcGFyc2UgYSBrZXksIGV4dHJhY3QgYXJndW1lbnRcbiAqL1xuRGlyZWN0aXZlLnBhcnNlQXJnID0gZnVuY3Rpb24gKHJhd0tleSkge1xuICAgIHZhciBrZXkgPSByYXdLZXksXG4gICAgICAgIGFyZyA9IG51bGxcbiAgICBpZiAocmF3S2V5LmluZGV4T2YoJzonKSA+IC0xKSB7XG4gICAgICAgIHZhciBhcmdNYXRjaCA9IHJhd0tleS5tYXRjaChBUkdfUkUpXG4gICAgICAgIGtleSA9IGFyZ01hdGNoXG4gICAgICAgICAgICA/IGFyZ01hdGNoWzJdLnRyaW0oKVxuICAgICAgICAgICAgOiBrZXlcbiAgICAgICAgYXJnID0gYXJnTWF0Y2hcbiAgICAgICAgICAgID8gYXJnTWF0Y2hbMV0udHJpbSgpXG4gICAgICAgICAgICA6IGFyZ1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICBrZXk6IGtleSxcbiAgICAgICAgYXJnOiBhcmdcbiAgICB9XG59XG5cbi8qKlxuICogIHBhcnNlIGEgdGhlIGZpbHRlcnNcbiAqL1xuRGlyZWN0aXZlLnBhcnNlRmlsdGVycyA9IGZ1bmN0aW9uIChleHApIHtcbiAgICBpZiAoZXhwLmluZGV4T2YoJ3wnKSA8IDApIHtcbiAgICAgICAgcmV0dXJuXG4gICAgfVxuICAgIHZhciBmaWx0ZXJzID0gZXhwLm1hdGNoKEZJTFRFUlNfUkUpLFxuICAgICAgICByZXMsIGksIGwsIHRva2Vuc1xuICAgIGlmIChmaWx0ZXJzKSB7XG4gICAgICAgIHJlcyA9IFtdXG4gICAgICAgIGZvciAoaSA9IDAsIGwgPSBmaWx0ZXJzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICAgICAgdG9rZW5zID0gZmlsdGVyc1tpXS5zbGljZSgxKS5tYXRjaChGSUxURVJfVE9LRU5fUkUpXG4gICAgICAgICAgICBpZiAodG9rZW5zKSB7XG4gICAgICAgICAgICAgICAgcmVzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiB0b2tlbnNbMF0sXG4gICAgICAgICAgICAgICAgICAgIGFyZ3M6IHRva2Vucy5sZW5ndGggPiAxXG4gICAgICAgICAgICAgICAgICAgICAgICA/IHRva2Vucy5zbGljZSgxKVxuICAgICAgICAgICAgICAgICAgICAgICAgOiBudWxsXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzXG59XG5cbi8qKlxuICogIElubGluZSBjb21wdXRlZCBmaWx0ZXJzIHNvIHRoZXkgYmVjb21lIHBhcnRcbiAqICBvZiB0aGUgZXhwcmVzc2lvblxuICovXG5EaXJlY3RpdmUuaW5saW5lRmlsdGVycyA9IGZ1bmN0aW9uIChrZXksIGZpbHRlcnMpIHtcbiAgICB2YXIgYXJncywgZmlsdGVyXG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBmaWx0ZXJzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBmaWx0ZXIgPSBmaWx0ZXJzW2ldXG4gICAgICAgIGFyZ3MgPSBmaWx0ZXIuYXJnc1xuICAgICAgICAgICAgPyAnLFwiJyArIGZpbHRlci5hcmdzLm1hcChlc2NhcGVRdW90ZSkuam9pbignXCIsXCInKSArICdcIidcbiAgICAgICAgICAgIDogJydcbiAgICAgICAga2V5ID0gJ3RoaXMuJGNvbXBpbGVyLmdldE9wdGlvbihcImZpbHRlcnNcIiwgXCInICtcbiAgICAgICAgICAgICAgICBmaWx0ZXIubmFtZSArXG4gICAgICAgICAgICAnXCIpLmNhbGwodGhpcywnICtcbiAgICAgICAgICAgICAgICBrZXkgKyBhcmdzICtcbiAgICAgICAgICAgICcpJ1xuICAgIH1cbiAgICByZXR1cm4ga2V5XG59XG5cbi8qKlxuICogIENvbnZlcnQgZG91YmxlIHF1b3RlcyB0byBzaW5nbGUgcXVvdGVzXG4gKiAgc28gdGhleSBkb24ndCBtZXNzIHVwIHRoZSBnZW5lcmF0ZWQgZnVuY3Rpb24gYm9keVxuICovXG5mdW5jdGlvbiBlc2NhcGVRdW90ZSAodikge1xuICAgIHJldHVybiB2LmluZGV4T2YoJ1wiJykgPiAtMVxuICAgICAgICA/IHYucmVwbGFjZShRVU9URV9SRSwgJ1xcJycpXG4gICAgICAgIDogdlxufVxuXG4vKipcbiAqICBQYXJzZSB0aGUga2V5IGZyb20gYSBkaXJlY3RpdmUgcmF3IGV4cHJlc3Npb25cbiAqL1xuRGlyZWN0aXZlLnBhcnNlS2V5ID0gZnVuY3Rpb24gKGV4cHJlc3Npb24pIHtcbiAgICBpZiAoZXhwcmVzc2lvbi5pbmRleE9mKCd8JykgPiAtMSkge1xuICAgICAgICB2YXIga2V5TWF0Y2ggPSBleHByZXNzaW9uLm1hdGNoKEtFWV9SRSlcbiAgICAgICAgaWYgKGtleU1hdGNoKSB7XG4gICAgICAgICAgICByZXR1cm4ga2V5TWF0Y2hbMF0udHJpbSgpXG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gZXhwcmVzc2lvbi50cmltKClcbiAgICB9XG59XG5cbi8qKlxuICogIG1ha2Ugc3VyZSB0aGUgZGlyZWN0aXZlIGFuZCBleHByZXNzaW9uIGlzIHZhbGlkXG4gKiAgYmVmb3JlIHdlIGNyZWF0ZSBhbiBpbnN0YW5jZVxuICovXG5EaXJlY3RpdmUuYnVpbGQgPSBmdW5jdGlvbiAoZGlybmFtZSwgZXhwcmVzc2lvbiwgY29tcGlsZXIsIG5vZGUpIHtcblxuICAgIHZhciBkaXIgPSBjb21waWxlci5nZXRPcHRpb24oJ2RpcmVjdGl2ZXMnLCBkaXJuYW1lKVxuICAgIGlmICghZGlyKSByZXR1cm5cblxuICAgIHZhciByYXdLZXkgPSBEaXJlY3RpdmUucGFyc2VLZXkoZXhwcmVzc2lvbilcbiAgICAvLyBoYXZlIGEgdmFsaWQgcmF3IGtleSwgb3IgYmUgYW4gZW1wdHkgZGlyZWN0aXZlXG4gICAgaWYgKHJhd0tleSB8fCBleHByZXNzaW9uID09PSAnJykge1xuICAgICAgICByZXR1cm4gbmV3IERpcmVjdGl2ZShkaXJuYW1lLCBkaXIsIGV4cHJlc3Npb24sIHJhd0tleSwgY29tcGlsZXIsIG5vZGUpXG4gICAgfSBlbHNlIHtcbiAgICAgICAgdXRpbHMud2FybignSW52YWxpZCBkaXJlY3RpdmUgZXhwcmVzc2lvbjogJyArIGV4cHJlc3Npb24pXG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IERpcmVjdGl2ZSIsInZhciBndWFyZCA9IHJlcXVpcmUoJy4uL3V0aWxzJykuZ3VhcmQsXG4gICAgc2xpY2UgPSBbXS5zbGljZVxuXG4vKipcbiAqICBCaW5kaW5nIGZvciBpbm5lckhUTUxcbiAqL1xubW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICBiaW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIGEgY29tbWVudCBub2RlIG1lYW5zIHRoaXMgaXMgYSBiaW5kaW5nIGZvclxuICAgICAgICAvLyB7e3sgaW5saW5lIHVuZXNjYXBlZCBodG1sIH19fVxuICAgICAgICBpZiAodGhpcy5lbC5ub2RlVHlwZSA9PT0gOCkge1xuICAgICAgICAgICAgLy8gaG9sZCBub2Rlc1xuICAgICAgICAgICAgdGhpcy5ob2xkZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKVxuICAgICAgICAgICAgdGhpcy5ub2RlcyA9IFtdXG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgdmFsdWUgPSBndWFyZCh2YWx1ZSlcbiAgICAgICAgaWYgKHRoaXMuaG9sZGVyKSB7XG4gICAgICAgICAgICB0aGlzLnN3YXAodmFsdWUpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmVsLmlubmVySFRNTCA9IHZhbHVlXG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgc3dhcDogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgIHZhciBwYXJlbnQgPSB0aGlzLmVsLnBhcmVudE5vZGUsXG4gICAgICAgICAgICBob2xkZXIgPSB0aGlzLmhvbGRlcixcbiAgICAgICAgICAgIG5vZGVzID0gdGhpcy5ub2RlcyxcbiAgICAgICAgICAgIGkgPSBub2Rlcy5sZW5ndGgsIGxcbiAgICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICAgICAgcGFyZW50LnJlbW92ZUNoaWxkKG5vZGVzW2ldKVxuICAgICAgICB9XG4gICAgICAgIGhvbGRlci5pbm5lckhUTUwgPSB2YWx1ZVxuICAgICAgICBub2RlcyA9IHRoaXMubm9kZXMgPSBzbGljZS5jYWxsKGhvbGRlci5jaGlsZE5vZGVzKVxuICAgICAgICBmb3IgKGkgPSAwLCBsID0gbm9kZXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKG5vZGVzW2ldLCB0aGlzLmVsKVxuICAgICAgICB9XG4gICAgfVxufSIsInZhciB1dGlscyAgICA9IHJlcXVpcmUoJy4uL3V0aWxzJylcblxuLyoqXG4gKiAgTWFuYWdlcyBhIGNvbmRpdGlvbmFsIGNoaWxkIFZNXG4gKi9cbm1vZHVsZS5leHBvcnRzID0ge1xuXG4gICAgYmluZDogZnVuY3Rpb24gKCkge1xuICAgICAgICBcbiAgICAgICAgdGhpcy5wYXJlbnQgPSB0aGlzLmVsLnBhcmVudE5vZGVcbiAgICAgICAgdGhpcy5yZWYgICAgPSBkb2N1bWVudC5jcmVhdGVDb21tZW50KCd2dWUtaWYnKVxuICAgICAgICB0aGlzLkN0b3IgICA9IHRoaXMuY29tcGlsZXIucmVzb2x2ZUNvbXBvbmVudCh0aGlzLmVsKVxuXG4gICAgICAgIC8vIGluc2VydCByZWZcbiAgICAgICAgdGhpcy5wYXJlbnQuaW5zZXJ0QmVmb3JlKHRoaXMucmVmLCB0aGlzLmVsKVxuICAgICAgICB0aGlzLnBhcmVudC5yZW1vdmVDaGlsZCh0aGlzLmVsKVxuXG4gICAgICAgIGlmICh1dGlscy5hdHRyKHRoaXMuZWwsICd2aWV3JykpIHtcbiAgICAgICAgICAgIHV0aWxzLndhcm4oXG4gICAgICAgICAgICAgICAgJ0NvbmZsaWN0OiB2LWlmIGNhbm5vdCBiZSB1c2VkIHRvZ2V0aGVyIHdpdGggdi12aWV3LiAnICtcbiAgICAgICAgICAgICAgICAnSnVzdCBzZXQgdi12aWV3XFwncyBiaW5kaW5nIHZhbHVlIHRvIGVtcHR5IHN0cmluZyB0byBlbXB0eSBpdC4nXG4gICAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHV0aWxzLmF0dHIodGhpcy5lbCwgJ3JlcGVhdCcpKSB7XG4gICAgICAgICAgICB1dGlscy53YXJuKFxuICAgICAgICAgICAgICAgICdDb25mbGljdDogdi1pZiBjYW5ub3QgYmUgdXNlZCB0b2dldGhlciB3aXRoIHYtcmVwZWF0LiAnICtcbiAgICAgICAgICAgICAgICAnVXNlIGB2LXNob3dgIG9yIHRoZSBgZmlsdGVyQnlgIGZpbHRlciBpbnN0ZWFkLidcbiAgICAgICAgICAgIClcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGU6IGZ1bmN0aW9uICh2YWx1ZSkge1xuXG4gICAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXMuX3VuYmluZCgpXG4gICAgICAgIH0gZWxzZSBpZiAoIXRoaXMuY2hpbGRWTSkge1xuICAgICAgICAgICAgdGhpcy5jaGlsZFZNID0gbmV3IHRoaXMuQ3Rvcih7XG4gICAgICAgICAgICAgICAgZWw6IHRoaXMuZWwuY2xvbmVOb2RlKHRydWUpLFxuICAgICAgICAgICAgICAgIHBhcmVudDogdGhpcy52bVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIGlmICh0aGlzLmNvbXBpbGVyLmluaXQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnBhcmVudC5pbnNlcnRCZWZvcmUodGhpcy5jaGlsZFZNLiRlbCwgdGhpcy5yZWYpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY2hpbGRWTS4kYmVmb3JlKHRoaXMucmVmKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH0sXG5cbiAgICB1bmJpbmQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHRoaXMuY2hpbGRWTSkge1xuICAgICAgICAgICAgdGhpcy5jaGlsZFZNLiRkZXN0cm95KClcbiAgICAgICAgICAgIHRoaXMuY2hpbGRWTSA9IG51bGxcbiAgICAgICAgfVxuICAgIH1cbn0iLCJ2YXIgdXRpbHMgICAgICA9IHJlcXVpcmUoJy4uL3V0aWxzJyksXG4gICAgY29uZmlnICAgICA9IHJlcXVpcmUoJy4uL2NvbmZpZycpLFxuICAgIHRyYW5zaXRpb24gPSByZXF1aXJlKCcuLi90cmFuc2l0aW9uJyksXG4gICAgZGlyZWN0aXZlcyA9IG1vZHVsZS5leHBvcnRzID0gdXRpbHMuaGFzaCgpXG5cbi8qKlxuICogIE5lc3QgYW5kIG1hbmFnZSBhIENoaWxkIFZNXG4gKi9cbmRpcmVjdGl2ZXMuY29tcG9uZW50ID0ge1xuICAgIGlzTGl0ZXJhbDogdHJ1ZSxcbiAgICBiaW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghdGhpcy5lbC52dWVfdm0pIHtcbiAgICAgICAgICAgIHRoaXMuY2hpbGRWTSA9IG5ldyB0aGlzLkN0b3Ioe1xuICAgICAgICAgICAgICAgIGVsOiB0aGlzLmVsLFxuICAgICAgICAgICAgICAgIHBhcmVudDogdGhpcy52bVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgdW5iaW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh0aGlzLmNoaWxkVk0pIHtcbiAgICAgICAgICAgIHRoaXMuY2hpbGRWTS4kZGVzdHJveSgpXG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qKlxuICogIEJpbmRpbmcgSFRNTCBhdHRyaWJ1dGVzXG4gKi9cbmRpcmVjdGl2ZXMuYXR0ciA9IHtcbiAgICBiaW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBwYXJhbXMgPSB0aGlzLnZtLiRvcHRpb25zLnBhcmFtQXR0cmlidXRlc1xuICAgICAgICB0aGlzLmlzUGFyYW0gPSBwYXJhbXMgJiYgcGFyYW1zLmluZGV4T2YodGhpcy5hcmcpID4gLTFcbiAgICB9LFxuICAgIHVwZGF0ZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgIGlmICh2YWx1ZSB8fCB2YWx1ZSA9PT0gMCkge1xuICAgICAgICAgICAgdGhpcy5lbC5zZXRBdHRyaWJ1dGUodGhpcy5hcmcsIHZhbHVlKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5lbC5yZW1vdmVBdHRyaWJ1dGUodGhpcy5hcmcpXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuaXNQYXJhbSkge1xuICAgICAgICAgICAgdGhpcy52bVt0aGlzLmFyZ10gPSB1dGlscy5jaGVja051bWJlcih2YWx1ZSlcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLyoqXG4gKiAgQmluZGluZyB0ZXh0Q29udGVudFxuICovXG5kaXJlY3RpdmVzLnRleHQgPSB7XG4gICAgYmluZDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmF0dHIgPSB0aGlzLmVsLm5vZGVUeXBlID09PSAzXG4gICAgICAgICAgICA/ICdub2RlVmFsdWUnXG4gICAgICAgICAgICA6ICd0ZXh0Q29udGVudCdcbiAgICB9LFxuICAgIHVwZGF0ZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgIHRoaXMuZWxbdGhpcy5hdHRyXSA9IHV0aWxzLmd1YXJkKHZhbHVlKVxuICAgIH1cbn1cblxuLyoqXG4gKiAgQmluZGluZyBDU1MgZGlzcGxheSBwcm9wZXJ0eVxuICovXG5kaXJlY3RpdmVzLnNob3cgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICB2YXIgZWwgPSB0aGlzLmVsLFxuICAgICAgICB0YXJnZXQgPSB2YWx1ZSA/ICcnIDogJ25vbmUnLFxuICAgICAgICBjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBlbC5zdHlsZS5kaXNwbGF5ID0gdGFyZ2V0XG4gICAgICAgIH1cbiAgICB0cmFuc2l0aW9uKGVsLCB2YWx1ZSA/IDEgOiAtMSwgY2hhbmdlLCB0aGlzLmNvbXBpbGVyKVxufVxuXG4vKipcbiAqICBCaW5kaW5nIENTUyBjbGFzc2VzXG4gKi9cbmRpcmVjdGl2ZXNbJ2NsYXNzJ10gPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICBpZiAodGhpcy5hcmcpIHtcbiAgICAgICAgdXRpbHNbdmFsdWUgPyAnYWRkQ2xhc3MnIDogJ3JlbW92ZUNsYXNzJ10odGhpcy5lbCwgdGhpcy5hcmcpXG4gICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRoaXMubGFzdFZhbCkge1xuICAgICAgICAgICAgdXRpbHMucmVtb3ZlQ2xhc3ModGhpcy5lbCwgdGhpcy5sYXN0VmFsKVxuICAgICAgICB9XG4gICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgdXRpbHMuYWRkQ2xhc3ModGhpcy5lbCwgdmFsdWUpXG4gICAgICAgICAgICB0aGlzLmxhc3RWYWwgPSB2YWx1ZVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqICBPbmx5IHJlbW92ZWQgYWZ0ZXIgdGhlIG93bmVyIFZNIGlzIHJlYWR5XG4gKi9cbmRpcmVjdGl2ZXMuY2xvYWsgPSB7XG4gICAgaXNFbXB0eTogdHJ1ZSxcbiAgICBiaW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBlbCA9IHRoaXMuZWxcbiAgICAgICAgdGhpcy5jb21waWxlci5vYnNlcnZlci5vbmNlKCdob29rOnJlYWR5JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgZWwucmVtb3ZlQXR0cmlidXRlKGNvbmZpZy5wcmVmaXggKyAnLWNsb2FrJylcbiAgICAgICAgfSlcbiAgICB9XG59XG5cbi8qKlxuICogIFN0b3JlIGEgcmVmZXJlbmNlIHRvIHNlbGYgaW4gcGFyZW50IFZNJ3MgJFxuICovXG5kaXJlY3RpdmVzLnJlZiA9IHtcbiAgICBpc0xpdGVyYWw6IHRydWUsXG4gICAgYmluZDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgaWQgPSB0aGlzLmV4cHJlc3Npb25cbiAgICAgICAgaWYgKGlkKSB7XG4gICAgICAgICAgICB0aGlzLnZtLiRwYXJlbnQuJFtpZF0gPSB0aGlzLnZtXG4gICAgICAgIH1cbiAgICB9LFxuICAgIHVuYmluZDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgaWQgPSB0aGlzLmV4cHJlc3Npb25cbiAgICAgICAgaWYgKGlkKSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy52bS4kcGFyZW50LiRbaWRdXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmRpcmVjdGl2ZXMub24gICAgICA9IHJlcXVpcmUoJy4vb24nKVxuZGlyZWN0aXZlcy5yZXBlYXQgID0gcmVxdWlyZSgnLi9yZXBlYXQnKVxuZGlyZWN0aXZlcy5tb2RlbCAgID0gcmVxdWlyZSgnLi9tb2RlbCcpXG5kaXJlY3RpdmVzWydpZiddICAgPSByZXF1aXJlKCcuL2lmJylcbmRpcmVjdGl2ZXNbJ3dpdGgnXSA9IHJlcXVpcmUoJy4vd2l0aCcpXG5kaXJlY3RpdmVzLmh0bWwgICAgPSByZXF1aXJlKCcuL2h0bWwnKVxuZGlyZWN0aXZlcy5zdHlsZSAgID0gcmVxdWlyZSgnLi9zdHlsZScpXG5kaXJlY3RpdmVzLnBhcnRpYWwgPSByZXF1aXJlKCcuL3BhcnRpYWwnKVxuZGlyZWN0aXZlcy52aWV3ICAgID0gcmVxdWlyZSgnLi92aWV3JykiLCJ2YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscycpLFxuICAgIGlzSUU5ID0gbmF2aWdhdG9yLnVzZXJBZ2VudC5pbmRleE9mKCdNU0lFIDkuMCcpID4gMCxcbiAgICBmaWx0ZXIgPSBbXS5maWx0ZXJcblxuLyoqXG4gKiAgUmV0dXJucyBhbiBhcnJheSBvZiB2YWx1ZXMgZnJvbSBhIG11bHRpcGxlIHNlbGVjdFxuICovXG5mdW5jdGlvbiBnZXRNdWx0aXBsZVNlbGVjdE9wdGlvbnMgKHNlbGVjdCkge1xuICAgIHJldHVybiBmaWx0ZXJcbiAgICAgICAgLmNhbGwoc2VsZWN0Lm9wdGlvbnMsIGZ1bmN0aW9uIChvcHRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBvcHRpb24uc2VsZWN0ZWRcbiAgICAgICAgfSlcbiAgICAgICAgLm1hcChmdW5jdGlvbiAob3B0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gb3B0aW9uLnZhbHVlIHx8IG9wdGlvbi50ZXh0XG4gICAgICAgIH0pXG59XG5cbi8qKlxuICogIFR3by13YXkgYmluZGluZyBmb3IgZm9ybSBpbnB1dCBlbGVtZW50c1xuICovXG5tb2R1bGUuZXhwb3J0cyA9IHtcblxuICAgIGJpbmQ6IGZ1bmN0aW9uICgpIHtcblxuICAgICAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgICAgICBlbCAgID0gc2VsZi5lbCxcbiAgICAgICAgICAgIHR5cGUgPSBlbC50eXBlLFxuICAgICAgICAgICAgdGFnICA9IGVsLnRhZ05hbWVcblxuICAgICAgICBzZWxmLmxvY2sgPSBmYWxzZVxuICAgICAgICBzZWxmLm93bmVyVk0gPSBzZWxmLmJpbmRpbmcuY29tcGlsZXIudm1cblxuICAgICAgICAvLyBkZXRlcm1pbmUgd2hhdCBldmVudCB0byBsaXN0ZW4gdG9cbiAgICAgICAgc2VsZi5ldmVudCA9XG4gICAgICAgICAgICAoc2VsZi5jb21waWxlci5vcHRpb25zLmxhenkgfHxcbiAgICAgICAgICAgIHRhZyA9PT0gJ1NFTEVDVCcgfHxcbiAgICAgICAgICAgIHR5cGUgPT09ICdjaGVja2JveCcgfHwgdHlwZSA9PT0gJ3JhZGlvJylcbiAgICAgICAgICAgICAgICA/ICdjaGFuZ2UnXG4gICAgICAgICAgICAgICAgOiAnaW5wdXQnXG5cbiAgICAgICAgLy8gZGV0ZXJtaW5lIHRoZSBhdHRyaWJ1dGUgdG8gY2hhbmdlIHdoZW4gdXBkYXRpbmdcbiAgICAgICAgc2VsZi5hdHRyID0gdHlwZSA9PT0gJ2NoZWNrYm94J1xuICAgICAgICAgICAgPyAnY2hlY2tlZCdcbiAgICAgICAgICAgIDogKHRhZyA9PT0gJ0lOUFVUJyB8fCB0YWcgPT09ICdTRUxFQ1QnIHx8IHRhZyA9PT0gJ1RFWFRBUkVBJylcbiAgICAgICAgICAgICAgICA/ICd2YWx1ZSdcbiAgICAgICAgICAgICAgICA6ICdpbm5lckhUTUwnXG5cbiAgICAgICAgLy8gc2VsZWN0W211bHRpcGxlXSBzdXBwb3J0XG4gICAgICAgIGlmKHRhZyA9PT0gJ1NFTEVDVCcgJiYgZWwuaGFzQXR0cmlidXRlKCdtdWx0aXBsZScpKSB7XG4gICAgICAgICAgICB0aGlzLm11bHRpID0gdHJ1ZVxuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGNvbXBvc2l0aW9uTG9jayA9IGZhbHNlXG4gICAgICAgIHNlbGYuY0xvY2sgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBjb21wb3NpdGlvbkxvY2sgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgc2VsZi5jVW5sb2NrID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgY29tcG9zaXRpb25Mb2NrID0gZmFsc2VcbiAgICAgICAgfVxuICAgICAgICBlbC5hZGRFdmVudExpc3RlbmVyKCdjb21wb3NpdGlvbnN0YXJ0JywgdGhpcy5jTG9jaylcbiAgICAgICAgZWwuYWRkRXZlbnRMaXN0ZW5lcignY29tcG9zaXRpb25lbmQnLCB0aGlzLmNVbmxvY2spXG5cbiAgICAgICAgLy8gYXR0YWNoIGxpc3RlbmVyXG4gICAgICAgIHNlbGYuc2V0ID0gc2VsZi5maWx0ZXJzXG4gICAgICAgICAgICA/IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBpZiAoY29tcG9zaXRpb25Mb2NrKSByZXR1cm5cbiAgICAgICAgICAgICAgICAvLyBpZiB0aGlzIGRpcmVjdGl2ZSBoYXMgZmlsdGVyc1xuICAgICAgICAgICAgICAgIC8vIHdlIG5lZWQgdG8gbGV0IHRoZSB2bS4kc2V0IHRyaWdnZXJcbiAgICAgICAgICAgICAgICAvLyB1cGRhdGUoKSBzbyBmaWx0ZXJzIGFyZSBhcHBsaWVkLlxuICAgICAgICAgICAgICAgIC8vIHRoZXJlZm9yZSB3ZSBoYXZlIHRvIHJlY29yZCBjdXJzb3IgcG9zaXRpb25cbiAgICAgICAgICAgICAgICAvLyBzbyB0aGF0IGFmdGVyIHZtLiRzZXQgY2hhbmdlcyB0aGUgaW5wdXRcbiAgICAgICAgICAgICAgICAvLyB2YWx1ZSB3ZSBjYW4gcHV0IHRoZSBjdXJzb3IgYmFjayBhdCB3aGVyZSBpdCBpc1xuICAgICAgICAgICAgICAgIHZhciBjdXJzb3JQb3NcbiAgICAgICAgICAgICAgICB0cnkgeyBjdXJzb3JQb3MgPSBlbC5zZWxlY3Rpb25TdGFydCB9IGNhdGNoIChlKSB7fVxuXG4gICAgICAgICAgICAgICAgc2VsZi5fc2V0KClcblxuICAgICAgICAgICAgICAgIC8vIHNpbmNlIHVwZGF0ZXMgYXJlIGFzeW5jXG4gICAgICAgICAgICAgICAgLy8gd2UgbmVlZCB0byByZXNldCBjdXJzb3IgcG9zaXRpb24gYXN5bmMgdG9vXG4gICAgICAgICAgICAgICAgdXRpbHMubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY3Vyc29yUG9zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVsLnNldFNlbGVjdGlvblJhbmdlKGN1cnNvclBvcywgY3Vyc29yUG9zKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmIChjb21wb3NpdGlvbkxvY2spIHJldHVyblxuICAgICAgICAgICAgICAgIC8vIG5vIGZpbHRlcnMsIGRvbid0IGxldCBpdCB0cmlnZ2VyIHVwZGF0ZSgpXG4gICAgICAgICAgICAgICAgc2VsZi5sb2NrID0gdHJ1ZVxuXG4gICAgICAgICAgICAgICAgc2VsZi5fc2V0KClcblxuICAgICAgICAgICAgICAgIHV0aWxzLm5leHRUaWNrKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZi5sb2NrID0gZmFsc2VcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICBlbC5hZGRFdmVudExpc3RlbmVyKHNlbGYuZXZlbnQsIHNlbGYuc2V0KVxuXG4gICAgICAgIC8vIGZpeCBzaGl0IGZvciBJRTlcbiAgICAgICAgLy8gc2luY2UgaXQgZG9lc24ndCBmaXJlIGlucHV0IG9uIGJhY2tzcGFjZSAvIGRlbCAvIGN1dFxuICAgICAgICBpZiAoaXNJRTkpIHtcbiAgICAgICAgICAgIHNlbGYub25DdXQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgLy8gY3V0IGV2ZW50IGZpcmVzIGJlZm9yZSB0aGUgdmFsdWUgYWN0dWFsbHkgY2hhbmdlc1xuICAgICAgICAgICAgICAgIHV0aWxzLm5leHRUaWNrKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZi5zZXQoKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzZWxmLm9uRGVsID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoZS5rZXlDb2RlID09PSA0NiB8fCBlLmtleUNvZGUgPT09IDgpIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZi5zZXQoKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ2N1dCcsIHNlbGYub25DdXQpXG4gICAgICAgICAgICBlbC5hZGRFdmVudExpc3RlbmVyKCdrZXl1cCcsIHNlbGYub25EZWwpXG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgX3NldDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLm93bmVyVk0uJHNldChcbiAgICAgICAgICAgIHRoaXMua2V5LCB0aGlzLm11bHRpXG4gICAgICAgICAgICAgICAgPyBnZXRNdWx0aXBsZVNlbGVjdE9wdGlvbnModGhpcy5lbClcbiAgICAgICAgICAgICAgICA6IHRoaXMuZWxbdGhpcy5hdHRyXVxuICAgICAgICApXG4gICAgfSxcblxuICAgIHVwZGF0ZTogZnVuY3Rpb24gKHZhbHVlLCBpbml0KSB7XG4gICAgICAgIC8qIGpzaGludCBlcWVxZXE6IGZhbHNlICovXG4gICAgICAgIC8vIHN5bmMgYmFjayBpbmxpbmUgdmFsdWUgaWYgaW5pdGlhbCBkYXRhIGlzIHVuZGVmaW5lZFxuICAgICAgICBpZiAoaW5pdCAmJiB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fc2V0KClcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5sb2NrKSByZXR1cm5cbiAgICAgICAgdmFyIGVsID0gdGhpcy5lbFxuICAgICAgICBpZiAoZWwudGFnTmFtZSA9PT0gJ1NFTEVDVCcpIHsgLy8gc2VsZWN0IGRyb3Bkb3duXG4gICAgICAgICAgICBlbC5zZWxlY3RlZEluZGV4ID0gLTFcbiAgICAgICAgICAgIGlmKHRoaXMubXVsdGkgJiYgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICB2YWx1ZS5mb3JFYWNoKHRoaXMudXBkYXRlU2VsZWN0LCB0aGlzKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZVNlbGVjdCh2YWx1ZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChlbC50eXBlID09PSAncmFkaW8nKSB7IC8vIHJhZGlvIGJ1dHRvblxuICAgICAgICAgICAgZWwuY2hlY2tlZCA9IHZhbHVlID09IGVsLnZhbHVlXG4gICAgICAgIH0gZWxzZSBpZiAoZWwudHlwZSA9PT0gJ2NoZWNrYm94JykgeyAvLyBjaGVja2JveFxuICAgICAgICAgICAgZWwuY2hlY2tlZCA9ICEhdmFsdWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVsW3RoaXMuYXR0cl0gPSB1dGlscy5ndWFyZCh2YWx1ZSlcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGVTZWxlY3Q6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAvKiBqc2hpbnQgZXFlcWVxOiBmYWxzZSAqL1xuICAgICAgICAvLyBzZXR0aW5nIDxzZWxlY3Q+J3MgdmFsdWUgaW4gSUU5IGRvZXNuJ3Qgd29ya1xuICAgICAgICAvLyB3ZSBoYXZlIHRvIG1hbnVhbGx5IGxvb3AgdGhyb3VnaCB0aGUgb3B0aW9uc1xuICAgICAgICB2YXIgb3B0aW9ucyA9IHRoaXMuZWwub3B0aW9ucyxcbiAgICAgICAgICAgIGkgPSBvcHRpb25zLmxlbmd0aFxuICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICBpZiAob3B0aW9uc1tpXS52YWx1ZSA9PSB2YWx1ZSkge1xuICAgICAgICAgICAgICAgIG9wdGlvbnNbaV0uc2VsZWN0ZWQgPSB0cnVlXG4gICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICB1bmJpbmQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGVsID0gdGhpcy5lbFxuICAgICAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKHRoaXMuZXZlbnQsIHRoaXMuc2V0KVxuICAgICAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKCdjb21wb3NpdGlvbnN0YXJ0JywgdGhpcy5jTG9jaylcbiAgICAgICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcignY29tcG9zaXRpb25lbmQnLCB0aGlzLmNVbmxvY2spXG4gICAgICAgIGlmIChpc0lFOSkge1xuICAgICAgICAgICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcignY3V0JywgdGhpcy5vbkN1dClcbiAgICAgICAgICAgIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleXVwJywgdGhpcy5vbkRlbClcbiAgICAgICAgfVxuICAgIH1cbn0iLCJ2YXIgdXRpbHMgICAgPSByZXF1aXJlKCcuLi91dGlscycpXG5cbi8qKlxuICogIEJpbmRpbmcgZm9yIGV2ZW50IGxpc3RlbmVyc1xuICovXG5tb2R1bGUuZXhwb3J0cyA9IHtcblxuICAgIGlzRm46IHRydWUsXG5cbiAgICBiaW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuY29udGV4dCA9IHRoaXMuYmluZGluZy5pc0V4cFxuICAgICAgICAgICAgPyB0aGlzLnZtXG4gICAgICAgICAgICA6IHRoaXMuYmluZGluZy5jb21waWxlci52bVxuICAgIH0sXG5cbiAgICB1cGRhdGU6IGZ1bmN0aW9uIChoYW5kbGVyKSB7XG4gICAgICAgIGlmICh0eXBlb2YgaGFuZGxlciAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgdXRpbHMud2FybignRGlyZWN0aXZlIFwidi1vbjonICsgdGhpcy5leHByZXNzaW9uICsgJ1wiIGV4cGVjdHMgYSBtZXRob2QuJylcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3VuYmluZCgpXG4gICAgICAgIHZhciB2bSA9IHRoaXMudm0sXG4gICAgICAgICAgICBjb250ZXh0ID0gdGhpcy5jb250ZXh0XG4gICAgICAgIHRoaXMuaGFuZGxlciA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgICAgICBlLnRhcmdldFZNID0gdm1cbiAgICAgICAgICAgIGNvbnRleHQuJGV2ZW50ID0gZVxuICAgICAgICAgICAgdmFyIHJlcyA9IGhhbmRsZXIuY2FsbChjb250ZXh0LCBlKVxuICAgICAgICAgICAgY29udGV4dC4kZXZlbnQgPSBudWxsXG4gICAgICAgICAgICByZXR1cm4gcmVzXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5lbC5hZGRFdmVudExpc3RlbmVyKHRoaXMuYXJnLCB0aGlzLmhhbmRsZXIpXG4gICAgfSxcblxuICAgIHVuYmluZDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVsLnJlbW92ZUV2ZW50TGlzdGVuZXIodGhpcy5hcmcsIHRoaXMuaGFuZGxlcilcbiAgICB9XG59IiwidmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbHMnKVxuXG4vKipcbiAqICBCaW5kaW5nIGZvciBwYXJ0aWFsc1xuICovXG5tb2R1bGUuZXhwb3J0cyA9IHtcblxuICAgIGlzTGl0ZXJhbDogdHJ1ZSxcblxuICAgIGJpbmQ6IGZ1bmN0aW9uICgpIHtcblxuICAgICAgICB2YXIgaWQgPSB0aGlzLmV4cHJlc3Npb25cbiAgICAgICAgaWYgKCFpZCkgcmV0dXJuXG5cbiAgICAgICAgdmFyIGVsICAgICAgID0gdGhpcy5lbCxcbiAgICAgICAgICAgIGNvbXBpbGVyID0gdGhpcy5jb21waWxlcixcbiAgICAgICAgICAgIHBhcnRpYWwgID0gY29tcGlsZXIuZ2V0T3B0aW9uKCdwYXJ0aWFscycsIGlkKVxuXG4gICAgICAgIGlmICghcGFydGlhbCkge1xuICAgICAgICAgICAgaWYgKGlkID09PSAneWllbGQnKSB7XG4gICAgICAgICAgICAgICAgdXRpbHMud2Fybigne3s+eWllbGR9fSBzeW50YXggaGFzIGJlZW4gZGVwcmVjYXRlZC4gVXNlIDxjb250ZW50PiB0YWcgaW5zdGVhZC4nKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBwYXJ0aWFsID0gcGFydGlhbC5jbG9uZU5vZGUodHJ1ZSlcblxuICAgICAgICAvLyBjb21tZW50IHJlZiBub2RlIG1lYW5zIGlubGluZSBwYXJ0aWFsXG4gICAgICAgIGlmIChlbC5ub2RlVHlwZSA9PT0gOCkge1xuXG4gICAgICAgICAgICAvLyBrZWVwIGEgcmVmIGZvciB0aGUgcGFydGlhbCdzIGNvbnRlbnQgbm9kZXNcbiAgICAgICAgICAgIHZhciBub2RlcyA9IFtdLnNsaWNlLmNhbGwocGFydGlhbC5jaGlsZE5vZGVzKSxcbiAgICAgICAgICAgICAgICBwYXJlbnQgPSBlbC5wYXJlbnROb2RlXG4gICAgICAgICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKHBhcnRpYWwsIGVsKVxuICAgICAgICAgICAgcGFyZW50LnJlbW92ZUNoaWxkKGVsKVxuICAgICAgICAgICAgLy8gY29tcGlsZSBwYXJ0aWFsIGFmdGVyIGFwcGVuZGluZywgYmVjYXVzZSBpdHMgY2hpbGRyZW4ncyBwYXJlbnROb2RlXG4gICAgICAgICAgICAvLyB3aWxsIGNoYW5nZSBmcm9tIHRoZSBmcmFnbWVudCB0byB0aGUgY29ycmVjdCBwYXJlbnROb2RlLlxuICAgICAgICAgICAgLy8gVGhpcyBjb3VsZCBhZmZlY3QgZGlyZWN0aXZlcyB0aGF0IG5lZWQgYWNjZXNzIHRvIGl0cyBlbGVtZW50J3MgcGFyZW50Tm9kZS5cbiAgICAgICAgICAgIG5vZGVzLmZvckVhY2goY29tcGlsZXIuY29tcGlsZSwgY29tcGlsZXIpXG5cbiAgICAgICAgfSBlbHNlIHtcblxuICAgICAgICAgICAgLy8ganVzdCBzZXQgaW5uZXJIVE1MLi4uXG4gICAgICAgICAgICBlbC5pbm5lckhUTUwgPSAnJ1xuICAgICAgICAgICAgZWwuYXBwZW5kQ2hpbGQocGFydGlhbC5jbG9uZU5vZGUodHJ1ZSkpXG5cbiAgICAgICAgfVxuICAgIH1cblxufSIsInZhciB1dGlscyAgICAgID0gcmVxdWlyZSgnLi4vdXRpbHMnKSxcbiAgICBjb25maWcgICAgID0gcmVxdWlyZSgnLi4vY29uZmlnJylcblxuLyoqXG4gKiAgQmluZGluZyB0aGF0IG1hbmFnZXMgVk1zIGJhc2VkIG9uIGFuIEFycmF5XG4gKi9cbm1vZHVsZS5leHBvcnRzID0ge1xuXG4gICAgYmluZDogZnVuY3Rpb24gKCkge1xuXG4gICAgICAgIHRoaXMuaWRlbnRpZmllciA9ICckcicgKyB0aGlzLmlkXG5cbiAgICAgICAgLy8gYSBoYXNoIHRvIGNhY2hlIHRoZSBzYW1lIGV4cHJlc3Npb25zIG9uIHJlcGVhdGVkIGluc3RhbmNlc1xuICAgICAgICAvLyBzbyB0aGV5IGRvbid0IGhhdmUgdG8gYmUgY29tcGlsZWQgZm9yIGV2ZXJ5IHNpbmdsZSBpbnN0YW5jZVxuICAgICAgICB0aGlzLmV4cENhY2hlID0gdXRpbHMuaGFzaCgpXG5cbiAgICAgICAgdmFyIGVsICAgPSB0aGlzLmVsLFxuICAgICAgICAgICAgY3RuICA9IHRoaXMuY29udGFpbmVyID0gZWwucGFyZW50Tm9kZVxuXG4gICAgICAgIC8vIGV4dHJhY3QgY2hpbGQgSWQsIGlmIGFueVxuICAgICAgICB0aGlzLmNoaWxkSWQgPSB0aGlzLmNvbXBpbGVyLmV2YWwodXRpbHMuYXR0cihlbCwgJ3JlZicpKVxuXG4gICAgICAgIC8vIGNyZWF0ZSBhIGNvbW1lbnQgbm9kZSBhcyBhIHJlZmVyZW5jZSBub2RlIGZvciBET00gaW5zZXJ0aW9uc1xuICAgICAgICB0aGlzLnJlZiA9IGRvY3VtZW50LmNyZWF0ZUNvbW1lbnQoY29uZmlnLnByZWZpeCArICctcmVwZWF0LScgKyB0aGlzLmtleSlcbiAgICAgICAgY3RuLmluc2VydEJlZm9yZSh0aGlzLnJlZiwgZWwpXG4gICAgICAgIGN0bi5yZW1vdmVDaGlsZChlbClcblxuICAgICAgICB0aGlzLmNvbGxlY3Rpb24gPSBudWxsXG4gICAgICAgIHRoaXMudm1zID0gbnVsbFxuXG4gICAgfSxcblxuICAgIHVwZGF0ZTogZnVuY3Rpb24gKGNvbGxlY3Rpb24pIHtcblxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY29sbGVjdGlvbikpIHtcbiAgICAgICAgICAgIGlmICh1dGlscy5pc09iamVjdChjb2xsZWN0aW9uKSkge1xuICAgICAgICAgICAgICAgIGNvbGxlY3Rpb24gPSB1dGlscy5vYmplY3RUb0FycmF5KGNvbGxlY3Rpb24pXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHV0aWxzLndhcm4oJ3YtcmVwZWF0IG9ubHkgYWNjZXB0cyBBcnJheSBvciBPYmplY3QgdmFsdWVzLicpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBrZWVwIHJlZmVyZW5jZSBvZiBvbGQgZGF0YSBhbmQgVk1zXG4gICAgICAgIC8vIHNvIHdlIGNhbiByZXVzZSB0aGVtIGlmIHBvc3NpYmxlXG4gICAgICAgIHRoaXMub2xkVk1zID0gdGhpcy52bXNcbiAgICAgICAgdGhpcy5vbGRDb2xsZWN0aW9uID0gdGhpcy5jb2xsZWN0aW9uXG4gICAgICAgIGNvbGxlY3Rpb24gPSB0aGlzLmNvbGxlY3Rpb24gPSBjb2xsZWN0aW9uIHx8IFtdXG5cbiAgICAgICAgdmFyIGlzT2JqZWN0ID0gY29sbGVjdGlvblswXSAmJiB1dGlscy5pc09iamVjdChjb2xsZWN0aW9uWzBdKVxuICAgICAgICB0aGlzLnZtcyA9IHRoaXMub2xkQ29sbGVjdGlvblxuICAgICAgICAgICAgPyB0aGlzLmRpZmYoY29sbGVjdGlvbiwgaXNPYmplY3QpXG4gICAgICAgICAgICA6IHRoaXMuaW5pdChjb2xsZWN0aW9uLCBpc09iamVjdClcblxuICAgICAgICBpZiAodGhpcy5jaGlsZElkKSB7XG4gICAgICAgICAgICB0aGlzLnZtLiRbdGhpcy5jaGlsZElkXSA9IHRoaXMudm1zXG4gICAgICAgIH1cblxuICAgIH0sXG5cbiAgICBpbml0OiBmdW5jdGlvbiAoY29sbGVjdGlvbiwgaXNPYmplY3QpIHtcbiAgICAgICAgdmFyIHZtLCB2bXMgPSBbXVxuICAgICAgICBmb3IgKHZhciBpID0gMCwgbCA9IGNvbGxlY3Rpb24ubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICB2bSA9IHRoaXMuYnVpbGQoY29sbGVjdGlvbltpXSwgaSwgaXNPYmplY3QpXG4gICAgICAgICAgICB2bXMucHVzaCh2bSlcbiAgICAgICAgICAgIGlmICh0aGlzLmNvbXBpbGVyLmluaXQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbnRhaW5lci5pbnNlcnRCZWZvcmUodm0uJGVsLCB0aGlzLnJlZilcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdm0uJGJlZm9yZSh0aGlzLnJlZilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdm1zXG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBEaWZmIHRoZSBuZXcgYXJyYXkgd2l0aCB0aGUgb2xkXG4gICAgICogIGFuZCBkZXRlcm1pbmUgdGhlIG1pbmltdW0gYW1vdW50IG9mIERPTSBtYW5pcHVsYXRpb25zLlxuICAgICAqL1xuICAgIGRpZmY6IGZ1bmN0aW9uIChuZXdDb2xsZWN0aW9uLCBpc09iamVjdCkge1xuXG4gICAgICAgIHZhciBpLCBsLCBpdGVtLCB2bSxcbiAgICAgICAgICAgIG9sZEluZGV4LFxuICAgICAgICAgICAgdGFyZ2V0TmV4dCxcbiAgICAgICAgICAgIGN1cnJlbnROZXh0LFxuICAgICAgICAgICAgbmV4dEVsLFxuICAgICAgICAgICAgY3RuICAgID0gdGhpcy5jb250YWluZXIsXG4gICAgICAgICAgICBvbGRWTXMgPSB0aGlzLm9sZFZNcyxcbiAgICAgICAgICAgIHZtcyAgICA9IFtdXG5cbiAgICAgICAgdm1zLmxlbmd0aCA9IG5ld0NvbGxlY3Rpb24ubGVuZ3RoXG5cbiAgICAgICAgLy8gZmlyc3QgcGFzcywgY29sbGVjdCBuZXcgcmV1c2VkIGFuZCBuZXcgY3JlYXRlZFxuICAgICAgICBmb3IgKGkgPSAwLCBsID0gbmV3Q29sbGVjdGlvbi5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgICAgIGl0ZW0gPSBuZXdDb2xsZWN0aW9uW2ldXG4gICAgICAgICAgICBpZiAoaXNPYmplY3QpIHtcbiAgICAgICAgICAgICAgICBpdGVtLiRpbmRleCA9IGlcbiAgICAgICAgICAgICAgICBpZiAoaXRlbS5fX2VtaXR0ZXJfXyAmJiBpdGVtLl9fZW1pdHRlcl9fW3RoaXMuaWRlbnRpZmllcl0pIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhpcyBwaWVjZSBvZiBkYXRhIGlzIGJlaW5nIHJldXNlZC5cbiAgICAgICAgICAgICAgICAgICAgLy8gcmVjb3JkIGl0cyBmaW5hbCBwb3NpdGlvbiBpbiByZXVzZWQgdm1zXG4gICAgICAgICAgICAgICAgICAgIGl0ZW0uJHJldXNlZCA9IHRydWVcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB2bXNbaV0gPSB0aGlzLmJ1aWxkKGl0ZW0sIGksIGlzT2JqZWN0KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gd2UgY2FuJ3QgYXR0YWNoIGFuIGlkZW50aWZpZXIgdG8gcHJpbWl0aXZlIHZhbHVlc1xuICAgICAgICAgICAgICAgIC8vIHNvIGhhdmUgdG8gZG8gYW4gaW5kZXhPZi4uLlxuICAgICAgICAgICAgICAgIG9sZEluZGV4ID0gaW5kZXhPZihvbGRWTXMsIGl0ZW0pXG4gICAgICAgICAgICAgICAgaWYgKG9sZEluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gcmVjb3JkIHRoZSBwb3NpdGlvbiBvbiB0aGUgZXhpc3Rpbmcgdm1cbiAgICAgICAgICAgICAgICAgICAgb2xkVk1zW29sZEluZGV4XS4kcmV1c2VkID0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICBvbGRWTXNbb2xkSW5kZXhdLiRkYXRhLiRpbmRleCA9IGlcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB2bXNbaV0gPSB0aGlzLmJ1aWxkKGl0ZW0sIGksIGlzT2JqZWN0KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHNlY29uZCBwYXNzLCBjb2xsZWN0IG9sZCByZXVzZWQgYW5kIGRlc3Ryb3kgdW51c2VkXG4gICAgICAgIGZvciAoaSA9IDAsIGwgPSBvbGRWTXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICB2bSA9IG9sZFZNc1tpXVxuICAgICAgICAgICAgaXRlbSA9IHRoaXMuYXJnXG4gICAgICAgICAgICAgICAgPyB2bS4kZGF0YVt0aGlzLmFyZ11cbiAgICAgICAgICAgICAgICA6IHZtLiRkYXRhXG4gICAgICAgICAgICBpZiAoaXRlbS4kcmV1c2VkKSB7XG4gICAgICAgICAgICAgICAgdm0uJHJldXNlZCA9IHRydWVcbiAgICAgICAgICAgICAgICBkZWxldGUgaXRlbS4kcmV1c2VkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodm0uJHJldXNlZCkge1xuICAgICAgICAgICAgICAgIC8vIHVwZGF0ZSB0aGUgaW5kZXggdG8gbGF0ZXN0XG4gICAgICAgICAgICAgICAgdm0uJGluZGV4ID0gaXRlbS4kaW5kZXhcbiAgICAgICAgICAgICAgICAvLyB0aGUgaXRlbSBjb3VsZCBoYXZlIGhhZCBhIG5ldyBrZXlcbiAgICAgICAgICAgICAgICBpZiAoaXRlbS4ka2V5ICYmIGl0ZW0uJGtleSAhPT0gdm0uJGtleSkge1xuICAgICAgICAgICAgICAgICAgICB2bS4ka2V5ID0gaXRlbS4ka2V5XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZtc1t2bS4kaW5kZXhdID0gdm1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gdGhpcyBvbmUgY2FuIGJlIGRlc3Ryb3llZC5cbiAgICAgICAgICAgICAgICBpZiAoaXRlbS5fX2VtaXR0ZXJfXykge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgaXRlbS5fX2VtaXR0ZXJfX1t0aGlzLmlkZW50aWZpZXJdXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZtLiRkZXN0cm95KClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGZpbmFsIHBhc3MsIG1vdmUvaW5zZXJ0IERPTSBlbGVtZW50c1xuICAgICAgICBpID0gdm1zLmxlbmd0aFxuICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICB2bSA9IHZtc1tpXVxuICAgICAgICAgICAgaXRlbSA9IHZtLiRkYXRhXG4gICAgICAgICAgICB0YXJnZXROZXh0ID0gdm1zW2kgKyAxXVxuICAgICAgICAgICAgaWYgKHZtLiRyZXVzZWQpIHtcbiAgICAgICAgICAgICAgICBuZXh0RWwgPSB2bS4kZWwubmV4dFNpYmxpbmdcbiAgICAgICAgICAgICAgICAvLyBkZXN0cm95ZWQgVk1zJyBlbGVtZW50IG1pZ2h0IHN0aWxsIGJlIGluIHRoZSBET01cbiAgICAgICAgICAgICAgICAvLyBkdWUgdG8gdHJhbnNpdGlvbnNcbiAgICAgICAgICAgICAgICB3aGlsZSAoIW5leHRFbC52dWVfdm0gJiYgbmV4dEVsICE9PSB0aGlzLnJlZikge1xuICAgICAgICAgICAgICAgICAgICBuZXh0RWwgPSBuZXh0RWwubmV4dFNpYmxpbmdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY3VycmVudE5leHQgPSBuZXh0RWwudnVlX3ZtXG4gICAgICAgICAgICAgICAgaWYgKGN1cnJlbnROZXh0ICE9PSB0YXJnZXROZXh0KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdGFyZ2V0TmV4dCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY3RuLmluc2VydEJlZm9yZSh2bS4kZWwsIHRoaXMucmVmKVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV4dEVsID0gdGFyZ2V0TmV4dC4kZWxcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIG5ldyBWTXMnIGVsZW1lbnQgbWlnaHQgbm90IGJlIGluIHRoZSBET00geWV0XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBkdWUgdG8gdHJhbnNpdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgICAgIHdoaWxlICghbmV4dEVsLnBhcmVudE5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXROZXh0ID0gdm1zW25leHRFbC52dWVfdm0uJGluZGV4ICsgMV1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0RWwgPSB0YXJnZXROZXh0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gdGFyZ2V0TmV4dC4kZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiB0aGlzLnJlZlxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgY3RuLmluc2VydEJlZm9yZSh2bS4kZWwsIG5leHRFbClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBkZWxldGUgdm0uJHJldXNlZFxuICAgICAgICAgICAgICAgIGRlbGV0ZSBpdGVtLiRpbmRleFxuICAgICAgICAgICAgICAgIGRlbGV0ZSBpdGVtLiRrZXlcbiAgICAgICAgICAgIH0gZWxzZSB7IC8vIGEgbmV3IHZtXG4gICAgICAgICAgICAgICAgdm0uJGJlZm9yZSh0YXJnZXROZXh0ID8gdGFyZ2V0TmV4dC4kZWwgOiB0aGlzLnJlZilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2bXNcbiAgICB9LFxuXG4gICAgYnVpbGQ6IGZ1bmN0aW9uIChkYXRhLCBpbmRleCwgaXNPYmplY3QpIHtcblxuICAgICAgICAvLyB3cmFwIG5vbi1vYmplY3QgdmFsdWVzXG4gICAgICAgIHZhciByYXcsIGFsaWFzLFxuICAgICAgICAgICAgd3JhcCA9ICFpc09iamVjdCB8fCB0aGlzLmFyZ1xuICAgICAgICBpZiAod3JhcCkge1xuICAgICAgICAgICAgcmF3ID0gZGF0YVxuICAgICAgICAgICAgYWxpYXMgPSB0aGlzLmFyZyB8fCAnJHZhbHVlJ1xuICAgICAgICAgICAgZGF0YSA9IHt9XG4gICAgICAgICAgICBkYXRhW2FsaWFzXSA9IHJhd1xuICAgICAgICB9XG4gICAgICAgIGRhdGEuJGluZGV4ID0gaW5kZXhcblxuICAgICAgICB2YXIgZWwgPSB0aGlzLmVsLmNsb25lTm9kZSh0cnVlKSxcbiAgICAgICAgICAgIEN0b3IgPSB0aGlzLmNvbXBpbGVyLnJlc29sdmVDb21wb25lbnQoZWwsIGRhdGEpLFxuICAgICAgICAgICAgdm0gPSBuZXcgQ3Rvcih7XG4gICAgICAgICAgICAgICAgZWw6IGVsLFxuICAgICAgICAgICAgICAgIGRhdGE6IGRhdGEsXG4gICAgICAgICAgICAgICAgcGFyZW50OiB0aGlzLnZtLFxuICAgICAgICAgICAgICAgIGNvbXBpbGVyT3B0aW9uczoge1xuICAgICAgICAgICAgICAgICAgICByZXBlYXQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGV4cENhY2hlOiB0aGlzLmV4cENhY2hlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcblxuICAgICAgICBpZiAoaXNPYmplY3QpIHtcbiAgICAgICAgICAgIC8vIGF0dGFjaCBhbiBpZW51bWVyYWJsZSBpZGVudGlmaWVyIHRvIHRoZSByYXcgZGF0YVxuICAgICAgICAgICAgKHJhdyB8fCBkYXRhKS5fX2VtaXR0ZXJfX1t0aGlzLmlkZW50aWZpZXJdID0gdHJ1ZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdyYXApIHtcbiAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgICAgICAgICBzeW5jID0gZnVuY3Rpb24gKHZhbCkge1xuICAgICAgICAgICAgICAgICAgICBzZWxmLmxvY2sgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIHNlbGYuY29sbGVjdGlvbi4kc2V0KHZtLiRpbmRleCwgdmFsKVxuICAgICAgICAgICAgICAgICAgICBzZWxmLmxvY2sgPSBmYWxzZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZtLiRjb21waWxlci5vYnNlcnZlci5vbignY2hhbmdlOicgKyBhbGlhcywgc3luYylcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2bVxuXG4gICAgfSxcblxuICAgIHVuYmluZDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAodGhpcy5jaGlsZElkKSB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy52bS4kW3RoaXMuY2hpbGRJZF1cbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy52bXMpIHtcbiAgICAgICAgICAgIHZhciBpID0gdGhpcy52bXMubGVuZ3RoXG4gICAgICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICAgICAgdGhpcy52bXNbaV0uJGRlc3Ryb3koKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vLyBIZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogIEZpbmQgYW4gb2JqZWN0IG9yIGEgd3JhcHBlZCBkYXRhIG9iamVjdFxuICogIGZyb20gYW4gQXJyYXlcbiAqL1xuZnVuY3Rpb24gaW5kZXhPZiAodm1zLCBvYmopIHtcbiAgICBmb3IgKHZhciB2bSwgaSA9IDAsIGwgPSB2bXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIHZtID0gdm1zW2ldXG4gICAgICAgIGlmICghdm0uJHJldXNlZCAmJiB2bS4kdmFsdWUgPT09IG9iaikge1xuICAgICAgICAgICAgcmV0dXJuIGlcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gLTFcbn0iLCJ2YXIgY2FtZWxSRSA9IC8tKFthLXpdKS9nLFxuICAgIHByZWZpeGVzID0gWyd3ZWJraXQnLCAnbW96JywgJ21zJ11cblxuZnVuY3Rpb24gY2FtZWxSZXBsYWNlciAobSkge1xuICAgIHJldHVybiBtWzFdLnRvVXBwZXJDYXNlKClcbn1cblxuLyoqXG4gKiAgQmluZGluZyBmb3IgQ1NTIHN0eWxlc1xuICovXG5tb2R1bGUuZXhwb3J0cyA9IHtcblxuICAgIGJpbmQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHByb3AgPSB0aGlzLmFyZ1xuICAgICAgICBpZiAoIXByb3ApIHJldHVyblxuICAgICAgICB2YXIgZmlyc3QgPSBwcm9wLmNoYXJBdCgwKVxuICAgICAgICBpZiAoZmlyc3QgPT09ICckJykge1xuICAgICAgICAgICAgLy8gcHJvcGVydGllcyB0aGF0IHN0YXJ0IHdpdGggJCB3aWxsIGJlIGF1dG8tcHJlZml4ZWRcbiAgICAgICAgICAgIHByb3AgPSBwcm9wLnNsaWNlKDEpXG4gICAgICAgICAgICB0aGlzLnByZWZpeGVkID0gdHJ1ZVxuICAgICAgICB9IGVsc2UgaWYgKGZpcnN0ID09PSAnLScpIHtcbiAgICAgICAgICAgIC8vIG5vcm1hbCBzdGFydGluZyBoeXBoZW5zIHNob3VsZCBub3QgYmUgY29udmVydGVkXG4gICAgICAgICAgICBwcm9wID0gcHJvcC5zbGljZSgxKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMucHJvcCA9IHByb3AucmVwbGFjZShjYW1lbFJFLCBjYW1lbFJlcGxhY2VyKVxuICAgIH0sXG5cbiAgICB1cGRhdGU6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICB2YXIgcHJvcCA9IHRoaXMucHJvcFxuICAgICAgICBpZiAocHJvcCkge1xuICAgICAgICAgICAgdGhpcy5lbC5zdHlsZVtwcm9wXSA9IHZhbHVlXG4gICAgICAgICAgICBpZiAodGhpcy5wcmVmaXhlZCkge1xuICAgICAgICAgICAgICAgIHByb3AgPSBwcm9wLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgcHJvcC5zbGljZSgxKVxuICAgICAgICAgICAgICAgIHZhciBpID0gcHJlZml4ZXMubGVuZ3RoXG4gICAgICAgICAgICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmVsLnN0eWxlW3ByZWZpeGVzW2ldICsgcHJvcF0gPSB2YWx1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuZWwuc3R5bGUuY3NzVGV4dCA9IHZhbHVlXG4gICAgICAgIH1cbiAgICB9XG5cbn0iLCIvKipcbiAqICBNYW5hZ2VzIGEgY29uZGl0aW9uYWwgY2hpbGQgVk0gdXNpbmcgdGhlXG4gKiAgYmluZGluZydzIHZhbHVlIGFzIHRoZSBjb21wb25lbnQgSUQuXG4gKi9cbm1vZHVsZS5leHBvcnRzID0ge1xuXG4gICAgYmluZDogZnVuY3Rpb24gKCkge1xuXG4gICAgICAgIC8vIHRyYWNrIHBvc2l0aW9uIGluIERPTSB3aXRoIGEgcmVmIG5vZGVcbiAgICAgICAgdmFyIGVsICAgICAgID0gdGhpcy5yYXcgPSB0aGlzLmVsLFxuICAgICAgICAgICAgcGFyZW50ICAgPSBlbC5wYXJlbnROb2RlLFxuICAgICAgICAgICAgcmVmICAgICAgPSB0aGlzLnJlZiA9IGRvY3VtZW50LmNyZWF0ZUNvbW1lbnQoJ3YtdmlldycpXG4gICAgICAgIHBhcmVudC5pbnNlcnRCZWZvcmUocmVmLCBlbClcbiAgICAgICAgcGFyZW50LnJlbW92ZUNoaWxkKGVsKVxuXG4gICAgICAgIC8vIGNhY2hlIG9yaWdpbmFsIGNvbnRlbnRcbiAgICAgICAgLyoganNoaW50IGJvc3M6IHRydWUgKi9cbiAgICAgICAgdmFyIG5vZGUsXG4gICAgICAgICAgICBmcmFnID0gdGhpcy5pbm5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG4gICAgICAgIHdoaWxlIChub2RlID0gZWwuZmlyc3RDaGlsZCkge1xuICAgICAgICAgICAgZnJhZy5hcHBlbmRDaGlsZChub2RlKVxuICAgICAgICB9XG5cbiAgICB9LFxuXG4gICAgdXBkYXRlOiBmdW5jdGlvbih2YWx1ZSkge1xuXG4gICAgICAgIHRoaXMuX3VuYmluZCgpXG5cbiAgICAgICAgdmFyIEN0b3IgID0gdGhpcy5jb21waWxlci5nZXRPcHRpb24oJ2NvbXBvbmVudHMnLCB2YWx1ZSlcbiAgICAgICAgaWYgKCFDdG9yKSByZXR1cm5cblxuICAgICAgICB0aGlzLmNoaWxkVk0gPSBuZXcgQ3Rvcih7XG4gICAgICAgICAgICBlbDogdGhpcy5yYXcuY2xvbmVOb2RlKHRydWUpLFxuICAgICAgICAgICAgcGFyZW50OiB0aGlzLnZtLFxuICAgICAgICAgICAgY29tcGlsZXJPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgcmF3Q29udGVudDogdGhpcy5pbm5lci5jbG9uZU5vZGUodHJ1ZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcblxuICAgICAgICB0aGlzLmVsID0gdGhpcy5jaGlsZFZNLiRlbFxuICAgICAgICBpZiAodGhpcy5jb21waWxlci5pbml0KSB7XG4gICAgICAgICAgICB0aGlzLnJlZi5wYXJlbnROb2RlLmluc2VydEJlZm9yZSh0aGlzLmVsLCB0aGlzLnJlZilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY2hpbGRWTS4kYmVmb3JlKHRoaXMucmVmKVxuICAgICAgICB9XG5cbiAgICB9LFxuXG4gICAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKHRoaXMuY2hpbGRWTSkge1xuICAgICAgICAgICAgdGhpcy5jaGlsZFZNLiRkZXN0cm95KClcbiAgICAgICAgfVxuICAgIH1cblxufSIsInZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJylcblxuLyoqXG4gKiAgQmluZGluZyBmb3IgaW5oZXJpdGluZyBkYXRhIGZyb20gcGFyZW50IFZNcy5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICBiaW5kOiBmdW5jdGlvbiAoKSB7XG5cbiAgICAgICAgdmFyIHNlbGYgICAgICA9IHRoaXMsXG4gICAgICAgICAgICBjaGlsZEtleSAgPSBzZWxmLmFyZyxcbiAgICAgICAgICAgIHBhcmVudEtleSA9IHNlbGYua2V5LFxuICAgICAgICAgICAgY29tcGlsZXIgID0gc2VsZi5jb21waWxlcixcbiAgICAgICAgICAgIG93bmVyICAgICA9IHNlbGYuYmluZGluZy5jb21waWxlclxuXG4gICAgICAgIGlmIChjb21waWxlciA9PT0gb3duZXIpIHtcbiAgICAgICAgICAgIHRoaXMuYWxvbmUgPSB0cnVlXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjaGlsZEtleSkge1xuICAgICAgICAgICAgaWYgKCFjb21waWxlci5iaW5kaW5nc1tjaGlsZEtleV0pIHtcbiAgICAgICAgICAgICAgICBjb21waWxlci5jcmVhdGVCaW5kaW5nKGNoaWxkS2V5KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gc3luYyBjaGFuZ2VzIG9uIGNoaWxkIGJhY2sgdG8gcGFyZW50XG4gICAgICAgICAgICBjb21waWxlci5vYnNlcnZlci5vbignY2hhbmdlOicgKyBjaGlsZEtleSwgZnVuY3Rpb24gKHZhbCkge1xuICAgICAgICAgICAgICAgIGlmIChjb21waWxlci5pbml0KSByZXR1cm5cbiAgICAgICAgICAgICAgICBpZiAoIXNlbGYubG9jaykge1xuICAgICAgICAgICAgICAgICAgICBzZWxmLmxvY2sgPSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIHV0aWxzLm5leHRUaWNrKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYubG9jayA9IGZhbHNlXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG93bmVyLnZtLiRzZXQocGFyZW50S2V5LCB2YWwpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgIC8vIHN5bmMgZnJvbSBwYXJlbnRcbiAgICAgICAgaWYgKCF0aGlzLmFsb25lICYmICF0aGlzLmxvY2spIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmFyZykge1xuICAgICAgICAgICAgICAgIHRoaXMudm0uJHNldCh0aGlzLmFyZywgdmFsdWUpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMudm0uJGRhdGEgPSB2YWx1ZVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG59IiwiZnVuY3Rpb24gRW1pdHRlciAoY3R4KSB7XG4gICAgdGhpcy5fY3R4ID0gY3R4IHx8IHRoaXNcbn1cblxudmFyIEVtaXR0ZXJQcm90byA9IEVtaXR0ZXIucHJvdG90eXBlXG5cbkVtaXR0ZXJQcm90by5vbiA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XG4gICAgdGhpcy5fY2JzID0gdGhpcy5fY2JzIHx8IHt9XG4gICAgOyh0aGlzLl9jYnNbZXZlbnRdID0gdGhpcy5fY2JzW2V2ZW50XSB8fCBbXSlcbiAgICAgICAgLnB1c2goZm4pXG4gICAgcmV0dXJuIHRoaXNcbn1cblxuRW1pdHRlclByb3RvLm9uY2UgPSBmdW5jdGlvbihldmVudCwgZm4pe1xuICAgIHZhciBzZWxmID0gdGhpc1xuICAgIHRoaXMuX2NicyA9IHRoaXMuX2NicyB8fCB7fVxuXG4gICAgZnVuY3Rpb24gb24gKCkge1xuICAgICAgICBzZWxmLm9mZihldmVudCwgb24pXG4gICAgICAgIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICB9XG5cbiAgICBvbi5mbiA9IGZuXG4gICAgdGhpcy5vbihldmVudCwgb24pXG4gICAgcmV0dXJuIHRoaXNcbn1cblxuRW1pdHRlclByb3RvLm9mZiA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XG4gICAgdGhpcy5fY2JzID0gdGhpcy5fY2JzIHx8IHt9XG5cbiAgICAvLyBhbGxcbiAgICBpZiAoIWFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgdGhpcy5fY2JzID0ge31cbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICAvLyBzcGVjaWZpYyBldmVudFxuICAgIHZhciBjYWxsYmFja3MgPSB0aGlzLl9jYnNbZXZlbnRdXG4gICAgaWYgKCFjYWxsYmFja3MpIHJldHVybiB0aGlzXG5cbiAgICAvLyByZW1vdmUgYWxsIGhhbmRsZXJzXG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuX2Nic1tldmVudF1cbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICAvLyByZW1vdmUgc3BlY2lmaWMgaGFuZGxlclxuICAgIHZhciBjYlxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2FsbGJhY2tzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNiID0gY2FsbGJhY2tzW2ldXG4gICAgICAgIGlmIChjYiA9PT0gZm4gfHwgY2IuZm4gPT09IGZuKSB7XG4gICAgICAgICAgICBjYWxsYmFja3Muc3BsaWNlKGksIDEpXG4gICAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzXG59XG5cbkVtaXR0ZXJQcm90by5lbWl0ID0gZnVuY3Rpb24oZXZlbnQsIGEsIGIsIGMpe1xuICAgIHRoaXMuX2NicyA9IHRoaXMuX2NicyB8fCB7fVxuICAgIHZhciBjYWxsYmFja3MgPSB0aGlzLl9jYnNbZXZlbnRdXG5cbiAgICBpZiAoY2FsbGJhY2tzKSB7XG4gICAgICAgIGNhbGxiYWNrcyA9IGNhbGxiYWNrcy5zbGljZSgwKVxuICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gY2FsbGJhY2tzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICBjYWxsYmFja3NbaV0uY2FsbCh0aGlzLl9jdHgsIGEsIGIsIGMpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IEVtaXR0ZXIiLCJ2YXIgdXRpbHMgICAgICAgICAgID0gcmVxdWlyZSgnLi91dGlscycpLFxuICAgIFNUUl9TQVZFX1JFICAgICA9IC9cIig/OlteXCJcXFxcXXxcXFxcLikqXCJ8Jyg/OlteJ1xcXFxdfFxcXFwuKSonL2csXG4gICAgU1RSX1JFU1RPUkVfUkUgID0gL1wiKFxcZCspXCIvZyxcbiAgICBORVdMSU5FX1JFICAgICAgPSAvXFxuL2csXG4gICAgQ1RPUl9SRSAgICAgICAgID0gbmV3IFJlZ0V4cCgnY29uc3RydWN0b3InLnNwbGl0KCcnKS5qb2luKCdbXFwnXCIrLCBdKicpKSxcbiAgICBVTklDT0RFX1JFICAgICAgPSAvXFxcXHVcXGRcXGRcXGRcXGQvXG5cbi8vIFZhcmlhYmxlIGV4dHJhY3Rpb24gc2Nvb3BlZCBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9SdWJ5TG91dnJlL2F2YWxvblxuXG52YXIgS0VZV09SRFMgPVxuICAgICAgICAvLyBrZXl3b3Jkc1xuICAgICAgICAnYnJlYWssY2FzZSxjYXRjaCxjb250aW51ZSxkZWJ1Z2dlcixkZWZhdWx0LGRlbGV0ZSxkbyxlbHNlLGZhbHNlJyArXG4gICAgICAgICcsZmluYWxseSxmb3IsZnVuY3Rpb24saWYsaW4saW5zdGFuY2VvZixuZXcsbnVsbCxyZXR1cm4sc3dpdGNoLHRoaXMnICtcbiAgICAgICAgJyx0aHJvdyx0cnVlLHRyeSx0eXBlb2YsdmFyLHZvaWQsd2hpbGUsd2l0aCx1bmRlZmluZWQnICtcbiAgICAgICAgLy8gcmVzZXJ2ZWRcbiAgICAgICAgJyxhYnN0cmFjdCxib29sZWFuLGJ5dGUsY2hhcixjbGFzcyxjb25zdCxkb3VibGUsZW51bSxleHBvcnQsZXh0ZW5kcycgK1xuICAgICAgICAnLGZpbmFsLGZsb2F0LGdvdG8saW1wbGVtZW50cyxpbXBvcnQsaW50LGludGVyZmFjZSxsb25nLG5hdGl2ZScgK1xuICAgICAgICAnLHBhY2thZ2UscHJpdmF0ZSxwcm90ZWN0ZWQscHVibGljLHNob3J0LHN0YXRpYyxzdXBlcixzeW5jaHJvbml6ZWQnICtcbiAgICAgICAgJyx0aHJvd3MsdHJhbnNpZW50LHZvbGF0aWxlJyArXG4gICAgICAgIC8vIEVDTUEgNSAtIHVzZSBzdHJpY3RcbiAgICAgICAgJyxhcmd1bWVudHMsbGV0LHlpZWxkJyArXG4gICAgICAgIC8vIGFsbG93IHVzaW5nIE1hdGggaW4gZXhwcmVzc2lvbnNcbiAgICAgICAgJyxNYXRoJyxcbiAgICAgICAgXG4gICAgS0VZV09SRFNfUkUgPSBuZXcgUmVnRXhwKFtcIlxcXFxiXCIgKyBLRVlXT1JEUy5yZXBsYWNlKC8sL2csICdcXFxcYnxcXFxcYicpICsgXCJcXFxcYlwiXS5qb2luKCd8JyksICdnJyksXG4gICAgUkVNT1ZFX1JFICAgPSAvXFwvXFwqKD86LnxcXG4pKj9cXCpcXC98XFwvXFwvW15cXG5dKlxcbnxcXC9cXC9bXlxcbl0qJHwnW14nXSonfFwiW15cIl0qXCJ8W1xcc1xcdFxcbl0qXFwuW1xcc1xcdFxcbl0qWyRcXHdcXC5dKy9nLFxuICAgIFNQTElUX1JFICAgID0gL1teXFx3JF0rL2csXG4gICAgTlVNQkVSX1JFICAgPSAvXFxiXFxkW14sXSovZyxcbiAgICBCT1VOREFSWV9SRSA9IC9eLCt8LCskL2dcblxuLyoqXG4gKiAgU3RyaXAgdG9wIGxldmVsIHZhcmlhYmxlIG5hbWVzIGZyb20gYSBzbmlwcGV0IG9mIEpTIGV4cHJlc3Npb25cbiAqL1xuZnVuY3Rpb24gZ2V0VmFyaWFibGVzIChjb2RlKSB7XG4gICAgY29kZSA9IGNvZGVcbiAgICAgICAgLnJlcGxhY2UoUkVNT1ZFX1JFLCAnJylcbiAgICAgICAgLnJlcGxhY2UoU1BMSVRfUkUsICcsJylcbiAgICAgICAgLnJlcGxhY2UoS0VZV09SRFNfUkUsICcnKVxuICAgICAgICAucmVwbGFjZShOVU1CRVJfUkUsICcnKVxuICAgICAgICAucmVwbGFjZShCT1VOREFSWV9SRSwgJycpXG4gICAgcmV0dXJuIGNvZGVcbiAgICAgICAgPyBjb2RlLnNwbGl0KC8sKy8pXG4gICAgICAgIDogW11cbn1cblxuLyoqXG4gKiAgQSBnaXZlbiBwYXRoIGNvdWxkIHBvdGVudGlhbGx5IGV4aXN0IG5vdCBvbiB0aGVcbiAqICBjdXJyZW50IGNvbXBpbGVyLCBidXQgdXAgaW4gdGhlIHBhcmVudCBjaGFpbiBzb21ld2hlcmUuXG4gKiAgVGhpcyBmdW5jdGlvbiBnZW5lcmF0ZXMgYW4gYWNjZXNzIHJlbGF0aW9uc2hpcCBzdHJpbmdcbiAqICB0aGF0IGNhbiBiZSB1c2VkIGluIHRoZSBnZXR0ZXIgZnVuY3Rpb24gYnkgd2Fsa2luZyB1cFxuICogIHRoZSBwYXJlbnQgY2hhaW4gdG8gY2hlY2sgZm9yIGtleSBleGlzdGVuY2UuXG4gKlxuICogIEl0IHN0b3BzIGF0IHRvcCBwYXJlbnQgaWYgbm8gdm0gaW4gdGhlIGNoYWluIGhhcyB0aGVcbiAqICBrZXkuIEl0IHRoZW4gY3JlYXRlcyBhbnkgbWlzc2luZyBiaW5kaW5ncyBvbiB0aGVcbiAqICBmaW5hbCByZXNvbHZlZCB2bS5cbiAqL1xuZnVuY3Rpb24gdHJhY2VTY29wZSAocGF0aCwgY29tcGlsZXIsIGRhdGEpIHtcbiAgICB2YXIgcmVsICA9ICcnLFxuICAgICAgICBkaXN0ID0gMCxcbiAgICAgICAgc2VsZiA9IGNvbXBpbGVyXG5cbiAgICBpZiAoZGF0YSAmJiB1dGlscy5nZXQoZGF0YSwgcGF0aCkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBoYWNrOiB0ZW1wb3JhcmlseSBhdHRhY2hlZCBkYXRhXG4gICAgICAgIHJldHVybiAnJHRlbXAuJ1xuICAgIH1cblxuICAgIHdoaWxlIChjb21waWxlcikge1xuICAgICAgICBpZiAoY29tcGlsZXIuaGFzS2V5KHBhdGgpKSB7XG4gICAgICAgICAgICBicmVha1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29tcGlsZXIgPSBjb21waWxlci5wYXJlbnRcbiAgICAgICAgICAgIGRpc3QrK1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChjb21waWxlcikge1xuICAgICAgICB3aGlsZSAoZGlzdC0tKSB7XG4gICAgICAgICAgICByZWwgKz0gJyRwYXJlbnQuJ1xuICAgICAgICB9XG4gICAgICAgIGlmICghY29tcGlsZXIuYmluZGluZ3NbcGF0aF0gJiYgcGF0aC5jaGFyQXQoMCkgIT09ICckJykge1xuICAgICAgICAgICAgY29tcGlsZXIuY3JlYXRlQmluZGluZyhwYXRoKVxuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi5jcmVhdGVCaW5kaW5nKHBhdGgpXG4gICAgfVxuICAgIHJldHVybiByZWxcbn1cblxuLyoqXG4gKiAgQ3JlYXRlIGEgZnVuY3Rpb24gZnJvbSBhIHN0cmluZy4uLlxuICogIHRoaXMgbG9va3MgbGlrZSBldmlsIG1hZ2ljIGJ1dCBzaW5jZSBhbGwgdmFyaWFibGVzIGFyZSBsaW1pdGVkXG4gKiAgdG8gdGhlIFZNJ3MgZGF0YSBpdCdzIGFjdHVhbGx5IHByb3Blcmx5IHNhbmRib3hlZFxuICovXG5mdW5jdGlvbiBtYWtlR2V0dGVyIChleHAsIHJhdykge1xuICAgIHZhciBmblxuICAgIHRyeSB7XG4gICAgICAgIGZuID0gbmV3IEZ1bmN0aW9uKGV4cClcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHV0aWxzLndhcm4oJ0Vycm9yIHBhcnNpbmcgZXhwcmVzc2lvbjogJyArIHJhdylcbiAgICB9XG4gICAgcmV0dXJuIGZuXG59XG5cbi8qKlxuICogIEVzY2FwZSBhIGxlYWRpbmcgZG9sbGFyIHNpZ24gZm9yIHJlZ2V4IGNvbnN0cnVjdGlvblxuICovXG5mdW5jdGlvbiBlc2NhcGVEb2xsYXIgKHYpIHtcbiAgICByZXR1cm4gdi5jaGFyQXQoMCkgPT09ICckJ1xuICAgICAgICA/ICdcXFxcJyArIHZcbiAgICAgICAgOiB2XG59XG5cbi8qKlxuICogIFBhcnNlIGFuZCByZXR1cm4gYW4gYW5vbnltb3VzIGNvbXB1dGVkIHByb3BlcnR5IGdldHRlciBmdW5jdGlvblxuICogIGZyb20gYW4gYXJiaXRyYXJ5IGV4cHJlc3Npb24sIHRvZ2V0aGVyIHdpdGggYSBsaXN0IG9mIHBhdGhzIHRvIGJlXG4gKiAgY3JlYXRlZCBhcyBiaW5kaW5ncy5cbiAqL1xuZXhwb3J0cy5wYXJzZSA9IGZ1bmN0aW9uIChleHAsIGNvbXBpbGVyLCBkYXRhKSB7XG4gICAgLy8gdW5pY29kZSBhbmQgJ2NvbnN0cnVjdG9yJyBhcmUgbm90IGFsbG93ZWQgZm9yIFhTUyBzZWN1cml0eS5cbiAgICBpZiAoVU5JQ09ERV9SRS50ZXN0KGV4cCkgfHwgQ1RPUl9SRS50ZXN0KGV4cCkpIHtcbiAgICAgICAgdXRpbHMud2FybignVW5zYWZlIGV4cHJlc3Npb246ICcgKyBleHApXG4gICAgICAgIHJldHVyblxuICAgIH1cbiAgICAvLyBleHRyYWN0IHZhcmlhYmxlIG5hbWVzXG4gICAgdmFyIHZhcnMgPSBnZXRWYXJpYWJsZXMoZXhwKVxuICAgIGlmICghdmFycy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIG1ha2VHZXR0ZXIoJ3JldHVybiAnICsgZXhwLCBleHApXG4gICAgfVxuICAgIHZhcnMgPSB1dGlscy51bmlxdWUodmFycylcblxuICAgIHZhciBhY2Nlc3NvcnMgPSAnJyxcbiAgICAgICAgaGFzICAgICAgID0gdXRpbHMuaGFzaCgpLFxuICAgICAgICBzdHJpbmdzICAgPSBbXSxcbiAgICAgICAgLy8gY29uc3RydWN0IGEgcmVnZXggdG8gZXh0cmFjdCBhbGwgdmFsaWQgdmFyaWFibGUgcGF0aHNcbiAgICAgICAgLy8gb25lcyB0aGF0IGJlZ2luIHdpdGggXCIkXCIgYXJlIHBhcnRpY3VsYXJseSB0cmlja3lcbiAgICAgICAgLy8gYmVjYXVzZSB3ZSBjYW4ndCB1c2UgXFxiIGZvciB0aGVtXG4gICAgICAgIHBhdGhSRSA9IG5ldyBSZWdFeHAoXG4gICAgICAgICAgICBcIlteJFxcXFx3XFxcXC5dKFwiICtcbiAgICAgICAgICAgIHZhcnMubWFwKGVzY2FwZURvbGxhcikuam9pbignfCcpICtcbiAgICAgICAgICAgIFwiKVskXFxcXHdcXFxcLl0qXFxcXGJcIiwgJ2cnXG4gICAgICAgICksXG4gICAgICAgIGJvZHkgPSAoJyAnICsgZXhwKVxuICAgICAgICAgICAgLnJlcGxhY2UoU1RSX1NBVkVfUkUsIHNhdmVTdHJpbmdzKVxuICAgICAgICAgICAgLnJlcGxhY2UocGF0aFJFLCByZXBsYWNlUGF0aClcbiAgICAgICAgICAgIC5yZXBsYWNlKFNUUl9SRVNUT1JFX1JFLCByZXN0b3JlU3RyaW5ncylcblxuICAgIGJvZHkgPSBhY2Nlc3NvcnMgKyAncmV0dXJuICcgKyBib2R5XG5cbiAgICBmdW5jdGlvbiBzYXZlU3RyaW5ncyAoc3RyKSB7XG4gICAgICAgIHZhciBpID0gc3RyaW5ncy5sZW5ndGhcbiAgICAgICAgLy8gZXNjYXBlIG5ld2xpbmVzIGluIHN0cmluZ3Mgc28gdGhlIGV4cHJlc3Npb25cbiAgICAgICAgLy8gY2FuIGJlIGNvcnJlY3RseSBldmFsdWF0ZWRcbiAgICAgICAgc3RyaW5nc1tpXSA9IHN0ci5yZXBsYWNlKE5FV0xJTkVfUkUsICdcXFxcbicpXG4gICAgICAgIHJldHVybiAnXCInICsgaSArICdcIidcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZXBsYWNlUGF0aCAocGF0aCkge1xuICAgICAgICAvLyBrZWVwIHRyYWNrIG9mIHRoZSBmaXJzdCBjaGFyXG4gICAgICAgIHZhciBjID0gcGF0aC5jaGFyQXQoMClcbiAgICAgICAgcGF0aCA9IHBhdGguc2xpY2UoMSlcbiAgICAgICAgdmFyIHZhbCA9ICd0aGlzLicgKyB0cmFjZVNjb3BlKHBhdGgsIGNvbXBpbGVyLCBkYXRhKSArIHBhdGhcbiAgICAgICAgaWYgKCFoYXNbcGF0aF0pIHtcbiAgICAgICAgICAgIGFjY2Vzc29ycyArPSB2YWwgKyAnOydcbiAgICAgICAgICAgIGhhc1twYXRoXSA9IDFcbiAgICAgICAgfVxuICAgICAgICAvLyBkb24ndCBmb3JnZXQgdG8gcHV0IHRoYXQgZmlyc3QgY2hhciBiYWNrXG4gICAgICAgIHJldHVybiBjICsgdmFsXG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVzdG9yZVN0cmluZ3MgKHN0ciwgaSkge1xuICAgICAgICByZXR1cm4gc3RyaW5nc1tpXVxuICAgIH1cblxuICAgIHJldHVybiBtYWtlR2V0dGVyKGJvZHksIGV4cClcbn1cblxuLyoqXG4gKiAgRXZhbHVhdGUgYW4gZXhwcmVzc2lvbiBpbiB0aGUgY29udGV4dCBvZiBhIGNvbXBpbGVyLlxuICogIEFjY2VwdHMgYWRkaXRpb25hbCBkYXRhLlxuICovXG5leHBvcnRzLmV2YWwgPSBmdW5jdGlvbiAoZXhwLCBjb21waWxlciwgZGF0YSkge1xuICAgIHZhciBnZXR0ZXIgPSBleHBvcnRzLnBhcnNlKGV4cCwgY29tcGlsZXIsIGRhdGEpLCByZXNcbiAgICBpZiAoZ2V0dGVyKSB7XG4gICAgICAgIC8vIGhhY2s6IHRlbXBvcmFyaWx5IGF0dGFjaCB0aGUgYWRkaXRpb25hbCBkYXRhIHNvXG4gICAgICAgIC8vIGl0IGNhbiBiZSBhY2Nlc3NlZCBpbiB0aGUgZ2V0dGVyXG4gICAgICAgIGNvbXBpbGVyLnZtLiR0ZW1wID0gZGF0YVxuICAgICAgICByZXMgPSBnZXR0ZXIuY2FsbChjb21waWxlci52bSlcbiAgICAgICAgZGVsZXRlIGNvbXBpbGVyLnZtLiR0ZW1wXG4gICAgfVxuICAgIHJldHVybiByZXNcbn0iLCJ2YXIgdXRpbHMgICAgPSByZXF1aXJlKCcuL3V0aWxzJyksXG4gICAgZ2V0ICAgICAgPSB1dGlscy5nZXQsXG4gICAgc2xpY2UgICAgPSBbXS5zbGljZSxcbiAgICBRVU9URV9SRSA9IC9eJy4qJyQvLFxuICAgIGZpbHRlcnMgID0gbW9kdWxlLmV4cG9ydHMgPSB1dGlscy5oYXNoKClcblxuLyoqXG4gKiAgJ2FiYycgPT4gJ0FiYydcbiAqL1xuZmlsdGVycy5jYXBpdGFsaXplID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgaWYgKCF2YWx1ZSAmJiB2YWx1ZSAhPT0gMCkgcmV0dXJuICcnXG4gICAgdmFsdWUgPSB2YWx1ZS50b1N0cmluZygpXG4gICAgcmV0dXJuIHZhbHVlLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgdmFsdWUuc2xpY2UoMSlcbn1cblxuLyoqXG4gKiAgJ2FiYycgPT4gJ0FCQydcbiAqL1xuZmlsdGVycy51cHBlcmNhc2UgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICByZXR1cm4gKHZhbHVlIHx8IHZhbHVlID09PSAwKVxuICAgICAgICA/IHZhbHVlLnRvU3RyaW5nKCkudG9VcHBlckNhc2UoKVxuICAgICAgICA6ICcnXG59XG5cbi8qKlxuICogICdBYkMnID0+ICdhYmMnXG4gKi9cbmZpbHRlcnMubG93ZXJjYXNlID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgcmV0dXJuICh2YWx1ZSB8fCB2YWx1ZSA9PT0gMClcbiAgICAgICAgPyB2YWx1ZS50b1N0cmluZygpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgOiAnJ1xufVxuXG4vKipcbiAqICAxMjM0NSA9PiAkMTIsMzQ1LjAwXG4gKi9cbmZpbHRlcnMuY3VycmVuY3kgPSBmdW5jdGlvbiAodmFsdWUsIHNpZ24pIHtcbiAgICBpZiAoIXZhbHVlICYmIHZhbHVlICE9PSAwKSByZXR1cm4gJydcbiAgICBzaWduID0gc2lnbiB8fCAnJCdcbiAgICB2YXIgcyA9IE1hdGguZmxvb3IodmFsdWUpLnRvU3RyaW5nKCksXG4gICAgICAgIGkgPSBzLmxlbmd0aCAlIDMsXG4gICAgICAgIGggPSBpID4gMCA/IChzLnNsaWNlKDAsIGkpICsgKHMubGVuZ3RoID4gMyA/ICcsJyA6ICcnKSkgOiAnJyxcbiAgICAgICAgZiA9ICcuJyArIHZhbHVlLnRvRml4ZWQoMikuc2xpY2UoLTIpXG4gICAgcmV0dXJuIHNpZ24gKyBoICsgcy5zbGljZShpKS5yZXBsYWNlKC8oXFxkezN9KSg/PVxcZCkvZywgJyQxLCcpICsgZlxufVxuXG4vKipcbiAqICBhcmdzOiBhbiBhcnJheSBvZiBzdHJpbmdzIGNvcnJlc3BvbmRpbmcgdG9cbiAqICB0aGUgc2luZ2xlLCBkb3VibGUsIHRyaXBsZSAuLi4gZm9ybXMgb2YgdGhlIHdvcmQgdG9cbiAqICBiZSBwbHVyYWxpemVkLiBXaGVuIHRoZSBudW1iZXIgdG8gYmUgcGx1cmFsaXplZFxuICogIGV4Y2VlZHMgdGhlIGxlbmd0aCBvZiB0aGUgYXJncywgaXQgd2lsbCB1c2UgdGhlIGxhc3RcbiAqICBlbnRyeSBpbiB0aGUgYXJyYXkuXG4gKlxuICogIGUuZy4gWydzaW5nbGUnLCAnZG91YmxlJywgJ3RyaXBsZScsICdtdWx0aXBsZSddXG4gKi9cbmZpbHRlcnMucGx1cmFsaXplID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgdmFyIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICByZXR1cm4gYXJncy5sZW5ndGggPiAxXG4gICAgICAgID8gKGFyZ3NbdmFsdWUgLSAxXSB8fCBhcmdzW2FyZ3MubGVuZ3RoIC0gMV0pXG4gICAgICAgIDogKGFyZ3NbdmFsdWUgLSAxXSB8fCBhcmdzWzBdICsgJ3MnKVxufVxuXG4vKipcbiAqICBBIHNwZWNpYWwgZmlsdGVyIHRoYXQgdGFrZXMgYSBoYW5kbGVyIGZ1bmN0aW9uLFxuICogIHdyYXBzIGl0IHNvIGl0IG9ubHkgZ2V0cyB0cmlnZ2VyZWQgb24gc3BlY2lmaWMga2V5cHJlc3Nlcy5cbiAqXG4gKiAgdi1vbiBvbmx5XG4gKi9cblxudmFyIGtleUNvZGVzID0ge1xuICAgIGVudGVyICAgIDogMTMsXG4gICAgdGFiICAgICAgOiA5LFxuICAgICdkZWxldGUnIDogNDYsXG4gICAgdXAgICAgICAgOiAzOCxcbiAgICBsZWZ0ICAgICA6IDM3LFxuICAgIHJpZ2h0ICAgIDogMzksXG4gICAgZG93biAgICAgOiA0MCxcbiAgICBlc2MgICAgICA6IDI3XG59XG5cbmZpbHRlcnMua2V5ID0gZnVuY3Rpb24gKGhhbmRsZXIsIGtleSkge1xuICAgIGlmICghaGFuZGxlcikgcmV0dXJuXG4gICAgdmFyIGNvZGUgPSBrZXlDb2Rlc1trZXldXG4gICAgaWYgKCFjb2RlKSB7XG4gICAgICAgIGNvZGUgPSBwYXJzZUludChrZXksIDEwKVxuICAgIH1cbiAgICByZXR1cm4gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgaWYgKGUua2V5Q29kZSA9PT0gY29kZSkge1xuICAgICAgICAgICAgcmV0dXJuIGhhbmRsZXIuY2FsbCh0aGlzLCBlKVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqICBGaWx0ZXIgZmlsdGVyIGZvciB2LXJlcGVhdFxuICovXG5maWx0ZXJzLmZpbHRlckJ5ID0gZnVuY3Rpb24gKGFyciwgc2VhcmNoS2V5LCBkZWxpbWl0ZXIsIGRhdGFLZXkpIHtcblxuICAgIC8vIGFsbG93IG9wdGlvbmFsIGBpbmAgZGVsaW1pdGVyXG4gICAgLy8gYmVjYXVzZSB3aHkgbm90XG4gICAgaWYgKGRlbGltaXRlciAmJiBkZWxpbWl0ZXIgIT09ICdpbicpIHtcbiAgICAgICAgZGF0YUtleSA9IGRlbGltaXRlclxuICAgIH1cblxuICAgIC8vIGdldCB0aGUgc2VhcmNoIHN0cmluZ1xuICAgIHZhciBzZWFyY2ggPSBzdHJpcFF1b3RlcyhzZWFyY2hLZXkpIHx8IHRoaXMuJGdldChzZWFyY2hLZXkpXG4gICAgaWYgKCFzZWFyY2gpIHJldHVybiBhcnJcbiAgICBzZWFyY2ggPSBzZWFyY2gudG9Mb3dlckNhc2UoKVxuXG4gICAgLy8gZ2V0IHRoZSBvcHRpb25hbCBkYXRhS2V5XG4gICAgZGF0YUtleSA9IGRhdGFLZXkgJiYgKHN0cmlwUXVvdGVzKGRhdGFLZXkpIHx8IHRoaXMuJGdldChkYXRhS2V5KSlcblxuICAgIC8vIGNvbnZlcnQgb2JqZWN0IHRvIGFycmF5XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGFycikpIHtcbiAgICAgICAgYXJyID0gdXRpbHMub2JqZWN0VG9BcnJheShhcnIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGFyci5maWx0ZXIoZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgcmV0dXJuIGRhdGFLZXlcbiAgICAgICAgICAgID8gY29udGFpbnMoZ2V0KGl0ZW0sIGRhdGFLZXkpLCBzZWFyY2gpXG4gICAgICAgICAgICA6IGNvbnRhaW5zKGl0ZW0sIHNlYXJjaClcbiAgICB9KVxuXG59XG5cbmZpbHRlcnMuZmlsdGVyQnkuY29tcHV0ZWQgPSB0cnVlXG5cbi8qKlxuICogIFNvcnQgZml0bGVyIGZvciB2LXJlcGVhdFxuICovXG5maWx0ZXJzLm9yZGVyQnkgPSBmdW5jdGlvbiAoYXJyLCBzb3J0S2V5LCByZXZlcnNlS2V5KSB7XG5cbiAgICB2YXIga2V5ID0gc3RyaXBRdW90ZXMoc29ydEtleSkgfHwgdGhpcy4kZ2V0KHNvcnRLZXkpXG4gICAgaWYgKCFrZXkpIHJldHVybiBhcnJcblxuICAgIC8vIGNvbnZlcnQgb2JqZWN0IHRvIGFycmF5XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGFycikpIHtcbiAgICAgICAgYXJyID0gdXRpbHMub2JqZWN0VG9BcnJheShhcnIpXG4gICAgfVxuXG4gICAgdmFyIG9yZGVyID0gMVxuICAgIGlmIChyZXZlcnNlS2V5KSB7XG4gICAgICAgIGlmIChyZXZlcnNlS2V5ID09PSAnLTEnKSB7XG4gICAgICAgICAgICBvcmRlciA9IC0xXG4gICAgICAgIH0gZWxzZSBpZiAocmV2ZXJzZUtleS5jaGFyQXQoMCkgPT09ICchJykge1xuICAgICAgICAgICAgcmV2ZXJzZUtleSA9IHJldmVyc2VLZXkuc2xpY2UoMSlcbiAgICAgICAgICAgIG9yZGVyID0gdGhpcy4kZ2V0KHJldmVyc2VLZXkpID8gMSA6IC0xXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvcmRlciA9IHRoaXMuJGdldChyZXZlcnNlS2V5KSA/IC0xIDogMVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gc29ydCBvbiBhIGNvcHkgdG8gYXZvaWQgbXV0YXRpbmcgb3JpZ2luYWwgYXJyYXlcbiAgICByZXR1cm4gYXJyLnNsaWNlKCkuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICBhID0gZ2V0KGEsIGtleSlcbiAgICAgICAgYiA9IGdldChiLCBrZXkpXG4gICAgICAgIHJldHVybiBhID09PSBiID8gMCA6IGEgPiBiID8gb3JkZXIgOiAtb3JkZXJcbiAgICB9KVxuXG59XG5cbmZpbHRlcnMub3JkZXJCeS5jb21wdXRlZCA9IHRydWVcblxuLy8gQXJyYXkgZmlsdGVyIGhlbHBlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqICBTdHJpbmcgY29udGFpbiBoZWxwZXJcbiAqL1xuZnVuY3Rpb24gY29udGFpbnMgKHZhbCwgc2VhcmNoKSB7XG4gICAgLyoganNoaW50IGVxZXFlcTogZmFsc2UgKi9cbiAgICBpZiAodXRpbHMuaXNPYmplY3QodmFsKSkge1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gdmFsKSB7XG4gICAgICAgICAgICBpZiAoY29udGFpbnModmFsW2tleV0sIHNlYXJjaCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSBlbHNlIGlmICh2YWwgIT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gdmFsLnRvU3RyaW5nKCkudG9Mb3dlckNhc2UoKS5pbmRleE9mKHNlYXJjaCkgPiAtMVxuICAgIH1cbn1cblxuLyoqXG4gKiAgVGVzdCB3aGV0aGVyIGEgc3RyaW5nIGlzIGluIHF1b3RlcyxcbiAqICBpZiB5ZXMgcmV0dXJuIHN0cmlwcGVkIHN0cmluZ1xuICovXG5mdW5jdGlvbiBzdHJpcFF1b3RlcyAoc3RyKSB7XG4gICAgaWYgKFFVT1RFX1JFLnRlc3Qoc3RyKSkge1xuICAgICAgICByZXR1cm4gc3RyLnNsaWNlKDEsIC0xKVxuICAgIH1cbn0iLCJ2YXIgY29uZmlnICAgICAgPSByZXF1aXJlKCcuL2NvbmZpZycpLFxuICAgIFZpZXdNb2RlbCAgID0gcmVxdWlyZSgnLi92aWV3bW9kZWwnKSxcbiAgICB1dGlscyAgICAgICA9IHJlcXVpcmUoJy4vdXRpbHMnKSxcbiAgICBtYWtlSGFzaCAgICA9IHV0aWxzLmhhc2gsXG4gICAgYXNzZXRUeXBlcyAgPSBbJ2RpcmVjdGl2ZScsICdmaWx0ZXInLCAncGFydGlhbCcsICdlZmZlY3QnLCAnY29tcG9uZW50J11cblxuLy8gcmVxdWlyZSB0aGVzZSBzbyBCcm93c2VyaWZ5IGNhbiBjYXRjaCB0aGVtXG4vLyBzbyB0aGV5IGNhbiBiZSB1c2VkIGluIFZ1ZS5yZXF1aXJlXG5yZXF1aXJlKCcuL29ic2VydmVyJylcbnJlcXVpcmUoJy4vdHJhbnNpdGlvbicpXG5cblZpZXdNb2RlbC5vcHRpb25zID0gY29uZmlnLmdsb2JhbEFzc2V0cyA9IHtcbiAgICBkaXJlY3RpdmVzICA6IHJlcXVpcmUoJy4vZGlyZWN0aXZlcycpLFxuICAgIGZpbHRlcnMgICAgIDogcmVxdWlyZSgnLi9maWx0ZXJzJyksXG4gICAgcGFydGlhbHMgICAgOiBtYWtlSGFzaCgpLFxuICAgIGVmZmVjdHMgICAgIDogbWFrZUhhc2goKSxcbiAgICBjb21wb25lbnRzICA6IG1ha2VIYXNoKClcbn1cblxuLyoqXG4gKiAgRXhwb3NlIGFzc2V0IHJlZ2lzdHJhdGlvbiBtZXRob2RzXG4gKi9cbmFzc2V0VHlwZXMuZm9yRWFjaChmdW5jdGlvbiAodHlwZSkge1xuICAgIFZpZXdNb2RlbFt0eXBlXSA9IGZ1bmN0aW9uIChpZCwgdmFsdWUpIHtcbiAgICAgICAgdmFyIGhhc2ggPSB0aGlzLm9wdGlvbnNbdHlwZSArICdzJ11cbiAgICAgICAgaWYgKCFoYXNoKSB7XG4gICAgICAgICAgICBoYXNoID0gdGhpcy5vcHRpb25zW3R5cGUgKyAncyddID0gbWFrZUhhc2goKVxuICAgICAgICB9XG4gICAgICAgIGlmICghdmFsdWUpIHJldHVybiBoYXNoW2lkXVxuICAgICAgICBpZiAodHlwZSA9PT0gJ3BhcnRpYWwnKSB7XG4gICAgICAgICAgICB2YWx1ZSA9IHV0aWxzLnRvRnJhZ21lbnQodmFsdWUpXG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ2NvbXBvbmVudCcpIHtcbiAgICAgICAgICAgIHZhbHVlID0gdXRpbHMudG9Db25zdHJ1Y3Rvcih2YWx1ZSlcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnZmlsdGVyJykge1xuICAgICAgICAgICAgdXRpbHMuY2hlY2tGaWx0ZXIodmFsdWUpXG4gICAgICAgIH1cbiAgICAgICAgaGFzaFtpZF0gPSB2YWx1ZVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cbn0pXG5cbi8qKlxuICogIFNldCBjb25maWcgb3B0aW9uc1xuICovXG5WaWV3TW9kZWwuY29uZmlnID0gZnVuY3Rpb24gKG9wdHMsIHZhbCkge1xuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgaWYgKHZhbCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gY29uZmlnW29wdHNdXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25maWdbb3B0c10gPSB2YWxcbiAgICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAgIHV0aWxzLmV4dGVuZChjb25maWcsIG9wdHMpXG4gICAgfVxuICAgIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogIEV4cG9zZSBhbiBpbnRlcmZhY2UgZm9yIHBsdWdpbnNcbiAqL1xuVmlld01vZGVsLnVzZSA9IGZ1bmN0aW9uIChwbHVnaW4pIHtcbiAgICBpZiAodHlwZW9mIHBsdWdpbiA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHBsdWdpbiA9IHJlcXVpcmUocGx1Z2luKVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICB1dGlscy53YXJuKCdDYW5ub3QgZmluZCBwbHVnaW46ICcgKyBwbHVnaW4pXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGFkZGl0aW9uYWwgcGFyYW1ldGVyc1xuICAgIHZhciBhcmdzID0gW10uc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXG4gICAgYXJncy51bnNoaWZ0KHRoaXMpXG5cbiAgICBpZiAodHlwZW9mIHBsdWdpbi5pbnN0YWxsID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHBsdWdpbi5pbnN0YWxsLmFwcGx5KHBsdWdpbiwgYXJncylcbiAgICB9IGVsc2Uge1xuICAgICAgICBwbHVnaW4uYXBwbHkobnVsbCwgYXJncylcbiAgICB9XG4gICAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiAgRXhwb3NlIGludGVybmFsIG1vZHVsZXMgZm9yIHBsdWdpbnNcbiAqL1xuVmlld01vZGVsLnJlcXVpcmUgPSBmdW5jdGlvbiAocGF0aCkge1xuICAgIHJldHVybiByZXF1aXJlKCcuLycgKyBwYXRoKVxufVxuXG5WaWV3TW9kZWwuZXh0ZW5kID0gZXh0ZW5kXG5WaWV3TW9kZWwubmV4dFRpY2sgPSB1dGlscy5uZXh0VGlja1xuXG4vKipcbiAqICBFeHBvc2UgdGhlIG1haW4gVmlld01vZGVsIGNsYXNzXG4gKiAgYW5kIGFkZCBleHRlbmQgbWV0aG9kXG4gKi9cbmZ1bmN0aW9uIGV4dGVuZCAob3B0aW9ucykge1xuXG4gICAgdmFyIFBhcmVudFZNID0gdGhpc1xuXG4gICAgLy8gZXh0ZW5kIGRhdGEgb3B0aW9ucyBuZWVkIHRvIGJlIGNvcGllZFxuICAgIC8vIG9uIGluc3RhbnRpYXRpb25cbiAgICBpZiAob3B0aW9ucy5kYXRhKSB7XG4gICAgICAgIG9wdGlvbnMuZGVmYXVsdERhdGEgPSBvcHRpb25zLmRhdGFcbiAgICAgICAgZGVsZXRlIG9wdGlvbnMuZGF0YVxuICAgIH1cblxuICAgIC8vIGluaGVyaXQgb3B0aW9uc1xuICAgIG9wdGlvbnMgPSBpbmhlcml0T3B0aW9ucyhvcHRpb25zLCBQYXJlbnRWTS5vcHRpb25zLCB0cnVlKVxuICAgIHV0aWxzLnByb2Nlc3NPcHRpb25zKG9wdGlvbnMpXG5cbiAgICB2YXIgRXh0ZW5kZWRWTSA9IGZ1bmN0aW9uIChvcHRzLCBhc1BhcmVudCkge1xuICAgICAgICBpZiAoIWFzUGFyZW50KSB7XG4gICAgICAgICAgICBvcHRzID0gaW5oZXJpdE9wdGlvbnMob3B0cywgb3B0aW9ucywgdHJ1ZSlcbiAgICAgICAgfVxuICAgICAgICBQYXJlbnRWTS5jYWxsKHRoaXMsIG9wdHMsIHRydWUpXG4gICAgfVxuXG4gICAgLy8gaW5oZXJpdCBwcm90b3R5cGUgcHJvcHNcbiAgICB2YXIgcHJvdG8gPSBFeHRlbmRlZFZNLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoUGFyZW50Vk0ucHJvdG90eXBlKVxuICAgIHV0aWxzLmRlZlByb3RlY3RlZChwcm90bywgJ2NvbnN0cnVjdG9yJywgRXh0ZW5kZWRWTSlcblxuICAgIC8vIGFsbG93IGV4dGVuZGVkIFZNIHRvIGJlIGZ1cnRoZXIgZXh0ZW5kZWRcbiAgICBFeHRlbmRlZFZNLmV4dGVuZCAgPSBleHRlbmRcbiAgICBFeHRlbmRlZFZNLnN1cGVyICAgPSBQYXJlbnRWTVxuICAgIEV4dGVuZGVkVk0ub3B0aW9ucyA9IG9wdGlvbnNcblxuICAgIC8vIGFsbG93IGV4dGVuZGVkIFZNIHRvIGFkZCBpdHMgb3duIGFzc2V0c1xuICAgIGFzc2V0VHlwZXMuZm9yRWFjaChmdW5jdGlvbiAodHlwZSkge1xuICAgICAgICBFeHRlbmRlZFZNW3R5cGVdID0gVmlld01vZGVsW3R5cGVdXG4gICAgfSlcblxuICAgIC8vIGFsbG93IGV4dGVuZGVkIFZNIHRvIHVzZSBwbHVnaW5zXG4gICAgRXh0ZW5kZWRWTS51c2UgICAgID0gVmlld01vZGVsLnVzZVxuICAgIEV4dGVuZGVkVk0ucmVxdWlyZSA9IFZpZXdNb2RlbC5yZXF1aXJlXG5cbiAgICByZXR1cm4gRXh0ZW5kZWRWTVxufVxuXG4vKipcbiAqICBJbmhlcml0IG9wdGlvbnNcbiAqXG4gKiAgRm9yIG9wdGlvbnMgc3VjaCBhcyBgZGF0YWAsIGB2bXNgLCBgZGlyZWN0aXZlc2AsICdwYXJ0aWFscycsXG4gKiAgdGhleSBzaG91bGQgYmUgZnVydGhlciBleHRlbmRlZC4gSG93ZXZlciBleHRlbmRpbmcgc2hvdWxkIG9ubHlcbiAqICBiZSBkb25lIGF0IHRvcCBsZXZlbC5cbiAqICBcbiAqICBgcHJvdG9gIGlzIGFuIGV4Y2VwdGlvbiBiZWNhdXNlIGl0J3MgaGFuZGxlZCBkaXJlY3RseSBvbiB0aGVcbiAqICBwcm90b3R5cGUuXG4gKlxuICogIGBlbGAgaXMgYW4gZXhjZXB0aW9uIGJlY2F1c2UgaXQncyBub3QgYWxsb3dlZCBhcyBhblxuICogIGV4dGVuc2lvbiBvcHRpb24sIGJ1dCBvbmx5IGFzIGFuIGluc3RhbmNlIG9wdGlvbi5cbiAqL1xuZnVuY3Rpb24gaW5oZXJpdE9wdGlvbnMgKGNoaWxkLCBwYXJlbnQsIHRvcExldmVsKSB7XG4gICAgY2hpbGQgPSBjaGlsZCB8fCB7fVxuICAgIGlmICghcGFyZW50KSByZXR1cm4gY2hpbGRcbiAgICBmb3IgKHZhciBrZXkgaW4gcGFyZW50KSB7XG4gICAgICAgIGlmIChrZXkgPT09ICdlbCcpIGNvbnRpbnVlXG4gICAgICAgIHZhciB2YWwgPSBjaGlsZFtrZXldLFxuICAgICAgICAgICAgcGFyZW50VmFsID0gcGFyZW50W2tleV1cbiAgICAgICAgaWYgKHRvcExldmVsICYmIHR5cGVvZiB2YWwgPT09ICdmdW5jdGlvbicgJiYgcGFyZW50VmFsKSB7XG4gICAgICAgICAgICAvLyBtZXJnZSBob29rIGZ1bmN0aW9ucyBpbnRvIGFuIGFycmF5XG4gICAgICAgICAgICBjaGlsZFtrZXldID0gW3ZhbF1cbiAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcmVudFZhbCkpIHtcbiAgICAgICAgICAgICAgICBjaGlsZFtrZXldID0gY2hpbGRba2V5XS5jb25jYXQocGFyZW50VmFsKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjaGlsZFtrZXldLnB1c2gocGFyZW50VmFsKVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKFxuICAgICAgICAgICAgdG9wTGV2ZWwgJiZcbiAgICAgICAgICAgICh1dGlscy5pc1RydWVPYmplY3QodmFsKSB8fCB1dGlscy5pc1RydWVPYmplY3QocGFyZW50VmFsKSlcbiAgICAgICAgICAgICYmICEocGFyZW50VmFsIGluc3RhbmNlb2YgVmlld01vZGVsKVxuICAgICAgICApIHtcbiAgICAgICAgICAgIC8vIG1lcmdlIHRvcGxldmVsIG9iamVjdCBvcHRpb25zXG4gICAgICAgICAgICBjaGlsZFtrZXldID0gaW5oZXJpdE9wdGlvbnModmFsLCBwYXJlbnRWYWwpXG4gICAgICAgIH0gZWxzZSBpZiAodmFsID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIC8vIGluaGVyaXQgaWYgY2hpbGQgZG9lc24ndCBvdmVycmlkZVxuICAgICAgICAgICAgY2hpbGRba2V5XSA9IHBhcmVudFZhbFxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjaGlsZFxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXdNb2RlbCIsIi8qIGpzaGludCBwcm90bzp0cnVlICovXG5cbnZhciBFbWl0dGVyICA9IHJlcXVpcmUoJy4vZW1pdHRlcicpLFxuICAgIHV0aWxzICAgID0gcmVxdWlyZSgnLi91dGlscycpLFxuICAgIC8vIGNhY2hlIG1ldGhvZHNcbiAgICBkZWYgICAgICA9IHV0aWxzLmRlZlByb3RlY3RlZCxcbiAgICBpc09iamVjdCA9IHV0aWxzLmlzT2JqZWN0LFxuICAgIGlzQXJyYXkgID0gQXJyYXkuaXNBcnJheSxcbiAgICBoYXNPd24gICA9ICh7fSkuaGFzT3duUHJvcGVydHksXG4gICAgb0RlZiAgICAgPSBPYmplY3QuZGVmaW5lUHJvcGVydHksXG4gICAgc2xpY2UgICAgPSBbXS5zbGljZSxcbiAgICAvLyBmaXggZm9yIElFICsgX19wcm90b19fIHByb2JsZW1cbiAgICAvLyBkZWZpbmUgbWV0aG9kcyBhcyBpbmVudW1lcmFibGUgaWYgX19wcm90b19fIGlzIHByZXNlbnQsXG4gICAgLy8gb3RoZXJ3aXNlIGVudW1lcmFibGUgc28gd2UgY2FuIGxvb3AgdGhyb3VnaCBhbmQgbWFudWFsbHlcbiAgICAvLyBhdHRhY2ggdG8gYXJyYXkgaW5zdGFuY2VzXG4gICAgaGFzUHJvdG8gPSAoe30pLl9fcHJvdG9fX1xuXG4vLyBBcnJheSBNdXRhdGlvbiBIYW5kbGVycyAmIEF1Z21lbnRhdGlvbnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIFRoZSBwcm94eSBwcm90b3R5cGUgdG8gcmVwbGFjZSB0aGUgX19wcm90b19fIG9mXG4vLyBhbiBvYnNlcnZlZCBhcnJheVxudmFyIEFycmF5UHJveHkgPSBPYmplY3QuY3JlYXRlKEFycmF5LnByb3RvdHlwZSlcblxuLy8gaW50ZXJjZXB0IG11dGF0aW9uIG1ldGhvZHNcbjtbXG4gICAgJ3B1c2gnLFxuICAgICdwb3AnLFxuICAgICdzaGlmdCcsXG4gICAgJ3Vuc2hpZnQnLFxuICAgICdzcGxpY2UnLFxuICAgICdzb3J0JyxcbiAgICAncmV2ZXJzZSdcbl0uZm9yRWFjaCh3YXRjaE11dGF0aW9uKVxuXG4vLyBBdWdtZW50IHRoZSBBcnJheVByb3h5IHdpdGggY29udmVuaWVuY2UgbWV0aG9kc1xuZGVmKEFycmF5UHJveHksICckc2V0JywgZnVuY3Rpb24gKGluZGV4LCBkYXRhKSB7XG4gICAgcmV0dXJuIHRoaXMuc3BsaWNlKGluZGV4LCAxLCBkYXRhKVswXVxufSwgIWhhc1Byb3RvKVxuXG5kZWYoQXJyYXlQcm94eSwgJyRyZW1vdmUnLCBmdW5jdGlvbiAoaW5kZXgpIHtcbiAgICBpZiAodHlwZW9mIGluZGV4ICE9PSAnbnVtYmVyJykge1xuICAgICAgICBpbmRleCA9IHRoaXMuaW5kZXhPZihpbmRleClcbiAgICB9XG4gICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3BsaWNlKGluZGV4LCAxKVswXVxuICAgIH1cbn0sICFoYXNQcm90bylcblxuLyoqXG4gKiAgSW50ZXJjZXAgYSBtdXRhdGlvbiBldmVudCBzbyB3ZSBjYW4gZW1pdCB0aGUgbXV0YXRpb24gaW5mby5cbiAqICB3ZSBhbHNvIGFuYWx5emUgd2hhdCBlbGVtZW50cyBhcmUgYWRkZWQvcmVtb3ZlZCBhbmQgbGluay91bmxpbmtcbiAqICB0aGVtIHdpdGggdGhlIHBhcmVudCBBcnJheS5cbiAqL1xuZnVuY3Rpb24gd2F0Y2hNdXRhdGlvbiAobWV0aG9kKSB7XG4gICAgZGVmKEFycmF5UHJveHksIG1ldGhvZCwgZnVuY3Rpb24gKCkge1xuXG4gICAgICAgIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMpLFxuICAgICAgICAgICAgcmVzdWx0ID0gQXJyYXkucHJvdG90eXBlW21ldGhvZF0uYXBwbHkodGhpcywgYXJncyksXG4gICAgICAgICAgICBpbnNlcnRlZCwgcmVtb3ZlZFxuXG4gICAgICAgIC8vIGRldGVybWluZSBuZXcgLyByZW1vdmVkIGVsZW1lbnRzXG4gICAgICAgIGlmIChtZXRob2QgPT09ICdwdXNoJyB8fCBtZXRob2QgPT09ICd1bnNoaWZ0Jykge1xuICAgICAgICAgICAgaW5zZXJ0ZWQgPSBhcmdzXG4gICAgICAgIH0gZWxzZSBpZiAobWV0aG9kID09PSAncG9wJyB8fCBtZXRob2QgPT09ICdzaGlmdCcpIHtcbiAgICAgICAgICAgIHJlbW92ZWQgPSBbcmVzdWx0XVxuICAgICAgICB9IGVsc2UgaWYgKG1ldGhvZCA9PT0gJ3NwbGljZScpIHtcbiAgICAgICAgICAgIGluc2VydGVkID0gYXJncy5zbGljZSgyKVxuICAgICAgICAgICAgcmVtb3ZlZCA9IHJlc3VsdFxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBsaW5rICYgdW5saW5rXG4gICAgICAgIGxpbmtBcnJheUVsZW1lbnRzKHRoaXMsIGluc2VydGVkKVxuICAgICAgICB1bmxpbmtBcnJheUVsZW1lbnRzKHRoaXMsIHJlbW92ZWQpXG5cbiAgICAgICAgLy8gZW1pdCB0aGUgbXV0YXRpb24gZXZlbnRcbiAgICAgICAgdGhpcy5fX2VtaXR0ZXJfXy5lbWl0KCdtdXRhdGUnLCAnJywgdGhpcywge1xuICAgICAgICAgICAgbWV0aG9kICAgOiBtZXRob2QsXG4gICAgICAgICAgICBhcmdzICAgICA6IGFyZ3MsXG4gICAgICAgICAgICByZXN1bHQgICA6IHJlc3VsdCxcbiAgICAgICAgICAgIGluc2VydGVkIDogaW5zZXJ0ZWQsXG4gICAgICAgICAgICByZW1vdmVkICA6IHJlbW92ZWRcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICAgIFxuICAgIH0sICFoYXNQcm90bylcbn1cblxuLyoqXG4gKiAgTGluayBuZXcgZWxlbWVudHMgdG8gYW4gQXJyYXksIHNvIHdoZW4gdGhleSBjaGFuZ2VcbiAqICBhbmQgZW1pdCBldmVudHMsIHRoZSBvd25lciBBcnJheSBjYW4gYmUgbm90aWZpZWQuXG4gKi9cbmZ1bmN0aW9uIGxpbmtBcnJheUVsZW1lbnRzIChhcnIsIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW1zKSB7XG4gICAgICAgIHZhciBpID0gaXRlbXMubGVuZ3RoLCBpdGVtLCBvd25lcnNcbiAgICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICAgICAgaXRlbSA9IGl0ZW1zW2ldXG4gICAgICAgICAgICBpZiAoaXNXYXRjaGFibGUoaXRlbSkpIHtcbiAgICAgICAgICAgICAgICAvLyBpZiBvYmplY3QgaXMgbm90IGNvbnZlcnRlZCBmb3Igb2JzZXJ2aW5nXG4gICAgICAgICAgICAgICAgLy8gY29udmVydCBpdC4uLlxuICAgICAgICAgICAgICAgIGlmICghaXRlbS5fX2VtaXR0ZXJfXykge1xuICAgICAgICAgICAgICAgICAgICBjb252ZXJ0KGl0ZW0pXG4gICAgICAgICAgICAgICAgICAgIHdhdGNoKGl0ZW0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG93bmVycyA9IGl0ZW0uX19lbWl0dGVyX18ub3duZXJzXG4gICAgICAgICAgICAgICAgaWYgKG93bmVycy5pbmRleE9mKGFycikgPCAwKSB7XG4gICAgICAgICAgICAgICAgICAgIG93bmVycy5wdXNoKGFycilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qKlxuICogIFVubGluayByZW1vdmVkIGVsZW1lbnRzIGZyb20gdGhlIGV4LW93bmVyIEFycmF5LlxuICovXG5mdW5jdGlvbiB1bmxpbmtBcnJheUVsZW1lbnRzIChhcnIsIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW1zKSB7XG4gICAgICAgIHZhciBpID0gaXRlbXMubGVuZ3RoLCBpdGVtXG4gICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgIGl0ZW0gPSBpdGVtc1tpXVxuICAgICAgICAgICAgaWYgKGl0ZW0gJiYgaXRlbS5fX2VtaXR0ZXJfXykge1xuICAgICAgICAgICAgICAgIHZhciBvd25lcnMgPSBpdGVtLl9fZW1pdHRlcl9fLm93bmVyc1xuICAgICAgICAgICAgICAgIGlmIChvd25lcnMpIG93bmVycy5zcGxpY2Uob3duZXJzLmluZGV4T2YoYXJyKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy8gT2JqZWN0IGFkZC9kZWxldGUga2V5IGF1Z21lbnRhdGlvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG52YXIgT2JqUHJveHkgPSBPYmplY3QuY3JlYXRlKE9iamVjdC5wcm90b3R5cGUpXG5cbmRlZihPYmpQcm94eSwgJyRhZGQnLCBmdW5jdGlvbiAoa2V5LCB2YWwpIHtcbiAgICBpZiAoaGFzT3duLmNhbGwodGhpcywga2V5KSkgcmV0dXJuXG4gICAgdGhpc1trZXldID0gdmFsXG4gICAgY29udmVydEtleSh0aGlzLCBrZXkpXG4gICAgLy8gZW1pdCBhIHByb3BhZ2F0aW5nIHNldCBldmVudFxuICAgIHRoaXMuX19lbWl0dGVyX18uZW1pdCgnc2V0Jywga2V5LCB2YWwsIHRydWUpXG59LCAhaGFzUHJvdG8pXG5cbmRlZihPYmpQcm94eSwgJyRkZWxldGUnLCBmdW5jdGlvbiAoa2V5KSB7XG4gICAgaWYgKCEoaGFzT3duLmNhbGwodGhpcywga2V5KSkpIHJldHVyblxuICAgIC8vIHRyaWdnZXIgc2V0IGV2ZW50c1xuICAgIHRoaXNba2V5XSA9IHVuZGVmaW5lZFxuICAgIGRlbGV0ZSB0aGlzW2tleV1cbiAgICB0aGlzLl9fZW1pdHRlcl9fLmVtaXQoJ2RlbGV0ZScsIGtleSlcbn0sICFoYXNQcm90bylcblxuLy8gV2F0Y2ggSGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqICBDaGVjayBpZiBhIHZhbHVlIGlzIHdhdGNoYWJsZVxuICovXG5mdW5jdGlvbiBpc1dhdGNoYWJsZSAob2JqKSB7XG4gICAgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdvYmplY3QnICYmIG9iaiAmJiAhb2JqLiRjb21waWxlclxufVxuXG4vKipcbiAqICBDb252ZXJ0IGFuIE9iamVjdC9BcnJheSB0byBnaXZlIGl0IGEgY2hhbmdlIGVtaXR0ZXIuXG4gKi9cbmZ1bmN0aW9uIGNvbnZlcnQgKG9iaikge1xuICAgIGlmIChvYmouX19lbWl0dGVyX18pIHJldHVybiB0cnVlXG4gICAgdmFyIGVtaXR0ZXIgPSBuZXcgRW1pdHRlcigpXG4gICAgZGVmKG9iaiwgJ19fZW1pdHRlcl9fJywgZW1pdHRlcilcbiAgICBlbWl0dGVyXG4gICAgICAgIC5vbignc2V0JywgZnVuY3Rpb24gKGtleSwgdmFsLCBwcm9wYWdhdGUpIHtcbiAgICAgICAgICAgIGlmIChwcm9wYWdhdGUpIHByb3BhZ2F0ZUNoYW5nZShvYmopXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignbXV0YXRlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcHJvcGFnYXRlQ2hhbmdlKG9iailcbiAgICAgICAgfSlcbiAgICBlbWl0dGVyLnZhbHVlcyA9IHV0aWxzLmhhc2goKVxuICAgIGVtaXR0ZXIub3duZXJzID0gW11cbiAgICByZXR1cm4gZmFsc2Vcbn1cblxuLyoqXG4gKiAgUHJvcGFnYXRlIGFuIGFycmF5IGVsZW1lbnQncyBjaGFuZ2UgdG8gaXRzIG93bmVyIGFycmF5c1xuICovXG5mdW5jdGlvbiBwcm9wYWdhdGVDaGFuZ2UgKG9iaikge1xuICAgIHZhciBvd25lcnMgPSBvYmouX19lbWl0dGVyX18ub3duZXJzLFxuICAgICAgICBpID0gb3duZXJzLmxlbmd0aFxuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgb3duZXJzW2ldLl9fZW1pdHRlcl9fLmVtaXQoJ3NldCcsICcnLCAnJywgdHJ1ZSlcbiAgICB9XG59XG5cbi8qKlxuICogIFdhdGNoIHRhcmdldCBiYXNlZCBvbiBpdHMgdHlwZVxuICovXG5mdW5jdGlvbiB3YXRjaCAob2JqKSB7XG4gICAgaWYgKGlzQXJyYXkob2JqKSkge1xuICAgICAgICB3YXRjaEFycmF5KG9iailcbiAgICB9IGVsc2Uge1xuICAgICAgICB3YXRjaE9iamVjdChvYmopXG4gICAgfVxufVxuXG4vKipcbiAqICBBdWdtZW50IHRhcmdldCBvYmplY3RzIHdpdGggbW9kaWZpZWRcbiAqICBtZXRob2RzXG4gKi9cbmZ1bmN0aW9uIGF1Z21lbnQgKHRhcmdldCwgc3JjKSB7XG4gICAgaWYgKGhhc1Byb3RvKSB7XG4gICAgICAgIHRhcmdldC5fX3Byb3RvX18gPSBzcmNcbiAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gc3JjKSB7XG4gICAgICAgICAgICBkZWYodGFyZ2V0LCBrZXksIHNyY1trZXldKVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqICBXYXRjaCBhbiBPYmplY3QsIHJlY3Vyc2l2ZS5cbiAqL1xuZnVuY3Rpb24gd2F0Y2hPYmplY3QgKG9iaikge1xuICAgIGF1Z21lbnQob2JqLCBPYmpQcm94eSlcbiAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgICAgIGNvbnZlcnRLZXkob2JqLCBrZXkpXG4gICAgfVxufVxuXG4vKipcbiAqICBXYXRjaCBhbiBBcnJheSwgb3ZlcmxvYWQgbXV0YXRpb24gbWV0aG9kc1xuICogIGFuZCBhZGQgYXVnbWVudGF0aW9ucyBieSBpbnRlcmNlcHRpbmcgdGhlIHByb3RvdHlwZSBjaGFpblxuICovXG5mdW5jdGlvbiB3YXRjaEFycmF5IChhcnIpIHtcbiAgICBhdWdtZW50KGFyciwgQXJyYXlQcm94eSlcbiAgICBsaW5rQXJyYXlFbGVtZW50cyhhcnIsIGFycilcbn1cblxuLyoqXG4gKiAgRGVmaW5lIGFjY2Vzc29ycyBmb3IgYSBwcm9wZXJ0eSBvbiBhbiBPYmplY3RcbiAqICBzbyBpdCBlbWl0cyBnZXQvc2V0IGV2ZW50cy5cbiAqICBUaGVuIHdhdGNoIHRoZSB2YWx1ZSBpdHNlbGYuXG4gKi9cbmZ1bmN0aW9uIGNvbnZlcnRLZXkgKG9iaiwga2V5KSB7XG4gICAgdmFyIGtleVByZWZpeCA9IGtleS5jaGFyQXQoMClcbiAgICBpZiAoa2V5UHJlZml4ID09PSAnJCcgfHwga2V5UHJlZml4ID09PSAnXycpIHtcbiAgICAgICAgcmV0dXJuXG4gICAgfVxuICAgIC8vIGVtaXQgc2V0IG9uIGJpbmRcbiAgICAvLyB0aGlzIG1lYW5zIHdoZW4gYW4gb2JqZWN0IGlzIG9ic2VydmVkIGl0IHdpbGwgZW1pdFxuICAgIC8vIGEgZmlyc3QgYmF0Y2ggb2Ygc2V0IGV2ZW50cy5cbiAgICB2YXIgZW1pdHRlciA9IG9iai5fX2VtaXR0ZXJfXyxcbiAgICAgICAgdmFsdWVzICA9IGVtaXR0ZXIudmFsdWVzXG5cbiAgICBpbml0KG9ialtrZXldKVxuXG4gICAgb0RlZihvYmosIGtleSwge1xuICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHZhbHVlID0gdmFsdWVzW2tleV1cbiAgICAgICAgICAgIC8vIG9ubHkgZW1pdCBnZXQgb24gdGlwIHZhbHVlc1xuICAgICAgICAgICAgaWYgKHB1Yi5zaG91bGRHZXQpIHtcbiAgICAgICAgICAgICAgICBlbWl0dGVyLmVtaXQoJ2dldCcsIGtleSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB2YWx1ZVxuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uIChuZXdWYWwpIHtcbiAgICAgICAgICAgIHZhciBvbGRWYWwgPSB2YWx1ZXNba2V5XVxuICAgICAgICAgICAgdW5vYnNlcnZlKG9sZFZhbCwga2V5LCBlbWl0dGVyKVxuICAgICAgICAgICAgY29weVBhdGhzKG5ld1ZhbCwgb2xkVmFsKVxuICAgICAgICAgICAgLy8gYW4gaW1tZWRpYXRlIHByb3BlcnR5IHNob3VsZCBub3RpZnkgaXRzIHBhcmVudFxuICAgICAgICAgICAgLy8gdG8gZW1pdCBzZXQgZm9yIGl0c2VsZiB0b29cbiAgICAgICAgICAgIGluaXQobmV3VmFsLCB0cnVlKVxuICAgICAgICB9XG4gICAgfSlcblxuICAgIGZ1bmN0aW9uIGluaXQgKHZhbCwgcHJvcGFnYXRlKSB7XG4gICAgICAgIHZhbHVlc1trZXldID0gdmFsXG4gICAgICAgIGVtaXR0ZXIuZW1pdCgnc2V0Jywga2V5LCB2YWwsIHByb3BhZ2F0ZSlcbiAgICAgICAgaWYgKGlzQXJyYXkodmFsKSkge1xuICAgICAgICAgICAgZW1pdHRlci5lbWl0KCdzZXQnLCBrZXkgKyAnLmxlbmd0aCcsIHZhbC5sZW5ndGgsIHByb3BhZ2F0ZSlcbiAgICAgICAgfVxuICAgICAgICBvYnNlcnZlKHZhbCwga2V5LCBlbWl0dGVyKVxuICAgIH1cbn1cblxuLyoqXG4gKiAgV2hlbiBhIHZhbHVlIHRoYXQgaXMgYWxyZWFkeSBjb252ZXJ0ZWQgaXNcbiAqICBvYnNlcnZlZCBhZ2FpbiBieSBhbm90aGVyIG9ic2VydmVyLCB3ZSBjYW4gc2tpcFxuICogIHRoZSB3YXRjaCBjb252ZXJzaW9uIGFuZCBzaW1wbHkgZW1pdCBzZXQgZXZlbnQgZm9yXG4gKiAgYWxsIG9mIGl0cyBwcm9wZXJ0aWVzLlxuICovXG5mdW5jdGlvbiBlbWl0U2V0IChvYmopIHtcbiAgICB2YXIgZW1pdHRlciA9IG9iaiAmJiBvYmouX19lbWl0dGVyX19cbiAgICBpZiAoIWVtaXR0ZXIpIHJldHVyblxuICAgIGlmIChpc0FycmF5KG9iaikpIHtcbiAgICAgICAgZW1pdHRlci5lbWl0KCdzZXQnLCAnbGVuZ3RoJywgb2JqLmxlbmd0aClcbiAgICB9IGVsc2Uge1xuICAgICAgICB2YXIga2V5LCB2YWxcbiAgICAgICAgZm9yIChrZXkgaW4gb2JqKSB7XG4gICAgICAgICAgICB2YWwgPSBvYmpba2V5XVxuICAgICAgICAgICAgZW1pdHRlci5lbWl0KCdzZXQnLCBrZXksIHZhbClcbiAgICAgICAgICAgIGVtaXRTZXQodmFsKVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqICBNYWtlIHN1cmUgYWxsIHRoZSBwYXRocyBpbiBhbiBvbGQgb2JqZWN0IGV4aXN0c1xuICogIGluIGEgbmV3IG9iamVjdC5cbiAqICBTbyB3aGVuIGFuIG9iamVjdCBjaGFuZ2VzLCBhbGwgbWlzc2luZyBrZXlzIHdpbGxcbiAqICBlbWl0IGEgc2V0IGV2ZW50IHdpdGggdW5kZWZpbmVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBjb3B5UGF0aHMgKG5ld09iaiwgb2xkT2JqKSB7XG4gICAgaWYgKCFpc09iamVjdChuZXdPYmopIHx8ICFpc09iamVjdChvbGRPYmopKSB7XG4gICAgICAgIHJldHVyblxuICAgIH1cbiAgICB2YXIgcGF0aCwgb2xkVmFsLCBuZXdWYWxcbiAgICBmb3IgKHBhdGggaW4gb2xkT2JqKSB7XG4gICAgICAgIGlmICghKGhhc093bi5jYWxsKG5ld09iaiwgcGF0aCkpKSB7XG4gICAgICAgICAgICBvbGRWYWwgPSBvbGRPYmpbcGF0aF1cbiAgICAgICAgICAgIGlmIChpc0FycmF5KG9sZFZhbCkpIHtcbiAgICAgICAgICAgICAgICBuZXdPYmpbcGF0aF0gPSBbXVxuICAgICAgICAgICAgfSBlbHNlIGlmIChpc09iamVjdChvbGRWYWwpKSB7XG4gICAgICAgICAgICAgICAgbmV3VmFsID0gbmV3T2JqW3BhdGhdID0ge31cbiAgICAgICAgICAgICAgICBjb3B5UGF0aHMobmV3VmFsLCBvbGRWYWwpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG5ld09ialtwYXRoXSA9IHVuZGVmaW5lZFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqICB3YWxrIGFsb25nIGEgcGF0aCBhbmQgbWFrZSBzdXJlIGl0IGNhbiBiZSBhY2Nlc3NlZFxuICogIGFuZCBlbnVtZXJhdGVkIGluIHRoYXQgb2JqZWN0XG4gKi9cbmZ1bmN0aW9uIGVuc3VyZVBhdGggKG9iaiwga2V5KSB7XG4gICAgdmFyIHBhdGggPSBrZXkuc3BsaXQoJy4nKSwgc2VjXG4gICAgZm9yICh2YXIgaSA9IDAsIGQgPSBwYXRoLmxlbmd0aCAtIDE7IGkgPCBkOyBpKyspIHtcbiAgICAgICAgc2VjID0gcGF0aFtpXVxuICAgICAgICBpZiAoIW9ialtzZWNdKSB7XG4gICAgICAgICAgICBvYmpbc2VjXSA9IHt9XG4gICAgICAgICAgICBpZiAob2JqLl9fZW1pdHRlcl9fKSBjb252ZXJ0S2V5KG9iaiwgc2VjKVxuICAgICAgICB9XG4gICAgICAgIG9iaiA9IG9ialtzZWNdXG4gICAgfVxuICAgIGlmIChpc09iamVjdChvYmopKSB7XG4gICAgICAgIHNlYyA9IHBhdGhbaV1cbiAgICAgICAgaWYgKCEoaGFzT3duLmNhbGwob2JqLCBzZWMpKSkge1xuICAgICAgICAgICAgb2JqW3NlY10gPSB1bmRlZmluZWRcbiAgICAgICAgICAgIGlmIChvYmouX19lbWl0dGVyX18pIGNvbnZlcnRLZXkob2JqLCBzZWMpXG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8vIE1haW4gQVBJIE1ldGhvZHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiAgT2JzZXJ2ZSBhbiBvYmplY3Qgd2l0aCBhIGdpdmVuIHBhdGgsXG4gKiAgYW5kIHByb3h5IGdldC9zZXQvbXV0YXRlIGV2ZW50cyB0byB0aGUgcHJvdmlkZWQgb2JzZXJ2ZXIuXG4gKi9cbmZ1bmN0aW9uIG9ic2VydmUgKG9iaiwgcmF3UGF0aCwgb2JzZXJ2ZXIpIHtcblxuICAgIGlmICghaXNXYXRjaGFibGUob2JqKSkgcmV0dXJuXG5cbiAgICB2YXIgcGF0aCA9IHJhd1BhdGggPyByYXdQYXRoICsgJy4nIDogJycsXG4gICAgICAgIGFscmVhZHlDb252ZXJ0ZWQgPSBjb252ZXJ0KG9iaiksXG4gICAgICAgIGVtaXR0ZXIgPSBvYmouX19lbWl0dGVyX19cblxuICAgIC8vIHNldHVwIHByb3h5IGxpc3RlbmVycyBvbiB0aGUgcGFyZW50IG9ic2VydmVyLlxuICAgIC8vIHdlIG5lZWQgdG8ga2VlcCByZWZlcmVuY2UgdG8gdGhlbSBzbyB0aGF0IHRoZXlcbiAgICAvLyBjYW4gYmUgcmVtb3ZlZCB3aGVuIHRoZSBvYmplY3QgaXMgdW4tb2JzZXJ2ZWQuXG4gICAgb2JzZXJ2ZXIucHJveGllcyA9IG9ic2VydmVyLnByb3hpZXMgfHwge31cbiAgICB2YXIgcHJveGllcyA9IG9ic2VydmVyLnByb3hpZXNbcGF0aF0gPSB7XG4gICAgICAgIGdldDogZnVuY3Rpb24gKGtleSkge1xuICAgICAgICAgICAgb2JzZXJ2ZXIuZW1pdCgnZ2V0JywgcGF0aCArIGtleSlcbiAgICAgICAgfSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbiAoa2V5LCB2YWwsIHByb3BhZ2F0ZSkge1xuICAgICAgICAgICAgaWYgKGtleSkgb2JzZXJ2ZXIuZW1pdCgnc2V0JywgcGF0aCArIGtleSwgdmFsKVxuICAgICAgICAgICAgLy8gYWxzbyBub3RpZnkgb2JzZXJ2ZXIgdGhhdCB0aGUgb2JqZWN0IGl0c2VsZiBjaGFuZ2VkXG4gICAgICAgICAgICAvLyBidXQgb25seSBkbyBzbyB3aGVuIGl0J3MgYSBpbW1lZGlhdGUgcHJvcGVydHkuIHRoaXNcbiAgICAgICAgICAgIC8vIGF2b2lkcyBkdXBsaWNhdGUgZXZlbnQgZmlyaW5nLlxuICAgICAgICAgICAgaWYgKHJhd1BhdGggJiYgcHJvcGFnYXRlKSB7XG4gICAgICAgICAgICAgICAgb2JzZXJ2ZXIuZW1pdCgnc2V0JywgcmF3UGF0aCwgb2JqLCB0cnVlKVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBtdXRhdGU6IGZ1bmN0aW9uIChrZXksIHZhbCwgbXV0YXRpb24pIHtcbiAgICAgICAgICAgIC8vIGlmIHRoZSBBcnJheSBpcyBhIHJvb3QgdmFsdWVcbiAgICAgICAgICAgIC8vIHRoZSBrZXkgd2lsbCBiZSBudWxsXG4gICAgICAgICAgICB2YXIgZml4ZWRQYXRoID0ga2V5ID8gcGF0aCArIGtleSA6IHJhd1BhdGhcbiAgICAgICAgICAgIG9ic2VydmVyLmVtaXQoJ211dGF0ZScsIGZpeGVkUGF0aCwgdmFsLCBtdXRhdGlvbilcbiAgICAgICAgICAgIC8vIGFsc28gZW1pdCBzZXQgZm9yIEFycmF5J3MgbGVuZ3RoIHdoZW4gaXQgbXV0YXRlc1xuICAgICAgICAgICAgdmFyIG0gPSBtdXRhdGlvbi5tZXRob2RcbiAgICAgICAgICAgIGlmIChtICE9PSAnc29ydCcgJiYgbSAhPT0gJ3JldmVyc2UnKSB7XG4gICAgICAgICAgICAgICAgb2JzZXJ2ZXIuZW1pdCgnc2V0JywgZml4ZWRQYXRoICsgJy5sZW5ndGgnLCB2YWwubGVuZ3RoKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gYXR0YWNoIHRoZSBsaXN0ZW5lcnMgdG8gdGhlIGNoaWxkIG9ic2VydmVyLlxuICAgIC8vIG5vdyBhbGwgdGhlIGV2ZW50cyB3aWxsIHByb3BhZ2F0ZSB1cHdhcmRzLlxuICAgIGVtaXR0ZXJcbiAgICAgICAgLm9uKCdnZXQnLCBwcm94aWVzLmdldClcbiAgICAgICAgLm9uKCdzZXQnLCBwcm94aWVzLnNldClcbiAgICAgICAgLm9uKCdtdXRhdGUnLCBwcm94aWVzLm11dGF0ZSlcblxuICAgIGlmIChhbHJlYWR5Q29udmVydGVkKSB7XG4gICAgICAgIC8vIGZvciBvYmplY3RzIHRoYXQgaGF2ZSBhbHJlYWR5IGJlZW4gY29udmVydGVkLFxuICAgICAgICAvLyBlbWl0IHNldCBldmVudHMgZm9yIGV2ZXJ5dGhpbmcgaW5zaWRlXG4gICAgICAgIGVtaXRTZXQob2JqKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIHdhdGNoKG9iailcbiAgICB9XG59XG5cbi8qKlxuICogIENhbmNlbCBvYnNlcnZhdGlvbiwgdHVybiBvZmYgdGhlIGxpc3RlbmVycy5cbiAqL1xuZnVuY3Rpb24gdW5vYnNlcnZlIChvYmosIHBhdGgsIG9ic2VydmVyKSB7XG5cbiAgICBpZiAoIW9iaiB8fCAhb2JqLl9fZW1pdHRlcl9fKSByZXR1cm5cblxuICAgIHBhdGggPSBwYXRoID8gcGF0aCArICcuJyA6ICcnXG4gICAgdmFyIHByb3hpZXMgPSBvYnNlcnZlci5wcm94aWVzW3BhdGhdXG4gICAgaWYgKCFwcm94aWVzKSByZXR1cm5cblxuICAgIC8vIHR1cm4gb2ZmIGxpc3RlbmVyc1xuICAgIG9iai5fX2VtaXR0ZXJfX1xuICAgICAgICAub2ZmKCdnZXQnLCBwcm94aWVzLmdldClcbiAgICAgICAgLm9mZignc2V0JywgcHJveGllcy5zZXQpXG4gICAgICAgIC5vZmYoJ211dGF0ZScsIHByb3hpZXMubXV0YXRlKVxuXG4gICAgLy8gcmVtb3ZlIHJlZmVyZW5jZVxuICAgIG9ic2VydmVyLnByb3hpZXNbcGF0aF0gPSBudWxsXG59XG5cbi8vIEV4cG9zZSBBUEkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudmFyIHB1YiA9IG1vZHVsZS5leHBvcnRzID0ge1xuXG4gICAgLy8gd2hldGhlciB0byBlbWl0IGdldCBldmVudHNcbiAgICAvLyBvbmx5IGVuYWJsZWQgZHVyaW5nIGRlcGVuZGVuY3kgcGFyc2luZ1xuICAgIHNob3VsZEdldCAgIDogZmFsc2UsXG5cbiAgICBvYnNlcnZlICAgICA6IG9ic2VydmUsXG4gICAgdW5vYnNlcnZlICAgOiB1bm9ic2VydmUsXG4gICAgZW5zdXJlUGF0aCAgOiBlbnN1cmVQYXRoLFxuICAgIGNvcHlQYXRocyAgIDogY29weVBhdGhzLFxuICAgIHdhdGNoICAgICAgIDogd2F0Y2gsXG4gICAgY29udmVydCAgICAgOiBjb252ZXJ0LFxuICAgIGNvbnZlcnRLZXkgIDogY29udmVydEtleVxufSIsInZhciBvcGVuQ2hhciAgICAgICAgPSAneycsXG4gICAgZW5kQ2hhciAgICAgICAgID0gJ30nLFxuICAgIEVTQ0FQRV9SRSAgICAgICA9IC9bLS4qKz9eJHt9KCl8W1xcXVxcL1xcXFxdL2csXG4gICAgQklORElOR19SRSAgICAgID0gYnVpbGRJbnRlcnBvbGF0aW9uUmVnZXgoKSxcbiAgICAvLyBsYXp5IHJlcXVpcmVcbiAgICBEaXJlY3RpdmVcblxuZnVuY3Rpb24gYnVpbGRJbnRlcnBvbGF0aW9uUmVnZXggKCkge1xuICAgIHZhciBvcGVuID0gZXNjYXBlUmVnZXgob3BlbkNoYXIpLFxuICAgICAgICBlbmQgID0gZXNjYXBlUmVnZXgoZW5kQ2hhcilcbiAgICByZXR1cm4gbmV3IFJlZ0V4cChvcGVuICsgb3BlbiArIG9wZW4gKyAnPyguKz8pJyArIGVuZCArICc/JyArIGVuZCArIGVuZClcbn1cblxuZnVuY3Rpb24gZXNjYXBlUmVnZXggKHN0cikge1xuICAgIHJldHVybiBzdHIucmVwbGFjZShFU0NBUEVfUkUsICdcXFxcJCYnKVxufVxuXG5mdW5jdGlvbiBzZXREZWxpbWl0ZXJzIChkZWxpbWl0ZXJzKSB7XG4gICAgZXhwb3J0cy5kZWxpbWl0ZXJzID0gZGVsaW1pdGVyc1xuICAgIG9wZW5DaGFyID0gZGVsaW1pdGVyc1swXVxuICAgIGVuZENoYXIgPSBkZWxpbWl0ZXJzWzFdXG4gICAgQklORElOR19SRSA9IGJ1aWxkSW50ZXJwb2xhdGlvblJlZ2V4KClcbn1cblxuLyoqIFxuICogIFBhcnNlIGEgcGllY2Ugb2YgdGV4dCwgcmV0dXJuIGFuIGFycmF5IG9mIHRva2Vuc1xuICogIHRva2VuIHR5cGVzOlxuICogIDEuIHBsYWluIHN0cmluZ1xuICogIDIuIG9iamVjdCB3aXRoIGtleSA9IGJpbmRpbmcga2V5XG4gKiAgMy4gb2JqZWN0IHdpdGgga2V5ICYgaHRtbCA9IHRydWVcbiAqL1xuZnVuY3Rpb24gcGFyc2UgKHRleHQpIHtcbiAgICBpZiAoIUJJTkRJTkdfUkUudGVzdCh0ZXh0KSkgcmV0dXJuIG51bGxcbiAgICB2YXIgbSwgaSwgdG9rZW4sIG1hdGNoLCB0b2tlbnMgPSBbXVxuICAgIC8qIGpzaGludCBib3NzOiB0cnVlICovXG4gICAgd2hpbGUgKG0gPSB0ZXh0Lm1hdGNoKEJJTkRJTkdfUkUpKSB7XG4gICAgICAgIGkgPSBtLmluZGV4XG4gICAgICAgIGlmIChpID4gMCkgdG9rZW5zLnB1c2godGV4dC5zbGljZSgwLCBpKSlcbiAgICAgICAgdG9rZW4gPSB7IGtleTogbVsxXS50cmltKCkgfVxuICAgICAgICBtYXRjaCA9IG1bMF1cbiAgICAgICAgdG9rZW4uaHRtbCA9XG4gICAgICAgICAgICBtYXRjaC5jaGFyQXQoMikgPT09IG9wZW5DaGFyICYmXG4gICAgICAgICAgICBtYXRjaC5jaGFyQXQobWF0Y2gubGVuZ3RoIC0gMykgPT09IGVuZENoYXJcbiAgICAgICAgdG9rZW5zLnB1c2godG9rZW4pXG4gICAgICAgIHRleHQgPSB0ZXh0LnNsaWNlKGkgKyBtWzBdLmxlbmd0aClcbiAgICB9XG4gICAgaWYgKHRleHQubGVuZ3RoKSB0b2tlbnMucHVzaCh0ZXh0KVxuICAgIHJldHVybiB0b2tlbnNcbn1cblxuLyoqXG4gKiAgUGFyc2UgYW4gYXR0cmlidXRlIHZhbHVlIHdpdGggcG9zc2libGUgaW50ZXJwb2xhdGlvbiB0YWdzXG4gKiAgcmV0dXJuIGEgRGlyZWN0aXZlLWZyaWVuZGx5IGV4cHJlc3Npb25cbiAqXG4gKiAgZS5nLiAgYSB7e2J9fSBjICA9PiAgXCJhIFwiICsgYiArIFwiIGNcIlxuICovXG5mdW5jdGlvbiBwYXJzZUF0dHIgKGF0dHIpIHtcbiAgICBEaXJlY3RpdmUgPSBEaXJlY3RpdmUgfHwgcmVxdWlyZSgnLi9kaXJlY3RpdmUnKVxuICAgIHZhciB0b2tlbnMgPSBwYXJzZShhdHRyKVxuICAgIGlmICghdG9rZW5zKSByZXR1cm4gbnVsbFxuICAgIGlmICh0b2tlbnMubGVuZ3RoID09PSAxKSByZXR1cm4gdG9rZW5zWzBdLmtleVxuICAgIHZhciByZXMgPSBbXSwgdG9rZW5cbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IHRva2Vucy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgdG9rZW4gPSB0b2tlbnNbaV1cbiAgICAgICAgcmVzLnB1c2goXG4gICAgICAgICAgICB0b2tlbi5rZXlcbiAgICAgICAgICAgICAgICA/IGlubGluZUZpbHRlcnModG9rZW4ua2V5KVxuICAgICAgICAgICAgICAgIDogKCdcIicgKyB0b2tlbiArICdcIicpXG4gICAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuIHJlcy5qb2luKCcrJylcbn1cblxuLyoqXG4gKiAgSW5saW5lcyBhbnkgcG9zc2libGUgZmlsdGVycyBpbiBhIGJpbmRpbmdcbiAqICBzbyB0aGF0IHdlIGNhbiBjb21iaW5lIGV2ZXJ5dGhpbmcgaW50byBhIGh1Z2UgZXhwcmVzc2lvblxuICovXG5mdW5jdGlvbiBpbmxpbmVGaWx0ZXJzIChrZXkpIHtcbiAgICB2YXIgZmlsdGVycyA9IERpcmVjdGl2ZS5wYXJzZUZpbHRlcnMoa2V5KVxuICAgIGlmIChmaWx0ZXJzKSB7XG4gICAgICAgIGtleSA9IERpcmVjdGl2ZS5pbmxpbmVGaWx0ZXJzKFxuICAgICAgICAgICAgRGlyZWN0aXZlLnBhcnNlS2V5KGtleSksXG4gICAgICAgICAgICBmaWx0ZXJzXG4gICAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuICcoJyArIGtleSArICcpJ1xufVxuXG5leHBvcnRzLnBhcnNlICAgICAgICAgPSBwYXJzZVxuZXhwb3J0cy5wYXJzZUF0dHIgICAgID0gcGFyc2VBdHRyXG5leHBvcnRzLnNldERlbGltaXRlcnMgPSBzZXREZWxpbWl0ZXJzXG5leHBvcnRzLmRlbGltaXRlcnMgICAgPSBbb3BlbkNoYXIsIGVuZENoYXJdIiwidmFyIGVuZEV2ZW50cyAgPSBzbmlmZkVuZEV2ZW50cygpLFxuICAgIGNvbmZpZyAgICAgPSByZXF1aXJlKCcuL2NvbmZpZycpLFxuICAgIC8vIGJhdGNoIGVudGVyIGFuaW1hdGlvbnMgc28gd2Ugb25seSBmb3JjZSB0aGUgbGF5b3V0IG9uY2VcbiAgICBCYXRjaGVyICAgID0gcmVxdWlyZSgnLi9iYXRjaGVyJyksXG4gICAgYmF0Y2hlciAgICA9IG5ldyBCYXRjaGVyKCksXG4gICAgLy8gY2FjaGUgdGltZXIgZnVuY3Rpb25zXG4gICAgc2V0VE8gICAgICA9IHdpbmRvdy5zZXRUaW1lb3V0LFxuICAgIGNsZWFyVE8gICAgPSB3aW5kb3cuY2xlYXJUaW1lb3V0LFxuICAgIC8vIGV4aXQgY29kZXMgZm9yIHRlc3RpbmdcbiAgICBjb2RlcyA9IHtcbiAgICAgICAgQ1NTX0UgICAgIDogMSxcbiAgICAgICAgQ1NTX0wgICAgIDogMixcbiAgICAgICAgSlNfRSAgICAgIDogMyxcbiAgICAgICAgSlNfTCAgICAgIDogNCxcbiAgICAgICAgQ1NTX1NLSVAgIDogLTEsXG4gICAgICAgIEpTX1NLSVAgICA6IC0yLFxuICAgICAgICBKU19TS0lQX0UgOiAtMyxcbiAgICAgICAgSlNfU0tJUF9MIDogLTQsXG4gICAgICAgIElOSVQgICAgICA6IC01LFxuICAgICAgICBTS0lQICAgICAgOiAtNlxuICAgIH1cblxuLy8gZm9yY2UgbGF5b3V0IGJlZm9yZSB0cmlnZ2VyaW5nIHRyYW5zaXRpb25zL2FuaW1hdGlvbnNcbmJhdGNoZXIuX3ByZUZsdXNoID0gZnVuY3Rpb24gKCkge1xuICAgIC8qIGpzaGludCB1bnVzZWQ6IGZhbHNlICovXG4gICAgdmFyIGYgPSBkb2N1bWVudC5ib2R5Lm9mZnNldEhlaWdodFxufVxuXG4vKipcbiAqICBzdGFnZTpcbiAqICAgIDEgPSBlbnRlclxuICogICAgMiA9IGxlYXZlXG4gKi9cbnZhciB0cmFuc2l0aW9uID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZWwsIHN0YWdlLCBjYiwgY29tcGlsZXIpIHtcblxuICAgIHZhciBjaGFuZ2VTdGF0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgY2IoKVxuICAgICAgICBjb21waWxlci5leGVjSG9vayhzdGFnZSA+IDAgPyAnYXR0YWNoZWQnIDogJ2RldGFjaGVkJylcbiAgICB9XG5cbiAgICBpZiAoY29tcGlsZXIuaW5pdCkge1xuICAgICAgICBjaGFuZ2VTdGF0ZSgpXG4gICAgICAgIHJldHVybiBjb2Rlcy5JTklUXG4gICAgfVxuXG4gICAgdmFyIGhhc1RyYW5zaXRpb24gPSBlbC52dWVfdHJhbnMgPT09ICcnLFxuICAgICAgICBoYXNBbmltYXRpb24gID0gZWwudnVlX2FuaW0gPT09ICcnLFxuICAgICAgICBlZmZlY3RJZCAgICAgID0gZWwudnVlX2VmZmVjdFxuXG4gICAgaWYgKGVmZmVjdElkKSB7XG4gICAgICAgIHJldHVybiBhcHBseVRyYW5zaXRpb25GdW5jdGlvbnMoXG4gICAgICAgICAgICBlbCxcbiAgICAgICAgICAgIHN0YWdlLFxuICAgICAgICAgICAgY2hhbmdlU3RhdGUsXG4gICAgICAgICAgICBlZmZlY3RJZCxcbiAgICAgICAgICAgIGNvbXBpbGVyXG4gICAgICAgIClcbiAgICB9IGVsc2UgaWYgKGhhc1RyYW5zaXRpb24gfHwgaGFzQW5pbWF0aW9uKSB7XG4gICAgICAgIHJldHVybiBhcHBseVRyYW5zaXRpb25DbGFzcyhcbiAgICAgICAgICAgIGVsLFxuICAgICAgICAgICAgc3RhZ2UsXG4gICAgICAgICAgICBjaGFuZ2VTdGF0ZSxcbiAgICAgICAgICAgIGhhc0FuaW1hdGlvblxuICAgICAgICApXG4gICAgfSBlbHNlIHtcbiAgICAgICAgY2hhbmdlU3RhdGUoKVxuICAgICAgICByZXR1cm4gY29kZXMuU0tJUFxuICAgIH1cblxufVxuXG50cmFuc2l0aW9uLmNvZGVzID0gY29kZXNcblxuLyoqXG4gKiAgVG9nZ2dsZSBhIENTUyBjbGFzcyB0byB0cmlnZ2VyIHRyYW5zaXRpb25cbiAqL1xuZnVuY3Rpb24gYXBwbHlUcmFuc2l0aW9uQ2xhc3MgKGVsLCBzdGFnZSwgY2hhbmdlU3RhdGUsIGhhc0FuaW1hdGlvbikge1xuXG4gICAgaWYgKCFlbmRFdmVudHMudHJhbnMpIHtcbiAgICAgICAgY2hhbmdlU3RhdGUoKVxuICAgICAgICByZXR1cm4gY29kZXMuQ1NTX1NLSVBcbiAgICB9XG5cbiAgICAvLyBpZiB0aGUgYnJvd3NlciBzdXBwb3J0cyB0cmFuc2l0aW9uLFxuICAgIC8vIGl0IG11c3QgaGF2ZSBjbGFzc0xpc3QuLi5cbiAgICB2YXIgb25FbmQsXG4gICAgICAgIGNsYXNzTGlzdCAgICAgICAgPSBlbC5jbGFzc0xpc3QsXG4gICAgICAgIGV4aXN0aW5nQ2FsbGJhY2sgPSBlbC52dWVfdHJhbnNfY2IsXG4gICAgICAgIGVudGVyQ2xhc3MgICAgICAgPSBjb25maWcuZW50ZXJDbGFzcyxcbiAgICAgICAgbGVhdmVDbGFzcyAgICAgICA9IGNvbmZpZy5sZWF2ZUNsYXNzLFxuICAgICAgICBlbmRFdmVudCAgICAgICAgID0gaGFzQW5pbWF0aW9uID8gZW5kRXZlbnRzLmFuaW0gOiBlbmRFdmVudHMudHJhbnNcblxuICAgIC8vIGNhbmNlbCB1bmZpbmlzaGVkIGNhbGxiYWNrcyBhbmQgam9ic1xuICAgIGlmIChleGlzdGluZ0NhbGxiYWNrKSB7XG4gICAgICAgIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoZW5kRXZlbnQsIGV4aXN0aW5nQ2FsbGJhY2spXG4gICAgICAgIGNsYXNzTGlzdC5yZW1vdmUoZW50ZXJDbGFzcylcbiAgICAgICAgY2xhc3NMaXN0LnJlbW92ZShsZWF2ZUNsYXNzKVxuICAgICAgICBlbC52dWVfdHJhbnNfY2IgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKHN0YWdlID4gMCkgeyAvLyBlbnRlclxuXG4gICAgICAgIC8vIHNldCB0byBlbnRlciBzdGF0ZSBiZWZvcmUgYXBwZW5kaW5nXG4gICAgICAgIGNsYXNzTGlzdC5hZGQoZW50ZXJDbGFzcylcbiAgICAgICAgLy8gYXBwZW5kXG4gICAgICAgIGNoYW5nZVN0YXRlKClcbiAgICAgICAgLy8gdHJpZ2dlciB0cmFuc2l0aW9uXG4gICAgICAgIGlmICghaGFzQW5pbWF0aW9uKSB7XG4gICAgICAgICAgICBiYXRjaGVyLnB1c2goe1xuICAgICAgICAgICAgICAgIGV4ZWN1dGU6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgY2xhc3NMaXN0LnJlbW92ZShlbnRlckNsYXNzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvbkVuZCA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgICAgICAgICAgaWYgKGUudGFyZ2V0ID09PSBlbCkge1xuICAgICAgICAgICAgICAgICAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKGVuZEV2ZW50LCBvbkVuZClcbiAgICAgICAgICAgICAgICAgICAgZWwudnVlX3RyYW5zX2NiID0gbnVsbFxuICAgICAgICAgICAgICAgICAgICBjbGFzc0xpc3QucmVtb3ZlKGVudGVyQ2xhc3MpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWwuYWRkRXZlbnRMaXN0ZW5lcihlbmRFdmVudCwgb25FbmQpXG4gICAgICAgICAgICBlbC52dWVfdHJhbnNfY2IgPSBvbkVuZFxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb2Rlcy5DU1NfRVxuXG4gICAgfSBlbHNlIHsgLy8gbGVhdmVcblxuICAgICAgICBpZiAoZWwub2Zmc2V0V2lkdGggfHwgZWwub2Zmc2V0SGVpZ2h0KSB7XG4gICAgICAgICAgICAvLyB0cmlnZ2VyIGhpZGUgdHJhbnNpdGlvblxuICAgICAgICAgICAgY2xhc3NMaXN0LmFkZChsZWF2ZUNsYXNzKVxuICAgICAgICAgICAgb25FbmQgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICAgICAgICAgIGlmIChlLnRhcmdldCA9PT0gZWwpIHtcbiAgICAgICAgICAgICAgICAgICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihlbmRFdmVudCwgb25FbmQpXG4gICAgICAgICAgICAgICAgICAgIGVsLnZ1ZV90cmFuc19jYiA9IG51bGxcbiAgICAgICAgICAgICAgICAgICAgLy8gYWN0dWFsbHkgcmVtb3ZlIG5vZGUgaGVyZVxuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VTdGF0ZSgpXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzTGlzdC5yZW1vdmUobGVhdmVDbGFzcylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBhdHRhY2ggdHJhbnNpdGlvbiBlbmQgbGlzdGVuZXJcbiAgICAgICAgICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoZW5kRXZlbnQsIG9uRW5kKVxuICAgICAgICAgICAgZWwudnVlX3RyYW5zX2NiID0gb25FbmRcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIGRpcmVjdGx5IHJlbW92ZSBpbnZpc2libGUgZWxlbWVudHNcbiAgICAgICAgICAgIGNoYW5nZVN0YXRlKClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29kZXMuQ1NTX0xcbiAgICAgICAgXG4gICAgfVxuXG59XG5cbmZ1bmN0aW9uIGFwcGx5VHJhbnNpdGlvbkZ1bmN0aW9ucyAoZWwsIHN0YWdlLCBjaGFuZ2VTdGF0ZSwgZWZmZWN0SWQsIGNvbXBpbGVyKSB7XG5cbiAgICB2YXIgZnVuY3MgPSBjb21waWxlci5nZXRPcHRpb24oJ2VmZmVjdHMnLCBlZmZlY3RJZClcbiAgICBpZiAoIWZ1bmNzKSB7XG4gICAgICAgIGNoYW5nZVN0YXRlKClcbiAgICAgICAgcmV0dXJuIGNvZGVzLkpTX1NLSVBcbiAgICB9XG5cbiAgICB2YXIgZW50ZXIgPSBmdW5jcy5lbnRlcixcbiAgICAgICAgbGVhdmUgPSBmdW5jcy5sZWF2ZSxcbiAgICAgICAgdGltZW91dHMgPSBlbC52dWVfdGltZW91dHNcblxuICAgIC8vIGNsZWFyIHByZXZpb3VzIHRpbWVvdXRzXG4gICAgaWYgKHRpbWVvdXRzKSB7XG4gICAgICAgIHZhciBpID0gdGltZW91dHMubGVuZ3RoXG4gICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgIGNsZWFyVE8odGltZW91dHNbaV0pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0aW1lb3V0cyA9IGVsLnZ1ZV90aW1lb3V0cyA9IFtdXG4gICAgZnVuY3Rpb24gdGltZW91dCAoY2IsIGRlbGF5KSB7XG4gICAgICAgIHZhciBpZCA9IHNldFRPKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGNiKClcbiAgICAgICAgICAgIHRpbWVvdXRzLnNwbGljZSh0aW1lb3V0cy5pbmRleE9mKGlkKSwgMSlcbiAgICAgICAgICAgIGlmICghdGltZW91dHMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgZWwudnVlX3RpbWVvdXRzID0gbnVsbFxuICAgICAgICAgICAgfVxuICAgICAgICB9LCBkZWxheSlcbiAgICAgICAgdGltZW91dHMucHVzaChpZClcbiAgICB9XG5cbiAgICBpZiAoc3RhZ2UgPiAwKSB7IC8vIGVudGVyXG4gICAgICAgIGlmICh0eXBlb2YgZW50ZXIgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGNoYW5nZVN0YXRlKClcbiAgICAgICAgICAgIHJldHVybiBjb2Rlcy5KU19TS0lQX0VcbiAgICAgICAgfVxuICAgICAgICBlbnRlcihlbCwgY2hhbmdlU3RhdGUsIHRpbWVvdXQpXG4gICAgICAgIHJldHVybiBjb2Rlcy5KU19FXG4gICAgfSBlbHNlIHsgLy8gbGVhdmVcbiAgICAgICAgaWYgKHR5cGVvZiBsZWF2ZSAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2hhbmdlU3RhdGUoKVxuICAgICAgICAgICAgcmV0dXJuIGNvZGVzLkpTX1NLSVBfTFxuICAgICAgICB9XG4gICAgICAgIGxlYXZlKGVsLCBjaGFuZ2VTdGF0ZSwgdGltZW91dClcbiAgICAgICAgcmV0dXJuIGNvZGVzLkpTX0xcbiAgICB9XG5cbn1cblxuLyoqXG4gKiAgU25pZmYgcHJvcGVyIHRyYW5zaXRpb24gZW5kIGV2ZW50IG5hbWVcbiAqL1xuZnVuY3Rpb24gc25pZmZFbmRFdmVudHMgKCkge1xuICAgIHZhciBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3Z1ZScpLFxuICAgICAgICBkZWZhdWx0RXZlbnQgPSAndHJhbnNpdGlvbmVuZCcsXG4gICAgICAgIGV2ZW50cyA9IHtcbiAgICAgICAgICAgICd0cmFuc2l0aW9uJyAgICAgICA6IGRlZmF1bHRFdmVudCxcbiAgICAgICAgICAgICdtb3pUcmFuc2l0aW9uJyAgICA6IGRlZmF1bHRFdmVudCxcbiAgICAgICAgICAgICd3ZWJraXRUcmFuc2l0aW9uJyA6ICd3ZWJraXRUcmFuc2l0aW9uRW5kJ1xuICAgICAgICB9LFxuICAgICAgICByZXQgPSB7fVxuICAgIGZvciAodmFyIG5hbWUgaW4gZXZlbnRzKSB7XG4gICAgICAgIGlmIChlbC5zdHlsZVtuYW1lXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXQudHJhbnMgPSBldmVudHNbbmFtZV1cbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0LmFuaW0gPSBlbC5zdHlsZS5hbmltYXRpb24gPT09ICcnXG4gICAgICAgID8gJ2FuaW1hdGlvbmVuZCdcbiAgICAgICAgOiAnd2Via2l0QW5pbWF0aW9uRW5kJ1xuICAgIHJldHVybiByZXRcbn0iLCJ2YXIgY29uZmlnICAgID0gcmVxdWlyZSgnLi9jb25maWcnKSxcbiAgICB0b1N0cmluZyAgPSAoe30pLnRvU3RyaW5nLFxuICAgIHdpbiAgICAgICA9IHdpbmRvdyxcbiAgICBjb25zb2xlICAgPSB3aW4uY29uc29sZSxcbiAgICB0aW1lb3V0ICAgPSB3aW4uc2V0VGltZW91dCxcbiAgICBkZWYgICAgICAgPSBPYmplY3QuZGVmaW5lUHJvcGVydHksXG4gICAgVEhJU19SRSAgID0gL1teXFx3XXRoaXNbXlxcd10vLFxuICAgIE9CSkVDVCAgICA9ICdvYmplY3QnLFxuICAgIGhhc0NsYXNzTGlzdCA9ICdjbGFzc0xpc3QnIGluIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCxcbiAgICBWaWV3TW9kZWwgLy8gbGF0ZSBkZWZcblxudmFyIHV0aWxzID0gbW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICAvKipcbiAgICAgKiAgZ2V0IGEgdmFsdWUgZnJvbSBhbiBvYmplY3Qga2V5cGF0aFxuICAgICAqL1xuICAgIGdldDogZnVuY3Rpb24gKG9iaiwga2V5KSB7XG4gICAgICAgIC8qIGpzaGludCBlcWVxZXE6IGZhbHNlICovXG4gICAgICAgIGlmIChrZXkuaW5kZXhPZignLicpIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuIG9ialtrZXldXG4gICAgICAgIH1cbiAgICAgICAgdmFyIHBhdGggPSBrZXkuc3BsaXQoJy4nKSxcbiAgICAgICAgICAgIGQgPSAtMSwgbCA9IHBhdGgubGVuZ3RoXG4gICAgICAgIHdoaWxlICgrK2QgPCBsICYmIG9iaiAhPSBudWxsKSB7XG4gICAgICAgICAgICBvYmogPSBvYmpbcGF0aFtkXV1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb2JqXG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBzZXQgYSB2YWx1ZSB0byBhbiBvYmplY3Qga2V5cGF0aFxuICAgICAqL1xuICAgIHNldDogZnVuY3Rpb24gKG9iaiwga2V5LCB2YWwpIHtcbiAgICAgICAgLyoganNoaW50IGVxZXFlcTogZmFsc2UgKi9cbiAgICAgICAgaWYgKGtleS5pbmRleE9mKCcuJykgPCAwKSB7XG4gICAgICAgICAgICBvYmpba2V5XSA9IHZhbFxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgdmFyIHBhdGggPSBrZXkuc3BsaXQoJy4nKSxcbiAgICAgICAgICAgIGQgPSAtMSwgbCA9IHBhdGgubGVuZ3RoIC0gMVxuICAgICAgICB3aGlsZSAoKytkIDwgbCkge1xuICAgICAgICAgICAgaWYgKG9ialtwYXRoW2RdXSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgb2JqW3BhdGhbZF1dID0ge31cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG9iaiA9IG9ialtwYXRoW2RdXVxuICAgICAgICB9XG4gICAgICAgIG9ialtwYXRoW2RdXSA9IHZhbFxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgcmV0dXJuIHRoZSBiYXNlIHNlZ21lbnQgb2YgYSBrZXlwYXRoXG4gICAgICovXG4gICAgYmFzZUtleTogZnVuY3Rpb24gKGtleSkge1xuICAgICAgICByZXR1cm4ga2V5LmluZGV4T2YoJy4nKSA+IDBcbiAgICAgICAgICAgID8ga2V5LnNwbGl0KCcuJylbMF1cbiAgICAgICAgICAgIDoga2V5XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBDcmVhdGUgYSBwcm90b3R5cGUtbGVzcyBvYmplY3RcbiAgICAgKiAgd2hpY2ggaXMgYSBiZXR0ZXIgaGFzaC9tYXBcbiAgICAgKi9cbiAgICBoYXNoOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiBPYmplY3QuY3JlYXRlKG51bGwpXG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBnZXQgYW4gYXR0cmlidXRlIGFuZCByZW1vdmUgaXQuXG4gICAgICovXG4gICAgYXR0cjogZnVuY3Rpb24gKGVsLCB0eXBlKSB7XG4gICAgICAgIHZhciBhdHRyID0gY29uZmlnLnByZWZpeCArICctJyArIHR5cGUsXG4gICAgICAgICAgICB2YWwgPSBlbC5nZXRBdHRyaWJ1dGUoYXR0cilcbiAgICAgICAgaWYgKHZhbCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgZWwucmVtb3ZlQXR0cmlidXRlKGF0dHIpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHZhbFxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgRGVmaW5lIGFuIGllbnVtZXJhYmxlIHByb3BlcnR5XG4gICAgICogIFRoaXMgYXZvaWRzIGl0IGJlaW5nIGluY2x1ZGVkIGluIEpTT04uc3RyaW5naWZ5XG4gICAgICogIG9yIGZvci4uLmluIGxvb3BzLlxuICAgICAqL1xuICAgIGRlZlByb3RlY3RlZDogZnVuY3Rpb24gKG9iaiwga2V5LCB2YWwsIGVudW1lcmFibGUsIHdyaXRhYmxlKSB7XG4gICAgICAgIGRlZihvYmosIGtleSwge1xuICAgICAgICAgICAgdmFsdWUgICAgICAgIDogdmFsLFxuICAgICAgICAgICAgZW51bWVyYWJsZSAgIDogZW51bWVyYWJsZSxcbiAgICAgICAgICAgIHdyaXRhYmxlICAgICA6IHdyaXRhYmxlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlIDogdHJ1ZVxuICAgICAgICB9KVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgQSBsZXNzIGJ1bGxldC1wcm9vZiBidXQgbW9yZSBlZmZpY2llbnQgdHlwZSBjaGVja1xuICAgICAqICB0aGFuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmdcbiAgICAgKi9cbiAgICBpc09iamVjdDogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICByZXR1cm4gdHlwZW9mIG9iaiA9PT0gT0JKRUNUICYmIG9iaiAmJiAhQXJyYXkuaXNBcnJheShvYmopXG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBBIG1vcmUgYWNjdXJhdGUgYnV0IGxlc3MgZWZmaWNpZW50IHR5cGUgY2hlY2tcbiAgICAgKi9cbiAgICBpc1RydWVPYmplY3Q6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgcmV0dXJuIHRvU3RyaW5nLmNhbGwob2JqKSA9PT0gJ1tvYmplY3QgT2JqZWN0XSdcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIE1vc3Qgc2ltcGxlIGJpbmRcbiAgICAgKiAgZW5vdWdoIGZvciB0aGUgdXNlY2FzZSBhbmQgZmFzdCB0aGFuIG5hdGl2ZSBiaW5kKClcbiAgICAgKi9cbiAgICBiaW5kOiBmdW5jdGlvbiAoZm4sIGN0eCkge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGFyZykge1xuICAgICAgICAgICAgcmV0dXJuIGZuLmNhbGwoY3R4LCBhcmcpXG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIE1ha2Ugc3VyZSBudWxsIGFuZCB1bmRlZmluZWQgb3V0cHV0IGVtcHR5IHN0cmluZ1xuICAgICAqL1xuICAgIGd1YXJkOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgLyoganNoaW50IGVxZXFlcTogZmFsc2UsIGVxbnVsbDogdHJ1ZSAqL1xuICAgICAgICByZXR1cm4gdmFsdWUgPT0gbnVsbFxuICAgICAgICAgICAgPyAnJ1xuICAgICAgICAgICAgOiAodHlwZW9mIHZhbHVlID09ICdvYmplY3QnKVxuICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpXG4gICAgICAgICAgICAgICAgOiB2YWx1ZVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgV2hlbiBzZXR0aW5nIHZhbHVlIG9uIHRoZSBWTSwgcGFyc2UgcG9zc2libGUgbnVtYmVyc1xuICAgICAqL1xuICAgIGNoZWNrTnVtYmVyOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlID09PSAnYm9vbGVhbicpXG4gICAgICAgICAgICA/IHZhbHVlXG4gICAgICAgICAgICA6IE51bWJlcih2YWx1ZSlcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIHNpbXBsZSBleHRlbmRcbiAgICAgKi9cbiAgICBleHRlbmQ6IGZ1bmN0aW9uIChvYmosIGV4dCkge1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gZXh0KSB7XG4gICAgICAgICAgICBpZiAob2JqW2tleV0gIT09IGV4dFtrZXldKSB7XG4gICAgICAgICAgICAgICAgb2JqW2tleV0gPSBleHRba2V5XVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBvYmpcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIGZpbHRlciBhbiBhcnJheSB3aXRoIGR1cGxpY2F0ZXMgaW50byB1bmlxdWVzXG4gICAgICovXG4gICAgdW5pcXVlOiBmdW5jdGlvbiAoYXJyKSB7XG4gICAgICAgIHZhciBoYXNoID0gdXRpbHMuaGFzaCgpLFxuICAgICAgICAgICAgaSA9IGFyci5sZW5ndGgsXG4gICAgICAgICAgICBrZXksIHJlcyA9IFtdXG4gICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgIGtleSA9IGFycltpXVxuICAgICAgICAgICAgaWYgKGhhc2hba2V5XSkgY29udGludWVcbiAgICAgICAgICAgIGhhc2hba2V5XSA9IDFcbiAgICAgICAgICAgIHJlcy5wdXNoKGtleSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzXG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBDb252ZXJ0IGEgc3RyaW5nIHRlbXBsYXRlIHRvIGEgZG9tIGZyYWdtZW50XG4gICAgICovXG4gICAgdG9GcmFnbWVudDogZnVuY3Rpb24gKHRlbXBsYXRlKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdGVtcGxhdGUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVcbiAgICAgICAgfVxuICAgICAgICBpZiAodGVtcGxhdGUuY2hhckF0KDApID09PSAnIycpIHtcbiAgICAgICAgICAgIHZhciB0ZW1wbGF0ZU5vZGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCh0ZW1wbGF0ZS5zbGljZSgxKSlcbiAgICAgICAgICAgIGlmICghdGVtcGxhdGVOb2RlKSByZXR1cm5cbiAgICAgICAgICAgIC8vIGlmIGl0cyBhIHRlbXBsYXRlIHRhZyBhbmQgdGhlIGJyb3dzZXIgc3VwcG9ydHMgaXQsXG4gICAgICAgICAgICAvLyBpdHMgY29udGVudCBpcyBhbHJlYWR5IGEgZG9jdW1lbnQgZnJhZ21lbnQhXG4gICAgICAgICAgICBpZiAodGVtcGxhdGVOb2RlLnRhZ05hbWUgPT09ICdURU1QTEFURScgJiYgdGVtcGxhdGVOb2RlLmNvbnRlbnQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGVtcGxhdGVOb2RlLmNvbnRlbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRlbXBsYXRlID0gdGVtcGxhdGVOb2RlLmlubmVySFRNTFxuICAgICAgICB9XG4gICAgICAgIHZhciBub2RlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksXG4gICAgICAgICAgICBmcmFnID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpLFxuICAgICAgICAgICAgY2hpbGRcbiAgICAgICAgbm9kZS5pbm5lckhUTUwgPSB0ZW1wbGF0ZS50cmltKClcbiAgICAgICAgLyoganNoaW50IGJvc3M6IHRydWUgKi9cbiAgICAgICAgd2hpbGUgKGNoaWxkID0gbm9kZS5maXJzdENoaWxkKSB7XG4gICAgICAgICAgICBpZiAobm9kZS5ub2RlVHlwZSA9PT0gMSkge1xuICAgICAgICAgICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQoY2hpbGQpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZyYWdcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIENvbnZlcnQgdGhlIG9iamVjdCB0byBhIFZpZXdNb2RlbCBjb25zdHJ1Y3RvclxuICAgICAqICBpZiBpdCBpcyBub3QgYWxyZWFkeSBvbmVcbiAgICAgKi9cbiAgICB0b0NvbnN0cnVjdG9yOiBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIFZpZXdNb2RlbCA9IFZpZXdNb2RlbCB8fCByZXF1aXJlKCcuL3ZpZXdtb2RlbCcpXG4gICAgICAgIHJldHVybiB1dGlscy5pc09iamVjdChvYmopXG4gICAgICAgICAgICA/IFZpZXdNb2RlbC5leHRlbmQob2JqKVxuICAgICAgICAgICAgOiB0eXBlb2Ygb2JqID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgICAgPyBvYmpcbiAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIENoZWNrIGlmIGEgZmlsdGVyIGZ1bmN0aW9uIGNvbnRhaW5zIHJlZmVyZW5jZXMgdG8gYHRoaXNgXG4gICAgICogIElmIHllcywgbWFyayBpdCBhcyBhIGNvbXB1dGVkIGZpbHRlci5cbiAgICAgKi9cbiAgICBjaGVja0ZpbHRlcjogZnVuY3Rpb24gKGZpbHRlcikge1xuICAgICAgICBpZiAoVEhJU19SRS50ZXN0KGZpbHRlci50b1N0cmluZygpKSkge1xuICAgICAgICAgICAgZmlsdGVyLmNvbXB1dGVkID0gdHJ1ZVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBjb252ZXJ0IGNlcnRhaW4gb3B0aW9uIHZhbHVlcyB0byB0aGUgZGVzaXJlZCBmb3JtYXQuXG4gICAgICovXG4gICAgcHJvY2Vzc09wdGlvbnM6IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgIHZhciBjb21wb25lbnRzID0gb3B0aW9ucy5jb21wb25lbnRzLFxuICAgICAgICAgICAgcGFydGlhbHMgICA9IG9wdGlvbnMucGFydGlhbHMsXG4gICAgICAgICAgICB0ZW1wbGF0ZSAgID0gb3B0aW9ucy50ZW1wbGF0ZSxcbiAgICAgICAgICAgIGZpbHRlcnMgICAgPSBvcHRpb25zLmZpbHRlcnMsXG4gICAgICAgICAgICBrZXlcbiAgICAgICAgaWYgKGNvbXBvbmVudHMpIHtcbiAgICAgICAgICAgIGZvciAoa2V5IGluIGNvbXBvbmVudHMpIHtcbiAgICAgICAgICAgICAgICBjb21wb25lbnRzW2tleV0gPSB1dGlscy50b0NvbnN0cnVjdG9yKGNvbXBvbmVudHNba2V5XSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAocGFydGlhbHMpIHtcbiAgICAgICAgICAgIGZvciAoa2V5IGluIHBhcnRpYWxzKSB7XG4gICAgICAgICAgICAgICAgcGFydGlhbHNba2V5XSA9IHV0aWxzLnRvRnJhZ21lbnQocGFydGlhbHNba2V5XSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoZmlsdGVycykge1xuICAgICAgICAgICAgZm9yIChrZXkgaW4gZmlsdGVycykge1xuICAgICAgICAgICAgICAgIHV0aWxzLmNoZWNrRmlsdGVyKGZpbHRlcnNba2V5XSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAodGVtcGxhdGUpIHtcbiAgICAgICAgICAgIG9wdGlvbnMudGVtcGxhdGUgPSB1dGlscy50b0ZyYWdtZW50KHRlbXBsYXRlKVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICB1c2VkIHRvIGRlZmVyIGJhdGNoIHVwZGF0ZXNcbiAgICAgKi9cbiAgICBuZXh0VGljazogZnVuY3Rpb24gKGNiKSB7XG4gICAgICAgIHRpbWVvdXQoY2IsIDApXG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBhZGQgY2xhc3MgZm9yIElFOVxuICAgICAqICB1c2VzIGNsYXNzTGlzdCBpZiBhdmFpbGFibGVcbiAgICAgKi9cbiAgICBhZGRDbGFzczogZnVuY3Rpb24gKGVsLCBjbHMpIHtcbiAgICAgICAgaWYgKGhhc0NsYXNzTGlzdCkge1xuICAgICAgICAgICAgZWwuY2xhc3NMaXN0LmFkZChjbHMpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YXIgY3VyID0gJyAnICsgZWwuY2xhc3NOYW1lICsgJyAnXG4gICAgICAgICAgICBpZiAoY3VyLmluZGV4T2YoJyAnICsgY2xzICsgJyAnKSA8IDApIHtcbiAgICAgICAgICAgICAgICBlbC5jbGFzc05hbWUgPSAoY3VyICsgY2xzKS50cmltKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgcmVtb3ZlIGNsYXNzIGZvciBJRTlcbiAgICAgKi9cbiAgICByZW1vdmVDbGFzczogZnVuY3Rpb24gKGVsLCBjbHMpIHtcbiAgICAgICAgaWYgKGhhc0NsYXNzTGlzdCkge1xuICAgICAgICAgICAgZWwuY2xhc3NMaXN0LnJlbW92ZShjbHMpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YXIgY3VyID0gJyAnICsgZWwuY2xhc3NOYW1lICsgJyAnLFxuICAgICAgICAgICAgICAgIHRhciA9ICcgJyArIGNscyArICcgJ1xuICAgICAgICAgICAgd2hpbGUgKGN1ci5pbmRleE9mKHRhcikgPj0gMCkge1xuICAgICAgICAgICAgICAgIGN1ciA9IGN1ci5yZXBsYWNlKHRhciwgJyAnKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWwuY2xhc3NOYW1lID0gY3VyLnRyaW0oKVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBDb252ZXJ0IGFuIG9iamVjdCB0byBBcnJheVxuICAgICAqICB1c2VkIGluIHYtcmVwZWF0IGFuZCBhcnJheSBmaWx0ZXJzXG4gICAgICovXG4gICAgb2JqZWN0VG9BcnJheTogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICB2YXIgcmVzID0gW10sIHZhbCwgZGF0YVxuICAgICAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgICAgICAgICB2YWwgPSBvYmpba2V5XVxuICAgICAgICAgICAgZGF0YSA9IHV0aWxzLmlzT2JqZWN0KHZhbClcbiAgICAgICAgICAgICAgICA/IHZhbFxuICAgICAgICAgICAgICAgIDogeyAkdmFsdWU6IHZhbCB9XG4gICAgICAgICAgICBkYXRhLiRrZXkgPSBrZXlcbiAgICAgICAgICAgIHJlcy5wdXNoKGRhdGEpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc1xuICAgIH1cbn1cblxuZW5hYmxlRGVidWcoKVxuZnVuY3Rpb24gZW5hYmxlRGVidWcgKCkge1xuICAgIC8qKlxuICAgICAqICBsb2cgZm9yIGRlYnVnZ2luZ1xuICAgICAqL1xuICAgIHV0aWxzLmxvZyA9IGZ1bmN0aW9uIChtc2cpIHtcbiAgICAgICAgaWYgKGNvbmZpZy5kZWJ1ZyAmJiBjb25zb2xlKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhtc2cpXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogIHdhcm5pbmdzLCB0cmFjZXMgYnkgZGVmYXVsdFxuICAgICAqICBjYW4gYmUgc3VwcHJlc3NlZCBieSBgc2lsZW50YCBvcHRpb24uXG4gICAgICovXG4gICAgdXRpbHMud2FybiA9IGZ1bmN0aW9uIChtc2cpIHtcbiAgICAgICAgaWYgKCFjb25maWcuc2lsZW50ICYmIGNvbnNvbGUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihtc2cpXG4gICAgICAgICAgICBpZiAoY29uZmlnLmRlYnVnICYmIGNvbnNvbGUudHJhY2UpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLnRyYWNlKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0iLCJ2YXIgQ29tcGlsZXIgICA9IHJlcXVpcmUoJy4vY29tcGlsZXInKSxcbiAgICB1dGlscyAgICAgID0gcmVxdWlyZSgnLi91dGlscycpLFxuICAgIHRyYW5zaXRpb24gPSByZXF1aXJlKCcuL3RyYW5zaXRpb24nKSxcbiAgICBCYXRjaGVyICAgID0gcmVxdWlyZSgnLi9iYXRjaGVyJyksXG4gICAgc2xpY2UgICAgICA9IFtdLnNsaWNlLFxuICAgIGRlZiAgICAgICAgPSB1dGlscy5kZWZQcm90ZWN0ZWQsXG4gICAgbmV4dFRpY2sgICA9IHV0aWxzLm5leHRUaWNrLFxuXG4gICAgLy8gYmF0Y2ggJHdhdGNoIGNhbGxiYWNrc1xuICAgIHdhdGNoZXJCYXRjaGVyID0gbmV3IEJhdGNoZXIoKSxcbiAgICB3YXRjaGVySWQgICAgICA9IDFcblxuLyoqXG4gKiAgVmlld01vZGVsIGV4cG9zZWQgdG8gdGhlIHVzZXIgdGhhdCBob2xkcyBkYXRhLFxuICogIGNvbXB1dGVkIHByb3BlcnRpZXMsIGV2ZW50IGhhbmRsZXJzXG4gKiAgYW5kIGEgZmV3IHJlc2VydmVkIG1ldGhvZHNcbiAqL1xuZnVuY3Rpb24gVmlld01vZGVsIChvcHRpb25zKSB7XG4gICAgLy8ganVzdCBjb21waWxlLiBvcHRpb25zIGFyZSBwYXNzZWQgZGlyZWN0bHkgdG8gY29tcGlsZXJcbiAgICBuZXcgQ29tcGlsZXIodGhpcywgb3B0aW9ucylcbn1cblxuLy8gQWxsIFZNIHByb3RvdHlwZSBtZXRob2RzIGFyZSBpbmVudW1lcmFibGVcbi8vIHNvIGl0IGNhbiBiZSBzdHJpbmdpZmllZC9sb29wZWQgdGhyb3VnaCBhcyByYXcgZGF0YVxudmFyIFZNUHJvdG8gPSBWaWV3TW9kZWwucHJvdG90eXBlXG5cbi8qKlxuICogIENvbnZlbmllbmNlIGZ1bmN0aW9uIHRvIGdldCBhIHZhbHVlIGZyb21cbiAqICBhIGtleXBhdGhcbiAqL1xuZGVmKFZNUHJvdG8sICckZ2V0JywgZnVuY3Rpb24gKGtleSkge1xuICAgIHZhciB2YWwgPSB1dGlscy5nZXQodGhpcywga2V5KVxuICAgIHJldHVybiB2YWwgPT09IHVuZGVmaW5lZCAmJiB0aGlzLiRwYXJlbnRcbiAgICAgICAgPyB0aGlzLiRwYXJlbnQuJGdldChrZXkpXG4gICAgICAgIDogdmFsXG59KVxuXG4vKipcbiAqICBDb252ZW5pZW5jZSBmdW5jdGlvbiB0byBzZXQgYW4gYWN0dWFsIG5lc3RlZCB2YWx1ZVxuICogIGZyb20gYSBmbGF0IGtleSBzdHJpbmcuIFVzZWQgaW4gZGlyZWN0aXZlcy5cbiAqL1xuZGVmKFZNUHJvdG8sICckc2V0JywgZnVuY3Rpb24gKGtleSwgdmFsdWUpIHtcbiAgICB1dGlscy5zZXQodGhpcywga2V5LCB2YWx1ZSlcbn0pXG5cbi8qKlxuICogIHdhdGNoIGEga2V5IG9uIHRoZSB2aWV3bW9kZWwgZm9yIGNoYW5nZXNcbiAqICBmaXJlIGNhbGxiYWNrIHdpdGggbmV3IHZhbHVlXG4gKi9cbmRlZihWTVByb3RvLCAnJHdhdGNoJywgZnVuY3Rpb24gKGtleSwgY2FsbGJhY2spIHtcbiAgICAvLyBzYXZlIGEgdW5pcXVlIGlkIGZvciBlYWNoIHdhdGNoZXJcbiAgICB2YXIgaWQgPSB3YXRjaGVySWQrKyxcbiAgICAgICAgc2VsZiA9IHRoaXNcbiAgICBmdW5jdGlvbiBvbiAoKSB7XG4gICAgICAgIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMpXG4gICAgICAgIHdhdGNoZXJCYXRjaGVyLnB1c2goe1xuICAgICAgICAgICAgaWQ6IGlkLFxuICAgICAgICAgICAgb3ZlcnJpZGU6IHRydWUsXG4gICAgICAgICAgICBleGVjdXRlOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2suYXBwbHkoc2VsZiwgYXJncylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG4gICAgY2FsbGJhY2suX2ZuID0gb25cbiAgICBzZWxmLiRjb21waWxlci5vYnNlcnZlci5vbignY2hhbmdlOicgKyBrZXksIG9uKVxufSlcblxuLyoqXG4gKiAgdW53YXRjaCBhIGtleVxuICovXG5kZWYoVk1Qcm90bywgJyR1bndhdGNoJywgZnVuY3Rpb24gKGtleSwgY2FsbGJhY2spIHtcbiAgICAvLyB3b3JrYXJvdW5kIGhlcmVcbiAgICAvLyBzaW5jZSB0aGUgZW1pdHRlciBtb2R1bGUgY2hlY2tzIGNhbGxiYWNrIGV4aXN0ZW5jZVxuICAgIC8vIGJ5IGNoZWNraW5nIHRoZSBsZW5ndGggb2YgYXJndW1lbnRzXG4gICAgdmFyIGFyZ3MgPSBbJ2NoYW5nZTonICsga2V5XSxcbiAgICAgICAgb2IgPSB0aGlzLiRjb21waWxlci5vYnNlcnZlclxuICAgIGlmIChjYWxsYmFjaykgYXJncy5wdXNoKGNhbGxiYWNrLl9mbilcbiAgICBvYi5vZmYuYXBwbHkob2IsIGFyZ3MpXG59KVxuXG4vKipcbiAqICB1bmJpbmQgZXZlcnl0aGluZywgcmVtb3ZlIGV2ZXJ5dGhpbmdcbiAqL1xuZGVmKFZNUHJvdG8sICckZGVzdHJveScsIGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLiRjb21waWxlci5kZXN0cm95KClcbn0pXG5cbi8qKlxuICogIGJyb2FkY2FzdCBhbiBldmVudCB0byBhbGwgY2hpbGQgVk1zIHJlY3Vyc2l2ZWx5LlxuICovXG5kZWYoVk1Qcm90bywgJyRicm9hZGNhc3QnLCBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGNoaWxkcmVuID0gdGhpcy4kY29tcGlsZXIuY2hpbGRyZW4sXG4gICAgICAgIGkgPSBjaGlsZHJlbi5sZW5ndGgsXG4gICAgICAgIGNoaWxkXG4gICAgd2hpbGUgKGktLSkge1xuICAgICAgICBjaGlsZCA9IGNoaWxkcmVuW2ldXG4gICAgICAgIGNoaWxkLmVtaXR0ZXIuZW1pdC5hcHBseShjaGlsZC5lbWl0dGVyLCBhcmd1bWVudHMpXG4gICAgICAgIGNoaWxkLnZtLiRicm9hZGNhc3QuYXBwbHkoY2hpbGQudm0sIGFyZ3VtZW50cylcbiAgICB9XG59KVxuXG4vKipcbiAqICBlbWl0IGFuIGV2ZW50IHRoYXQgcHJvcGFnYXRlcyBhbGwgdGhlIHdheSB1cCB0byBwYXJlbnQgVk1zLlxuICovXG5kZWYoVk1Qcm90bywgJyRkaXNwYXRjaCcsIGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgY29tcGlsZXIgPSB0aGlzLiRjb21waWxlcixcbiAgICAgICAgZW1pdHRlciA9IGNvbXBpbGVyLmVtaXR0ZXIsXG4gICAgICAgIHBhcmVudCA9IGNvbXBpbGVyLnBhcmVudFxuICAgIGVtaXR0ZXIuZW1pdC5hcHBseShlbWl0dGVyLCBhcmd1bWVudHMpXG4gICAgaWYgKHBhcmVudCkge1xuICAgICAgICBwYXJlbnQudm0uJGRpc3BhdGNoLmFwcGx5KHBhcmVudC52bSwgYXJndW1lbnRzKVxuICAgIH1cbn0pXG5cbi8qKlxuICogIGRlbGVnYXRlIG9uL29mZi9vbmNlIHRvIHRoZSBjb21waWxlcidzIGVtaXR0ZXJcbiAqL1xuO1snZW1pdCcsICdvbicsICdvZmYnLCAnb25jZSddLmZvckVhY2goZnVuY3Rpb24gKG1ldGhvZCkge1xuICAgIGRlZihWTVByb3RvLCAnJCcgKyBtZXRob2QsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGVtaXR0ZXIgPSB0aGlzLiRjb21waWxlci5lbWl0dGVyXG4gICAgICAgIGVtaXR0ZXJbbWV0aG9kXS5hcHBseShlbWl0dGVyLCBhcmd1bWVudHMpXG4gICAgfSlcbn0pXG5cbi8vIERPTSBjb252ZW5pZW5jZSBtZXRob2RzXG5cbmRlZihWTVByb3RvLCAnJGFwcGVuZFRvJywgZnVuY3Rpb24gKHRhcmdldCwgY2IpIHtcbiAgICB0YXJnZXQgPSBxdWVyeSh0YXJnZXQpXG4gICAgdmFyIGVsID0gdGhpcy4kZWxcbiAgICB0cmFuc2l0aW9uKGVsLCAxLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRhcmdldC5hcHBlbmRDaGlsZChlbClcbiAgICAgICAgaWYgKGNiKSBuZXh0VGljayhjYilcbiAgICB9LCB0aGlzLiRjb21waWxlcilcbn0pXG5cbmRlZihWTVByb3RvLCAnJHJlbW92ZScsIGZ1bmN0aW9uIChjYikge1xuICAgIHZhciBlbCA9IHRoaXMuJGVsXG4gICAgdHJhbnNpdGlvbihlbCwgLTEsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKGVsLnBhcmVudE5vZGUpIHtcbiAgICAgICAgICAgIGVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoZWwpXG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNiKSBuZXh0VGljayhjYilcbiAgICB9LCB0aGlzLiRjb21waWxlcilcbn0pXG5cbmRlZihWTVByb3RvLCAnJGJlZm9yZScsIGZ1bmN0aW9uICh0YXJnZXQsIGNiKSB7XG4gICAgdGFyZ2V0ID0gcXVlcnkodGFyZ2V0KVxuICAgIHZhciBlbCA9IHRoaXMuJGVsXG4gICAgdHJhbnNpdGlvbihlbCwgMSwgZnVuY3Rpb24gKCkge1xuICAgICAgICB0YXJnZXQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZWwsIHRhcmdldClcbiAgICAgICAgaWYgKGNiKSBuZXh0VGljayhjYilcbiAgICB9LCB0aGlzLiRjb21waWxlcilcbn0pXG5cbmRlZihWTVByb3RvLCAnJGFmdGVyJywgZnVuY3Rpb24gKHRhcmdldCwgY2IpIHtcbiAgICB0YXJnZXQgPSBxdWVyeSh0YXJnZXQpXG4gICAgdmFyIGVsID0gdGhpcy4kZWxcbiAgICB0cmFuc2l0aW9uKGVsLCAxLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh0YXJnZXQubmV4dFNpYmxpbmcpIHtcbiAgICAgICAgICAgIHRhcmdldC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShlbCwgdGFyZ2V0Lm5leHRTaWJsaW5nKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGFyZ2V0LnBhcmVudE5vZGUuYXBwZW5kQ2hpbGQoZWwpXG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNiKSBuZXh0VGljayhjYilcbiAgICB9LCB0aGlzLiRjb21waWxlcilcbn0pXG5cbmZ1bmN0aW9uIHF1ZXJ5IChlbCkge1xuICAgIHJldHVybiB0eXBlb2YgZWwgPT09ICdzdHJpbmcnXG4gICAgICAgID8gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihlbClcbiAgICAgICAgOiBlbFxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXdNb2RlbCIsIihmdW5jdGlvbiAoKSB7XG52YXIgcm9vdCA9IHRoaXMsIGV4cG9ydHMgPSB7fTtcblxuLy8gVGhlIGphZGUgcnVudGltZTpcbnZhciBqYWRlID0gZXhwb3J0cy5qYWRlPWZ1bmN0aW9uKGV4cG9ydHMpe0FycmF5LmlzQXJyYXl8fChBcnJheS5pc0FycmF5PWZ1bmN0aW9uKGFycil7cmV0dXJuXCJbb2JqZWN0IEFycmF5XVwiPT1PYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoYXJyKX0pLE9iamVjdC5rZXlzfHwoT2JqZWN0LmtleXM9ZnVuY3Rpb24ob2JqKXt2YXIgYXJyPVtdO2Zvcih2YXIga2V5IGluIG9iailvYmouaGFzT3duUHJvcGVydHkoa2V5KSYmYXJyLnB1c2goa2V5KTtyZXR1cm4gYXJyfSksZXhwb3J0cy5tZXJnZT1mdW5jdGlvbiBtZXJnZShhLGIpe3ZhciBhYz1hW1wiY2xhc3NcIl0sYmM9YltcImNsYXNzXCJdO2lmKGFjfHxiYylhYz1hY3x8W10sYmM9YmN8fFtdLEFycmF5LmlzQXJyYXkoYWMpfHwoYWM9W2FjXSksQXJyYXkuaXNBcnJheShiYyl8fChiYz1bYmNdKSxhYz1hYy5maWx0ZXIobnVsbHMpLGJjPWJjLmZpbHRlcihudWxscyksYVtcImNsYXNzXCJdPWFjLmNvbmNhdChiYykuam9pbihcIiBcIik7Zm9yKHZhciBrZXkgaW4gYilrZXkhPVwiY2xhc3NcIiYmKGFba2V5XT1iW2tleV0pO3JldHVybiBhfTtmdW5jdGlvbiBudWxscyh2YWwpe3JldHVybiB2YWwhPW51bGx9cmV0dXJuIGV4cG9ydHMuYXR0cnM9ZnVuY3Rpb24gYXR0cnMob2JqLGVzY2FwZWQpe3ZhciBidWY9W10sdGVyc2U9b2JqLnRlcnNlO2RlbGV0ZSBvYmoudGVyc2U7dmFyIGtleXM9T2JqZWN0LmtleXMob2JqKSxsZW49a2V5cy5sZW5ndGg7aWYobGVuKXtidWYucHVzaChcIlwiKTtmb3IodmFyIGk9MDtpPGxlbjsrK2kpe3ZhciBrZXk9a2V5c1tpXSx2YWw9b2JqW2tleV07XCJib29sZWFuXCI9PXR5cGVvZiB2YWx8fG51bGw9PXZhbD92YWwmJih0ZXJzZT9idWYucHVzaChrZXkpOmJ1Zi5wdXNoKGtleSsnPVwiJytrZXkrJ1wiJykpOjA9PWtleS5pbmRleE9mKFwiZGF0YVwiKSYmXCJzdHJpbmdcIiE9dHlwZW9mIHZhbD9idWYucHVzaChrZXkrXCI9J1wiK0pTT04uc3RyaW5naWZ5KHZhbCkrXCInXCIpOlwiY2xhc3NcIj09a2V5JiZBcnJheS5pc0FycmF5KHZhbCk/YnVmLnB1c2goa2V5Kyc9XCInK2V4cG9ydHMuZXNjYXBlKHZhbC5qb2luKFwiIFwiKSkrJ1wiJyk6ZXNjYXBlZCYmZXNjYXBlZFtrZXldP2J1Zi5wdXNoKGtleSsnPVwiJytleHBvcnRzLmVzY2FwZSh2YWwpKydcIicpOmJ1Zi5wdXNoKGtleSsnPVwiJyt2YWwrJ1wiJyl9fXJldHVybiBidWYuam9pbihcIiBcIil9LGV4cG9ydHMuZXNjYXBlPWZ1bmN0aW9uIGVzY2FwZShodG1sKXtyZXR1cm4gU3RyaW5nKGh0bWwpLnJlcGxhY2UoLyYoPyEoXFx3K3xcXCNcXGQrKTspL2csXCImYW1wO1wiKS5yZXBsYWNlKC88L2csXCImbHQ7XCIpLnJlcGxhY2UoLz4vZyxcIiZndDtcIikucmVwbGFjZSgvXCIvZyxcIiZxdW90O1wiKX0sZXhwb3J0cy5yZXRocm93PWZ1bmN0aW9uIHJldGhyb3coZXJyLGZpbGVuYW1lLGxpbmVubyl7aWYoIWZpbGVuYW1lKXRocm93IGVycjt2YXIgY29udGV4dD0zLHN0cj1yZXF1aXJlKFwiZnNcIikucmVhZEZpbGVTeW5jKGZpbGVuYW1lLFwidXRmOFwiKSxsaW5lcz1zdHIuc3BsaXQoXCJcXG5cIiksc3RhcnQ9TWF0aC5tYXgobGluZW5vLWNvbnRleHQsMCksZW5kPU1hdGgubWluKGxpbmVzLmxlbmd0aCxsaW5lbm8rY29udGV4dCksY29udGV4dD1saW5lcy5zbGljZShzdGFydCxlbmQpLm1hcChmdW5jdGlvbihsaW5lLGkpe3ZhciBjdXJyPWkrc3RhcnQrMTtyZXR1cm4oY3Vycj09bGluZW5vP1wiICA+IFwiOlwiICAgIFwiKStjdXJyK1wifCBcIitsaW5lfSkuam9pbihcIlxcblwiKTt0aHJvdyBlcnIucGF0aD1maWxlbmFtZSxlcnIubWVzc2FnZT0oZmlsZW5hbWV8fFwiSmFkZVwiKStcIjpcIitsaW5lbm8rXCJcXG5cIitjb250ZXh0K1wiXFxuXFxuXCIrZXJyLm1lc3NhZ2UsZXJyfSxleHBvcnRzfSh7fSk7XG5cblxuLy8gY3JlYXRlIG91ciBmb2xkZXIgb2JqZWN0c1xuXG4vLyBjb250YWluZXIuamFkZSBjb21waWxlZCB0ZW1wbGF0ZVxuZXhwb3J0c1tcImNvbnRhaW5lclwiXSA9IGZ1bmN0aW9uIHRtcGxfY29udGFpbmVyKCkge1xuICAgIHJldHVybiAnPGhlYWRlcj48aDE+TmFuY2xlIERlbW88L2gxPjxuYXY+PHVsPjxsaSB2LXJlcGVhdD1cInJvdXRlc1wiPjxhIGhyZWY9XCIjIS97eyR2YWx1ZX19XCIgdi1jbGFzcz1cImN1cnJlbnQ6Y3VycmVudFJvdXRlID09ICR2YWx1ZVwiPnt7JHZhbHVlfX08L2E+PC9saT48L3VsPjwvbmF2PjwvaGVhZGVyPjxhcnRpY2xlIHYtdmlldz1cImN1cnJlbnRWaWV3XCIgdi13aXRoPVwiZ2xvYmFsOiBzdWJkYXRhXCIgdi10cmFuc2l0aW9uIGNsYXNzPVwidmlld1wiPjwvYXJ0aWNsZT4nO1xufTtcblxuLy8gaG9tZS5qYWRlIGNvbXBpbGVkIHRlbXBsYXRlXG5leHBvcnRzW1wiaG9tZVwiXSA9IGZ1bmN0aW9uIHRtcGxfaG9tZSgpIHtcbiAgICByZXR1cm4gJzxoMT5Ib21lPC9oMT48cD5IZWxsbyEge3ttc2d9fSB7e2dsb2JhbC50ZXN0fX08L3A+PGlucHV0IHYtbW9kZWw9XCJtZXNzYWdlXCI+PHA+e3ttZXNzYWdlfX08L3A+Jztcbn07XG5cbi8vIG5vdGZvdW5kLmphZGUgY29tcGlsZWQgdGVtcGxhdGVcbmV4cG9ydHNbXCJub3Rmb3VuZFwiXSA9IGZ1bmN0aW9uIHRtcGxfbm90Zm91bmQoKSB7XG4gICAgcmV0dXJuICc8aDE+NDA0PC9oMT4nO1xufTtcblxuLy8gcGFnZTEuamFkZSBjb21waWxlZCB0ZW1wbGF0ZVxuZXhwb3J0c1tcInBhZ2UxXCJdID0gZnVuY3Rpb24gdG1wbF9wYWdlMSgpIHtcbiAgICByZXR1cm4gJzxoMT5QYWdlMTwvaDE+PHA+SGVsbG8hIHt7bXNnfX0ge3tnbG9iYWwudGVzdH19PC9wPic7XG59O1xuXG4vLyBwYWdlMi5qYWRlIGNvbXBpbGVkIHRlbXBsYXRlXG5leHBvcnRzW1wicGFnZTJcIl0gPSBmdW5jdGlvbiB0bXBsX3BhZ2UyKCkge1xuICAgIHJldHVybiAnPGgxPlBhZ2UyPC9oMT48cD5IZWxsbyEge3ttc2d9fSB7e2dsb2JhbC50ZXN0fX08L3A+Jztcbn07XG5cblxuLy8gYXR0YWNoIHRvIHdpbmRvdyBvciBleHBvcnQgd2l0aCBjb21tb25KU1xuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzO1xufSBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSBcImZ1bmN0aW9uXCIgJiYgZGVmaW5lLmFtZCkge1xuICAgIGRlZmluZShleHBvcnRzKTtcbn0gZWxzZSB7XG4gICAgcm9vdC50ZW1wbGF0aXplciA9IGV4cG9ydHM7XG59XG5cbn0pKCk7IiwiVnVlID0gcmVxdWlyZSAndnVlJ1xubmFuY2xlID0gcmVxdWlyZSAnLi9yb3V0ZXInXG50ZW1wbGF0ZXMgPSByZXF1aXJlICcuL190ZW1wbGF0ZXMuanMnXG52bSA9IHJlcXVpcmUgJy4vdmlld21vZGVsJ1xuXG5yb3V0ZXIgPSBuZXcgbmFuY2xlLlJvdXRlciB7cm91dGVzOiBbJ2hvbWUnLCAncGFnZTEnLCAncGFnZTInXX1cblxuaW5pdGlhbFJvdXRlID0gcm91dGVyLmdldFJvdXRlKClcblxuY29udGFpbmVyID0gbmV3IFZ1ZVxuICBlbDogJyNjb250YWluZXInXG4gIHRlbXBsYXRlOiB0ZW1wbGF0ZXMuY29udGFpbmVyKClcbiAgZGF0YTpcbiAgICBjdXJyZW50Um91dGU6IGluaXRpYWxSb3V0ZVxuICAgIHJvdXRlczogcm91dGVyLnJvdXRlc1xuICAgIHN1YmRhdGE6XG4gICAgICB0ZXN0OiAnMTIzJ1xuICBjb21wdXRlZDpcbiAgICBjdXJyZW50VmlldzpcbiAgICAgICRnZXQ6ICgpIC0+XG4gICAgICAgICduYW5jbGUtJyArIEBjdXJyZW50Um91dGVcbiAgY3JlYXRlZDogKCkgLT5cbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lciAnaGFzaGNoYW5nZScsICgpID0+XG4gICAgICBAY3VycmVudFJvdXRlID0gcm91dGVyLmdldFJvdXRlKClcbiIsIm1vZHVsZS5leHBvcnRzID1cbiAgUm91dGVyOiBjbGFzcyBSb3V0ZXJcbiAgICBjb25zdHJ1Y3RvcjogKG9wdGlvbnMpIC0+XG4gICAgICB7QHJvdXRlc30gPSBvcHRpb25zXG5cbiAgICBnZXRSb3V0ZTogKCkgLT5cbiAgICAgIHBhdGggPSBsb2NhdGlvbi5oYXNoLnJlcGxhY2UoL14jIVxcLz8vLCAnJykgfHwgJ2hvbWUnXG4gICAgICByZXR1cm4gaWYgQHJvdXRlcy5pbmRleE9mKHBhdGgpID4gLTEgdGhlbiBwYXRoIGVsc2UgJ25vdGZvdW5kJ1xuIiwiVnVlID0gcmVxdWlyZSAndnVlJ1xudGVtcGxhdGVzID0gcmVxdWlyZSAnLi9fdGVtcGxhdGVzLmpzJ1xuI21vZGVsID0gcmVxdWlyZSAnLi9tb2RlbCdcblxuVnVlLmNvbXBvbmVudCAnbmFuY2xlLWhvbWUnLCBWdWUuZXh0ZW5kXG4gIHRlbXBsYXRlOiB0ZW1wbGF0ZXMuaG9tZSgpXG4gIGNyZWF0ZWQ6ICgpIC0+XG4gICAgQG1zZyA9ICdIb21lIHN3ZWV0IGhvbWUhJ1xuXG5WdWUuY29tcG9uZW50ICduYW5jbGUtcGFnZTEnLCBWdWUuZXh0ZW5kXG4gIHRlbXBsYXRlOiB0ZW1wbGF0ZXMucGFnZTEoKVxuICBjcmVhdGVkOiAoKSAtPlxuICAgIEBtc2cgPSAnV2VsY29tZSB0byBwYWdlIDEhJ1xuXG5WdWUuY29tcG9uZW50ICduYW5jbGUtcGFnZTInLCBWdWUuZXh0ZW5kXG4gIHRlbXBsYXRlOiB0ZW1wbGF0ZXMucGFnZTIoKVxuICBjcmVhdGVkOiAoKSAtPlxuICAgIEBtc2cgPSAnV2VsY29tZSB0byBwYWdlIDIhJ1xuXG5WdWUuY29tcG9uZW50ICduYW5jbGUtbm90Zm91bmQnLCBWdWUuZXh0ZW5kXG4gIHRlbXBsYXRlOiB0ZW1wbGF0ZXMubm90Zm91bmQoKVxuXG4iXX0=
