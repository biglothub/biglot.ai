Read TASKS.md and pick the next PENDING task (verify dependencies are DONE first).

## Phase 1: Understand (DO NOT SKIP)
1. Read CLAUDE.md for project conventions
2. Read TASKS.md, find next pending task with resolved dependencies
3. Read ALL files listed in the task spec (Create + Modify sections)

## Phase 2: Research (DO NOT SKIP)

### 2a. Codebase Research
4. Read 2-3 existing similar tools as reference patterns — study how they structure types, fetch data, handle errors, and return ToolResult
5. Identify reusable utilities: search for existing helpers in `data/`, `indicators/`, `risk/` that can be imported instead of rewritten
6. Check existing fetch patterns (Binance, Yahoo, CoinGecko) in `data/*.ts` — reuse the same fetcher + normalization
7. Check `contentBlock.ts` for existing block types that fit — avoid creating new types when existing ones work

### 2b. External Research (use WebSearch + WebFetch)
8. Search for the external API documentation needed (e.g., "Binance funding rate API endpoint", "Deribit options API")
9. Verify API endpoints are still live and free — check rate limits, auth requirements, response format
10. Search for best practices and edge cases (e.g., "funding rate calculation annualized", "basis trade risks")
11. Search for alternative data sources as fallback if primary API fails
12. If the task involves a financial concept (e.g., Kelly criterion, Black-Scholes, Wyckoff), search for the correct formula and validate against known references

### 2c. Feasibility Analysis
13. Based on research, assess: what can be built with available free APIs vs what needs paid data?
14. Identify potential issues: rate limits, missing data fields, timezone problems, weekend gaps
15. Decide on fallback strategy if primary API fails (return cached data? try alternative source? return partial result?)
16. Write a brief summary of findings before proceeding to Design

## Phase 3: Design (DO NOT SKIP)
17. List the types/interfaces you will create or modify
18. List the functions with their signatures (name, params, return type)
19. Identify which content blocks you need (existing types from contentBlock.ts or new ones)
20. Verify: does this follow the registerTool + ToolResult pattern from registry.ts?
21. Verify: does this use toolCache from cache.server.ts for external API calls?
22. Verify: what existing utilities from Phase 2 will you import?

## Phase 4: Implement
23. Create type definitions first (types/)
24. Create core logic with pure functions (server/, indicators/, risk/, data/)
25. Create tool definition (tools/*.tool.ts) using registerTool
26. Import tool in agentLoop.server.ts
27. Create UI components if needed (components/blocks/)

## Phase 5: Test & Verify
28. Write comprehensive tests (happy path, error cases, edge cases)
29. Run `cd frontend && npm run test` — fix until ALL pass (old + new)
30. Run `cd frontend && npm run check` — fix TypeScript errors
31. Run `cd frontend && npm run build` — fix build errors

## Phase 6: Commit & Update
32. `git add` specific files only (NEVER `git add .` or `git add -A`)
33. Commit: `feat(T-XXX): brief description`
34. Update TASKS.md: change `[ ]` to `[x]`, set Status: DONE
35. Append to CHANGELOG.md: `- **T-XXX**: one-line summary. N tests (M total)`
36. STOP. Do not continue to next task.

## Rules
- NEVER skip Phase 2 (Research) or Phase 3 (Design). Research and think before you code.
- NEVER delete existing tests or change test expectations.
- Fix implementation, not tests, when tests fail.
- Every tool returns ToolResult { success, contentBlocks, textSummary, sources? }.
- Cache all external API calls with toolCache.
- Reuse existing utilities — do NOT rewrite what already exists.
- Use `unknown` + type guards, never `any`.
- One task per invocation. STOP after commit.
