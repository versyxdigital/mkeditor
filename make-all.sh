#!/usr/bin/env bash

echo "Cleaning previous mkeditor distribution..."
rm -rf ./dist

echo "Cleaning previous installers..."
rm -rf ./releases

echo "Building mkeditor distribution..."
npm run build-editor

echo "Building electron wrapper..."
npx tsc src/app/*.ts --outDir ./dist/app

echo "Building installer..."
npm run build-installer

echo "Build complete!"