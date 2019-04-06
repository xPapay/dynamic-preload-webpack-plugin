const path = require('path')

class DynamicPreloadWebpackPlugin {
    apply(compiler) {
        compiler.hooks.compilation.tap(this.constructor.name, compilation => {
            compilation.hooks.htmlWebpackPluginAfterHtmlProcessing.tapAsync(this.constructor.name, (htmlData, cb) => {
                cb(null, this.addLinks(htmlData, compilation))
            })
        })
    }

    addLinks(htmlData, compilation) {
        const { assets } = compilation

        const publicPath = compilation.options.output.publicPath || compilation.options.output.path
        Object.keys(assets)
            .filter(asset => !this.isEntryScript(asset, compilation))
            .map(asset => {
                const link = this.createLink(path.resolve(publicPath, asset))
                htmlData.html = htmlData.html.replace('</head>', link + '</head>')
            })
        return htmlData
    }

    isEntryScript(asset, compilation) {
        return compilation.entries.some(entry => {
            return Array.from(entry.chunksIterable).some(chunk => {
                return chunk.files.some(file => asset === file)
            })
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
