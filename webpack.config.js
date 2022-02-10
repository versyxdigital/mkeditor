const path = require('path')
const webpack = require('webpack')
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin')

module.exports = {
    mode: 'production',
    entry: {
        mkeditor: ['./app/index.js', './app/assets/scss/index.scss'],
    },
    output: {
        globalObject: 'self',
        filename: 'mkeditor.bundle.js',
        path: path.resolve(__dirname, 'dist')
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
            {
                test: /\.scss$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'file-loader',
                        options: {name: 'mkeditor.bundle.css'}
                    },
                    'sass-loader'
                ]
            },
            {
                test: /\.ttf$/,
                use: ['file-loader']
            }
        ]
    },
    plugins: [
        new MonacoWebpackPlugin({
            languages: ['markdown']
        }),
        new webpack.ProvidePlugin({
            $: 'jquery',
            jQuery: 'jquery',
            Popper: ['popper.js', 'default']
        }),
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 1
        })
    ]
}