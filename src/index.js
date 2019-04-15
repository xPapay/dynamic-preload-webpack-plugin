const path = require('path')

class DynamicPreloadWebpackPlugin {
    constructor({ urls, routeModuleMap } = {}) {
        this.preloads = this.parseUrls(urls)
        this.routeModuleMap = routeModuleMap
        this.routeToAssets = {}
        this.publicPath = '/'
    }

    parseUrls(urls) {
        if (!urls) return {}
        return Object.keys(urls).reduce((acc, url) => {
            const preloads = urls[url] instanceof Array ? urls[url] : [urls[url]]
            return acc = { ...acc, [url]: preloads }
        }, {})
    }

    apply(compiler) {
        compiler.hooks.compilation.tap(this.constructor.name, compilation => {
            this.publicPath = compilation.options.output.publicPath || '/'
            compilation.hooks.htmlWebpackPluginAfterHtmlProcessing.tapAsync(this.constructor.name, (htmlData, cb) => {
                cb(null, this.createPreloading(htmlData, compilation))
            })
        })
    }

    createPreloading(htmlData, compilation) {
        Object.keys(this.preloads).map(url => {
            this.routeToAssets[url] = {}
            const modules = this.preloads[url]
            modules.map(moduleName => {
                this.mapModuleToAsset(moduleName, url, compilation)
            })
            // TODO: preload late discovered assets. (assets inside scripts which are loaded by html)
            this.routeToAssets[url] = Object.keys(this.routeToAssets[url])
                .filter(asset => !this.getHtmlAssests(htmlData).includes(asset))
        })

        if (this.hasLateDiscoveredAssetsInAppShelf(compilation, htmlData)) {
            const assets = this.getLateDiscoveredAssets(compilation, htmlData)
            assets.map(asset => {
                const link = this.createLink(asset)
                htmlData.html = this.appendToHead(link, htmlData.html)
            })
        }
        
        if (this.hasDynamicPreloads()) {
            const scriptTag = this.createPreloadScript(compilation)
            // TODO: let HtmlWebpack plugin handle adding script
            htmlData.html = this.appendToHead(scriptTag, htmlData.html)
        }

        return htmlData
    }

    hasLateDiscoveredAssetsInAppShelf(compilation, htmlData) {
        return this.getLateDiscoveredAssets(compilation, htmlData).length > 0
    }

    getLateDiscoveredAssets(compilation, htmlData) {
        return Object.keys(htmlData.assets.chunks).reduce((acc, chunkName) => {
            const chunk = compilation.chunks.find(chunk => chunk.name === chunkName)
            const assets = Object.keys(this.getChunkAssets(chunk))
            return acc = [ ...acc, ...assets ]
        }, [])
    }

    createLink(asset) {
        const data = this.createResource(asset)
        return `<link rel="${data.rel}" href="${data.href}" as="${data.as}">`
    }

    hasDynamicPreloads() {
        return !(Object.entries(this.routeToAssets).length === 0 && this.routeToAssets.constructor === Object)
    }

    buildPreloaderSource() {
        const urls = Object.keys(this.routeToAssets).reduce((acc, url) => {
            let resources = this.routeToAssets[url].map(this.createResource.bind(this))
            return acc = { ...acc, [url]: resources }
        }, {})

        const serialized = JSON.stringify(urls)
        return `
            const urls = (${serialized})
            if (urls[window.location.pathname]) {
                urls[window.location.pathname].map(resource => {
                    const link = document.createElement("link")
                    link.href = resource.href
                    link.rel = resource.rel
                    link.as = resource.as || 'script'
                    document.head.appendChild(link)
                })
            }
        `
    }

    createPreloadScript(compilation, name = 'preloader.js') {
        const preloaderSource = this.buildPreloaderSource()
        compilation.assets[name] = {
            source: () => preloaderSource,
            size: () => preloaderSource.length
        }
        return `<script src="${path.resolve(this.publicPath, name)}"></script>`
    }

    createResource(href) {
        return {
            rel: 'preload',
            href,
            as: this.getAs(href)
        }
    }

    appendToHead(htmlToAppend, html) {
        return html.replace('</head>', htmlToAppend + '</head>')
    }

    getAs(file) {
        if (file.match(/\.(jpe?g|png|svg|gif)$/)) return 'image'
        if (file.match(/\.(css)$/)) return 'style'
        return 'script'
    }

    mapModuleToAsset(moduleName, url, compilation) {
        const module = this.getModuleByName(moduleName, compilation)
        if (!module) {
            console.warn(`Module: ${moduleName} not found. Did you make typo?`)
            return
        }
        const chunks = Array.from(module.chunksIterable)
        if (chunks.length === 1) {
            const allAssets = this.getAllChunkAssets(chunks[0])
            this.routeToAssets[url] = { ...this.routeToAssets[url], ...allAssets }
            return
        }
        // if there is more chunks
        // try to load what we can even without routeModuleMapping
        const allAssets = this.getModuleAssets(module)
        this.routeToAssets[url] = { ...this.routeToAssets[url], ...allAssets }
        // and if we have routeModuleMapping it's a bonus
        this.routeModuleMap && this.routeModuleMap[url] && this.mapModuleToAsset(this.routeModuleMap[url], url, compilation)
    }

    getModuleByName(name, compilation) {
        return compilation.modules.find(module => {
            return module.rawRequest === name || (module.modules && this.flatModules(module.modules).some(nestedModule => nestedModule.rawRequest === name))
        })
    }

    flatModules(modules) {
        const flat = module => {
            if (module.constructor.name === 'ConcatenatedModule' || module.modules) {
                return module.modules.reduce((acc, module) => acc = [ ...acc, ...flat(module)], [])
            }
            return [module]
        }

        return modules.reduce((acc, module) => acc = [ ...acc, ...flat(module)], [])
    }

    getChunkAssets(chunk) {
        return Array.from(chunk.modulesIterable).reduce((acc, module) => {
            return acc = { ...acc, ...this.getModuleAssets(module) }
        }, {})
    }

    getChunkFiles(chunk) {
        return chunk.files.reduce((acc, file) => acc = { ...acc, [this.getPublicPath(file)]: true }, {})
    }

    getAllChunkAssets(chunk) {
        const files = this.getChunkFiles(chunk)
        const assets = this.getChunkAssets(chunk)
        return { ...files, ...assets }
    }

    getModuleAssets(module) {
        const { buildInfo } = module
        if (!buildInfo || !buildInfo.assets) {
            return {}
        }

        return Object.keys(buildInfo.assets).reduce((acc, asset) => asset = { ...acc, [this.getPublicPath(asset)]: true }, {})
    }

    getPublicPath(asset) {
        return path.resolve(this.publicPath, asset)
    }

    getHtmlAssests(htmlData) {
        const { assets } = htmlData
        return [ ...assets.css, ...assets.js ]
    }

    getCompilationAssets(compilation) {
        return Object
            .keys(compilation.assets)
            .reduce((acc, asset) => acc = [ ...acc, this.getPublicPath(asset)], [])
    }
}

module.exports = DynamicPreloadWebpackPlugin
