const path = require('path')

class DynamicPreloadWebpackPlugin {
    constructor(options) {
        this.preloads = null
        this.routeModuleMap = {}
        this.preloader = {}
        this.publicPath = ''
        this.parseOptions(options)
    }

    parseOptions(options) {
        if (!options) return

        if (options.urls) {
            Object.keys(options.urls).map(url => {
                if (typeof options.urls[url] === 'string') {
                    options.urls[url] = [options.urls[url]]
                }
            })
            this.preloads = options.urls
        }

        if (options.routeModuleMap) {
            this.routeModuleMap = options.routeModuleMap
        }
    }

    apply(compiler) {
        compiler.hooks.compilation.tap(this.constructor.name, compilation => {
            this.publicPath = compilation.options.output.publicPath || compilation.options.output.path
            compilation.hooks.htmlWebpackPluginAfterHtmlProcessing.tapAsync(this.constructor.name, (htmlData, cb) => {
                cb(null, this.createPreloading(htmlData, compilation))
            })
        })
    }

    hasDynamicPreloads() {
        return ! (Object.entries(this.preloader).length === 0 && this.preloader.constructor === Object)
    }

    buildPreloaderSource() {
        let urls = {}
        Object.keys(this.preloader).map(url => {
            urls[url] = Object.keys(this.preloader[url]).map(this.createResource.bind(this))
        })
        const serialized = JSON.stringify(urls)
        return `
            (${serialized})[window.location.pathname].map(resource => {
                const link = document.createElement("link")
                link.href = resource.href
                link.rel = resource.rel
                link.as = resource.as || 'script'
                document.head.appendChild(link)
            })
        `
    }

    createPreloading(htmlData, compilation) {
        const { assets } = compilation
        Object.keys(assets).map(asset => {
            if (this.isLoadedByHtmlTemplate(path.resolve(this.publicPath, asset), htmlData.assets)) return
            if (this.isLateDiscoveredAppShelfAsset(asset, Object.keys(htmlData.assets.chunks), compilation)) {
                return htmlData.html = this.preloadStatically(asset, htmlData.html)
            }

            if (this.isRouteSpecificAsset(asset, compilation)) {
                this.preloadDynamically(asset, compilation)
            }
        })

        if (this.hasDynamicPreloads()) {
            const script = this.createPreloadScript(compilation, 'preloader.js')
            htmlData.html = this.appendToHead(script, htmlData.html)
        }

        return htmlData
    }

    createPreloadScript(compilation, name = 'preloader.js') {
        const preloaderSource = this.buildPreloaderSource()
        compilation.assets[name] = {
            source: () => preloaderSource,
            size: () => preloaderSource.length
        }
        return `<script src="${path.resolve(this.publicPath, name)}"></script>`
    }

    preloadStatically(asset, html) {
        const link = this.createLink(asset)
        return this.appendToHead(link, html)
    }

    preloadDynamically(asset, compilation) {
        if (! this.preloads) return

        const chunks = this.getChunks(asset, compilation)
        if (!chunks) {
            console.log(`This is weird asset: ${asset} was not found in any chunk`)
            return
        }

        if (chunks.length === 1) {
            const chunkModules = chunks[0].getModules()
            Object.keys(this.preloads).map(url => {
                const foundMatch = this.preloads[url]
                    .filter(moduleName => {
                        return chunkModules.some(module => {
                            return (module.rawRequest === moduleName) && this.getModule(moduleName, compilation).chunksIterable.size < 2
                        })
                    })

                if (foundMatch.length > 0) {
                    const assets = this.getChunkAssets(chunks[0])
                    this.addPreloaderAssets(assets, url)
                }
            })
            return
        }

        // if there is multiple chunks
        Object.keys(this.preloads).map(url => {
            const viewModule = this.routeModuleMap[url]
            if (viewModule) {
                const chunk = chunks.find(chunk => chunk.getModules().some(module => module.rawRequest === viewModule))
                if (chunk) {
                    const assets = this.getChunkAssets(chunk)
                    this.addPreloaderAssets(assets, url)
                }
                return
            }

            const commonModules = chunks.reduce((accumulator, chunk) => {
                if (typeof accumulator !== 'array') {
                    accumulator = accumulator.getModules()
                }
                return accumulator.filter(module => chunk.getModules().includes(module))
            })

            if (commonModules.length < 1) return

            const match = this.preloads[url].some(moduleRawRequest => commonModules.some(module => module.rawRequest === moduleRawRequest))
            if (!match) {
                return
            }
            this.addPreloaderAssets(asset, url)
        })
    }

    isLateDiscoveredAppShelfAsset(asset, htmlChunks, compilation) {
        return compilation.chunks.filter(chunk => htmlChunks.indexOf(chunk.name) > -1)
            .some(chunk => this.getChunkAssets(chunk).includes(asset))
    }

    isLoadedByHtmlTemplate(asset, htmlAssets) {
        const allHtmlAssets = [ ...htmlAssets.css, ...htmlAssets.js ]
        return allHtmlAssets.find(htmlAsset => htmlAsset === asset)
    }

    isRouteSpecificAsset(asset, compilation) {
        if (!this.preloads) return false

        const chunks = this.getChunks(asset, compilation)

        const allRequiredModules = Object.values(this.preloads)
            .reduce((accumulator, assets) => accumulator = [ ...accumulator, ...assets ], [])

        return chunks.some(chunk => chunk.getModules().some(module => allRequiredModules.includes(module.rawRequest)))
    }

    getModule(rawRequest, compilation) {
        return compilation.modules.find(module => module.rawRequest === rawRequest)
    }

    getChunkAssets(chunk) {
        const files = chunk.files
        const assets = Array.from(chunk.modulesIterable).reduce((accumulator, module) => {
            let assets = this.getModuleAssets(module)
            return accumulator = [ ...accumulator, ...assets ]
        }, [])
        return [ ...files, ...assets ]
    }

    getChunks(asset, compilation) {
        return compilation.chunks.filter(chunk => this.getChunkAssets(chunk).includes(asset))
    }

    getModuleAssets(module) {
        const { buildInfo } = module
        if (!buildInfo || !buildInfo.assets) {
            return []
        }

        return Object.keys(buildInfo.assets)
    }

    addPreloaderAssets(assets, url) {
        if (typeof assets === 'string') {
            assets = [assets]
        }
        
        const assetsObject = assets.reduce((accumulator, asset) => {
            return accumulator = { ...accumulator, [asset]: true}
        }, {})

        this.preloader[url] = { ...this.preloader[url], ...assetsObject }
    }

    createResource(asset) {
        return {
            rel: 'preload',
            href: path.resolve(this.publicPath, asset),
            as: this.getAs(asset)
        }
    }

    createLink(asset) {
        const data = this.createResource(asset)
        return `<link rel="${data.rel}" href="${data.href}" as="${data.as}">`
    }

    appendToHead(htmlToAppend, html) {
        return html.replace('</head>', htmlToAppend + '</head>')
    }

    getAs(file) {
        if (file.match(/\.(jpe?g|png|svg|gif)$/)) return 'image'
        if (file.match(/\.(css)$/)) return 'style'
        return 'script'
    }
}

module.exports = DynamicPreloadWebpackPlugin
