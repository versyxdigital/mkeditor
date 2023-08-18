module.exports = {
    env: {
        browser: true,
        es2021: true,
        node: true
    },
    extends: 'standard',
    overrides: [
    ],
    parserOptions: {
        ecmaVersion: 'latest'
    },
    rules: {
        indent: ['error', 4],
        semi: [2, 'always']
    }
};
