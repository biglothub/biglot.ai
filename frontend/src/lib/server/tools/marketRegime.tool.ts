// Market Regime Detection Tool — T-604
// Tool: detect_market_regime
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { analyzeRegime, regimeLabel } from '../indicators/regime';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';
import type { GaugeBlock, MetricCardBlock } from '$lib/types/contentBlock';

// ─── Gauge thresholds ─────────────────────────────────────────────────────────

const GAUGE_THRESHOLDS: GaugeBlock['thresholds'] = [
	{ value: 20,  color: '#6366f1', label: 'Dead Ranging'  },
	{ value: 40,  color: '#8b5cf6', label: 'Weak Trend'    },
	{ value: 60,  color: '#eab308', label: 'Moderate Trend'},
	{ value: 80,  color: '#f97316', label: 'Strong Trend'  },
	{ value: 100, color: '#22c55e', label: 'Extreme Trend' },
];

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'detect_market_regime',
	description:
		'Classify the current market regime for a trading symbol: trending_up, trending_down, ranging, or high_volatility. Uses ADX (trend strength), +DI/-DI direction, ATR/price ratio (volatility), and RSI. Returns a regime gauge and per-indicator metric cards. Use when user asks about market conditions, whether to trend-follow or mean-revert, or overall market state.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading pair symbol (e.g. BTCUSDT, ETHUSDT, AAPL). Default: BTCUSDT',
			},
			interval: {
				type: 'string',
				description: 'Timeframe: 1h, 4h, 1d (default: 1d)',
			},
			limit: {
				type: 'number',
				description: 'Number of candles to analyze (default: 100, min: 50, max: 300)',
			},
		},
		required: [],
	},
	timeout: 25_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol   = typeof args.symbol   === 'string' && args.symbol   ? args.symbol.toUpperCase()   : 'BTCUSDT';
		const interval = typeof args.interval === 'string' && args.interval ? args.interval                : '1d';
		const limit    = Math.min(300, Math.max(50, typeof args.limit === 'number' ? args.limit : 100));

		const cacheKey = toolCache.generateKey('detect_market_regime', { symbol, interval, limit });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// Fetch OHLCV
		const fetchResult = await fetchBinanceOHLCV(symbol, interval, limit);
		if ('error' in fetchResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch data for ${symbol}: ${fetchResult.error}`, tool: 'detect_market_regime' }],
				textSummary: `Error: could not fetch OHLCV for ${symbol}.`,
			};
		}

		const analysis = analyzeRegime(fetchResult.ohlcv);
		if (!analysis) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Insufficient data for regime analysis (need ≥40 candles, got ${fetchResult.ohlcv.length}).`, tool: 'detect_market_regime' }],
				textSummary: `Error: insufficient data for ${symbol}.`,
			};
		}

		const label = regimeLabel(analysis.regime);

		// ── Regime gauge ──────────────────────────────────────────────────────
		const gaugeBlock: GaugeBlock = {
			type:       'gauge',
			title:      `Market Regime — ${symbol} (${interval})`,
			value:      analysis.gaugeValue,
			label:      `${label} (${analysis.confidence}% confidence)`,
			thresholds: GAUGE_THRESHOLDS,
		};

		// ── Per-indicator metric card ─────────────────────────────────────────
		const trendDir  = analysis.plusDI >= analysis.minusDI ? 'up' : 'down';
		const regimeDir: 'up' | 'down' | 'neutral' =
			analysis.regime === 'trending_up'   ? 'up'      :
			analysis.regime === 'trending_down' ? 'down'    : 'neutral';

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Indicators — ${symbol}`,
			metrics: [
				{
					label:     'Regime',
					value:     label,
					change:    `${analysis.confidence}% confidence`,
					direction: regimeDir,
				},
				{
					label:     'ADX (Trend Strength)',
					value:     analysis.adxValue.toFixed(1),
					change:    analysis.adxValue >= 25 ? '≥25 → trending' : '<25 → ranging',
					direction: analysis.adxValue >= 25 ? 'up' : 'neutral',
				},
				{
					label:     '+DI / −DI',
					value:     `${analysis.plusDI.toFixed(1)} / ${analysis.minusDI.toFixed(1)}`,
					change:    analysis.plusDI >= analysis.minusDI ? '+DI dominant (bullish)' : '−DI dominant (bearish)',
					direction: trendDir,
				},
				{
					label:     'ATR / Price',
					value:     `${analysis.atrRatio.toFixed(2)}%`,
					change:    analysis.atrRatio > 3 ? '>3% high volatility' : '≤3% normal range',
					direction: analysis.atrRatio > 3 ? 'down' : 'neutral',
				},
				{
					label:     'RSI',
					value:     analysis.rsiValue.toFixed(0),
					change:    analysis.rsiValue > 65 ? 'Overbought' : analysis.rsiValue < 35 ? 'Oversold' : 'Neutral',
					direction: analysis.rsiValue > 65 ? 'up' : analysis.rsiValue < 35 ? 'down' : 'neutral',
				},
			],
		};

		const result: ToolResult = {
			success:       true,
			contentBlocks: [gaugeBlock, metricBlock],
			textSummary:   `${symbol} (${interval}): ${label} regime (${analysis.confidence}% confidence). ${analysis.description}`,
			sources: [
				{ name: 'Binance OHLCV', url: `https://api.binance.com`, accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 5 * 60_000); // 5 min cache
		return result;
	},
});
