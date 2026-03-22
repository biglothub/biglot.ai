Code review for BigLot.ai. Scope: $ARGUMENTS (default: last 5 commits)

## Step 1: Gather Changes
- If argument is a task ID (e.g., T-1101): `git log --all --grep="T-1101" --oneline` then diff those commits
- If argument is a number N: `git diff HEAD~N`
- If no argument: `git diff HEAD~5`
- List all changed files

## Step 2: Automated Checks
- `cd frontend && npm run test` — all must pass
- `cd frontend && npm run check` — 0 type errors
- `cd frontend && npm run build` — build succeeds

## Step 3: Code Quality Review
For each changed file, check:

### TypeScript [CRITICAL if violated]
- [ ] No `any` type (use `unknown` + type guards)
- [ ] Proper error handling (ToolResult with success:false, never throw)
- [ ] No floating promises (all async calls awaited or void-returned)
- [ ] No unused imports or variables

### Trading-Specific [CRITICAL if violated]
- [ ] Prices are `number`, not strings
- [ ] NaN/undefined/null handled in all calculations
- [ ] Division by zero protected
- [ ] Timezone-aware for market hours
- [ ] Rate limiting for external APIs

### Architecture [WARNING if violated]
- [ ] Follows registerTool pattern from registry.ts
- [ ] Uses toolCache for API results
- [ ] Content blocks registered in ContentBlockRenderer.svelte
- [ ] Imports added to agentLoop.server.ts
- [ ] No circular dependencies

### Security [CRITICAL if violated]
- [ ] No exposed secrets/API keys in code
- [ ] Input validation on user-provided parameters
- [ ] Parameterized queries via Supabase client (no raw SQL)

## Step 4: Report
Output structured: CRITICAL/WARNING/INFO counts + file:line per issue

## Step 5: Fix
- Fix all CRITICAL issues immediately
- Fix WARNING issues if straightforward
- Commit fixes: `fix: <description>`
