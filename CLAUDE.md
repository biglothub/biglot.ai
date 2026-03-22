# CLAUDE.md - BigLot.ai

## Project Overview
BigLot.ai - AI-powered trading assistant
Tech Stack: SvelteKit 5, Svelte Runes, TailwindCSS 4, Supabase (PostgreSQL), Vercel
Multi-provider LLM: OpenAI, DeepSeek, Anthropic, Google, MiniMax

## Commands
- `cd frontend && npm run dev` — Start dev server
- `cd frontend && npm run build` — Production build
- `cd frontend && npm run check` — TypeScript + Svelte type-check
- `cd frontend && npm run test` — Run all Vitest tests
- `cd frontend && npx vitest run src/lib/server/tools/` — Run tool tests only
- `cd frontend && npx vitest run --reporter=verbose` — Verbose test output

## Architecture
```
frontend/src/
├── routes/                          # SvelteKit routes + API
│   ├── api/chat/+server.ts          # Main chat SSE endpoint
│   ├── api/chats/                   # Chat CRUD
│   ├── api/bots/                    # Custom bot CRUD
│   ├── api/dashboard/               # Dashboard data
│   ├── api/engine/                  # Agent/research webhook
│   ├── api/telegram/                # Telegram bot
│   ├── dashboard/                   # Dashboard page
│   ├── bots/                        # Bot builder page
│   ├── indicators/                  # PineScript builder page
│   └── analytics/                   # Analytics page
├── lib/
│   ├── agent/systemPrompts.ts       # 7 agent mode prompts
│   ├── server/
│   │   ├── agentLoop.server.ts      # Tool-calling agent loop
│   │   ├── aiProvider.server.ts     # Multi-provider LLM factory
│   │   ├── chatRouting.server.ts    # Intent classification
│   │   ├── chatPersistence.server.ts # Supabase chat CRUD
│   │   ├── chatModelRuntime.server.ts # Per-mode model selection
│   │   ├── discussionLoop.server.ts  # Multi-AI debate
│   │   ├── cache.server.ts          # In-memory TTL cache
│   │   ├── memory.server.ts         # User memory context
│   │   ├── telegram.server.ts       # Telegram integration
│   │   ├── tools/                   # Tool definitions
│   │   │   ├── registry.ts          # Tool registry + ToolResult type
│   │   │   ├── marketData.tool.ts   # CoinGecko + Yahoo prices
│   │   │   ├── charts.tool.ts       # OHLCV + indicators
│   │   │   ├── gold.tool.ts         # Gold specialist
│   │   │   ├── macro.tool.ts        # Macro indicators
│   │   │   ├── cot.tool.ts          # CFTC COT data
│   │   │   ├── crossAsset.tool.ts   # Correlation analysis
│   │   │   ├── webSearch.tool.ts    # Tavily search
│   │   │   ├── webExtract.tool.ts   # Web extraction
│   │   │   ├── webCrawl.tool.ts     # Web crawling
│   │   │   ├── memory.tool.ts       # User memory
│   │   │   ├── planning.tool.ts     # Plan creation
│   │   │   └── handoff.tool.ts      # Mode handoff
│   │   └── data/                    # Pre-computed data
│   ├── components/
│   │   ├── blocks/                  # 17 content block renderers
│   │   ├── dashboard/               # Dashboard widgets
│   │   ├── bots/                    # Bot builder components
│   │   ├── ChatArea.svelte
│   │   ├── InputArea.svelte
│   │   ├── Sidebar.svelte
│   │   └── AgentOrb.svelte
│   ├── state/                       # Svelte 5 runes state
│   ├── types/
│   │   ├── contentBlock.ts          # All block types + SSE events
│   │   ├── customBot.ts
│   │   └── indicator.ts
│   └── utils/
│       └── sseParser.ts
```

## Key Patterns

### Tool Creation
1. Create `frontend/src/lib/server/tools/myTool.tool.ts`
2. Import `registerTool`, `type ToolResult` from `./registry`
3. Import `toolCache` from `../cache.server` for API caching
4. Call `registerTool({ name, description, parameters, execute })`
5. `execute` returns `{ success, contentBlocks, textSummary, sources? }`
6. Import the tool file in `agentLoop.server.ts`

### Content Block Creation
1. Add type to `contentBlock.ts` union
2. Create renderer in `components/blocks/`
3. Add case in `ContentBlockRenderer.svelte`

### State Management
Svelte 5 runes only: `$state()`, `$derived()`, `$effect()`. No stores.

## Conventions
- TypeScript strict mode, no `any` (use `unknown` + type guards)
- Test files colocated: `foo.server.ts` -> `foo.server.test.ts`
- Error handling: return `ToolResult` with `success: false`, never throw
- SSE streaming for all chat responses
- Thai + English bilingual UI

## State Files for Automation
- Read TASKS.md before starting any work
- Update TASKS.md after completing each task
- Commit format: `feat(T-XXX): brief description`
