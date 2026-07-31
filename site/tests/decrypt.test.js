import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptData } from '../decrypt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'sample.enc.json'), 'utf-8')
);

test('用正確密碼解密 Python 產生的密文，結果要跟 Python 端一致', async () => {
  const result = await decryptData(fixture, 'test-password-123');
  assert.deepEqual(result, {
    hello: 'world',
    days: [{ date: '2026-07-01', sessions: 5 }],
  });
});

test('密碼錯誤時要 reject，不能回傳亂碼或部分結果', async () => {
  await assert.rejects(() => decryptData(fixture, 'wrong-password'));
});

test('迭代次數沿用密文裡記錄的值，不寫死', async () => {
  assert.equal(fixture.iterations, 600000);
});
