#!/usr/bin/env bash

echo "Cleaning previous distribution..."
rm -rf ./dist

echo "Building editor..."
npm run build:editor

echo "Building electron wrapper..."
npx tsc src/app/*.ts --outDir ./dist/app

echo "Cleaning previous installers..."
rm -rf ./releases

echo "Building installer..."
npm run build:installer

echo "Rebuilding docs playground..."
rm -rf ./docs/edit
mkdir ./docs/edit
cp dist/index.html ./docs/edit/
cp dist/favicon.ico ./docs/edit/
cp dist/editor.worker.js ./docs/edit/
cp dist/mkeditor.bundle.js ./docs/edit/
cp dist/mkeditor.bundle.css ./docs/edit/
cp dist/*.ttf docs/edit

echo "Build complete!"