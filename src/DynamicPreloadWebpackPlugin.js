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
                cb(null, this.addLinks(htmlData, compilation))
            })
        })

        compiler.hooks.emit.tap(this.constructor.name, compilation => {
            const preloaderSource = this.buildPreloader()
            compilation.assets['preloader.js'] = {
                source: () => preloaderSource,
                size: () => preloaderSource.length
            }
        })
    }

    buildPreloader() {
        return JSON.stringify(this.preloader)
    }

    addLinks(htmlData, compilation) {
        const { assets } = compilation

        Object.keys(assets)
            .filter(asset => !this.isLoadedByHtmlTemplate(path.resolve(this.publicPath, asset), htmlData.assets))
            .filter(asset => !this.isRouteSpecificModule(asset, compilation))
            .map(asset => {
                const link = this.createLink(path.resolve(this.publicPath, asset))
                htmlData.html = htmlData.html.replace('</head>', link + '</head>')
            })
        return htmlData
    }

    isLoadedByHtmlTemplate(asset, htmlAssets) {
        const allHtmlAssets = [ ...htmlAssets.css, ...htmlAssets.js ]
        return allHtmlAssets.find(htmlAsset => htmlAsset === asset)
    }

    isRouteSpecificModule(asset, compilation) {
        if (!this.preloads) return false

        const module = this.getAssetModule(asset, compilation)
        if (!module) {
            console.log(`This is weird. ${asset} was not found in any of the modules. TODO:`)
            return false
        }
        
        const isExplicitlyPreloaded = Object.keys(this.preloads).find(url => this.preloads[url] === module.rawRequest)
        
        if (isExplicitlyPreloaded) {
            const url = isExplicitlyPreloaded
            this.addPreloaderAsset(asset, url)
            return true
        }
        
        const ancestorModules = this.getAncestorModules(module)
        const isImplicitlyPreloaded = Object.keys(this.preloads)
            .find(url => ancestorModules.some(module => module.rawRequest === this.preloads[url]))
        
            if (isImplicitlyPreloaded) {
            const url = isImplicitlyPreloaded
            this.addPreloaderAsset(asset, url)
            return true
        }

        return false
    }

    addPreloaderAsset(asset, url) {
        asset = {
            rel: 'preload',
            href: path.resolve(this.publicPath, asset),
            as: this.getAs(asset)
        }

        this.preloader[url] 
            ? this.preloader[url].push(asset)
            : this.preloader[url] = [asset]
    }

    getAncestorModules(module, accumulate = []) {
        if (module.issuer) {
            accumulate.push(module)
            return this.getAncestorModules(module.issuer, accumulate)
        }
        accumulate.push(module)
        return accumulate
    }

    getAssetModule(asset, compilation) {
        return compilation.modules.find(module => {
            const fileFound = Array.from(module.chunksIterable).some(chunk => {
                return chunk.files.some(file => file === asset)
            })

            if (fileFound) return true

            const { buildInfo } = module
            const assetFound = buildInfo && buildInfo.assets && Object.keys(buildInfo.assets).find(file => file === asset)
            return assetFound
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

    getAs(file) {
        if (file.match(/\.(jpg)$/)) return 'image'
        if (file.match(/\.(css)$/)) return 'style'
        return 'script'
    }
}

module.exports = DynamicPreloadWebpackPlugin
