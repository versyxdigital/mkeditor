const path = require('path');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const TerserWebpackPlugin = require('terser-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    mkeditor: [
      './src/browser/index.ts',
      './src/browser/assets/scss/index.scss'
    ]
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
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
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
        type: 'asset/resource'
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  plugins: [
    new MonacoWebpackPlugin({
      languages: ['markdown'],
      // features: [
      //   'bracketMatching',
      //   'caretOperations',
      //   'clipboard',
      //   'codeAction',
      //   'contextmenu',
      //   'cursorUndo',
      //   'find',
      //   'folding',
      //   'fontZoom',
      //   'inlineCompletions',
      //   'inPlaceReplace',
      //   'indentation',
      //   'lineSelection',
      //   'linesOperations',
      //   'links',
      //   'multicursor',
      //   'quickCommand',
      //   'referenceSearch',
      //   'suggest',
      //   'wordHighlighter',
      //   'wordOperations',
      //   'wordPartOperations'
      // ]
    }),
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: './src/browser/assets/favicon.ico',
          to: './favicon.ico'
        },
        { from: './src/browser/views'}
      ]
    })
  ]
};
