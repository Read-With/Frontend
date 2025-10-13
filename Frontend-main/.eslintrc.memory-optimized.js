import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import process from 'process'

export default [
  { ignores: ['dist', 'node_modules', 'src/data/**'] }, // 대용량 데이터 파일 제외
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      
      // 메모리 사용량 최적화를 위한 규칙
      'no-unused-vars': ['error', { 
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        ignoreRestSiblings: true 
      }],
      
      // 불필요한 재렌더링 방지
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      
      // 메모리 누수 방지
      'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
      
      // 성능 최적화 관련 규칙
      'prefer-const': 'error',
      'no-var': 'error',
      'no-duplicate-imports': 'error',
      
      // React 성능 최적화
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // 대용량 데이터 파일에 대한 별도 설정
  {
    files: ['src/data/**/*.js', 'src/data/**/*.jsx'],
    rules: {
      // 데이터 파일에서는 린팅 규칙 완화
      'no-unused-vars': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
]
