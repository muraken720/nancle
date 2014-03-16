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
        if (job.cancelled) continue
        if (job.execute() !== false) {
            this.has[job.id] = false
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
},{"./utils":23}],3:[function(require,module,exports){
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
                } else {
                    return false
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
    
    // cache methods
    slice       = [].slice,
    log         = utils.log,
    makeHash    = utils.hash,
    extend      = utils.extend,
    def         = utils.defProtected,
    hasOwn      = ({}).hasOwnProperty,

    // hooks to register
    hooks = [
        'created', 'ready',
        'beforeDestroy', 'afterDestroy',
        'attached', 'detached'
    ]

/**
 *  The DOM compiler
 *  scans a DOM node and compile bindings for a ViewModel
 */
function Compiler (vm, options) {

    var compiler = this

    // default state
    compiler.init       = true
    compiler.repeat     = false
    compiler.destroyed  = false
    compiler.delayReady = false

    // process and extend options
    options = compiler.options = options || makeHash()
    utils.processOptions(options)

    // copy data, methods & compiler options
    var data = compiler.data = options.data || {}
    extend(vm, data, true)
    extend(vm, options.methods, true)
    extend(compiler, options.compilerOptions)

    // initialize element
    var el = compiler.el = compiler.setupElement(options)
    log('\nnew VM instance: ' + el.tagName + '\n')

    // set compiler properties
    compiler.vm = el.vue_vm = vm
    compiler.bindings = makeHash()
    compiler.dirs = []
    compiler.deferred = []
    compiler.exps = []
    compiler.computed = []
    compiler.children = []
    compiler.emitter = new Emitter()
    compiler.emitter._ctx = vm
    compiler.delegators = makeHash()

    // set inenumerable VM properties
    def(vm, '$', makeHash())
    def(vm, '$el', el)
    def(vm, '$options', options)
    def(vm, '$compiler', compiler)

    // set parent VM
    // and register child id on parent
    var parentVM = options.parent,
        childId = utils.attr(el, 'ref')
    if (parentVM) {
        compiler.parent = parentVM.$compiler
        parentVM.$compiler.children.push(compiler)
        def(vm, '$parent', parentVM)
        if (childId) {
            compiler.childId = childId
            parentVM.$[childId] = vm
        }
    }

    // set root
    def(vm, '$root', getRoot(compiler).vm)

    // setup observer
    compiler.setupObserver()

    // create bindings for computed properties
    var computed = options.computed
    if (computed) {
        for (var key in computed) {
            compiler.createBinding(key)
        }
    }

    // copy paramAttributes
    if (options.paramAttributes) {
        options.paramAttributes.forEach(function (attr) {
            var val = el.getAttribute(attr)
            vm[attr] = (isNaN(val) || val === null)
                ? val
                : Number(val)
        })
    }

    // beforeCompile hook
    compiler.execHook('created')

    // the user might have set some props on the vm 
    // so copy it back to the data...
    extend(data, vm)

    // observe the data
    compiler.observeData(data)
    
    // for repeated items, create index/key bindings
    // because they are ienumerable
    if (compiler.repeat) {
        compiler.createBinding('$index')
        if (data.$key) compiler.createBinding('$key')
    }

    // now parse the DOM, during which we will create necessary bindings
    // and bind the parsed directives
    compiler.compile(el, true)

    // bind deferred directives (child components)
    compiler.deferred.forEach(compiler.bindDirective, compiler)

    // extract dependencies for computed properties
    compiler.parseDeps()

    // done!
    compiler.rawContent = null
    compiler.init = false

    // post compile / ready hook
    if (!compiler.delayReady) {
        compiler.execHook('ready')
    }
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

    var template = options.template
    if (template) {
        // collect anything already in there
        /* jshint boss: true */
        var child,
            frag = this.rawContent = document.createDocumentFragment()
        while (child = el.firstChild) {
            frag.appendChild(child)
        }
        // replace option: use the first node in
        // the template directly
        if (options.replace && template.childNodes.length === 1) {
            var replacer = template.childNodes[0].cloneNode(true)
            if (el.parentNode) {
                el.parentNode.insertBefore(replacer, el)
                el.parentNode.removeChild(el)
            }
            el = replacer
        } else {
            el.appendChild(template.cloneNode(true))
        }
    }

    // apply element options
    if (options.id) el.id = options.id
    if (options.className) el.className = options.className
    var attrs = options.attributes
    if (attrs) {
        for (var attr in attrs) {
            el.setAttribute(attr, attrs[attr])
        }
    }

    return el
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
        observer = compiler.observer = new Emitter()

    // a hash to hold event proxies for each root level key
    // so they can be referenced and removed later
    observer.proxies = makeHash()
    observer._ctx = compiler.vm

    // add own listeners which trigger binding updates
    observer
        .on('get', onGet)
        .on('set', onSet)
        .on('mutate', onSet)

    // register hooks
    hooks.forEach(function (hook) {
        var fns = options[hook]
        if (Array.isArray(fns)) {
            var i = fns.length
            // since hooks were merged with child at head,
            // we loop reversely.
            while (i--) {
                registerHook(hook, fns[i])
            }
        } else if (fns) {
            registerHook(hook, fns)
        }
    })

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
    defGetSet(compiler.vm, '$data', {
        enumerable: false,
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
            compiler.observer.emit('set', '$data', newData)
        }
    })

    // emit $data change on all changes
    observer
        .on('set', onSet)
        .on('mutate', onSet)

    function onSet (key) {
        if (key !== '$data') {
            $dataBinding.update(compiler.data)
        }
    }
}

/**
 *  Compile a DOM node (recursive)
 */
CompilerProto.compile = function (node, root) {

    var compiler = this,
        nodeType = node.nodeType,
        tagName  = node.tagName

    if (nodeType === 1 && tagName !== 'SCRIPT') { // a normal node

        // skip anything with v-pre
        if (utils.attr(node, 'pre') !== null) return

        // special attributes to check
        var repeatExp,
            withExp,
            partialId,
            directive,
            componentId = utils.attr(node, 'component') || tagName.toLowerCase(),
            componentCtor = compiler.getOption('components', componentId)

        // It is important that we access these attributes
        // procedurally because the order matters.
        //
        // `utils.attr` removes the attribute once it gets the
        // value, so we should not access them all at once.

        // v-repeat has the highest priority
        // and we need to preserve all other attributes for it.
        /* jshint boss: true */
        if (repeatExp = utils.attr(node, 'repeat')) {

            // repeat block cannot have v-id at the same time.
            directive = Directive.parse('repeat', repeatExp, compiler, node)
            if (directive) {
                directive.Ctor = componentCtor
                // defer child component compilation
                // so by the time they are compiled, the parent
                // would have collected all bindings
                compiler.deferred.push(directive)
            }

        // v-with has 2nd highest priority
        } else if (root !== true && ((withExp = utils.attr(node, 'with')) || componentCtor)) {

            withExp = Directive.split(withExp || '')
            withExp.forEach(function (exp, i) {
                var directive = Directive.parse('with', exp, compiler, node)
                if (directive) {
                    directive.Ctor = componentCtor
                    // notify the directive that this is the
                    // last expression in the group
                    directive.last = i === withExp.length - 1
                    compiler.deferred.push(directive)
                }
            })

        } else {

            // check transition & animation properties
            node.vue_trans  = utils.attr(node, 'transition')
            node.vue_anim   = utils.attr(node, 'animation')
            node.vue_effect = utils.attr(node, 'effect')
            
            // replace innerHTML with partial
            partialId = utils.attr(node, 'partial')
            if (partialId) {
                var partial = compiler.getOption('partials', partialId)
                if (partial) {
                    node.innerHTML = ''
                    node.appendChild(partial.cloneNode(true))
                }
            }

            // finally, only normal directives left!
            compiler.compileNode(node)
        }

    } else if (nodeType === 3 && config.interpolate) { // text node

        compiler.compileTextNode(node)

    }

}

/**
 *  Compile a normal node
 */
CompilerProto.compileNode = function (node) {
    var i, j,
        attrs = slice.call(node.attributes),
        prefix = config.prefix + '-'
    // parse if has attributes
    if (attrs && attrs.length) {
        var attr, isDirective, exps, exp, directive, dirname
        // loop through all attributes
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
                j = exps.length
                while (j--) {
                    exp = exps[j]
                    dirname = attr.name.slice(prefix.length)
                    directive = Directive.parse(dirname, exp, this, node)
                    if (directive) {
                        this.bindDirective(directive)
                    }
                }
            } else if (config.interpolate) {
                // non directive attribute, check interpolation tags
                exp = TextParser.parseAttr(attr.value)
                if (exp) {
                    directive = Directive.parse('attr', attr.name + ':' + exp, this, node)
                    if (directive) {
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
    if (node.childNodes.length) {
        slice.call(node.childNodes).forEach(this.compile, this)
    }
}

/**
 *  Compile a text node
 */
CompilerProto.compileTextNode = function (node) {

    var tokens = TextParser.parse(node.nodeValue)
    if (!tokens) return
    var el, token, directive, partial, partialId, partialNodes

    for (var i = 0, l = tokens.length; i < l; i++) {
        token = tokens[i]
        directive = partialNodes = null
        if (token.key) { // a binding
            if (token.key.charAt(0) === '>') { // a partial
                partialId = token.key.slice(1).trim()
                if (partialId === 'yield') {
                    el = this.rawContent
                } else {
                    partial = this.getOption('partials', partialId)
                    if (partial) {
                        el = partial.cloneNode(true)
                    } else {
                        utils.warn('Unknown partial: ' + partialId)
                        continue
                    }
                }
                if (el) {
                    // save an Array reference of the partial's nodes
                    // so we can compile them AFTER appending the fragment
                    partialNodes = slice.call(el.childNodes)
                }
            } else { // a real binding
                if (!token.html) { // text binding
                    el = document.createTextNode('')
                    directive = Directive.parse('text', token.key, this, el)
                } else { // html binding
                    el = document.createComment(config.prefix + '-html')
                    directive = Directive.parse('html', token.key, this, el)
                }
            }
        } else { // a plain string
            el = document.createTextNode(token)
        }

        // insert node
        node.parentNode.insertBefore(el, node)

        // bind directive
        if (directive) {
            this.bindDirective(directive)
        }

        // compile partial after appending, because its children's parentNode
        // will change from the fragment to the correct parentNode.
        // This could affect directives that need access to its element's parentNode.
        if (partialNodes) {
            partialNodes.forEach(this.compile, this)
        }

    }
    node.parentNode.removeChild(node)
}

/**
 *  Add a directive instance to the correct binding & viewmodel
 */
CompilerProto.bindDirective = function (directive) {

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
        compiler = this,
        key      = directive.key

    if (directive.isExp) {
        // expression bindings are always created on current compiler
        binding = compiler.createBinding(key, true, directive.isFn)
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
CompilerProto.createBinding = function (key, isExp, isFn) {

    log('  created binding: ' + key)

    var compiler = this,
        bindings = compiler.bindings,
        computed = compiler.options.computed,
        binding  = new Binding(compiler, key, isExp, isFn)

    if (isExp) {
        // expression bindings are anonymous
        compiler.defineExp(key, binding)
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
        } else {
            // ensure path in data so it can be observed
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
    if (!(key in data)) {
        data[key] = undefined
    }

    // if the data object is already observed, but the key
    // is not observed, we need to add it to the observed keys.
    if (ob && !(key in ob.values)) {
        Observer.convertKey(data, key)
    }

    binding.value = data[key]

    defGetSet(compiler.vm, key, {
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
    var vm = this.vm,
        ob = this.observer,
        value = binding.value = vm[key] || this.data[key]
    // remove initital meta in data, since the same piece
    // of data can be observed by different VMs, each have
    // its own associated meta info.
    delete this.data[key]
    defGetSet(vm, key, {
        get: function () {
            if (Observer.shouldGet) ob.emit('get', key)
            return value
        },
        set: function (val) {
            ob.emit('set', key, val)
            value = val
        }
    })
}

/**
 *  Define an expression binding, which is essentially
 *  an anonymous computed property
 */
CompilerProto.defineExp = function (key, binding) {
    var getter = ExpParser.parse(key, this)
    if (getter) {
        this.markComputed(binding, getter)
        this.exps.push(binding)
    }
}

/**
 *  Define a computed property on the VM
 */
CompilerProto.defineComputed = function (key, binding, value) {
    this.markComputed(binding, value)
    defGetSet(this.vm, key, {
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
CompilerProto.getOption = function (type, id) {
    var opts = this.options,
        parent = this.parent,
        globalAssets = config.globalAssets
    return (opts[type] && opts[type][id]) || (
        parent
            ? parent.getOption(type, id)
            : globalAssets[type] && globalAssets[type][id]
    )
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
    var baseKey = key.split('.')[0]
    return hasOwn.call(this.data, baseKey) ||
        hasOwn.call(this.vm, baseKey)
}

/**
 *  Collect dependencies for computed properties
 */
CompilerProto.parseDeps = function () {
    if (!this.computed.length) return
    DepsParser.parse(this.computed)
}

/**
 *  Add an event delegation listener
 *  listeners are instances of directives with `isFn:true`
 */
CompilerProto.addListener = function (listener) {
    var event = listener.arg,
        delegator = this.delegators[event]
    if (!delegator) {
        // initialize a delegator
        delegator = this.delegators[event] = {
            targets: [],
            handler: function (e) {
                var i = delegator.targets.length,
                    target
                while (i--) {
                    target = delegator.targets[i]
                    if (target.el.contains(e.target) && target.handler) {
                        target.handler(e)
                    }
                }
            }
        }
        this.el.addEventListener(event, delegator.handler)
    }
    delegator.targets.push(listener)
}

/**
 *  Remove an event delegation listener
 */
CompilerProto.removeListener = function (listener) {
    var targets = this.delegators[listener.arg].targets
    targets.splice(targets.indexOf(listener), 1)
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
        exps        = compiler.exps,
        bindings    = compiler.bindings,
        delegators  = compiler.delegators,
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

    // unbind all expressions (anonymous bindings)
    i = exps.length
    while (i--) {
        exps[i].unbind()
    }

    // unbind all own bindings
    for (key in bindings) {
        binding = bindings[key]
        if (binding) {
            binding.unbind()
        }
    }

    // remove all event delegators
    for (key in delegators) {
        el.removeEventListener(key, delegators[key].handler)
    }

    // destroy all children
    i = children.length
    while (i--) {
        children[i].destroy()
    }

    // remove self from parent
    if (parent) {
        parent.children.splice(parent.children.indexOf(compiler), 1)
        if (compiler.childId) {
            delete parent.vm.$[compiler.childId]
        }
    }

    // finally remove dom element
    if (el === document.body) {
        el.innerHTML = ''
    } else {
        vm.$remove()
    }
    el.vue_vm = null

    this.destroyed = true
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

/**
 *  for convenience & minification
 */
function defGetSet (obj, key, def) {
    Object.defineProperty(obj, key, def)
}

module.exports = Compiler
},{"./binding":3,"./config":5,"./deps-parser":6,"./directive":7,"./emitter":16,"./exp-parser":17,"./observer":20,"./text-parser":21,"./utils":23}],5:[function(require,module,exports){
var prefix = 'v',
    specialAttributes = [
        'pre',
        'ref',
        'with',
        'text',
        'repeat',
        'partial',
        'component',
        'animation',
        'transition',
        'effect'
    ],
    config = module.exports = {

        debug       : false,
        silent      : false,
        enterClass  : 'v-enter',
        leaveClass  : 'v-leave',
        interpolate : true,
        attrs       : {},

        get prefix () {
            return prefix
        },
        set prefix (val) {
            prefix = val
            updatePrefix()
        }
        
    }

function updatePrefix () {
    specialAttributes.forEach(function (attr) {
        config.attrs[attr] = prefix + '-' + attr
    })
}

updatePrefix()
},{}],6:[function(require,module,exports){
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
        if (has && has.compiler === dep.compiler) return
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
},{"./emitter":16,"./observer":20,"./utils":23}],7:[function(require,module,exports){
var utils      = require('./utils'),
    directives = require('./directives'),
    filters    = require('./filters'),

    // Regexes!

    // regex to split multiple directive expressions
    // split by commas, but ignore commas within quotes, parens and escapes.
    SPLIT_RE        = /(?:['"](?:\\.|[^'"])*['"]|\((?:\\.|[^\)])*\)|\\.|[^,])+/g,

    // match up to the first single pipe, ignore those within quotes.
    KEY_RE          = /^(?:['"](?:\\.|[^'"])*['"]|\\.|[^\|]|\|\|)+/,

    ARG_RE          = /^([\w-$ ]+):(.+)$/,
    FILTERS_RE      = /\|[^\|]+/g,
    FILTER_TOKEN_RE = /[^\s']+|'[^']+'/g,
    NESTING_RE      = /^\$(parent|root)\./,
    SINGLE_VAR_RE   = /^[\w\.$]+$/

/**
 *  Directive class
 *  represents a single directive instance in the DOM
 */
function Directive (definition, expression, rawKey, compiler, node) {

    this.compiler = compiler
    this.vm       = compiler.vm
    this.el       = node

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

    this.expression = expression.trim()
    this.rawKey     = rawKey
    
    parseKey(this, rawKey)

    this.isExp = !SINGLE_VAR_RE.test(this.key) || NESTING_RE.test(this.key)
    
    var filterExps = this.expression.slice(rawKey.length).match(FILTERS_RE)
    if (filterExps) {
        this.filters = []
        for (var i = 0, l = filterExps.length, filter; i < l; i++) {
            filter = parseFilter(filterExps[i], this.compiler)
            if (filter) this.filters.push(filter)
        }
        if (!this.filters.length) this.filters = null
    } else {
        this.filters = null
    }
}

var DirProto = Directive.prototype

/**
 *  parse a key, extract argument and nesting/root info
 */
function parseKey (dir, rawKey) {
    var key = rawKey
    if (rawKey.indexOf(':') > -1) {
        var argMatch = rawKey.match(ARG_RE)
        key = argMatch
            ? argMatch[2].trim()
            : key
        dir.arg = argMatch
            ? argMatch[1].trim()
            : null
    }
    dir.key = key
}

/**
 *  parse a filter expression
 */
function parseFilter (filter, compiler) {

    var tokens = filter.slice(1).match(FILTER_TOKEN_RE)
    if (!tokens) return
    tokens = tokens.map(function (token) {
        return token.replace(/'/g, '').trim()
    })

    var name = tokens[0],
        apply = compiler.getOption('filters', name) || filters[name]
    if (!apply) {
        utils.warn('Unknown filter: ' + name)
        return
    }

    return {
        name  : name,
        apply : apply,
        args  : tokens.length > 1
                ? tokens.slice(1)
                : null
    }
}

/**
 *  called when a new value is set 
 *  for computed properties, this will only be called once
 *  during initialization.
 */
DirProto.update = function (value, init) {
    var type = utils.typeOf(value)
    if (init || value !== this.value || type === 'Object' || type === 'Array') {
        this.value = value
        if (this._update) {
            this._update(
                this.filters
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
        filtered = filter.apply.call(this.vm, filtered, filter.args)
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

// exposed methods ------------------------------------------------------------

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
 *  make sure the directive and expression is valid
 *  before we create an instance
 */
Directive.parse = function (dirname, expression, compiler, node) {

    var dir = compiler.getOption('directives', dirname) || directives[dirname]
    if (!dir) return utils.warn('unknown directive: ' + dirname)

    var rawKey
    if (expression.indexOf('|') > -1) {
        var keyMatch = expression.match(KEY_RE)
        if (keyMatch) {
            rawKey = keyMatch[0].trim()
        }
    } else {
        rawKey = expression.trim()
    }
    
    // have a valid raw key, or be an empty directive
    return (rawKey || expression === '')
        ? new Directive(dir, expression, rawKey, compiler, node)
        : utils.warn('invalid directive expression: ' + expression)
}

module.exports = Directive
},{"./directives":10,"./filters":18,"./utils":23}],8:[function(require,module,exports){
var toText = require('../utils').toText,
    slice = [].slice

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
        value = toText(value)
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
},{"../utils":23}],9:[function(require,module,exports){
var config = require('../config'),
    transition = require('../transition')

module.exports = {

    bind: function () {
        this.parent = this.el.parentNode || this.el.vue_if_parent
        this.ref = document.createComment(config.prefix + '-if-' + this.key)
        var detachedRef = this.el.vue_if_ref
        if (detachedRef) {
            this.parent.insertBefore(this.ref, detachedRef)
        }
        this.el.vue_if_ref = this.ref
    },

    update: function (value) {

        var el = this.el

        // sometimes we need to create a VM on a detached node,
        // e.g. in v-repeat. In that case, store the desired v-if
        // state on the node itself so we can deal with it elsewhere.
        el.vue_if = !!value

        var parent   = this.parent,
            ref      = this.ref,
            compiler = this.compiler

        if (!parent) {
            if (!el.parentNode) {
                return
            } else {
                parent = this.parent = el.parentNode
            }
        }

        if (!value) {
            transition(el, -1, remove, compiler)
        } else {
            transition(el, 1, insert, compiler)
        }

        function remove () {
            if (!el.parentNode) return
            // insert the reference node
            var next = el.nextSibling
            if (next) {
                parent.insertBefore(ref, next)
            } else {
                parent.appendChild(ref)
            }
            parent.removeChild(el)
        }

        function insert () {
            if (el.parentNode) return
            parent.insertBefore(el, ref)
            parent.removeChild(ref)
        }
    },

    unbind: function () {
        this.el.vue_if_ref = this.el.vue_if_parent = null
        var ref = this.ref
        if (ref.parentNode) {
            ref.parentNode.removeChild(ref)
        }
    }
}
},{"../config":5,"../transition":22}],10:[function(require,module,exports){
var utils      = require('../utils'),
    config     = require('../config'),
    transition = require('../transition')

module.exports = {

    on        : require('./on'),
    repeat    : require('./repeat'),
    model     : require('./model'),
    'if'      : require('./if'),
    'with'    : require('./with'),
    html      : require('./html'),
    style     : require('./style'),

    attr: function (value) {
        if (value || value === 0) {
            this.el.setAttribute(this.arg, value)
        } else {
            this.el.removeAttribute(this.arg)
        }
    },

    text: function (value) {
        this.el.textContent = utils.toText(value)
    },

    show: function (value) {
        var el = this.el,
            target = value ? '' : 'none',
            change = function () {
                el.style.display = target
            }
        transition(el, value ? 1 : -1, change, this.compiler)
    },

    'class': function (value) {
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
    },

    cloak: {
        isEmpty: true,
        bind: function () {
            var el = this.el
            this.compiler.observer.once('hook:ready', function () {
                el.removeAttribute(config.prefix + '-cloak')
            })
        }
    }

}
},{"../config":5,"../transition":22,"../utils":23,"./html":8,"./if":9,"./model":11,"./on":12,"./repeat":13,"./style":14,"./with":15}],11:[function(require,module,exports){
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
            el[this.attr] = utils.toText(value)
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
},{"../utils":23}],12:[function(require,module,exports){
var warn = require('../utils').warn

module.exports = {

    isFn: true,

    bind: function () {
        // blur and focus events do not bubble
        // so they can't be delegated
        this.bubbles = this.arg !== 'blur' && this.arg !== 'focus'
        if (this.bubbles) {
            this.binding.compiler.addListener(this)
        }
    },

    update: function (handler) {
        if (typeof handler !== 'function') {
            return warn('Directive "on" expects a function value.')
        }
        var targetVM = this.vm,
            ownerVM  = this.binding.compiler.vm,
            isExp    = this.binding.isExp,
            newHandler = function (e) {
                e.targetVM = targetVM
                handler.call(isExp ? targetVM : ownerVM, e)
            }
        if (!this.bubbles) {
            this.reset()
            this.el.addEventListener(this.arg, newHandler)
        }
        this.handler = newHandler
    },

    reset: function () {
        this.el.removeEventListener(this.arg, this.handler)
    },
    
    unbind: function () {
        if (this.bubbles) {
            this.binding.compiler.removeListener(this)
        } else {
            this.reset()
        }
    }
}
},{"../utils":23}],13:[function(require,module,exports){
var Observer   = require('../observer'),
    utils      = require('../utils'),
    config     = require('../config'),
    def        = utils.defProtected,
    ViewModel // lazy def to avoid circular dependency

/**
 *  Mathods that perform precise DOM manipulation
 *  based on mutator method triggered
 */
var mutationHandlers = {

    push: function (m) {
        this.addItems(m.args, this.vms.length)
    },

    pop: function () {
        var vm = this.vms.pop()
        if (vm) this.removeItems([vm])
    },

    unshift: function (m) {
        this.addItems(m.args)
    },

    shift: function () {
        var vm = this.vms.shift()
        if (vm) this.removeItems([vm])
    },

    splice: function (m) {
        var index = m.args[0],
            removed = m.args[1],
            removedVMs = removed === undefined
                ? this.vms.splice(index)
                : this.vms.splice(index, removed)
        this.removeItems(removedVMs)
        this.addItems(m.args.slice(2), index)
    },

    sort: function () {
        var vms = this.vms,
            col = this.collection,
            l = col.length,
            sorted = new Array(l),
            i, j, vm, data
        for (i = 0; i < l; i++) {
            data = col[i]
            for (j = 0; j < l; j++) {
                vm = vms[j]
                if (vm.$data === data) {
                    sorted[i] = vm
                    break
                }
            }
        }
        for (i = 0; i < l; i++) {
            this.container.insertBefore(sorted[i].$el, this.ref)
        }
        this.vms = sorted
    },

    reverse: function () {
        var vms = this.vms
        vms.reverse()
        for (var i = 0, l = vms.length; i < l; i++) {
            this.container.insertBefore(vms[i].$el, this.ref)
        }
    }
}

module.exports = {

    bind: function () {

        var el   = this.el,
            ctn  = this.container = el.parentNode

        // extract child VM information, if any
        ViewModel = ViewModel || require('../viewmodel')
        this.Ctor = this.Ctor || ViewModel
        // extract child Id, if any
        this.childId = utils.attr(el, 'ref')

        // create a comment node as a reference node for DOM insertions
        this.ref = document.createComment(config.prefix + '-repeat-' + this.key)
        ctn.insertBefore(this.ref, el)
        ctn.removeChild(el)

        this.initiated = false
        this.collection = null
        this.vms = null

        var self = this
        this.mutationListener = function (path, arr, mutation) {
            var method = mutation.method
            mutationHandlers[method].call(self, mutation)
            if (method !== 'push' && method !== 'pop') {
                // update index
                var i = arr.length
                while (i--) {
                    self.vms[i].$index = i
                }
            }
            if (method === 'push' || method === 'unshift' || method === 'splice') {
                // recalculate dependency
                self.changed()
            }
        }

    },

    update: function (collection, init) {

        if (
            collection === this.collection ||
            collection === this.object
        ) return

        if (utils.typeOf(collection) === 'Object') {
            collection = this.convertObject(collection)
        }

        this.reset()
        // if initiating with an empty collection, we need to
        // force a compile so that we get all the bindings for
        // dependency extraction.
        if (!this.initiated && (!collection || !collection.length)) {
            this.dryBuild()
        }

        // keep reference of old data and VMs
        // so we can reuse them if possible
        this.old = this.collection
        var oldVMs = this.oldVMs = this.vms

        collection = this.collection = collection || []
        this.vms = []
        if (this.childId) {
            this.vm.$[this.childId] = this.vms
        }

        // If the collection is not already converted for observation,
        // we need to convert and watch it.
        if (!Observer.convert(collection)) {
            Observer.watch(collection)
        }
        // listen for collection mutation events
        collection.__emitter__.on('mutate', this.mutationListener)

        // create new VMs and append to DOM
        if (collection.length) {
            collection.forEach(this.build, this)
            if (!init) this.changed()
        }

        // destroy unused old VMs
        if (oldVMs) destroyVMs(oldVMs)
        this.old = this.oldVMs = null
    },

    addItems: function (data, base) {
        base = base || 0
        for (var i = 0, l = data.length; i < l; i++) {
            var vm = this.build(data[i], base + i)
            this.updateObject(vm, 1)
        }
    },

    removeItems: function (data) {
        var i = data.length
        while (i--) {
            data[i].$destroy()
            this.updateObject(data[i], -1)
        }
    },

    /**
     *  Notify parent compiler that new items
     *  have been added to the collection, it needs
     *  to re-calculate computed property dependencies.
     *  Batched to ensure it's called only once every event loop.
     */
    changed: function () {
        if (this.queued) return
        this.queued = true
        var self = this
        utils.nextTick(function () {
            if (!self.compiler) return
            self.compiler.parseDeps()
            self.queued = false
        })
    },

    /**
     *  Run a dry build just to collect bindings
     */
    dryBuild: function () {
        new this.Ctor({
            el     : this.el.cloneNode(true),
            parent : this.vm,
            compilerOptions: {
                repeat: true
            }
        }).$destroy()
        this.initiated = true
    },

    /**
     *  Create a new child VM from a data object
     *  passing along compiler options indicating this
     *  is a v-repeat item.
     */
    build: function (data, index) {

        var ctn = this.container,
            vms = this.vms,
            col = this.collection,
            el, oldIndex, existing, item, nonObject

        // get our DOM insertion reference node
        var ref = vms.length > index
            ? vms[index].$el
            : this.ref
        
        // if reference VM is detached by v-if,
        // use its v-if ref node instead
        if (!ref.parentNode) {
            ref = ref.vue_if_ref
        }

        // check if data already exists in the old array
        oldIndex = this.old ? indexOf(this.old, data) : -1
        existing = oldIndex > -1

        if (existing) {

            // existing, reuse the old VM
            item = this.oldVMs[oldIndex]
            // mark, so it won't be destroyed
            item.$reused = true

        } else {

            // new data, need to create new VM.
            // there's some preparation work to do...

            // first clone the template node
            el = this.el.cloneNode(true)
            // then we provide the parentNode for v-if
            // so that it can still work in a detached state
            el.vue_if_parent = ctn
            el.vue_if_ref = ref
            // wrap non-object value in an object
            nonObject = utils.typeOf(data) !== 'Object'
            if (nonObject) {
                data = { $value: data }
            }
            // set index so vm can init with the correct
            // index instead of undefined
            data.$index = index
            // initialize the new VM
            item = new this.Ctor({
                el     : el,
                data   : data,
                parent : this.vm,
                compilerOptions: {
                    repeat: true
                }
            })
            // for non-object values, listen for value change
            // so we can sync it back to the original Array
            if (nonObject) {
                item.$compiler.observer.on('set', function (key, val) {
                    if (key === '$value') {
                        col[item.$index] = val
                    }
                })
            }

        }

        // put the item into the VM Array
        vms.splice(index, 0, item)
        // update the index
        item.$index = index

        // Finally, DOM operations...
        el = item.$el
        if (existing) {
            // we simplify need to re-insert the existing node
            // to its new position. However, it can possibly be
            // detached by v-if. in that case we insert its v-if
            // ref node instead.
            ctn.insertBefore(el.parentNode ? el : el.vue_if_ref, ref)
        } else {
            if (el.vue_if !== false) {
                if (this.compiler.init) {
                    // do not transition on initial compile,
                    // just manually insert.
                    ctn.insertBefore(el, ref)
                    item.$compiler.execHook('attached')
                } else {
                    // give it some nice transition.
                    item.$before(ref)
                }
            }
        }

        return item
    },

    /**
     *  Convert an object to a repeater Array
     *  and make sure changes in the object are synced to the repeater
     */
    convertObject: function (object) {

        if (this.object) {
            this.object.__emitter__.off('set', this.updateRepeater)
        }

        this.object = object
        var collection = object.$repeater || objectToArray(object)
        if (!object.$repeater) {
            def(object, '$repeater', collection)
        }

        var self = this
        this.updateRepeater = function (key, val) {
            if (key.indexOf('.') === -1) {
                var i = self.vms.length, item
                while (i--) {
                    item = self.vms[i]
                    if (item.$key === key) {
                        if (item.$data !== val && item.$value !== val) {
                            if ('$value' in item) {
                                item.$value = val
                            } else {
                                item.$data = val
                            }
                        }
                        break
                    }
                }
            }
        }

        object.__emitter__.on('set', this.updateRepeater)
        return collection
    },

    /**
     *  Sync changes from the $repeater Array
     *  back to the represented Object
     */
    updateObject: function (vm, action) {
        var obj = this.object
        if (obj && vm.$key) {
            var key = vm.$key,
                val = vm.$value || vm.$data
            if (action > 0) { // new property
                obj[key] = val
                Observer.convertKey(obj, key)
            } else {
                delete obj[key]
            }
            obj.__emitter__.emit('set', key, val, true)
        }
    },

    reset: function (destroy) {
        if (this.childId) {
            delete this.vm.$[this.childId]
        }
        if (this.collection) {
            this.collection.__emitter__.off('mutate', this.mutationListener)
            if (destroy) {
                destroyVMs(this.vms)
            }
        }
    },

    unbind: function () {
        this.reset(true)
    }
}

// Helpers --------------------------------------------------------------------

/**
 *  Convert an Object to a v-repeat friendly Array
 */
function objectToArray (obj) {
    var res = [], val, data
    for (var key in obj) {
        val = obj[key]
        data = utils.typeOf(val) === 'Object'
            ? val
            : { $value: val }
        def(data, '$key', key)
        res.push(data)
    }
    return res
}

/**
 *  Find an object or a wrapped data object
 *  from an Array
 */
function indexOf (arr, obj) {
    for (var i = 0, l = arr.length; i < l; i++) {
        if (arr[i] === obj || (obj.$value && arr[i].$value === obj.$value)) {
            return i
        }
    }
    return -1
}

/**
 *  Destroy some VMs, yeah.
 */
function destroyVMs (vms) {
    var i = vms.length, vm
    while (i--) {
        vm = vms[i]
        if (vm.$reused) {
            vm.$reused = false
        } else {
            vm.$destroy()
        }
    }
}
},{"../config":5,"../observer":20,"../utils":23,"../viewmodel":24}],14:[function(require,module,exports){
var camelRE = /-([a-z])/g,
    prefixes = ['webkit', 'moz', 'ms']

function camelReplacer (m) {
    return m[1].toUpperCase()
}

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
},{}],15:[function(require,module,exports){
var ViewModel,
    nextTick = require('../utils').nextTick

module.exports = {

    bind: function () {
        if (this.el.vue_vm) {
            this.subVM = this.el.vue_vm
            var compiler = this.subVM.$compiler
            if (!compiler.bindings[this.arg]) {
                compiler.createBinding(this.arg)
            }
        } else if (this.isEmpty) {
            this.build()
        }
    },

    update: function (value, init) {
        var vm = this.subVM,
            key = this.arg || '$data'
        if (!vm) {
            this.build(value)
        } else if (!this.lock && vm[key] !== value) {
            vm[key] = value
        }
        if (init) {
            // watch after first set
            this.watch()
            // The v-with directive can have multiple expressions,
            // and we want to make sure when the ready hook is called
            // on the subVM, all these clauses have been properly set up.
            // So this is a hack that sniffs whether we have reached
            // the last expression. We hold off the subVM's ready hook
            // until we are actually ready.
            if (this.last) {
                this.subVM.$compiler.execHook('ready')
            }
        }
    },

    build: function (value) {
        ViewModel = ViewModel || require('../viewmodel')
        var Ctor = this.Ctor || ViewModel,
            data = value
        if (this.arg) {
            data = {}
            data[this.arg] = value
        }
        this.subVM = new Ctor({
            el     : this.el,
            data   : data,
            parent : this.vm,
            compilerOptions: {
                // it is important to delay the ready hook
                // so that when it's called, all `v-with` wathcers
                // would have been set up.
                delayReady: !this.last
            }
        })
    },

    /**
     *  For inhertied keys, need to watch
     *  and sync back to the parent
     */
    watch: function () {
        if (!this.arg) return
        var self    = this,
            key     = self.key,
            ownerVM = self.binding.compiler.vm
        this.subVM.$compiler.observer.on('change:' + this.arg, function (val) {
            if (!self.lock) {
                self.lock = true
                nextTick(function () {
                    self.lock = false
                })
            }
            ownerVM.$set(key, val)
        })
    },

    unbind: function () {
        // all watchers are turned off during destroy
        // so no need to worry about it
        this.subVM.$destroy()
    }

}
},{"../utils":23,"../viewmodel":24}],16:[function(require,module,exports){
function Emitter () {
    this._ctx = this
}

var EmitterProto = Emitter.prototype,
    slice = [].slice

EmitterProto.on = function(event, fn){
    this._cbs = this._cbs || {}
    ;(this._cbs[event] = this._cbs[event] || [])
        .push(fn)
    return this
}

Emitter.prototype.once = function(event, fn){
    var self = this
    this._cbs = this._cbs || {}

    function on() {
        self.off(event, on)
        fn.apply(this, arguments)
    }

    on.fn = fn
    this.on(event, on)
    return this
}

Emitter.prototype.off = function(event, fn){
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

Emitter.prototype.emit = function(event){
    this._cbs = this._cbs || {}
    var args = slice.call(arguments, 1),
        callbacks = this._cbs[event]

    if (callbacks) {
        callbacks = callbacks.slice(0)
        for (var i = 0, len = callbacks.length; i < len; i++) {
            callbacks[i].apply(this._ctx, args)
        }
    }

    return this
}

module.exports = Emitter
},{}],17:[function(require,module,exports){
var utils           = require('./utils'),
    stringSaveRE    = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
    stringRestoreRE = /"(\d+)"/g,
    constructorRE   = new RegExp('constructor'.split('').join('[\'"+, ]*')),
    unicodeRE       = /\\u\d\d\d\d/

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
function getRel (path, compiler) {
    var rel  = '',
        dist = 0,
        self = compiler
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
    /* jshint evil: true */
    var fn
    try {
        fn = new Function(exp)
    } catch (e) {
        utils.warn('Invalid expression: ' + raw)
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

module.exports = {

    /**
     *  Parse and return an anonymous computed property getter function
     *  from an arbitrary expression, together with a list of paths to be
     *  created as bindings.
     */
    parse: function (exp, compiler) {
        // unicode and 'constructor' are not allowed for XSS security.
        if (unicodeRE.test(exp) || constructorRE.test(exp)) {
            utils.warn('Unsafe expression: ' + exp)
            return function () {}
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
            body = ('return ' + exp)
                .replace(stringSaveRE, saveStrings)
                .replace(pathRE, replacePath)
                .replace(stringRestoreRE, restoreStrings)
        body = accessors + body

        function saveStrings (str) {
            var i = strings.length
            strings[i] = str
            return '"' + i + '"'
        }

        function replacePath (path) {
            // keep track of the first char
            var c = path.charAt(0)
            path = path.slice(1)
            var val = 'this.' + getRel(path, compiler) + path
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
}
},{"./utils":23}],18:[function(require,module,exports){
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

module.exports = {

    /**
     *  'abc' => 'Abc'
     */
    capitalize: function (value) {
        if (!value && value !== 0) return ''
        value = value.toString()
        return value.charAt(0).toUpperCase() + value.slice(1)
    },

    /**
     *  'abc' => 'ABC'
     */
    uppercase: function (value) {
        return (value || value === 0)
            ? value.toString().toUpperCase()
            : ''
    },

    /**
     *  'AbC' => 'abc'
     */
    lowercase: function (value) {
        return (value || value === 0)
            ? value.toString().toLowerCase()
            : ''
    },

    /**
     *  12345 => $12,345.00
     */
    currency: function (value, args) {
        if (!value && value !== 0) return ''
        var sign = (args && args[0]) || '$',
            s = Math.floor(value).toString(),
            i = s.length % 3,
            h = i > 0 ? (s.slice(0, i) + (s.length > 3 ? ',' : '')) : '',
            f = '.' + value.toFixed(2).slice(-2)
        return sign + h + s.slice(i).replace(/(\d{3})(?=\d)/g, '$1,') + f
    },

    /**
     *  args: an array of strings corresponding to
     *  the single, double, triple ... forms of the word to
     *  be pluralized. When the number to be pluralized
     *  exceeds the length of the args, it will use the last
     *  entry in the array.
     *
     *  e.g. ['single', 'double', 'triple', 'multiple']
     */
    pluralize: function (value, args) {
        return args.length > 1
            ? (args[value - 1] || args[args.length - 1])
            : (args[value - 1] || args[0] + 's')
    },

    /**
     *  A special filter that takes a handler function,
     *  wraps it so it only gets triggered on specific keypresses.
     */
    key: function (handler, args) {
        if (!handler) return
        var code = keyCodes[args[0]]
        if (!code) {
            code = parseInt(args[0], 10)
        }
        return function (e) {
            if (e.keyCode === code) {
                handler.call(this, e)
            }
        }
    }
}
},{}],19:[function(require,module,exports){
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
            return utils.warn('Cannot find plugin: ' + plugin)
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

    // copy prototype props
    var methods = options.methods
    if (methods) {
        for (var key in methods) {
            if (
                !(key in ViewModel.prototype) &&
                typeof methods[key] === 'function'
            ) {
                proto[key] = methods[key]
            }
        }
    }

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
        if (key === 'el' || key === 'methods') continue
        var val = child[key],
            parentVal = parent[key],
            type = utils.typeOf(val),
            parentType = utils.typeOf(parentVal)
        if (topLevel && type === 'Function' && parentVal) {
            // merge hook functions into an array
            child[key] = [val]
            if (Array.isArray(parentVal)) {
                child[key] = child[key].concat(parentVal)
            } else {
                child[key].push(parentVal)
            }
        } else if (topLevel && (type === 'Object' || parentType === 'Object')) {
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
},{"./config":5,"./directives":10,"./filters":18,"./observer":20,"./transition":22,"./utils":23,"./viewmodel":24}],20:[function(require,module,exports){
/* jshint proto:true */

var Emitter  = require('./emitter'),
    utils    = require('./utils'),
    // cache methods
    typeOf   = utils.typeOf,
    def      = utils.defProtected,
    slice    = [].slice,
    // types
    OBJECT   = 'Object',
    ARRAY    = 'Array',
    // fix for IE + __proto__ problem
    // define methods as inenumerable if __proto__ is present,
    // otherwise enumerable so we can loop through and manually
    // attach to array instances
    hasProto = ({}).__proto__,
    // lazy load
    ViewModel

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
def(ArrayProxy, 'remove', removeElement, !hasProto)
def(ArrayProxy, 'set', replaceElement, !hasProto)
def(ArrayProxy, 'replace', replaceElement, !hasProto)

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
        this.__emitter__.emit('mutate', null, this, {
            method: method,
            args: args,
            result: result
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
                convert(item)
                watch(item)
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

/**
 *  Convenience method to remove an element in an Array
 *  This will be attached to observed Array instances
 */
function removeElement (index) {
    if (typeof index === 'function') {
        var i = this.length,
            removed = []
        while (i--) {
            if (index(this[i])) {
                removed.push(this.splice(i, 1)[0])
            }
        }
        return removed.reverse()
    } else {
        if (typeof index !== 'number') {
            index = this.indexOf(index)
        }
        if (index > -1) {
            return this.splice(index, 1)[0]
        }
    }
}

/**
 *  Convenience method to replace an element in an Array
 *  This will be attached to observed Array instances
 */
function replaceElement (index, data) {
    if (typeof index === 'function') {
        var i = this.length,
            replaced = [],
            replacer
        while (i--) {
            replacer = index(this[i])
            if (replacer !== undefined) {
                replaced.push(this.splice(i, 1, replacer)[0])
            }
        }
        return replaced.reverse()
    } else {
        if (typeof index !== 'number') {
            index = this.indexOf(index)
        }
        if (index > -1) {
            return this.splice(index, 1, data)[0]
        }
    }
}

// Watch Helpers --------------------------------------------------------------

/**
 *  Check if a value is watchable
 */
function isWatchable (obj) {
    ViewModel = ViewModel || require('./viewmodel')
    var type = typeOf(obj)
    return (type === OBJECT || type === ARRAY) && !(obj instanceof ViewModel)
}

/**
 *  Convert an Object/Array to give it a change emitter.
 */
function convert (obj) {
    if (obj.__emitter__) return true
    var emitter = new Emitter()
    def(obj, '__emitter__', emitter)
    emitter.on('set', function () {
        var owners = obj.__emitter__.owners,
            i = owners.length
        while (i--) {
            owners[i].__emitter__.emit('set', '', '', true)
        }
    })
    emitter.values = utils.hash()
    emitter.owners = []
    return false
}

/**
 *  Watch target based on its type
 */
function watch (obj) {
    var type = typeOf(obj)
    if (type === OBJECT) {
        watchObject(obj)
    } else if (type === ARRAY) {
        watchArray(obj)
    }
}

/**
 *  Watch an Object, recursive.
 */
function watchObject (obj) {
    for (var key in obj) {
        convertKey(obj, key)
    }
}

/**
 *  Watch an Array, overload mutation methods
 *  and add augmentations by intercepting the prototype chain
 */
function watchArray (arr) {
    if (hasProto) {
        arr.__proto__ = ArrayProxy
    } else {
        for (var key in ArrayProxy) {
            def(arr, key, ArrayProxy[key])
        }
    }
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

    Object.defineProperty(obj, key, {
        get: function () {
            var value = values[key]
            // only emit get on tip values
            if (pub.shouldGet && typeOf(value) !== OBJECT) {
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
        if (Array.isArray(val)) {
            emitter.emit('set', key + '.length', val.length)
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
    var type = typeOf(obj),
        emitter = obj && obj.__emitter__
    if (type === ARRAY) {
        emitter.emit('set', 'length', obj.length)
    } else if (type === OBJECT) {
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
    if (typeOf(oldObj) !== OBJECT || typeOf(newObj) !== OBJECT) {
        return
    }
    var path, type, oldVal, newVal
    for (path in oldObj) {
        if (!(path in newObj)) {
            oldVal = oldObj[path]
            type = typeOf(oldVal)
            if (type === OBJECT) {
                newVal = newObj[path] = {}
                copyPaths(newVal, oldVal)
            } else if (type === ARRAY) {
                newObj[path] = []
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
    if (typeOf(obj) === OBJECT) {
        sec = path[i]
        if (!(sec in obj)) {
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
},{"./emitter":16,"./utils":23,"./viewmodel":24}],21:[function(require,module,exports){
var BINDING_RE = /{{{?([^{}]+?)}?}}/,
    TRIPLE_RE = /{{{[^{}]+}}}/

/**
 *  Parse a piece of text, return an array of tokens
 */
function parse (text) {
    if (!BINDING_RE.test(text)) return null
    var m, i, token, tokens = []
    /* jshint boss: true */
    while (m = text.match(BINDING_RE)) {
        i = m.index
        if (i > 0) tokens.push(text.slice(0, i))
        token = { key: m[1].trim() }
        if (TRIPLE_RE.test(m[0])) token.html = true
        tokens.push(token)
        text = text.slice(i + m[0].length)
    }
    if (text.length) tokens.push(text)
    return tokens
}

/**
 *  Parse an attribute value with possible interpolation tags
 *  return a Directive-friendly expression
 */
function parseAttr (attr) {
    var tokens = parse(attr)
    if (!tokens) return null
    var res = [], token
    for (var i = 0, l = tokens.length; i < l; i++) {
        token = tokens[i]
        res.push(token.key || ('"' + token + '"'))
    }
    return res.join('+')
}

exports.parse = parse
exports.parseAttr = parseAttr
},{}],22:[function(require,module,exports){
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
},{"./batcher":2,"./config":5}],23:[function(require,module,exports){
var config    = require('./config'),
    attrs     = config.attrs,
    toString  = ({}).toString,
    win       = window,
    console   = win.console,
    timeout   = win.setTimeout,
    hasClassList = 'classList' in document.documentElement,
    ViewModel // late def

var utils = module.exports = {

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
        var attr = attrs[type],
            val = el.getAttribute(attr)
        if (val !== null) el.removeAttribute(attr)
        return val
    },

    /**
     *  Define an ienumerable property
     *  This avoids it being included in JSON.stringify
     *  or for...in loops.
     */
    defProtected: function (obj, key, val, enumerable) {
        if (obj.hasOwnProperty(key)) return
        Object.defineProperty(obj, key, {
            value        : val,
            enumerable   : !!enumerable,
            configurable : true
        })
    },

    /**
     *  Accurate type check
     *  internal use only, so no need to check for NaN
     */
    typeOf: function (obj) {
        return toString.call(obj).slice(8, -1)
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
     *  Make sure only strings, booleans, numbers and
     *  objects are output to html. otherwise, ouput empty string.
     */
    toText: function (value) {
        /* jshint eqeqeq: false */
        var type = typeof value
        return (type === 'string' ||
            type === 'boolean' ||
            (type === 'number' && value == value)) // deal with NaN
                ? value
                : type === 'object' && value !== null
                    ? JSON.stringify(value)
                    : ''
    },

    /**
     *  simple extend
     */
    extend: function (obj, ext, protective) {
        for (var key in ext) {
            if (protective && obj[key]) continue
            obj[key] = ext[key]
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
        return utils.typeOf(obj) === 'Object'
            ? ViewModel.extend(obj)
            : typeof obj === 'function'
                ? obj
                : null
    },

    /**
     *  convert certain option values to the desired format.
     */
    processOptions: function (options) {
        var components = options.components,
            partials   = options.partials,
            template   = options.template,
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
        if (template) {
            options.template = utils.toFragment(template)
        }
    },

    /**
     *  log for debugging
     */
    log: function (msg) {
        if (config.debug && console) {
            console.log(msg)
        }
    },
    
    /**
     *  warnings, traces by default
     *  can be suppressed by `silent` option.
     */
    warn: function (msg) {
        if (!config.silent && console) {
            console.warn(msg)
            if (config.debug && console.trace) {
                console.trace(msg)
            }
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
    }
}
},{"./config":5,"./viewmodel":24}],24:[function(require,module,exports){
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
 *  Convenience function to set an actual nested value
 *  from a flat key string. Used in directives.
 */
def(VMProto, '$set', function (key, value) {
    var path = key.split('.'),
        obj = this
    for (var d = 0, l = path.length - 1; d < l; d++) {
        obj = obj[path[d]]
    }
    obj[path[d]] = value
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
    var el = this.$el,
        parent = el.parentNode
    if (!parent) return
    transition(el, -1, function () {
        parent.removeChild(el)
        if (cb) nextTick(cb)
    }, this.$compiler)
})

def(VMProto, '$before', function (target, cb) {
    target = query(target)
    var el = this.$el,
        parent = target.parentNode
    if (!parent) return
    transition(el, 1, function () {
        parent.insertBefore(el, target)
        if (cb) nextTick(cb)
    }, this.$compiler)
})

def(VMProto, '$after', function (target, cb) {
    target = query(target)
    var el = this.$el,
        parent = target.parentNode,
        next = target.nextSibling
    if (!parent) return
    transition(el, 1, function () {
        if (next) {
            parent.insertBefore(el, next)
        } else {
            parent.appendChild(el)
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
},{"./batcher":2,"./compiler":4,"./transition":22,"./utils":23}],25:[function(require,module,exports){
(function () {
var root = this, exports = {};

// The jade runtime:
var jade = exports.jade=function(exports){Array.isArray||(Array.isArray=function(arr){return"[object Array]"==Object.prototype.toString.call(arr)}),Object.keys||(Object.keys=function(obj){var arr=[];for(var key in obj)obj.hasOwnProperty(key)&&arr.push(key);return arr}),exports.merge=function merge(a,b){var ac=a["class"],bc=b["class"];if(ac||bc)ac=ac||[],bc=bc||[],Array.isArray(ac)||(ac=[ac]),Array.isArray(bc)||(bc=[bc]),ac=ac.filter(nulls),bc=bc.filter(nulls),a["class"]=ac.concat(bc).join(" ");for(var key in b)key!="class"&&(a[key]=b[key]);return a};function nulls(val){return val!=null}return exports.attrs=function attrs(obj,escaped){var buf=[],terse=obj.terse;delete obj.terse;var keys=Object.keys(obj),len=keys.length;if(len){buf.push("");for(var i=0;i<len;++i){var key=keys[i],val=obj[key];"boolean"==typeof val||null==val?val&&(terse?buf.push(key):buf.push(key+'="'+key+'"')):0==key.indexOf("data")&&"string"!=typeof val?buf.push(key+"='"+JSON.stringify(val)+"'"):"class"==key&&Array.isArray(val)?buf.push(key+'="'+exports.escape(val.join(" "))+'"'):escaped&&escaped[key]?buf.push(key+'="'+exports.escape(val)+'"'):buf.push(key+'="'+val+'"')}}return buf.join(" ")},exports.escape=function escape(html){return String(html).replace(/&(?!(\w+|\#\d+);)/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")},exports.rethrow=function rethrow(err,filename,lineno){if(!filename)throw err;var context=3,str=require("fs").readFileSync(filename,"utf8"),lines=str.split("\n"),start=Math.max(lineno-context,0),end=Math.min(lines.length,lineno+context),context=lines.slice(start,end).map(function(line,i){var curr=i+start+1;return(curr==lineno?"  > ":"    ")+curr+"| "+line}).join("\n");throw err.path=filename,err.message=(filename||"Jade")+":"+lineno+"\n"+context+"\n\n"+err.message,err},exports}({});


// create our folder objects

// demo.jade compiled template
exports["demo"] = function tmpl_demo() {
    return '<h1>Nancle DEMO</h1><p>{{message}}</p><input v-model="message"/>';
};

// list.jade compiled template
exports["list"] = function tmpl_list() {
    return '<ul><li v-repeat="people">{{$index}} - {{firstName}}, {{lastName}}</li></ul>';
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
},{"fs":1}],26:[function(require,module,exports){
var acro, demo, ken, menu, model, vm;

vm = require('./viewmodel');

model = require('./model');

demo = new vm.Demo({
  el: '#container',
  data: {
    message: 'Hello nancle!'
  }
});

menu = new vm.Menu({
  el: '#list',
  data: {
    people: []
  }
});

ken = new model.Person({
  firstName: 'Kenichiro',
  lastName: 'Murata'
});

menu.$data.people.push(ken);

console.log(JSON.stringify(menu.$data));

acro = new model.Person({
  firstName: 'Acroquest',
  lastName: 'Technology'
});

menu.$data.people.push(acro);

console.log(JSON.stringify(menu.$data));

ken.firstName = 'Ken';

console.log(JSON.stringify(menu.$data));


},{"./model":27,"./viewmodel":28}],27:[function(require,module,exports){
var Person;

module.exports = {
  Person: Person = (function() {
    function Person(options) {
      this.firstName = options.firstName, this.lastName = options.lastName;
    }

    return Person;

  })()
};


},{}],28:[function(require,module,exports){
var Vue, templates;

Vue = require('vue');

templates = require('./_templates.js');

module.exports = {
  Demo: Vue.extend({
    template: templates.demo()
  }),
  Menu: Vue.extend({
    template: templates.list()
  })
};


},{"./_templates.js":25,"vue":19}]},{},[26])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlcyI6WyIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9saWIvX2VtcHR5LmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9iYXRjaGVyLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9iaW5kaW5nLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9jb21waWxlci5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Z1ZS9zcmMvY29uZmlnLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9kZXBzLXBhcnNlci5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Z1ZS9zcmMvZGlyZWN0aXZlLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9kaXJlY3RpdmVzL2h0bWwuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvaWYuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvaW5kZXguanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvbW9kZWwuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvb24uanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2RpcmVjdGl2ZXMvcmVwZWF0LmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9kaXJlY3RpdmVzL3N0eWxlLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy9kaXJlY3RpdmVzL3dpdGguanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2VtaXR0ZXIuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2V4cC1wYXJzZXIuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL2ZpbHRlcnMuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL21haW4uanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL29ic2VydmVyLmpzIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9ub2RlX21vZHVsZXMvdnVlL3NyYy90ZXh0LXBhcnNlci5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Z1ZS9zcmMvdHJhbnNpdGlvbi5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvbm9kZV9tb2R1bGVzL3Z1ZS9zcmMvdXRpbHMuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL25vZGVfbW9kdWxlcy92dWUvc3JjL3ZpZXdtb2RlbC5qcyIsIi9Vc2Vycy9rZW4vd29yay9uYW5jbGUvc3JjL2pzL190ZW1wbGF0ZXMuanMiLCIvVXNlcnMva2VuL3dvcmsvbmFuY2xlL3NyYy9qcy9hcHAuY29mZmVlIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9zcmMvanMvbW9kZWwuY29mZmVlIiwiL1VzZXJzL2tlbi93b3JrL25hbmNsZS9zcmMvanMvdmlld21vZGVsLmNvZmZlZSJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDejRCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbk1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0S0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pPQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaE9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3QkEsSUFBQSxnQ0FBQTs7QUFBQSxFQUFBLEdBQUssT0FBQSxDQUFRLGFBQVIsQ0FBTCxDQUFBOztBQUFBLEtBQ0EsR0FBUSxPQUFBLENBQVEsU0FBUixDQURSLENBQUE7O0FBQUEsSUFHQSxHQUFXLElBQUEsRUFBRSxDQUFDLElBQUgsQ0FDVDtBQUFBLEVBQUEsRUFBQSxFQUFJLFlBQUo7QUFBQSxFQUNBLElBQUEsRUFDRTtBQUFBLElBQUEsT0FBQSxFQUFTLGVBQVQ7R0FGRjtDQURTLENBSFgsQ0FBQTs7QUFBQSxJQVFBLEdBQVcsSUFBQSxFQUFFLENBQUMsSUFBSCxDQUNUO0FBQUEsRUFBQSxFQUFBLEVBQUksT0FBSjtBQUFBLEVBQ0EsSUFBQSxFQUNFO0FBQUEsSUFBQSxNQUFBLEVBQVEsRUFBUjtHQUZGO0NBRFMsQ0FSWCxDQUFBOztBQUFBLEdBYUEsR0FBVSxJQUFBLEtBQUssQ0FBQyxNQUFOLENBQ1I7QUFBQSxFQUFBLFNBQUEsRUFBVyxXQUFYO0FBQUEsRUFDQSxRQUFBLEVBQVUsUUFEVjtDQURRLENBYlYsQ0FBQTs7QUFBQSxJQWlCSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBbEIsQ0FBdUIsR0FBdkIsQ0FqQkEsQ0FBQTs7QUFBQSxPQW1CTyxDQUFDLEdBQVIsQ0FBWSxJQUFJLENBQUMsU0FBTCxDQUFlLElBQUksQ0FBQyxLQUFwQixDQUFaLENBbkJBLENBQUE7O0FBQUEsSUFxQkEsR0FBVyxJQUFBLEtBQUssQ0FBQyxNQUFOLENBQ1Q7QUFBQSxFQUFBLFNBQUEsRUFBVyxXQUFYO0FBQUEsRUFDQSxRQUFBLEVBQVUsWUFEVjtDQURTLENBckJYLENBQUE7O0FBQUEsSUF5QkksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQWxCLENBQXVCLElBQXZCLENBekJBLENBQUE7O0FBQUEsT0EyQk8sQ0FBQyxHQUFSLENBQVksSUFBSSxDQUFDLFNBQUwsQ0FBZSxJQUFJLENBQUMsS0FBcEIsQ0FBWixDQTNCQSxDQUFBOztBQUFBLEdBNkJHLENBQUMsU0FBSixHQUFnQixLQTdCaEIsQ0FBQTs7QUFBQSxPQStCTyxDQUFDLEdBQVIsQ0FBWSxJQUFJLENBQUMsU0FBTCxDQUFlLElBQUksQ0FBQyxLQUFwQixDQUFaLENBL0JBLENBQUE7Ozs7QUNBQSxJQUFBLE1BQUE7O0FBQUEsTUFBTSxDQUFDLE9BQVAsR0FDRTtBQUFBLEVBQUEsTUFBQSxFQUFjO0FBQ0MsSUFBQSxnQkFBQyxPQUFELEdBQUE7QUFDWCxNQUFDLElBQUMsQ0FBQSxvQkFBQSxTQUFGLEVBQWEsSUFBQyxDQUFBLG1CQUFBLFFBQWQsQ0FEVztJQUFBLENBQWI7O2tCQUFBOztNQURGO0NBREYsQ0FBQTs7OztBQ0FBLElBQUEsY0FBQTs7QUFBQSxHQUFBLEdBQU0sT0FBQSxDQUFRLEtBQVIsQ0FBTixDQUFBOztBQUFBLFNBQ0EsR0FBWSxPQUFBLENBQVEsaUJBQVIsQ0FEWixDQUFBOztBQUFBLE1BR00sQ0FBQyxPQUFQLEdBQ0U7QUFBQSxFQUFBLElBQUEsRUFBTSxHQUFHLENBQUMsTUFBSixDQUNKO0FBQUEsSUFBQSxRQUFBLEVBQVUsU0FBUyxDQUFDLElBQVYsQ0FBQSxDQUFWO0dBREksQ0FBTjtBQUFBLEVBR0EsSUFBQSxFQUFNLEdBQUcsQ0FBQyxNQUFKLENBQ0o7QUFBQSxJQUFBLFFBQUEsRUFBVSxTQUFTLENBQUMsSUFBVixDQUFBLENBQVY7R0FESSxDQUhOO0NBSkYsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKX12YXIgZj1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwoZi5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxmLGYuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIixudWxsLCJ2YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJylcblxuZnVuY3Rpb24gQmF0Y2hlciAoKSB7XG4gICAgdGhpcy5yZXNldCgpXG59XG5cbnZhciBCYXRjaGVyUHJvdG8gPSBCYXRjaGVyLnByb3RvdHlwZVxuXG5CYXRjaGVyUHJvdG8ucHVzaCA9IGZ1bmN0aW9uIChqb2IpIHtcbiAgICBpZiAoIWpvYi5pZCB8fCAhdGhpcy5oYXNbam9iLmlkXSkge1xuICAgICAgICB0aGlzLnF1ZXVlLnB1c2goam9iKVxuICAgICAgICB0aGlzLmhhc1tqb2IuaWRdID0gam9iXG4gICAgICAgIGlmICghdGhpcy53YWl0aW5nKSB7XG4gICAgICAgICAgICB0aGlzLndhaXRpbmcgPSB0cnVlXG4gICAgICAgICAgICB1dGlscy5uZXh0VGljayh1dGlscy5iaW5kKHRoaXMuZmx1c2gsIHRoaXMpKVxuICAgICAgICB9XG4gICAgfSBlbHNlIGlmIChqb2Iub3ZlcnJpZGUpIHtcbiAgICAgICAgdmFyIG9sZEpvYiA9IHRoaXMuaGFzW2pvYi5pZF1cbiAgICAgICAgb2xkSm9iLmNhbmNlbGxlZCA9IHRydWVcbiAgICAgICAgdGhpcy5xdWV1ZS5wdXNoKGpvYilcbiAgICAgICAgdGhpcy5oYXNbam9iLmlkXSA9IGpvYlxuICAgIH1cbn1cblxuQmF0Y2hlclByb3RvLmZsdXNoID0gZnVuY3Rpb24gKCkge1xuICAgIC8vIGJlZm9yZSBmbHVzaCBob29rXG4gICAgaWYgKHRoaXMuX3ByZUZsdXNoKSB0aGlzLl9wcmVGbHVzaCgpXG4gICAgLy8gZG8gbm90IGNhY2hlIGxlbmd0aCBiZWNhdXNlIG1vcmUgam9icyBtaWdodCBiZSBwdXNoZWRcbiAgICAvLyBhcyB3ZSBleGVjdXRlIGV4aXN0aW5nIGpvYnNcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMucXVldWUubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIGpvYiA9IHRoaXMucXVldWVbaV1cbiAgICAgICAgaWYgKGpvYi5jYW5jZWxsZWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2IuZXhlY3V0ZSgpICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgdGhpcy5oYXNbam9iLmlkXSA9IGZhbHNlXG4gICAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5yZXNldCgpXG59XG5cbkJhdGNoZXJQcm90by5yZXNldCA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLmhhcyA9IHV0aWxzLmhhc2goKVxuICAgIHRoaXMucXVldWUgPSBbXVxuICAgIHRoaXMud2FpdGluZyA9IGZhbHNlXG59XG5cbm1vZHVsZS5leHBvcnRzID0gQmF0Y2hlciIsInZhciBCYXRjaGVyICAgICAgICA9IHJlcXVpcmUoJy4vYmF0Y2hlcicpLFxuICAgIGJpbmRpbmdCYXRjaGVyID0gbmV3IEJhdGNoZXIoKSxcbiAgICBiaW5kaW5nSWQgICAgICA9IDFcblxuLyoqXG4gKiAgQmluZGluZyBjbGFzcy5cbiAqXG4gKiAgZWFjaCBwcm9wZXJ0eSBvbiB0aGUgdmlld21vZGVsIGhhcyBvbmUgY29ycmVzcG9uZGluZyBCaW5kaW5nIG9iamVjdFxuICogIHdoaWNoIGhhcyBtdWx0aXBsZSBkaXJlY3RpdmUgaW5zdGFuY2VzIG9uIHRoZSBET01cbiAqICBhbmQgbXVsdGlwbGUgY29tcHV0ZWQgcHJvcGVydHkgZGVwZW5kZW50c1xuICovXG5mdW5jdGlvbiBCaW5kaW5nIChjb21waWxlciwga2V5LCBpc0V4cCwgaXNGbikge1xuICAgIHRoaXMuaWQgPSBiaW5kaW5nSWQrK1xuICAgIHRoaXMudmFsdWUgPSB1bmRlZmluZWRcbiAgICB0aGlzLmlzRXhwID0gISFpc0V4cFxuICAgIHRoaXMuaXNGbiA9IGlzRm5cbiAgICB0aGlzLnJvb3QgPSAhdGhpcy5pc0V4cCAmJiBrZXkuaW5kZXhPZignLicpID09PSAtMVxuICAgIHRoaXMuY29tcGlsZXIgPSBjb21waWxlclxuICAgIHRoaXMua2V5ID0ga2V5XG4gICAgdGhpcy5kaXJzID0gW11cbiAgICB0aGlzLnN1YnMgPSBbXVxuICAgIHRoaXMuZGVwcyA9IFtdXG4gICAgdGhpcy51bmJvdW5kID0gZmFsc2Vcbn1cblxudmFyIEJpbmRpbmdQcm90byA9IEJpbmRpbmcucHJvdG90eXBlXG5cbi8qKlxuICogIFVwZGF0ZSB2YWx1ZSBhbmQgcXVldWUgaW5zdGFuY2UgdXBkYXRlcy5cbiAqL1xuQmluZGluZ1Byb3RvLnVwZGF0ZSA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgIGlmICghdGhpcy5pc0NvbXB1dGVkIHx8IHRoaXMuaXNGbikge1xuICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWVcbiAgICB9XG4gICAgaWYgKHRoaXMuZGlycy5sZW5ndGggfHwgdGhpcy5zdWJzLmxlbmd0aCkge1xuICAgICAgICB2YXIgc2VsZiA9IHRoaXNcbiAgICAgICAgYmluZGluZ0JhdGNoZXIucHVzaCh7XG4gICAgICAgICAgICBpZDogdGhpcy5pZCxcbiAgICAgICAgICAgIGV4ZWN1dGU6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXNlbGYudW5ib3VuZCkge1xuICAgICAgICAgICAgICAgICAgICBzZWxmLl91cGRhdGUoKVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9XG59XG5cbi8qKlxuICogIEFjdHVhbGx5IHVwZGF0ZSB0aGUgZGlyZWN0aXZlcy5cbiAqL1xuQmluZGluZ1Byb3RvLl91cGRhdGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGkgPSB0aGlzLmRpcnMubGVuZ3RoLFxuICAgICAgICB2YWx1ZSA9IHRoaXMudmFsKClcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIHRoaXMuZGlyc1tpXS51cGRhdGUodmFsdWUpXG4gICAgfVxuICAgIHRoaXMucHViKClcbn1cblxuLyoqXG4gKiAgUmV0dXJuIHRoZSB2YWx1YXRlZCB2YWx1ZSByZWdhcmRsZXNzXG4gKiAgb2Ygd2hldGhlciBpdCBpcyBjb21wdXRlZCBvciBub3RcbiAqL1xuQmluZGluZ1Byb3RvLnZhbCA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gdGhpcy5pc0NvbXB1dGVkICYmICF0aGlzLmlzRm5cbiAgICAgICAgPyB0aGlzLnZhbHVlLiRnZXQoKVxuICAgICAgICA6IHRoaXMudmFsdWVcbn1cblxuLyoqXG4gKiAgTm90aWZ5IGNvbXB1dGVkIHByb3BlcnRpZXMgdGhhdCBkZXBlbmQgb24gdGhpcyBiaW5kaW5nXG4gKiAgdG8gdXBkYXRlIHRoZW1zZWx2ZXNcbiAqL1xuQmluZGluZ1Byb3RvLnB1YiA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgaSA9IHRoaXMuc3Vicy5sZW5ndGhcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIHRoaXMuc3Vic1tpXS51cGRhdGUoKVxuICAgIH1cbn1cblxuLyoqXG4gKiAgVW5iaW5kIHRoZSBiaW5kaW5nLCByZW1vdmUgaXRzZWxmIGZyb20gYWxsIG9mIGl0cyBkZXBlbmRlbmNpZXNcbiAqL1xuQmluZGluZ1Byb3RvLnVuYmluZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAvLyBJbmRpY2F0ZSB0aGlzIGhhcyBiZWVuIHVuYm91bmQuXG4gICAgLy8gSXQncyBwb3NzaWJsZSB0aGlzIGJpbmRpbmcgd2lsbCBiZSBpblxuICAgIC8vIHRoZSBiYXRjaGVyJ3MgZmx1c2ggcXVldWUgd2hlbiBpdHMgb3duZXJcbiAgICAvLyBjb21waWxlciBoYXMgYWxyZWFkeSBiZWVuIGRlc3Ryb3llZC5cbiAgICB0aGlzLnVuYm91bmQgPSB0cnVlXG4gICAgdmFyIGkgPSB0aGlzLmRpcnMubGVuZ3RoXG4gICAgd2hpbGUgKGktLSkge1xuICAgICAgICB0aGlzLmRpcnNbaV0udW5iaW5kKClcbiAgICB9XG4gICAgaSA9IHRoaXMuZGVwcy5sZW5ndGhcbiAgICB2YXIgc3Vic1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgc3VicyA9IHRoaXMuZGVwc1tpXS5zdWJzXG4gICAgICAgIHN1YnMuc3BsaWNlKHN1YnMuaW5kZXhPZih0aGlzKSwgMSlcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gQmluZGluZyIsInZhciBFbWl0dGVyICAgICA9IHJlcXVpcmUoJy4vZW1pdHRlcicpLFxuICAgIE9ic2VydmVyICAgID0gcmVxdWlyZSgnLi9vYnNlcnZlcicpLFxuICAgIGNvbmZpZyAgICAgID0gcmVxdWlyZSgnLi9jb25maWcnKSxcbiAgICB1dGlscyAgICAgICA9IHJlcXVpcmUoJy4vdXRpbHMnKSxcbiAgICBCaW5kaW5nICAgICA9IHJlcXVpcmUoJy4vYmluZGluZycpLFxuICAgIERpcmVjdGl2ZSAgID0gcmVxdWlyZSgnLi9kaXJlY3RpdmUnKSxcbiAgICBUZXh0UGFyc2VyICA9IHJlcXVpcmUoJy4vdGV4dC1wYXJzZXInKSxcbiAgICBEZXBzUGFyc2VyICA9IHJlcXVpcmUoJy4vZGVwcy1wYXJzZXInKSxcbiAgICBFeHBQYXJzZXIgICA9IHJlcXVpcmUoJy4vZXhwLXBhcnNlcicpLFxuICAgIFxuICAgIC8vIGNhY2hlIG1ldGhvZHNcbiAgICBzbGljZSAgICAgICA9IFtdLnNsaWNlLFxuICAgIGxvZyAgICAgICAgID0gdXRpbHMubG9nLFxuICAgIG1ha2VIYXNoICAgID0gdXRpbHMuaGFzaCxcbiAgICBleHRlbmQgICAgICA9IHV0aWxzLmV4dGVuZCxcbiAgICBkZWYgICAgICAgICA9IHV0aWxzLmRlZlByb3RlY3RlZCxcbiAgICBoYXNPd24gICAgICA9ICh7fSkuaGFzT3duUHJvcGVydHksXG5cbiAgICAvLyBob29rcyB0byByZWdpc3RlclxuICAgIGhvb2tzID0gW1xuICAgICAgICAnY3JlYXRlZCcsICdyZWFkeScsXG4gICAgICAgICdiZWZvcmVEZXN0cm95JywgJ2FmdGVyRGVzdHJveScsXG4gICAgICAgICdhdHRhY2hlZCcsICdkZXRhY2hlZCdcbiAgICBdXG5cbi8qKlxuICogIFRoZSBET00gY29tcGlsZXJcbiAqICBzY2FucyBhIERPTSBub2RlIGFuZCBjb21waWxlIGJpbmRpbmdzIGZvciBhIFZpZXdNb2RlbFxuICovXG5mdW5jdGlvbiBDb21waWxlciAodm0sIG9wdGlvbnMpIHtcblxuICAgIHZhciBjb21waWxlciA9IHRoaXNcblxuICAgIC8vIGRlZmF1bHQgc3RhdGVcbiAgICBjb21waWxlci5pbml0ICAgICAgID0gdHJ1ZVxuICAgIGNvbXBpbGVyLnJlcGVhdCAgICAgPSBmYWxzZVxuICAgIGNvbXBpbGVyLmRlc3Ryb3llZCAgPSBmYWxzZVxuICAgIGNvbXBpbGVyLmRlbGF5UmVhZHkgPSBmYWxzZVxuXG4gICAgLy8gcHJvY2VzcyBhbmQgZXh0ZW5kIG9wdGlvbnNcbiAgICBvcHRpb25zID0gY29tcGlsZXIub3B0aW9ucyA9IG9wdGlvbnMgfHwgbWFrZUhhc2goKVxuICAgIHV0aWxzLnByb2Nlc3NPcHRpb25zKG9wdGlvbnMpXG5cbiAgICAvLyBjb3B5IGRhdGEsIG1ldGhvZHMgJiBjb21waWxlciBvcHRpb25zXG4gICAgdmFyIGRhdGEgPSBjb21waWxlci5kYXRhID0gb3B0aW9ucy5kYXRhIHx8IHt9XG4gICAgZXh0ZW5kKHZtLCBkYXRhLCB0cnVlKVxuICAgIGV4dGVuZCh2bSwgb3B0aW9ucy5tZXRob2RzLCB0cnVlKVxuICAgIGV4dGVuZChjb21waWxlciwgb3B0aW9ucy5jb21waWxlck9wdGlvbnMpXG5cbiAgICAvLyBpbml0aWFsaXplIGVsZW1lbnRcbiAgICB2YXIgZWwgPSBjb21waWxlci5lbCA9IGNvbXBpbGVyLnNldHVwRWxlbWVudChvcHRpb25zKVxuICAgIGxvZygnXFxubmV3IFZNIGluc3RhbmNlOiAnICsgZWwudGFnTmFtZSArICdcXG4nKVxuXG4gICAgLy8gc2V0IGNvbXBpbGVyIHByb3BlcnRpZXNcbiAgICBjb21waWxlci52bSA9IGVsLnZ1ZV92bSA9IHZtXG4gICAgY29tcGlsZXIuYmluZGluZ3MgPSBtYWtlSGFzaCgpXG4gICAgY29tcGlsZXIuZGlycyA9IFtdXG4gICAgY29tcGlsZXIuZGVmZXJyZWQgPSBbXVxuICAgIGNvbXBpbGVyLmV4cHMgPSBbXVxuICAgIGNvbXBpbGVyLmNvbXB1dGVkID0gW11cbiAgICBjb21waWxlci5jaGlsZHJlbiA9IFtdXG4gICAgY29tcGlsZXIuZW1pdHRlciA9IG5ldyBFbWl0dGVyKClcbiAgICBjb21waWxlci5lbWl0dGVyLl9jdHggPSB2bVxuICAgIGNvbXBpbGVyLmRlbGVnYXRvcnMgPSBtYWtlSGFzaCgpXG5cbiAgICAvLyBzZXQgaW5lbnVtZXJhYmxlIFZNIHByb3BlcnRpZXNcbiAgICBkZWYodm0sICckJywgbWFrZUhhc2goKSlcbiAgICBkZWYodm0sICckZWwnLCBlbClcbiAgICBkZWYodm0sICckb3B0aW9ucycsIG9wdGlvbnMpXG4gICAgZGVmKHZtLCAnJGNvbXBpbGVyJywgY29tcGlsZXIpXG5cbiAgICAvLyBzZXQgcGFyZW50IFZNXG4gICAgLy8gYW5kIHJlZ2lzdGVyIGNoaWxkIGlkIG9uIHBhcmVudFxuICAgIHZhciBwYXJlbnRWTSA9IG9wdGlvbnMucGFyZW50LFxuICAgICAgICBjaGlsZElkID0gdXRpbHMuYXR0cihlbCwgJ3JlZicpXG4gICAgaWYgKHBhcmVudFZNKSB7XG4gICAgICAgIGNvbXBpbGVyLnBhcmVudCA9IHBhcmVudFZNLiRjb21waWxlclxuICAgICAgICBwYXJlbnRWTS4kY29tcGlsZXIuY2hpbGRyZW4ucHVzaChjb21waWxlcilcbiAgICAgICAgZGVmKHZtLCAnJHBhcmVudCcsIHBhcmVudFZNKVxuICAgICAgICBpZiAoY2hpbGRJZCkge1xuICAgICAgICAgICAgY29tcGlsZXIuY2hpbGRJZCA9IGNoaWxkSWRcbiAgICAgICAgICAgIHBhcmVudFZNLiRbY2hpbGRJZF0gPSB2bVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2V0IHJvb3RcbiAgICBkZWYodm0sICckcm9vdCcsIGdldFJvb3QoY29tcGlsZXIpLnZtKVxuXG4gICAgLy8gc2V0dXAgb2JzZXJ2ZXJcbiAgICBjb21waWxlci5zZXR1cE9ic2VydmVyKClcblxuICAgIC8vIGNyZWF0ZSBiaW5kaW5ncyBmb3IgY29tcHV0ZWQgcHJvcGVydGllc1xuICAgIHZhciBjb21wdXRlZCA9IG9wdGlvbnMuY29tcHV0ZWRcbiAgICBpZiAoY29tcHV0ZWQpIHtcbiAgICAgICAgZm9yICh2YXIga2V5IGluIGNvbXB1dGVkKSB7XG4gICAgICAgICAgICBjb21waWxlci5jcmVhdGVCaW5kaW5nKGtleSlcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGNvcHkgcGFyYW1BdHRyaWJ1dGVzXG4gICAgaWYgKG9wdGlvbnMucGFyYW1BdHRyaWJ1dGVzKSB7XG4gICAgICAgIG9wdGlvbnMucGFyYW1BdHRyaWJ1dGVzLmZvckVhY2goZnVuY3Rpb24gKGF0dHIpIHtcbiAgICAgICAgICAgIHZhciB2YWwgPSBlbC5nZXRBdHRyaWJ1dGUoYXR0cilcbiAgICAgICAgICAgIHZtW2F0dHJdID0gKGlzTmFOKHZhbCkgfHwgdmFsID09PSBudWxsKVxuICAgICAgICAgICAgICAgID8gdmFsXG4gICAgICAgICAgICAgICAgOiBOdW1iZXIodmFsKVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIC8vIGJlZm9yZUNvbXBpbGUgaG9va1xuICAgIGNvbXBpbGVyLmV4ZWNIb29rKCdjcmVhdGVkJylcblxuICAgIC8vIHRoZSB1c2VyIG1pZ2h0IGhhdmUgc2V0IHNvbWUgcHJvcHMgb24gdGhlIHZtIFxuICAgIC8vIHNvIGNvcHkgaXQgYmFjayB0byB0aGUgZGF0YS4uLlxuICAgIGV4dGVuZChkYXRhLCB2bSlcblxuICAgIC8vIG9ic2VydmUgdGhlIGRhdGFcbiAgICBjb21waWxlci5vYnNlcnZlRGF0YShkYXRhKVxuICAgIFxuICAgIC8vIGZvciByZXBlYXRlZCBpdGVtcywgY3JlYXRlIGluZGV4L2tleSBiaW5kaW5nc1xuICAgIC8vIGJlY2F1c2UgdGhleSBhcmUgaWVudW1lcmFibGVcbiAgICBpZiAoY29tcGlsZXIucmVwZWF0KSB7XG4gICAgICAgIGNvbXBpbGVyLmNyZWF0ZUJpbmRpbmcoJyRpbmRleCcpXG4gICAgICAgIGlmIChkYXRhLiRrZXkpIGNvbXBpbGVyLmNyZWF0ZUJpbmRpbmcoJyRrZXknKVxuICAgIH1cblxuICAgIC8vIG5vdyBwYXJzZSB0aGUgRE9NLCBkdXJpbmcgd2hpY2ggd2Ugd2lsbCBjcmVhdGUgbmVjZXNzYXJ5IGJpbmRpbmdzXG4gICAgLy8gYW5kIGJpbmQgdGhlIHBhcnNlZCBkaXJlY3RpdmVzXG4gICAgY29tcGlsZXIuY29tcGlsZShlbCwgdHJ1ZSlcblxuICAgIC8vIGJpbmQgZGVmZXJyZWQgZGlyZWN0aXZlcyAoY2hpbGQgY29tcG9uZW50cylcbiAgICBjb21waWxlci5kZWZlcnJlZC5mb3JFYWNoKGNvbXBpbGVyLmJpbmREaXJlY3RpdmUsIGNvbXBpbGVyKVxuXG4gICAgLy8gZXh0cmFjdCBkZXBlbmRlbmNpZXMgZm9yIGNvbXB1dGVkIHByb3BlcnRpZXNcbiAgICBjb21waWxlci5wYXJzZURlcHMoKVxuXG4gICAgLy8gZG9uZSFcbiAgICBjb21waWxlci5yYXdDb250ZW50ID0gbnVsbFxuICAgIGNvbXBpbGVyLmluaXQgPSBmYWxzZVxuXG4gICAgLy8gcG9zdCBjb21waWxlIC8gcmVhZHkgaG9va1xuICAgIGlmICghY29tcGlsZXIuZGVsYXlSZWFkeSkge1xuICAgICAgICBjb21waWxlci5leGVjSG9vaygncmVhZHknKVxuICAgIH1cbn1cblxudmFyIENvbXBpbGVyUHJvdG8gPSBDb21waWxlci5wcm90b3R5cGVcblxuLyoqXG4gKiAgSW5pdGlhbGl6ZSB0aGUgVk0vQ29tcGlsZXIncyBlbGVtZW50LlxuICogIEZpbGwgaXQgaW4gd2l0aCB0aGUgdGVtcGxhdGUgaWYgbmVjZXNzYXJ5LlxuICovXG5Db21waWxlclByb3RvLnNldHVwRWxlbWVudCA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgLy8gY3JlYXRlIHRoZSBub2RlIGZpcnN0XG4gICAgdmFyIGVsID0gdHlwZW9mIG9wdGlvbnMuZWwgPT09ICdzdHJpbmcnXG4gICAgICAgID8gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihvcHRpb25zLmVsKVxuICAgICAgICA6IG9wdGlvbnMuZWwgfHwgZG9jdW1lbnQuY3JlYXRlRWxlbWVudChvcHRpb25zLnRhZ05hbWUgfHwgJ2RpdicpXG5cbiAgICB2YXIgdGVtcGxhdGUgPSBvcHRpb25zLnRlbXBsYXRlXG4gICAgaWYgKHRlbXBsYXRlKSB7XG4gICAgICAgIC8vIGNvbGxlY3QgYW55dGhpbmcgYWxyZWFkeSBpbiB0aGVyZVxuICAgICAgICAvKiBqc2hpbnQgYm9zczogdHJ1ZSAqL1xuICAgICAgICB2YXIgY2hpbGQsXG4gICAgICAgICAgICBmcmFnID0gdGhpcy5yYXdDb250ZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpXG4gICAgICAgIHdoaWxlIChjaGlsZCA9IGVsLmZpcnN0Q2hpbGQpIHtcbiAgICAgICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQoY2hpbGQpXG4gICAgICAgIH1cbiAgICAgICAgLy8gcmVwbGFjZSBvcHRpb246IHVzZSB0aGUgZmlyc3Qgbm9kZSBpblxuICAgICAgICAvLyB0aGUgdGVtcGxhdGUgZGlyZWN0bHlcbiAgICAgICAgaWYgKG9wdGlvbnMucmVwbGFjZSAmJiB0ZW1wbGF0ZS5jaGlsZE5vZGVzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgdmFyIHJlcGxhY2VyID0gdGVtcGxhdGUuY2hpbGROb2Rlc1swXS5jbG9uZU5vZGUodHJ1ZSlcbiAgICAgICAgICAgIGlmIChlbC5wYXJlbnROb2RlKSB7XG4gICAgICAgICAgICAgICAgZWwucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUocmVwbGFjZXIsIGVsKVxuICAgICAgICAgICAgICAgIGVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoZWwpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbCA9IHJlcGxhY2VyXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBlbC5hcHBlbmRDaGlsZCh0ZW1wbGF0ZS5jbG9uZU5vZGUodHJ1ZSkpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBhcHBseSBlbGVtZW50IG9wdGlvbnNcbiAgICBpZiAob3B0aW9ucy5pZCkgZWwuaWQgPSBvcHRpb25zLmlkXG4gICAgaWYgKG9wdGlvbnMuY2xhc3NOYW1lKSBlbC5jbGFzc05hbWUgPSBvcHRpb25zLmNsYXNzTmFtZVxuICAgIHZhciBhdHRycyA9IG9wdGlvbnMuYXR0cmlidXRlc1xuICAgIGlmIChhdHRycykge1xuICAgICAgICBmb3IgKHZhciBhdHRyIGluIGF0dHJzKSB7XG4gICAgICAgICAgICBlbC5zZXRBdHRyaWJ1dGUoYXR0ciwgYXR0cnNbYXR0cl0pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZWxcbn1cblxuLyoqXG4gKiAgU2V0dXAgb2JzZXJ2ZXIuXG4gKiAgVGhlIG9ic2VydmVyIGxpc3RlbnMgZm9yIGdldC9zZXQvbXV0YXRlIGV2ZW50cyBvbiBhbGwgVk1cbiAqICB2YWx1ZXMvb2JqZWN0cyBhbmQgdHJpZ2dlciBjb3JyZXNwb25kaW5nIGJpbmRpbmcgdXBkYXRlcy5cbiAqICBJdCBhbHNvIGxpc3RlbnMgZm9yIGxpZmVjeWNsZSBob29rcy5cbiAqL1xuQ29tcGlsZXJQcm90by5zZXR1cE9ic2VydmVyID0gZnVuY3Rpb24gKCkge1xuXG4gICAgdmFyIGNvbXBpbGVyID0gdGhpcyxcbiAgICAgICAgYmluZGluZ3MgPSBjb21waWxlci5iaW5kaW5ncyxcbiAgICAgICAgb3B0aW9ucyAgPSBjb21waWxlci5vcHRpb25zLFxuICAgICAgICBvYnNlcnZlciA9IGNvbXBpbGVyLm9ic2VydmVyID0gbmV3IEVtaXR0ZXIoKVxuXG4gICAgLy8gYSBoYXNoIHRvIGhvbGQgZXZlbnQgcHJveGllcyBmb3IgZWFjaCByb290IGxldmVsIGtleVxuICAgIC8vIHNvIHRoZXkgY2FuIGJlIHJlZmVyZW5jZWQgYW5kIHJlbW92ZWQgbGF0ZXJcbiAgICBvYnNlcnZlci5wcm94aWVzID0gbWFrZUhhc2goKVxuICAgIG9ic2VydmVyLl9jdHggPSBjb21waWxlci52bVxuXG4gICAgLy8gYWRkIG93biBsaXN0ZW5lcnMgd2hpY2ggdHJpZ2dlciBiaW5kaW5nIHVwZGF0ZXNcbiAgICBvYnNlcnZlclxuICAgICAgICAub24oJ2dldCcsIG9uR2V0KVxuICAgICAgICAub24oJ3NldCcsIG9uU2V0KVxuICAgICAgICAub24oJ211dGF0ZScsIG9uU2V0KVxuXG4gICAgLy8gcmVnaXN0ZXIgaG9va3NcbiAgICBob29rcy5mb3JFYWNoKGZ1bmN0aW9uIChob29rKSB7XG4gICAgICAgIHZhciBmbnMgPSBvcHRpb25zW2hvb2tdXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZucykpIHtcbiAgICAgICAgICAgIHZhciBpID0gZm5zLmxlbmd0aFxuICAgICAgICAgICAgLy8gc2luY2UgaG9va3Mgd2VyZSBtZXJnZWQgd2l0aCBjaGlsZCBhdCBoZWFkLFxuICAgICAgICAgICAgLy8gd2UgbG9vcCByZXZlcnNlbHkuXG4gICAgICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICAgICAgcmVnaXN0ZXJIb29rKGhvb2ssIGZuc1tpXSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChmbnMpIHtcbiAgICAgICAgICAgIHJlZ2lzdGVySG9vayhob29rLCBmbnMpXG4gICAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gYnJvYWRjYXN0IGF0dGFjaGVkL2RldGFjaGVkIGhvb2tzXG4gICAgb2JzZXJ2ZXJcbiAgICAgICAgLm9uKCdob29rOmF0dGFjaGVkJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgYnJvYWRjYXN0KDEpXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignaG9vazpkZXRhY2hlZCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGJyb2FkY2FzdCgwKVxuICAgICAgICB9KVxuXG4gICAgZnVuY3Rpb24gb25HZXQgKGtleSkge1xuICAgICAgICBjaGVjayhrZXkpXG4gICAgICAgIERlcHNQYXJzZXIuY2F0Y2hlci5lbWl0KCdnZXQnLCBiaW5kaW5nc1trZXldKVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIG9uU2V0IChrZXksIHZhbCwgbXV0YXRpb24pIHtcbiAgICAgICAgb2JzZXJ2ZXIuZW1pdCgnY2hhbmdlOicgKyBrZXksIHZhbCwgbXV0YXRpb24pXG4gICAgICAgIGNoZWNrKGtleSlcbiAgICAgICAgYmluZGluZ3Nba2V5XS51cGRhdGUodmFsKVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlZ2lzdGVySG9vayAoaG9vaywgZm4pIHtcbiAgICAgICAgb2JzZXJ2ZXIub24oJ2hvb2s6JyArIGhvb2ssIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGZuLmNhbGwoY29tcGlsZXIudm0pXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYnJvYWRjYXN0IChldmVudCkge1xuICAgICAgICB2YXIgY2hpbGRyZW4gPSBjb21waWxlci5jaGlsZHJlblxuICAgICAgICBpZiAoY2hpbGRyZW4pIHtcbiAgICAgICAgICAgIHZhciBjaGlsZCwgaSA9IGNoaWxkcmVuLmxlbmd0aFxuICAgICAgICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICAgICAgICAgIGNoaWxkID0gY2hpbGRyZW5baV1cbiAgICAgICAgICAgICAgICBpZiAoY2hpbGQuZWwucGFyZW50Tm9kZSkge1xuICAgICAgICAgICAgICAgICAgICBldmVudCA9ICdob29rOicgKyAoZXZlbnQgPyAnYXR0YWNoZWQnIDogJ2RldGFjaGVkJylcbiAgICAgICAgICAgICAgICAgICAgY2hpbGQub2JzZXJ2ZXIuZW1pdChldmVudClcbiAgICAgICAgICAgICAgICAgICAgY2hpbGQuZW1pdHRlci5lbWl0KGV2ZW50KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNoZWNrIChrZXkpIHtcbiAgICAgICAgaWYgKCFiaW5kaW5nc1trZXldKSB7XG4gICAgICAgICAgICBjb21waWxlci5jcmVhdGVCaW5kaW5nKGtleSlcbiAgICAgICAgfVxuICAgIH1cbn1cblxuQ29tcGlsZXJQcm90by5vYnNlcnZlRGF0YSA9IGZ1bmN0aW9uIChkYXRhKSB7XG5cbiAgICB2YXIgY29tcGlsZXIgPSB0aGlzLFxuICAgICAgICBvYnNlcnZlciA9IGNvbXBpbGVyLm9ic2VydmVyXG5cbiAgICAvLyByZWN1cnNpdmVseSBvYnNlcnZlIG5lc3RlZCBwcm9wZXJ0aWVzXG4gICAgT2JzZXJ2ZXIub2JzZXJ2ZShkYXRhLCAnJywgb2JzZXJ2ZXIpXG5cbiAgICAvLyBhbHNvIGNyZWF0ZSBiaW5kaW5nIGZvciB0b3AgbGV2ZWwgJGRhdGFcbiAgICAvLyBzbyBpdCBjYW4gYmUgdXNlZCBpbiB0ZW1wbGF0ZXMgdG9vXG4gICAgdmFyICRkYXRhQmluZGluZyA9IGNvbXBpbGVyLmJpbmRpbmdzWyckZGF0YSddID0gbmV3IEJpbmRpbmcoY29tcGlsZXIsICckZGF0YScpXG4gICAgJGRhdGFCaW5kaW5nLnVwZGF0ZShkYXRhKVxuXG4gICAgLy8gYWxsb3cgJGRhdGEgdG8gYmUgc3dhcHBlZFxuICAgIGRlZkdldFNldChjb21waWxlci52bSwgJyRkYXRhJywge1xuICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBjb21waWxlci5vYnNlcnZlci5lbWl0KCdnZXQnLCAnJGRhdGEnKVxuICAgICAgICAgICAgcmV0dXJuIGNvbXBpbGVyLmRhdGFcbiAgICAgICAgfSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbiAobmV3RGF0YSkge1xuICAgICAgICAgICAgdmFyIG9sZERhdGEgPSBjb21waWxlci5kYXRhXG4gICAgICAgICAgICBPYnNlcnZlci51bm9ic2VydmUob2xkRGF0YSwgJycsIG9ic2VydmVyKVxuICAgICAgICAgICAgY29tcGlsZXIuZGF0YSA9IG5ld0RhdGFcbiAgICAgICAgICAgIE9ic2VydmVyLmNvcHlQYXRocyhuZXdEYXRhLCBvbGREYXRhKVxuICAgICAgICAgICAgT2JzZXJ2ZXIub2JzZXJ2ZShuZXdEYXRhLCAnJywgb2JzZXJ2ZXIpXG4gICAgICAgICAgICBjb21waWxlci5vYnNlcnZlci5lbWl0KCdzZXQnLCAnJGRhdGEnLCBuZXdEYXRhKVxuICAgICAgICB9XG4gICAgfSlcblxuICAgIC8vIGVtaXQgJGRhdGEgY2hhbmdlIG9uIGFsbCBjaGFuZ2VzXG4gICAgb2JzZXJ2ZXJcbiAgICAgICAgLm9uKCdzZXQnLCBvblNldClcbiAgICAgICAgLm9uKCdtdXRhdGUnLCBvblNldClcblxuICAgIGZ1bmN0aW9uIG9uU2V0IChrZXkpIHtcbiAgICAgICAgaWYgKGtleSAhPT0gJyRkYXRhJykge1xuICAgICAgICAgICAgJGRhdGFCaW5kaW5nLnVwZGF0ZShjb21waWxlci5kYXRhKVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqICBDb21waWxlIGEgRE9NIG5vZGUgKHJlY3Vyc2l2ZSlcbiAqL1xuQ29tcGlsZXJQcm90by5jb21waWxlID0gZnVuY3Rpb24gKG5vZGUsIHJvb3QpIHtcblxuICAgIHZhciBjb21waWxlciA9IHRoaXMsXG4gICAgICAgIG5vZGVUeXBlID0gbm9kZS5ub2RlVHlwZSxcbiAgICAgICAgdGFnTmFtZSAgPSBub2RlLnRhZ05hbWVcblxuICAgIGlmIChub2RlVHlwZSA9PT0gMSAmJiB0YWdOYW1lICE9PSAnU0NSSVBUJykgeyAvLyBhIG5vcm1hbCBub2RlXG5cbiAgICAgICAgLy8gc2tpcCBhbnl0aGluZyB3aXRoIHYtcHJlXG4gICAgICAgIGlmICh1dGlscy5hdHRyKG5vZGUsICdwcmUnKSAhPT0gbnVsbCkgcmV0dXJuXG5cbiAgICAgICAgLy8gc3BlY2lhbCBhdHRyaWJ1dGVzIHRvIGNoZWNrXG4gICAgICAgIHZhciByZXBlYXRFeHAsXG4gICAgICAgICAgICB3aXRoRXhwLFxuICAgICAgICAgICAgcGFydGlhbElkLFxuICAgICAgICAgICAgZGlyZWN0aXZlLFxuICAgICAgICAgICAgY29tcG9uZW50SWQgPSB1dGlscy5hdHRyKG5vZGUsICdjb21wb25lbnQnKSB8fCB0YWdOYW1lLnRvTG93ZXJDYXNlKCksXG4gICAgICAgICAgICBjb21wb25lbnRDdG9yID0gY29tcGlsZXIuZ2V0T3B0aW9uKCdjb21wb25lbnRzJywgY29tcG9uZW50SWQpXG5cbiAgICAgICAgLy8gSXQgaXMgaW1wb3J0YW50IHRoYXQgd2UgYWNjZXNzIHRoZXNlIGF0dHJpYnV0ZXNcbiAgICAgICAgLy8gcHJvY2VkdXJhbGx5IGJlY2F1c2UgdGhlIG9yZGVyIG1hdHRlcnMuXG4gICAgICAgIC8vXG4gICAgICAgIC8vIGB1dGlscy5hdHRyYCByZW1vdmVzIHRoZSBhdHRyaWJ1dGUgb25jZSBpdCBnZXRzIHRoZVxuICAgICAgICAvLyB2YWx1ZSwgc28gd2Ugc2hvdWxkIG5vdCBhY2Nlc3MgdGhlbSBhbGwgYXQgb25jZS5cblxuICAgICAgICAvLyB2LXJlcGVhdCBoYXMgdGhlIGhpZ2hlc3QgcHJpb3JpdHlcbiAgICAgICAgLy8gYW5kIHdlIG5lZWQgdG8gcHJlc2VydmUgYWxsIG90aGVyIGF0dHJpYnV0ZXMgZm9yIGl0LlxuICAgICAgICAvKiBqc2hpbnQgYm9zczogdHJ1ZSAqL1xuICAgICAgICBpZiAocmVwZWF0RXhwID0gdXRpbHMuYXR0cihub2RlLCAncmVwZWF0JykpIHtcblxuICAgICAgICAgICAgLy8gcmVwZWF0IGJsb2NrIGNhbm5vdCBoYXZlIHYtaWQgYXQgdGhlIHNhbWUgdGltZS5cbiAgICAgICAgICAgIGRpcmVjdGl2ZSA9IERpcmVjdGl2ZS5wYXJzZSgncmVwZWF0JywgcmVwZWF0RXhwLCBjb21waWxlciwgbm9kZSlcbiAgICAgICAgICAgIGlmIChkaXJlY3RpdmUpIHtcbiAgICAgICAgICAgICAgICBkaXJlY3RpdmUuQ3RvciA9IGNvbXBvbmVudEN0b3JcbiAgICAgICAgICAgICAgICAvLyBkZWZlciBjaGlsZCBjb21wb25lbnQgY29tcGlsYXRpb25cbiAgICAgICAgICAgICAgICAvLyBzbyBieSB0aGUgdGltZSB0aGV5IGFyZSBjb21waWxlZCwgdGhlIHBhcmVudFxuICAgICAgICAgICAgICAgIC8vIHdvdWxkIGhhdmUgY29sbGVjdGVkIGFsbCBiaW5kaW5nc1xuICAgICAgICAgICAgICAgIGNvbXBpbGVyLmRlZmVycmVkLnB1c2goZGlyZWN0aXZlKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgIC8vIHYtd2l0aCBoYXMgMm5kIGhpZ2hlc3QgcHJpb3JpdHlcbiAgICAgICAgfSBlbHNlIGlmIChyb290ICE9PSB0cnVlICYmICgod2l0aEV4cCA9IHV0aWxzLmF0dHIobm9kZSwgJ3dpdGgnKSkgfHwgY29tcG9uZW50Q3RvcikpIHtcblxuICAgICAgICAgICAgd2l0aEV4cCA9IERpcmVjdGl2ZS5zcGxpdCh3aXRoRXhwIHx8ICcnKVxuICAgICAgICAgICAgd2l0aEV4cC5mb3JFYWNoKGZ1bmN0aW9uIChleHAsIGkpIHtcbiAgICAgICAgICAgICAgICB2YXIgZGlyZWN0aXZlID0gRGlyZWN0aXZlLnBhcnNlKCd3aXRoJywgZXhwLCBjb21waWxlciwgbm9kZSlcbiAgICAgICAgICAgICAgICBpZiAoZGlyZWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgICAgIGRpcmVjdGl2ZS5DdG9yID0gY29tcG9uZW50Q3RvclxuICAgICAgICAgICAgICAgICAgICAvLyBub3RpZnkgdGhlIGRpcmVjdGl2ZSB0aGF0IHRoaXMgaXMgdGhlXG4gICAgICAgICAgICAgICAgICAgIC8vIGxhc3QgZXhwcmVzc2lvbiBpbiB0aGUgZ3JvdXBcbiAgICAgICAgICAgICAgICAgICAgZGlyZWN0aXZlLmxhc3QgPSBpID09PSB3aXRoRXhwLmxlbmd0aCAtIDFcbiAgICAgICAgICAgICAgICAgICAgY29tcGlsZXIuZGVmZXJyZWQucHVzaChkaXJlY3RpdmUpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcblxuICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICAvLyBjaGVjayB0cmFuc2l0aW9uICYgYW5pbWF0aW9uIHByb3BlcnRpZXNcbiAgICAgICAgICAgIG5vZGUudnVlX3RyYW5zICA9IHV0aWxzLmF0dHIobm9kZSwgJ3RyYW5zaXRpb24nKVxuICAgICAgICAgICAgbm9kZS52dWVfYW5pbSAgID0gdXRpbHMuYXR0cihub2RlLCAnYW5pbWF0aW9uJylcbiAgICAgICAgICAgIG5vZGUudnVlX2VmZmVjdCA9IHV0aWxzLmF0dHIobm9kZSwgJ2VmZmVjdCcpXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIHJlcGxhY2UgaW5uZXJIVE1MIHdpdGggcGFydGlhbFxuICAgICAgICAgICAgcGFydGlhbElkID0gdXRpbHMuYXR0cihub2RlLCAncGFydGlhbCcpXG4gICAgICAgICAgICBpZiAocGFydGlhbElkKSB7XG4gICAgICAgICAgICAgICAgdmFyIHBhcnRpYWwgPSBjb21waWxlci5nZXRPcHRpb24oJ3BhcnRpYWxzJywgcGFydGlhbElkKVxuICAgICAgICAgICAgICAgIGlmIChwYXJ0aWFsKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuaW5uZXJIVE1MID0gJydcbiAgICAgICAgICAgICAgICAgICAgbm9kZS5hcHBlbmRDaGlsZChwYXJ0aWFsLmNsb25lTm9kZSh0cnVlKSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGZpbmFsbHksIG9ubHkgbm9ybWFsIGRpcmVjdGl2ZXMgbGVmdCFcbiAgICAgICAgICAgIGNvbXBpbGVyLmNvbXBpbGVOb2RlKG5vZGUpXG4gICAgICAgIH1cblxuICAgIH0gZWxzZSBpZiAobm9kZVR5cGUgPT09IDMgJiYgY29uZmlnLmludGVycG9sYXRlKSB7IC8vIHRleHQgbm9kZVxuXG4gICAgICAgIGNvbXBpbGVyLmNvbXBpbGVUZXh0Tm9kZShub2RlKVxuXG4gICAgfVxuXG59XG5cbi8qKlxuICogIENvbXBpbGUgYSBub3JtYWwgbm9kZVxuICovXG5Db21waWxlclByb3RvLmNvbXBpbGVOb2RlID0gZnVuY3Rpb24gKG5vZGUpIHtcbiAgICB2YXIgaSwgaixcbiAgICAgICAgYXR0cnMgPSBzbGljZS5jYWxsKG5vZGUuYXR0cmlidXRlcyksXG4gICAgICAgIHByZWZpeCA9IGNvbmZpZy5wcmVmaXggKyAnLSdcbiAgICAvLyBwYXJzZSBpZiBoYXMgYXR0cmlidXRlc1xuICAgIGlmIChhdHRycyAmJiBhdHRycy5sZW5ndGgpIHtcbiAgICAgICAgdmFyIGF0dHIsIGlzRGlyZWN0aXZlLCBleHBzLCBleHAsIGRpcmVjdGl2ZSwgZGlybmFtZVxuICAgICAgICAvLyBsb29wIHRocm91Z2ggYWxsIGF0dHJpYnV0ZXNcbiAgICAgICAgaSA9IGF0dHJzLmxlbmd0aFxuICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICBhdHRyID0gYXR0cnNbaV1cbiAgICAgICAgICAgIGlzRGlyZWN0aXZlID0gZmFsc2VcblxuICAgICAgICAgICAgaWYgKGF0dHIubmFtZS5pbmRleE9mKHByZWZpeCkgPT09IDApIHtcbiAgICAgICAgICAgICAgICAvLyBhIGRpcmVjdGl2ZSAtIHNwbGl0LCBwYXJzZSBhbmQgYmluZCBpdC5cbiAgICAgICAgICAgICAgICBpc0RpcmVjdGl2ZSA9IHRydWVcbiAgICAgICAgICAgICAgICBleHBzID0gRGlyZWN0aXZlLnNwbGl0KGF0dHIudmFsdWUpXG4gICAgICAgICAgICAgICAgLy8gbG9vcCB0aHJvdWdoIGNsYXVzZXMgKHNlcGFyYXRlZCBieSBcIixcIilcbiAgICAgICAgICAgICAgICAvLyBpbnNpZGUgZWFjaCBhdHRyaWJ1dGVcbiAgICAgICAgICAgICAgICBqID0gZXhwcy5sZW5ndGhcbiAgICAgICAgICAgICAgICB3aGlsZSAoai0tKSB7XG4gICAgICAgICAgICAgICAgICAgIGV4cCA9IGV4cHNbal1cbiAgICAgICAgICAgICAgICAgICAgZGlybmFtZSA9IGF0dHIubmFtZS5zbGljZShwcmVmaXgubGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgICBkaXJlY3RpdmUgPSBEaXJlY3RpdmUucGFyc2UoZGlybmFtZSwgZXhwLCB0aGlzLCBub2RlKVxuICAgICAgICAgICAgICAgICAgICBpZiAoZGlyZWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJpbmREaXJlY3RpdmUoZGlyZWN0aXZlKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChjb25maWcuaW50ZXJwb2xhdGUpIHtcbiAgICAgICAgICAgICAgICAvLyBub24gZGlyZWN0aXZlIGF0dHJpYnV0ZSwgY2hlY2sgaW50ZXJwb2xhdGlvbiB0YWdzXG4gICAgICAgICAgICAgICAgZXhwID0gVGV4dFBhcnNlci5wYXJzZUF0dHIoYXR0ci52YWx1ZSlcbiAgICAgICAgICAgICAgICBpZiAoZXhwKSB7XG4gICAgICAgICAgICAgICAgICAgIGRpcmVjdGl2ZSA9IERpcmVjdGl2ZS5wYXJzZSgnYXR0cicsIGF0dHIubmFtZSArICc6JyArIGV4cCwgdGhpcywgbm9kZSlcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRpcmVjdGl2ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5iaW5kRGlyZWN0aXZlKGRpcmVjdGl2ZSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGlzRGlyZWN0aXZlICYmIGRpcm5hbWUgIT09ICdjbG9haycpIHtcbiAgICAgICAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZShhdHRyLm5hbWUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgLy8gcmVjdXJzaXZlbHkgY29tcGlsZSBjaGlsZE5vZGVzXG4gICAgaWYgKG5vZGUuY2hpbGROb2Rlcy5sZW5ndGgpIHtcbiAgICAgICAgc2xpY2UuY2FsbChub2RlLmNoaWxkTm9kZXMpLmZvckVhY2godGhpcy5jb21waWxlLCB0aGlzKVxuICAgIH1cbn1cblxuLyoqXG4gKiAgQ29tcGlsZSBhIHRleHQgbm9kZVxuICovXG5Db21waWxlclByb3RvLmNvbXBpbGVUZXh0Tm9kZSA9IGZ1bmN0aW9uIChub2RlKSB7XG5cbiAgICB2YXIgdG9rZW5zID0gVGV4dFBhcnNlci5wYXJzZShub2RlLm5vZGVWYWx1ZSlcbiAgICBpZiAoIXRva2VucykgcmV0dXJuXG4gICAgdmFyIGVsLCB0b2tlbiwgZGlyZWN0aXZlLCBwYXJ0aWFsLCBwYXJ0aWFsSWQsIHBhcnRpYWxOb2Rlc1xuXG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSB0b2tlbnMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIHRva2VuID0gdG9rZW5zW2ldXG4gICAgICAgIGRpcmVjdGl2ZSA9IHBhcnRpYWxOb2RlcyA9IG51bGxcbiAgICAgICAgaWYgKHRva2VuLmtleSkgeyAvLyBhIGJpbmRpbmdcbiAgICAgICAgICAgIGlmICh0b2tlbi5rZXkuY2hhckF0KDApID09PSAnPicpIHsgLy8gYSBwYXJ0aWFsXG4gICAgICAgICAgICAgICAgcGFydGlhbElkID0gdG9rZW4ua2V5LnNsaWNlKDEpLnRyaW0oKVxuICAgICAgICAgICAgICAgIGlmIChwYXJ0aWFsSWQgPT09ICd5aWVsZCcpIHtcbiAgICAgICAgICAgICAgICAgICAgZWwgPSB0aGlzLnJhd0NvbnRlbnRcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBwYXJ0aWFsID0gdGhpcy5nZXRPcHRpb24oJ3BhcnRpYWxzJywgcGFydGlhbElkKVxuICAgICAgICAgICAgICAgICAgICBpZiAocGFydGlhbCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZWwgPSBwYXJ0aWFsLmNsb25lTm9kZSh0cnVlKVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXRpbHMud2FybignVW5rbm93biBwYXJ0aWFsOiAnICsgcGFydGlhbElkKVxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoZWwpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gc2F2ZSBhbiBBcnJheSByZWZlcmVuY2Ugb2YgdGhlIHBhcnRpYWwncyBub2Rlc1xuICAgICAgICAgICAgICAgICAgICAvLyBzbyB3ZSBjYW4gY29tcGlsZSB0aGVtIEFGVEVSIGFwcGVuZGluZyB0aGUgZnJhZ21lbnRcbiAgICAgICAgICAgICAgICAgICAgcGFydGlhbE5vZGVzID0gc2xpY2UuY2FsbChlbC5jaGlsZE5vZGVzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7IC8vIGEgcmVhbCBiaW5kaW5nXG4gICAgICAgICAgICAgICAgaWYgKCF0b2tlbi5odG1sKSB7IC8vIHRleHQgYmluZGluZ1xuICAgICAgICAgICAgICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKVxuICAgICAgICAgICAgICAgICAgICBkaXJlY3RpdmUgPSBEaXJlY3RpdmUucGFyc2UoJ3RleHQnLCB0b2tlbi5rZXksIHRoaXMsIGVsKVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7IC8vIGh0bWwgYmluZGluZ1xuICAgICAgICAgICAgICAgICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUNvbW1lbnQoY29uZmlnLnByZWZpeCArICctaHRtbCcpXG4gICAgICAgICAgICAgICAgICAgIGRpcmVjdGl2ZSA9IERpcmVjdGl2ZS5wYXJzZSgnaHRtbCcsIHRva2VuLmtleSwgdGhpcywgZWwpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgeyAvLyBhIHBsYWluIHN0cmluZ1xuICAgICAgICAgICAgZWwgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSh0b2tlbilcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGluc2VydCBub2RlXG4gICAgICAgIG5vZGUucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZWwsIG5vZGUpXG5cbiAgICAgICAgLy8gYmluZCBkaXJlY3RpdmVcbiAgICAgICAgaWYgKGRpcmVjdGl2ZSkge1xuICAgICAgICAgICAgdGhpcy5iaW5kRGlyZWN0aXZlKGRpcmVjdGl2ZSlcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbXBpbGUgcGFydGlhbCBhZnRlciBhcHBlbmRpbmcsIGJlY2F1c2UgaXRzIGNoaWxkcmVuJ3MgcGFyZW50Tm9kZVxuICAgICAgICAvLyB3aWxsIGNoYW5nZSBmcm9tIHRoZSBmcmFnbWVudCB0byB0aGUgY29ycmVjdCBwYXJlbnROb2RlLlxuICAgICAgICAvLyBUaGlzIGNvdWxkIGFmZmVjdCBkaXJlY3RpdmVzIHRoYXQgbmVlZCBhY2Nlc3MgdG8gaXRzIGVsZW1lbnQncyBwYXJlbnROb2RlLlxuICAgICAgICBpZiAocGFydGlhbE5vZGVzKSB7XG4gICAgICAgICAgICBwYXJ0aWFsTm9kZXMuZm9yRWFjaCh0aGlzLmNvbXBpbGUsIHRoaXMpXG4gICAgICAgIH1cblxuICAgIH1cbiAgICBub2RlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQobm9kZSlcbn1cblxuLyoqXG4gKiAgQWRkIGEgZGlyZWN0aXZlIGluc3RhbmNlIHRvIHRoZSBjb3JyZWN0IGJpbmRpbmcgJiB2aWV3bW9kZWxcbiAqL1xuQ29tcGlsZXJQcm90by5iaW5kRGlyZWN0aXZlID0gZnVuY3Rpb24gKGRpcmVjdGl2ZSkge1xuXG4gICAgLy8ga2VlcCB0cmFjayBvZiBpdCBzbyB3ZSBjYW4gdW5iaW5kKCkgbGF0ZXJcbiAgICB0aGlzLmRpcnMucHVzaChkaXJlY3RpdmUpXG5cbiAgICAvLyBmb3IgZW1wdHkgb3IgbGl0ZXJhbCBkaXJlY3RpdmVzLCBzaW1wbHkgY2FsbCBpdHMgYmluZCgpXG4gICAgLy8gYW5kIHdlJ3JlIGRvbmUuXG4gICAgaWYgKGRpcmVjdGl2ZS5pc0VtcHR5IHx8IGRpcmVjdGl2ZS5pc0xpdGVyYWwpIHtcbiAgICAgICAgaWYgKGRpcmVjdGl2ZS5iaW5kKSBkaXJlY3RpdmUuYmluZCgpXG4gICAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8vIG90aGVyd2lzZSwgd2UgZ290IG1vcmUgd29yayB0byBkby4uLlxuICAgIHZhciBiaW5kaW5nLFxuICAgICAgICBjb21waWxlciA9IHRoaXMsXG4gICAgICAgIGtleSAgICAgID0gZGlyZWN0aXZlLmtleVxuXG4gICAgaWYgKGRpcmVjdGl2ZS5pc0V4cCkge1xuICAgICAgICAvLyBleHByZXNzaW9uIGJpbmRpbmdzIGFyZSBhbHdheXMgY3JlYXRlZCBvbiBjdXJyZW50IGNvbXBpbGVyXG4gICAgICAgIGJpbmRpbmcgPSBjb21waWxlci5jcmVhdGVCaW5kaW5nKGtleSwgdHJ1ZSwgZGlyZWN0aXZlLmlzRm4pXG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gcmVjdXJzaXZlbHkgbG9jYXRlIHdoaWNoIGNvbXBpbGVyIG93bnMgdGhlIGJpbmRpbmdcbiAgICAgICAgd2hpbGUgKGNvbXBpbGVyKSB7XG4gICAgICAgICAgICBpZiAoY29tcGlsZXIuaGFzS2V5KGtleSkpIHtcbiAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb21waWxlciA9IGNvbXBpbGVyLnBhcmVudFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGNvbXBpbGVyID0gY29tcGlsZXIgfHwgdGhpc1xuICAgICAgICBiaW5kaW5nID0gY29tcGlsZXIuYmluZGluZ3Nba2V5XSB8fCBjb21waWxlci5jcmVhdGVCaW5kaW5nKGtleSlcbiAgICB9XG4gICAgYmluZGluZy5kaXJzLnB1c2goZGlyZWN0aXZlKVxuICAgIGRpcmVjdGl2ZS5iaW5kaW5nID0gYmluZGluZ1xuXG4gICAgdmFyIHZhbHVlID0gYmluZGluZy52YWwoKVxuICAgIC8vIGludm9rZSBiaW5kIGhvb2sgaWYgZXhpc3RzXG4gICAgaWYgKGRpcmVjdGl2ZS5iaW5kKSB7XG4gICAgICAgIGRpcmVjdGl2ZS5iaW5kKHZhbHVlKVxuICAgIH1cbiAgICAvLyBzZXQgaW5pdGlhbCB2YWx1ZVxuICAgIGRpcmVjdGl2ZS51cGRhdGUodmFsdWUsIHRydWUpXG59XG5cbi8qKlxuICogIENyZWF0ZSBiaW5kaW5nIGFuZCBhdHRhY2ggZ2V0dGVyL3NldHRlciBmb3IgYSBrZXkgdG8gdGhlIHZpZXdtb2RlbCBvYmplY3RcbiAqL1xuQ29tcGlsZXJQcm90by5jcmVhdGVCaW5kaW5nID0gZnVuY3Rpb24gKGtleSwgaXNFeHAsIGlzRm4pIHtcblxuICAgIGxvZygnICBjcmVhdGVkIGJpbmRpbmc6ICcgKyBrZXkpXG5cbiAgICB2YXIgY29tcGlsZXIgPSB0aGlzLFxuICAgICAgICBiaW5kaW5ncyA9IGNvbXBpbGVyLmJpbmRpbmdzLFxuICAgICAgICBjb21wdXRlZCA9IGNvbXBpbGVyLm9wdGlvbnMuY29tcHV0ZWQsXG4gICAgICAgIGJpbmRpbmcgID0gbmV3IEJpbmRpbmcoY29tcGlsZXIsIGtleSwgaXNFeHAsIGlzRm4pXG5cbiAgICBpZiAoaXNFeHApIHtcbiAgICAgICAgLy8gZXhwcmVzc2lvbiBiaW5kaW5ncyBhcmUgYW5vbnltb3VzXG4gICAgICAgIGNvbXBpbGVyLmRlZmluZUV4cChrZXksIGJpbmRpbmcpXG4gICAgfSBlbHNlIHtcbiAgICAgICAgYmluZGluZ3Nba2V5XSA9IGJpbmRpbmdcbiAgICAgICAgaWYgKGJpbmRpbmcucm9vdCkge1xuICAgICAgICAgICAgLy8gdGhpcyBpcyBhIHJvb3QgbGV2ZWwgYmluZGluZy4gd2UgbmVlZCB0byBkZWZpbmUgZ2V0dGVyL3NldHRlcnMgZm9yIGl0LlxuICAgICAgICAgICAgaWYgKGNvbXB1dGVkICYmIGNvbXB1dGVkW2tleV0pIHtcbiAgICAgICAgICAgICAgICAvLyBjb21wdXRlZCBwcm9wZXJ0eVxuICAgICAgICAgICAgICAgIGNvbXBpbGVyLmRlZmluZUNvbXB1dGVkKGtleSwgYmluZGluZywgY29tcHV0ZWRba2V5XSlcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoa2V5LmNoYXJBdCgwKSAhPT0gJyQnKSB7XG4gICAgICAgICAgICAgICAgLy8gbm9ybWFsIHByb3BlcnR5XG4gICAgICAgICAgICAgICAgY29tcGlsZXIuZGVmaW5lUHJvcChrZXksIGJpbmRpbmcpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbXBpbGVyLmRlZmluZU1ldGEoa2V5LCBiaW5kaW5nKVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gZW5zdXJlIHBhdGggaW4gZGF0YSBzbyBpdCBjYW4gYmUgb2JzZXJ2ZWRcbiAgICAgICAgICAgIE9ic2VydmVyLmVuc3VyZVBhdGgoY29tcGlsZXIuZGF0YSwga2V5KVxuICAgICAgICAgICAgdmFyIHBhcmVudEtleSA9IGtleS5zbGljZSgwLCBrZXkubGFzdEluZGV4T2YoJy4nKSlcbiAgICAgICAgICAgIGlmICghYmluZGluZ3NbcGFyZW50S2V5XSkge1xuICAgICAgICAgICAgICAgIC8vIHRoaXMgaXMgYSBuZXN0ZWQgdmFsdWUgYmluZGluZywgYnV0IHRoZSBiaW5kaW5nIGZvciBpdHMgcGFyZW50XG4gICAgICAgICAgICAgICAgLy8gaGFzIG5vdCBiZWVuIGNyZWF0ZWQgeWV0LiBXZSBiZXR0ZXIgY3JlYXRlIHRoYXQgb25lIHRvby5cbiAgICAgICAgICAgICAgICBjb21waWxlci5jcmVhdGVCaW5kaW5nKHBhcmVudEtleSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gYmluZGluZ1xufVxuXG4vKipcbiAqICBEZWZpbmUgdGhlIGdldHRlci9zZXR0ZXIgZm9yIGEgcm9vdC1sZXZlbCBwcm9wZXJ0eSBvbiB0aGUgVk1cbiAqICBhbmQgb2JzZXJ2ZSB0aGUgaW5pdGlhbCB2YWx1ZVxuICovXG5Db21waWxlclByb3RvLmRlZmluZVByb3AgPSBmdW5jdGlvbiAoa2V5LCBiaW5kaW5nKSB7XG4gICAgXG4gICAgdmFyIGNvbXBpbGVyID0gdGhpcyxcbiAgICAgICAgZGF0YSAgICAgPSBjb21waWxlci5kYXRhLFxuICAgICAgICBvYiAgICAgICA9IGRhdGEuX19lbWl0dGVyX19cblxuICAgIC8vIG1ha2Ugc3VyZSB0aGUga2V5IGlzIHByZXNlbnQgaW4gZGF0YVxuICAgIC8vIHNvIGl0IGNhbiBiZSBvYnNlcnZlZFxuICAgIGlmICghKGtleSBpbiBkYXRhKSkge1xuICAgICAgICBkYXRhW2tleV0gPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICAvLyBpZiB0aGUgZGF0YSBvYmplY3QgaXMgYWxyZWFkeSBvYnNlcnZlZCwgYnV0IHRoZSBrZXlcbiAgICAvLyBpcyBub3Qgb2JzZXJ2ZWQsIHdlIG5lZWQgdG8gYWRkIGl0IHRvIHRoZSBvYnNlcnZlZCBrZXlzLlxuICAgIGlmIChvYiAmJiAhKGtleSBpbiBvYi52YWx1ZXMpKSB7XG4gICAgICAgIE9ic2VydmVyLmNvbnZlcnRLZXkoZGF0YSwga2V5KVxuICAgIH1cblxuICAgIGJpbmRpbmcudmFsdWUgPSBkYXRhW2tleV1cblxuICAgIGRlZkdldFNldChjb21waWxlci52bSwga2V5LCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNvbXBpbGVyLmRhdGFba2V5XVxuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uICh2YWwpIHtcbiAgICAgICAgICAgIGNvbXBpbGVyLmRhdGFba2V5XSA9IHZhbFxuICAgICAgICB9XG4gICAgfSlcbn1cblxuLyoqXG4gKiAgRGVmaW5lIGEgbWV0YSBwcm9wZXJ0eSwgZS5nLiAkaW5kZXggb3IgJGtleSxcbiAqICB3aGljaCBpcyBiaW5kYWJsZSBidXQgb25seSBhY2Nlc3NpYmxlIG9uIHRoZSBWTSxcbiAqICBub3QgaW4gdGhlIGRhdGEuXG4gKi9cbkNvbXBpbGVyUHJvdG8uZGVmaW5lTWV0YSA9IGZ1bmN0aW9uIChrZXksIGJpbmRpbmcpIHtcbiAgICB2YXIgdm0gPSB0aGlzLnZtLFxuICAgICAgICBvYiA9IHRoaXMub2JzZXJ2ZXIsXG4gICAgICAgIHZhbHVlID0gYmluZGluZy52YWx1ZSA9IHZtW2tleV0gfHwgdGhpcy5kYXRhW2tleV1cbiAgICAvLyByZW1vdmUgaW5pdGl0YWwgbWV0YSBpbiBkYXRhLCBzaW5jZSB0aGUgc2FtZSBwaWVjZVxuICAgIC8vIG9mIGRhdGEgY2FuIGJlIG9ic2VydmVkIGJ5IGRpZmZlcmVudCBWTXMsIGVhY2ggaGF2ZVxuICAgIC8vIGl0cyBvd24gYXNzb2NpYXRlZCBtZXRhIGluZm8uXG4gICAgZGVsZXRlIHRoaXMuZGF0YVtrZXldXG4gICAgZGVmR2V0U2V0KHZtLCBrZXksIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoT2JzZXJ2ZXIuc2hvdWxkR2V0KSBvYi5lbWl0KCdnZXQnLCBrZXkpXG4gICAgICAgICAgICByZXR1cm4gdmFsdWVcbiAgICAgICAgfSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbiAodmFsKSB7XG4gICAgICAgICAgICBvYi5lbWl0KCdzZXQnLCBrZXksIHZhbClcbiAgICAgICAgICAgIHZhbHVlID0gdmFsXG4gICAgICAgIH1cbiAgICB9KVxufVxuXG4vKipcbiAqICBEZWZpbmUgYW4gZXhwcmVzc2lvbiBiaW5kaW5nLCB3aGljaCBpcyBlc3NlbnRpYWxseVxuICogIGFuIGFub255bW91cyBjb21wdXRlZCBwcm9wZXJ0eVxuICovXG5Db21waWxlclByb3RvLmRlZmluZUV4cCA9IGZ1bmN0aW9uIChrZXksIGJpbmRpbmcpIHtcbiAgICB2YXIgZ2V0dGVyID0gRXhwUGFyc2VyLnBhcnNlKGtleSwgdGhpcylcbiAgICBpZiAoZ2V0dGVyKSB7XG4gICAgICAgIHRoaXMubWFya0NvbXB1dGVkKGJpbmRpbmcsIGdldHRlcilcbiAgICAgICAgdGhpcy5leHBzLnB1c2goYmluZGluZylcbiAgICB9XG59XG5cbi8qKlxuICogIERlZmluZSBhIGNvbXB1dGVkIHByb3BlcnR5IG9uIHRoZSBWTVxuICovXG5Db21waWxlclByb3RvLmRlZmluZUNvbXB1dGVkID0gZnVuY3Rpb24gKGtleSwgYmluZGluZywgdmFsdWUpIHtcbiAgICB0aGlzLm1hcmtDb21wdXRlZChiaW5kaW5nLCB2YWx1ZSlcbiAgICBkZWZHZXRTZXQodGhpcy52bSwga2V5LCB7XG4gICAgICAgIGdldDogYmluZGluZy52YWx1ZS4kZ2V0LFxuICAgICAgICBzZXQ6IGJpbmRpbmcudmFsdWUuJHNldFxuICAgIH0pXG59XG5cbi8qKlxuICogIFByb2Nlc3MgYSBjb21wdXRlZCBwcm9wZXJ0eSBiaW5kaW5nXG4gKiAgc28gaXRzIGdldHRlci9zZXR0ZXIgYXJlIGJvdW5kIHRvIHByb3BlciBjb250ZXh0XG4gKi9cbkNvbXBpbGVyUHJvdG8ubWFya0NvbXB1dGVkID0gZnVuY3Rpb24gKGJpbmRpbmcsIHZhbHVlKSB7XG4gICAgYmluZGluZy5pc0NvbXB1dGVkID0gdHJ1ZVxuICAgIC8vIGJpbmQgdGhlIGFjY2Vzc29ycyB0byB0aGUgdm1cbiAgICBpZiAoYmluZGluZy5pc0ZuKSB7XG4gICAgICAgIGJpbmRpbmcudmFsdWUgPSB2YWx1ZVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHZhbHVlID0geyAkZ2V0OiB2YWx1ZSB9XG4gICAgICAgIH1cbiAgICAgICAgYmluZGluZy52YWx1ZSA9IHtcbiAgICAgICAgICAgICRnZXQ6IHV0aWxzLmJpbmQodmFsdWUuJGdldCwgdGhpcy52bSksXG4gICAgICAgICAgICAkc2V0OiB2YWx1ZS4kc2V0XG4gICAgICAgICAgICAgICAgPyB1dGlscy5iaW5kKHZhbHVlLiRzZXQsIHRoaXMudm0pXG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgIH1cbiAgICAvLyBrZWVwIHRyYWNrIGZvciBkZXAgcGFyc2luZyBsYXRlclxuICAgIHRoaXMuY29tcHV0ZWQucHVzaChiaW5kaW5nKVxufVxuXG4vKipcbiAqICBSZXRyaXZlIGFuIG9wdGlvbiBmcm9tIHRoZSBjb21waWxlclxuICovXG5Db21waWxlclByb3RvLmdldE9wdGlvbiA9IGZ1bmN0aW9uICh0eXBlLCBpZCkge1xuICAgIHZhciBvcHRzID0gdGhpcy5vcHRpb25zLFxuICAgICAgICBwYXJlbnQgPSB0aGlzLnBhcmVudCxcbiAgICAgICAgZ2xvYmFsQXNzZXRzID0gY29uZmlnLmdsb2JhbEFzc2V0c1xuICAgIHJldHVybiAob3B0c1t0eXBlXSAmJiBvcHRzW3R5cGVdW2lkXSkgfHwgKFxuICAgICAgICBwYXJlbnRcbiAgICAgICAgICAgID8gcGFyZW50LmdldE9wdGlvbih0eXBlLCBpZClcbiAgICAgICAgICAgIDogZ2xvYmFsQXNzZXRzW3R5cGVdICYmIGdsb2JhbEFzc2V0c1t0eXBlXVtpZF1cbiAgICApXG59XG5cbi8qKlxuICogIEVtaXQgbGlmZWN5Y2xlIGV2ZW50cyB0byB0cmlnZ2VyIGhvb2tzXG4gKi9cbkNvbXBpbGVyUHJvdG8uZXhlY0hvb2sgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICBldmVudCA9ICdob29rOicgKyBldmVudFxuICAgIHRoaXMub2JzZXJ2ZXIuZW1pdChldmVudClcbiAgICB0aGlzLmVtaXR0ZXIuZW1pdChldmVudClcbn1cblxuLyoqXG4gKiAgQ2hlY2sgaWYgYSBjb21waWxlcidzIGRhdGEgY29udGFpbnMgYSBrZXlwYXRoXG4gKi9cbkNvbXBpbGVyUHJvdG8uaGFzS2V5ID0gZnVuY3Rpb24gKGtleSkge1xuICAgIHZhciBiYXNlS2V5ID0ga2V5LnNwbGl0KCcuJylbMF1cbiAgICByZXR1cm4gaGFzT3duLmNhbGwodGhpcy5kYXRhLCBiYXNlS2V5KSB8fFxuICAgICAgICBoYXNPd24uY2FsbCh0aGlzLnZtLCBiYXNlS2V5KVxufVxuXG4vKipcbiAqICBDb2xsZWN0IGRlcGVuZGVuY2llcyBmb3IgY29tcHV0ZWQgcHJvcGVydGllc1xuICovXG5Db21waWxlclByb3RvLnBhcnNlRGVwcyA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoIXRoaXMuY29tcHV0ZWQubGVuZ3RoKSByZXR1cm5cbiAgICBEZXBzUGFyc2VyLnBhcnNlKHRoaXMuY29tcHV0ZWQpXG59XG5cbi8qKlxuICogIEFkZCBhbiBldmVudCBkZWxlZ2F0aW9uIGxpc3RlbmVyXG4gKiAgbGlzdGVuZXJzIGFyZSBpbnN0YW5jZXMgb2YgZGlyZWN0aXZlcyB3aXRoIGBpc0ZuOnRydWVgXG4gKi9cbkNvbXBpbGVyUHJvdG8uYWRkTGlzdGVuZXIgPSBmdW5jdGlvbiAobGlzdGVuZXIpIHtcbiAgICB2YXIgZXZlbnQgPSBsaXN0ZW5lci5hcmcsXG4gICAgICAgIGRlbGVnYXRvciA9IHRoaXMuZGVsZWdhdG9yc1tldmVudF1cbiAgICBpZiAoIWRlbGVnYXRvcikge1xuICAgICAgICAvLyBpbml0aWFsaXplIGEgZGVsZWdhdG9yXG4gICAgICAgIGRlbGVnYXRvciA9IHRoaXMuZGVsZWdhdG9yc1tldmVudF0gPSB7XG4gICAgICAgICAgICB0YXJnZXRzOiBbXSxcbiAgICAgICAgICAgIGhhbmRsZXI6IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgICAgICAgICAgdmFyIGkgPSBkZWxlZ2F0b3IudGFyZ2V0cy5sZW5ndGgsXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldFxuICAgICAgICAgICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0ID0gZGVsZWdhdG9yLnRhcmdldHNbaV1cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldC5lbC5jb250YWlucyhlLnRhcmdldCkgJiYgdGFyZ2V0LmhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldC5oYW5kbGVyKGUpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5lbC5hZGRFdmVudExpc3RlbmVyKGV2ZW50LCBkZWxlZ2F0b3IuaGFuZGxlcilcbiAgICB9XG4gICAgZGVsZWdhdG9yLnRhcmdldHMucHVzaChsaXN0ZW5lcilcbn1cblxuLyoqXG4gKiAgUmVtb3ZlIGFuIGV2ZW50IGRlbGVnYXRpb24gbGlzdGVuZXJcbiAqL1xuQ29tcGlsZXJQcm90by5yZW1vdmVMaXN0ZW5lciA9IGZ1bmN0aW9uIChsaXN0ZW5lcikge1xuICAgIHZhciB0YXJnZXRzID0gdGhpcy5kZWxlZ2F0b3JzW2xpc3RlbmVyLmFyZ10udGFyZ2V0c1xuICAgIHRhcmdldHMuc3BsaWNlKHRhcmdldHMuaW5kZXhPZihsaXN0ZW5lciksIDEpXG59XG5cbi8qKlxuICogIFVuYmluZCBhbmQgcmVtb3ZlIGVsZW1lbnRcbiAqL1xuQ29tcGlsZXJQcm90by5kZXN0cm95ID0gZnVuY3Rpb24gKCkge1xuXG4gICAgLy8gYXZvaWQgYmVpbmcgY2FsbGVkIG1vcmUgdGhhbiBvbmNlXG4gICAgLy8gdGhpcyBpcyBpcnJldmVyc2libGUhXG4gICAgaWYgKHRoaXMuZGVzdHJveWVkKSByZXR1cm5cblxuICAgIHZhciBjb21waWxlciA9IHRoaXMsXG4gICAgICAgIGksIGtleSwgZGlyLCBkaXJzLCBiaW5kaW5nLFxuICAgICAgICB2bSAgICAgICAgICA9IGNvbXBpbGVyLnZtLFxuICAgICAgICBlbCAgICAgICAgICA9IGNvbXBpbGVyLmVsLFxuICAgICAgICBkaXJlY3RpdmVzICA9IGNvbXBpbGVyLmRpcnMsXG4gICAgICAgIGV4cHMgICAgICAgID0gY29tcGlsZXIuZXhwcyxcbiAgICAgICAgYmluZGluZ3MgICAgPSBjb21waWxlci5iaW5kaW5ncyxcbiAgICAgICAgZGVsZWdhdG9ycyAgPSBjb21waWxlci5kZWxlZ2F0b3JzLFxuICAgICAgICBjaGlsZHJlbiAgICA9IGNvbXBpbGVyLmNoaWxkcmVuLFxuICAgICAgICBwYXJlbnQgICAgICA9IGNvbXBpbGVyLnBhcmVudFxuXG4gICAgY29tcGlsZXIuZXhlY0hvb2soJ2JlZm9yZURlc3Ryb3knKVxuXG4gICAgLy8gdW5vYnNlcnZlIGRhdGFcbiAgICBPYnNlcnZlci51bm9ic2VydmUoY29tcGlsZXIuZGF0YSwgJycsIGNvbXBpbGVyLm9ic2VydmVyKVxuXG4gICAgLy8gdW5iaW5kIGFsbCBkaXJlY2l0dmVzXG4gICAgaSA9IGRpcmVjdGl2ZXMubGVuZ3RoXG4gICAgd2hpbGUgKGktLSkge1xuICAgICAgICBkaXIgPSBkaXJlY3RpdmVzW2ldXG4gICAgICAgIC8vIGlmIHRoaXMgZGlyZWN0aXZlIGlzIGFuIGluc3RhbmNlIG9mIGFuIGV4dGVybmFsIGJpbmRpbmdcbiAgICAgICAgLy8gZS5nLiBhIGRpcmVjdGl2ZSB0aGF0IHJlZmVycyB0byBhIHZhcmlhYmxlIG9uIHRoZSBwYXJlbnQgVk1cbiAgICAgICAgLy8gd2UgbmVlZCB0byByZW1vdmUgaXQgZnJvbSB0aGF0IGJpbmRpbmcncyBkaXJlY3RpdmVzXG4gICAgICAgIC8vICogZW1wdHkgYW5kIGxpdGVyYWwgYmluZGluZ3MgZG8gbm90IGhhdmUgYmluZGluZy5cbiAgICAgICAgaWYgKGRpci5iaW5kaW5nICYmIGRpci5iaW5kaW5nLmNvbXBpbGVyICE9PSBjb21waWxlcikge1xuICAgICAgICAgICAgZGlycyA9IGRpci5iaW5kaW5nLmRpcnNcbiAgICAgICAgICAgIGlmIChkaXJzKSBkaXJzLnNwbGljZShkaXJzLmluZGV4T2YoZGlyKSwgMSlcbiAgICAgICAgfVxuICAgICAgICBkaXIudW5iaW5kKClcbiAgICB9XG5cbiAgICAvLyB1bmJpbmQgYWxsIGV4cHJlc3Npb25zIChhbm9ueW1vdXMgYmluZGluZ3MpXG4gICAgaSA9IGV4cHMubGVuZ3RoXG4gICAgd2hpbGUgKGktLSkge1xuICAgICAgICBleHBzW2ldLnVuYmluZCgpXG4gICAgfVxuXG4gICAgLy8gdW5iaW5kIGFsbCBvd24gYmluZGluZ3NcbiAgICBmb3IgKGtleSBpbiBiaW5kaW5ncykge1xuICAgICAgICBiaW5kaW5nID0gYmluZGluZ3Nba2V5XVxuICAgICAgICBpZiAoYmluZGluZykge1xuICAgICAgICAgICAgYmluZGluZy51bmJpbmQoKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gcmVtb3ZlIGFsbCBldmVudCBkZWxlZ2F0b3JzXG4gICAgZm9yIChrZXkgaW4gZGVsZWdhdG9ycykge1xuICAgICAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKGtleSwgZGVsZWdhdG9yc1trZXldLmhhbmRsZXIpXG4gICAgfVxuXG4gICAgLy8gZGVzdHJveSBhbGwgY2hpbGRyZW5cbiAgICBpID0gY2hpbGRyZW4ubGVuZ3RoXG4gICAgd2hpbGUgKGktLSkge1xuICAgICAgICBjaGlsZHJlbltpXS5kZXN0cm95KClcbiAgICB9XG5cbiAgICAvLyByZW1vdmUgc2VsZiBmcm9tIHBhcmVudFxuICAgIGlmIChwYXJlbnQpIHtcbiAgICAgICAgcGFyZW50LmNoaWxkcmVuLnNwbGljZShwYXJlbnQuY2hpbGRyZW4uaW5kZXhPZihjb21waWxlciksIDEpXG4gICAgICAgIGlmIChjb21waWxlci5jaGlsZElkKSB7XG4gICAgICAgICAgICBkZWxldGUgcGFyZW50LnZtLiRbY29tcGlsZXIuY2hpbGRJZF1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGZpbmFsbHkgcmVtb3ZlIGRvbSBlbGVtZW50XG4gICAgaWYgKGVsID09PSBkb2N1bWVudC5ib2R5KSB7XG4gICAgICAgIGVsLmlubmVySFRNTCA9ICcnXG4gICAgfSBlbHNlIHtcbiAgICAgICAgdm0uJHJlbW92ZSgpXG4gICAgfVxuICAgIGVsLnZ1ZV92bSA9IG51bGxcblxuICAgIHRoaXMuZGVzdHJveWVkID0gdHJ1ZVxuICAgIC8vIGVtaXQgZGVzdHJveSBob29rXG4gICAgY29tcGlsZXIuZXhlY0hvb2soJ2FmdGVyRGVzdHJveScpXG5cbiAgICAvLyBmaW5hbGx5LCB1bnJlZ2lzdGVyIGFsbCBsaXN0ZW5lcnNcbiAgICBjb21waWxlci5vYnNlcnZlci5vZmYoKVxuICAgIGNvbXBpbGVyLmVtaXR0ZXIub2ZmKClcbn1cblxuLy8gSGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqICBzaG9ydGhhbmQgZm9yIGdldHRpbmcgcm9vdCBjb21waWxlclxuICovXG5mdW5jdGlvbiBnZXRSb290IChjb21waWxlcikge1xuICAgIHdoaWxlIChjb21waWxlci5wYXJlbnQpIHtcbiAgICAgICAgY29tcGlsZXIgPSBjb21waWxlci5wYXJlbnRcbiAgICB9XG4gICAgcmV0dXJuIGNvbXBpbGVyXG59XG5cbi8qKlxuICogIGZvciBjb252ZW5pZW5jZSAmIG1pbmlmaWNhdGlvblxuICovXG5mdW5jdGlvbiBkZWZHZXRTZXQgKG9iaiwga2V5LCBkZWYpIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIGRlZilcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBDb21waWxlciIsInZhciBwcmVmaXggPSAndicsXG4gICAgc3BlY2lhbEF0dHJpYnV0ZXMgPSBbXG4gICAgICAgICdwcmUnLFxuICAgICAgICAncmVmJyxcbiAgICAgICAgJ3dpdGgnLFxuICAgICAgICAndGV4dCcsXG4gICAgICAgICdyZXBlYXQnLFxuICAgICAgICAncGFydGlhbCcsXG4gICAgICAgICdjb21wb25lbnQnLFxuICAgICAgICAnYW5pbWF0aW9uJyxcbiAgICAgICAgJ3RyYW5zaXRpb24nLFxuICAgICAgICAnZWZmZWN0J1xuICAgIF0sXG4gICAgY29uZmlnID0gbW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICAgICAgZGVidWcgICAgICAgOiBmYWxzZSxcbiAgICAgICAgc2lsZW50ICAgICAgOiBmYWxzZSxcbiAgICAgICAgZW50ZXJDbGFzcyAgOiAndi1lbnRlcicsXG4gICAgICAgIGxlYXZlQ2xhc3MgIDogJ3YtbGVhdmUnLFxuICAgICAgICBpbnRlcnBvbGF0ZSA6IHRydWUsXG4gICAgICAgIGF0dHJzICAgICAgIDoge30sXG5cbiAgICAgICAgZ2V0IHByZWZpeCAoKSB7XG4gICAgICAgICAgICByZXR1cm4gcHJlZml4XG4gICAgICAgIH0sXG4gICAgICAgIHNldCBwcmVmaXggKHZhbCkge1xuICAgICAgICAgICAgcHJlZml4ID0gdmFsXG4gICAgICAgICAgICB1cGRhdGVQcmVmaXgoKVxuICAgICAgICB9XG4gICAgICAgIFxuICAgIH1cblxuZnVuY3Rpb24gdXBkYXRlUHJlZml4ICgpIHtcbiAgICBzcGVjaWFsQXR0cmlidXRlcy5mb3JFYWNoKGZ1bmN0aW9uIChhdHRyKSB7XG4gICAgICAgIGNvbmZpZy5hdHRyc1thdHRyXSA9IHByZWZpeCArICctJyArIGF0dHJcbiAgICB9KVxufVxuXG51cGRhdGVQcmVmaXgoKSIsInZhciBFbWl0dGVyICA9IHJlcXVpcmUoJy4vZW1pdHRlcicpLFxuICAgIHV0aWxzICAgID0gcmVxdWlyZSgnLi91dGlscycpLFxuICAgIE9ic2VydmVyID0gcmVxdWlyZSgnLi9vYnNlcnZlcicpLFxuICAgIGNhdGNoZXIgID0gbmV3IEVtaXR0ZXIoKVxuXG4vKipcbiAqICBBdXRvLWV4dHJhY3QgdGhlIGRlcGVuZGVuY2llcyBvZiBhIGNvbXB1dGVkIHByb3BlcnR5XG4gKiAgYnkgcmVjb3JkaW5nIHRoZSBnZXR0ZXJzIHRyaWdnZXJlZCB3aGVuIGV2YWx1YXRpbmcgaXQuXG4gKi9cbmZ1bmN0aW9uIGNhdGNoRGVwcyAoYmluZGluZykge1xuICAgIGlmIChiaW5kaW5nLmlzRm4pIHJldHVyblxuICAgIHV0aWxzLmxvZygnXFxuLSAnICsgYmluZGluZy5rZXkpXG4gICAgdmFyIGdvdCA9IHV0aWxzLmhhc2goKVxuICAgIGJpbmRpbmcuZGVwcyA9IFtdXG4gICAgY2F0Y2hlci5vbignZ2V0JywgZnVuY3Rpb24gKGRlcCkge1xuICAgICAgICB2YXIgaGFzID0gZ290W2RlcC5rZXldXG4gICAgICAgIGlmIChoYXMgJiYgaGFzLmNvbXBpbGVyID09PSBkZXAuY29tcGlsZXIpIHJldHVyblxuICAgICAgICBnb3RbZGVwLmtleV0gPSBkZXBcbiAgICAgICAgdXRpbHMubG9nKCcgIC0gJyArIGRlcC5rZXkpXG4gICAgICAgIGJpbmRpbmcuZGVwcy5wdXNoKGRlcClcbiAgICAgICAgZGVwLnN1YnMucHVzaChiaW5kaW5nKVxuICAgIH0pXG4gICAgYmluZGluZy52YWx1ZS4kZ2V0KClcbiAgICBjYXRjaGVyLm9mZignZ2V0Jylcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICAvKipcbiAgICAgKiAgdGhlIG9ic2VydmVyIHRoYXQgY2F0Y2hlcyBldmVudHMgdHJpZ2dlcmVkIGJ5IGdldHRlcnNcbiAgICAgKi9cbiAgICBjYXRjaGVyOiBjYXRjaGVyLFxuXG4gICAgLyoqXG4gICAgICogIHBhcnNlIGEgbGlzdCBvZiBjb21wdXRlZCBwcm9wZXJ0eSBiaW5kaW5nc1xuICAgICAqL1xuICAgIHBhcnNlOiBmdW5jdGlvbiAoYmluZGluZ3MpIHtcbiAgICAgICAgdXRpbHMubG9nKCdcXG5wYXJzaW5nIGRlcGVuZGVuY2llcy4uLicpXG4gICAgICAgIE9ic2VydmVyLnNob3VsZEdldCA9IHRydWVcbiAgICAgICAgYmluZGluZ3MuZm9yRWFjaChjYXRjaERlcHMpXG4gICAgICAgIE9ic2VydmVyLnNob3VsZEdldCA9IGZhbHNlXG4gICAgICAgIHV0aWxzLmxvZygnXFxuZG9uZS4nKVxuICAgIH1cbiAgICBcbn0iLCJ2YXIgdXRpbHMgICAgICA9IHJlcXVpcmUoJy4vdXRpbHMnKSxcbiAgICBkaXJlY3RpdmVzID0gcmVxdWlyZSgnLi9kaXJlY3RpdmVzJyksXG4gICAgZmlsdGVycyAgICA9IHJlcXVpcmUoJy4vZmlsdGVycycpLFxuXG4gICAgLy8gUmVnZXhlcyFcblxuICAgIC8vIHJlZ2V4IHRvIHNwbGl0IG11bHRpcGxlIGRpcmVjdGl2ZSBleHByZXNzaW9uc1xuICAgIC8vIHNwbGl0IGJ5IGNvbW1hcywgYnV0IGlnbm9yZSBjb21tYXMgd2l0aGluIHF1b3RlcywgcGFyZW5zIGFuZCBlc2NhcGVzLlxuICAgIFNQTElUX1JFICAgICAgICA9IC8oPzpbJ1wiXSg/OlxcXFwufFteJ1wiXSkqWydcIl18XFwoKD86XFxcXC58W15cXCldKSpcXCl8XFxcXC58W14sXSkrL2csXG5cbiAgICAvLyBtYXRjaCB1cCB0byB0aGUgZmlyc3Qgc2luZ2xlIHBpcGUsIGlnbm9yZSB0aG9zZSB3aXRoaW4gcXVvdGVzLlxuICAgIEtFWV9SRSAgICAgICAgICA9IC9eKD86WydcIl0oPzpcXFxcLnxbXidcIl0pKlsnXCJdfFxcXFwufFteXFx8XXxcXHxcXHwpKy8sXG5cbiAgICBBUkdfUkUgICAgICAgICAgPSAvXihbXFx3LSQgXSspOiguKykkLyxcbiAgICBGSUxURVJTX1JFICAgICAgPSAvXFx8W15cXHxdKy9nLFxuICAgIEZJTFRFUl9UT0tFTl9SRSA9IC9bXlxccyddK3wnW14nXSsnL2csXG4gICAgTkVTVElOR19SRSAgICAgID0gL15cXCQocGFyZW50fHJvb3QpXFwuLyxcbiAgICBTSU5HTEVfVkFSX1JFICAgPSAvXltcXHdcXC4kXSskL1xuXG4vKipcbiAqICBEaXJlY3RpdmUgY2xhc3NcbiAqICByZXByZXNlbnRzIGEgc2luZ2xlIGRpcmVjdGl2ZSBpbnN0YW5jZSBpbiB0aGUgRE9NXG4gKi9cbmZ1bmN0aW9uIERpcmVjdGl2ZSAoZGVmaW5pdGlvbiwgZXhwcmVzc2lvbiwgcmF3S2V5LCBjb21waWxlciwgbm9kZSkge1xuXG4gICAgdGhpcy5jb21waWxlciA9IGNvbXBpbGVyXG4gICAgdGhpcy52bSAgICAgICA9IGNvbXBpbGVyLnZtXG4gICAgdGhpcy5lbCAgICAgICA9IG5vZGVcblxuICAgIHZhciBpc0VtcHR5ICAgPSBleHByZXNzaW9uID09PSAnJ1xuXG4gICAgLy8gbWl4IGluIHByb3BlcnRpZXMgZnJvbSB0aGUgZGlyZWN0aXZlIGRlZmluaXRpb25cbiAgICBpZiAodHlwZW9mIGRlZmluaXRpb24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdGhpc1tpc0VtcHR5ID8gJ2JpbmQnIDogJ191cGRhdGUnXSA9IGRlZmluaXRpb25cbiAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKHZhciBwcm9wIGluIGRlZmluaXRpb24pIHtcbiAgICAgICAgICAgIGlmIChwcm9wID09PSAndW5iaW5kJyB8fCBwcm9wID09PSAndXBkYXRlJykge1xuICAgICAgICAgICAgICAgIHRoaXNbJ18nICsgcHJvcF0gPSBkZWZpbml0aW9uW3Byb3BdXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXNbcHJvcF0gPSBkZWZpbml0aW9uW3Byb3BdXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBlbXB0eSBleHByZXNzaW9uLCB3ZSdyZSBkb25lLlxuICAgIGlmIChpc0VtcHR5IHx8IHRoaXMuaXNFbXB0eSkge1xuICAgICAgICB0aGlzLmlzRW1wdHkgPSB0cnVlXG4gICAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuZXhwcmVzc2lvbiA9IGV4cHJlc3Npb24udHJpbSgpXG4gICAgdGhpcy5yYXdLZXkgICAgID0gcmF3S2V5XG4gICAgXG4gICAgcGFyc2VLZXkodGhpcywgcmF3S2V5KVxuXG4gICAgdGhpcy5pc0V4cCA9ICFTSU5HTEVfVkFSX1JFLnRlc3QodGhpcy5rZXkpIHx8IE5FU1RJTkdfUkUudGVzdCh0aGlzLmtleSlcbiAgICBcbiAgICB2YXIgZmlsdGVyRXhwcyA9IHRoaXMuZXhwcmVzc2lvbi5zbGljZShyYXdLZXkubGVuZ3RoKS5tYXRjaChGSUxURVJTX1JFKVxuICAgIGlmIChmaWx0ZXJFeHBzKSB7XG4gICAgICAgIHRoaXMuZmlsdGVycyA9IFtdXG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBsID0gZmlsdGVyRXhwcy5sZW5ndGgsIGZpbHRlcjsgaSA8IGw7IGkrKykge1xuICAgICAgICAgICAgZmlsdGVyID0gcGFyc2VGaWx0ZXIoZmlsdGVyRXhwc1tpXSwgdGhpcy5jb21waWxlcilcbiAgICAgICAgICAgIGlmIChmaWx0ZXIpIHRoaXMuZmlsdGVycy5wdXNoKGZpbHRlcilcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsdGVycy5sZW5ndGgpIHRoaXMuZmlsdGVycyA9IG51bGxcbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmZpbHRlcnMgPSBudWxsXG4gICAgfVxufVxuXG52YXIgRGlyUHJvdG8gPSBEaXJlY3RpdmUucHJvdG90eXBlXG5cbi8qKlxuICogIHBhcnNlIGEga2V5LCBleHRyYWN0IGFyZ3VtZW50IGFuZCBuZXN0aW5nL3Jvb3QgaW5mb1xuICovXG5mdW5jdGlvbiBwYXJzZUtleSAoZGlyLCByYXdLZXkpIHtcbiAgICB2YXIga2V5ID0gcmF3S2V5XG4gICAgaWYgKHJhd0tleS5pbmRleE9mKCc6JykgPiAtMSkge1xuICAgICAgICB2YXIgYXJnTWF0Y2ggPSByYXdLZXkubWF0Y2goQVJHX1JFKVxuICAgICAgICBrZXkgPSBhcmdNYXRjaFxuICAgICAgICAgICAgPyBhcmdNYXRjaFsyXS50cmltKClcbiAgICAgICAgICAgIDoga2V5XG4gICAgICAgIGRpci5hcmcgPSBhcmdNYXRjaFxuICAgICAgICAgICAgPyBhcmdNYXRjaFsxXS50cmltKClcbiAgICAgICAgICAgIDogbnVsbFxuICAgIH1cbiAgICBkaXIua2V5ID0ga2V5XG59XG5cbi8qKlxuICogIHBhcnNlIGEgZmlsdGVyIGV4cHJlc3Npb25cbiAqL1xuZnVuY3Rpb24gcGFyc2VGaWx0ZXIgKGZpbHRlciwgY29tcGlsZXIpIHtcblxuICAgIHZhciB0b2tlbnMgPSBmaWx0ZXIuc2xpY2UoMSkubWF0Y2goRklMVEVSX1RPS0VOX1JFKVxuICAgIGlmICghdG9rZW5zKSByZXR1cm5cbiAgICB0b2tlbnMgPSB0b2tlbnMubWFwKGZ1bmN0aW9uICh0b2tlbikge1xuICAgICAgICByZXR1cm4gdG9rZW4ucmVwbGFjZSgvJy9nLCAnJykudHJpbSgpXG4gICAgfSlcblxuICAgIHZhciBuYW1lID0gdG9rZW5zWzBdLFxuICAgICAgICBhcHBseSA9IGNvbXBpbGVyLmdldE9wdGlvbignZmlsdGVycycsIG5hbWUpIHx8IGZpbHRlcnNbbmFtZV1cbiAgICBpZiAoIWFwcGx5KSB7XG4gICAgICAgIHV0aWxzLndhcm4oJ1Vua25vd24gZmlsdGVyOiAnICsgbmFtZSlcbiAgICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZSAgOiBuYW1lLFxuICAgICAgICBhcHBseSA6IGFwcGx5LFxuICAgICAgICBhcmdzICA6IHRva2Vucy5sZW5ndGggPiAxXG4gICAgICAgICAgICAgICAgPyB0b2tlbnMuc2xpY2UoMSlcbiAgICAgICAgICAgICAgICA6IG51bGxcbiAgICB9XG59XG5cbi8qKlxuICogIGNhbGxlZCB3aGVuIGEgbmV3IHZhbHVlIGlzIHNldCBcbiAqICBmb3IgY29tcHV0ZWQgcHJvcGVydGllcywgdGhpcyB3aWxsIG9ubHkgYmUgY2FsbGVkIG9uY2VcbiAqICBkdXJpbmcgaW5pdGlhbGl6YXRpb24uXG4gKi9cbkRpclByb3RvLnVwZGF0ZSA9IGZ1bmN0aW9uICh2YWx1ZSwgaW5pdCkge1xuICAgIHZhciB0eXBlID0gdXRpbHMudHlwZU9mKHZhbHVlKVxuICAgIGlmIChpbml0IHx8IHZhbHVlICE9PSB0aGlzLnZhbHVlIHx8IHR5cGUgPT09ICdPYmplY3QnIHx8IHR5cGUgPT09ICdBcnJheScpIHtcbiAgICAgICAgdGhpcy52YWx1ZSA9IHZhbHVlXG4gICAgICAgIGlmICh0aGlzLl91cGRhdGUpIHtcbiAgICAgICAgICAgIHRoaXMuX3VwZGF0ZShcbiAgICAgICAgICAgICAgICB0aGlzLmZpbHRlcnNcbiAgICAgICAgICAgICAgICAgICAgPyB0aGlzLmFwcGx5RmlsdGVycyh2YWx1ZSlcbiAgICAgICAgICAgICAgICAgICAgOiB2YWx1ZSxcbiAgICAgICAgICAgICAgICBpbml0XG4gICAgICAgICAgICApXG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qKlxuICogIHBpcGUgdGhlIHZhbHVlIHRocm91Z2ggZmlsdGVyc1xuICovXG5EaXJQcm90by5hcHBseUZpbHRlcnMgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICB2YXIgZmlsdGVyZWQgPSB2YWx1ZSwgZmlsdGVyXG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSB0aGlzLmZpbHRlcnMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIGZpbHRlciA9IHRoaXMuZmlsdGVyc1tpXVxuICAgICAgICBmaWx0ZXJlZCA9IGZpbHRlci5hcHBseS5jYWxsKHRoaXMudm0sIGZpbHRlcmVkLCBmaWx0ZXIuYXJncylcbiAgICB9XG4gICAgcmV0dXJuIGZpbHRlcmVkXG59XG5cbi8qKlxuICogIFVuYmluZCBkaXJldGl2ZVxuICovXG5EaXJQcm90by51bmJpbmQgPSBmdW5jdGlvbiAoKSB7XG4gICAgLy8gdGhpcyBjYW4gYmUgY2FsbGVkIGJlZm9yZSB0aGUgZWwgaXMgZXZlbiBhc3NpZ25lZC4uLlxuICAgIGlmICghdGhpcy5lbCB8fCAhdGhpcy52bSkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX3VuYmluZCkgdGhpcy5fdW5iaW5kKClcbiAgICB0aGlzLnZtID0gdGhpcy5lbCA9IHRoaXMuYmluZGluZyA9IHRoaXMuY29tcGlsZXIgPSBudWxsXG59XG5cbi8vIGV4cG9zZWQgbWV0aG9kcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiAgc3BsaXQgYSB1bnF1b3RlZC1jb21tYSBzZXBhcmF0ZWQgZXhwcmVzc2lvbiBpbnRvXG4gKiAgbXVsdGlwbGUgY2xhdXNlc1xuICovXG5EaXJlY3RpdmUuc3BsaXQgPSBmdW5jdGlvbiAoZXhwKSB7XG4gICAgcmV0dXJuIGV4cC5pbmRleE9mKCcsJykgPiAtMVxuICAgICAgICA/IGV4cC5tYXRjaChTUExJVF9SRSkgfHwgWycnXVxuICAgICAgICA6IFtleHBdXG59XG5cbi8qKlxuICogIG1ha2Ugc3VyZSB0aGUgZGlyZWN0aXZlIGFuZCBleHByZXNzaW9uIGlzIHZhbGlkXG4gKiAgYmVmb3JlIHdlIGNyZWF0ZSBhbiBpbnN0YW5jZVxuICovXG5EaXJlY3RpdmUucGFyc2UgPSBmdW5jdGlvbiAoZGlybmFtZSwgZXhwcmVzc2lvbiwgY29tcGlsZXIsIG5vZGUpIHtcblxuICAgIHZhciBkaXIgPSBjb21waWxlci5nZXRPcHRpb24oJ2RpcmVjdGl2ZXMnLCBkaXJuYW1lKSB8fCBkaXJlY3RpdmVzW2Rpcm5hbWVdXG4gICAgaWYgKCFkaXIpIHJldHVybiB1dGlscy53YXJuKCd1bmtub3duIGRpcmVjdGl2ZTogJyArIGRpcm5hbWUpXG5cbiAgICB2YXIgcmF3S2V5XG4gICAgaWYgKGV4cHJlc3Npb24uaW5kZXhPZignfCcpID4gLTEpIHtcbiAgICAgICAgdmFyIGtleU1hdGNoID0gZXhwcmVzc2lvbi5tYXRjaChLRVlfUkUpXG4gICAgICAgIGlmIChrZXlNYXRjaCkge1xuICAgICAgICAgICAgcmF3S2V5ID0ga2V5TWF0Y2hbMF0udHJpbSgpXG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICByYXdLZXkgPSBleHByZXNzaW9uLnRyaW0oKVxuICAgIH1cbiAgICBcbiAgICAvLyBoYXZlIGEgdmFsaWQgcmF3IGtleSwgb3IgYmUgYW4gZW1wdHkgZGlyZWN0aXZlXG4gICAgcmV0dXJuIChyYXdLZXkgfHwgZXhwcmVzc2lvbiA9PT0gJycpXG4gICAgICAgID8gbmV3IERpcmVjdGl2ZShkaXIsIGV4cHJlc3Npb24sIHJhd0tleSwgY29tcGlsZXIsIG5vZGUpXG4gICAgICAgIDogdXRpbHMud2FybignaW52YWxpZCBkaXJlY3RpdmUgZXhwcmVzc2lvbjogJyArIGV4cHJlc3Npb24pXG59XG5cbm1vZHVsZS5leHBvcnRzID0gRGlyZWN0aXZlIiwidmFyIHRvVGV4dCA9IHJlcXVpcmUoJy4uL3V0aWxzJykudG9UZXh0LFxuICAgIHNsaWNlID0gW10uc2xpY2VcblxubW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICBiaW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIGEgY29tbWVudCBub2RlIG1lYW5zIHRoaXMgaXMgYSBiaW5kaW5nIGZvclxuICAgICAgICAvLyB7e3sgaW5saW5lIHVuZXNjYXBlZCBodG1sIH19fVxuICAgICAgICBpZiAodGhpcy5lbC5ub2RlVHlwZSA9PT0gOCkge1xuICAgICAgICAgICAgLy8gaG9sZCBub2Rlc1xuICAgICAgICAgICAgdGhpcy5ob2xkZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKVxuICAgICAgICAgICAgdGhpcy5ub2RlcyA9IFtdXG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgdmFsdWUgPSB0b1RleHQodmFsdWUpXG4gICAgICAgIGlmICh0aGlzLmhvbGRlcikge1xuICAgICAgICAgICAgdGhpcy5zd2FwKHZhbHVlKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5lbC5pbm5lckhUTUwgPSB2YWx1ZVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIHN3YXA6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICB2YXIgcGFyZW50ID0gdGhpcy5lbC5wYXJlbnROb2RlLFxuICAgICAgICAgICAgaG9sZGVyID0gdGhpcy5ob2xkZXIsXG4gICAgICAgICAgICBub2RlcyA9IHRoaXMubm9kZXMsXG4gICAgICAgICAgICBpID0gbm9kZXMubGVuZ3RoLCBsXG4gICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgIHBhcmVudC5yZW1vdmVDaGlsZChub2Rlc1tpXSlcbiAgICAgICAgfVxuICAgICAgICBob2xkZXIuaW5uZXJIVE1MID0gdmFsdWVcbiAgICAgICAgbm9kZXMgPSB0aGlzLm5vZGVzID0gc2xpY2UuY2FsbChob2xkZXIuY2hpbGROb2RlcylcbiAgICAgICAgZm9yIChpID0gMCwgbCA9IG5vZGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICAgICAgcGFyZW50Lmluc2VydEJlZm9yZShub2Rlc1tpXSwgdGhpcy5lbClcbiAgICAgICAgfVxuICAgIH1cbn0iLCJ2YXIgY29uZmlnID0gcmVxdWlyZSgnLi4vY29uZmlnJyksXG4gICAgdHJhbnNpdGlvbiA9IHJlcXVpcmUoJy4uL3RyYW5zaXRpb24nKVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcblxuICAgIGJpbmQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5wYXJlbnQgPSB0aGlzLmVsLnBhcmVudE5vZGUgfHwgdGhpcy5lbC52dWVfaWZfcGFyZW50XG4gICAgICAgIHRoaXMucmVmID0gZG9jdW1lbnQuY3JlYXRlQ29tbWVudChjb25maWcucHJlZml4ICsgJy1pZi0nICsgdGhpcy5rZXkpXG4gICAgICAgIHZhciBkZXRhY2hlZFJlZiA9IHRoaXMuZWwudnVlX2lmX3JlZlxuICAgICAgICBpZiAoZGV0YWNoZWRSZWYpIHtcbiAgICAgICAgICAgIHRoaXMucGFyZW50Lmluc2VydEJlZm9yZSh0aGlzLnJlZiwgZGV0YWNoZWRSZWYpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5lbC52dWVfaWZfcmVmID0gdGhpcy5yZWZcbiAgICB9LFxuXG4gICAgdXBkYXRlOiBmdW5jdGlvbiAodmFsdWUpIHtcblxuICAgICAgICB2YXIgZWwgPSB0aGlzLmVsXG5cbiAgICAgICAgLy8gc29tZXRpbWVzIHdlIG5lZWQgdG8gY3JlYXRlIGEgVk0gb24gYSBkZXRhY2hlZCBub2RlLFxuICAgICAgICAvLyBlLmcuIGluIHYtcmVwZWF0LiBJbiB0aGF0IGNhc2UsIHN0b3JlIHRoZSBkZXNpcmVkIHYtaWZcbiAgICAgICAgLy8gc3RhdGUgb24gdGhlIG5vZGUgaXRzZWxmIHNvIHdlIGNhbiBkZWFsIHdpdGggaXQgZWxzZXdoZXJlLlxuICAgICAgICBlbC52dWVfaWYgPSAhIXZhbHVlXG5cbiAgICAgICAgdmFyIHBhcmVudCAgID0gdGhpcy5wYXJlbnQsXG4gICAgICAgICAgICByZWYgICAgICA9IHRoaXMucmVmLFxuICAgICAgICAgICAgY29tcGlsZXIgPSB0aGlzLmNvbXBpbGVyXG5cbiAgICAgICAgaWYgKCFwYXJlbnQpIHtcbiAgICAgICAgICAgIGlmICghZWwucGFyZW50Tm9kZSkge1xuICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBwYXJlbnQgPSB0aGlzLnBhcmVudCA9IGVsLnBhcmVudE5vZGVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgICAgIHRyYW5zaXRpb24oZWwsIC0xLCByZW1vdmUsIGNvbXBpbGVyKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdHJhbnNpdGlvbihlbCwgMSwgaW5zZXJ0LCBjb21waWxlcilcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIHJlbW92ZSAoKSB7XG4gICAgICAgICAgICBpZiAoIWVsLnBhcmVudE5vZGUpIHJldHVyblxuICAgICAgICAgICAgLy8gaW5zZXJ0IHRoZSByZWZlcmVuY2Ugbm9kZVxuICAgICAgICAgICAgdmFyIG5leHQgPSBlbC5uZXh0U2libGluZ1xuICAgICAgICAgICAgaWYgKG5leHQpIHtcbiAgICAgICAgICAgICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKHJlZiwgbmV4dClcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcGFyZW50LmFwcGVuZENoaWxkKHJlZilcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBhcmVudC5yZW1vdmVDaGlsZChlbClcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIGluc2VydCAoKSB7XG4gICAgICAgICAgICBpZiAoZWwucGFyZW50Tm9kZSkgcmV0dXJuXG4gICAgICAgICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKGVsLCByZWYpXG4gICAgICAgICAgICBwYXJlbnQucmVtb3ZlQ2hpbGQocmVmKVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIHVuYmluZDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmVsLnZ1ZV9pZl9yZWYgPSB0aGlzLmVsLnZ1ZV9pZl9wYXJlbnQgPSBudWxsXG4gICAgICAgIHZhciByZWYgPSB0aGlzLnJlZlxuICAgICAgICBpZiAocmVmLnBhcmVudE5vZGUpIHtcbiAgICAgICAgICAgIHJlZi5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHJlZilcbiAgICAgICAgfVxuICAgIH1cbn0iLCJ2YXIgdXRpbHMgICAgICA9IHJlcXVpcmUoJy4uL3V0aWxzJyksXG4gICAgY29uZmlnICAgICA9IHJlcXVpcmUoJy4uL2NvbmZpZycpLFxuICAgIHRyYW5zaXRpb24gPSByZXF1aXJlKCcuLi90cmFuc2l0aW9uJylcblxubW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICBvbiAgICAgICAgOiByZXF1aXJlKCcuL29uJyksXG4gICAgcmVwZWF0ICAgIDogcmVxdWlyZSgnLi9yZXBlYXQnKSxcbiAgICBtb2RlbCAgICAgOiByZXF1aXJlKCcuL21vZGVsJyksXG4gICAgJ2lmJyAgICAgIDogcmVxdWlyZSgnLi9pZicpLFxuICAgICd3aXRoJyAgICA6IHJlcXVpcmUoJy4vd2l0aCcpLFxuICAgIGh0bWwgICAgICA6IHJlcXVpcmUoJy4vaHRtbCcpLFxuICAgIHN0eWxlICAgICA6IHJlcXVpcmUoJy4vc3R5bGUnKSxcblxuICAgIGF0dHI6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICBpZiAodmFsdWUgfHwgdmFsdWUgPT09IDApIHtcbiAgICAgICAgICAgIHRoaXMuZWwuc2V0QXR0cmlidXRlKHRoaXMuYXJnLCB2YWx1ZSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuZWwucmVtb3ZlQXR0cmlidXRlKHRoaXMuYXJnKVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIHRleHQ6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICB0aGlzLmVsLnRleHRDb250ZW50ID0gdXRpbHMudG9UZXh0KHZhbHVlKVxuICAgIH0sXG5cbiAgICBzaG93OiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgdmFyIGVsID0gdGhpcy5lbCxcbiAgICAgICAgICAgIHRhcmdldCA9IHZhbHVlID8gJycgOiAnbm9uZScsXG4gICAgICAgICAgICBjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgZWwuc3R5bGUuZGlzcGxheSA9IHRhcmdldFxuICAgICAgICAgICAgfVxuICAgICAgICB0cmFuc2l0aW9uKGVsLCB2YWx1ZSA/IDEgOiAtMSwgY2hhbmdlLCB0aGlzLmNvbXBpbGVyKVxuICAgIH0sXG5cbiAgICAnY2xhc3MnOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgaWYgKHRoaXMuYXJnKSB7XG4gICAgICAgICAgICB1dGlsc1t2YWx1ZSA/ICdhZGRDbGFzcycgOiAncmVtb3ZlQ2xhc3MnXSh0aGlzLmVsLCB0aGlzLmFyZylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmxhc3RWYWwpIHtcbiAgICAgICAgICAgICAgICB1dGlscy5yZW1vdmVDbGFzcyh0aGlzLmVsLCB0aGlzLmxhc3RWYWwpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICB1dGlscy5hZGRDbGFzcyh0aGlzLmVsLCB2YWx1ZSlcbiAgICAgICAgICAgICAgICB0aGlzLmxhc3RWYWwgPSB2YWx1ZVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIGNsb2FrOiB7XG4gICAgICAgIGlzRW1wdHk6IHRydWUsXG4gICAgICAgIGJpbmQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBlbCA9IHRoaXMuZWxcbiAgICAgICAgICAgIHRoaXMuY29tcGlsZXIub2JzZXJ2ZXIub25jZSgnaG9vazpyZWFkeScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBlbC5yZW1vdmVBdHRyaWJ1dGUoY29uZmlnLnByZWZpeCArICctY2xvYWsnKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cblxufSIsInZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyksXG4gICAgaXNJRTkgPSBuYXZpZ2F0b3IudXNlckFnZW50LmluZGV4T2YoJ01TSUUgOS4wJykgPiAwLFxuICAgIGZpbHRlciA9IFtdLmZpbHRlclxuXG4vKipcbiAqICBSZXR1cm5zIGFuIGFycmF5IG9mIHZhbHVlcyBmcm9tIGEgbXVsdGlwbGUgc2VsZWN0XG4gKi9cbmZ1bmN0aW9uIGdldE11bHRpcGxlU2VsZWN0T3B0aW9ucyAoc2VsZWN0KSB7XG4gICAgcmV0dXJuIGZpbHRlclxuICAgICAgICAuY2FsbChzZWxlY3Qub3B0aW9ucywgZnVuY3Rpb24gKG9wdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIG9wdGlvbi5zZWxlY3RlZFxuICAgICAgICB9KVxuICAgICAgICAubWFwKGZ1bmN0aW9uIChvcHRpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBvcHRpb24udmFsdWUgfHwgb3B0aW9uLnRleHRcbiAgICAgICAgfSlcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICBiaW5kOiBmdW5jdGlvbiAoKSB7XG5cbiAgICAgICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICAgICAgZWwgICA9IHNlbGYuZWwsXG4gICAgICAgICAgICB0eXBlID0gZWwudHlwZSxcbiAgICAgICAgICAgIHRhZyAgPSBlbC50YWdOYW1lXG5cbiAgICAgICAgc2VsZi5sb2NrID0gZmFsc2VcbiAgICAgICAgc2VsZi5vd25lclZNID0gc2VsZi5iaW5kaW5nLmNvbXBpbGVyLnZtXG5cbiAgICAgICAgLy8gZGV0ZXJtaW5lIHdoYXQgZXZlbnQgdG8gbGlzdGVuIHRvXG4gICAgICAgIHNlbGYuZXZlbnQgPVxuICAgICAgICAgICAgKHNlbGYuY29tcGlsZXIub3B0aW9ucy5sYXp5IHx8XG4gICAgICAgICAgICB0YWcgPT09ICdTRUxFQ1QnIHx8XG4gICAgICAgICAgICB0eXBlID09PSAnY2hlY2tib3gnIHx8IHR5cGUgPT09ICdyYWRpbycpXG4gICAgICAgICAgICAgICAgPyAnY2hhbmdlJ1xuICAgICAgICAgICAgICAgIDogJ2lucHV0J1xuXG4gICAgICAgIC8vIGRldGVybWluZSB0aGUgYXR0cmlidXRlIHRvIGNoYW5nZSB3aGVuIHVwZGF0aW5nXG4gICAgICAgIHNlbGYuYXR0ciA9IHR5cGUgPT09ICdjaGVja2JveCdcbiAgICAgICAgICAgID8gJ2NoZWNrZWQnXG4gICAgICAgICAgICA6ICh0YWcgPT09ICdJTlBVVCcgfHwgdGFnID09PSAnU0VMRUNUJyB8fCB0YWcgPT09ICdURVhUQVJFQScpXG4gICAgICAgICAgICAgICAgPyAndmFsdWUnXG4gICAgICAgICAgICAgICAgOiAnaW5uZXJIVE1MJ1xuXG4gICAgICAgIC8vIHNlbGVjdFttdWx0aXBsZV0gc3VwcG9ydFxuICAgICAgICBpZih0YWcgPT09ICdTRUxFQ1QnICYmIGVsLmhhc0F0dHJpYnV0ZSgnbXVsdGlwbGUnKSkge1xuICAgICAgICAgICAgdGhpcy5tdWx0aSA9IHRydWVcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBjb21wb3NpdGlvbkxvY2sgPSBmYWxzZVxuICAgICAgICBzZWxmLmNMb2NrID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgY29tcG9zaXRpb25Mb2NrID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICAgIHNlbGYuY1VubG9jayA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGNvbXBvc2l0aW9uTG9jayA9IGZhbHNlXG4gICAgICAgIH1cbiAgICAgICAgZWwuYWRkRXZlbnRMaXN0ZW5lcignY29tcG9zaXRpb25zdGFydCcsIHRoaXMuY0xvY2spXG4gICAgICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ2NvbXBvc2l0aW9uZW5kJywgdGhpcy5jVW5sb2NrKVxuXG4gICAgICAgIC8vIGF0dGFjaCBsaXN0ZW5lclxuICAgICAgICBzZWxmLnNldCA9IHNlbGYuZmlsdGVyc1xuICAgICAgICAgICAgPyBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNvbXBvc2l0aW9uTG9jaykgcmV0dXJuXG4gICAgICAgICAgICAgICAgLy8gaWYgdGhpcyBkaXJlY3RpdmUgaGFzIGZpbHRlcnNcbiAgICAgICAgICAgICAgICAvLyB3ZSBuZWVkIHRvIGxldCB0aGUgdm0uJHNldCB0cmlnZ2VyXG4gICAgICAgICAgICAgICAgLy8gdXBkYXRlKCkgc28gZmlsdGVycyBhcmUgYXBwbGllZC5cbiAgICAgICAgICAgICAgICAvLyB0aGVyZWZvcmUgd2UgaGF2ZSB0byByZWNvcmQgY3Vyc29yIHBvc2l0aW9uXG4gICAgICAgICAgICAgICAgLy8gc28gdGhhdCBhZnRlciB2bS4kc2V0IGNoYW5nZXMgdGhlIGlucHV0XG4gICAgICAgICAgICAgICAgLy8gdmFsdWUgd2UgY2FuIHB1dCB0aGUgY3Vyc29yIGJhY2sgYXQgd2hlcmUgaXQgaXNcbiAgICAgICAgICAgICAgICB2YXIgY3Vyc29yUG9zXG4gICAgICAgICAgICAgICAgdHJ5IHsgY3Vyc29yUG9zID0gZWwuc2VsZWN0aW9uU3RhcnQgfSBjYXRjaCAoZSkge31cblxuICAgICAgICAgICAgICAgIHNlbGYuX3NldCgpXG5cbiAgICAgICAgICAgICAgICAvLyBzaW5jZSB1cGRhdGVzIGFyZSBhc3luY1xuICAgICAgICAgICAgICAgIC8vIHdlIG5lZWQgdG8gcmVzZXQgY3Vyc29yIHBvc2l0aW9uIGFzeW5jIHRvb1xuICAgICAgICAgICAgICAgIHV0aWxzLm5leHRUaWNrKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnNvclBvcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbC5zZXRTZWxlY3Rpb25SYW5nZShjdXJzb3JQb3MsIGN1cnNvclBvcylcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBpZiAoY29tcG9zaXRpb25Mb2NrKSByZXR1cm5cbiAgICAgICAgICAgICAgICAvLyBubyBmaWx0ZXJzLCBkb24ndCBsZXQgaXQgdHJpZ2dlciB1cGRhdGUoKVxuICAgICAgICAgICAgICAgIHNlbGYubG9jayA9IHRydWVcblxuICAgICAgICAgICAgICAgIHNlbGYuX3NldCgpXG5cbiAgICAgICAgICAgICAgICB1dGlscy5uZXh0VGljayhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbGYubG9jayA9IGZhbHNlXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgZWwuYWRkRXZlbnRMaXN0ZW5lcihzZWxmLmV2ZW50LCBzZWxmLnNldClcblxuICAgICAgICAvLyBmaXggc2hpdCBmb3IgSUU5XG4gICAgICAgIC8vIHNpbmNlIGl0IGRvZXNuJ3QgZmlyZSBpbnB1dCBvbiBiYWNrc3BhY2UgLyBkZWwgLyBjdXRcbiAgICAgICAgaWYgKGlzSUU5KSB7XG4gICAgICAgICAgICBzZWxmLm9uQ3V0ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIC8vIGN1dCBldmVudCBmaXJlcyBiZWZvcmUgdGhlIHZhbHVlIGFjdHVhbGx5IGNoYW5nZXNcbiAgICAgICAgICAgICAgICB1dGlscy5uZXh0VGljayhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbGYuc2V0KClcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc2VsZi5vbkRlbCA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgICAgICAgICAgaWYgKGUua2V5Q29kZSA9PT0gNDYgfHwgZS5rZXlDb2RlID09PSA4KSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbGYuc2V0KClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbC5hZGRFdmVudExpc3RlbmVyKCdjdXQnLCBzZWxmLm9uQ3V0KVxuICAgICAgICAgICAgZWwuYWRkRXZlbnRMaXN0ZW5lcigna2V5dXAnLCBzZWxmLm9uRGVsKVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9zZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5vd25lclZNLiRzZXQoXG4gICAgICAgICAgICB0aGlzLmtleSwgdGhpcy5tdWx0aVxuICAgICAgICAgICAgICAgID8gZ2V0TXVsdGlwbGVTZWxlY3RPcHRpb25zKHRoaXMuZWwpXG4gICAgICAgICAgICAgICAgOiB0aGlzLmVsW3RoaXMuYXR0cl1cbiAgICAgICAgKVxuICAgIH0sXG5cbiAgICB1cGRhdGU6IGZ1bmN0aW9uICh2YWx1ZSwgaW5pdCkge1xuICAgICAgICAvKiBqc2hpbnQgZXFlcWVxOiBmYWxzZSAqL1xuICAgICAgICAvLyBzeW5jIGJhY2sgaW5saW5lIHZhbHVlIGlmIGluaXRpYWwgZGF0YSBpcyB1bmRlZmluZWRcbiAgICAgICAgaWYgKGluaXQgJiYgdmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3NldCgpXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubG9jaykgcmV0dXJuXG4gICAgICAgIHZhciBlbCA9IHRoaXMuZWxcbiAgICAgICAgaWYgKGVsLnRhZ05hbWUgPT09ICdTRUxFQ1QnKSB7IC8vIHNlbGVjdCBkcm9wZG93blxuICAgICAgICAgICAgZWwuc2VsZWN0ZWRJbmRleCA9IC0xXG4gICAgICAgICAgICBpZih0aGlzLm11bHRpICYmIEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgdmFsdWUuZm9yRWFjaCh0aGlzLnVwZGF0ZVNlbGVjdCwgdGhpcylcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVTZWxlY3QodmFsdWUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoZWwudHlwZSA9PT0gJ3JhZGlvJykgeyAvLyByYWRpbyBidXR0b25cbiAgICAgICAgICAgIGVsLmNoZWNrZWQgPSB2YWx1ZSA9PSBlbC52YWx1ZVxuICAgICAgICB9IGVsc2UgaWYgKGVsLnR5cGUgPT09ICdjaGVja2JveCcpIHsgLy8gY2hlY2tib3hcbiAgICAgICAgICAgIGVsLmNoZWNrZWQgPSAhIXZhbHVlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBlbFt0aGlzLmF0dHJdID0gdXRpbHMudG9UZXh0KHZhbHVlKVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZVNlbGVjdDogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgIC8qIGpzaGludCBlcWVxZXE6IGZhbHNlICovXG4gICAgICAgIC8vIHNldHRpbmcgPHNlbGVjdD4ncyB2YWx1ZSBpbiBJRTkgZG9lc24ndCB3b3JrXG4gICAgICAgIC8vIHdlIGhhdmUgdG8gbWFudWFsbHkgbG9vcCB0aHJvdWdoIHRoZSBvcHRpb25zXG4gICAgICAgIHZhciBvcHRpb25zID0gdGhpcy5lbC5vcHRpb25zLFxuICAgICAgICAgICAgaSA9IG9wdGlvbnMubGVuZ3RoXG4gICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgIGlmIChvcHRpb25zW2ldLnZhbHVlID09IHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgb3B0aW9uc1tpXS5zZWxlY3RlZCA9IHRydWVcbiAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIHVuYmluZDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgZWwgPSB0aGlzLmVsXG4gICAgICAgIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIodGhpcy5ldmVudCwgdGhpcy5zZXQpXG4gICAgICAgIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2NvbXBvc2l0aW9uc3RhcnQnLCB0aGlzLmNMb2NrKVxuICAgICAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKCdjb21wb3NpdGlvbmVuZCcsIHRoaXMuY1VubG9jaylcbiAgICAgICAgaWYgKGlzSUU5KSB7XG4gICAgICAgICAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKCdjdXQnLCB0aGlzLm9uQ3V0KVxuICAgICAgICAgICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcigna2V5dXAnLCB0aGlzLm9uRGVsKVxuICAgICAgICB9XG4gICAgfVxufSIsInZhciB3YXJuID0gcmVxdWlyZSgnLi4vdXRpbHMnKS53YXJuXG5cbm1vZHVsZS5leHBvcnRzID0ge1xuXG4gICAgaXNGbjogdHJ1ZSxcblxuICAgIGJpbmQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gYmx1ciBhbmQgZm9jdXMgZXZlbnRzIGRvIG5vdCBidWJibGVcbiAgICAgICAgLy8gc28gdGhleSBjYW4ndCBiZSBkZWxlZ2F0ZWRcbiAgICAgICAgdGhpcy5idWJibGVzID0gdGhpcy5hcmcgIT09ICdibHVyJyAmJiB0aGlzLmFyZyAhPT0gJ2ZvY3VzJ1xuICAgICAgICBpZiAodGhpcy5idWJibGVzKSB7XG4gICAgICAgICAgICB0aGlzLmJpbmRpbmcuY29tcGlsZXIuYWRkTGlzdGVuZXIodGhpcylcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGU6IGZ1bmN0aW9uIChoYW5kbGVyKSB7XG4gICAgICAgIGlmICh0eXBlb2YgaGFuZGxlciAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgcmV0dXJuIHdhcm4oJ0RpcmVjdGl2ZSBcIm9uXCIgZXhwZWN0cyBhIGZ1bmN0aW9uIHZhbHVlLicpXG4gICAgICAgIH1cbiAgICAgICAgdmFyIHRhcmdldFZNID0gdGhpcy52bSxcbiAgICAgICAgICAgIG93bmVyVk0gID0gdGhpcy5iaW5kaW5nLmNvbXBpbGVyLnZtLFxuICAgICAgICAgICAgaXNFeHAgICAgPSB0aGlzLmJpbmRpbmcuaXNFeHAsXG4gICAgICAgICAgICBuZXdIYW5kbGVyID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICAgICAgICBlLnRhcmdldFZNID0gdGFyZ2V0Vk1cbiAgICAgICAgICAgICAgICBoYW5kbGVyLmNhbGwoaXNFeHAgPyB0YXJnZXRWTSA6IG93bmVyVk0sIGUpXG4gICAgICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5idWJibGVzKSB7XG4gICAgICAgICAgICB0aGlzLnJlc2V0KClcbiAgICAgICAgICAgIHRoaXMuZWwuYWRkRXZlbnRMaXN0ZW5lcih0aGlzLmFyZywgbmV3SGFuZGxlcilcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmhhbmRsZXIgPSBuZXdIYW5kbGVyXG4gICAgfSxcblxuICAgIHJlc2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcih0aGlzLmFyZywgdGhpcy5oYW5kbGVyKVxuICAgIH0sXG4gICAgXG4gICAgdW5iaW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh0aGlzLmJ1YmJsZXMpIHtcbiAgICAgICAgICAgIHRoaXMuYmluZGluZy5jb21waWxlci5yZW1vdmVMaXN0ZW5lcih0aGlzKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5yZXNldCgpXG4gICAgICAgIH1cbiAgICB9XG59IiwidmFyIE9ic2VydmVyICAgPSByZXF1aXJlKCcuLi9vYnNlcnZlcicpLFxuICAgIHV0aWxzICAgICAgPSByZXF1aXJlKCcuLi91dGlscycpLFxuICAgIGNvbmZpZyAgICAgPSByZXF1aXJlKCcuLi9jb25maWcnKSxcbiAgICBkZWYgICAgICAgID0gdXRpbHMuZGVmUHJvdGVjdGVkLFxuICAgIFZpZXdNb2RlbCAvLyBsYXp5IGRlZiB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5XG5cbi8qKlxuICogIE1hdGhvZHMgdGhhdCBwZXJmb3JtIHByZWNpc2UgRE9NIG1hbmlwdWxhdGlvblxuICogIGJhc2VkIG9uIG11dGF0b3IgbWV0aG9kIHRyaWdnZXJlZFxuICovXG52YXIgbXV0YXRpb25IYW5kbGVycyA9IHtcblxuICAgIHB1c2g6IGZ1bmN0aW9uIChtKSB7XG4gICAgICAgIHRoaXMuYWRkSXRlbXMobS5hcmdzLCB0aGlzLnZtcy5sZW5ndGgpXG4gICAgfSxcblxuICAgIHBvcDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgdm0gPSB0aGlzLnZtcy5wb3AoKVxuICAgICAgICBpZiAodm0pIHRoaXMucmVtb3ZlSXRlbXMoW3ZtXSlcbiAgICB9LFxuXG4gICAgdW5zaGlmdDogZnVuY3Rpb24gKG0pIHtcbiAgICAgICAgdGhpcy5hZGRJdGVtcyhtLmFyZ3MpXG4gICAgfSxcblxuICAgIHNoaWZ0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciB2bSA9IHRoaXMudm1zLnNoaWZ0KClcbiAgICAgICAgaWYgKHZtKSB0aGlzLnJlbW92ZUl0ZW1zKFt2bV0pXG4gICAgfSxcblxuICAgIHNwbGljZTogZnVuY3Rpb24gKG0pIHtcbiAgICAgICAgdmFyIGluZGV4ID0gbS5hcmdzWzBdLFxuICAgICAgICAgICAgcmVtb3ZlZCA9IG0uYXJnc1sxXSxcbiAgICAgICAgICAgIHJlbW92ZWRWTXMgPSByZW1vdmVkID09PSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgICA/IHRoaXMudm1zLnNwbGljZShpbmRleClcbiAgICAgICAgICAgICAgICA6IHRoaXMudm1zLnNwbGljZShpbmRleCwgcmVtb3ZlZClcbiAgICAgICAgdGhpcy5yZW1vdmVJdGVtcyhyZW1vdmVkVk1zKVxuICAgICAgICB0aGlzLmFkZEl0ZW1zKG0uYXJncy5zbGljZSgyKSwgaW5kZXgpXG4gICAgfSxcblxuICAgIHNvcnQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHZtcyA9IHRoaXMudm1zLFxuICAgICAgICAgICAgY29sID0gdGhpcy5jb2xsZWN0aW9uLFxuICAgICAgICAgICAgbCA9IGNvbC5sZW5ndGgsXG4gICAgICAgICAgICBzb3J0ZWQgPSBuZXcgQXJyYXkobCksXG4gICAgICAgICAgICBpLCBqLCB2bSwgZGF0YVxuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICBkYXRhID0gY29sW2ldXG4gICAgICAgICAgICBmb3IgKGogPSAwOyBqIDwgbDsgaisrKSB7XG4gICAgICAgICAgICAgICAgdm0gPSB2bXNbal1cbiAgICAgICAgICAgICAgICBpZiAodm0uJGRhdGEgPT09IGRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgc29ydGVkW2ldID0gdm1cbiAgICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IGw7IGkrKykge1xuICAgICAgICAgICAgdGhpcy5jb250YWluZXIuaW5zZXJ0QmVmb3JlKHNvcnRlZFtpXS4kZWwsIHRoaXMucmVmKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMudm1zID0gc29ydGVkXG4gICAgfSxcblxuICAgIHJldmVyc2U6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHZtcyA9IHRoaXMudm1zXG4gICAgICAgIHZtcy5yZXZlcnNlKClcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSB2bXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICB0aGlzLmNvbnRhaW5lci5pbnNlcnRCZWZvcmUodm1zW2ldLiRlbCwgdGhpcy5yZWYpXG4gICAgICAgIH1cbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuXG4gICAgYmluZDogZnVuY3Rpb24gKCkge1xuXG4gICAgICAgIHZhciBlbCAgID0gdGhpcy5lbCxcbiAgICAgICAgICAgIGN0biAgPSB0aGlzLmNvbnRhaW5lciA9IGVsLnBhcmVudE5vZGVcblxuICAgICAgICAvLyBleHRyYWN0IGNoaWxkIFZNIGluZm9ybWF0aW9uLCBpZiBhbnlcbiAgICAgICAgVmlld01vZGVsID0gVmlld01vZGVsIHx8IHJlcXVpcmUoJy4uL3ZpZXdtb2RlbCcpXG4gICAgICAgIHRoaXMuQ3RvciA9IHRoaXMuQ3RvciB8fCBWaWV3TW9kZWxcbiAgICAgICAgLy8gZXh0cmFjdCBjaGlsZCBJZCwgaWYgYW55XG4gICAgICAgIHRoaXMuY2hpbGRJZCA9IHV0aWxzLmF0dHIoZWwsICdyZWYnKVxuXG4gICAgICAgIC8vIGNyZWF0ZSBhIGNvbW1lbnQgbm9kZSBhcyBhIHJlZmVyZW5jZSBub2RlIGZvciBET00gaW5zZXJ0aW9uc1xuICAgICAgICB0aGlzLnJlZiA9IGRvY3VtZW50LmNyZWF0ZUNvbW1lbnQoY29uZmlnLnByZWZpeCArICctcmVwZWF0LScgKyB0aGlzLmtleSlcbiAgICAgICAgY3RuLmluc2VydEJlZm9yZSh0aGlzLnJlZiwgZWwpXG4gICAgICAgIGN0bi5yZW1vdmVDaGlsZChlbClcblxuICAgICAgICB0aGlzLmluaXRpYXRlZCA9IGZhbHNlXG4gICAgICAgIHRoaXMuY29sbGVjdGlvbiA9IG51bGxcbiAgICAgICAgdGhpcy52bXMgPSBudWxsXG5cbiAgICAgICAgdmFyIHNlbGYgPSB0aGlzXG4gICAgICAgIHRoaXMubXV0YXRpb25MaXN0ZW5lciA9IGZ1bmN0aW9uIChwYXRoLCBhcnIsIG11dGF0aW9uKSB7XG4gICAgICAgICAgICB2YXIgbWV0aG9kID0gbXV0YXRpb24ubWV0aG9kXG4gICAgICAgICAgICBtdXRhdGlvbkhhbmRsZXJzW21ldGhvZF0uY2FsbChzZWxmLCBtdXRhdGlvbilcbiAgICAgICAgICAgIGlmIChtZXRob2QgIT09ICdwdXNoJyAmJiBtZXRob2QgIT09ICdwb3AnKSB7XG4gICAgICAgICAgICAgICAgLy8gdXBkYXRlIGluZGV4XG4gICAgICAgICAgICAgICAgdmFyIGkgPSBhcnIubGVuZ3RoXG4gICAgICAgICAgICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICAgICAgICAgICAgICBzZWxmLnZtc1tpXS4kaW5kZXggPSBpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG1ldGhvZCA9PT0gJ3B1c2gnIHx8IG1ldGhvZCA9PT0gJ3Vuc2hpZnQnIHx8IG1ldGhvZCA9PT0gJ3NwbGljZScpIHtcbiAgICAgICAgICAgICAgICAvLyByZWNhbGN1bGF0ZSBkZXBlbmRlbmN5XG4gICAgICAgICAgICAgICAgc2VsZi5jaGFuZ2VkKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgfSxcblxuICAgIHVwZGF0ZTogZnVuY3Rpb24gKGNvbGxlY3Rpb24sIGluaXQpIHtcblxuICAgICAgICBpZiAoXG4gICAgICAgICAgICBjb2xsZWN0aW9uID09PSB0aGlzLmNvbGxlY3Rpb24gfHxcbiAgICAgICAgICAgIGNvbGxlY3Rpb24gPT09IHRoaXMub2JqZWN0XG4gICAgICAgICkgcmV0dXJuXG5cbiAgICAgICAgaWYgKHV0aWxzLnR5cGVPZihjb2xsZWN0aW9uKSA9PT0gJ09iamVjdCcpIHtcbiAgICAgICAgICAgIGNvbGxlY3Rpb24gPSB0aGlzLmNvbnZlcnRPYmplY3QoY29sbGVjdGlvbilcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVzZXQoKVxuICAgICAgICAvLyBpZiBpbml0aWF0aW5nIHdpdGggYW4gZW1wdHkgY29sbGVjdGlvbiwgd2UgbmVlZCB0b1xuICAgICAgICAvLyBmb3JjZSBhIGNvbXBpbGUgc28gdGhhdCB3ZSBnZXQgYWxsIHRoZSBiaW5kaW5ncyBmb3JcbiAgICAgICAgLy8gZGVwZW5kZW5jeSBleHRyYWN0aW9uLlxuICAgICAgICBpZiAoIXRoaXMuaW5pdGlhdGVkICYmICghY29sbGVjdGlvbiB8fCAhY29sbGVjdGlvbi5sZW5ndGgpKSB7XG4gICAgICAgICAgICB0aGlzLmRyeUJ1aWxkKClcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGtlZXAgcmVmZXJlbmNlIG9mIG9sZCBkYXRhIGFuZCBWTXNcbiAgICAgICAgLy8gc28gd2UgY2FuIHJldXNlIHRoZW0gaWYgcG9zc2libGVcbiAgICAgICAgdGhpcy5vbGQgPSB0aGlzLmNvbGxlY3Rpb25cbiAgICAgICAgdmFyIG9sZFZNcyA9IHRoaXMub2xkVk1zID0gdGhpcy52bXNcblxuICAgICAgICBjb2xsZWN0aW9uID0gdGhpcy5jb2xsZWN0aW9uID0gY29sbGVjdGlvbiB8fCBbXVxuICAgICAgICB0aGlzLnZtcyA9IFtdXG4gICAgICAgIGlmICh0aGlzLmNoaWxkSWQpIHtcbiAgICAgICAgICAgIHRoaXMudm0uJFt0aGlzLmNoaWxkSWRdID0gdGhpcy52bXNcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIHRoZSBjb2xsZWN0aW9uIGlzIG5vdCBhbHJlYWR5IGNvbnZlcnRlZCBmb3Igb2JzZXJ2YXRpb24sXG4gICAgICAgIC8vIHdlIG5lZWQgdG8gY29udmVydCBhbmQgd2F0Y2ggaXQuXG4gICAgICAgIGlmICghT2JzZXJ2ZXIuY29udmVydChjb2xsZWN0aW9uKSkge1xuICAgICAgICAgICAgT2JzZXJ2ZXIud2F0Y2goY29sbGVjdGlvbilcbiAgICAgICAgfVxuICAgICAgICAvLyBsaXN0ZW4gZm9yIGNvbGxlY3Rpb24gbXV0YXRpb24gZXZlbnRzXG4gICAgICAgIGNvbGxlY3Rpb24uX19lbWl0dGVyX18ub24oJ211dGF0ZScsIHRoaXMubXV0YXRpb25MaXN0ZW5lcilcblxuICAgICAgICAvLyBjcmVhdGUgbmV3IFZNcyBhbmQgYXBwZW5kIHRvIERPTVxuICAgICAgICBpZiAoY29sbGVjdGlvbi5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNvbGxlY3Rpb24uZm9yRWFjaCh0aGlzLmJ1aWxkLCB0aGlzKVxuICAgICAgICAgICAgaWYgKCFpbml0KSB0aGlzLmNoYW5nZWQoKVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gZGVzdHJveSB1bnVzZWQgb2xkIFZNc1xuICAgICAgICBpZiAob2xkVk1zKSBkZXN0cm95Vk1zKG9sZFZNcylcbiAgICAgICAgdGhpcy5vbGQgPSB0aGlzLm9sZFZNcyA9IG51bGxcbiAgICB9LFxuXG4gICAgYWRkSXRlbXM6IGZ1bmN0aW9uIChkYXRhLCBiYXNlKSB7XG4gICAgICAgIGJhc2UgPSBiYXNlIHx8IDBcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSBkYXRhLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICAgICAgdmFyIHZtID0gdGhpcy5idWlsZChkYXRhW2ldLCBiYXNlICsgaSlcbiAgICAgICAgICAgIHRoaXMudXBkYXRlT2JqZWN0KHZtLCAxKVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIHJlbW92ZUl0ZW1zOiBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICB2YXIgaSA9IGRhdGEubGVuZ3RoXG4gICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgIGRhdGFbaV0uJGRlc3Ryb3koKVxuICAgICAgICAgICAgdGhpcy51cGRhdGVPYmplY3QoZGF0YVtpXSwgLTEpXG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIE5vdGlmeSBwYXJlbnQgY29tcGlsZXIgdGhhdCBuZXcgaXRlbXNcbiAgICAgKiAgaGF2ZSBiZWVuIGFkZGVkIHRvIHRoZSBjb2xsZWN0aW9uLCBpdCBuZWVkc1xuICAgICAqICB0byByZS1jYWxjdWxhdGUgY29tcHV0ZWQgcHJvcGVydHkgZGVwZW5kZW5jaWVzLlxuICAgICAqICBCYXRjaGVkIHRvIGVuc3VyZSBpdCdzIGNhbGxlZCBvbmx5IG9uY2UgZXZlcnkgZXZlbnQgbG9vcC5cbiAgICAgKi9cbiAgICBjaGFuZ2VkOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh0aGlzLnF1ZXVlZCkgcmV0dXJuXG4gICAgICAgIHRoaXMucXVldWVkID0gdHJ1ZVxuICAgICAgICB2YXIgc2VsZiA9IHRoaXNcbiAgICAgICAgdXRpbHMubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCFzZWxmLmNvbXBpbGVyKSByZXR1cm5cbiAgICAgICAgICAgIHNlbGYuY29tcGlsZXIucGFyc2VEZXBzKClcbiAgICAgICAgICAgIHNlbGYucXVldWVkID0gZmFsc2VcbiAgICAgICAgfSlcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIFJ1biBhIGRyeSBidWlsZCBqdXN0IHRvIGNvbGxlY3QgYmluZGluZ3NcbiAgICAgKi9cbiAgICBkcnlCdWlsZDogZnVuY3Rpb24gKCkge1xuICAgICAgICBuZXcgdGhpcy5DdG9yKHtcbiAgICAgICAgICAgIGVsICAgICA6IHRoaXMuZWwuY2xvbmVOb2RlKHRydWUpLFxuICAgICAgICAgICAgcGFyZW50IDogdGhpcy52bSxcbiAgICAgICAgICAgIGNvbXBpbGVyT3B0aW9uczoge1xuICAgICAgICAgICAgICAgIHJlcGVhdDogdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICB9KS4kZGVzdHJveSgpXG4gICAgICAgIHRoaXMuaW5pdGlhdGVkID0gdHJ1ZVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgQ3JlYXRlIGEgbmV3IGNoaWxkIFZNIGZyb20gYSBkYXRhIG9iamVjdFxuICAgICAqICBwYXNzaW5nIGFsb25nIGNvbXBpbGVyIG9wdGlvbnMgaW5kaWNhdGluZyB0aGlzXG4gICAgICogIGlzIGEgdi1yZXBlYXQgaXRlbS5cbiAgICAgKi9cbiAgICBidWlsZDogZnVuY3Rpb24gKGRhdGEsIGluZGV4KSB7XG5cbiAgICAgICAgdmFyIGN0biA9IHRoaXMuY29udGFpbmVyLFxuICAgICAgICAgICAgdm1zID0gdGhpcy52bXMsXG4gICAgICAgICAgICBjb2wgPSB0aGlzLmNvbGxlY3Rpb24sXG4gICAgICAgICAgICBlbCwgb2xkSW5kZXgsIGV4aXN0aW5nLCBpdGVtLCBub25PYmplY3RcblxuICAgICAgICAvLyBnZXQgb3VyIERPTSBpbnNlcnRpb24gcmVmZXJlbmNlIG5vZGVcbiAgICAgICAgdmFyIHJlZiA9IHZtcy5sZW5ndGggPiBpbmRleFxuICAgICAgICAgICAgPyB2bXNbaW5kZXhdLiRlbFxuICAgICAgICAgICAgOiB0aGlzLnJlZlxuICAgICAgICBcbiAgICAgICAgLy8gaWYgcmVmZXJlbmNlIFZNIGlzIGRldGFjaGVkIGJ5IHYtaWYsXG4gICAgICAgIC8vIHVzZSBpdHMgdi1pZiByZWYgbm9kZSBpbnN0ZWFkXG4gICAgICAgIGlmICghcmVmLnBhcmVudE5vZGUpIHtcbiAgICAgICAgICAgIHJlZiA9IHJlZi52dWVfaWZfcmVmXG4gICAgICAgIH1cblxuICAgICAgICAvLyBjaGVjayBpZiBkYXRhIGFscmVhZHkgZXhpc3RzIGluIHRoZSBvbGQgYXJyYXlcbiAgICAgICAgb2xkSW5kZXggPSB0aGlzLm9sZCA/IGluZGV4T2YodGhpcy5vbGQsIGRhdGEpIDogLTFcbiAgICAgICAgZXhpc3RpbmcgPSBvbGRJbmRleCA+IC0xXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nKSB7XG5cbiAgICAgICAgICAgIC8vIGV4aXN0aW5nLCByZXVzZSB0aGUgb2xkIFZNXG4gICAgICAgICAgICBpdGVtID0gdGhpcy5vbGRWTXNbb2xkSW5kZXhdXG4gICAgICAgICAgICAvLyBtYXJrLCBzbyBpdCB3b24ndCBiZSBkZXN0cm95ZWRcbiAgICAgICAgICAgIGl0ZW0uJHJldXNlZCA9IHRydWVcblxuICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICAvLyBuZXcgZGF0YSwgbmVlZCB0byBjcmVhdGUgbmV3IFZNLlxuICAgICAgICAgICAgLy8gdGhlcmUncyBzb21lIHByZXBhcmF0aW9uIHdvcmsgdG8gZG8uLi5cblxuICAgICAgICAgICAgLy8gZmlyc3QgY2xvbmUgdGhlIHRlbXBsYXRlIG5vZGVcbiAgICAgICAgICAgIGVsID0gdGhpcy5lbC5jbG9uZU5vZGUodHJ1ZSlcbiAgICAgICAgICAgIC8vIHRoZW4gd2UgcHJvdmlkZSB0aGUgcGFyZW50Tm9kZSBmb3Igdi1pZlxuICAgICAgICAgICAgLy8gc28gdGhhdCBpdCBjYW4gc3RpbGwgd29yayBpbiBhIGRldGFjaGVkIHN0YXRlXG4gICAgICAgICAgICBlbC52dWVfaWZfcGFyZW50ID0gY3RuXG4gICAgICAgICAgICBlbC52dWVfaWZfcmVmID0gcmVmXG4gICAgICAgICAgICAvLyB3cmFwIG5vbi1vYmplY3QgdmFsdWUgaW4gYW4gb2JqZWN0XG4gICAgICAgICAgICBub25PYmplY3QgPSB1dGlscy50eXBlT2YoZGF0YSkgIT09ICdPYmplY3QnXG4gICAgICAgICAgICBpZiAobm9uT2JqZWN0KSB7XG4gICAgICAgICAgICAgICAgZGF0YSA9IHsgJHZhbHVlOiBkYXRhIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIHNldCBpbmRleCBzbyB2bSBjYW4gaW5pdCB3aXRoIHRoZSBjb3JyZWN0XG4gICAgICAgICAgICAvLyBpbmRleCBpbnN0ZWFkIG9mIHVuZGVmaW5lZFxuICAgICAgICAgICAgZGF0YS4kaW5kZXggPSBpbmRleFxuICAgICAgICAgICAgLy8gaW5pdGlhbGl6ZSB0aGUgbmV3IFZNXG4gICAgICAgICAgICBpdGVtID0gbmV3IHRoaXMuQ3Rvcih7XG4gICAgICAgICAgICAgICAgZWwgICAgIDogZWwsXG4gICAgICAgICAgICAgICAgZGF0YSAgIDogZGF0YSxcbiAgICAgICAgICAgICAgICBwYXJlbnQgOiB0aGlzLnZtLFxuICAgICAgICAgICAgICAgIGNvbXBpbGVyT3B0aW9uczoge1xuICAgICAgICAgICAgICAgICAgICByZXBlYXQ6IHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLy8gZm9yIG5vbi1vYmplY3QgdmFsdWVzLCBsaXN0ZW4gZm9yIHZhbHVlIGNoYW5nZVxuICAgICAgICAgICAgLy8gc28gd2UgY2FuIHN5bmMgaXQgYmFjayB0byB0aGUgb3JpZ2luYWwgQXJyYXlcbiAgICAgICAgICAgIGlmIChub25PYmplY3QpIHtcbiAgICAgICAgICAgICAgICBpdGVtLiRjb21waWxlci5vYnNlcnZlci5vbignc2V0JywgZnVuY3Rpb24gKGtleSwgdmFsKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChrZXkgPT09ICckdmFsdWUnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb2xbaXRlbS4kaW5kZXhdID0gdmFsXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgIH1cblxuICAgICAgICAvLyBwdXQgdGhlIGl0ZW0gaW50byB0aGUgVk0gQXJyYXlcbiAgICAgICAgdm1zLnNwbGljZShpbmRleCwgMCwgaXRlbSlcbiAgICAgICAgLy8gdXBkYXRlIHRoZSBpbmRleFxuICAgICAgICBpdGVtLiRpbmRleCA9IGluZGV4XG5cbiAgICAgICAgLy8gRmluYWxseSwgRE9NIG9wZXJhdGlvbnMuLi5cbiAgICAgICAgZWwgPSBpdGVtLiRlbFxuICAgICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgICAgIC8vIHdlIHNpbXBsaWZ5IG5lZWQgdG8gcmUtaW5zZXJ0IHRoZSBleGlzdGluZyBub2RlXG4gICAgICAgICAgICAvLyB0byBpdHMgbmV3IHBvc2l0aW9uLiBIb3dldmVyLCBpdCBjYW4gcG9zc2libHkgYmVcbiAgICAgICAgICAgIC8vIGRldGFjaGVkIGJ5IHYtaWYuIGluIHRoYXQgY2FzZSB3ZSBpbnNlcnQgaXRzIHYtaWZcbiAgICAgICAgICAgIC8vIHJlZiBub2RlIGluc3RlYWQuXG4gICAgICAgICAgICBjdG4uaW5zZXJ0QmVmb3JlKGVsLnBhcmVudE5vZGUgPyBlbCA6IGVsLnZ1ZV9pZl9yZWYsIHJlZilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmIChlbC52dWVfaWYgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuY29tcGlsZXIuaW5pdCkge1xuICAgICAgICAgICAgICAgICAgICAvLyBkbyBub3QgdHJhbnNpdGlvbiBvbiBpbml0aWFsIGNvbXBpbGUsXG4gICAgICAgICAgICAgICAgICAgIC8vIGp1c3QgbWFudWFsbHkgaW5zZXJ0LlxuICAgICAgICAgICAgICAgICAgICBjdG4uaW5zZXJ0QmVmb3JlKGVsLCByZWYpXG4gICAgICAgICAgICAgICAgICAgIGl0ZW0uJGNvbXBpbGVyLmV4ZWNIb29rKCdhdHRhY2hlZCcpXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gZ2l2ZSBpdCBzb21lIG5pY2UgdHJhbnNpdGlvbi5cbiAgICAgICAgICAgICAgICAgICAgaXRlbS4kYmVmb3JlKHJlZilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaXRlbVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgQ29udmVydCBhbiBvYmplY3QgdG8gYSByZXBlYXRlciBBcnJheVxuICAgICAqICBhbmQgbWFrZSBzdXJlIGNoYW5nZXMgaW4gdGhlIG9iamVjdCBhcmUgc3luY2VkIHRvIHRoZSByZXBlYXRlclxuICAgICAqL1xuICAgIGNvbnZlcnRPYmplY3Q6IGZ1bmN0aW9uIChvYmplY3QpIHtcblxuICAgICAgICBpZiAodGhpcy5vYmplY3QpIHtcbiAgICAgICAgICAgIHRoaXMub2JqZWN0Ll9fZW1pdHRlcl9fLm9mZignc2V0JywgdGhpcy51cGRhdGVSZXBlYXRlcilcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMub2JqZWN0ID0gb2JqZWN0XG4gICAgICAgIHZhciBjb2xsZWN0aW9uID0gb2JqZWN0LiRyZXBlYXRlciB8fCBvYmplY3RUb0FycmF5KG9iamVjdClcbiAgICAgICAgaWYgKCFvYmplY3QuJHJlcGVhdGVyKSB7XG4gICAgICAgICAgICBkZWYob2JqZWN0LCAnJHJlcGVhdGVyJywgY29sbGVjdGlvbilcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBzZWxmID0gdGhpc1xuICAgICAgICB0aGlzLnVwZGF0ZVJlcGVhdGVyID0gZnVuY3Rpb24gKGtleSwgdmFsKSB7XG4gICAgICAgICAgICBpZiAoa2V5LmluZGV4T2YoJy4nKSA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICB2YXIgaSA9IHNlbGYudm1zLmxlbmd0aCwgaXRlbVxuICAgICAgICAgICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgICAgICAgICAgaXRlbSA9IHNlbGYudm1zW2ldXG4gICAgICAgICAgICAgICAgICAgIGlmIChpdGVtLiRrZXkgPT09IGtleSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGl0ZW0uJGRhdGEgIT09IHZhbCAmJiBpdGVtLiR2YWx1ZSAhPT0gdmFsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCckdmFsdWUnIGluIGl0ZW0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaXRlbS4kdmFsdWUgPSB2YWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpdGVtLiRkYXRhID0gdmFsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIG9iamVjdC5fX2VtaXR0ZXJfXy5vbignc2V0JywgdGhpcy51cGRhdGVSZXBlYXRlcilcbiAgICAgICAgcmV0dXJuIGNvbGxlY3Rpb25cbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIFN5bmMgY2hhbmdlcyBmcm9tIHRoZSAkcmVwZWF0ZXIgQXJyYXlcbiAgICAgKiAgYmFjayB0byB0aGUgcmVwcmVzZW50ZWQgT2JqZWN0XG4gICAgICovXG4gICAgdXBkYXRlT2JqZWN0OiBmdW5jdGlvbiAodm0sIGFjdGlvbikge1xuICAgICAgICB2YXIgb2JqID0gdGhpcy5vYmplY3RcbiAgICAgICAgaWYgKG9iaiAmJiB2bS4ka2V5KSB7XG4gICAgICAgICAgICB2YXIga2V5ID0gdm0uJGtleSxcbiAgICAgICAgICAgICAgICB2YWwgPSB2bS4kdmFsdWUgfHwgdm0uJGRhdGFcbiAgICAgICAgICAgIGlmIChhY3Rpb24gPiAwKSB7IC8vIG5ldyBwcm9wZXJ0eVxuICAgICAgICAgICAgICAgIG9ialtrZXldID0gdmFsXG4gICAgICAgICAgICAgICAgT2JzZXJ2ZXIuY29udmVydEtleShvYmosIGtleSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIG9ialtrZXldXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvYmouX19lbWl0dGVyX18uZW1pdCgnc2V0Jywga2V5LCB2YWwsIHRydWUpXG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgcmVzZXQ6IGZ1bmN0aW9uIChkZXN0cm95KSB7XG4gICAgICAgIGlmICh0aGlzLmNoaWxkSWQpIHtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnZtLiRbdGhpcy5jaGlsZElkXVxuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmNvbGxlY3Rpb24pIHtcbiAgICAgICAgICAgIHRoaXMuY29sbGVjdGlvbi5fX2VtaXR0ZXJfXy5vZmYoJ211dGF0ZScsIHRoaXMubXV0YXRpb25MaXN0ZW5lcilcbiAgICAgICAgICAgIGlmIChkZXN0cm95KSB7XG4gICAgICAgICAgICAgICAgZGVzdHJveVZNcyh0aGlzLnZtcylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICB1bmJpbmQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5yZXNldCh0cnVlKVxuICAgIH1cbn1cblxuLy8gSGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqICBDb252ZXJ0IGFuIE9iamVjdCB0byBhIHYtcmVwZWF0IGZyaWVuZGx5IEFycmF5XG4gKi9cbmZ1bmN0aW9uIG9iamVjdFRvQXJyYXkgKG9iaikge1xuICAgIHZhciByZXMgPSBbXSwgdmFsLCBkYXRhXG4gICAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgICAgICB2YWwgPSBvYmpba2V5XVxuICAgICAgICBkYXRhID0gdXRpbHMudHlwZU9mKHZhbCkgPT09ICdPYmplY3QnXG4gICAgICAgICAgICA/IHZhbFxuICAgICAgICAgICAgOiB7ICR2YWx1ZTogdmFsIH1cbiAgICAgICAgZGVmKGRhdGEsICcka2V5Jywga2V5KVxuICAgICAgICByZXMucHVzaChkYXRhKVxuICAgIH1cbiAgICByZXR1cm4gcmVzXG59XG5cbi8qKlxuICogIEZpbmQgYW4gb2JqZWN0IG9yIGEgd3JhcHBlZCBkYXRhIG9iamVjdFxuICogIGZyb20gYW4gQXJyYXlcbiAqL1xuZnVuY3Rpb24gaW5kZXhPZiAoYXJyLCBvYmopIHtcbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IGFyci5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgaWYgKGFycltpXSA9PT0gb2JqIHx8IChvYmouJHZhbHVlICYmIGFycltpXS4kdmFsdWUgPT09IG9iai4kdmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gaVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMVxufVxuXG4vKipcbiAqICBEZXN0cm95IHNvbWUgVk1zLCB5ZWFoLlxuICovXG5mdW5jdGlvbiBkZXN0cm95Vk1zICh2bXMpIHtcbiAgICB2YXIgaSA9IHZtcy5sZW5ndGgsIHZtXG4gICAgd2hpbGUgKGktLSkge1xuICAgICAgICB2bSA9IHZtc1tpXVxuICAgICAgICBpZiAodm0uJHJldXNlZCkge1xuICAgICAgICAgICAgdm0uJHJldXNlZCA9IGZhbHNlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2bS4kZGVzdHJveSgpXG4gICAgICAgIH1cbiAgICB9XG59IiwidmFyIGNhbWVsUkUgPSAvLShbYS16XSkvZyxcbiAgICBwcmVmaXhlcyA9IFsnd2Via2l0JywgJ21veicsICdtcyddXG5cbmZ1bmN0aW9uIGNhbWVsUmVwbGFjZXIgKG0pIHtcbiAgICByZXR1cm4gbVsxXS50b1VwcGVyQ2FzZSgpXG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuXG4gICAgYmluZDogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgcHJvcCA9IHRoaXMuYXJnXG4gICAgICAgIGlmICghcHJvcCkgcmV0dXJuXG4gICAgICAgIHZhciBmaXJzdCA9IHByb3AuY2hhckF0KDApXG4gICAgICAgIGlmIChmaXJzdCA9PT0gJyQnKSB7XG4gICAgICAgICAgICAvLyBwcm9wZXJ0aWVzIHRoYXQgc3RhcnQgd2l0aCAkIHdpbGwgYmUgYXV0by1wcmVmaXhlZFxuICAgICAgICAgICAgcHJvcCA9IHByb3Auc2xpY2UoMSlcbiAgICAgICAgICAgIHRoaXMucHJlZml4ZWQgPSB0cnVlXG4gICAgICAgIH0gZWxzZSBpZiAoZmlyc3QgPT09ICctJykge1xuICAgICAgICAgICAgLy8gbm9ybWFsIHN0YXJ0aW5nIGh5cGhlbnMgc2hvdWxkIG5vdCBiZSBjb252ZXJ0ZWRcbiAgICAgICAgICAgIHByb3AgPSBwcm9wLnNsaWNlKDEpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5wcm9wID0gcHJvcC5yZXBsYWNlKGNhbWVsUkUsIGNhbWVsUmVwbGFjZXIpXG4gICAgfSxcblxuICAgIHVwZGF0ZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgIHZhciBwcm9wID0gdGhpcy5wcm9wXG4gICAgICAgIGlmIChwcm9wKSB7XG4gICAgICAgICAgICB0aGlzLmVsLnN0eWxlW3Byb3BdID0gdmFsdWVcbiAgICAgICAgICAgIGlmICh0aGlzLnByZWZpeGVkKSB7XG4gICAgICAgICAgICAgICAgcHJvcCA9IHByb3AuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBwcm9wLnNsaWNlKDEpXG4gICAgICAgICAgICAgICAgdmFyIGkgPSBwcmVmaXhlcy5sZW5ndGhcbiAgICAgICAgICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZWwuc3R5bGVbcHJlZml4ZXNbaV0gKyBwcm9wXSA9IHZhbHVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5lbC5zdHlsZS5jc3NUZXh0ID0gdmFsdWVcbiAgICAgICAgfVxuICAgIH1cblxufSIsInZhciBWaWV3TW9kZWwsXG4gICAgbmV4dFRpY2sgPSByZXF1aXJlKCcuLi91dGlscycpLm5leHRUaWNrXG5cbm1vZHVsZS5leHBvcnRzID0ge1xuXG4gICAgYmluZDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAodGhpcy5lbC52dWVfdm0pIHtcbiAgICAgICAgICAgIHRoaXMuc3ViVk0gPSB0aGlzLmVsLnZ1ZV92bVxuICAgICAgICAgICAgdmFyIGNvbXBpbGVyID0gdGhpcy5zdWJWTS4kY29tcGlsZXJcbiAgICAgICAgICAgIGlmICghY29tcGlsZXIuYmluZGluZ3NbdGhpcy5hcmddKSB7XG4gICAgICAgICAgICAgICAgY29tcGlsZXIuY3JlYXRlQmluZGluZyh0aGlzLmFyZylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmlzRW1wdHkpIHtcbiAgICAgICAgICAgIHRoaXMuYnVpbGQoKVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZTogZnVuY3Rpb24gKHZhbHVlLCBpbml0KSB7XG4gICAgICAgIHZhciB2bSA9IHRoaXMuc3ViVk0sXG4gICAgICAgICAgICBrZXkgPSB0aGlzLmFyZyB8fCAnJGRhdGEnXG4gICAgICAgIGlmICghdm0pIHtcbiAgICAgICAgICAgIHRoaXMuYnVpbGQodmFsdWUpXG4gICAgICAgIH0gZWxzZSBpZiAoIXRoaXMubG9jayAmJiB2bVtrZXldICE9PSB2YWx1ZSkge1xuICAgICAgICAgICAgdm1ba2V5XSA9IHZhbHVlXG4gICAgICAgIH1cbiAgICAgICAgaWYgKGluaXQpIHtcbiAgICAgICAgICAgIC8vIHdhdGNoIGFmdGVyIGZpcnN0IHNldFxuICAgICAgICAgICAgdGhpcy53YXRjaCgpXG4gICAgICAgICAgICAvLyBUaGUgdi13aXRoIGRpcmVjdGl2ZSBjYW4gaGF2ZSBtdWx0aXBsZSBleHByZXNzaW9ucyxcbiAgICAgICAgICAgIC8vIGFuZCB3ZSB3YW50IHRvIG1ha2Ugc3VyZSB3aGVuIHRoZSByZWFkeSBob29rIGlzIGNhbGxlZFxuICAgICAgICAgICAgLy8gb24gdGhlIHN1YlZNLCBhbGwgdGhlc2UgY2xhdXNlcyBoYXZlIGJlZW4gcHJvcGVybHkgc2V0IHVwLlxuICAgICAgICAgICAgLy8gU28gdGhpcyBpcyBhIGhhY2sgdGhhdCBzbmlmZnMgd2hldGhlciB3ZSBoYXZlIHJlYWNoZWRcbiAgICAgICAgICAgIC8vIHRoZSBsYXN0IGV4cHJlc3Npb24uIFdlIGhvbGQgb2ZmIHRoZSBzdWJWTSdzIHJlYWR5IGhvb2tcbiAgICAgICAgICAgIC8vIHVudGlsIHdlIGFyZSBhY3R1YWxseSByZWFkeS5cbiAgICAgICAgICAgIGlmICh0aGlzLmxhc3QpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnN1YlZNLiRjb21waWxlci5leGVjSG9vaygncmVhZHknKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIGJ1aWxkOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgVmlld01vZGVsID0gVmlld01vZGVsIHx8IHJlcXVpcmUoJy4uL3ZpZXdtb2RlbCcpXG4gICAgICAgIHZhciBDdG9yID0gdGhpcy5DdG9yIHx8IFZpZXdNb2RlbCxcbiAgICAgICAgICAgIGRhdGEgPSB2YWx1ZVxuICAgICAgICBpZiAodGhpcy5hcmcpIHtcbiAgICAgICAgICAgIGRhdGEgPSB7fVxuICAgICAgICAgICAgZGF0YVt0aGlzLmFyZ10gPSB2YWx1ZVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuc3ViVk0gPSBuZXcgQ3Rvcih7XG4gICAgICAgICAgICBlbCAgICAgOiB0aGlzLmVsLFxuICAgICAgICAgICAgZGF0YSAgIDogZGF0YSxcbiAgICAgICAgICAgIHBhcmVudCA6IHRoaXMudm0sXG4gICAgICAgICAgICBjb21waWxlck9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICAvLyBpdCBpcyBpbXBvcnRhbnQgdG8gZGVsYXkgdGhlIHJlYWR5IGhvb2tcbiAgICAgICAgICAgICAgICAvLyBzbyB0aGF0IHdoZW4gaXQncyBjYWxsZWQsIGFsbCBgdi13aXRoYCB3YXRoY2Vyc1xuICAgICAgICAgICAgICAgIC8vIHdvdWxkIGhhdmUgYmVlbiBzZXQgdXAuXG4gICAgICAgICAgICAgICAgZGVsYXlSZWFkeTogIXRoaXMubGFzdFxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgRm9yIGluaGVydGllZCBrZXlzLCBuZWVkIHRvIHdhdGNoXG4gICAgICogIGFuZCBzeW5jIGJhY2sgdG8gdGhlIHBhcmVudFxuICAgICAqL1xuICAgIHdhdGNoOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghdGhpcy5hcmcpIHJldHVyblxuICAgICAgICB2YXIgc2VsZiAgICA9IHRoaXMsXG4gICAgICAgICAgICBrZXkgICAgID0gc2VsZi5rZXksXG4gICAgICAgICAgICBvd25lclZNID0gc2VsZi5iaW5kaW5nLmNvbXBpbGVyLnZtXG4gICAgICAgIHRoaXMuc3ViVk0uJGNvbXBpbGVyLm9ic2VydmVyLm9uKCdjaGFuZ2U6JyArIHRoaXMuYXJnLCBmdW5jdGlvbiAodmFsKSB7XG4gICAgICAgICAgICBpZiAoIXNlbGYubG9jaykge1xuICAgICAgICAgICAgICAgIHNlbGYubG9jayA9IHRydWVcbiAgICAgICAgICAgICAgICBuZXh0VGljayhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbGYubG9jayA9IGZhbHNlXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG93bmVyVk0uJHNldChrZXksIHZhbClcbiAgICAgICAgfSlcbiAgICB9LFxuXG4gICAgdW5iaW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIGFsbCB3YXRjaGVycyBhcmUgdHVybmVkIG9mZiBkdXJpbmcgZGVzdHJveVxuICAgICAgICAvLyBzbyBubyBuZWVkIHRvIHdvcnJ5IGFib3V0IGl0XG4gICAgICAgIHRoaXMuc3ViVk0uJGRlc3Ryb3koKVxuICAgIH1cblxufSIsImZ1bmN0aW9uIEVtaXR0ZXIgKCkge1xuICAgIHRoaXMuX2N0eCA9IHRoaXNcbn1cblxudmFyIEVtaXR0ZXJQcm90byA9IEVtaXR0ZXIucHJvdG90eXBlLFxuICAgIHNsaWNlID0gW10uc2xpY2VcblxuRW1pdHRlclByb3RvLm9uID0gZnVuY3Rpb24oZXZlbnQsIGZuKXtcbiAgICB0aGlzLl9jYnMgPSB0aGlzLl9jYnMgfHwge31cbiAgICA7KHRoaXMuX2Nic1tldmVudF0gPSB0aGlzLl9jYnNbZXZlbnRdIHx8IFtdKVxuICAgICAgICAucHVzaChmbilcbiAgICByZXR1cm4gdGhpc1xufVxuXG5FbWl0dGVyLnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24oZXZlbnQsIGZuKXtcbiAgICB2YXIgc2VsZiA9IHRoaXNcbiAgICB0aGlzLl9jYnMgPSB0aGlzLl9jYnMgfHwge31cblxuICAgIGZ1bmN0aW9uIG9uKCkge1xuICAgICAgICBzZWxmLm9mZihldmVudCwgb24pXG4gICAgICAgIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICB9XG5cbiAgICBvbi5mbiA9IGZuXG4gICAgdGhpcy5vbihldmVudCwgb24pXG4gICAgcmV0dXJuIHRoaXNcbn1cblxuRW1pdHRlci5wcm90b3R5cGUub2ZmID0gZnVuY3Rpb24oZXZlbnQsIGZuKXtcbiAgICB0aGlzLl9jYnMgPSB0aGlzLl9jYnMgfHwge31cblxuICAgIC8vIGFsbFxuICAgIGlmICghYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgICB0aGlzLl9jYnMgPSB7fVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIC8vIHNwZWNpZmljIGV2ZW50XG4gICAgdmFyIGNhbGxiYWNrcyA9IHRoaXMuX2Nic1tldmVudF1cbiAgICBpZiAoIWNhbGxiYWNrcykgcmV0dXJuIHRoaXNcblxuICAgIC8vIHJlbW92ZSBhbGwgaGFuZGxlcnNcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBkZWxldGUgdGhpcy5fY2JzW2V2ZW50XVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIC8vIHJlbW92ZSBzcGVjaWZpYyBoYW5kbGVyXG4gICAgdmFyIGNiXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjYWxsYmFja3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY2IgPSBjYWxsYmFja3NbaV1cbiAgICAgICAgaWYgKGNiID09PSBmbiB8fCBjYi5mbiA9PT0gZm4pIHtcbiAgICAgICAgICAgIGNhbGxiYWNrcy5zcGxpY2UoaSwgMSlcbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRoaXNcbn1cblxuRW1pdHRlci5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgICB0aGlzLl9jYnMgPSB0aGlzLl9jYnMgfHwge31cbiAgICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSxcbiAgICAgICAgY2FsbGJhY2tzID0gdGhpcy5fY2JzW2V2ZW50XVxuXG4gICAgaWYgKGNhbGxiYWNrcykge1xuICAgICAgICBjYWxsYmFja3MgPSBjYWxsYmFja3Muc2xpY2UoMClcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGNhbGxiYWNrcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgICAgY2FsbGJhY2tzW2ldLmFwcGx5KHRoaXMuX2N0eCwgYXJncylcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG59XG5cbm1vZHVsZS5leHBvcnRzID0gRW1pdHRlciIsInZhciB1dGlscyAgICAgICAgICAgPSByZXF1aXJlKCcuL3V0aWxzJyksXG4gICAgc3RyaW5nU2F2ZVJFICAgID0gL1wiKD86W15cIlxcXFxdfFxcXFwuKSpcInwnKD86W14nXFxcXF18XFxcXC4pKicvZyxcbiAgICBzdHJpbmdSZXN0b3JlUkUgPSAvXCIoXFxkKylcIi9nLFxuICAgIGNvbnN0cnVjdG9yUkUgICA9IG5ldyBSZWdFeHAoJ2NvbnN0cnVjdG9yJy5zcGxpdCgnJykuam9pbignW1xcJ1wiKywgXSonKSksXG4gICAgdW5pY29kZVJFICAgICAgID0gL1xcXFx1XFxkXFxkXFxkXFxkL1xuXG4vLyBWYXJpYWJsZSBleHRyYWN0aW9uIHNjb29wZWQgZnJvbSBodHRwczovL2dpdGh1Yi5jb20vUnVieUxvdXZyZS9hdmFsb25cblxudmFyIEtFWVdPUkRTID1cbiAgICAgICAgLy8ga2V5d29yZHNcbiAgICAgICAgJ2JyZWFrLGNhc2UsY2F0Y2gsY29udGludWUsZGVidWdnZXIsZGVmYXVsdCxkZWxldGUsZG8sZWxzZSxmYWxzZScgK1xuICAgICAgICAnLGZpbmFsbHksZm9yLGZ1bmN0aW9uLGlmLGluLGluc3RhbmNlb2YsbmV3LG51bGwscmV0dXJuLHN3aXRjaCx0aGlzJyArXG4gICAgICAgICcsdGhyb3csdHJ1ZSx0cnksdHlwZW9mLHZhcix2b2lkLHdoaWxlLHdpdGgsdW5kZWZpbmVkJyArXG4gICAgICAgIC8vIHJlc2VydmVkXG4gICAgICAgICcsYWJzdHJhY3QsYm9vbGVhbixieXRlLGNoYXIsY2xhc3MsY29uc3QsZG91YmxlLGVudW0sZXhwb3J0LGV4dGVuZHMnICtcbiAgICAgICAgJyxmaW5hbCxmbG9hdCxnb3RvLGltcGxlbWVudHMsaW1wb3J0LGludCxpbnRlcmZhY2UsbG9uZyxuYXRpdmUnICtcbiAgICAgICAgJyxwYWNrYWdlLHByaXZhdGUscHJvdGVjdGVkLHB1YmxpYyxzaG9ydCxzdGF0aWMsc3VwZXIsc3luY2hyb25pemVkJyArXG4gICAgICAgICcsdGhyb3dzLHRyYW5zaWVudCx2b2xhdGlsZScgK1xuICAgICAgICAvLyBFQ01BIDUgLSB1c2Ugc3RyaWN0XG4gICAgICAgICcsYXJndW1lbnRzLGxldCx5aWVsZCcgK1xuICAgICAgICAvLyBhbGxvdyB1c2luZyBNYXRoIGluIGV4cHJlc3Npb25zXG4gICAgICAgICcsTWF0aCcsXG4gICAgICAgIFxuICAgIEtFWVdPUkRTX1JFID0gbmV3IFJlZ0V4cChbXCJcXFxcYlwiICsgS0VZV09SRFMucmVwbGFjZSgvLC9nLCAnXFxcXGJ8XFxcXGInKSArIFwiXFxcXGJcIl0uam9pbignfCcpLCAnZycpLFxuICAgIFJFTU9WRV9SRSAgID0gL1xcL1xcKig/Oi58XFxuKSo/XFwqXFwvfFxcL1xcL1teXFxuXSpcXG58XFwvXFwvW15cXG5dKiR8J1teJ10qJ3xcIlteXCJdKlwifFtcXHNcXHRcXG5dKlxcLltcXHNcXHRcXG5dKlskXFx3XFwuXSsvZyxcbiAgICBTUExJVF9SRSAgICA9IC9bXlxcdyRdKy9nLFxuICAgIE5VTUJFUl9SRSAgID0gL1xcYlxcZFteLF0qL2csXG4gICAgQk9VTkRBUllfUkUgPSAvXiwrfCwrJC9nXG5cbi8qKlxuICogIFN0cmlwIHRvcCBsZXZlbCB2YXJpYWJsZSBuYW1lcyBmcm9tIGEgc25pcHBldCBvZiBKUyBleHByZXNzaW9uXG4gKi9cbmZ1bmN0aW9uIGdldFZhcmlhYmxlcyAoY29kZSkge1xuICAgIGNvZGUgPSBjb2RlXG4gICAgICAgIC5yZXBsYWNlKFJFTU9WRV9SRSwgJycpXG4gICAgICAgIC5yZXBsYWNlKFNQTElUX1JFLCAnLCcpXG4gICAgICAgIC5yZXBsYWNlKEtFWVdPUkRTX1JFLCAnJylcbiAgICAgICAgLnJlcGxhY2UoTlVNQkVSX1JFLCAnJylcbiAgICAgICAgLnJlcGxhY2UoQk9VTkRBUllfUkUsICcnKVxuICAgIHJldHVybiBjb2RlXG4gICAgICAgID8gY29kZS5zcGxpdCgvLCsvKVxuICAgICAgICA6IFtdXG59XG5cbi8qKlxuICogIEEgZ2l2ZW4gcGF0aCBjb3VsZCBwb3RlbnRpYWxseSBleGlzdCBub3Qgb24gdGhlXG4gKiAgY3VycmVudCBjb21waWxlciwgYnV0IHVwIGluIHRoZSBwYXJlbnQgY2hhaW4gc29tZXdoZXJlLlxuICogIFRoaXMgZnVuY3Rpb24gZ2VuZXJhdGVzIGFuIGFjY2VzcyByZWxhdGlvbnNoaXAgc3RyaW5nXG4gKiAgdGhhdCBjYW4gYmUgdXNlZCBpbiB0aGUgZ2V0dGVyIGZ1bmN0aW9uIGJ5IHdhbGtpbmcgdXBcbiAqICB0aGUgcGFyZW50IGNoYWluIHRvIGNoZWNrIGZvciBrZXkgZXhpc3RlbmNlLlxuICpcbiAqICBJdCBzdG9wcyBhdCB0b3AgcGFyZW50IGlmIG5vIHZtIGluIHRoZSBjaGFpbiBoYXMgdGhlXG4gKiAga2V5LiBJdCB0aGVuIGNyZWF0ZXMgYW55IG1pc3NpbmcgYmluZGluZ3Mgb24gdGhlXG4gKiAgZmluYWwgcmVzb2x2ZWQgdm0uXG4gKi9cbmZ1bmN0aW9uIGdldFJlbCAocGF0aCwgY29tcGlsZXIpIHtcbiAgICB2YXIgcmVsICA9ICcnLFxuICAgICAgICBkaXN0ID0gMCxcbiAgICAgICAgc2VsZiA9IGNvbXBpbGVyXG4gICAgd2hpbGUgKGNvbXBpbGVyKSB7XG4gICAgICAgIGlmIChjb21waWxlci5oYXNLZXkocGF0aCkpIHtcbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb21waWxlciA9IGNvbXBpbGVyLnBhcmVudFxuICAgICAgICAgICAgZGlzdCsrXG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGNvbXBpbGVyKSB7XG4gICAgICAgIHdoaWxlIChkaXN0LS0pIHtcbiAgICAgICAgICAgIHJlbCArPSAnJHBhcmVudC4nXG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjb21waWxlci5iaW5kaW5nc1twYXRoXSAmJiBwYXRoLmNoYXJBdCgwKSAhPT0gJyQnKSB7XG4gICAgICAgICAgICBjb21waWxlci5jcmVhdGVCaW5kaW5nKHBhdGgpXG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLmNyZWF0ZUJpbmRpbmcocGF0aClcbiAgICB9XG4gICAgcmV0dXJuIHJlbFxufVxuXG4vKipcbiAqICBDcmVhdGUgYSBmdW5jdGlvbiBmcm9tIGEgc3RyaW5nLi4uXG4gKiAgdGhpcyBsb29rcyBsaWtlIGV2aWwgbWFnaWMgYnV0IHNpbmNlIGFsbCB2YXJpYWJsZXMgYXJlIGxpbWl0ZWRcbiAqICB0byB0aGUgVk0ncyBkYXRhIGl0J3MgYWN0dWFsbHkgcHJvcGVybHkgc2FuZGJveGVkXG4gKi9cbmZ1bmN0aW9uIG1ha2VHZXR0ZXIgKGV4cCwgcmF3KSB7XG4gICAgLyoganNoaW50IGV2aWw6IHRydWUgKi9cbiAgICB2YXIgZm5cbiAgICB0cnkge1xuICAgICAgICBmbiA9IG5ldyBGdW5jdGlvbihleHApXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICB1dGlscy53YXJuKCdJbnZhbGlkIGV4cHJlc3Npb246ICcgKyByYXcpXG4gICAgfVxuICAgIHJldHVybiBmblxufVxuXG4vKipcbiAqICBFc2NhcGUgYSBsZWFkaW5nIGRvbGxhciBzaWduIGZvciByZWdleCBjb25zdHJ1Y3Rpb25cbiAqL1xuZnVuY3Rpb24gZXNjYXBlRG9sbGFyICh2KSB7XG4gICAgcmV0dXJuIHYuY2hhckF0KDApID09PSAnJCdcbiAgICAgICAgPyAnXFxcXCcgKyB2XG4gICAgICAgIDogdlxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcblxuICAgIC8qKlxuICAgICAqICBQYXJzZSBhbmQgcmV0dXJuIGFuIGFub255bW91cyBjb21wdXRlZCBwcm9wZXJ0eSBnZXR0ZXIgZnVuY3Rpb25cbiAgICAgKiAgZnJvbSBhbiBhcmJpdHJhcnkgZXhwcmVzc2lvbiwgdG9nZXRoZXIgd2l0aCBhIGxpc3Qgb2YgcGF0aHMgdG8gYmVcbiAgICAgKiAgY3JlYXRlZCBhcyBiaW5kaW5ncy5cbiAgICAgKi9cbiAgICBwYXJzZTogZnVuY3Rpb24gKGV4cCwgY29tcGlsZXIpIHtcbiAgICAgICAgLy8gdW5pY29kZSBhbmQgJ2NvbnN0cnVjdG9yJyBhcmUgbm90IGFsbG93ZWQgZm9yIFhTUyBzZWN1cml0eS5cbiAgICAgICAgaWYgKHVuaWNvZGVSRS50ZXN0KGV4cCkgfHwgY29uc3RydWN0b3JSRS50ZXN0KGV4cCkpIHtcbiAgICAgICAgICAgIHV0aWxzLndhcm4oJ1Vuc2FmZSBleHByZXNzaW9uOiAnICsgZXhwKVxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHt9XG4gICAgICAgIH1cbiAgICAgICAgLy8gZXh0cmFjdCB2YXJpYWJsZSBuYW1lc1xuICAgICAgICB2YXIgdmFycyA9IGdldFZhcmlhYmxlcyhleHApXG4gICAgICAgIGlmICghdmFycy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybiBtYWtlR2V0dGVyKCdyZXR1cm4gJyArIGV4cCwgZXhwKVxuICAgICAgICB9XG4gICAgICAgIHZhcnMgPSB1dGlscy51bmlxdWUodmFycylcbiAgICAgICAgdmFyIGFjY2Vzc29ycyA9ICcnLFxuICAgICAgICAgICAgaGFzICAgICAgID0gdXRpbHMuaGFzaCgpLFxuICAgICAgICAgICAgc3RyaW5ncyAgID0gW10sXG4gICAgICAgICAgICAvLyBjb25zdHJ1Y3QgYSByZWdleCB0byBleHRyYWN0IGFsbCB2YWxpZCB2YXJpYWJsZSBwYXRoc1xuICAgICAgICAgICAgLy8gb25lcyB0aGF0IGJlZ2luIHdpdGggXCIkXCIgYXJlIHBhcnRpY3VsYXJseSB0cmlja3lcbiAgICAgICAgICAgIC8vIGJlY2F1c2Ugd2UgY2FuJ3QgdXNlIFxcYiBmb3IgdGhlbVxuICAgICAgICAgICAgcGF0aFJFID0gbmV3IFJlZ0V4cChcbiAgICAgICAgICAgICAgICBcIlteJFxcXFx3XFxcXC5dKFwiICtcbiAgICAgICAgICAgICAgICB2YXJzLm1hcChlc2NhcGVEb2xsYXIpLmpvaW4oJ3wnKSArXG4gICAgICAgICAgICAgICAgXCIpWyRcXFxcd1xcXFwuXSpcXFxcYlwiLCAnZydcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICBib2R5ID0gKCdyZXR1cm4gJyArIGV4cClcbiAgICAgICAgICAgICAgICAucmVwbGFjZShzdHJpbmdTYXZlUkUsIHNhdmVTdHJpbmdzKVxuICAgICAgICAgICAgICAgIC5yZXBsYWNlKHBhdGhSRSwgcmVwbGFjZVBhdGgpXG4gICAgICAgICAgICAgICAgLnJlcGxhY2Uoc3RyaW5nUmVzdG9yZVJFLCByZXN0b3JlU3RyaW5ncylcbiAgICAgICAgYm9keSA9IGFjY2Vzc29ycyArIGJvZHlcblxuICAgICAgICBmdW5jdGlvbiBzYXZlU3RyaW5ncyAoc3RyKSB7XG4gICAgICAgICAgICB2YXIgaSA9IHN0cmluZ3MubGVuZ3RoXG4gICAgICAgICAgICBzdHJpbmdzW2ldID0gc3RyXG4gICAgICAgICAgICByZXR1cm4gJ1wiJyArIGkgKyAnXCInXG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiByZXBsYWNlUGF0aCAocGF0aCkge1xuICAgICAgICAgICAgLy8ga2VlcCB0cmFjayBvZiB0aGUgZmlyc3QgY2hhclxuICAgICAgICAgICAgdmFyIGMgPSBwYXRoLmNoYXJBdCgwKVxuICAgICAgICAgICAgcGF0aCA9IHBhdGguc2xpY2UoMSlcbiAgICAgICAgICAgIHZhciB2YWwgPSAndGhpcy4nICsgZ2V0UmVsKHBhdGgsIGNvbXBpbGVyKSArIHBhdGhcbiAgICAgICAgICAgIGlmICghaGFzW3BhdGhdKSB7XG4gICAgICAgICAgICAgICAgYWNjZXNzb3JzICs9IHZhbCArICc7J1xuICAgICAgICAgICAgICAgIGhhc1twYXRoXSA9IDFcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGRvbid0IGZvcmdldCB0byBwdXQgdGhhdCBmaXJzdCBjaGFyIGJhY2tcbiAgICAgICAgICAgIHJldHVybiBjICsgdmFsXG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiByZXN0b3JlU3RyaW5ncyAoc3RyLCBpKSB7XG4gICAgICAgICAgICByZXR1cm4gc3RyaW5nc1tpXVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG1ha2VHZXR0ZXIoYm9keSwgZXhwKVxuICAgIH1cbn0iLCJ2YXIga2V5Q29kZXMgPSB7XG4gICAgZW50ZXIgICAgOiAxMyxcbiAgICB0YWIgICAgICA6IDksXG4gICAgJ2RlbGV0ZScgOiA0NixcbiAgICB1cCAgICAgICA6IDM4LFxuICAgIGxlZnQgICAgIDogMzcsXG4gICAgcmlnaHQgICAgOiAzOSxcbiAgICBkb3duICAgICA6IDQwLFxuICAgIGVzYyAgICAgIDogMjdcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICAvKipcbiAgICAgKiAgJ2FiYycgPT4gJ0FiYydcbiAgICAgKi9cbiAgICBjYXBpdGFsaXplOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgaWYgKCF2YWx1ZSAmJiB2YWx1ZSAhPT0gMCkgcmV0dXJuICcnXG4gICAgICAgIHZhbHVlID0gdmFsdWUudG9TdHJpbmcoKVxuICAgICAgICByZXR1cm4gdmFsdWUuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyB2YWx1ZS5zbGljZSgxKVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgJ2FiYycgPT4gJ0FCQydcbiAgICAgKi9cbiAgICB1cHBlcmNhc2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICByZXR1cm4gKHZhbHVlIHx8IHZhbHVlID09PSAwKVxuICAgICAgICAgICAgPyB2YWx1ZS50b1N0cmluZygpLnRvVXBwZXJDYXNlKClcbiAgICAgICAgICAgIDogJydcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogICdBYkMnID0+ICdhYmMnXG4gICAgICovXG4gICAgbG93ZXJjYXNlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgcmV0dXJuICh2YWx1ZSB8fCB2YWx1ZSA9PT0gMClcbiAgICAgICAgICAgID8gdmFsdWUudG9TdHJpbmcoKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgICAgICA6ICcnXG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICAxMjM0NSA9PiAkMTIsMzQ1LjAwXG4gICAgICovXG4gICAgY3VycmVuY3k6IGZ1bmN0aW9uICh2YWx1ZSwgYXJncykge1xuICAgICAgICBpZiAoIXZhbHVlICYmIHZhbHVlICE9PSAwKSByZXR1cm4gJydcbiAgICAgICAgdmFyIHNpZ24gPSAoYXJncyAmJiBhcmdzWzBdKSB8fCAnJCcsXG4gICAgICAgICAgICBzID0gTWF0aC5mbG9vcih2YWx1ZSkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIGkgPSBzLmxlbmd0aCAlIDMsXG4gICAgICAgICAgICBoID0gaSA+IDAgPyAocy5zbGljZSgwLCBpKSArIChzLmxlbmd0aCA+IDMgPyAnLCcgOiAnJykpIDogJycsXG4gICAgICAgICAgICBmID0gJy4nICsgdmFsdWUudG9GaXhlZCgyKS5zbGljZSgtMilcbiAgICAgICAgcmV0dXJuIHNpZ24gKyBoICsgcy5zbGljZShpKS5yZXBsYWNlKC8oXFxkezN9KSg/PVxcZCkvZywgJyQxLCcpICsgZlxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgYXJnczogYW4gYXJyYXkgb2Ygc3RyaW5ncyBjb3JyZXNwb25kaW5nIHRvXG4gICAgICogIHRoZSBzaW5nbGUsIGRvdWJsZSwgdHJpcGxlIC4uLiBmb3JtcyBvZiB0aGUgd29yZCB0b1xuICAgICAqICBiZSBwbHVyYWxpemVkLiBXaGVuIHRoZSBudW1iZXIgdG8gYmUgcGx1cmFsaXplZFxuICAgICAqICBleGNlZWRzIHRoZSBsZW5ndGggb2YgdGhlIGFyZ3MsIGl0IHdpbGwgdXNlIHRoZSBsYXN0XG4gICAgICogIGVudHJ5IGluIHRoZSBhcnJheS5cbiAgICAgKlxuICAgICAqICBlLmcuIFsnc2luZ2xlJywgJ2RvdWJsZScsICd0cmlwbGUnLCAnbXVsdGlwbGUnXVxuICAgICAqL1xuICAgIHBsdXJhbGl6ZTogZnVuY3Rpb24gKHZhbHVlLCBhcmdzKSB7XG4gICAgICAgIHJldHVybiBhcmdzLmxlbmd0aCA+IDFcbiAgICAgICAgICAgID8gKGFyZ3NbdmFsdWUgLSAxXSB8fCBhcmdzW2FyZ3MubGVuZ3RoIC0gMV0pXG4gICAgICAgICAgICA6IChhcmdzW3ZhbHVlIC0gMV0gfHwgYXJnc1swXSArICdzJylcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIEEgc3BlY2lhbCBmaWx0ZXIgdGhhdCB0YWtlcyBhIGhhbmRsZXIgZnVuY3Rpb24sXG4gICAgICogIHdyYXBzIGl0IHNvIGl0IG9ubHkgZ2V0cyB0cmlnZ2VyZWQgb24gc3BlY2lmaWMga2V5cHJlc3Nlcy5cbiAgICAgKi9cbiAgICBrZXk6IGZ1bmN0aW9uIChoYW5kbGVyLCBhcmdzKSB7XG4gICAgICAgIGlmICghaGFuZGxlcikgcmV0dXJuXG4gICAgICAgIHZhciBjb2RlID0ga2V5Q29kZXNbYXJnc1swXV1cbiAgICAgICAgaWYgKCFjb2RlKSB7XG4gICAgICAgICAgICBjb2RlID0gcGFyc2VJbnQoYXJnc1swXSwgMTApXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChlKSB7XG4gICAgICAgICAgICBpZiAoZS5rZXlDb2RlID09PSBjb2RlKSB7XG4gICAgICAgICAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59IiwidmFyIGNvbmZpZyAgICAgID0gcmVxdWlyZSgnLi9jb25maWcnKSxcbiAgICBWaWV3TW9kZWwgICA9IHJlcXVpcmUoJy4vdmlld21vZGVsJyksXG4gICAgdXRpbHMgICAgICAgPSByZXF1aXJlKCcuL3V0aWxzJyksXG4gICAgbWFrZUhhc2ggICAgPSB1dGlscy5oYXNoLFxuICAgIGFzc2V0VHlwZXMgID0gWydkaXJlY3RpdmUnLCAnZmlsdGVyJywgJ3BhcnRpYWwnLCAnZWZmZWN0JywgJ2NvbXBvbmVudCddXG5cbi8vIHJlcXVpcmUgdGhlc2Ugc28gQnJvd3NlcmlmeSBjYW4gY2F0Y2ggdGhlbVxuLy8gc28gdGhleSBjYW4gYmUgdXNlZCBpbiBWdWUucmVxdWlyZVxucmVxdWlyZSgnLi9vYnNlcnZlcicpXG5yZXF1aXJlKCcuL3RyYW5zaXRpb24nKVxuXG5WaWV3TW9kZWwub3B0aW9ucyA9IGNvbmZpZy5nbG9iYWxBc3NldHMgPSB7XG4gICAgZGlyZWN0aXZlcyAgOiByZXF1aXJlKCcuL2RpcmVjdGl2ZXMnKSxcbiAgICBmaWx0ZXJzICAgICA6IHJlcXVpcmUoJy4vZmlsdGVycycpLFxuICAgIHBhcnRpYWxzICAgIDogbWFrZUhhc2goKSxcbiAgICBlZmZlY3RzICAgICA6IG1ha2VIYXNoKCksXG4gICAgY29tcG9uZW50cyAgOiBtYWtlSGFzaCgpXG59XG5cbi8qKlxuICogIEV4cG9zZSBhc3NldCByZWdpc3RyYXRpb24gbWV0aG9kc1xuICovXG5hc3NldFR5cGVzLmZvckVhY2goZnVuY3Rpb24gKHR5cGUpIHtcbiAgICBWaWV3TW9kZWxbdHlwZV0gPSBmdW5jdGlvbiAoaWQsIHZhbHVlKSB7XG4gICAgICAgIHZhciBoYXNoID0gdGhpcy5vcHRpb25zW3R5cGUgKyAncyddXG4gICAgICAgIGlmICghaGFzaCkge1xuICAgICAgICAgICAgaGFzaCA9IHRoaXMub3B0aW9uc1t0eXBlICsgJ3MnXSA9IG1ha2VIYXNoKClcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXZhbHVlKSByZXR1cm4gaGFzaFtpZF1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdwYXJ0aWFsJykge1xuICAgICAgICAgICAgdmFsdWUgPSB1dGlscy50b0ZyYWdtZW50KHZhbHVlKVxuICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdjb21wb25lbnQnKSB7XG4gICAgICAgICAgICB2YWx1ZSA9IHV0aWxzLnRvQ29uc3RydWN0b3IodmFsdWUpXG4gICAgICAgIH1cbiAgICAgICAgaGFzaFtpZF0gPSB2YWx1ZVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cbn0pXG5cbi8qKlxuICogIFNldCBjb25maWcgb3B0aW9uc1xuICovXG5WaWV3TW9kZWwuY29uZmlnID0gZnVuY3Rpb24gKG9wdHMsIHZhbCkge1xuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgaWYgKHZhbCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gY29uZmlnW29wdHNdXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25maWdbb3B0c10gPSB2YWxcbiAgICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAgIHV0aWxzLmV4dGVuZChjb25maWcsIG9wdHMpXG4gICAgfVxuICAgIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogIEV4cG9zZSBhbiBpbnRlcmZhY2UgZm9yIHBsdWdpbnNcbiAqL1xuVmlld01vZGVsLnVzZSA9IGZ1bmN0aW9uIChwbHVnaW4pIHtcbiAgICBpZiAodHlwZW9mIHBsdWdpbiA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHBsdWdpbiA9IHJlcXVpcmUocGx1Z2luKVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICByZXR1cm4gdXRpbHMud2FybignQ2Fubm90IGZpbmQgcGx1Z2luOiAnICsgcGx1Z2luKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gYWRkaXRpb25hbCBwYXJhbWV0ZXJzXG4gICAgdmFyIGFyZ3MgPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICBhcmdzLnVuc2hpZnQodGhpcylcblxuICAgIGlmICh0eXBlb2YgcGx1Z2luLmluc3RhbGwgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcGx1Z2luLmluc3RhbGwuYXBwbHkocGx1Z2luLCBhcmdzKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIHBsdWdpbi5hcHBseShudWxsLCBhcmdzKVxuICAgIH1cbiAgICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqICBFeHBvc2UgaW50ZXJuYWwgbW9kdWxlcyBmb3IgcGx1Z2luc1xuICovXG5WaWV3TW9kZWwucmVxdWlyZSA9IGZ1bmN0aW9uIChwYXRoKSB7XG4gICAgcmV0dXJuIHJlcXVpcmUoJy4vJyArIHBhdGgpXG59XG5cblZpZXdNb2RlbC5leHRlbmQgPSBleHRlbmRcblZpZXdNb2RlbC5uZXh0VGljayA9IHV0aWxzLm5leHRUaWNrXG5cbi8qKlxuICogIEV4cG9zZSB0aGUgbWFpbiBWaWV3TW9kZWwgY2xhc3NcbiAqICBhbmQgYWRkIGV4dGVuZCBtZXRob2RcbiAqL1xuZnVuY3Rpb24gZXh0ZW5kIChvcHRpb25zKSB7XG5cbiAgICB2YXIgUGFyZW50Vk0gPSB0aGlzXG5cbiAgICAvLyBpbmhlcml0IG9wdGlvbnNcbiAgICBvcHRpb25zID0gaW5oZXJpdE9wdGlvbnMob3B0aW9ucywgUGFyZW50Vk0ub3B0aW9ucywgdHJ1ZSlcbiAgICB1dGlscy5wcm9jZXNzT3B0aW9ucyhvcHRpb25zKVxuXG4gICAgdmFyIEV4dGVuZGVkVk0gPSBmdW5jdGlvbiAob3B0cywgYXNQYXJlbnQpIHtcbiAgICAgICAgaWYgKCFhc1BhcmVudCkge1xuICAgICAgICAgICAgb3B0cyA9IGluaGVyaXRPcHRpb25zKG9wdHMsIG9wdGlvbnMsIHRydWUpXG4gICAgICAgIH1cbiAgICAgICAgUGFyZW50Vk0uY2FsbCh0aGlzLCBvcHRzLCB0cnVlKVxuICAgIH1cblxuICAgIC8vIGluaGVyaXQgcHJvdG90eXBlIHByb3BzXG4gICAgdmFyIHByb3RvID0gRXh0ZW5kZWRWTS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKFBhcmVudFZNLnByb3RvdHlwZSlcbiAgICB1dGlscy5kZWZQcm90ZWN0ZWQocHJvdG8sICdjb25zdHJ1Y3RvcicsIEV4dGVuZGVkVk0pXG5cbiAgICAvLyBjb3B5IHByb3RvdHlwZSBwcm9wc1xuICAgIHZhciBtZXRob2RzID0gb3B0aW9ucy5tZXRob2RzXG4gICAgaWYgKG1ldGhvZHMpIHtcbiAgICAgICAgZm9yICh2YXIga2V5IGluIG1ldGhvZHMpIHtcbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAhKGtleSBpbiBWaWV3TW9kZWwucHJvdG90eXBlKSAmJlxuICAgICAgICAgICAgICAgIHR5cGVvZiBtZXRob2RzW2tleV0gPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIHByb3RvW2tleV0gPSBtZXRob2RzW2tleV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGFsbG93IGV4dGVuZGVkIFZNIHRvIGJlIGZ1cnRoZXIgZXh0ZW5kZWRcbiAgICBFeHRlbmRlZFZNLmV4dGVuZCAgPSBleHRlbmRcbiAgICBFeHRlbmRlZFZNLnN1cGVyICAgPSBQYXJlbnRWTVxuICAgIEV4dGVuZGVkVk0ub3B0aW9ucyA9IG9wdGlvbnNcblxuICAgIC8vIGFsbG93IGV4dGVuZGVkIFZNIHRvIGFkZCBpdHMgb3duIGFzc2V0c1xuICAgIGFzc2V0VHlwZXMuZm9yRWFjaChmdW5jdGlvbiAodHlwZSkge1xuICAgICAgICBFeHRlbmRlZFZNW3R5cGVdID0gVmlld01vZGVsW3R5cGVdXG4gICAgfSlcblxuICAgIC8vIGFsbG93IGV4dGVuZGVkIFZNIHRvIHVzZSBwbHVnaW5zXG4gICAgRXh0ZW5kZWRWTS51c2UgICAgID0gVmlld01vZGVsLnVzZVxuICAgIEV4dGVuZGVkVk0ucmVxdWlyZSA9IFZpZXdNb2RlbC5yZXF1aXJlXG5cbiAgICByZXR1cm4gRXh0ZW5kZWRWTVxufVxuXG4vKipcbiAqICBJbmhlcml0IG9wdGlvbnNcbiAqXG4gKiAgRm9yIG9wdGlvbnMgc3VjaCBhcyBgZGF0YWAsIGB2bXNgLCBgZGlyZWN0aXZlc2AsICdwYXJ0aWFscycsXG4gKiAgdGhleSBzaG91bGQgYmUgZnVydGhlciBleHRlbmRlZC4gSG93ZXZlciBleHRlbmRpbmcgc2hvdWxkIG9ubHlcbiAqICBiZSBkb25lIGF0IHRvcCBsZXZlbC5cbiAqICBcbiAqICBgcHJvdG9gIGlzIGFuIGV4Y2VwdGlvbiBiZWNhdXNlIGl0J3MgaGFuZGxlZCBkaXJlY3RseSBvbiB0aGVcbiAqICBwcm90b3R5cGUuXG4gKlxuICogIGBlbGAgaXMgYW4gZXhjZXB0aW9uIGJlY2F1c2UgaXQncyBub3QgYWxsb3dlZCBhcyBhblxuICogIGV4dGVuc2lvbiBvcHRpb24sIGJ1dCBvbmx5IGFzIGFuIGluc3RhbmNlIG9wdGlvbi5cbiAqL1xuZnVuY3Rpb24gaW5oZXJpdE9wdGlvbnMgKGNoaWxkLCBwYXJlbnQsIHRvcExldmVsKSB7XG4gICAgY2hpbGQgPSBjaGlsZCB8fCB7fVxuICAgIGlmICghcGFyZW50KSByZXR1cm4gY2hpbGRcbiAgICBmb3IgKHZhciBrZXkgaW4gcGFyZW50KSB7XG4gICAgICAgIGlmIChrZXkgPT09ICdlbCcgfHwga2V5ID09PSAnbWV0aG9kcycpIGNvbnRpbnVlXG4gICAgICAgIHZhciB2YWwgPSBjaGlsZFtrZXldLFxuICAgICAgICAgICAgcGFyZW50VmFsID0gcGFyZW50W2tleV0sXG4gICAgICAgICAgICB0eXBlID0gdXRpbHMudHlwZU9mKHZhbCksXG4gICAgICAgICAgICBwYXJlbnRUeXBlID0gdXRpbHMudHlwZU9mKHBhcmVudFZhbClcbiAgICAgICAgaWYgKHRvcExldmVsICYmIHR5cGUgPT09ICdGdW5jdGlvbicgJiYgcGFyZW50VmFsKSB7XG4gICAgICAgICAgICAvLyBtZXJnZSBob29rIGZ1bmN0aW9ucyBpbnRvIGFuIGFycmF5XG4gICAgICAgICAgICBjaGlsZFtrZXldID0gW3ZhbF1cbiAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcmVudFZhbCkpIHtcbiAgICAgICAgICAgICAgICBjaGlsZFtrZXldID0gY2hpbGRba2V5XS5jb25jYXQocGFyZW50VmFsKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjaGlsZFtrZXldLnB1c2gocGFyZW50VmFsKVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHRvcExldmVsICYmICh0eXBlID09PSAnT2JqZWN0JyB8fCBwYXJlbnRUeXBlID09PSAnT2JqZWN0JykpIHtcbiAgICAgICAgICAgIC8vIG1lcmdlIHRvcGxldmVsIG9iamVjdCBvcHRpb25zXG4gICAgICAgICAgICBjaGlsZFtrZXldID0gaW5oZXJpdE9wdGlvbnModmFsLCBwYXJlbnRWYWwpXG4gICAgICAgIH0gZWxzZSBpZiAodmFsID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIC8vIGluaGVyaXQgaWYgY2hpbGQgZG9lc24ndCBvdmVycmlkZVxuICAgICAgICAgICAgY2hpbGRba2V5XSA9IHBhcmVudFZhbFxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjaGlsZFxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXdNb2RlbCIsIi8qIGpzaGludCBwcm90bzp0cnVlICovXG5cbnZhciBFbWl0dGVyICA9IHJlcXVpcmUoJy4vZW1pdHRlcicpLFxuICAgIHV0aWxzICAgID0gcmVxdWlyZSgnLi91dGlscycpLFxuICAgIC8vIGNhY2hlIG1ldGhvZHNcbiAgICB0eXBlT2YgICA9IHV0aWxzLnR5cGVPZixcbiAgICBkZWYgICAgICA9IHV0aWxzLmRlZlByb3RlY3RlZCxcbiAgICBzbGljZSAgICA9IFtdLnNsaWNlLFxuICAgIC8vIHR5cGVzXG4gICAgT0JKRUNUICAgPSAnT2JqZWN0JyxcbiAgICBBUlJBWSAgICA9ICdBcnJheScsXG4gICAgLy8gZml4IGZvciBJRSArIF9fcHJvdG9fXyBwcm9ibGVtXG4gICAgLy8gZGVmaW5lIG1ldGhvZHMgYXMgaW5lbnVtZXJhYmxlIGlmIF9fcHJvdG9fXyBpcyBwcmVzZW50LFxuICAgIC8vIG90aGVyd2lzZSBlbnVtZXJhYmxlIHNvIHdlIGNhbiBsb29wIHRocm91Z2ggYW5kIG1hbnVhbGx5XG4gICAgLy8gYXR0YWNoIHRvIGFycmF5IGluc3RhbmNlc1xuICAgIGhhc1Byb3RvID0gKHt9KS5fX3Byb3RvX18sXG4gICAgLy8gbGF6eSBsb2FkXG4gICAgVmlld01vZGVsXG5cbi8vIEFycmF5IE11dGF0aW9uIEhhbmRsZXJzICYgQXVnbWVudGF0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gVGhlIHByb3h5IHByb3RvdHlwZSB0byByZXBsYWNlIHRoZSBfX3Byb3RvX18gb2Zcbi8vIGFuIG9ic2VydmVkIGFycmF5XG52YXIgQXJyYXlQcm94eSA9IE9iamVjdC5jcmVhdGUoQXJyYXkucHJvdG90eXBlKVxuXG4vLyBpbnRlcmNlcHQgbXV0YXRpb24gbWV0aG9kc1xuO1tcbiAgICAncHVzaCcsXG4gICAgJ3BvcCcsXG4gICAgJ3NoaWZ0JyxcbiAgICAndW5zaGlmdCcsXG4gICAgJ3NwbGljZScsXG4gICAgJ3NvcnQnLFxuICAgICdyZXZlcnNlJ1xuXS5mb3JFYWNoKHdhdGNoTXV0YXRpb24pXG5cbi8vIEF1Z21lbnQgdGhlIEFycmF5UHJveHkgd2l0aCBjb252ZW5pZW5jZSBtZXRob2RzXG5kZWYoQXJyYXlQcm94eSwgJ3JlbW92ZScsIHJlbW92ZUVsZW1lbnQsICFoYXNQcm90bylcbmRlZihBcnJheVByb3h5LCAnc2V0JywgcmVwbGFjZUVsZW1lbnQsICFoYXNQcm90bylcbmRlZihBcnJheVByb3h5LCAncmVwbGFjZScsIHJlcGxhY2VFbGVtZW50LCAhaGFzUHJvdG8pXG5cbi8qKlxuICogIEludGVyY2VwIGEgbXV0YXRpb24gZXZlbnQgc28gd2UgY2FuIGVtaXQgdGhlIG11dGF0aW9uIGluZm8uXG4gKiAgd2UgYWxzbyBhbmFseXplIHdoYXQgZWxlbWVudHMgYXJlIGFkZGVkL3JlbW92ZWQgYW5kIGxpbmsvdW5saW5rXG4gKiAgdGhlbSB3aXRoIHRoZSBwYXJlbnQgQXJyYXkuXG4gKi9cbmZ1bmN0aW9uIHdhdGNoTXV0YXRpb24gKG1ldGhvZCkge1xuICAgIGRlZihBcnJheVByb3h5LCBtZXRob2QsIGZ1bmN0aW9uICgpIHtcblxuICAgICAgICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzKSxcbiAgICAgICAgICAgIHJlc3VsdCA9IEFycmF5LnByb3RvdHlwZVttZXRob2RdLmFwcGx5KHRoaXMsIGFyZ3MpLFxuICAgICAgICAgICAgaW5zZXJ0ZWQsIHJlbW92ZWRcblxuICAgICAgICAvLyBkZXRlcm1pbmUgbmV3IC8gcmVtb3ZlZCBlbGVtZW50c1xuICAgICAgICBpZiAobWV0aG9kID09PSAncHVzaCcgfHwgbWV0aG9kID09PSAndW5zaGlmdCcpIHtcbiAgICAgICAgICAgIGluc2VydGVkID0gYXJnc1xuICAgICAgICB9IGVsc2UgaWYgKG1ldGhvZCA9PT0gJ3BvcCcgfHwgbWV0aG9kID09PSAnc2hpZnQnKSB7XG4gICAgICAgICAgICByZW1vdmVkID0gW3Jlc3VsdF1cbiAgICAgICAgfSBlbHNlIGlmIChtZXRob2QgPT09ICdzcGxpY2UnKSB7XG4gICAgICAgICAgICBpbnNlcnRlZCA9IGFyZ3Muc2xpY2UoMilcbiAgICAgICAgICAgIHJlbW92ZWQgPSByZXN1bHRcbiAgICAgICAgfVxuICAgICAgICAvLyBsaW5rICYgdW5saW5rXG4gICAgICAgIGxpbmtBcnJheUVsZW1lbnRzKHRoaXMsIGluc2VydGVkKVxuICAgICAgICB1bmxpbmtBcnJheUVsZW1lbnRzKHRoaXMsIHJlbW92ZWQpXG5cbiAgICAgICAgLy8gZW1pdCB0aGUgbXV0YXRpb24gZXZlbnRcbiAgICAgICAgdGhpcy5fX2VtaXR0ZXJfXy5lbWl0KCdtdXRhdGUnLCBudWxsLCB0aGlzLCB7XG4gICAgICAgICAgICBtZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICAgIGFyZ3M6IGFyZ3MsXG4gICAgICAgICAgICByZXN1bHQ6IHJlc3VsdFxuICAgICAgICB9KVxuXG4gICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgICAgXG4gICAgfSwgIWhhc1Byb3RvKVxufVxuXG4vKipcbiAqICBMaW5rIG5ldyBlbGVtZW50cyB0byBhbiBBcnJheSwgc28gd2hlbiB0aGV5IGNoYW5nZVxuICogIGFuZCBlbWl0IGV2ZW50cywgdGhlIG93bmVyIEFycmF5IGNhbiBiZSBub3RpZmllZC5cbiAqL1xuZnVuY3Rpb24gbGlua0FycmF5RWxlbWVudHMgKGFyciwgaXRlbXMpIHtcbiAgICBpZiAoaXRlbXMpIHtcbiAgICAgICAgdmFyIGkgPSBpdGVtcy5sZW5ndGgsIGl0ZW0sIG93bmVyc1xuICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICBpdGVtID0gaXRlbXNbaV1cbiAgICAgICAgICAgIGlmIChpc1dhdGNoYWJsZShpdGVtKSkge1xuICAgICAgICAgICAgICAgIGNvbnZlcnQoaXRlbSlcbiAgICAgICAgICAgICAgICB3YXRjaChpdGVtKVxuICAgICAgICAgICAgICAgIG93bmVycyA9IGl0ZW0uX19lbWl0dGVyX18ub3duZXJzXG4gICAgICAgICAgICAgICAgaWYgKG93bmVycy5pbmRleE9mKGFycikgPCAwKSB7XG4gICAgICAgICAgICAgICAgICAgIG93bmVycy5wdXNoKGFycilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qKlxuICogIFVubGluayByZW1vdmVkIGVsZW1lbnRzIGZyb20gdGhlIGV4LW93bmVyIEFycmF5LlxuICovXG5mdW5jdGlvbiB1bmxpbmtBcnJheUVsZW1lbnRzIChhcnIsIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW1zKSB7XG4gICAgICAgIHZhciBpID0gaXRlbXMubGVuZ3RoLCBpdGVtXG4gICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgIGl0ZW0gPSBpdGVtc1tpXVxuICAgICAgICAgICAgaWYgKGl0ZW0gJiYgaXRlbS5fX2VtaXR0ZXJfXykge1xuICAgICAgICAgICAgICAgIHZhciBvd25lcnMgPSBpdGVtLl9fZW1pdHRlcl9fLm93bmVyc1xuICAgICAgICAgICAgICAgIGlmIChvd25lcnMpIG93bmVycy5zcGxpY2Uob3duZXJzLmluZGV4T2YoYXJyKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxuLyoqXG4gKiAgQ29udmVuaWVuY2UgbWV0aG9kIHRvIHJlbW92ZSBhbiBlbGVtZW50IGluIGFuIEFycmF5XG4gKiAgVGhpcyB3aWxsIGJlIGF0dGFjaGVkIHRvIG9ic2VydmVkIEFycmF5IGluc3RhbmNlc1xuICovXG5mdW5jdGlvbiByZW1vdmVFbGVtZW50IChpbmRleCkge1xuICAgIGlmICh0eXBlb2YgaW5kZXggPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFyIGkgPSB0aGlzLmxlbmd0aCxcbiAgICAgICAgICAgIHJlbW92ZWQgPSBbXVxuICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICBpZiAoaW5kZXgodGhpc1tpXSkpIHtcbiAgICAgICAgICAgICAgICByZW1vdmVkLnB1c2godGhpcy5zcGxpY2UoaSwgMSlbMF0pXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlbW92ZWQucmV2ZXJzZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHR5cGVvZiBpbmRleCAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIGluZGV4ID0gdGhpcy5pbmRleE9mKGluZGV4KVxuICAgICAgICB9XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zcGxpY2UoaW5kZXgsIDEpWzBdXG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qKlxuICogIENvbnZlbmllbmNlIG1ldGhvZCB0byByZXBsYWNlIGFuIGVsZW1lbnQgaW4gYW4gQXJyYXlcbiAqICBUaGlzIHdpbGwgYmUgYXR0YWNoZWQgdG8gb2JzZXJ2ZWQgQXJyYXkgaW5zdGFuY2VzXG4gKi9cbmZ1bmN0aW9uIHJlcGxhY2VFbGVtZW50IChpbmRleCwgZGF0YSkge1xuICAgIGlmICh0eXBlb2YgaW5kZXggPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFyIGkgPSB0aGlzLmxlbmd0aCxcbiAgICAgICAgICAgIHJlcGxhY2VkID0gW10sXG4gICAgICAgICAgICByZXBsYWNlclxuICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICByZXBsYWNlciA9IGluZGV4KHRoaXNbaV0pXG4gICAgICAgICAgICBpZiAocmVwbGFjZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHJlcGxhY2VkLnB1c2godGhpcy5zcGxpY2UoaSwgMSwgcmVwbGFjZXIpWzBdKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXBsYWNlZC5yZXZlcnNlKClcbiAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodHlwZW9mIGluZGV4ICE9PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgaW5kZXggPSB0aGlzLmluZGV4T2YoaW5kZXgpXG4gICAgICAgIH1cbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNwbGljZShpbmRleCwgMSwgZGF0YSlbMF1cbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy8gV2F0Y2ggSGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqICBDaGVjayBpZiBhIHZhbHVlIGlzIHdhdGNoYWJsZVxuICovXG5mdW5jdGlvbiBpc1dhdGNoYWJsZSAob2JqKSB7XG4gICAgVmlld01vZGVsID0gVmlld01vZGVsIHx8IHJlcXVpcmUoJy4vdmlld21vZGVsJylcbiAgICB2YXIgdHlwZSA9IHR5cGVPZihvYmopXG4gICAgcmV0dXJuICh0eXBlID09PSBPQkpFQ1QgfHwgdHlwZSA9PT0gQVJSQVkpICYmICEob2JqIGluc3RhbmNlb2YgVmlld01vZGVsKVxufVxuXG4vKipcbiAqICBDb252ZXJ0IGFuIE9iamVjdC9BcnJheSB0byBnaXZlIGl0IGEgY2hhbmdlIGVtaXR0ZXIuXG4gKi9cbmZ1bmN0aW9uIGNvbnZlcnQgKG9iaikge1xuICAgIGlmIChvYmouX19lbWl0dGVyX18pIHJldHVybiB0cnVlXG4gICAgdmFyIGVtaXR0ZXIgPSBuZXcgRW1pdHRlcigpXG4gICAgZGVmKG9iaiwgJ19fZW1pdHRlcl9fJywgZW1pdHRlcilcbiAgICBlbWl0dGVyLm9uKCdzZXQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBvd25lcnMgPSBvYmouX19lbWl0dGVyX18ub3duZXJzLFxuICAgICAgICAgICAgaSA9IG93bmVycy5sZW5ndGhcbiAgICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICAgICAgb3duZXJzW2ldLl9fZW1pdHRlcl9fLmVtaXQoJ3NldCcsICcnLCAnJywgdHJ1ZSlcbiAgICAgICAgfVxuICAgIH0pXG4gICAgZW1pdHRlci52YWx1ZXMgPSB1dGlscy5oYXNoKClcbiAgICBlbWl0dGVyLm93bmVycyA9IFtdXG4gICAgcmV0dXJuIGZhbHNlXG59XG5cbi8qKlxuICogIFdhdGNoIHRhcmdldCBiYXNlZCBvbiBpdHMgdHlwZVxuICovXG5mdW5jdGlvbiB3YXRjaCAob2JqKSB7XG4gICAgdmFyIHR5cGUgPSB0eXBlT2Yob2JqKVxuICAgIGlmICh0eXBlID09PSBPQkpFQ1QpIHtcbiAgICAgICAgd2F0Y2hPYmplY3Qob2JqKVxuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gQVJSQVkpIHtcbiAgICAgICAgd2F0Y2hBcnJheShvYmopXG4gICAgfVxufVxuXG4vKipcbiAqICBXYXRjaCBhbiBPYmplY3QsIHJlY3Vyc2l2ZS5cbiAqL1xuZnVuY3Rpb24gd2F0Y2hPYmplY3QgKG9iaikge1xuICAgIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICAgICAgY29udmVydEtleShvYmosIGtleSlcbiAgICB9XG59XG5cbi8qKlxuICogIFdhdGNoIGFuIEFycmF5LCBvdmVybG9hZCBtdXRhdGlvbiBtZXRob2RzXG4gKiAgYW5kIGFkZCBhdWdtZW50YXRpb25zIGJ5IGludGVyY2VwdGluZyB0aGUgcHJvdG90eXBlIGNoYWluXG4gKi9cbmZ1bmN0aW9uIHdhdGNoQXJyYXkgKGFycikge1xuICAgIGlmIChoYXNQcm90bykge1xuICAgICAgICBhcnIuX19wcm90b19fID0gQXJyYXlQcm94eVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAodmFyIGtleSBpbiBBcnJheVByb3h5KSB7XG4gICAgICAgICAgICBkZWYoYXJyLCBrZXksIEFycmF5UHJveHlba2V5XSlcbiAgICAgICAgfVxuICAgIH1cbiAgICBsaW5rQXJyYXlFbGVtZW50cyhhcnIsIGFycilcbn1cblxuLyoqXG4gKiAgRGVmaW5lIGFjY2Vzc29ycyBmb3IgYSBwcm9wZXJ0eSBvbiBhbiBPYmplY3RcbiAqICBzbyBpdCBlbWl0cyBnZXQvc2V0IGV2ZW50cy5cbiAqICBUaGVuIHdhdGNoIHRoZSB2YWx1ZSBpdHNlbGYuXG4gKi9cbmZ1bmN0aW9uIGNvbnZlcnRLZXkgKG9iaiwga2V5KSB7XG4gICAgdmFyIGtleVByZWZpeCA9IGtleS5jaGFyQXQoMClcbiAgICBpZiAoa2V5UHJlZml4ID09PSAnJCcgfHwga2V5UHJlZml4ID09PSAnXycpIHtcbiAgICAgICAgcmV0dXJuXG4gICAgfVxuICAgIC8vIGVtaXQgc2V0IG9uIGJpbmRcbiAgICAvLyB0aGlzIG1lYW5zIHdoZW4gYW4gb2JqZWN0IGlzIG9ic2VydmVkIGl0IHdpbGwgZW1pdFxuICAgIC8vIGEgZmlyc3QgYmF0Y2ggb2Ygc2V0IGV2ZW50cy5cbiAgICB2YXIgZW1pdHRlciA9IG9iai5fX2VtaXR0ZXJfXyxcbiAgICAgICAgdmFsdWVzICA9IGVtaXR0ZXIudmFsdWVzXG5cbiAgICBpbml0KG9ialtrZXldKVxuXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHZhbHVlID0gdmFsdWVzW2tleV1cbiAgICAgICAgICAgIC8vIG9ubHkgZW1pdCBnZXQgb24gdGlwIHZhbHVlc1xuICAgICAgICAgICAgaWYgKHB1Yi5zaG91bGRHZXQgJiYgdHlwZU9mKHZhbHVlKSAhPT0gT0JKRUNUKSB7XG4gICAgICAgICAgICAgICAgZW1pdHRlci5lbWl0KCdnZXQnLCBrZXkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdmFsdWVcbiAgICAgICAgfSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbiAobmV3VmFsKSB7XG4gICAgICAgICAgICB2YXIgb2xkVmFsID0gdmFsdWVzW2tleV1cbiAgICAgICAgICAgIHVub2JzZXJ2ZShvbGRWYWwsIGtleSwgZW1pdHRlcilcbiAgICAgICAgICAgIGNvcHlQYXRocyhuZXdWYWwsIG9sZFZhbClcbiAgICAgICAgICAgIC8vIGFuIGltbWVkaWF0ZSBwcm9wZXJ0eSBzaG91bGQgbm90aWZ5IGl0cyBwYXJlbnRcbiAgICAgICAgICAgIC8vIHRvIGVtaXQgc2V0IGZvciBpdHNlbGYgdG9vXG4gICAgICAgICAgICBpbml0KG5ld1ZhbCwgdHJ1ZSlcbiAgICAgICAgfVxuICAgIH0pXG5cbiAgICBmdW5jdGlvbiBpbml0ICh2YWwsIHByb3BhZ2F0ZSkge1xuICAgICAgICB2YWx1ZXNba2V5XSA9IHZhbFxuICAgICAgICBlbWl0dGVyLmVtaXQoJ3NldCcsIGtleSwgdmFsLCBwcm9wYWdhdGUpXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbCkpIHtcbiAgICAgICAgICAgIGVtaXR0ZXIuZW1pdCgnc2V0Jywga2V5ICsgJy5sZW5ndGgnLCB2YWwubGVuZ3RoKVxuICAgICAgICB9XG4gICAgICAgIG9ic2VydmUodmFsLCBrZXksIGVtaXR0ZXIpXG4gICAgfVxufVxuXG4vKipcbiAqICBXaGVuIGEgdmFsdWUgdGhhdCBpcyBhbHJlYWR5IGNvbnZlcnRlZCBpc1xuICogIG9ic2VydmVkIGFnYWluIGJ5IGFub3RoZXIgb2JzZXJ2ZXIsIHdlIGNhbiBza2lwXG4gKiAgdGhlIHdhdGNoIGNvbnZlcnNpb24gYW5kIHNpbXBseSBlbWl0IHNldCBldmVudCBmb3JcbiAqICBhbGwgb2YgaXRzIHByb3BlcnRpZXMuXG4gKi9cbmZ1bmN0aW9uIGVtaXRTZXQgKG9iaikge1xuICAgIHZhciB0eXBlID0gdHlwZU9mKG9iaiksXG4gICAgICAgIGVtaXR0ZXIgPSBvYmogJiYgb2JqLl9fZW1pdHRlcl9fXG4gICAgaWYgKHR5cGUgPT09IEFSUkFZKSB7XG4gICAgICAgIGVtaXR0ZXIuZW1pdCgnc2V0JywgJ2xlbmd0aCcsIG9iai5sZW5ndGgpXG4gICAgfSBlbHNlIGlmICh0eXBlID09PSBPQkpFQ1QpIHtcbiAgICAgICAgdmFyIGtleSwgdmFsXG4gICAgICAgIGZvciAoa2V5IGluIG9iaikge1xuICAgICAgICAgICAgdmFsID0gb2JqW2tleV1cbiAgICAgICAgICAgIGVtaXR0ZXIuZW1pdCgnc2V0Jywga2V5LCB2YWwpXG4gICAgICAgICAgICBlbWl0U2V0KHZhbClcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLyoqXG4gKiAgTWFrZSBzdXJlIGFsbCB0aGUgcGF0aHMgaW4gYW4gb2xkIG9iamVjdCBleGlzdHNcbiAqICBpbiBhIG5ldyBvYmplY3QuXG4gKiAgU28gd2hlbiBhbiBvYmplY3QgY2hhbmdlcywgYWxsIG1pc3Npbmcga2V5cyB3aWxsXG4gKiAgZW1pdCBhIHNldCBldmVudCB3aXRoIHVuZGVmaW5lZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gY29weVBhdGhzIChuZXdPYmosIG9sZE9iaikge1xuICAgIGlmICh0eXBlT2Yob2xkT2JqKSAhPT0gT0JKRUNUIHx8IHR5cGVPZihuZXdPYmopICE9PSBPQkpFQ1QpIHtcbiAgICAgICAgcmV0dXJuXG4gICAgfVxuICAgIHZhciBwYXRoLCB0eXBlLCBvbGRWYWwsIG5ld1ZhbFxuICAgIGZvciAocGF0aCBpbiBvbGRPYmopIHtcbiAgICAgICAgaWYgKCEocGF0aCBpbiBuZXdPYmopKSB7XG4gICAgICAgICAgICBvbGRWYWwgPSBvbGRPYmpbcGF0aF1cbiAgICAgICAgICAgIHR5cGUgPSB0eXBlT2Yob2xkVmFsKVxuICAgICAgICAgICAgaWYgKHR5cGUgPT09IE9CSkVDVCkge1xuICAgICAgICAgICAgICAgIG5ld1ZhbCA9IG5ld09ialtwYXRoXSA9IHt9XG4gICAgICAgICAgICAgICAgY29weVBhdGhzKG5ld1ZhbCwgb2xkVmFsKVxuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSBBUlJBWSkge1xuICAgICAgICAgICAgICAgIG5ld09ialtwYXRoXSA9IFtdXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG5ld09ialtwYXRoXSA9IHVuZGVmaW5lZFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqICB3YWxrIGFsb25nIGEgcGF0aCBhbmQgbWFrZSBzdXJlIGl0IGNhbiBiZSBhY2Nlc3NlZFxuICogIGFuZCBlbnVtZXJhdGVkIGluIHRoYXQgb2JqZWN0XG4gKi9cbmZ1bmN0aW9uIGVuc3VyZVBhdGggKG9iaiwga2V5KSB7XG4gICAgdmFyIHBhdGggPSBrZXkuc3BsaXQoJy4nKSwgc2VjXG4gICAgZm9yICh2YXIgaSA9IDAsIGQgPSBwYXRoLmxlbmd0aCAtIDE7IGkgPCBkOyBpKyspIHtcbiAgICAgICAgc2VjID0gcGF0aFtpXVxuICAgICAgICBpZiAoIW9ialtzZWNdKSB7XG4gICAgICAgICAgICBvYmpbc2VjXSA9IHt9XG4gICAgICAgICAgICBpZiAob2JqLl9fZW1pdHRlcl9fKSBjb252ZXJ0S2V5KG9iaiwgc2VjKVxuICAgICAgICB9XG4gICAgICAgIG9iaiA9IG9ialtzZWNdXG4gICAgfVxuICAgIGlmICh0eXBlT2Yob2JqKSA9PT0gT0JKRUNUKSB7XG4gICAgICAgIHNlYyA9IHBhdGhbaV1cbiAgICAgICAgaWYgKCEoc2VjIGluIG9iaikpIHtcbiAgICAgICAgICAgIG9ialtzZWNdID0gdW5kZWZpbmVkXG4gICAgICAgICAgICBpZiAob2JqLl9fZW1pdHRlcl9fKSBjb252ZXJ0S2V5KG9iaiwgc2VjKVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vLyBNYWluIEFQSSBNZXRob2RzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogIE9ic2VydmUgYW4gb2JqZWN0IHdpdGggYSBnaXZlbiBwYXRoLFxuICogIGFuZCBwcm94eSBnZXQvc2V0L211dGF0ZSBldmVudHMgdG8gdGhlIHByb3ZpZGVkIG9ic2VydmVyLlxuICovXG5mdW5jdGlvbiBvYnNlcnZlIChvYmosIHJhd1BhdGgsIG9ic2VydmVyKSB7XG5cbiAgICBpZiAoIWlzV2F0Y2hhYmxlKG9iaikpIHJldHVyblxuXG4gICAgdmFyIHBhdGggPSByYXdQYXRoID8gcmF3UGF0aCArICcuJyA6ICcnLFxuICAgICAgICBhbHJlYWR5Q29udmVydGVkID0gY29udmVydChvYmopLFxuICAgICAgICBlbWl0dGVyID0gb2JqLl9fZW1pdHRlcl9fXG5cbiAgICAvLyBzZXR1cCBwcm94eSBsaXN0ZW5lcnMgb24gdGhlIHBhcmVudCBvYnNlcnZlci5cbiAgICAvLyB3ZSBuZWVkIHRvIGtlZXAgcmVmZXJlbmNlIHRvIHRoZW0gc28gdGhhdCB0aGV5XG4gICAgLy8gY2FuIGJlIHJlbW92ZWQgd2hlbiB0aGUgb2JqZWN0IGlzIHVuLW9ic2VydmVkLlxuICAgIG9ic2VydmVyLnByb3hpZXMgPSBvYnNlcnZlci5wcm94aWVzIHx8IHt9XG4gICAgdmFyIHByb3hpZXMgPSBvYnNlcnZlci5wcm94aWVzW3BhdGhdID0ge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgICAgICAgIG9ic2VydmVyLmVtaXQoJ2dldCcsIHBhdGggKyBrZXkpXG4gICAgICAgIH0sXG4gICAgICAgIHNldDogZnVuY3Rpb24gKGtleSwgdmFsLCBwcm9wYWdhdGUpIHtcbiAgICAgICAgICAgIGlmIChrZXkpIG9ic2VydmVyLmVtaXQoJ3NldCcsIHBhdGggKyBrZXksIHZhbClcbiAgICAgICAgICAgIC8vIGFsc28gbm90aWZ5IG9ic2VydmVyIHRoYXQgdGhlIG9iamVjdCBpdHNlbGYgY2hhbmdlZFxuICAgICAgICAgICAgLy8gYnV0IG9ubHkgZG8gc28gd2hlbiBpdCdzIGEgaW1tZWRpYXRlIHByb3BlcnR5LiB0aGlzXG4gICAgICAgICAgICAvLyBhdm9pZHMgZHVwbGljYXRlIGV2ZW50IGZpcmluZy5cbiAgICAgICAgICAgIGlmIChyYXdQYXRoICYmIHByb3BhZ2F0ZSkge1xuICAgICAgICAgICAgICAgIG9ic2VydmVyLmVtaXQoJ3NldCcsIHJhd1BhdGgsIG9iaiwgdHJ1ZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgbXV0YXRlOiBmdW5jdGlvbiAoa2V5LCB2YWwsIG11dGF0aW9uKSB7XG4gICAgICAgICAgICAvLyBpZiB0aGUgQXJyYXkgaXMgYSByb290IHZhbHVlXG4gICAgICAgICAgICAvLyB0aGUga2V5IHdpbGwgYmUgbnVsbFxuICAgICAgICAgICAgdmFyIGZpeGVkUGF0aCA9IGtleSA/IHBhdGggKyBrZXkgOiByYXdQYXRoXG4gICAgICAgICAgICBvYnNlcnZlci5lbWl0KCdtdXRhdGUnLCBmaXhlZFBhdGgsIHZhbCwgbXV0YXRpb24pXG4gICAgICAgICAgICAvLyBhbHNvIGVtaXQgc2V0IGZvciBBcnJheSdzIGxlbmd0aCB3aGVuIGl0IG11dGF0ZXNcbiAgICAgICAgICAgIHZhciBtID0gbXV0YXRpb24ubWV0aG9kXG4gICAgICAgICAgICBpZiAobSAhPT0gJ3NvcnQnICYmIG0gIT09ICdyZXZlcnNlJykge1xuICAgICAgICAgICAgICAgIG9ic2VydmVyLmVtaXQoJ3NldCcsIGZpeGVkUGF0aCArICcubGVuZ3RoJywgdmFsLmxlbmd0aClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGF0dGFjaCB0aGUgbGlzdGVuZXJzIHRvIHRoZSBjaGlsZCBvYnNlcnZlci5cbiAgICAvLyBub3cgYWxsIHRoZSBldmVudHMgd2lsbCBwcm9wYWdhdGUgdXB3YXJkcy5cbiAgICBlbWl0dGVyXG4gICAgICAgIC5vbignZ2V0JywgcHJveGllcy5nZXQpXG4gICAgICAgIC5vbignc2V0JywgcHJveGllcy5zZXQpXG4gICAgICAgIC5vbignbXV0YXRlJywgcHJveGllcy5tdXRhdGUpXG5cbiAgICBpZiAoYWxyZWFkeUNvbnZlcnRlZCkge1xuICAgICAgICAvLyBmb3Igb2JqZWN0cyB0aGF0IGhhdmUgYWxyZWFkeSBiZWVuIGNvbnZlcnRlZCxcbiAgICAgICAgLy8gZW1pdCBzZXQgZXZlbnRzIGZvciBldmVyeXRoaW5nIGluc2lkZVxuICAgICAgICBlbWl0U2V0KG9iailcbiAgICB9IGVsc2Uge1xuICAgICAgICB3YXRjaChvYmopXG4gICAgfVxufVxuXG4vKipcbiAqICBDYW5jZWwgb2JzZXJ2YXRpb24sIHR1cm4gb2ZmIHRoZSBsaXN0ZW5lcnMuXG4gKi9cbmZ1bmN0aW9uIHVub2JzZXJ2ZSAob2JqLCBwYXRoLCBvYnNlcnZlcikge1xuXG4gICAgaWYgKCFvYmogfHwgIW9iai5fX2VtaXR0ZXJfXykgcmV0dXJuXG5cbiAgICBwYXRoID0gcGF0aCA/IHBhdGggKyAnLicgOiAnJ1xuICAgIHZhciBwcm94aWVzID0gb2JzZXJ2ZXIucHJveGllc1twYXRoXVxuICAgIGlmICghcHJveGllcykgcmV0dXJuXG5cbiAgICAvLyB0dXJuIG9mZiBsaXN0ZW5lcnNcbiAgICBvYmouX19lbWl0dGVyX19cbiAgICAgICAgLm9mZignZ2V0JywgcHJveGllcy5nZXQpXG4gICAgICAgIC5vZmYoJ3NldCcsIHByb3hpZXMuc2V0KVxuICAgICAgICAub2ZmKCdtdXRhdGUnLCBwcm94aWVzLm11dGF0ZSlcblxuICAgIC8vIHJlbW92ZSByZWZlcmVuY2VcbiAgICBvYnNlcnZlci5wcm94aWVzW3BhdGhdID0gbnVsbFxufVxuXG4vLyBFeHBvc2UgQVBJIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnZhciBwdWIgPSBtb2R1bGUuZXhwb3J0cyA9IHtcblxuICAgIC8vIHdoZXRoZXIgdG8gZW1pdCBnZXQgZXZlbnRzXG4gICAgLy8gb25seSBlbmFibGVkIGR1cmluZyBkZXBlbmRlbmN5IHBhcnNpbmdcbiAgICBzaG91bGRHZXQgICA6IGZhbHNlLFxuXG4gICAgb2JzZXJ2ZSAgICAgOiBvYnNlcnZlLFxuICAgIHVub2JzZXJ2ZSAgIDogdW5vYnNlcnZlLFxuICAgIGVuc3VyZVBhdGggIDogZW5zdXJlUGF0aCxcbiAgICBjb3B5UGF0aHMgICA6IGNvcHlQYXRocyxcbiAgICB3YXRjaCAgICAgICA6IHdhdGNoLFxuICAgIGNvbnZlcnQgICAgIDogY29udmVydCxcbiAgICBjb252ZXJ0S2V5ICA6IGNvbnZlcnRLZXlcbn0iLCJ2YXIgQklORElOR19SRSA9IC97e3s/KFtee31dKz8pfT99fS8sXG4gICAgVFJJUExFX1JFID0gL3t7e1tee31dK319fS9cblxuLyoqXG4gKiAgUGFyc2UgYSBwaWVjZSBvZiB0ZXh0LCByZXR1cm4gYW4gYXJyYXkgb2YgdG9rZW5zXG4gKi9cbmZ1bmN0aW9uIHBhcnNlICh0ZXh0KSB7XG4gICAgaWYgKCFCSU5ESU5HX1JFLnRlc3QodGV4dCkpIHJldHVybiBudWxsXG4gICAgdmFyIG0sIGksIHRva2VuLCB0b2tlbnMgPSBbXVxuICAgIC8qIGpzaGludCBib3NzOiB0cnVlICovXG4gICAgd2hpbGUgKG0gPSB0ZXh0Lm1hdGNoKEJJTkRJTkdfUkUpKSB7XG4gICAgICAgIGkgPSBtLmluZGV4XG4gICAgICAgIGlmIChpID4gMCkgdG9rZW5zLnB1c2godGV4dC5zbGljZSgwLCBpKSlcbiAgICAgICAgdG9rZW4gPSB7IGtleTogbVsxXS50cmltKCkgfVxuICAgICAgICBpZiAoVFJJUExFX1JFLnRlc3QobVswXSkpIHRva2VuLmh0bWwgPSB0cnVlXG4gICAgICAgIHRva2Vucy5wdXNoKHRva2VuKVxuICAgICAgICB0ZXh0ID0gdGV4dC5zbGljZShpICsgbVswXS5sZW5ndGgpXG4gICAgfVxuICAgIGlmICh0ZXh0Lmxlbmd0aCkgdG9rZW5zLnB1c2godGV4dClcbiAgICByZXR1cm4gdG9rZW5zXG59XG5cbi8qKlxuICogIFBhcnNlIGFuIGF0dHJpYnV0ZSB2YWx1ZSB3aXRoIHBvc3NpYmxlIGludGVycG9sYXRpb24gdGFnc1xuICogIHJldHVybiBhIERpcmVjdGl2ZS1mcmllbmRseSBleHByZXNzaW9uXG4gKi9cbmZ1bmN0aW9uIHBhcnNlQXR0ciAoYXR0cikge1xuICAgIHZhciB0b2tlbnMgPSBwYXJzZShhdHRyKVxuICAgIGlmICghdG9rZW5zKSByZXR1cm4gbnVsbFxuICAgIHZhciByZXMgPSBbXSwgdG9rZW5cbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IHRva2Vucy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgdG9rZW4gPSB0b2tlbnNbaV1cbiAgICAgICAgcmVzLnB1c2godG9rZW4ua2V5IHx8ICgnXCInICsgdG9rZW4gKyAnXCInKSlcbiAgICB9XG4gICAgcmV0dXJuIHJlcy5qb2luKCcrJylcbn1cblxuZXhwb3J0cy5wYXJzZSA9IHBhcnNlXG5leHBvcnRzLnBhcnNlQXR0ciA9IHBhcnNlQXR0ciIsInZhciBlbmRFdmVudHMgID0gc25pZmZFbmRFdmVudHMoKSxcbiAgICBjb25maWcgICAgID0gcmVxdWlyZSgnLi9jb25maWcnKSxcbiAgICAvLyBiYXRjaCBlbnRlciBhbmltYXRpb25zIHNvIHdlIG9ubHkgZm9yY2UgdGhlIGxheW91dCBvbmNlXG4gICAgQmF0Y2hlciAgICA9IHJlcXVpcmUoJy4vYmF0Y2hlcicpLFxuICAgIGJhdGNoZXIgICAgPSBuZXcgQmF0Y2hlcigpLFxuICAgIC8vIGNhY2hlIHRpbWVyIGZ1bmN0aW9uc1xuICAgIHNldFRPICAgICAgPSB3aW5kb3cuc2V0VGltZW91dCxcbiAgICBjbGVhclRPICAgID0gd2luZG93LmNsZWFyVGltZW91dCxcbiAgICAvLyBleGl0IGNvZGVzIGZvciB0ZXN0aW5nXG4gICAgY29kZXMgPSB7XG4gICAgICAgIENTU19FICAgICA6IDEsXG4gICAgICAgIENTU19MICAgICA6IDIsXG4gICAgICAgIEpTX0UgICAgICA6IDMsXG4gICAgICAgIEpTX0wgICAgICA6IDQsXG4gICAgICAgIENTU19TS0lQICA6IC0xLFxuICAgICAgICBKU19TS0lQICAgOiAtMixcbiAgICAgICAgSlNfU0tJUF9FIDogLTMsXG4gICAgICAgIEpTX1NLSVBfTCA6IC00LFxuICAgICAgICBJTklUICAgICAgOiAtNSxcbiAgICAgICAgU0tJUCAgICAgIDogLTZcbiAgICB9XG5cbi8vIGZvcmNlIGxheW91dCBiZWZvcmUgdHJpZ2dlcmluZyB0cmFuc2l0aW9ucy9hbmltYXRpb25zXG5iYXRjaGVyLl9wcmVGbHVzaCA9IGZ1bmN0aW9uICgpIHtcbiAgICAvKiBqc2hpbnQgdW51c2VkOiBmYWxzZSAqL1xuICAgIHZhciBmID0gZG9jdW1lbnQuYm9keS5vZmZzZXRIZWlnaHRcbn1cblxuLyoqXG4gKiAgc3RhZ2U6XG4gKiAgICAxID0gZW50ZXJcbiAqICAgIDIgPSBsZWF2ZVxuICovXG52YXIgdHJhbnNpdGlvbiA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGVsLCBzdGFnZSwgY2IsIGNvbXBpbGVyKSB7XG5cbiAgICB2YXIgY2hhbmdlU3RhdGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGNiKClcbiAgICAgICAgY29tcGlsZXIuZXhlY0hvb2soc3RhZ2UgPiAwID8gJ2F0dGFjaGVkJyA6ICdkZXRhY2hlZCcpXG4gICAgfVxuXG4gICAgaWYgKGNvbXBpbGVyLmluaXQpIHtcbiAgICAgICAgY2hhbmdlU3RhdGUoKVxuICAgICAgICByZXR1cm4gY29kZXMuSU5JVFxuICAgIH1cblxuICAgIHZhciBoYXNUcmFuc2l0aW9uID0gZWwudnVlX3RyYW5zID09PSAnJyxcbiAgICAgICAgaGFzQW5pbWF0aW9uICA9IGVsLnZ1ZV9hbmltID09PSAnJyxcbiAgICAgICAgZWZmZWN0SWQgICAgICA9IGVsLnZ1ZV9lZmZlY3RcblxuICAgIGlmIChlZmZlY3RJZCkge1xuICAgICAgICByZXR1cm4gYXBwbHlUcmFuc2l0aW9uRnVuY3Rpb25zKFxuICAgICAgICAgICAgZWwsXG4gICAgICAgICAgICBzdGFnZSxcbiAgICAgICAgICAgIGNoYW5nZVN0YXRlLFxuICAgICAgICAgICAgZWZmZWN0SWQsXG4gICAgICAgICAgICBjb21waWxlclxuICAgICAgICApXG4gICAgfSBlbHNlIGlmIChoYXNUcmFuc2l0aW9uIHx8IGhhc0FuaW1hdGlvbikge1xuICAgICAgICByZXR1cm4gYXBwbHlUcmFuc2l0aW9uQ2xhc3MoXG4gICAgICAgICAgICBlbCxcbiAgICAgICAgICAgIHN0YWdlLFxuICAgICAgICAgICAgY2hhbmdlU3RhdGUsXG4gICAgICAgICAgICBoYXNBbmltYXRpb25cbiAgICAgICAgKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGNoYW5nZVN0YXRlKClcbiAgICAgICAgcmV0dXJuIGNvZGVzLlNLSVBcbiAgICB9XG5cbn1cblxudHJhbnNpdGlvbi5jb2RlcyA9IGNvZGVzXG5cbi8qKlxuICogIFRvZ2dnbGUgYSBDU1MgY2xhc3MgdG8gdHJpZ2dlciB0cmFuc2l0aW9uXG4gKi9cbmZ1bmN0aW9uIGFwcGx5VHJhbnNpdGlvbkNsYXNzIChlbCwgc3RhZ2UsIGNoYW5nZVN0YXRlLCBoYXNBbmltYXRpb24pIHtcblxuICAgIGlmICghZW5kRXZlbnRzLnRyYW5zKSB7XG4gICAgICAgIGNoYW5nZVN0YXRlKClcbiAgICAgICAgcmV0dXJuIGNvZGVzLkNTU19TS0lQXG4gICAgfVxuXG4gICAgLy8gaWYgdGhlIGJyb3dzZXIgc3VwcG9ydHMgdHJhbnNpdGlvbixcbiAgICAvLyBpdCBtdXN0IGhhdmUgY2xhc3NMaXN0Li4uXG4gICAgdmFyIG9uRW5kLFxuICAgICAgICBjbGFzc0xpc3QgICAgICAgID0gZWwuY2xhc3NMaXN0LFxuICAgICAgICBleGlzdGluZ0NhbGxiYWNrID0gZWwudnVlX3RyYW5zX2NiLFxuICAgICAgICBlbnRlckNsYXNzICAgICAgID0gY29uZmlnLmVudGVyQ2xhc3MsXG4gICAgICAgIGxlYXZlQ2xhc3MgICAgICAgPSBjb25maWcubGVhdmVDbGFzcyxcbiAgICAgICAgZW5kRXZlbnQgICAgICAgICA9IGhhc0FuaW1hdGlvbiA/IGVuZEV2ZW50cy5hbmltIDogZW5kRXZlbnRzLnRyYW5zXG5cbiAgICAvLyBjYW5jZWwgdW5maW5pc2hlZCBjYWxsYmFja3MgYW5kIGpvYnNcbiAgICBpZiAoZXhpc3RpbmdDYWxsYmFjaykge1xuICAgICAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKGVuZEV2ZW50LCBleGlzdGluZ0NhbGxiYWNrKVxuICAgICAgICBjbGFzc0xpc3QucmVtb3ZlKGVudGVyQ2xhc3MpXG4gICAgICAgIGNsYXNzTGlzdC5yZW1vdmUobGVhdmVDbGFzcylcbiAgICAgICAgZWwudnVlX3RyYW5zX2NiID0gbnVsbFxuICAgIH1cblxuICAgIGlmIChzdGFnZSA+IDApIHsgLy8gZW50ZXJcblxuICAgICAgICAvLyBzZXQgdG8gZW50ZXIgc3RhdGUgYmVmb3JlIGFwcGVuZGluZ1xuICAgICAgICBjbGFzc0xpc3QuYWRkKGVudGVyQ2xhc3MpXG4gICAgICAgIC8vIGFwcGVuZFxuICAgICAgICBjaGFuZ2VTdGF0ZSgpXG4gICAgICAgIC8vIHRyaWdnZXIgdHJhbnNpdGlvblxuICAgICAgICBpZiAoIWhhc0FuaW1hdGlvbikge1xuICAgICAgICAgICAgYmF0Y2hlci5wdXNoKHtcbiAgICAgICAgICAgICAgICBleGVjdXRlOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIGNsYXNzTGlzdC5yZW1vdmUoZW50ZXJDbGFzcylcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb25FbmQgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICAgICAgICAgIGlmIChlLnRhcmdldCA9PT0gZWwpIHtcbiAgICAgICAgICAgICAgICAgICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihlbmRFdmVudCwgb25FbmQpXG4gICAgICAgICAgICAgICAgICAgIGVsLnZ1ZV90cmFuc19jYiA9IG51bGxcbiAgICAgICAgICAgICAgICAgICAgY2xhc3NMaXN0LnJlbW92ZShlbnRlckNsYXNzKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoZW5kRXZlbnQsIG9uRW5kKVxuICAgICAgICAgICAgZWwudnVlX3RyYW5zX2NiID0gb25FbmRcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29kZXMuQ1NTX0VcblxuICAgIH0gZWxzZSB7IC8vIGxlYXZlXG5cbiAgICAgICAgaWYgKGVsLm9mZnNldFdpZHRoIHx8IGVsLm9mZnNldEhlaWdodCkge1xuICAgICAgICAgICAgLy8gdHJpZ2dlciBoaWRlIHRyYW5zaXRpb25cbiAgICAgICAgICAgIGNsYXNzTGlzdC5hZGQobGVhdmVDbGFzcylcbiAgICAgICAgICAgIG9uRW5kID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoZS50YXJnZXQgPT09IGVsKSB7XG4gICAgICAgICAgICAgICAgICAgIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoZW5kRXZlbnQsIG9uRW5kKVxuICAgICAgICAgICAgICAgICAgICBlbC52dWVfdHJhbnNfY2IgPSBudWxsXG4gICAgICAgICAgICAgICAgICAgIC8vIGFjdHVhbGx5IHJlbW92ZSBub2RlIGhlcmVcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlU3RhdGUoKVxuICAgICAgICAgICAgICAgICAgICBjbGFzc0xpc3QucmVtb3ZlKGxlYXZlQ2xhc3MpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gYXR0YWNoIHRyYW5zaXRpb24gZW5kIGxpc3RlbmVyXG4gICAgICAgICAgICBlbC5hZGRFdmVudExpc3RlbmVyKGVuZEV2ZW50LCBvbkVuZClcbiAgICAgICAgICAgIGVsLnZ1ZV90cmFuc19jYiA9IG9uRW5kXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBkaXJlY3RseSByZW1vdmUgaW52aXNpYmxlIGVsZW1lbnRzXG4gICAgICAgICAgICBjaGFuZ2VTdGF0ZSgpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvZGVzLkNTU19MXG4gICAgICAgIFxuICAgIH1cblxufVxuXG5mdW5jdGlvbiBhcHBseVRyYW5zaXRpb25GdW5jdGlvbnMgKGVsLCBzdGFnZSwgY2hhbmdlU3RhdGUsIGVmZmVjdElkLCBjb21waWxlcikge1xuXG4gICAgdmFyIGZ1bmNzID0gY29tcGlsZXIuZ2V0T3B0aW9uKCdlZmZlY3RzJywgZWZmZWN0SWQpXG4gICAgaWYgKCFmdW5jcykge1xuICAgICAgICBjaGFuZ2VTdGF0ZSgpXG4gICAgICAgIHJldHVybiBjb2Rlcy5KU19TS0lQXG4gICAgfVxuXG4gICAgdmFyIGVudGVyID0gZnVuY3MuZW50ZXIsXG4gICAgICAgIGxlYXZlID0gZnVuY3MubGVhdmUsXG4gICAgICAgIHRpbWVvdXRzID0gZWwudnVlX3RpbWVvdXRzXG5cbiAgICAvLyBjbGVhciBwcmV2aW91cyB0aW1lb3V0c1xuICAgIGlmICh0aW1lb3V0cykge1xuICAgICAgICB2YXIgaSA9IHRpbWVvdXRzLmxlbmd0aFxuICAgICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgICAgICBjbGVhclRPKHRpbWVvdXRzW2ldKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgdGltZW91dHMgPSBlbC52dWVfdGltZW91dHMgPSBbXVxuICAgIGZ1bmN0aW9uIHRpbWVvdXQgKGNiLCBkZWxheSkge1xuICAgICAgICB2YXIgaWQgPSBzZXRUTyhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBjYigpXG4gICAgICAgICAgICB0aW1lb3V0cy5zcGxpY2UodGltZW91dHMuaW5kZXhPZihpZCksIDEpXG4gICAgICAgICAgICBpZiAoIXRpbWVvdXRzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGVsLnZ1ZV90aW1lb3V0cyA9IG51bGxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgZGVsYXkpXG4gICAgICAgIHRpbWVvdXRzLnB1c2goaWQpXG4gICAgfVxuXG4gICAgaWYgKHN0YWdlID4gMCkgeyAvLyBlbnRlclxuICAgICAgICBpZiAodHlwZW9mIGVudGVyICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBjaGFuZ2VTdGF0ZSgpXG4gICAgICAgICAgICByZXR1cm4gY29kZXMuSlNfU0tJUF9FXG4gICAgICAgIH1cbiAgICAgICAgZW50ZXIoZWwsIGNoYW5nZVN0YXRlLCB0aW1lb3V0KVxuICAgICAgICByZXR1cm4gY29kZXMuSlNfRVxuICAgIH0gZWxzZSB7IC8vIGxlYXZlXG4gICAgICAgIGlmICh0eXBlb2YgbGVhdmUgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGNoYW5nZVN0YXRlKClcbiAgICAgICAgICAgIHJldHVybiBjb2Rlcy5KU19TS0lQX0xcbiAgICAgICAgfVxuICAgICAgICBsZWF2ZShlbCwgY2hhbmdlU3RhdGUsIHRpbWVvdXQpXG4gICAgICAgIHJldHVybiBjb2Rlcy5KU19MXG4gICAgfVxuXG59XG5cbi8qKlxuICogIFNuaWZmIHByb3BlciB0cmFuc2l0aW9uIGVuZCBldmVudCBuYW1lXG4gKi9cbmZ1bmN0aW9uIHNuaWZmRW5kRXZlbnRzICgpIHtcbiAgICB2YXIgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd2dWUnKSxcbiAgICAgICAgZGVmYXVsdEV2ZW50ID0gJ3RyYW5zaXRpb25lbmQnLFxuICAgICAgICBldmVudHMgPSB7XG4gICAgICAgICAgICAndHJhbnNpdGlvbicgICAgICAgOiBkZWZhdWx0RXZlbnQsXG4gICAgICAgICAgICAnbW96VHJhbnNpdGlvbicgICAgOiBkZWZhdWx0RXZlbnQsXG4gICAgICAgICAgICAnd2Via2l0VHJhbnNpdGlvbicgOiAnd2Via2l0VHJhbnNpdGlvbkVuZCdcbiAgICAgICAgfSxcbiAgICAgICAgcmV0ID0ge31cbiAgICBmb3IgKHZhciBuYW1lIGluIGV2ZW50cykge1xuICAgICAgICBpZiAoZWwuc3R5bGVbbmFtZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0LnRyYW5zID0gZXZlbnRzW25hbWVdXG4gICAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldC5hbmltID0gZWwuc3R5bGUuYW5pbWF0aW9uID09PSAnJ1xuICAgICAgICA/ICdhbmltYXRpb25lbmQnXG4gICAgICAgIDogJ3dlYmtpdEFuaW1hdGlvbkVuZCdcbiAgICByZXR1cm4gcmV0XG59IiwidmFyIGNvbmZpZyAgICA9IHJlcXVpcmUoJy4vY29uZmlnJyksXG4gICAgYXR0cnMgICAgID0gY29uZmlnLmF0dHJzLFxuICAgIHRvU3RyaW5nICA9ICh7fSkudG9TdHJpbmcsXG4gICAgd2luICAgICAgID0gd2luZG93LFxuICAgIGNvbnNvbGUgICA9IHdpbi5jb25zb2xlLFxuICAgIHRpbWVvdXQgICA9IHdpbi5zZXRUaW1lb3V0LFxuICAgIGhhc0NsYXNzTGlzdCA9ICdjbGFzc0xpc3QnIGluIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCxcbiAgICBWaWV3TW9kZWwgLy8gbGF0ZSBkZWZcblxudmFyIHV0aWxzID0gbW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgICAvKipcbiAgICAgKiAgQ3JlYXRlIGEgcHJvdG90eXBlLWxlc3Mgb2JqZWN0XG4gICAgICogIHdoaWNoIGlzIGEgYmV0dGVyIGhhc2gvbWFwXG4gICAgICovXG4gICAgaGFzaDogZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gT2JqZWN0LmNyZWF0ZShudWxsKVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgZ2V0IGFuIGF0dHJpYnV0ZSBhbmQgcmVtb3ZlIGl0LlxuICAgICAqL1xuICAgIGF0dHI6IGZ1bmN0aW9uIChlbCwgdHlwZSkge1xuICAgICAgICB2YXIgYXR0ciA9IGF0dHJzW3R5cGVdLFxuICAgICAgICAgICAgdmFsID0gZWwuZ2V0QXR0cmlidXRlKGF0dHIpXG4gICAgICAgIGlmICh2YWwgIT09IG51bGwpIGVsLnJlbW92ZUF0dHJpYnV0ZShhdHRyKVxuICAgICAgICByZXR1cm4gdmFsXG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBEZWZpbmUgYW4gaWVudW1lcmFibGUgcHJvcGVydHlcbiAgICAgKiAgVGhpcyBhdm9pZHMgaXQgYmVpbmcgaW5jbHVkZWQgaW4gSlNPTi5zdHJpbmdpZnlcbiAgICAgKiAgb3IgZm9yLi4uaW4gbG9vcHMuXG4gICAgICovXG4gICAgZGVmUHJvdGVjdGVkOiBmdW5jdGlvbiAob2JqLCBrZXksIHZhbCwgZW51bWVyYWJsZSkge1xuICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KGtleSkpIHJldHVyblxuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgICAgICAgIHZhbHVlICAgICAgICA6IHZhbCxcbiAgICAgICAgICAgIGVudW1lcmFibGUgICA6ICEhZW51bWVyYWJsZSxcbiAgICAgICAgICAgIGNvbmZpZ3VyYWJsZSA6IHRydWVcbiAgICAgICAgfSlcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIEFjY3VyYXRlIHR5cGUgY2hlY2tcbiAgICAgKiAgaW50ZXJuYWwgdXNlIG9ubHksIHNvIG5vIG5lZWQgdG8gY2hlY2sgZm9yIE5hTlxuICAgICAqL1xuICAgIHR5cGVPZjogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICByZXR1cm4gdG9TdHJpbmcuY2FsbChvYmopLnNsaWNlKDgsIC0xKVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgTW9zdCBzaW1wbGUgYmluZFxuICAgICAqICBlbm91Z2ggZm9yIHRoZSB1c2VjYXNlIGFuZCBmYXN0IHRoYW4gbmF0aXZlIGJpbmQoKVxuICAgICAqL1xuICAgIGJpbmQ6IGZ1bmN0aW9uIChmbiwgY3R4KSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoYXJnKSB7XG4gICAgICAgICAgICByZXR1cm4gZm4uY2FsbChjdHgsIGFyZylcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgTWFrZSBzdXJlIG9ubHkgc3RyaW5ncywgYm9vbGVhbnMsIG51bWJlcnMgYW5kXG4gICAgICogIG9iamVjdHMgYXJlIG91dHB1dCB0byBodG1sLiBvdGhlcndpc2UsIG91cHV0IGVtcHR5IHN0cmluZy5cbiAgICAgKi9cbiAgICB0b1RleHQ6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAvKiBqc2hpbnQgZXFlcWVxOiBmYWxzZSAqL1xuICAgICAgICB2YXIgdHlwZSA9IHR5cGVvZiB2YWx1ZVxuICAgICAgICByZXR1cm4gKHR5cGUgPT09ICdzdHJpbmcnIHx8XG4gICAgICAgICAgICB0eXBlID09PSAnYm9vbGVhbicgfHxcbiAgICAgICAgICAgICh0eXBlID09PSAnbnVtYmVyJyAmJiB2YWx1ZSA9PSB2YWx1ZSkpIC8vIGRlYWwgd2l0aCBOYU5cbiAgICAgICAgICAgICAgICA/IHZhbHVlXG4gICAgICAgICAgICAgICAgOiB0eXBlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbFxuICAgICAgICAgICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHZhbHVlKVxuICAgICAgICAgICAgICAgICAgICA6ICcnXG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBzaW1wbGUgZXh0ZW5kXG4gICAgICovXG4gICAgZXh0ZW5kOiBmdW5jdGlvbiAob2JqLCBleHQsIHByb3RlY3RpdmUpIHtcbiAgICAgICAgZm9yICh2YXIga2V5IGluIGV4dCkge1xuICAgICAgICAgICAgaWYgKHByb3RlY3RpdmUgJiYgb2JqW2tleV0pIGNvbnRpbnVlXG4gICAgICAgICAgICBvYmpba2V5XSA9IGV4dFtrZXldXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG9ialxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgZmlsdGVyIGFuIGFycmF5IHdpdGggZHVwbGljYXRlcyBpbnRvIHVuaXF1ZXNcbiAgICAgKi9cbiAgICB1bmlxdWU6IGZ1bmN0aW9uIChhcnIpIHtcbiAgICAgICAgdmFyIGhhc2ggPSB1dGlscy5oYXNoKCksXG4gICAgICAgICAgICBpID0gYXJyLmxlbmd0aCxcbiAgICAgICAgICAgIGtleSwgcmVzID0gW11cbiAgICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICAgICAga2V5ID0gYXJyW2ldXG4gICAgICAgICAgICBpZiAoaGFzaFtrZXldKSBjb250aW51ZVxuICAgICAgICAgICAgaGFzaFtrZXldID0gMVxuICAgICAgICAgICAgcmVzLnB1c2goa2V5KVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXNcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIENvbnZlcnQgYSBzdHJpbmcgdGVtcGxhdGUgdG8gYSBkb20gZnJhZ21lbnRcbiAgICAgKi9cbiAgICB0b0ZyYWdtZW50OiBmdW5jdGlvbiAodGVtcGxhdGUpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0ZW1wbGF0ZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiB0ZW1wbGF0ZVxuICAgICAgICB9XG4gICAgICAgIGlmICh0ZW1wbGF0ZS5jaGFyQXQoMCkgPT09ICcjJykge1xuICAgICAgICAgICAgdmFyIHRlbXBsYXRlTm9kZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKHRlbXBsYXRlLnNsaWNlKDEpKVxuICAgICAgICAgICAgaWYgKCF0ZW1wbGF0ZU5vZGUpIHJldHVyblxuICAgICAgICAgICAgdGVtcGxhdGUgPSB0ZW1wbGF0ZU5vZGUuaW5uZXJIVE1MXG4gICAgICAgIH1cbiAgICAgICAgdmFyIG5vZGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSxcbiAgICAgICAgICAgIGZyYWcgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCksXG4gICAgICAgICAgICBjaGlsZFxuICAgICAgICBub2RlLmlubmVySFRNTCA9IHRlbXBsYXRlLnRyaW0oKVxuICAgICAgICAvKiBqc2hpbnQgYm9zczogdHJ1ZSAqL1xuICAgICAgICB3aGlsZSAoY2hpbGQgPSBub2RlLmZpcnN0Q2hpbGQpIHtcbiAgICAgICAgICAgIGlmIChub2RlLm5vZGVUeXBlID09PSAxKSB7XG4gICAgICAgICAgICAgICAgZnJhZy5hcHBlbmRDaGlsZChjaGlsZClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZnJhZ1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiAgQ29udmVydCB0aGUgb2JqZWN0IHRvIGEgVmlld01vZGVsIGNvbnN0cnVjdG9yXG4gICAgICogIGlmIGl0IGlzIG5vdCBhbHJlYWR5IG9uZVxuICAgICAqL1xuICAgIHRvQ29uc3RydWN0b3I6IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgVmlld01vZGVsID0gVmlld01vZGVsIHx8IHJlcXVpcmUoJy4vdmlld21vZGVsJylcbiAgICAgICAgcmV0dXJuIHV0aWxzLnR5cGVPZihvYmopID09PSAnT2JqZWN0J1xuICAgICAgICAgICAgPyBWaWV3TW9kZWwuZXh0ZW5kKG9iailcbiAgICAgICAgICAgIDogdHlwZW9mIG9iaiA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICAgID8gb2JqXG4gICAgICAgICAgICAgICAgOiBudWxsXG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICBjb252ZXJ0IGNlcnRhaW4gb3B0aW9uIHZhbHVlcyB0byB0aGUgZGVzaXJlZCBmb3JtYXQuXG4gICAgICovXG4gICAgcHJvY2Vzc09wdGlvbnM6IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgIHZhciBjb21wb25lbnRzID0gb3B0aW9ucy5jb21wb25lbnRzLFxuICAgICAgICAgICAgcGFydGlhbHMgICA9IG9wdGlvbnMucGFydGlhbHMsXG4gICAgICAgICAgICB0ZW1wbGF0ZSAgID0gb3B0aW9ucy50ZW1wbGF0ZSxcbiAgICAgICAgICAgIGtleVxuICAgICAgICBpZiAoY29tcG9uZW50cykge1xuICAgICAgICAgICAgZm9yIChrZXkgaW4gY29tcG9uZW50cykge1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudHNba2V5XSA9IHV0aWxzLnRvQ29uc3RydWN0b3IoY29tcG9uZW50c1trZXldKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChwYXJ0aWFscykge1xuICAgICAgICAgICAgZm9yIChrZXkgaW4gcGFydGlhbHMpIHtcbiAgICAgICAgICAgICAgICBwYXJ0aWFsc1trZXldID0gdXRpbHMudG9GcmFnbWVudChwYXJ0aWFsc1trZXldKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICh0ZW1wbGF0ZSkge1xuICAgICAgICAgICAgb3B0aW9ucy50ZW1wbGF0ZSA9IHV0aWxzLnRvRnJhZ21lbnQodGVtcGxhdGUpXG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIGxvZyBmb3IgZGVidWdnaW5nXG4gICAgICovXG4gICAgbG9nOiBmdW5jdGlvbiAobXNnKSB7XG4gICAgICAgIGlmIChjb25maWcuZGVidWcgJiYgY29uc29sZSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2cobXNnKVxuICAgICAgICB9XG4gICAgfSxcbiAgICBcbiAgICAvKipcbiAgICAgKiAgd2FybmluZ3MsIHRyYWNlcyBieSBkZWZhdWx0XG4gICAgICogIGNhbiBiZSBzdXBwcmVzc2VkIGJ5IGBzaWxlbnRgIG9wdGlvbi5cbiAgICAgKi9cbiAgICB3YXJuOiBmdW5jdGlvbiAobXNnKSB7XG4gICAgICAgIGlmICghY29uZmlnLnNpbGVudCAmJiBjb25zb2xlKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4obXNnKVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5kZWJ1ZyAmJiBjb25zb2xlLnRyYWNlKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS50cmFjZShtc2cpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIHVzZWQgdG8gZGVmZXIgYmF0Y2ggdXBkYXRlc1xuICAgICAqL1xuICAgIG5leHRUaWNrOiBmdW5jdGlvbiAoY2IpIHtcbiAgICAgICAgdGltZW91dChjYiwgMClcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogIGFkZCBjbGFzcyBmb3IgSUU5XG4gICAgICogIHVzZXMgY2xhc3NMaXN0IGlmIGF2YWlsYWJsZVxuICAgICAqL1xuICAgIGFkZENsYXNzOiBmdW5jdGlvbiAoZWwsIGNscykge1xuICAgICAgICBpZiAoaGFzQ2xhc3NMaXN0KSB7XG4gICAgICAgICAgICBlbC5jbGFzc0xpc3QuYWRkKGNscylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhciBjdXIgPSAnICcgKyBlbC5jbGFzc05hbWUgKyAnICdcbiAgICAgICAgICAgIGlmIChjdXIuaW5kZXhPZignICcgKyBjbHMgKyAnICcpIDwgMCkge1xuICAgICAgICAgICAgICAgIGVsLmNsYXNzTmFtZSA9IChjdXIgKyBjbHMpLnRyaW0oKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqICByZW1vdmUgY2xhc3MgZm9yIElFOVxuICAgICAqL1xuICAgIHJlbW92ZUNsYXNzOiBmdW5jdGlvbiAoZWwsIGNscykge1xuICAgICAgICBpZiAoaGFzQ2xhc3NMaXN0KSB7XG4gICAgICAgICAgICBlbC5jbGFzc0xpc3QucmVtb3ZlKGNscylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhciBjdXIgPSAnICcgKyBlbC5jbGFzc05hbWUgKyAnICcsXG4gICAgICAgICAgICAgICAgdGFyID0gJyAnICsgY2xzICsgJyAnXG4gICAgICAgICAgICB3aGlsZSAoY3VyLmluZGV4T2YodGFyKSA+PSAwKSB7XG4gICAgICAgICAgICAgICAgY3VyID0gY3VyLnJlcGxhY2UodGFyLCAnICcpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbC5jbGFzc05hbWUgPSBjdXIudHJpbSgpXG4gICAgICAgIH1cbiAgICB9XG59IiwidmFyIENvbXBpbGVyICAgPSByZXF1aXJlKCcuL2NvbXBpbGVyJyksXG4gICAgdXRpbHMgICAgICA9IHJlcXVpcmUoJy4vdXRpbHMnKSxcbiAgICB0cmFuc2l0aW9uID0gcmVxdWlyZSgnLi90cmFuc2l0aW9uJyksXG4gICAgQmF0Y2hlciAgICA9IHJlcXVpcmUoJy4vYmF0Y2hlcicpLFxuICAgIHNsaWNlICAgICAgPSBbXS5zbGljZSxcbiAgICBkZWYgICAgICAgID0gdXRpbHMuZGVmUHJvdGVjdGVkLFxuICAgIG5leHRUaWNrICAgPSB1dGlscy5uZXh0VGljayxcblxuICAgIC8vIGJhdGNoICR3YXRjaCBjYWxsYmFja3NcbiAgICB3YXRjaGVyQmF0Y2hlciA9IG5ldyBCYXRjaGVyKCksXG4gICAgd2F0Y2hlcklkICAgICAgPSAxXG5cbi8qKlxuICogIFZpZXdNb2RlbCBleHBvc2VkIHRvIHRoZSB1c2VyIHRoYXQgaG9sZHMgZGF0YSxcbiAqICBjb21wdXRlZCBwcm9wZXJ0aWVzLCBldmVudCBoYW5kbGVyc1xuICogIGFuZCBhIGZldyByZXNlcnZlZCBtZXRob2RzXG4gKi9cbmZ1bmN0aW9uIFZpZXdNb2RlbCAob3B0aW9ucykge1xuICAgIC8vIGp1c3QgY29tcGlsZS4gb3B0aW9ucyBhcmUgcGFzc2VkIGRpcmVjdGx5IHRvIGNvbXBpbGVyXG4gICAgbmV3IENvbXBpbGVyKHRoaXMsIG9wdGlvbnMpXG59XG5cbi8vIEFsbCBWTSBwcm90b3R5cGUgbWV0aG9kcyBhcmUgaW5lbnVtZXJhYmxlXG4vLyBzbyBpdCBjYW4gYmUgc3RyaW5naWZpZWQvbG9vcGVkIHRocm91Z2ggYXMgcmF3IGRhdGFcbnZhciBWTVByb3RvID0gVmlld01vZGVsLnByb3RvdHlwZVxuXG4vKipcbiAqICBDb252ZW5pZW5jZSBmdW5jdGlvbiB0byBzZXQgYW4gYWN0dWFsIG5lc3RlZCB2YWx1ZVxuICogIGZyb20gYSBmbGF0IGtleSBzdHJpbmcuIFVzZWQgaW4gZGlyZWN0aXZlcy5cbiAqL1xuZGVmKFZNUHJvdG8sICckc2V0JywgZnVuY3Rpb24gKGtleSwgdmFsdWUpIHtcbiAgICB2YXIgcGF0aCA9IGtleS5zcGxpdCgnLicpLFxuICAgICAgICBvYmogPSB0aGlzXG4gICAgZm9yICh2YXIgZCA9IDAsIGwgPSBwYXRoLmxlbmd0aCAtIDE7IGQgPCBsOyBkKyspIHtcbiAgICAgICAgb2JqID0gb2JqW3BhdGhbZF1dXG4gICAgfVxuICAgIG9ialtwYXRoW2RdXSA9IHZhbHVlXG59KVxuXG4vKipcbiAqICB3YXRjaCBhIGtleSBvbiB0aGUgdmlld21vZGVsIGZvciBjaGFuZ2VzXG4gKiAgZmlyZSBjYWxsYmFjayB3aXRoIG5ldyB2YWx1ZVxuICovXG5kZWYoVk1Qcm90bywgJyR3YXRjaCcsIGZ1bmN0aW9uIChrZXksIGNhbGxiYWNrKSB7XG4gICAgLy8gc2F2ZSBhIHVuaXF1ZSBpZCBmb3IgZWFjaCB3YXRjaGVyXG4gICAgdmFyIGlkID0gd2F0Y2hlcklkKyssXG4gICAgICAgIHNlbGYgPSB0aGlzXG4gICAgZnVuY3Rpb24gb24gKCkge1xuICAgICAgICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzKVxuICAgICAgICB3YXRjaGVyQmF0Y2hlci5wdXNoKHtcbiAgICAgICAgICAgIGlkOiBpZCxcbiAgICAgICAgICAgIG92ZXJyaWRlOiB0cnVlLFxuICAgICAgICAgICAgZXhlY3V0ZTogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrLmFwcGx5KHNlbGYsIGFyZ3MpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfVxuICAgIGNhbGxiYWNrLl9mbiA9IG9uXG4gICAgc2VsZi4kY29tcGlsZXIub2JzZXJ2ZXIub24oJ2NoYW5nZTonICsga2V5LCBvbilcbn0pXG5cbi8qKlxuICogIHVud2F0Y2ggYSBrZXlcbiAqL1xuZGVmKFZNUHJvdG8sICckdW53YXRjaCcsIGZ1bmN0aW9uIChrZXksIGNhbGxiYWNrKSB7XG4gICAgLy8gd29ya2Fyb3VuZCBoZXJlXG4gICAgLy8gc2luY2UgdGhlIGVtaXR0ZXIgbW9kdWxlIGNoZWNrcyBjYWxsYmFjayBleGlzdGVuY2VcbiAgICAvLyBieSBjaGVja2luZyB0aGUgbGVuZ3RoIG9mIGFyZ3VtZW50c1xuICAgIHZhciBhcmdzID0gWydjaGFuZ2U6JyArIGtleV0sXG4gICAgICAgIG9iID0gdGhpcy4kY29tcGlsZXIub2JzZXJ2ZXJcbiAgICBpZiAoY2FsbGJhY2spIGFyZ3MucHVzaChjYWxsYmFjay5fZm4pXG4gICAgb2Iub2ZmLmFwcGx5KG9iLCBhcmdzKVxufSlcblxuLyoqXG4gKiAgdW5iaW5kIGV2ZXJ5dGhpbmcsIHJlbW92ZSBldmVyeXRoaW5nXG4gKi9cbmRlZihWTVByb3RvLCAnJGRlc3Ryb3knLCBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy4kY29tcGlsZXIuZGVzdHJveSgpXG59KVxuXG4vKipcbiAqICBicm9hZGNhc3QgYW4gZXZlbnQgdG8gYWxsIGNoaWxkIFZNcyByZWN1cnNpdmVseS5cbiAqL1xuZGVmKFZNUHJvdG8sICckYnJvYWRjYXN0JywgZnVuY3Rpb24gKCkge1xuICAgIHZhciBjaGlsZHJlbiA9IHRoaXMuJGNvbXBpbGVyLmNoaWxkcmVuLFxuICAgICAgICBpID0gY2hpbGRyZW4ubGVuZ3RoLFxuICAgICAgICBjaGlsZFxuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgY2hpbGQgPSBjaGlsZHJlbltpXVxuICAgICAgICBjaGlsZC5lbWl0dGVyLmVtaXQuYXBwbHkoY2hpbGQuZW1pdHRlciwgYXJndW1lbnRzKVxuICAgICAgICBjaGlsZC52bS4kYnJvYWRjYXN0LmFwcGx5KGNoaWxkLnZtLCBhcmd1bWVudHMpXG4gICAgfVxufSlcblxuLyoqXG4gKiAgZW1pdCBhbiBldmVudCB0aGF0IHByb3BhZ2F0ZXMgYWxsIHRoZSB3YXkgdXAgdG8gcGFyZW50IFZNcy5cbiAqL1xuZGVmKFZNUHJvdG8sICckZGlzcGF0Y2gnLCBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGNvbXBpbGVyID0gdGhpcy4kY29tcGlsZXIsXG4gICAgICAgIGVtaXR0ZXIgPSBjb21waWxlci5lbWl0dGVyLFxuICAgICAgICBwYXJlbnQgPSBjb21waWxlci5wYXJlbnRcbiAgICBlbWl0dGVyLmVtaXQuYXBwbHkoZW1pdHRlciwgYXJndW1lbnRzKVxuICAgIGlmIChwYXJlbnQpIHtcbiAgICAgICAgcGFyZW50LnZtLiRkaXNwYXRjaC5hcHBseShwYXJlbnQudm0sIGFyZ3VtZW50cylcbiAgICB9XG59KVxuXG4vKipcbiAqICBkZWxlZ2F0ZSBvbi9vZmYvb25jZSB0byB0aGUgY29tcGlsZXIncyBlbWl0dGVyXG4gKi9cbjtbJ2VtaXQnLCAnb24nLCAnb2ZmJywgJ29uY2UnXS5mb3JFYWNoKGZ1bmN0aW9uIChtZXRob2QpIHtcbiAgICBkZWYoVk1Qcm90bywgJyQnICsgbWV0aG9kLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBlbWl0dGVyID0gdGhpcy4kY29tcGlsZXIuZW1pdHRlclxuICAgICAgICBlbWl0dGVyW21ldGhvZF0uYXBwbHkoZW1pdHRlciwgYXJndW1lbnRzKVxuICAgIH0pXG59KVxuXG4vLyBET00gY29udmVuaWVuY2UgbWV0aG9kc1xuXG5kZWYoVk1Qcm90bywgJyRhcHBlbmRUbycsIGZ1bmN0aW9uICh0YXJnZXQsIGNiKSB7XG4gICAgdGFyZ2V0ID0gcXVlcnkodGFyZ2V0KVxuICAgIHZhciBlbCA9IHRoaXMuJGVsXG4gICAgdHJhbnNpdGlvbihlbCwgMSwgZnVuY3Rpb24gKCkge1xuICAgICAgICB0YXJnZXQuYXBwZW5kQ2hpbGQoZWwpXG4gICAgICAgIGlmIChjYikgbmV4dFRpY2soY2IpXG4gICAgfSwgdGhpcy4kY29tcGlsZXIpXG59KVxuXG5kZWYoVk1Qcm90bywgJyRyZW1vdmUnLCBmdW5jdGlvbiAoY2IpIHtcbiAgICB2YXIgZWwgPSB0aGlzLiRlbCxcbiAgICAgICAgcGFyZW50ID0gZWwucGFyZW50Tm9kZVxuICAgIGlmICghcGFyZW50KSByZXR1cm5cbiAgICB0cmFuc2l0aW9uKGVsLCAtMSwgZnVuY3Rpb24gKCkge1xuICAgICAgICBwYXJlbnQucmVtb3ZlQ2hpbGQoZWwpXG4gICAgICAgIGlmIChjYikgbmV4dFRpY2soY2IpXG4gICAgfSwgdGhpcy4kY29tcGlsZXIpXG59KVxuXG5kZWYoVk1Qcm90bywgJyRiZWZvcmUnLCBmdW5jdGlvbiAodGFyZ2V0LCBjYikge1xuICAgIHRhcmdldCA9IHF1ZXJ5KHRhcmdldClcbiAgICB2YXIgZWwgPSB0aGlzLiRlbCxcbiAgICAgICAgcGFyZW50ID0gdGFyZ2V0LnBhcmVudE5vZGVcbiAgICBpZiAoIXBhcmVudCkgcmV0dXJuXG4gICAgdHJhbnNpdGlvbihlbCwgMSwgZnVuY3Rpb24gKCkge1xuICAgICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKGVsLCB0YXJnZXQpXG4gICAgICAgIGlmIChjYikgbmV4dFRpY2soY2IpXG4gICAgfSwgdGhpcy4kY29tcGlsZXIpXG59KVxuXG5kZWYoVk1Qcm90bywgJyRhZnRlcicsIGZ1bmN0aW9uICh0YXJnZXQsIGNiKSB7XG4gICAgdGFyZ2V0ID0gcXVlcnkodGFyZ2V0KVxuICAgIHZhciBlbCA9IHRoaXMuJGVsLFxuICAgICAgICBwYXJlbnQgPSB0YXJnZXQucGFyZW50Tm9kZSxcbiAgICAgICAgbmV4dCA9IHRhcmdldC5uZXh0U2libGluZ1xuICAgIGlmICghcGFyZW50KSByZXR1cm5cbiAgICB0cmFuc2l0aW9uKGVsLCAxLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChuZXh0KSB7XG4gICAgICAgICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKGVsLCBuZXh0KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFyZW50LmFwcGVuZENoaWxkKGVsKVxuICAgICAgICB9XG4gICAgICAgIGlmIChjYikgbmV4dFRpY2soY2IpXG4gICAgfSwgdGhpcy4kY29tcGlsZXIpXG59KVxuXG5mdW5jdGlvbiBxdWVyeSAoZWwpIHtcbiAgICByZXR1cm4gdHlwZW9mIGVsID09PSAnc3RyaW5nJ1xuICAgICAgICA/IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoZWwpXG4gICAgICAgIDogZWxcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3TW9kZWwiLCIoZnVuY3Rpb24gKCkge1xudmFyIHJvb3QgPSB0aGlzLCBleHBvcnRzID0ge307XG5cbi8vIFRoZSBqYWRlIHJ1bnRpbWU6XG52YXIgamFkZSA9IGV4cG9ydHMuamFkZT1mdW5jdGlvbihleHBvcnRzKXtBcnJheS5pc0FycmF5fHwoQXJyYXkuaXNBcnJheT1mdW5jdGlvbihhcnIpe3JldHVyblwiW29iamVjdCBBcnJheV1cIj09T2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGFycil9KSxPYmplY3Qua2V5c3x8KE9iamVjdC5rZXlzPWZ1bmN0aW9uKG9iail7dmFyIGFycj1bXTtmb3IodmFyIGtleSBpbiBvYmopb2JqLmhhc093blByb3BlcnR5KGtleSkmJmFyci5wdXNoKGtleSk7cmV0dXJuIGFycn0pLGV4cG9ydHMubWVyZ2U9ZnVuY3Rpb24gbWVyZ2UoYSxiKXt2YXIgYWM9YVtcImNsYXNzXCJdLGJjPWJbXCJjbGFzc1wiXTtpZihhY3x8YmMpYWM9YWN8fFtdLGJjPWJjfHxbXSxBcnJheS5pc0FycmF5KGFjKXx8KGFjPVthY10pLEFycmF5LmlzQXJyYXkoYmMpfHwoYmM9W2JjXSksYWM9YWMuZmlsdGVyKG51bGxzKSxiYz1iYy5maWx0ZXIobnVsbHMpLGFbXCJjbGFzc1wiXT1hYy5jb25jYXQoYmMpLmpvaW4oXCIgXCIpO2Zvcih2YXIga2V5IGluIGIpa2V5IT1cImNsYXNzXCImJihhW2tleV09YltrZXldKTtyZXR1cm4gYX07ZnVuY3Rpb24gbnVsbHModmFsKXtyZXR1cm4gdmFsIT1udWxsfXJldHVybiBleHBvcnRzLmF0dHJzPWZ1bmN0aW9uIGF0dHJzKG9iaixlc2NhcGVkKXt2YXIgYnVmPVtdLHRlcnNlPW9iai50ZXJzZTtkZWxldGUgb2JqLnRlcnNlO3ZhciBrZXlzPU9iamVjdC5rZXlzKG9iaiksbGVuPWtleXMubGVuZ3RoO2lmKGxlbil7YnVmLnB1c2goXCJcIik7Zm9yKHZhciBpPTA7aTxsZW47KytpKXt2YXIga2V5PWtleXNbaV0sdmFsPW9ialtrZXldO1wiYm9vbGVhblwiPT10eXBlb2YgdmFsfHxudWxsPT12YWw/dmFsJiYodGVyc2U/YnVmLnB1c2goa2V5KTpidWYucHVzaChrZXkrJz1cIicra2V5KydcIicpKTowPT1rZXkuaW5kZXhPZihcImRhdGFcIikmJlwic3RyaW5nXCIhPXR5cGVvZiB2YWw/YnVmLnB1c2goa2V5K1wiPSdcIitKU09OLnN0cmluZ2lmeSh2YWwpK1wiJ1wiKTpcImNsYXNzXCI9PWtleSYmQXJyYXkuaXNBcnJheSh2YWwpP2J1Zi5wdXNoKGtleSsnPVwiJytleHBvcnRzLmVzY2FwZSh2YWwuam9pbihcIiBcIikpKydcIicpOmVzY2FwZWQmJmVzY2FwZWRba2V5XT9idWYucHVzaChrZXkrJz1cIicrZXhwb3J0cy5lc2NhcGUodmFsKSsnXCInKTpidWYucHVzaChrZXkrJz1cIicrdmFsKydcIicpfX1yZXR1cm4gYnVmLmpvaW4oXCIgXCIpfSxleHBvcnRzLmVzY2FwZT1mdW5jdGlvbiBlc2NhcGUoaHRtbCl7cmV0dXJuIFN0cmluZyhodG1sKS5yZXBsYWNlKC8mKD8hKFxcdyt8XFwjXFxkKyk7KS9nLFwiJmFtcDtcIikucmVwbGFjZSgvPC9nLFwiJmx0O1wiKS5yZXBsYWNlKC8+L2csXCImZ3Q7XCIpLnJlcGxhY2UoL1wiL2csXCImcXVvdDtcIil9LGV4cG9ydHMucmV0aHJvdz1mdW5jdGlvbiByZXRocm93KGVycixmaWxlbmFtZSxsaW5lbm8pe2lmKCFmaWxlbmFtZSl0aHJvdyBlcnI7dmFyIGNvbnRleHQ9MyxzdHI9cmVxdWlyZShcImZzXCIpLnJlYWRGaWxlU3luYyhmaWxlbmFtZSxcInV0ZjhcIiksbGluZXM9c3RyLnNwbGl0KFwiXFxuXCIpLHN0YXJ0PU1hdGgubWF4KGxpbmVuby1jb250ZXh0LDApLGVuZD1NYXRoLm1pbihsaW5lcy5sZW5ndGgsbGluZW5vK2NvbnRleHQpLGNvbnRleHQ9bGluZXMuc2xpY2Uoc3RhcnQsZW5kKS5tYXAoZnVuY3Rpb24obGluZSxpKXt2YXIgY3Vycj1pK3N0YXJ0KzE7cmV0dXJuKGN1cnI9PWxpbmVubz9cIiAgPiBcIjpcIiAgICBcIikrY3VycitcInwgXCIrbGluZX0pLmpvaW4oXCJcXG5cIik7dGhyb3cgZXJyLnBhdGg9ZmlsZW5hbWUsZXJyLm1lc3NhZ2U9KGZpbGVuYW1lfHxcIkphZGVcIikrXCI6XCIrbGluZW5vK1wiXFxuXCIrY29udGV4dCtcIlxcblxcblwiK2Vyci5tZXNzYWdlLGVycn0sZXhwb3J0c30oe30pO1xuXG5cbi8vIGNyZWF0ZSBvdXIgZm9sZGVyIG9iamVjdHNcblxuLy8gZGVtby5qYWRlIGNvbXBpbGVkIHRlbXBsYXRlXG5leHBvcnRzW1wiZGVtb1wiXSA9IGZ1bmN0aW9uIHRtcGxfZGVtbygpIHtcbiAgICByZXR1cm4gJzxoMT5OYW5jbGUgREVNTzwvaDE+PHA+e3ttZXNzYWdlfX08L3A+PGlucHV0IHYtbW9kZWw9XCJtZXNzYWdlXCIvPic7XG59O1xuXG4vLyBsaXN0LmphZGUgY29tcGlsZWQgdGVtcGxhdGVcbmV4cG9ydHNbXCJsaXN0XCJdID0gZnVuY3Rpb24gdG1wbF9saXN0KCkge1xuICAgIHJldHVybiAnPHVsPjxsaSB2LXJlcGVhdD1cInBlb3BsZVwiPnt7JGluZGV4fX0gLSB7e2ZpcnN0TmFtZX19LCB7e2xhc3ROYW1lfX08L2xpPjwvdWw+Jztcbn07XG5cblxuLy8gYXR0YWNoIHRvIHdpbmRvdyBvciBleHBvcnQgd2l0aCBjb21tb25KU1xuaWYgKHR5cGVvZiBtb2R1bGUgIT09IFwidW5kZWZpbmVkXCIgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzO1xufSBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSBcImZ1bmN0aW9uXCIgJiYgZGVmaW5lLmFtZCkge1xuICAgIGRlZmluZShleHBvcnRzKTtcbn0gZWxzZSB7XG4gICAgcm9vdC50ZW1wbGF0aXplciA9IGV4cG9ydHM7XG59XG5cbn0pKCk7Iiwidm0gPSByZXF1aXJlICcuL3ZpZXdtb2RlbCdcbm1vZGVsID0gcmVxdWlyZSAnLi9tb2RlbCdcblxuZGVtbyA9IG5ldyB2bS5EZW1vXG4gIGVsOiAnI2NvbnRhaW5lcidcbiAgZGF0YTpcbiAgICBtZXNzYWdlOiAnSGVsbG8gbmFuY2xlISdcblxubWVudSA9IG5ldyB2bS5NZW51XG4gIGVsOiAnI2xpc3QnXG4gIGRhdGE6XG4gICAgcGVvcGxlOiBbXVxuXG5rZW4gPSBuZXcgbW9kZWwuUGVyc29uXG4gIGZpcnN0TmFtZTogJ0tlbmljaGlybydcbiAgbGFzdE5hbWU6ICdNdXJhdGEnXG5cbm1lbnUuJGRhdGEucGVvcGxlLnB1c2gga2VuXG5cbmNvbnNvbGUubG9nIEpTT04uc3RyaW5naWZ5KG1lbnUuJGRhdGEpXG5cbmFjcm8gPSBuZXcgbW9kZWwuUGVyc29uXG4gIGZpcnN0TmFtZTogJ0Fjcm9xdWVzdCdcbiAgbGFzdE5hbWU6ICdUZWNobm9sb2d5J1xuXG5tZW51LiRkYXRhLnBlb3BsZS5wdXNoIGFjcm9cblxuY29uc29sZS5sb2cgSlNPTi5zdHJpbmdpZnkobWVudS4kZGF0YSlcblxua2VuLmZpcnN0TmFtZSA9ICdLZW4nXG5cbmNvbnNvbGUubG9nIEpTT04uc3RyaW5naWZ5KG1lbnUuJGRhdGEpXG4iLCJtb2R1bGUuZXhwb3J0cyA9XG4gIFBlcnNvbjogY2xhc3MgUGVyc29uXG4gICAgY29uc3RydWN0b3I6IChvcHRpb25zKSAtPlxuICAgICAge0BmaXJzdE5hbWUsIEBsYXN0TmFtZX0gPSBvcHRpb25zXG4iLCJWdWUgPSByZXF1aXJlICd2dWUnXG50ZW1wbGF0ZXMgPSByZXF1aXJlICcuL190ZW1wbGF0ZXMuanMnXG5cbm1vZHVsZS5leHBvcnRzID1cbiAgRGVtbzogVnVlLmV4dGVuZFxuICAgIHRlbXBsYXRlOiB0ZW1wbGF0ZXMuZGVtbygpXG5cbiAgTWVudTogVnVlLmV4dGVuZFxuICAgIHRlbXBsYXRlOiB0ZW1wbGF0ZXMubGlzdCgpXG4iXX0=
