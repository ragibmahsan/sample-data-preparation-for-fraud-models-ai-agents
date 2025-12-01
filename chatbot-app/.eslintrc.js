module.exports = {
    extends: [
        'react-app',
        'react-app/jest'
    ],
    rules: {
        'indent': ['error', 4],
        'no-trailing-spaces': 'off',
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
    }
};
