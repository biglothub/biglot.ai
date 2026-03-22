QA loop for BigLot.ai. Run systematically:

## Step 1: Run Full Test Suite
- `cd frontend && npm run test` — analyze output
- If failures exist: fix implementation (NOT tests), re-run
- Record: total tests passing, total failing

## Step 2: Type Check
- `cd frontend && npm run check`
- If errors: fix TypeScript issues, re-run

## Step 3: Build Verification
- `cd frontend && npm run build`
- If errors: fix build issues (usually missing imports or SSR issues)

## Step 4: Coverage Audit
For each directory, check that every source file has a corresponding test:
- `frontend/src/lib/server/tools/*.tool.ts` — each needs tests
- `frontend/src/lib/server/indicators/*.ts` — each non-index needs tests
- `frontend/src/lib/server/data/*.ts` — each needs tests
- `frontend/src/lib/server/risk/*.ts` — each needs tests
- `frontend/src/lib/server/portfolio/*.ts` — each needs tests
List any files WITHOUT corresponding tests.

## Step 5: Edge Case Audit
For each test file, verify these scenarios are covered:
- Empty input (empty array, empty string, null-ish)
- NaN / Infinity in numeric calculations
- API failure (fetch throws or returns non-200)
- Insufficient data (e.g., RSI needs 14+ candles)
- Zero prices, negative volume, weekend gaps
Write missing edge case tests.

## Step 6: Commit
- Run tests one final time to confirm all pass
- `git add` specific test files only
- Commit: `test: improve coverage for <area>`
- Update CHANGELOG.md

## Rules
- NEVER modify existing test expectations
- NEVER delete tests
- NEVER skip failing tests
- Fix implementation bugs, not test assertions
