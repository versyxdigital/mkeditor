#!/usr/bin/env bash

echo "Cleaning previous mkeditor distribution..."
rm -rf ./dist

echo "Cleaning previous installers..."
rm -rf ./releases

echo "Cleaning up previous playground..."
rm -rf ./docs/edit

echo "Building mkeditor distribution..."
npm run build:editor

echo "Building electron wrapper..."
npx tsc ./src/app/*.ts --outDir ./dist/app

echo "Building installer..."
npm run build:installer
cp -r ./src/app/assets ./dist/app/

echo "Building playground..."
mkdir ./docs/edit
cp ./dist/index.html ./docs/edit/
cp ./dist/favicon.ico ./docs/edit/
cp ./dist/editor.worker.js ./docs/edit/
cp ./dist/mkeditor.bundle.js ./docs/edit/
cp ./dist/mkeditor.bundle.css ./docs/edit/
cp ./dist/*.ttf docs/edit

echo "Build complete!"