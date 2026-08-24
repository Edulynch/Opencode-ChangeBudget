import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('T043: baseline implementation keeps the documented forbidden operations out of capture and comparison', async () => {
  const root = resolve(process.cwd());
  const capture = await readFile(resolve(root, 'src/core/baseline/capture.ts'), 'utf8');
  const compare = await readFile(resolve(root, 'src/core/baseline/compare.ts'), 'utf8');
  const check = await readFile(resolve(root, 'src/cli/commands/check.ts'), 'utf8');
  assert.equal(/git', \['(?:stash|commit|reset|restore|checkout)/.test(`${capture}\n${compare}\n${check}`), false);
  assert.equal(/mtime|birthtime|ctime/.test(`${capture}\n${compare}`), false);
  assert.equal(/legacy reconstruction/i.test(`${capture}\n${compare}\n${check}`), false);
});
