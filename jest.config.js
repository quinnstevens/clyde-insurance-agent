/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // Database tests need Docker; they run separately with `yarn test:db`.
  testPathIgnorePatterns: ['/node_modules/', '\\.db\\.test\\.ts$'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '^@clyde-api/knexfile$': '<rootDir>/knexfile.js',
    '^@clyde-api/(.*)$': '<rootDir>/src/$1',
  },
}
