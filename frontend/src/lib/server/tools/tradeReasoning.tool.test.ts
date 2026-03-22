// Tests for tradeReasoning.tool.ts — T-1301
// Tests pure functions: buildReasoningBlock, parseReasoningResponse, buildEvidenceSummary

import { describe, it, expect } from 'vitest';
import {
	buildReasoningBlock,
	parseReasoningResponse,
	buildEvidenceSummary,
	type LLMReasoningOutput,
	type TradeEvidenceData,
} from '../data/tradeReasoning.data';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const baseOutput: LLMReasoningOutput = {
	evidenceFor: [
		{ category: 'Regime', tag: 'bullish', point: 'ADX=34 trending up', weight: 3 },
		{ category: 'Technicals', tag: 'bullish', point: 'MACD bullish crossover', weight: 2 },
	],
	evidenceAgainst: [
		{ category: 'Sentiment', tag: 'bearish', point: 'Negative news sentiment', weight: 2 },
	],
	keyUnknowns: ['FOMC upcoming', 'Low liquidity'],
	confidence: 7,
	verdict: 'Bullish setup with moderate conviction.',
	reasoning: '**Step 1:** Trend regime confirmed.',
};

const baseEvidenceData: TradeEvidenceData = {
	symbol: 'BTCUSDT',
	currentPrice: 85000,
	atrValue: 1200,
	regimeSummary: 'Regime: Trending Up (confidence 80%). ADX=34.',
	confluenceSummary: 'Confluence: bullish=6, bearish=2. Dominant: bullish.',
	divergenceSummary: 'No divergences detected.',
	sentimentSummary: 'News sentiment: Bullish (score 65/100).',
	macroSummary: 'Macro: DXY=104.5 (-0.2%), 10Y=4.2%, SPX=5100.',
	onChainSummary: 'On-chain (BTC): MVRV=1.85, NVT=62.1.',
};

// ─── buildReasoningBlock ────────────────────────────────────────────────────────

describe('buildReasoningBlock', () => {
	it('returns a block with type "reasoning"', () => {
		const block = buildReasoningBlock('BTCUSDT', 'long', baseOutput);
		expect(block.type).toBe('reasoning');
	});

	it('sets symbol and direction correctly', () => {
		const block = buildReasoningBlock('ETHUSDT', 'short', baseOutput);
		expect(block.symbol).toBe('ETHUSDT');
		expect(block.direction).toBe('short');
	});

	it('sets confidence from output', () => {
		const block = buildReasoningBlock('BTCUSDT', 'long', baseOutput);
		expect(block.confidence).toBe(7);
	});

	it('sets evidenceFor correctly', () => {
		const block = buildReasoningBlock('BTCUSDT', 'long', baseOutput);
		expect(block.evidenceFor).toHaveLength(2);
		expect(block.evidenceFor[0].category).toBe('Regime');
		expect(block.evidenceFor[0].tag).toBe('bullish');
		expect(block.evidenceFor[0].weight).toBe(3);
	});

	it('sets evidenceAgainst correctly', () => {
		const block = buildReasoningBlock('BTCUSDT', 'long', baseOutput);
		expect(block.evidenceAgainst).toHaveLength(1);
		expect(block.evidenceAgainst[0].tag).toBe('bearish');
	});

	it('sets keyUnknowns correctly', () => {
		const block = buildReasoningBlock('BTCUSDT', 'long', baseOutput);
		expect(block.keyUnknowns).toEqual(['FOMC upcoming', 'Low liquidity']);
	});

	it('sets verdict and reasoning', () => {
		const block = buildReasoningBlock('BTCUSDT', 'long', baseOutput);
		expect(block.verdict).toBe('Bullish setup with moderate conviction.');
		expect(block.reasoning).toContain('Step 1');
	});

	it('handles empty evidence arrays', () => {
		const emptyOutput: LLMReasoningOutput = {
			...baseOutput,
			evidenceFor: [],
			evidenceAgainst: [],
			keyUnknowns: [],
		};
		const block = buildReasoningBlock('BTCUSDT', 'neutral', emptyOutput);
		expect(block.evidenceFor).toHaveLength(0);
		expect(block.evidenceAgainst).toHaveLength(0);
		expect(block.direction).toBe('neutral');
	});
});

// ─── parseReasoningResponse ─────────────────────────────────────────────────────

describe('parseReasoningResponse', () => {
	it('parses valid JSON string', () => {
		const json = JSON.stringify({
			evidenceFor:     [{ category: 'Regime', tag: 'bullish', point: 'Trending up', weight: 3 }],
			evidenceAgainst: [{ category: 'Macro',  tag: 'bearish', point: 'DXY rising',  weight: 2 }],
			keyUnknowns:     ['FOMC risk'],
			confidence:      7,
			verdict:         'Bullish with caution.',
			reasoning:       'Analysis complete.',
		});
		const result = parseReasoningResponse(json);
		expect(result).not.toBeNull();
		expect(result!.confidence).toBe(7);
		expect(result!.evidenceFor).toHaveLength(1);
		expect(result!.evidenceAgainst).toHaveLength(1);
		expect(result!.keyUnknowns).toEqual(['FOMC risk']);
	});

	it('parses JSON wrapped in markdown code block', () => {
		const json = JSON.stringify({ evidenceFor: [], evidenceAgainst: [], keyUnknowns: [], confidence: 5, verdict: 'Test', reasoning: '' });
		const wrapped = `\`\`\`json\n${json}\n\`\`\``;
		const result = parseReasoningResponse(wrapped);
		expect(result).not.toBeNull();
		expect(result!.confidence).toBe(5);
	});

	it('returns null for invalid JSON', () => {
		const result = parseReasoningResponse('not valid json at all');
		expect(result).toBeNull();
	});

	it('clamps confidence to 1-10 range', () => {
		const json = JSON.stringify({ evidenceFor: [], evidenceAgainst: [], keyUnknowns: [], confidence: 15, verdict: 'x', reasoning: '' });
		const result = parseReasoningResponse(json);
		expect(result!.confidence).toBe(10);
	});

	it('clamps confidence minimum to 1', () => {
		const json = JSON.stringify({ evidenceFor: [], evidenceAgainst: [], keyUnknowns: [], confidence: -5, verdict: 'x', reasoning: '' });
		const result = parseReasoningResponse(json);
		expect(result!.confidence).toBe(1);
	});

	it('uses default confidence 5 when not a number', () => {
		const json = JSON.stringify({ evidenceFor: [], evidenceAgainst: [], keyUnknowns: [], confidence: 'high', verdict: 'x', reasoning: '' });
		const result = parseReasoningResponse(json);
		expect(result!.confidence).toBe(5);
	});

	it('filters out evidence items without a point', () => {
		const json = JSON.stringify({
			evidenceFor:     [{ category: 'Regime', tag: 'bullish', point: '', weight: 3 }],
			evidenceAgainst: [],
			keyUnknowns:     [],
			confidence:      5,
			verdict:         'x',
			reasoning:       '',
		});
		const result = parseReasoningResponse(json);
		expect(result!.evidenceFor).toHaveLength(0);
	});

	it('filters non-string keyUnknowns', () => {
		const json = JSON.stringify({ evidenceFor: [], evidenceAgainst: [], keyUnknowns: ['valid', 42, null], confidence: 5, verdict: 'x', reasoning: '' });
		const result = parseReasoningResponse(json);
		expect(result!.keyUnknowns).toEqual(['valid']);
	});

	it('clamps evidence weight to 1-3', () => {
		const json = JSON.stringify({
			evidenceFor:     [{ category: 'X', tag: 'bullish', point: 'Some point', weight: 99 }],
			evidenceAgainst: [],
			keyUnknowns:     [],
			confidence:      6,
			verdict:         'x',
			reasoning:       '',
		});
		const result = parseReasoningResponse(json);
		expect(result!.evidenceFor[0].weight).toBe(3);
	});

	it('defaults unknown tag to neutral', () => {
		const json = JSON.stringify({
			evidenceFor:     [{ category: 'X', tag: 'unknown_tag', point: 'Some point', weight: 2 }],
			evidenceAgainst: [],
			keyUnknowns:     [],
			confidence:      6,
			verdict:         'x',
			reasoning:       '',
		});
		const result = parseReasoningResponse(json);
		expect(result!.evidenceFor[0].tag).toBe('neutral');
	});
});

// ─── buildEvidenceSummary ───────────────────────────────────────────────────────

describe('buildEvidenceSummary', () => {
	it('includes symbol and direction', () => {
		const summary = buildEvidenceSummary(baseEvidenceData, 'long');
		expect(summary).toContain('BTCUSDT');
		expect(summary).toContain('LONG');
	});

	it('includes all evidence categories', () => {
		const summary = buildEvidenceSummary(baseEvidenceData, 'long');
		expect(summary).toContain('Market Regime');
		expect(summary).toContain('Technical Confluence');
		expect(summary).toContain('Divergence Signals');
		expect(summary).toContain('News Sentiment');
		expect(summary).toContain('Macro Environment');
		expect(summary).toContain('On-Chain Data');
	});

	it('includes current price and ATR', () => {
		const summary = buildEvidenceSummary(baseEvidenceData, 'short');
		expect(summary).toContain('85000');
		expect(summary).toContain('1200');
		expect(summary).toContain('SHORT');
	});

	it('shows unknown for zero price', () => {
		const dataNoPrice = { ...baseEvidenceData, currentPrice: 0, atrValue: 0 };
		const summary = buildEvidenceSummary(dataNoPrice, 'long');
		expect(summary).toContain('unknown');
	});

	it('includes regime summary text', () => {
		const summary = buildEvidenceSummary(baseEvidenceData, 'long');
		expect(summary).toContain('Trending Up');
	});

	it('includes macro summary text', () => {
		const summary = buildEvidenceSummary(baseEvidenceData, 'long');
		expect(summary).toContain('DXY');
	});
});
