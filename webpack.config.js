const path = require('path');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const TerserWebpackPlugin = require('terser-webpack-plugin');
// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports = {
    mode: 'production',
    entry: {
        mkeditor: ['./src/app/index.js', './src/app/assets/scss/index.scss']
    },
    output: {
        globalObject: 'self',
        filename: 'mkeditor.bundle.js',
        path: path.resolve(__dirname, 'dist')
    },
    optimization: {
        minimizer: [new TerserWebpackPlugin({
            extractComments: true
        })]
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
                        options: { name: 'mkeditor.bundle.css' }
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
            languages: ['markdown'],
            features: [
                'clipboard',
                'cursorUndo',
                'find',
                'fontZoom',
                'inPlaceReplace',
                'indentation',
                'lineSelection',
                'links',
                'multicursor',
                'quickCommand',
                'referenceSearch',
                'wordHighlighter'
            ]
        }),
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 1
        })
        // new BundleAnalyzerPlugin()
    ]
};
