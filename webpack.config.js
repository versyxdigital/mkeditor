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
    // Drop obsolete renderer chunks after changing the Monaco subset, while
    // retaining the separately compiled Electron main/preload output.
    clean: { keep: /^app(?:\/|$)/ },
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
    // The package root eagerly registers all Monaco languages and features,
    // bypassing the plugin's subset. Alias only bare imports, preserving the
    // editor.api and contribution imports inside this small lazy entry point.
    alias: {
      'monaco-editor$': path.resolve(__dirname, 'src/browser/monaco.ts'),
      // Monaco's exports map only resolves JavaScript subpaths. Keep this
      // required stylesheet import explicit instead of bypassing the API alias.
      'monaco-editor/base/browser/ui/codicons/codicon/codicon-modifiers.css$':
        path.resolve(
          __dirname,
          'node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css',
        ),
    },
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
        'codeEditor',
        'diffEditor',
        'codicon',
        'tokenization',
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
        // SuggestController is explicitly registered in src/browser/monaco.ts;
        // 0.57's 'suggest' metadata instead includes unused inline suggestions.
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
