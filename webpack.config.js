const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlMinimizerPlugin = require('html-minimizer-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const TerserWebpackPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    mkeditor: [
      './src/browser/index.ts',
      './src/browser/assets/scss/index.scss',
    ],
  },
  output: {
    globalObject: 'self',
    filename: 'mkeditor.bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  optimization: {
    minimizer: [
      new TerserWebpackPlugin({
        extractComments: false,
        terserOptions: {
          compress: {
            passes: 2,
          },
          format: {
            comments: false,
          },
        },
      }),
      new HtmlMinimizerPlugin(),
    ],
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
        use: ['style-loader', 'css-loader', 'postcss-loader'],
      },
      {
        test: /\.scss$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'file-loader',
            options: { name: 'mkeditor.bundle.css' },
          },
          'sass-loader',
        ],
      },
      {
        test: /\.(ttf|woff2?|eot)$/,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
  },
  plugins: [
    new MonacoWebpackPlugin({
      languages: ['markdown'],
      // Trimmed in the bundle-size pass: dropped `codeAction`,
      // `cursorUndo`, `fontZoom`, `inlineCompletions`, `inPlaceReplace`,
      // `referenceSearch`, `wordPartOperations` — none are used by the
      // markdown editor surface (or are bound to keybindings we don't
      // expose).
      features: [
        'bracketMatching',
        'caretOperations',
        'clipboard',
        'contextmenu',
        'find',
        'folding',
        'indentation',
        'lineSelection',
        'linesOperations',
        'links',
        'multicursor',
        'quickCommand',
        'suggest',
        'wordHighlighter',
        'wordOperations',
      ],
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: './src/browser/assets/favicon.ico',
          to: './favicon.ico',
        },
        {
          from: './src/browser/assets/icon.png',
          to: './icon.png',
        },
        { from: './src/browser/views' },
        {
          from: './locale',
          to: './locale',
        },
        {
          from: './node_modules/katex/dist/fonts/*',
          to: 'fonts/[name][ext]',
        },
      ],
    }),
  ],
};
