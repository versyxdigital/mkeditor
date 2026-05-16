module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          jsx: 'react-jsx',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^monaco-editor/esm/vs/editor/editor.api$':
      '<rootDir>/tests/__mocks__/monaco-editor.js',
    '^electron$': '<rootDir>/tests/__mocks__/electron.js',
    '\\.(css|scss|sass)$': '<rootDir>/tests/__mocks__/style.js',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
};
