import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  rules: {
    'import/order': [
      'error',
      {
        'groups': [
          ['type'],
          ['builtin', 'external'],
          ['parent', 'sibling', 'index'],
        ],
        'newlines-between': 'always',
      },
    ],
  },
})
