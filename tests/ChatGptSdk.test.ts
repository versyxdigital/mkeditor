/** @jest-environment node */
import { execFileSync } from 'child_process';
import { join } from 'path';

test('the installed SDK serializes subscription requests and replays namespaced tool results', () => {
  expect(() =>
    execFileSync(
      process.execPath,
      [join(__dirname, 'fixtures/chatgpt-sdk-contract.cjs')],
      { timeout: 15000, stdio: 'pipe' },
    ),
  ).not.toThrow();
});
