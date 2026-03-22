// Market Summary Tool Tests — T-904
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Inline extracted pure helpers for testing ─────────────────────────────────
// These functions mirror the logic in marketSummary.tool.ts

type MarketTone = 'risk-on' | 'risk-off' | 'neutral' | 'mixed';

function calcTone(riskScore: number, sentiment: number): MarketTone {
	const composite = (riskScore + (sentiment - 50)) / 2;
	if (composite > 20)  return 'risk-on';
	if (composite < -20) return 'risk-off';
	if (Math.abs(riskScore - (sentiment - 50)) > 40) return 'mixed';
	return 'neutral';
}

function toneLabel(tone: MarketTone): string {
	switch (tone) {
		case 'risk-on':  return 'Risk-On';
		case 'risk-off': return 'Risk-Off';
		case 'mixed':    return 'Mixed';
		case 'neutral':  return 'Neutral';
	}
}

// ─── calcTone ─────────────────────────────────────────────────────────────────

describe('calcTone', () => {
	it('returns risk-on for strongly positive signals', () => {
		expect(calcTone(50, 80)).toBe('risk-on');
	});

	it('returns risk-off for strongly negative signals', () => {
		expect(calcTone(-50, 20)).toBe('risk-off');
	});

	it('returns neutral when signals are balanced near zero', () => {
		expect(calcTone(0, 50)).toBe('neutral');
	});

	it('returns mixed when intermarket and sentiment diverge strongly', () => {
		// riskScore = +60, sentiment-50 = -40 → diff = 100 > 40 → mixed
		expect(calcTone(60, 10)).toBe('mixed');
	});

	it('risk-on threshold is > 20 composite', () => {
		// composite = (21 + 0) / 2 = 10.5 → neutral (not risk-on)
		expect(calcTone(21, 50)).toBe('neutral');
		// composite = (42 + 0) / 2 = 21 → risk-on
		expect(calcTone(42, 50)).toBe('risk-on');
	});

	it('risk-off threshold is < -20 composite', () => {
		// composite = (-42 + 0) / 2 = -21 → risk-off
		expect(calcTone(-42, 50)).toBe('risk-off');
	});

	it('treats high sentiment (90) as bullish contribution', () => {
		expect(calcTone(30, 90)).toBe('risk-on');
	});

	it('treats low sentiment (10) as bearish contribution', () => {
		expect(calcTone(-30, 10)).toBe('risk-off');
	});
});

// ─── toneLabel ────────────────────────────────────────────────────────────────

describe('toneLabel', () => {
	it('returns correct labels for each tone', () => {
		expect(toneLabel('risk-on')).toBe('Risk-On');
		expect(toneLabel('risk-off')).toBe('Risk-Off');
		expect(toneLabel('neutral')).toBe('Neutral');
		expect(toneLabel('mixed')).toBe('Mixed');
	});
});

// ─── Summary text construction ────────────────────────────────────────────────

function buildSummaryText(data: {
	btcRegime: string;
	btcRSI: number;
	btcChange24h: number;
	riskSignal: string;
	riskScore: number;
	yieldCurve: string;
	spreadBps2s10s: number;
	newsSentiment: number;
	newsHeadline: string;
	topMover: { symbol: string; change: number };
	tone: MarketTone;
}): string {
	const lines: string[] = [
		`## Market Overview — ${new Date().toUTCString().slice(0, 16)}`,
		'',
		`**Overall Tone: ${toneLabel(data.tone)}**`,
		'',
		'### Key Readings',
		`- **BTC Regime**: ${data.btcRegime} | RSI ${data.btcRSI.toFixed(0)} | 24h ${data.btcChange24h >= 0 ? '+' : ''}${data.btcChange24h.toFixed(2)}%`,
		`- **Intermarket Risk**: ${data.riskSignal} (score ${data.riskScore > 0 ? '+' : ''}${data.riskScore})`,
		`- **Yield Curve**: ${data.yieldCurve} | 2s10s spread: ${data.spreadBps2s10s >= 0 ? '+' : ''}${data.spreadBps2s10s.toFixed(0)} bps`,
		`- **News Sentiment**: ${data.newsSentiment.toFixed(0)}/100 — "${data.newsHeadline}"`,
		`- **Top Mover**: ${data.topMover.symbol.replace('USDT', '')} ${data.topMover.change >= 0 ? '+' : ''}${data.topMover.change.toFixed(2)}%`,
	];
	if (data.yieldCurve.toLowerCase().includes('inverted')) {
		lines.push('**Warning**: Inverted yield curve — historical recession signal. Watch for risk-off rotation.');
	}
	if (data.btcRSI > 70) lines.push('BTC RSI overbought — pullback risk elevated.');
	if (data.btcRSI < 30) lines.push('BTC RSI oversold — potential bounce zone.');
	return lines.join('\n');
}

describe('buildSummaryText', () => {
	const baseData = {
		btcRegime:     'Trending Up',
		btcRSI:        60,
		btcChange24h:  3.5,
		riskSignal:    'Risk-On',
		riskScore:     40,
		yieldCurve:    'Normal',
		spreadBps2s10s: 50,
		newsSentiment: 65,
		newsHeadline:  'Bitcoin surges past $70k',
		topMover:      { symbol: 'BTCUSDT', change: 5.2 },
		tone:          'risk-on' as MarketTone,
	};

	it('includes overall tone header', () => {
		expect(buildSummaryText(baseData)).toContain('Overall Tone: Risk-On');
	});

	it('includes BTC regime and RSI', () => {
		const text = buildSummaryText(baseData);
		expect(text).toContain('Trending Up');
		expect(text).toContain('RSI 60');
	});

	it('includes 24h change with + prefix for positive', () => {
		expect(buildSummaryText(baseData)).toContain('+3.50%');
	});

	it('includes negative 24h change without + prefix', () => {
		const text = buildSummaryText({ ...baseData, btcChange24h: -2.1 });
		expect(text).toContain('-2.10%');
	});

	it('includes yield curve info', () => {
		expect(buildSummaryText(baseData)).toContain('Normal');
		expect(buildSummaryText(baseData)).toContain('+50 bps');
	});

	it('adds warning for inverted yield curve', () => {
		const text = buildSummaryText({ ...baseData, yieldCurve: 'Inverted' });
		expect(text).toContain('Warning');
		expect(text).toContain('Inverted yield curve');
	});

	it('adds overbought warning when RSI > 70', () => {
		const text = buildSummaryText({ ...baseData, btcRSI: 75 });
		expect(text).toContain('overbought');
	});

	it('adds oversold note when RSI < 30', () => {
		const text = buildSummaryText({ ...baseData, btcRSI: 25 });
		expect(text).toContain('oversold');
	});

	it('strips USDT from top mover symbol', () => {
		const text = buildSummaryText(baseData);
		expect(text).toContain('BTC ');
		expect(text).not.toContain('BTCUSDT ');
	});

	it('includes news headline', () => {
		expect(buildSummaryText(baseData)).toContain('Bitcoin surges past $70k');
	});

	it('does not add RSI warning for normal RSI', () => {
		const text = buildSummaryText({ ...baseData, btcRSI: 55 });
		expect(text).not.toContain('overbought');
		expect(text).not.toContain('oversold');
	});
});

// ─── Spread formatting ────────────────────────────────────────────────────────

describe('spread formatting', () => {
	it('shows + prefix for positive spread', () => {
		const text = buildSummaryText({
			btcRegime: 'Ranging', btcRSI: 50, btcChange24h: 0,
			riskSignal: 'Neutral', riskScore: 0,
			yieldCurve: 'Normal', spreadBps2s10s: 35,
			newsSentiment: 50, newsHeadline: 'Test',
			topMover: { symbol: 'ETHUSDT', change: 1 },
			tone: 'neutral',
		});
		expect(text).toContain('+35 bps');
	});

	it('shows - prefix for negative spread (inverted)', () => {
		const text = buildSummaryText({
			btcRegime: 'Ranging', btcRSI: 50, btcChange24h: 0,
			riskSignal: 'Risk-Off', riskScore: -30,
			yieldCurve: 'Inverted', spreadBps2s10s: -50,
			newsSentiment: 40, newsHeadline: 'Recession fears',
			topMover: { symbol: 'BTCUSDT', change: -3 },
			tone: 'risk-off',
		});
		expect(text).toContain('-50 bps');
	});
});
