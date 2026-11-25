const path = require('path');
const renderer = require('./webpack.config.js');

// A deployable website has its own output directory. Desktop builds retain
// dist/app, while cleaning this target can never publish Electron configuration.
module.exports = {
  ...renderer,
  output: {
    ...renderer.output,
    path: path.resolve(__dirname, 'out', 'web'),
    clean: true,
  },
};
