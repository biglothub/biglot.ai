// Tests for War Room Data — T-1308

import { describe, it, expect } from 'vitest';
import {
	buildPanelistPrompt,
	parsePanelistOutput,
	buildConsensus,
	buildWarRoomBlock,
	WAR_ROOM_PANELIST_ORDER,
	type WarRoomPanelistOutput,
} from './warRoom.data';
import type { TradeEvidenceData } from './tradeReasoning.data';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const baseEvidence: TradeEvidenceData = {
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

function makePanelistOutput(
	overrides: Partial<WarRoomPanelistOutput> = {},
): WarRoomPanelistOutput {
	return {
		panelistId: 'technical',
		stance: 'bullish',
		confidence: 7,
		dataCitations: ['ADX=34', 'MACD bullish crossover'],
		keyPoints: ['Uptrend confirmed', 'Confluence strong'],
		fullAnalysis: 'Technical analysis shows strong bullish trend.',
		...overrides,
	};
}

// ─── WAR_ROOM_PANELIST_ORDER ───────────────────────────────────────────────────

describe('WAR_ROOM_PANELIST_ORDER', () => {
	it('has exactly 4 panelists', () => {
		expect(WAR_ROOM_PANELIST_ORDER).toHaveLength(4);
	});

	it('ends with risk manager', () => {
		expect(WAR_ROOM_PANELIST_ORDER[WAR_ROOM_PANELIST_ORDER.length - 1]).toBe('risk');
	});

	it('contains all required specialists', () => {
		expect(WAR_ROOM_PANELIST_ORDER).toContain('technical');
		expect(WAR_ROOM_PANELIST_ORDER).toContain('macro');
		expect(WAR_ROOM_PANELIST_ORDER).toContain('quant');
		expect(WAR_ROOM_PANELIST_ORDER).toContain('risk');
	});
});

// ─── buildPanelistPrompt ───────────────────────────────────────────────────────

describe('buildPanelistPrompt', () => {
	it('includes the symbol in the prompt', () => {
		const prompt = buildPanelistPrompt('technical', 'BTCUSDT', baseEvidence, [], 'english');
		expect(prompt).toContain('BTCUSDT');
	});

	it('includes panelist role name in prompt', () => {
		const prompt = buildPanelistPrompt('technical', 'BTCUSDT', baseEvidence, [], 'english');
		expect(prompt).toContain('Technical Analyst');
	});

	it('includes macro data for macro panelist', () => {
		const prompt = buildPanelistPrompt('macro', 'BTCUSDT', baseEvidence, [], 'english');
		expect(prompt).toContain('DXY=104.5');
	});

	it('includes regime data for technical panelist', () => {
		const prompt = buildPanelistPrompt('technical', 'BTCUSDT', baseEvidence, [], 'english');
		expect(prompt).toContain('ADX=34');
	});

	it('includes on-chain data for quant panelist', () => {
		const prompt = buildPanelistPrompt('quant', 'BTCUSDT', baseEvidence, [], 'english');
		expect(prompt).toContain('MVRV=1.85');
	});

	it('includes prior panelist context when provided', () => {
		const prior = [makePanelistOutput({ fullAnalysis: 'Technical: strong bullish setup.' })];
		const prompt = buildPanelistPrompt('macro', 'BTCUSDT', baseEvidence, prior, 'english');
		expect(prompt).toContain('Technical Analyst');
		expect(prompt).toContain('strong bullish setup');
	});

	it('notes risk manager speaks last', () => {
		const prompt = buildPanelistPrompt('risk', 'BTCUSDT', baseEvidence, [], 'english');
		expect(prompt.toLowerCase()).toContain('last');
	});

	it('includes Thai language instruction for thai language', () => {
		const prompt = buildPanelistPrompt('technical', 'BTCUSDT', baseEvidence, [], 'thai');
		expect(prompt).toContain('ภาษาไทย');
	});

	it('includes JSON schema in prompt', () => {
		const prompt = buildPanelistPrompt('technical', 'BTCUSDT', baseEvidence, [], 'english');
		expect(prompt).toContain('"stance"');
		expect(prompt).toContain('"confidence"');
		expect(prompt).toContain('"dataCitations"');
	});
});

// ─── parsePanelistOutput ───────────────────────────────────────────────────────

describe('parsePanelistOutput', () => {
	it('parses valid JSON correctly', () => {
		const raw = JSON.stringify({
			stance: 'bullish',
			confidence: 8,
			dataCitations: ['ADX=34', 'MACD crossover'],
			keyPoints: ['Uptrend strong', 'Volume increasing'],
			fullAnalysis: '## Technical Analysis\nBullish setup confirmed.',
		});
		const result = parsePanelistOutput('technical', raw);
		expect(result.panelistId).toBe('technical');
		expect(result.stance).toBe('bullish');
		expect(result.confidence).toBe(8);
		expect(result.dataCitations).toHaveLength(2);
		expect(result.keyPoints).toHaveLength(2);
		expect(result.fullAnalysis).toContain('Bullish setup');
	});

	it('handles JSON embedded in other text', () => {
		const raw = `Here is my analysis:\n${JSON.stringify({
			stance: 'bearish',
			confidence: 6,
			dataCitations: ['DXY=106'],
			keyPoints: ['DXY strengthening'],
			fullAnalysis: 'Macro headwinds present.',
		})}\nEnd of analysis.`;
		const result = parsePanelistOutput('macro', raw);
		expect(result.stance).toBe('bearish');
		expect(result.confidence).toBe(6);
	});

	it('returns neutral stance on invalid stance value', () => {
		const raw = JSON.stringify({
			stance: 'very_bullish', // invalid
			confidence: 7,
			dataCitations: [],
			keyPoints: [],
			fullAnalysis: 'Some analysis.',
		});
		const result = parsePanelistOutput('quant', raw);
		expect(result.stance).toBe('neutral');
	});

	it('clamps confidence to 1-10 range', () => {
		const raw = JSON.stringify({
			stance: 'bullish',
			confidence: 15, // out of range
			dataCitations: [],
			keyPoints: [],
			fullAnalysis: 'Analysis.',
		});
		const result = parsePanelistOutput('technical', raw);
		expect(result.confidence).toBe(10);
	});

	it('clamps confidence at minimum 1', () => {
		const raw = JSON.stringify({
			stance: 'neutral',
			confidence: -3, // negative
			dataCitations: [],
			keyPoints: [],
			fullAnalysis: 'Analysis.',
		});
		const result = parsePanelistOutput('technical', raw);
		expect(result.confidence).toBe(1);
	});

	it('returns fallback on invalid JSON', () => {
		const result = parsePanelistOutput('risk', 'not json at all {{}}');
		expect(result.panelistId).toBe('risk');
		expect(result.stance).toBe('neutral');
		expect(result.confidence).toBe(5);
	});

	it('limits dataCitations to 5 items', () => {
		const raw = JSON.stringify({
			stance: 'bullish',
			confidence: 7,
			dataCitations: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
			keyPoints: [],
			fullAnalysis: 'Analysis.',
		});
		const result = parsePanelistOutput('technical', raw);
		expect(result.dataCitations.length).toBeLessThanOrEqual(5);
	});

	it('uses raw text as fullAnalysis when fullAnalysis field missing', () => {
		const raw = JSON.stringify({
			stance: 'neutral',
			confidence: 5,
			dataCitations: [],
			keyPoints: [],
		});
		const result = parsePanelistOutput('quant', raw);
		expect(result.fullAnalysis).toBeTruthy();
	});
});

// ─── buildConsensus ────────────────────────────────────────────────────────────

describe('buildConsensus', () => {
	it('returns neutral for empty outputs', () => {
		const result = buildConsensus([]);
		expect(result.direction).toBe('neutral');
		expect(result.dissentCount).toBe(0);
	});

	it('returns bullish when majority are bullish', () => {
		const outputs = [
			makePanelistOutput({ panelistId: 'technical', stance: 'bullish', confidence: 7 }),
			makePanelistOutput({ panelistId: 'macro', stance: 'bullish', confidence: 6 }),
			makePanelistOutput({ panelistId: 'quant', stance: 'bullish', confidence: 8 }),
			makePanelistOutput({ panelistId: 'risk', stance: 'bearish', confidence: 5 }),
		];
		const result = buildConsensus(outputs);
		expect(result.direction).toBe('bullish');
		expect(result.dissentCount).toBe(1);
	});

	it('returns bearish when majority are bearish', () => {
		const outputs = [
			makePanelistOutput({ panelistId: 'technical', stance: 'bearish', confidence: 7 }),
			makePanelistOutput({ panelistId: 'macro', stance: 'bearish', confidence: 8 }),
			makePanelistOutput({ panelistId: 'quant', stance: 'neutral', confidence: 5 }),
			makePanelistOutput({ panelistId: 'risk', stance: 'bearish', confidence: 7 }),
		];
		const result = buildConsensus(outputs);
		expect(result.direction).toBe('bearish');
	});

	it('returns neutral on tie between bullish and bearish', () => {
		const outputs = [
			makePanelistOutput({ panelistId: 'technical', stance: 'bullish', confidence: 7 }),
			makePanelistOutput({ panelistId: 'macro', stance: 'bearish', confidence: 6 }),
			makePanelistOutput({ panelistId: 'quant', stance: 'bullish', confidence: 8 }),
			makePanelistOutput({ panelistId: 'risk', stance: 'bearish', confidence: 5 }),
		];
		const result = buildConsensus(outputs);
		expect(result.direction).toBe('neutral');
	});

	it('calculates average confidence correctly', () => {
		const outputs = [
			makePanelistOutput({ panelistId: 'technical', stance: 'bullish', confidence: 6 }),
			makePanelistOutput({ panelistId: 'macro', stance: 'bullish', confidence: 8 }),
			makePanelistOutput({ panelistId: 'quant', stance: 'bullish', confidence: 7 }),
			makePanelistOutput({ panelistId: 'risk', stance: 'bullish', confidence: 7 }),
		];
		const result = buildConsensus(outputs);
		expect(result.confidence).toBe(7); // (6+8+7+7)/4 = 7
	});

	it('counts dissenters correctly', () => {
		const outputs = [
			makePanelistOutput({ panelistId: 'technical', stance: 'bullish', confidence: 8 }),
			makePanelistOutput({ panelistId: 'macro', stance: 'bearish', confidence: 6 }),
			makePanelistOutput({ panelistId: 'quant', stance: 'neutral', confidence: 5 }),
			makePanelistOutput({ panelistId: 'risk', stance: 'bullish', confidence: 7 }),
		];
		const result = buildConsensus(outputs);
		expect(result.direction).toBe('bullish');
		expect(result.dissentCount).toBe(2); // bearish + neutral
	});

	it('summary contains consensus direction', () => {
		const outputs = [
			makePanelistOutput({ panelistId: 'technical', stance: 'bullish', confidence: 7 }),
			makePanelistOutput({ panelistId: 'macro', stance: 'bullish', confidence: 8 }),
			makePanelistOutput({ panelistId: 'quant', stance: 'bullish', confidence: 7 }),
			makePanelistOutput({ panelistId: 'risk', stance: 'bullish', confidence: 7 }),
		];
		const result = buildConsensus(outputs);
		expect(result.summary).toContain('BULLISH');
	});

	it('reports full agreement when all agree', () => {
		const outputs = [
			makePanelistOutput({ panelistId: 'technical', stance: 'bearish', confidence: 8 }),
			makePanelistOutput({ panelistId: 'macro', stance: 'bearish', confidence: 7 }),
			makePanelistOutput({ panelistId: 'quant', stance: 'bearish', confidence: 6 }),
			makePanelistOutput({ panelistId: 'risk', stance: 'bearish', confidence: 8 }),
		];
		const result = buildConsensus(outputs);
		expect(result.dissentCount).toBe(0);
		expect(result.summary).toContain('Full panel agreement');
	});
});

// ─── buildWarRoomBlock ─────────────────────────────────────────────────────────

describe('buildWarRoomBlock', () => {
	const outputs: WarRoomPanelistOutput[] = WAR_ROOM_PANELIST_ORDER.map((id) =>
		makePanelistOutput({ panelistId: id, stance: 'bullish', confidence: 7 }),
	);
	const consensus = buildConsensus(outputs);
	const modelMap = {
		technical: 'gpt-4o',
		macro: 'deepseek',
		quant: 'gpt-4o-mini',
		risk: 'deepseek-r1',
	};

	it('returns block with type "war_room"', () => {
		const block = buildWarRoomBlock('wr_test', 'BTCUSDT', outputs, consensus, modelMap);
		expect(block.type).toBe('war_room');
	});

	it('sets topic from symbol', () => {
		const block = buildWarRoomBlock('wr_test', 'BTCUSDT', outputs, consensus, modelMap);
		expect(block.topic).toContain('BTCUSDT');
	});

	it('has 4 panelists', () => {
		const block = buildWarRoomBlock('wr_test', 'BTCUSDT', outputs, consensus, modelMap);
		expect(block.panelists).toHaveLength(4);
	});

	it('has 4 turns', () => {
		const block = buildWarRoomBlock('wr_test', 'BTCUSDT', outputs, consensus, modelMap);
		expect(block.turns).toHaveLength(4);
	});

	it('panelists have specialty field', () => {
		const block = buildWarRoomBlock('wr_test', 'BTCUSDT', outputs, consensus, modelMap);
		for (const p of block.panelists) {
			expect(p.specialty).toBeTruthy();
		}
	});

	it('turns have dataCitations field', () => {
		const block = buildWarRoomBlock('wr_test', 'BTCUSDT', outputs, consensus, modelMap);
		for (const t of block.turns) {
			expect(Array.isArray(t.dataCitations)).toBe(true);
		}
	});

	it('turns have stance and keyPoints', () => {
		const block = buildWarRoomBlock('wr_test', 'BTCUSDT', outputs, consensus, modelMap);
		for (const t of block.turns) {
			expect(['bullish', 'bearish', 'neutral']).toContain(t.stance);
			expect(Array.isArray(t.keyPoints)).toBe(true);
		}
	});

	it('sets consensus fields from consensus object', () => {
		const block = buildWarRoomBlock('wr_test', 'BTCUSDT', outputs, consensus, modelMap);
		expect(block.consensusDirection).toBe(consensus.direction);
		expect(block.consensusConfidence).toBe(consensus.confidence);
		expect(block.dissentCount).toBe(consensus.dissentCount);
		expect(block.consensusSummary).toBe(consensus.summary);
	});

	it('sets status to complete', () => {
		const block = buildWarRoomBlock('wr_test', 'BTCUSDT', outputs, consensus, modelMap);
		expect(block.status).toBe('complete');
	});

	it('sets model on each panelist from modelMap', () => {
		const block = buildWarRoomBlock('wr_test', 'BTCUSDT', outputs, consensus, modelMap);
		const technicalPanelist = block.panelists.find((p) => p.id === 'technical');
		expect(technicalPanelist?.model).toBe('gpt-4o');
	});

	it('sets warRoomId correctly', () => {
		const block = buildWarRoomBlock('wr_xyz', 'BTCUSDT', outputs, consensus, modelMap);
		expect(block.warRoomId).toBe('wr_xyz');
	});

	it('handles empty outputs gracefully', () => {
		const emptyConsensus = buildConsensus([]);
		const block = buildWarRoomBlock('wr_empty', 'BTCUSDT', [], emptyConsensus, modelMap);
		expect(block.turns).toHaveLength(0);
		expect(block.type).toBe('war_room');
	});
});
