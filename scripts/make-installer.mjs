import path from 'path';
import {
  __filename,
  __dirname,
  cleanDir,
  compileApp,
  execTask,
} from './compile-app.mjs';

console.log('Cleaning previous distribution...');
cleanDir(path.join(__dirname, 'dist'));

console.log('Cleaning previous installers...');
cleanDir(path.join(__dirname, 'releases'));

console.log('Compiling editor fom src/browser...');
execTask('npm run build-editor');

console.log('Compiling app from src/app...');
compileApp();

console.log('Building app installer...');
// `--publish never` keeps electron-builder from auto-uploading under CI
// (it detects GITHUB_ACTIONS and otherwise tries to use GH_TOKEN). The
// release workflow publishes via softprops/action-gh-release instead.
execTask('electron-builder --publish never');

console.log('Build complete!');
