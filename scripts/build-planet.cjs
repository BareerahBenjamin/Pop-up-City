const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const directory = resolve(__dirname, '../vendor/planet/frontend/ui-design');
for (const script of ['build-page.cjs', 'build-minimal-page.cjs']) execFileSync(process.execPath, [resolve(directory, script)], { stdio: 'inherit' });
