import { spawnSync } from 'node:child_process';
import { cp, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, STANDALONE_BUILD: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// Building never migrates or seeds a database. Deployment runs migrations explicitly.
run('node_modules/prisma/build/index.js', ['generate']);
run('node_modules/next/dist/bin/next', ['build', '--webpack']);
const target = path.join(root, '.next/standalone');
await cp(path.join(root, 'public'), path.join(target, 'public'), { recursive: true });
await cp(path.join(root, '.next/static'), path.join(target, '.next/static'), { recursive: true });
// Next may copy local dotenv files; deployment must inject secrets at runtime.
for (const entry of await readdir(target, { withFileTypes: true })) {
  if (entry.isFile() && /^\.env(?:\.|$)/.test(entry.name)) {
    await unlink(path.join(target, entry.name));
  }
}
console.log('Standalone server ready. Set runtime environment and run npm run start:free.');
