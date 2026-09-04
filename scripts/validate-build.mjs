import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const expected = ['dist/index.html','dist/assets','netlify/functions/api.mjs','netlify/functions/weekly-radar.mjs','netlify/database/migrations/0001_funding_desk.sql','netlify.toml','.env.example','README.md'];
for (const path of expected) await access(new URL(`../${path}`, import.meta.url));
for (const path of ['netlify/functions/api.mjs','netlify/functions/weekly-radar.mjs','src/main.js']) {
  const check = spawnSync(process.execPath, ['--check', new URL(`../${path}`, import.meta.url).pathname], { encoding: 'utf8' });
  if (check.status) throw new Error(`${path} has invalid JavaScript:\n${check.stderr}`);
}
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
if (!html.includes('Funding Desk V6') || !html.includes('/assets/')) throw new Error('Production entry point is incomplete.');
const migration = await readFile(new URL('../netlify/database/migrations/0001_funding_desk.sql', import.meta.url), 'utf8');
for (const table of ['members','opportunities','projects','evidence','files','assignments','audit_log']) if (!migration.includes(`CREATE TABLE ${table}`)) throw new Error(`Migration is missing ${table}.`);
console.log('V6 production bundle, functions and database migration validated.');
