/** @jest-environment node */

import { Linter, type Rule } from 'eslint';

const parser = require('@typescript-eslint/parser') as Linter.Parser;
const functionSpacing =
  require('../scripts/eslint-function-spacing.cjs') as Rule.RuleModule;
const linter = new Linter();
const config: Linter.Config = {
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: { parser },
  plugins: { mkeditor: { rules: { 'function-spacing': functionSpacing } } },
  rules: { 'mkeditor/function-spacing': 'error' },
};

function fix(source: string) {
  const result = linter.verifyAndFix(source, config, {
    filename: 'fixture.tsx',
  });
  expect(result.messages).toEqual([]);
  expect(
    linter.verify(result.output, config, { filename: 'fixture.tsx' }),
  ).toEqual([]);
  return result.output;
}

describe('function spacing', () => {
  it.each([
    ['function first() {}', 'export async function second() {}'],
    ['const first = () => 1;', 'const second = function () { return 2; };'],
    ['export const first = () => 1;', 'export default function second() {}'],
    [
      'const first = React.memo(() => <div />);',
      'const second = React.forwardRef(() => <div />);',
    ],
  ])('separates adjacent definitions: %s', (first, second) => {
    expect(fix(`${first}\n${second}`)).toBe(`${first}\n\n${second}`);
  });

  it.each(['\n', '\r\n'])(
    'preserves the existing newline convention: %j',
    (newline) => {
      expect(fix(`function first() {}${newline}function second() {}`)).toBe(
        `function first() {}${newline}${newline}function second() {}`,
      );
    },
  );

  it('preserves object commas, trailing comments and documentation ownership', () => {
    const source = [
      'const handlers = {',
      '  first() {}, // belongs to first',
      '  /** Documents second. */',
      '  second: () => 2,',
      '  third: function () { return 3; },',
      '};',
    ].join('\n');
    expect(fix(source)).toBe(
      source
        .replace(
          'first() {}, // belongs to first\n',
          'first() {}, // belongs to first\n\n',
        )
        .replace('second: () => 2,\n', 'second: () => 2,\n\n'),
    );
  });

  it('separates class methods and arrow fields without changing their bodies', () => {
    const source =
      'class Example {\nfirst() { return `a\n\nb`; }\nsecond = () => 2;\nthird() {}\n}';
    expect(fix(source)).toBe(
      source
        .replace('; }\nsecond', '; }\n\nsecond')
        .replace('() => 2;\nthird', '() => 2;\n\nthird'),
    );
  });

  it('handles same-line definitions and reaches a stable fix', () => {
    const result = fix('const handlers = { first() {}, second() {} };');
    expect(result).toBe('const handlers = { first() {},\n\n second() {} };');
    expect(
      linter.verifyAndFix(result, config, { filename: 'fixture.tsx' }).fixed,
    ).toBe(false);
  });

  it('keeps TypeScript overload signatures with their implementation', () => {
    const source = [
      'function parse(value: string): string;',
      'function parse(value: number): number;',
      'function parse(value: string | number) { return value; }',
      'function next() {}',
    ].join('\n');
    expect(fix(source)).toBe(
      source.replace('\nfunction next', '\n\nfunction next'),
    );
  });

  it('leaves ordinary values, callback arguments and existing padding alone', () => {
    const source = [
      'const first = () => 1;',
      '',
      'const second = () => 2;',
      'const value = 3;',
      'const last = () => 4;',
      'subscribe(() => 1, () => 2);',
    ].join('\n');
    expect(fix(source)).toBe(source);
  });
});
