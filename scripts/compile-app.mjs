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
  const appFiles = fs
    .readdirSync(path.join(__dirname, 'src/app'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => path.join('src/app', file))
    .join(' ');

  if (appFiles) {
    execTask(
      `npx tsc ${appFiles} --outDir ${path.join(__dirname, 'dist', 'app')}`,
    );
  } else {
    console.error('No build files found in src/app.');
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Cleaning previous distribution...');
  cleanDir(path.join(__dirname, 'dist', 'app'));

  console.log('Compiling app from src/app...');
  compileApp();
}
