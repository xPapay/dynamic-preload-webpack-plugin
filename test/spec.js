const webpack = require('webpack')
const path = require('path')
const MemoryFileSystem = require('memory-fs')
const fs = new MemoryFileSystem()
const HTMLWebpackPlugin = require('html-webpack-plugin')
const DynamicPreloadWebpackPlugin = require('../src/DynamicPreloadWebpackPlugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

const baseConfig = (override) => ({
    entry: {},
    output: {
        path: '/dist',
        publicPath: '/dist',
        filename: '[name].js',
        chunkFilename: '[name].chunk.js'
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
    ],
    ...override
})

it('adds preload tags for all late discovered assets of all entries', done => {
    const config = baseConfig({
        entry: {
            app: path.resolve(__dirname, './fixtures/import-picture.js')
        }
    })

    const compiler = webpack(config)
    compiler.outputFileSystem = fs
    
    compiler.run((err, result) => {
        expect(err).toBeFalsy()
        expect(JSON.stringify(result.compilation.errors)).toBe('[]')
        const preloader = result.compilation.assets['preloader.js']
        expect(preloader).toBeUndefined()
        const html = result.compilation.assets['index.html'].source()
        expect(html).toContain('<link rel="preload" href="/dist/hero.jpg" as="image">')
        done()
    })
})

it('does not add preload tags for assets loaded statically by html template', done => {
    const config = baseConfig({
        entry: {
            app: path.resolve(__dirname, './fixtures/import-style.js')
        }
    })

    const compiler = webpack(config)
    compiler.outputFileSystem = fs
    
    compiler.run((err, result) => {
        expect(err).toBeFalsy()
        expect(JSON.stringify(result.compilation.errors)).toBe('[]')
        const html = result.compilation.assets['index.html'].source()
        expect(html).not.toContain('<link rel="preload" href="/dist/app.css" as="style">')
        expect(html).not.toContain('<link rel="preload" href="/dist/app.js" as="script">')
        done()
    })
})

it('does not create static preload tags when preloading depends on route', (done) => {
    const config = baseConfig({
        entry: {
            app: path.resolve(__dirname, './fixtures/router.js')
        },
        plugins: [
            new HTMLWebpackPlugin(),
            new MiniCssExtractPlugin(),
            new DynamicPreloadWebpackPlugin({
                urls: { '/': './hero.jpg' }
            })
        ]
    })

    const compiler = webpack(config)
    compiler.outputFileSystem = fs

    compiler.run((err, result) => {
        expect(err).toBeFalsy()
        expect(JSON.stringify(result.compilation.errors)).toBe('[]')
        const html = result.compilation.assets['index.html'].source()
        expect(html).not.toMatch(/<link .* href="\/dist\/homepage.chunk\.js"/g)
        expect(html).not.toMatch(/<link .* href="\/dist\/hero\.jpg"/g)
        done()
    })
})

it('creates preloader when there are route dependent modules', (done) => {
    const config = baseConfig({
        entry: {
            app: path.resolve(__dirname, './fixtures/router.js')
        },
        plugins: [
            new HTMLWebpackPlugin(),
            new MiniCssExtractPlugin(),
            new DynamicPreloadWebpackPlugin({
                urls: { '/': './hero.jpg' }
            })
        ]
    })

    const compiler = webpack(config)
    compiler.outputFileSystem = fs

    compiler.run((err, result) => {
        expect(err).toBeFalsy()
        expect(JSON.stringify(result.compilation.errors)).toBe('[]')
        const preloader = result.compilation.assets['preloader.js'].source()
        expect(preloader).toMatch('{\"/\":{\"homepage.chunk.js\":true,\"hero.jpg\":true}}')
        done()
    })
})

describe('in order to preload desired module faster', () => {
    it('implicitly preloads all other assets in same chunk as explicitly preloaded module', done => {
        const config = baseConfig({
            entry: {
                app: path.resolve(__dirname, './fixtures/import-two-assets.js')
            },
            plugins: [
                new HTMLWebpackPlugin(),
                new MiniCssExtractPlugin(),
                new DynamicPreloadWebpackPlugin({
                    urls: { '/': './style.css' }
                })
            ]
        })
    
        const compiler = webpack(config)
        compiler.outputFileSystem = fs
    
        compiler.run((err, result) => {
            expect(err).toBeFalsy()
            expect(JSON.stringify(result.compilation.errors)).toBe('[]')
            const html = result.compilation.assets['index.html'].source()
            expect(html).not.toContain('/dist/twoassets.chunk.js')
            expect(html).not.toContain('/dist/twoassets.css')
            expect(html).not.toContain('hero.jpg')
        
            const preloader = result.compilation.assets['preloader.js'].source()
            expect(preloader).toMatch('{\"/\":{\"twoassets.css\":true,\"twoassets.chunk.js\":true,\"hero.jpg\":true}}')
            done()
        })
    })
})

it('can distinguish correct chunk from which to preload remining assets', done => {
    const config = baseConfig({
        entry: {
            app: path.resolve(__dirname, './fixtures/same-module-two-chunks.js')
        },
        plugins: [
            new HTMLWebpackPlugin(),
            new MiniCssExtractPlugin(),
            new DynamicPreloadWebpackPlugin({
                routeModuleMap: {
                    '/': './homepage.js',
                    '/about': './aboutpage.js'
                },
                urls: {
                    '/': ['./hero.jpg', './style.css'],
                    '/about': './hero.jpg'
                }
            })
        ]
    })

    const compiler = webpack(config)
    compiler.outputFileSystem = fs

    compiler.run((err, result) => {
        expect(err).toBeFalsy()
        expect(JSON.stringify(result.compilation.errors)).toBe('[]')
        const html = result.compilation.assets['index.html'].source()
        expect(html).not.toContain('<link rel="preload"')
    
        const preloader = result.compilation.assets['preloader.js'].source()
        expect(preloader).toMatch('{\"/\":{\"homepage.css\":true,\"homepage.chunk.js\":true,\"hero.jpg\":true},\"/about\":{\"aboutpage.chunk.js\":true,\"hero.jpg\":true,\"font.woff2\":true}}')
        done()
    })
})

it('can preload common asset even when there is no route-module mapping', done => {
    const config = baseConfig({
        entry: {
            app: path.resolve(__dirname, './fixtures/same-module-two-chunks.js')
        },
        plugins: [
            new HTMLWebpackPlugin(),
            new MiniCssExtractPlugin(),
            new DynamicPreloadWebpackPlugin({
                urls: {
                    '/': './hero.jpg'
                }
            })
        ]
    })

    const compiler = webpack(config)
    compiler.outputFileSystem = fs

    compiler.run((err, result) => {
        expect(err).toBeFalsy()
        expect(JSON.stringify(result.compilation.errors)).toBe('[]')
    
        const preloader = result.compilation.assets['preloader.js'].source()
        expect(preloader).toMatch('{\"/\":{\"hero.jpg\":true}}')
        done()
    })
})
