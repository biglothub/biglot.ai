// Market Summary Tool — T-904
// Tool: get_market_summary
// Aggregates 5 data sources in parallel and returns a structured market overview.

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { buildYieldCurveSnapshot } from '../data/yieldCurve.data';
import { fetchNewsFeed } from '../data/newsFeed.data';
import { buildIntermarketSnapshot } from '../data/intermarket.data';
import { fetchOHLCV } from '../data/ohlcvProvider';
import { analyzeRegime, regimeLabel } from '../indicators/regime';
import type { ContentBlock, MetricCardBlock, TextBlock } from '$lib/types/contentBlock';

// ─── Types ─────────────────────────────────────────────────────────────────────

type MarketTone = 'risk-on' | 'risk-off' | 'neutral' | 'mixed';

interface SummaryData {
	btcRegime:      string;
	btcRSI:         number;
	btcChange24h:   number;
	riskSignal:     string;
	riskScore:      number;
	yieldCurve:     string;
	spreadBps2s10s: number;
	newsSentiment:  number;  // 0–100
	newsHeadline:   string;
	topMover:       { symbol: string; change: number };
	tone:           MarketTone;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch top Binance USDT movers by 24h change from public ticker endpoint. */
async function fetchTopMovers(): Promise<{ symbol: string; change: number }[]> {
	try {
		const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return [];
		const tickers = await res.json() as { symbol: string; priceChangePercent: string; quoteVolume: string }[];
		return tickers
			.filter(t =>
				t.symbol.endsWith('USDT') &&
				!t.symbol.includes('UP') && !t.symbol.includes('DOWN') &&
				!t.symbol.includes('BULL') && !t.symbol.includes('BEAR') &&
				parseFloat(t.quoteVolume) > 10_000_000
			)
			.map(t => ({ symbol: t.symbol, change: parseFloat(t.priceChangePercent) }))
			.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
			.slice(0, 10);
	} catch {
		return [];
	}
}

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

function buildSummaryText(data: SummaryData): string {
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
		'',
		'### Interpretation',
		...(data.tone === 'risk-on' ? [
			'Risk appetite is elevated. Crypto and growth assets are favoured. Monitor for overextension.',
		] : data.tone === 'risk-off' ? [
			'Risk aversion is dominant. Capital is rotating to safety (bonds, gold, USD). Reduce exposure.',
		] : data.tone === 'mixed' ? [
			'Mixed signals — intermarket and sentiment diverging. Caution warranted; wait for confirmation.',
		] : [
			'Market is in equilibrium. No strong directional bias; range-bound conditions likely.',
		]),
		...(data.yieldCurve.toLowerCase().includes('inverted') ? [
			'**Warning**: Inverted yield curve — historical recession signal. Watch for risk-off rotation.',
		] : []),
		...(data.btcRSI > 70 ? ['BTC RSI overbought — pullback risk elevated.'] : []),
		...(data.btcRSI < 30 ? ['BTC RSI oversold — potential bounce zone.'] : []),
	];
	return lines.join('\n');
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'get_market_summary',
	description:
		'Comprehensive market summary — aggregates 5 parallel data sources (BTC market regime, intermarket risk signal, US yield curve, news sentiment, top Binance movers) and returns a structured overview of market tone (risk-on/off/neutral/mixed). Returns TextBlock (narrative summary) + MetricCard (5 key readings). 15 min cache. Use when asked for a market overview, morning briefing, overall market status, or "what\'s happening in the market".',
	parameters: {
		type: 'object',
		properties: {},
		required: [],
	},
	timeout: 45_000,
	execute: async (_args): Promise<ToolResult> => {
		const cacheKey = toolCache.generateKey('get_market_summary', {});
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Run all 5 data fetches in parallel ─────────────────────────────────
		const [btcResult, interResult, yieldResult, newsResult, moversResult] = await Promise.allSettled([
			fetchOHLCV('BTCUSDT', '1d', 100),
			buildIntermarketSnapshot(),
			buildYieldCurveSnapshot(),
			fetchNewsFeed(undefined, 20),
			fetchTopMovers(),
		]);

		// ── BTC regime ─────────────────────────────────────────────────────────
		let btcRegime   = 'Unknown';
		let btcRSI      = 50;
		let btcChange   = 0;
		if (btcResult.status === 'fulfilled' && !('error' in btcResult.value)) {
			const candles = btcResult.value.ohlcv;
			const regime  = analyzeRegime(candles);
			btcRegime = regime ? regimeLabel(regime.regime) : 'Unknown';
			btcRSI    = regime?.rsiValue ?? 50;
			if (candles.length >= 2) {
				const last = candles[candles.length - 1];
				const prev = candles[candles.length - 2];
				btcChange = prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0;
			}
		}

		// ── Intermarket risk ───────────────────────────────────────────────────
		let riskSignal = 'Unknown';
		let riskScore  = 0;
		if (interResult.status === 'fulfilled') {
			const snap  = interResult.value;
			riskSignal  = snap.riskLabel;
			riskScore   = snap.riskScore;
		}

		// ── Yield curve ────────────────────────────────────────────────────────
		let yieldCurveLabel = 'Unknown';
		let spread2s10s     = 0;
		const yieldSources: { name: string; url: string; accessedAt: number }[] = [];
		if (yieldResult.status === 'fulfilled') {
			const snap    = yieldResult.value;
			yieldCurveLabel = snap.classificationLabel;
			const s2s10s    = snap.spreads.find(s => s.name === '2s10s');
			spread2s10s     = s2s10s ? s2s10s.spread : 0;
			yieldSources.push({ name: 'US Treasury Yields', url: 'https://finance.yahoo.com', accessedAt: Date.now() });
		}

		// ── News sentiment ─────────────────────────────────────────────────────
		let sentimentScore = 50;
		let topHeadline    = 'No headlines available';
		if (newsResult.status === 'fulfilled') {
			const snap     = newsResult.value;
			sentimentScore = snap.compositeScore;
			const first    = snap.items[0];
			topHeadline    = first ? first.title.slice(0, 80) + (first.title.length > 80 ? '…' : '') : topHeadline;
		}

		// ── Top mover ─────────────────────────────────────────────────────────
		let topMover = { symbol: 'BTCUSDT', change: btcChange };
		if (moversResult.status === 'fulfilled' && moversResult.value.length > 0) {
			topMover = moversResult.value[0];
		}

		// ── Tone ───────────────────────────────────────────────────────────────
		const tone = calcTone(riskScore, sentimentScore);

		const summaryData: SummaryData = {
			btcRegime,
			btcRSI,
			btcChange24h: btcChange,
			riskSignal,
			riskScore,
			yieldCurve: yieldCurveLabel,
			spreadBps2s10s: spread2s10s,
			newsSentiment: sentimentScore,
			newsHeadline: topHeadline,
			topMover,
			tone,
		};

		// ── Blocks ─────────────────────────────────────────────────────────────
		const textBlock: TextBlock = {
			type:    'text',
			content: buildSummaryText(summaryData),
		};

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Market Summary — ${toneLabel(tone)}`,
			metrics: [
				{
					label:     'Market Tone',
					value:     toneLabel(tone),
					change:    `Intermarket: ${riskSignal}`,
					direction: tone === 'risk-on' ? 'up' : tone === 'risk-off' ? 'down' : 'neutral',
				},
				{
					label:     'BTC Regime',
					value:     btcRegime,
					change:    `RSI ${btcRSI.toFixed(0)} | 24h ${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(2)}%`,
					direction: btcChange >= 0 ? 'up' : 'down',
				},
				{
					label:     'Yield Curve',
					value:     yieldCurveLabel,
					change:    `2s10s spread: ${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(0)} bps`,
					direction: spread2s10s >= 0 ? 'up' : 'down',
				},
				{
					label:     'News Sentiment',
					value:     `${sentimentScore.toFixed(0)} / 100`,
					change:    sentimentScore > 60 ? 'Positive' : sentimentScore < 40 ? 'Negative' : 'Neutral',
					direction: sentimentScore > 60 ? 'up' : sentimentScore < 40 ? 'down' : 'neutral',
				},
				{
					label:     'Top Mover',
					value:     topMover.symbol.replace('USDT', ''),
					change:    `${topMover.change >= 0 ? '+' : ''}${topMover.change.toFixed(2)}%`,
					direction: topMover.change >= 0 ? 'up' : 'down',
				},
			],
		};

		const contentBlocks: ContentBlock[] = [metricBlock, textBlock];

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Market summary: Tone is ${toneLabel(tone)}. BTC ${btcRegime} (RSI ${btcRSI.toFixed(0)}). Risk signal: ${riskSignal}. Yield curve: ${yieldCurveLabel} (2s10s ${spread2s10s >= 0 ? '+' : ''}${spread2s10s.toFixed(0)} bps). News sentiment: ${sentimentScore.toFixed(0)}/100. Top mover: ${topMover.symbol.replace('USDT', '')} ${topMover.change >= 0 ? '+' : ''}${topMover.change.toFixed(2)}%.`,
			sources: [
				...yieldSources,
				{ name: 'Binance Market Data', url: 'https://api.binance.com', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 15 * 60_000); // 15 min cache
		return result;
	},
});
