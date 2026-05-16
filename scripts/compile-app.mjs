import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.resolve(path.dirname(__filename), '..');

export function cleanDir(directory) {
  if (fs.existsSync(directory)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function execTask(command) {
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error executing: ${command}`);
    process.exit(1);
  }
}

export function compileApp() {
  execTask('npx tsc -p src/app/tsconfig.json');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Cleaning previous distribution...');
  cleanDir(path.join(__dirname, 'dist', 'app'));

  console.log('Compiling app from src/app...');
  compileApp();
}
