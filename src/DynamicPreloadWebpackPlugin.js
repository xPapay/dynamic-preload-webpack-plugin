const path = require('path')

class DynamicPreloadWebpackPlugin {
    constructor(options) {
        this.preloads = options
        this.preloader = {}
        this.publicPath = ''
    }

    apply(compiler) {
        compiler.hooks.compilation.tap(this.constructor.name, compilation => {
            this.publicPath = compilation.options.output.publicPath || compilation.options.output.path
            compilation.hooks.htmlWebpackPluginAfterHtmlProcessing.tapAsync(this.constructor.name, (htmlData, cb) => {
                cb(null, this.createPreloading(htmlData, compilation))
            })
        })

        compiler.hooks.emit.tap(this.constructor.name, compilation => {
            if (!this.hasDynamicPreloads()) {
                return
            }
            const preloaderSource = this.buildPreloaderSource()
            compilation.assets['preloader.js'] = {
                source: () => preloaderSource,
                size: () => preloaderSource.length
            }
        })
    }

    hasDynamicPreloads() {
        return ! (Object.entries(this.preloader).length === 0 && this.preloader.constructor === Object)
    }

    buildPreloaderSource() {
        return JSON.stringify(this.preloader)
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

        return htmlData
    }

    preloadStatically(asset, html) {
        const link = this.createLink(path.resolve(this.publicPath, asset))
        return this.appendLinkToHead(link, html)
    }

    preloadDynamically(asset, compilation) {
        const chunk = this.getChunk(asset, compilation)
        const modules = chunk.getModules()
        const assets = this.getChunkAssets(chunk)
        const urls = Object.keys(this.preloads)
            .filter(url => modules.some(module => module.rawRequest === this.preloads[url]))
        this.addPreloaderAssets(assets, urls)
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

        const chunk = this.getChunk(asset, compilation)
        const modules = chunk.getModules()
        return modules.some(module => Object.values(this.preloads).includes(module.rawRequest))
    }

    getChunkAssets(chunk) {
        const files = chunk.files
        const assets = Array.from(chunk.modulesIterable).reduce((accumulator, { buildInfo }) => {
            let assets = buildInfo && buildInfo.assets && Object.keys(buildInfo.assets)
            return assets ? accumulator = [ ...accumulator, ...assets ] : accumulator
        }, [])
        return [ ...files, ...assets ]
    }

    getChunk(asset, compilation) {
        // TODO: Can more than one chunk point to same file?
        return compilation.chunks.find(chunk => this.getChunkAssets(chunk).includes(asset))
    }

    addPreloaderAssets(assets, urls) {
        const assetsObject = assets.reduce((accumulator, asset) => {
            return accumulator = { ...accumulator, [asset]: true}
        }, {})

        urls.map(url => {
            if (! this.preloader[url]) {
                this.preloader[url] = {}
            }
            this.preloader[url] = { ...this.preloader[url], ...assetsObject }
        })
    }

    createLink(asset) {
        const data = {
            rel: 'preload',
            href: asset,
            as: this.getAs(asset)
        }
        return `<link rel="${data.rel}" href="${data.href}" as="${data.as}">`
    }

    appendLinkToHead(link, html) {
        return html.replace('</head>', link + '</head>')
    }

    getAs(file) {
        if (file.match(/\.(jpg)$/)) return 'image'
        if (file.match(/\.(css)$/)) return 'style'
        return 'script'
    }
}

module.exports = DynamicPreloadWebpackPlugin
