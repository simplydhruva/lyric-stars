// Builds native/bin/lyricstars-media.exe from native/media-helper.cs with the C#
// compiler that ships with Windows (.NET Framework 4.x), so no SDK is needed.
//   node tools/build-helper.mjs [--if-missing]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'native', 'media-helper.cs');
const OUT = path.join(ROOT, 'native', 'bin', 'lyricstars-media.exe');

if (process.platform !== 'win32') {
  console.log('Media helper: Windows only, skipped.');
  process.exit(0);
}
if (process.argv.includes('--if-missing') && fs.existsSync(OUT) && fs.statSync(OUT).mtimeMs >= fs.statSync(SRC).mtimeMs) process.exit(0);

const win = process.env.SystemRoot || 'C:\\Windows';
const framework = path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const csc = path.join(framework, 'csc.exe');
const winmd = path.join(win, 'System32', 'WinMetadata');
if (!fs.existsSync(csc)) {
  console.error(`Media helper: ${csc} not found (.NET Framework 4 is part of Windows 10 and 11).`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync(
  csc,
  [
    '-nologo',
    '-optimize+',
    '-platform:anycpu',
    `-out:${OUT}`,
    `-r:${path.join(framework, 'System.Runtime.dll')}`,
    `-r:${path.join(winmd, 'Windows.Foundation.winmd')}`,
    `-r:${path.join(winmd, 'Windows.Media.winmd')}`,
    SRC,
  ],
  { stdio: 'inherit' }
);
console.log(`Media helper: ${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} bytes)`);
