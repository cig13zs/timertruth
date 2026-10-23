// Node 22+ reads `node --test tests/` as a file path, not a directory; this makes that command run every test file.
for (const f of require('node:fs').readdirSync(__dirname)) if (f.endsWith('.test.js')) require('./' + f);
