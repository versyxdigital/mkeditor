#!/usr/bin/env bash

echo "Cleaning previous distribution..."
rm -rf ./dist

echo "Building editor..."
npm run build:editor

echo "Building electron wrapper..."
npx tsc src/app/*.ts --outDir ./dist/app