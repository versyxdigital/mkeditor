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
execTask('electron-builder');

console.log('Build complete!');
