// Run on the target VPS after copying standalone, before reloading the app.
// A macOS standalone build contains the Darwin binary, not the Linux binary.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

function ensureCanvasRuntime() {
  const requestedRoot = process.argv[2];
  if (!requestedRoot || !path.isAbsolute(requestedRoot)) {
    throw new Error('Podaj bezwzględną ścieżkę wdrożonego katalogu standalone.');
  }
  const root = fs.realpathSync(requestedRoot);
  if (!fs.existsSync(path.join(root, 'server.js'))) {
    throw new Error('Wskazany katalog nie zawiera aplikacji standalone.');
  }
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) {
    throw new Error('Ten krok wdrożenia obsługuje serwer Linux x64 lub arm64.');
  }
  const libc = process.report.getReport().header.glibcVersionRuntime ? 'gnu' : 'musl';
  const nativeName = `@napi-rs/canvas-linux-${process.arch}-${libc}`;
  const scope = path.join(root, 'node_modules', '@napi-rs');
  const canvasPackage = JSON.parse(fs.readFileSync(path.join(scope, 'canvas', 'package.json'), 'utf8'));
  // Use the version shipped with this release, not a range or the latest version.
  const version = canvasPackage.optionalDependencies?.[nativeName];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)
    || version !== canvasPackage.version) {
    throw new Error('Brak zgodnej, dokładnej wersji natywnego komponentu canvas.');
  }
  const destination = path.join(root, 'node_modules', nativeName);
  const runtimeRequire = createRequire(path.join(root, 'server.js'));
  const readNativePackage = (directory) => {
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (metadata.name !== nativeName || metadata.version !== version) {
      throw new Error('Natywny komponent ma inną wersję niż wdrożona biblioteka canvas.');
    }
  };
  const loadRuntime = () => {
    const canvas = runtimeRequire('@napi-rs/canvas');
    if (typeof canvas.createCanvas !== 'function' || typeof canvas.loadImage !== 'function') {
      throw new Error('Nie udało się załadować komponentu obrazów.');
    }
  };
  if (fs.existsSync(destination)) {
    readNativePackage(destination);
    loadRuntime();
    console.log(`Komponent obrazów jest gotowy: ${nativeName}@${version}`);
    return;
  }

  // Install only this optional binary in isolation. Never run yarn install in
  // the live application or change its manifest, lockfile or other packages.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mavinci-canvas-runtime-'));
  let stage;
  try {
    execFileSync('yarn', [
      '--cwd', temporary, 'add', '--exact', '--ignore-scripts', '--non-interactive',
      '--no-progress', '--registry', 'https://registry.npmjs.org', `${nativeName}@${version}`,
    ], { stdio: 'inherit', timeout: 120_000 });
    const source = path.join(temporary, 'node_modules', nativeName);
    readNativePackage(source);
    stage = fs.mkdtempSync(path.join(scope, '.canvas-linux-stage-'));
    fs.cpSync(source, stage, { recursive: true, errorOnExist: true, force: false });
    if (fs.existsSync(destination)) {
      throw new Error('Komponent został zmieniony w trakcie instalacji. Przerwano bez nadpisywania.');
    }
    // Publish the complete package atomically on the application filesystem.
    fs.renameSync(stage, destination);
    stage = undefined;
    loadRuntime();
    console.log(`Zainstalowano komponent obrazów: ${nativeName}@${version}`);
  } finally {
    // Only the exact temporary directories created by this invocation.
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  ensureCanvasRuntime();
} catch (error) {
  console.error('Nie można przygotować komponentu obrazów na serwerze:', error.message);
  process.exitCode = 1;
}
