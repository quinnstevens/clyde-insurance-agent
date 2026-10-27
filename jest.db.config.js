/**
 * Tests that run against the real Postgres from `yarn db:up` (the throwaway test database on 5433),
 * for SQL that mocks can't check, like pgvector search. Run with `yarn test:db`.
 */
const base = require('./jest.config')

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = { ...base, testMatch: ['**/*.db.test.ts'], testPathIgnorePatterns: [] }
