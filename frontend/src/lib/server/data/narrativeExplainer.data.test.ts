// Narrative Market Explainer Data Tests — T-1305

import { describe, it, expect } from 'vitest';
import {
	buildNarrativePrompt,
	parseNarrativeResponse,
	buildFallbackSections,
	buildNarrativeReportBlock,
	type NarrativeData,
	type NarrativeSectionsOutput,
} from './narrativeExplainer.data';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeNarrativeData(overrides: Partial<NarrativeData> = {}): NarrativeData {
	return {
		symbol: 'BTCUSDT',
		question: 'Why is BTC dropping?',
		currentPrice: 65000,
		regimeSummary: 'Trending Down (confidence 78%). ADX=32, RSI=38. Strong bearish trend.',
		confluenceSummary: 'Bearish=4, Bullish=1. Signals: MACD bearish cross; EMA death cross.',
		divergenceSummary: '0 bullish, 1 bearish divergences detected.',
		sentimentSummary: 'Bearish (32/100). 3 bullish, 12 bearish news items.',
		topHeadlines: [
			'BTC drops below $65k as macro fears mount',
			'Fed signals higher for longer',
			'Crypto liquidations exceed $500M',
		],
		macroSummary: 'DXY=105.20 (+0.80%), 10Y Yield=4.75% (+0.12%), SPX=5200 (-0.90%), Gold signal: bullish',
		onChainSummary: 'BTC: MVRV=1.85, NVT=65.3, Active Addrs=850,000.',
		derivativesSummary: 'Funding=-0.0050% (-5.5% ann, short-biased); OI=$18,200.5M; L/S=42%/58%',
		...overrides,
	};
}

function makeSections(overrides: Partial<NarrativeSectionsOutput> = {}): NarrativeSectionsOutput {
	return {
		priceActionSummary:
			'BTC has declined 8% over the past week from $70k to $65k, breaking below the 200-day MA at $66,500.',
		keyDrivers:
			'- **Macro headwinds**: Rising DXY and 10Y yields reducing risk appetite\n' +
			'- **Bearish regime**: ADX=32 with strong -DI dominance\n' +
			'- **Negative funding**: Short bias in derivatives',
		supportingData:
			'- **On-Chain**: MVRV=1.85 indicates modest overvaluation vs realized price\n' +
			'- **Derivatives**: Funding negative at -0.005%, shorts dominating\n' +
			'- **Macro**: DXY strengthening +0.8% applying pressure',
		whatToWatchNext:
			'- **$62,000**: Key support — break would accelerate selling\n' +
			'- **10Y Yield**: Watch for move above 5% as further headwind\n' +
			'- **Funding rate**: Flip to positive would signal short squeeze setup',
		thaiSummary:
			'บิทคอยน์ปรับตัวลดลง 8% ในสัปดาห์ที่ผ่านมา เนื่องจากแรงกดดันจากมาโครและดอลลาร์ที่แข็งค่า ควรจับตาแนวรับที่ 62,000 ดอลลาร์อย่างใกล้ชิด',
		...overrides,
	};
}

// ─── buildNarrativePrompt ─────────────────────────────────────────────────────

describe('buildNarrativePrompt', () => {
	it('includes the question verbatim', () => {
		const data = makeNarrativeData({ question: 'Why is BTC crashing?' });
		const prompt = buildNarrativePrompt(data);
		expect(prompt).toContain('Why is BTC crashing?');
	});

	it('includes symbol and price', () => {
		const data = makeNarrativeData({ symbol: 'ETHUSDT', currentPrice: 3200.5 });
		const prompt = buildNarrativePrompt(data);
		expect(prompt).toContain('ETHUSDT');
		expect(prompt).toContain('3200.5000');
	});

	it('includes all data sections', () => {
		const data = makeNarrativeData();
		const prompt = buildNarrativePrompt(data);
		expect(prompt).toContain('Market Regime');
		expect(prompt).toContain('Technical Signals');
		expect(prompt).toContain('News Sentiment');
		expect(prompt).toContain('Macro Environment');
		expect(prompt).toContain('On-Chain');
		expect(prompt).toContain('Derivatives/Positioning');
	});

	it('includes top headlines numbered', () => {
		const data = makeNarrativeData();
		const prompt = buildNarrativePrompt(data);
		expect(prompt).toContain('1. BTC drops below $65k');
		expect(prompt).toContain('2. Fed signals higher for longer');
		expect(prompt).toContain('3. Crypto liquidations exceed $500M');
	});

	it('handles empty headlines gracefully', () => {
		const data = makeNarrativeData({ topHeadlines: [] });
		const prompt = buildNarrativePrompt(data);
		expect(prompt).toContain('No recent headlines available');
	});

	it('handles zero price gracefully', () => {
		const data = makeNarrativeData({ currentPrice: 0 });
		const prompt = buildNarrativePrompt(data);
		expect(prompt).toContain('unknown');
	});

	it('includes JSON schema instructions', () => {
		const data = makeNarrativeData();
		const prompt = buildNarrativePrompt(data);
		expect(prompt).toContain('priceActionSummary');
		expect(prompt).toContain('keyDrivers');
		expect(prompt).toContain('supportingData');
		expect(prompt).toContain('whatToWatchNext');
		expect(prompt).toContain('thaiSummary');
	});
});

// ─── parseNarrativeResponse ───────────────────────────────────────────────────

describe('parseNarrativeResponse', () => {
	it('parses valid JSON response', () => {
		const response = JSON.stringify({
			priceActionSummary: 'BTC dropped 8% to $65k breaking key support.',
			keyDrivers: '- **Macro**: DXY rising\n- **Sentiment**: Bearish news',
			supportingData: '- **On-Chain**: MVRV=1.85\n- **Derivatives**: Negative funding',
			whatToWatchNext: '- Watch $62k support\n- Monitor DXY',
			thaiSummary: 'บิทคอยน์ลดลง 8% เนื่องจากแรงกดดันมาโคร',
		});
		const result = parseNarrativeResponse(response);
		expect(result).not.toBeNull();
		expect(result!.priceActionSummary).toContain('BTC dropped 8%');
		expect(result!.keyDrivers).toContain('DXY rising');
		expect(result!.thaiSummary).toContain('บิทคอยน์');
	});

	it('parses JSON wrapped in markdown code block', () => {
		const response =
			'Here is the analysis:\n```json\n' +
			JSON.stringify({
				priceActionSummary: 'Price dropped significantly.',
				keyDrivers: '- Macro headwinds',
				supportingData: '- Bearish divergence',
				whatToWatchNext: '- Watch $60k',
				thaiSummary: 'ราคาปรับตัวลง',
			}) +
			'\n```';
		const result = parseNarrativeResponse(response);
		expect(result).not.toBeNull();
		expect(result!.priceActionSummary).toBe('Price dropped significantly.');
	});

	it('returns null for invalid JSON', () => {
		const result = parseNarrativeResponse('not valid json at all {{{{');
		expect(result).toBeNull();
	});

	it('returns null when required fields are missing', () => {
		// priceActionSummary missing → should return null
		const response = JSON.stringify({
			keyDrivers: '',
			supportingData: 'data',
			whatToWatchNext: 'watch',
			thaiSummary: 'Thai',
		});
		const result = parseNarrativeResponse(response);
		expect(result).toBeNull();
	});

	it('returns null when both required fields are empty strings', () => {
		const response = JSON.stringify({
			priceActionSummary: '',
			keyDrivers: '',
			supportingData: 'data',
			whatToWatchNext: 'watch',
			thaiSummary: 'Thai',
		});
		const result = parseNarrativeResponse(response);
		expect(result).toBeNull();
	});

	it('trims whitespace from parsed values', () => {
		const response = JSON.stringify({
			priceActionSummary: '  BTC dropped.  ',
			keyDrivers: '  - Macro  ',
			supportingData: '  data  ',
			whatToWatchNext: '  watch  ',
			thaiSummary: '  ไทย  ',
		});
		const result = parseNarrativeResponse(response);
		expect(result).not.toBeNull();
		expect(result!.priceActionSummary).toBe('BTC dropped.');
		expect(result!.keyDrivers).toBe('- Macro');
	});

	it('handles missing optional fields gracefully', () => {
		const response = JSON.stringify({
			priceActionSummary: 'Price dropped.',
			keyDrivers: '- Main driver',
		});
		const result = parseNarrativeResponse(response);
		expect(result).not.toBeNull();
		expect(result!.supportingData).toBe('');
		expect(result!.whatToWatchNext).toBe('');
		expect(result!.thaiSummary).toBe('');
	});
});

// ─── buildFallbackSections ────────────────────────────────────────────────────

describe('buildFallbackSections', () => {
	it('includes symbol and price in priceActionSummary', () => {
		const data = makeNarrativeData({ symbol: 'BTCUSDT', currentPrice: 65000 });
		const sections = buildFallbackSections(data);
		expect(sections.priceActionSummary).toContain('BTCUSDT');
		expect(sections.priceActionSummary).toContain('65000.0000');
	});

	it('handles zero price gracefully', () => {
		const data = makeNarrativeData({ currentPrice: 0 });
		const sections = buildFallbackSections(data);
		expect(sections.priceActionSummary).toContain('N/A');
	});

	it('includes all 4 key sections', () => {
		const data = makeNarrativeData();
		const sections = buildFallbackSections(data);
		expect(sections.priceActionSummary).toBeTruthy();
		expect(sections.keyDrivers).toBeTruthy();
		expect(sections.supportingData).toBeTruthy();
		expect(sections.whatToWatchNext).toBeTruthy();
	});

	it('includes Thai summary', () => {
		const data = makeNarrativeData();
		const sections = buildFallbackSections(data);
		expect(sections.thaiSummary).toBeTruthy();
		expect(sections.thaiSummary).toContain('BTCUSDT');
	});

	it('includes regime data in keyDrivers', () => {
		const data = makeNarrativeData({
			regimeSummary: 'Trending Down (confidence 78%). ADX=32.',
		});
		const sections = buildFallbackSections(data);
		expect(sections.keyDrivers).toContain('Trending Down');
	});

	it('includes derivatives data in keyDrivers', () => {
		const data = makeNarrativeData({
			derivativesSummary: 'Funding=-0.005% (short-biased)',
		});
		const sections = buildFallbackSections(data);
		expect(sections.keyDrivers).toContain('short-biased');
	});

	it('includes on-chain in supportingData', () => {
		const data = makeNarrativeData({ onChainSummary: 'BTC: MVRV=1.85' });
		const sections = buildFallbackSections(data);
		expect(sections.supportingData).toContain('MVRV=1.85');
	});

	it('detects trending_up for thai summary', () => {
		const data = makeNarrativeData({
			regimeSummary: 'trending_up regime active',
		});
		const sections = buildFallbackSections(data);
		expect(sections.thaiSummary).toContain('ขาขึ้น');
	});

	it('detects trending_down for thai summary', () => {
		const data = makeNarrativeData({
			regimeSummary: 'trending_down regime confirmed',
		});
		const sections = buildFallbackSections(data);
		expect(sections.thaiSummary).toContain('ขาลง');
	});
});

// ─── buildNarrativeReportBlock ────────────────────────────────────────────────

describe('buildNarrativeReportBlock', () => {
	it('returns a research_report block', () => {
		const sections = makeSections();
		const block = buildNarrativeReportBlock('BTCUSDT', 'Why is BTC dropping?', sections, 1200);
		expect(block.type).toBe('research_report');
	});

	it('sets the title to the question', () => {
		const sections = makeSections();
		const block = buildNarrativeReportBlock(
			'BTCUSDT',
			'Why is BTC crashing today?',
			sections,
			500
		);
		expect(block.title).toBe('Why is BTC crashing today?');
		expect(block.query).toBe('Why is BTC crashing today?');
	});

	it('uses default title when question is empty', () => {
		const sections = makeSections();
		const block = buildNarrativeReportBlock('ETHUSDT', '', sections, 500);
		expect(block.title).toContain('ETHUSDT');
	});

	it('includes 5 sections (4 English + 1 Thai)', () => {
		const sections = makeSections();
		const block = buildNarrativeReportBlock('BTCUSDT', 'Why?', sections, 1000);
		expect(block.sections).toHaveLength(5);
	});

	it('omits Thai section when thaiSummary is empty', () => {
		const sections = makeSections({ thaiSummary: '' });
		const block = buildNarrativeReportBlock('BTCUSDT', 'Why?', sections, 1000);
		expect(block.sections).toHaveLength(4);
	});

	it('has correct section IDs', () => {
		const sections = makeSections();
		const block = buildNarrativeReportBlock('BTCUSDT', 'Why?', sections, 1000);
		const ids = block.sections.map((s) => s.id);
		expect(ids).toContain('price_action');
		expect(ids).toContain('key_drivers');
		expect(ids).toContain('supporting_data');
		expect(ids).toContain('what_to_watch');
		expect(ids).toContain('thai_summary');
	});

	it('has correct section titles', () => {
		const sections = makeSections();
		const block = buildNarrativeReportBlock('BTCUSDT', 'Why?', sections, 1000);
		const titles = block.sections.map((s) => s.title);
		expect(titles).toContain('Price Action Summary');
		expect(titles).toContain('Key Drivers');
		expect(titles).toContain('Supporting Data');
		expect(titles).toContain('What to Watch Next');
		expect(titles).toContain('สรุปภาษาไทย');
	});

	it('sets status to complete', () => {
		const sections = makeSections();
		const block = buildNarrativeReportBlock('BTCUSDT', 'Why?', sections, 500);
		expect(block.status).toBe('complete');
	});

	it('records durationMs correctly', () => {
		const sections = makeSections();
		const block = buildNarrativeReportBlock('BTCUSDT', 'Why?', sections, 3456);
		expect(block.totalDurationMs).toBe(3456);
	});

	it('generates unique reportId including symbol', () => {
		const sections = makeSections();
		const block = buildNarrativeReportBlock('SOLUSDT', 'Why?', sections, 100);
		expect(block.reportId).toContain('SOLUSDT');
	});

	it('section content matches input sections', () => {
		const sections = makeSections({
			priceActionSummary: 'BTC plunged dramatically.',
			keyDrivers: '- Whale sell-off',
		});
		const block = buildNarrativeReportBlock('BTCUSDT', 'Why?', sections, 100);
		const priceSection = block.sections.find((s) => s.id === 'price_action');
		const driversSection = block.sections.find((s) => s.id === 'key_drivers');
		expect(priceSection?.content).toBe('BTC plunged dramatically.');
		expect(driversSection?.content).toBe('- Whale sell-off');
	});

	it('sets toolCallCount to 5', () => {
		const sections = makeSections();
		const block = buildNarrativeReportBlock('BTCUSDT', 'Why?', sections, 1000);
		expect(block.toolCallCount).toBe(5);
	});
});
