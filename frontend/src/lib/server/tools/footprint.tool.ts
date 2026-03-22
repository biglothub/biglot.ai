// Footprint Chart Tool — T-1207
// get_footprint_data: aggregate Binance aggTrades into footprint chart with tape reading analysis

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	fetchFootprintData,
	classifyDominantSide,
} from '../data/footprint.data';
import { normalizeBinanceSymbol } from '../data/ohlcvProvider';

function formatVol(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
	return n.toFixed(4);
}

function formatPrice(price: number): string {
	if (price >= 10_000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
	if (price >= 1) return `$${price.toFixed(2)}`;
	return `$${price.toFixed(6)}`;
}

registerTool({
	name: 'get_footprint_data',
	description:
		'Aggregate Binance trade data into a footprint chart showing bid/ask volume per price level per candle, ' +
		'cumulative volume delta (CVD), absorption detection (large opposing orders that don\'t move price), ' +
		'and buyer/seller imbalance zones. Use when the user asks about footprint charts, tape reading, ' +
		'order flow at price levels, volume delta, CVD, absorption events, or microstructure analysis.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading symbol e.g. "BTC", "ETH", "BTCUSDT". Defaults to BTC.',
			},
		},
		required: [],
	},
	timeout: 20_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbol =
			typeof args.symbol === 'string' && args.symbol.trim()
				? args.symbol.trim()
				: 'BTC';
		const symbol = normalizeBinanceSymbol(rawSymbol);

		const cacheKey = toolCache.generateKey('get_footprint_data', { symbol });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const data = await fetchFootprintData(symbol);

		if (data.error || data.candles.length === 0) {
			const msg = data.error ?? `No footprint data available for ${symbol}`;
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: msg, tool: 'get_footprint_data' }],
				textSummary: `Error: ${msg}`,
			};
		}

		const {
			cvd,
			totalBuyVolume,
			totalSellVolume,
			buyPressurePct,
			dominantSide,
			absorptionEvents,
			imbalanceZones,
			candles,
		} = data;

		const latestCandle = candles[candles.length - 1];
		const totalVolume = totalBuyVolume + totalSellVolume;
		const domLabel =
			dominantSide === 'buy' ? 'Buyers in Control' :
			dominantSide === 'sell' ? 'Sellers in Control' :
			'Balanced Market';

		// ── MetricCard ────────────────────────────────────────────────────────────
		const metricCard: ToolResult['contentBlocks'][number] = {
			type: 'metric_card',
			title: `Footprint Chart — ${symbol.replace(/USDT$/i, '')}`,
			metrics: [
				{
					label: 'Net Delta (CVD)',
					value: `${cvd >= 0 ? '+' : ''}${formatVol(cvd)}`,
					direction: cvd > 0 ? 'up' : cvd < 0 ? 'down' : 'neutral',
				},
				{
					label: 'Dominant Side',
					value: dominantSide === 'buy' ? 'Buyers' : dominantSide === 'sell' ? 'Sellers' : 'Balanced',
					direction: dominantSide === 'buy' ? 'up' : dominantSide === 'sell' ? 'down' : 'neutral',
				},
				{
					label: 'Buy Pressure',
					value: `${buyPressurePct.toFixed(1)}%`,
					direction: buyPressurePct >= 55 ? 'up' : buyPressurePct <= 45 ? 'down' : 'neutral',
				},
				{
					label: 'Absorption Events',
					value: absorptionEvents.length.toString(),
					direction: 'neutral',
				},
				{
					label: 'Total Volume',
					value: formatVol(totalVolume),
					direction: 'neutral',
				},
				{
					label: 'Candles (1-min)',
					value: candles.length.toString(),
					direction: 'neutral',
				},
			],
		};

		// ── TableBlock: latest candle footprint ────────────────────────────────
		const levelsToShow = latestCandle.levels.slice(0, 20); // top 20 price levels (high → low)
		const tableRows: (string | number)[][] = levelsToShow.map(l => [
			formatPrice(l.price),
			formatVol(l.bidVolume),
			formatVol(l.askVolume),
			`${l.delta >= 0 ? '+' : ''}${formatVol(l.delta)}`,
			`${l.imbalancePct.toFixed(0)}%`,
		]);

		const candleTimeStr = new Date(latestCandle.time * 1000).toISOString().slice(11, 16);
		const tableBlock: ToolResult['contentBlocks'][number] = {
			type: 'table',
			title: `Latest 1-min Candle Footprint (${candleTimeStr} UTC) — Net Delta: ${latestCandle.netDelta >= 0 ? '+' : ''}${formatVol(latestCandle.netDelta)}`,
			headers: ['Price', 'Bid Vol (Sell)', 'Ask Vol (Buy)', 'Delta', 'Imbalance'],
			rows: tableRows,
		};

		// ── GaugeBlock: buy/sell pressure ────────────────────────────────────────
		const gaugeBlock: ToolResult['contentBlocks'][number] = {
			type: 'gauge',
			title: 'Buy / Sell Pressure',
			value: Math.round(buyPressurePct),
			label: domLabel,
			thresholds: [
				{ value: 0,  color: '#ef4444', label: 'Heavy Selling'   },
				{ value: 35, color: '#f97316', label: 'Moderate Selling' },
				{ value: 45, color: '#eab308', label: 'Balanced'         },
				{ value: 55, color: '#22c55e', label: 'Moderate Buying'  },
				{ value: 70, color: '#16a34a', label: 'Heavy Buying'     },
			],
		};

		const contentBlocks: ToolResult['contentBlocks'] = [metricCard, tableBlock, gaugeBlock];

		// ── Absorption events (if any) ────────────────────────────────────────────
		if (absorptionEvents.length > 0) {
			const recent = absorptionEvents.slice(-3);
			const absLines = recent.map(e => `- ${e.description}`).join('\n');
			contentBlocks.push({
				type: 'text',
				content: `### Absorption Events Detected (${absorptionEvents.length} total)\n${absLines}`,
			});
		}

		// ── Imbalance zones (if any) ──────────────────────────────────────────────
		if (imbalanceZones.length > 0) {
			const zoneRows: (string | number)[][] = imbalanceZones.map(z => [
				formatPrice(z.priceFrom),
				formatPrice(z.priceTo),
				z.side === 'buy' ? 'Buy Imbalance' : 'Sell Imbalance',
				`${z.avgImbalancePct.toFixed(0)}%`,
			]);
			contentBlocks.push({
				type: 'table',
				title: 'Imbalance Zones (Latest Candle)',
				headers: ['Price From', 'Price To', 'Type', 'Avg Imbalance'],
				rows: zoneRows,
			});
		}

		const sym = symbol.replace(/USDT$/i, '');
		const textSummary =
			`Footprint for ${sym}: CVD ${cvd >= 0 ? '+' : ''}${formatVol(cvd)}, ` +
			`buy pressure ${buyPressurePct.toFixed(1)}% (${domLabel}), ` +
			`${absorptionEvents.length} absorption event(s), ${imbalanceZones.length} imbalance zone(s). ` +
			`Latest candle delta: ${latestCandle.netDelta >= 0 ? '+' : ''}${formatVol(latestCandle.netDelta)} ` +
			`over ${candles.length} 1-min candles. Total volume: ${formatVol(totalVolume)}.`;

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
			sources: [
				{ name: 'Binance Futures/Spot aggTrades API', url: 'https://api.binance.com', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 30_000); // 30s cache for live data
		return result;
	},
});
