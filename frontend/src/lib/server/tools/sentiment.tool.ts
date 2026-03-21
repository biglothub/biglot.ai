// Sentiment Analysis Tool — get_sentiment
// Aggregates Fear & Greed, Binance funding rates, long/short ratios
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { fetchSentimentSnapshot } from '../data/sentiment.data';
import type { GaugeBlock, MetricCardBlock } from '$lib/types/contentBlock';

// ─── Gauge thresholds ─────────────────────────────────────────────────────────

const GAUGE_THRESHOLDS: GaugeBlock['thresholds'] = [
	{ value: 20,  color: '#dc2626', label: 'Extreme Fear' },
	{ value: 40,  color: '#f97316', label: 'Fear' },
	{ value: 60,  color: '#eab308', label: 'Neutral' },
	{ value: 80,  color: '#84cc16', label: 'Greed' },
	{ value: 100, color: '#22c55e', label: 'Extreme Greed' },
];

// ─── Tool registration ────────────────────────────────────────────────────────

registerTool({
	name: 'get_sentiment',
	description:
		'Aggregate crypto market sentiment: Crypto Fear & Greed Index, Binance perpetual funding rates (BTC/ETH), and global long/short account ratios. Returns a composite sentiment gauge (0–100) and detailed metric cards. Use when user asks about market sentiment, funding rates, long/short ratio, trader positioning, or overall market mood.',
	parameters: {
		type: 'object',
		properties: {
			symbols: {
				type: 'string',
				description: 'Comma-separated Binance USDT-perp symbols for funding/LS data, e.g. "BTCUSDT,ETHUSDT". Default: BTCUSDT,ETHUSDT',
			},
		},
		required: [],
	},
	timeout: 20_000,
	execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
		const symbols = args.symbols
			? String(args.symbols).toUpperCase().split(',').map((s) => s.trim()).filter(Boolean)
			: ['BTCUSDT', 'ETHUSDT'];

		const cacheKey = toolCache.generateKey('get_sentiment', { symbols });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const snap = await fetchSentimentSnapshot(symbols);
		const { fearGreed, fundingRates, longShort, compositeScore, compositeLabel } = snap;

		// ── Gauge block ──────────────────────────────────────────────────────────
		const gaugeBlock: GaugeBlock = {
			type: 'gauge',
			title: 'Market Sentiment',
			value: compositeScore,
			label: compositeLabel,
			thresholds: GAUGE_THRESHOLDS,
		};

		// ── MetricCard block ─────────────────────────────────────────────────────
		const metrics: MetricCardBlock['metrics'] = [];

		// Fear & Greed
		if (fearGreed) {
			metrics.push({
				label: 'Fear & Greed Index',
				value: `${fearGreed.value}/100`,
				change: fearGreed.label,
				direction: fearGreed.value >= 55 ? 'up' : fearGreed.value <= 45 ? 'down' : 'neutral',
			});
			if (fearGreed.yesterday !== null) {
				const delta = fearGreed.value - fearGreed.yesterday;
				metrics.push({
					label: 'F&G vs Yesterday',
					value: `${fearGreed.yesterday}/100`,
					change: `${delta >= 0 ? '+' : ''}${delta}`,
					direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral',
				});
			}
		}

		// Funding rates
		for (const fr of fundingRates) {
			metrics.push({
				label: `${fr.symbol} Funding (ann.)`,
				value: `${fr.rate >= 0 ? '+' : ''}${fr.rate.toFixed(2)}% p.a.`,
				change: `${(fr.rawRate * 100).toFixed(4)}% / 8h`,
				direction: fr.rawRate > 0.0001 ? 'up' : fr.rawRate < -0.0001 ? 'down' : 'neutral',
			});
		}

		// Long/short ratios
		for (const ls of longShort) {
			metrics.push({
				label: `${ls.symbol} Long/Short`,
				value: `${ls.longPct}% / ${ls.shortPct}%`,
				change: ls.longPct > 55 ? 'Long heavy' : ls.longPct < 45 ? 'Short heavy' : 'Balanced',
				direction: ls.longPct > 55 ? 'up' : ls.longPct < 45 ? 'down' : 'neutral',
			});
		}

		// Composite
		metrics.push({
			label: 'Composite Sentiment',
			value: `${compositeScore}/100`,
			change: compositeLabel,
			direction: compositeScore >= 55 ? 'up' : compositeScore <= 45 ? 'down' : 'neutral',
		});

		const metricBlock: MetricCardBlock = {
			type: 'metric_card',
			title: `Sentiment Breakdown — ${new Date().toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} UTC`,
			metrics,
		};

		// ── Text summary ─────────────────────────────────────────────────────────
		const summaryParts: string[] = [];
		if (fearGreed) summaryParts.push(`Fear & Greed: ${fearGreed.value}/100 (${fearGreed.label})`);
		for (const fr of fundingRates) {
			summaryParts.push(`${fr.symbol} funding: ${fr.rate >= 0 ? '+' : ''}${fr.rate.toFixed(2)}% p.a.`);
		}
		for (const ls of longShort) {
			summaryParts.push(`${ls.symbol} longs: ${ls.longPct}%`);
		}
		summaryParts.push(`Composite: ${compositeScore}/100 (${compositeLabel})`);

		const result: ToolResult = {
			success: true,
			contentBlocks: [gaugeBlock, metricBlock],
			textSummary: summaryParts.join('. '),
			sources: [
				{ name: 'Alternative.me Fear & Greed', url: 'https://alternative.me/crypto/fear-and-greed-index/', accessedAt: Date.now() },
				{ name: 'Binance Futures API', url: 'https://fapi.binance.com', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 5 * 60_000);
		return result;
	},
});
