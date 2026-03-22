import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockClient, textChunks, toolCallChunks } from '$lib/__test__/helpers/mockOpenAI';
import { createAgentCallbacks } from '$lib/__test__/helpers/mockCallbacks';

// Mock tool registration side-effects (these import tools and register them)
vi.mock('./tools/marketData.tool', () => ({}));
vi.mock('./tools/charts.tool', () => ({}));
vi.mock('./tools/planning.tool', () => ({}));
vi.mock('./tools/gold.tool', () => ({}));
vi.mock('./tools/macro.tool', () => ({}));
vi.mock('./tools/cot.tool', () => ({}));
vi.mock('./tools/crossAsset.tool', () => ({}));
vi.mock('./tools/webSearch.tool', () => ({}));
vi.mock('./tools/webExtract.tool', () => ({}));
vi.mock('./tools/webCrawl.tool', () => ({}));
vi.mock('./tools/memory.tool', () => ({}));
vi.mock('./tools/handoff.tool', () => ({}));
vi.mock('./tools/signals.tool', () => ({}));
vi.mock('./tools/backtest.tool', () => ({}));
vi.mock('./tools/economicCalendar.tool', () => ({}));
vi.mock('./tools/sentiment.tool', () => ({}));
vi.mock('./tools/onchain.tool', () => ({}));
vi.mock('./tools/derivatives.tool', () => ({}));
vi.mock('./tools/positionSize.tool', () => ({}));
vi.mock('./tools/portfolio.tool', () => ({}));
vi.mock('./tools/riskMonitor.tool', () => ({}));
vi.mock('./tools/tradeJournal.tool', () => ({}));
vi.mock('./tools/alerts.tool', () => ({}));
vi.mock('./tools/patternScan.tool', () => ({}));
vi.mock('./tools/multiTimeframe.tool', () => ({}));
vi.mock('./tools/orderFlow.tool', () => ({}));
vi.mock('./tools/strategyOptimizer.tool', () => ({}));
vi.mock('./tools/smc.tool', () => ({}));
vi.mock('./tools/newsSentiment.tool', () => ({}));
vi.mock('./tools/paperTrading.tool', () => ({}));

// Mock the tool registry functions
vi.mock('./tools/registry', () => ({
	getOpenAIToolSchemas: vi.fn(() => [
		{
			type: 'function',
			function: {
				name: 'get_market_data',
				description: 'Get market data',
				parameters: { type: 'object', properties: { symbol: { type: 'string' } } }
			}
		},
		{
			type: 'function',
			function: {
				name: 'create_plan',
				description: 'Create an execution plan',
				parameters: { type: 'object', properties: { title: { type: 'string' }, steps: { type: 'array' } } }
			}
		},
		{
			type: 'function',
			function: {
				name: 'handoff_to_agent',
				description: 'Handoff to another mode',
				parameters: { type: 'object', properties: { target_mode: { type: 'string' } } }
			}
		}
	]),
	executeTool: vi.fn(async (name: string) => ({
		success: true,
		contentBlocks: [{ type: 'metric_card', title: name, value: '100' }],
		textSummary: `${name} result: OK`,
		sources: [{ name: 'TestSource', url: 'https://test.com', accessedAt: Date.now() }]
	})),
	getTool: vi.fn((name: string) => {
		if (name === 'get_market_data' || name === 'reasoning') return { name };
		return undefined;
	})
}));

import { runAgentLoop, type AgentLoopConfig } from './agentLoop.server';

function createConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
	return {
		client: createMockClient([textChunks('Hello')]) as any,
		apiModel: 'gpt-4o',
		messages: [
			{ role: 'system', content: 'You are a helpful assistant' },
			{ role: 'user', content: 'hello' }
		],
		callbacks: createAgentCallbacks(),
		...overrides
	};
}

describe('runAgentLoop', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// --- Direct text response (no tool calls) ---

	it('returns empty content blocks for direct text response', async () => {
		const config = createConfig();
		const result = await runAgentLoop(config);

		expect(result).toEqual([]);
		expect(config.callbacks.onTextDelta).toHaveBeenCalled();
	});

	it('streams text deltas to callback', async () => {
		const callbacks = createAgentCallbacks();
		const config = createConfig({
			client: createMockClient([textChunks('Hello world')]) as any,
			callbacks
		});

		await runAgentLoop(config);

		// onTextDelta should have been called with parts of "Hello world"
		const allText = (callbacks.onTextDelta as any).mock.calls.map((c: any) => c[0]).join('');
		expect(allText).toBe('Hello world');
	});

	// --- Single tool call (standard mode) ---

	it('handles single tool call flow', async () => {
		const callbacks = createAgentCallbacks();
		const client = createMockClient([
			// First call: model wants to call get_market_data
			toolCallChunks([{ id: 'tc_1', name: 'get_market_data', arguments: '{"symbol":"BTC"}' }]),
			// Second call: model responds with text after receiving tool result
			textChunks('BTC is at $100')
		]);

		const config = createConfig({ client: client as any, callbacks });
		const result = await runAgentLoop(config);

		expect(callbacks.onToolStart).toHaveBeenCalledWith('tc_1', 'get_market_data', { symbol: 'BTC' });
		expect(callbacks.onToolResult).toHaveBeenCalled();
		// Should have content blocks from tool result
		expect(result.length).toBeGreaterThan(0);
	});

	// --- Plan mode ---

	it('executes plan mode when planning is enabled and model creates a plan', async () => {
		const callbacks = createAgentCallbacks();

		const planArgs = JSON.stringify({
			title: 'Gold Analysis',
			steps: [
				{ id: 'step_1', title: 'Get gold price', toolName: 'get_market_data' },
				{ id: 'step_2', title: 'Synthesize', toolName: 'reasoning' }
			]
		});

		const client = createMockClient([
			// First call: model creates a plan
			toolCallChunks([{ id: 'plan_1', name: 'create_plan', arguments: planArgs }]),
			// Step 1 execution: model calls get_market_data
			toolCallChunks([{ id: 'tc_gold', name: 'get_market_data', arguments: '{"symbol":"GOLD"}' }]),
			// Step 2 execution: reasoning (text response)
			textChunks('Gold analysis: bullish outlook based on data.')
		]);

		const config = createConfig({
			client: client as any,
			callbacks,
			planningEnabled: true
		});

		const result = await runAgentLoop(config);

		// Plan should be created
		expect(callbacks.onPlanCreate).toHaveBeenCalled();
		// Steps should be updated
		expect(callbacks.onPlanStepUpdate).toHaveBeenCalled();
		// Plan should complete
		expect(callbacks.onPlanComplete).toHaveBeenCalledWith(expect.any(String), 'complete');
		// Result should include plan block + tool content blocks
		expect(result.some(b => b.type === 'plan')).toBe(true);
	});

	// --- Plan validation failure ---

	it('falls back to standard mode when plan has unknown tool', async () => {
		const callbacks = createAgentCallbacks();

		const planArgs = JSON.stringify({
			title: 'Bad Plan',
			steps: [
				{ id: 'step_1', title: 'Unknown step', toolName: 'nonexistent_tool' }
			]
		});

		const client = createMockClient([
			// Model creates an invalid plan
			toolCallChunks([{ id: 'plan_1', name: 'create_plan', arguments: planArgs }])
		]);

		const config = createConfig({
			client: client as any,
			callbacks,
			planningEnabled: true
		});

		await runAgentLoop(config);

		// Should report error about unknown tool
		expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('unknown tool'));
	});

	// --- Handoff detection ---

	it('detects handoff and recurses with new mode', async () => {
		const callbacks = createAgentCallbacks();

		const handoffArgs = JSON.stringify({
			target_mode: 'gold',
			reason: 'User asking about gold',
			context_summary: 'User wants gold price'
		});

		const client = createMockClient([
			// First call: model requests handoff
			toolCallChunks([{ id: 'hoff_1', name: 'handoff_to_agent', arguments: handoffArgs }]),
			// After handoff, model responds in new mode
			textChunks('Gold is trading at $2350 today.')
		]);

		const config = createConfig({ client: client as any, callbacks });
		await runAgentLoop(config);

		expect(callbacks.onHandoff).toHaveBeenCalledWith('gold', 'User asking about gold');
	});

	// --- Max iterations ---

	it('respects maxIterations limit', async () => {
		const callbacks = createAgentCallbacks();

		// Model keeps calling tools every iteration
		const client = createMockClient([
			toolCallChunks([{ id: 'tc_1', name: 'get_market_data', arguments: '{}' }]),
			toolCallChunks([{ id: 'tc_2', name: 'get_market_data', arguments: '{}' }]),
			toolCallChunks([{ id: 'tc_3', name: 'get_market_data', arguments: '{}' }]),
			toolCallChunks([{ id: 'tc_4', name: 'get_market_data', arguments: '{}' }]),
			textChunks('done')
		]);

		const config = createConfig({
			client: client as any,
			callbacks,
			maxIterations: 3
		});

		await runAgentLoop(config);

		// Should stop after 3 iterations (1 initial + 2 more)
		// The client.create should have been called at most 3 times
		expect(client.chat.completions.create).toHaveBeenCalledTimes(3);
	});

	// --- Sources deduplication ---

	it('appends deduplicated sources block', async () => {
		const callbacks = createAgentCallbacks();

		const { executeTool } = await import('./tools/registry');
		(executeTool as any).mockResolvedValueOnce({
			success: true,
			contentBlocks: [],
			textSummary: 'ok',
			sources: [
				{ name: 'Yahoo Finance', url: 'https://yahoo.com', accessedAt: 1000 },
				{ name: 'Yahoo Finance', url: 'https://yahoo.com', accessedAt: 2000 }
			]
		});

		const client = createMockClient([
			toolCallChunks([{ id: 'tc_1', name: 'get_market_data', arguments: '{}' }]),
			textChunks('done')
		]);

		const config = createConfig({ client: client as any, callbacks });
		const result = await runAgentLoop(config);

		const sourcesBlock = result.find(b => b.type === 'sources');
		expect(sourcesBlock).toBeDefined();
		// Should deduplicate — only one "Yahoo Finance" entry
		expect((sourcesBlock as any).sources).toHaveLength(1);
	});

	// --- Empty tool calls ---

	it('returns empty blocks when no tool calls and finish_reason is stop', async () => {
		const config = createConfig({
			client: createMockClient([textChunks('Simple answer')]) as any
		});
		const result = await runAgentLoop(config);
		expect(result).toEqual([]);
	});
});
