const webpack = require('webpack')
const path = require('path')
const MemoryFileSystem = require('memory-fs')
const fs = new MemoryFileSystem()
const HTMLWebpackPlugin = require('html-webpack-plugin')
const DynamicPreloadWebpackPlugin = require('../src/DynamicPreloadWebpackPlugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

test('it adds preload tags for all assets of all entries', done => {
    const config = {
        entry: {
            one: path.resolve(__dirname, './fixtures/import-picture.js'),
            two: path.resolve(__dirname, './fixtures/import-style.js')
        },
        output: {
            path: '/dist',
            filename: '[name].js',
            chunkFilename: '[name].chunks.js'
        },
        module: {
            rules: [
                {
                    test: /\.css$/,
                    use: [
                        {
                            loader: MiniCssExtractPlugin.loader
                        },
                        'css-loader'
                    ]
                },
                {
                    test: /\.(jpg|woff2)$/,
                    use: {
                        loader: 'file-loader',
                        options: {
                            name: '[name].[ext]'
                        }
                    }
                }
            ]
        },
        plugins: [
            new HTMLWebpackPlugin(),
            new MiniCssExtractPlugin(),
            new DynamicPreloadWebpackPlugin()
        ]
    }
    
    const compiler = webpack(config)
    compiler.outputFileSystem = fs
    
    compiler.run((err, result) => {
        expect(err).toBeFalsy()
        expect(JSON.stringify(result.compilation.errors)).toBe('[]')
        const html = result.compilation.assets['index.html'].source()
        expect(html).toContain('<link rel="preload" href="/dist/hero.jpg" as="image">')
        expect(html).not.toContain('<link rel="preload" href="/dist/two.css" as="style">')
        expect(html).not.toContain('<link rel="preload" href="/dist/one.js" as="script">')
        expect(html).not.toContain('<link rel="preload" href="/dist/two.js" as="script">')
        expect(html).not.toContain('<link rel="preload" href="/dist/index.thml"')
        done()
    })
})

