module.exports = {
    root: true,
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
            jsx: true
        }
    },
    ignorePatterns: [
        '**/cdk.out/**',
        '**/node_modules/**',
        '**/*.d.ts',
        '**/build/**',
        '**/dist/**',
        'chatbot-app/**'
    ],
    rules: {
        // Common spacing rules for all projects
        'no-trailing-spaces': 'error',
        'space-before-blocks': 'error',
        'space-before-function-paren': ['error', {
            'anonymous': 'always',
            'named': 'never',
            'asyncArrow': 'always'
        }],
        'space-in-parens': ['error', 'never'],
        'space-infix-ops': 'error',
        'object-curly-spacing': ['error', 'always'],
        'array-bracket-spacing': ['error', 'never'],
        'comma-spacing': ['error', { 'before': false, 'after': true }],
        'key-spacing': ['error', { 'beforeColon': false, 'afterColon': true }],
        'keyword-spacing': ['error', { 'before': true, 'after': true }]
    },
    overrides: [
        // Backend specific rules
        {
            files: ['backend/**/*.ts'],
            excludedFiles: ['backend/**/*.d.ts'],
            parser: '@typescript-eslint/parser',
            extends: [
                'plugin:@typescript-eslint/recommended'
            ],
            rules: {
                'indent': ['error', 4]
            }
        },
        // Frontend specific rules
        {
            files: ['chatbot-app/**/*.{ts,tsx,js,jsx}'],
            extends: [
                'react-app',
                'react-app/jest'
            ],
            rules: {
                'indent': ['error', 4]
            }
        }
    ]
};
