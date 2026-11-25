/** @jest-environment node */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { auditTestSource } = require('../scripts/audit-tests.cjs') as {
  auditTestSource: (
    file: string,
    source: string,
  ) => { line: number; column: number; message: string }[];
};

describe('test policy', () => {
  it.each([
    'test.skip("hidden", () => expect(true).toBe(false));',
    'it.only("focused", () => expect(true).toBe(true));',
    'describe.skip("suite", () => {});',
    'test.todo("unfinished");',
    'test.failing("known failure", () => expect(true).toBe(false));',
    'test["skip"]("hidden", () => {});',
    'test.skip.each([1, 2])("hidden %s", () => {});',
    'test.each([1, 2]).only("focused %s", () => {});',
    'test.only.each`value\n${1}`("focused", () => {});',
    'const conditional = test.skip; conditional("hidden", () => {});',
    'xit("hidden", () => {});',
    'xtest("hidden", () => {});',
    'xdescribe("hidden", () => {});',
    'fit("focused", () => {});',
    'fdescribe("focused", () => {});',
    'import { test as check } from "@jest/globals"; check.skip("hidden", () => {});',
    'import { xit as check } from "@jest/globals"; check("hidden", () => {});',
  ])('rejects declarations that hide tests: %s', (source) => {
    expect(auditTestSource('fixture.test.ts', source)).not.toEqual([]);
  });

  it.each([
    'test("ordinary", () => expect(true).toBe(true));',
    'it.each([1, 2])("parameter %s", value => expect(value).toBeGreaterThan(0));',
    'test.each`value\n${1}`("parameter", () => expect(true).toBe(true));',
    '// test.skip("comment", () => {});\nconst example = "it.only";',
    'const ordinaryObject = { skip: () => {} }; ordinaryObject.skip();',
    'test("async", async () => { await expect(Promise.resolve(1)).resolves.toBe(1); });',
    'test("async", () => { return expect(Promise.reject("x")).rejects.toBe("x"); });',
  ])('accepts ordinary tests and literal examples: %s', (source) => {
    expect(auditTestSource('fixture.test.ts', source)).toEqual([]);
  });

  it.each([
    'test("unawaited", () => { expect(Promise.resolve(1)).resolves.toBe(1); });',
    'it("unawaited", async () => { expect(Promise.reject("x")).rejects.toBe("x"); });',
  ])(
    'rejects asynchronous assertions that are not awaited or returned: %s',
    (source) => {
      expect(auditTestSource('fixture.test.ts', source)).toEqual([
        expect.objectContaining({
          line: 1,
          message: 'Await or return asynchronous resolves/rejects assertions.',
        }),
      ]);
    },
  );

  it('reports the source location of a forbidden modifier', () => {
    expect(
      auditTestSource('fixture.test.ts', '\n\ntest.only("example", () => {});'),
    ).toEqual([
      expect.objectContaining({
        line: 3,
        column: 1,
      }),
    ]);
  });

  it.each([false, true])(
    'makes Jest fail empty and early-return tests while an asserted test passes (colors=%s)',
    (colors) => {
      const root = resolve(__dirname, '..');
      const config = require('../jest.config.js') as {
        setupFilesAfterEnv: string[];
      };
      const assertionGuard = config.setupFilesAfterEnv.find((file) =>
        file.endsWith('/requireAssertions.cjs'),
      );
      expect(assertionGuard).toBeDefined();
      // Jest resolves roots to native paths; Windows TEMP may contain an 8.3 alias.
      const directory = realpathSync.native(
        mkdtempSync(join(tmpdir(), 'mkeditor-test-policy-')),
      );
      try {
        writeFileSync(
          join(directory, 'assertions.test.cjs'),
          [
            'test("empty", () => {});',
            'test("early return", () => { if (true) return; expect(false).toBe(true); });',
            'test("asserted", () => { expect(2 + 2).toBe(4); });',
          ].join('\n'),
        );
        const reportFile = join(directory, 'report.json');
        const result = spawnSync(
          process.execPath,
          [
            require.resolve('jest/bin/jest'),
            '--runInBand',
            `--colors=${colors}`,
            '--config',
            JSON.stringify({
              rootDir: root,
              roots: [directory],
              testMatch: ['**/assertions.test.cjs'],
              testEnvironment: 'node',
              transform: {},
              setupFilesAfterEnv: [assertionGuard],
              cache: false,
            }),
            '--json',
            '--outputFile',
            reportFile,
          ],
          {
            cwd: root,
            encoding: 'utf8',
            windowsHide: true,
            timeout: 30_000,
            env: {
              ...process.env,
              FORCE_COLOR: colors ? '1' : '0',
              NO_COLOR: undefined,
            },
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(1);
        if (!existsSync(reportFile)) {
          throw new Error(
            `Child Jest did not produce a report:\n${result.stderr}`,
          );
        }
        const report = JSON.parse(readFileSync(reportFile, 'utf8'));
        expect(report.numFailedTests).toBe(2);
        expect(report.numPassedTests).toBe(1);
        expect(report.numPendingTests).toBe(0);
        expect(report.numRuntimeErrorTestSuites).toBe(0);
        expect(report.testResults[0].assertionResults).toEqual([
          expect.objectContaining({
            title: 'empty',
            status: 'failed',
            numPassingAsserts: 0,
          }),
          expect.objectContaining({
            title: 'early return',
            status: 'failed',
            numPassingAsserts: 0,
          }),
          expect.objectContaining({
            title: 'asserted',
            status: 'passed',
            numPassingAsserts: 1,
          }),
        ]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    40_000,
  );
});
