import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function clean(directory) {
  if (fs.existsSync(directory)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function run(command) {
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    process.exit(1);
  }
}

console.log('Cleaning previous distribution...');
clean(path.join(__dirname, 'dist'));

console.log('Cleaning previous installers...');
clean(path.join(__dirname, 'releases'));

console.log('Building app fom src/browser...');
run('npm run build-editor');

console.log('Building electron wrapper from src/app...');
const electronFiles = fs
  .readdirSync(path.join(__dirname, 'src/app'))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => path.join('src/app', file))
  .join(' ');

if (electronFiles) {
  run(`npx tsc ${electronFiles} --outDir ./dist/app`);
} else {
  console.error('No build files found in src/app.');
  process.exit(1);
}

console.log('Building app installer...');
run('npm run build-installer');

console.log('Build complete!');
