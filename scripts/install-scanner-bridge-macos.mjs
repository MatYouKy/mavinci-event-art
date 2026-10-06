import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

if (process.platform !== 'darwin') {
  console.error('Automatyczna instalacja modułu jest obecnie dostępna tylko dla macOS.');
  process.exit(1);
}

const label = 'pl.mavinci.scanner-bridge';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgePath = path.join(projectRoot, 'scripts/scanner-bridge.mjs');
const launchAgentsDirectory = path.join(homedir(), 'Library/LaunchAgents');
const logsDirectory = path.join(homedir(), 'Library/Logs/MavinciCRM');
const plistPath = path.join(launchAgentsDirectory, `${label}.plist`);
const domain = `gui/${process.getuid()}`;

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(bridgePath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(projectRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logsDirectory, 'scanner-bridge.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logsDirectory, 'scanner-bridge-error.log'))}</string>
</dict>
</plist>
`;

await mkdir(launchAgentsDirectory, { recursive: true });
await mkdir(logsDirectory, { recursive: true });
await writeFile(plistPath, plist, 'utf8');

await execFileAsync('/bin/launchctl', ['bootout', domain, plistPath]).catch(() => undefined);
await execFileAsync('/bin/launchctl', ['bootstrap', domain, plistPath]);

console.log('Moduł skanowania został uruchomiony i będzie startował automatycznie z macOS.');
console.log(`Konfiguracja: ${plistPath}`);
