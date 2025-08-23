module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
      },
    }],
  },
  moduleNameMapper: {
    '^monaco-editor/esm/vs/editor/editor.api$':
      '<rootDir>/tests/__mocks__/monaco-editor.js',
    '^electron$': '<rootDir>/tests/__mocks__/electron.js',
    '^sweetalert2$': '<rootDir>/tests/__mocks__/sweetalert2.js',
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
};
