// Liquidation Heatmap Tool — T-1206
// get_liquidation_heatmap: estimate liquidation clusters by leverage tier

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	fetchLiquidationHeatmap,
	LEVERAGE_TIERS,
	type LiquidationCluster,
} from '../data/liquidationHeatmap.data';
import { formatUSD } from '../data/derivatives.data';
import { normalizeBinanceSymbol } from '../data/ohlcvProvider';

function formatPrice(price: number): string {
	if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
	if (price >= 1) return `$${price.toFixed(2)}`;
	return `$${price.toFixed(4)}`;
}

function buildInterpretation(data: {
	symbol: string;
	currentPrice: number;
	nearestLongCluster: LiquidationCluster | null;
	nearestShortCluster: LiquidationCluster | null;
	magneticLevels: { price: number; totalVolumeUSD: number }[];
	fundingRate: number;
	longPct: number;
	shortPct: number;
	openInterestUSD: number;
}): string {
	const {
		symbol, currentPrice, nearestLongCluster, nearestShortCluster,
		magneticLevels, fundingRate, longPct, shortPct, openInterestUSD,
	} = data;

	const sym = symbol.replace(/USDT$/i, '');
	const fundingAnnualised = fundingRate * 3 * 365 * 100;
	const fundingSentiment =
		fundingAnnualised > 30  ? 'bullish (longs paying shorts)' :
		fundingAnnualised < -10 ? 'bearish (shorts paying longs)' :
		'neutral';

	const dominantSide = longPct > shortPct ? 'longs' : 'shorts';
	const dominantPct = (Math.max(longPct, shortPct) * 100).toFixed(0);

	const lines: string[] = [
		`## Liquidation Heatmap — ${sym}`,
		'',
		`**Current Price**: ${formatPrice(currentPrice)} | **Open Interest**: ${formatUSD(openInterestUSD)}`,
		`**Positioning**: ${dominantPct}% ${dominantSide} | **Funding**: ${fundingAnnualised >= 0 ? '+' : ''}${fundingAnnualised.toFixed(1)}% ann. (${fundingSentiment})`,
		'',
		'### Nearest Liquidation Clusters',
	];

	if (nearestLongCluster) {
		lines.push(
			`- **Nearest Long Liq** (${nearestLongCluster.leverageTier}x): ${formatPrice(nearestLongCluster.priceLevel)} ` +
			`(${nearestLongCluster.distancePct.toFixed(1)}% below) — est. ${formatUSD(nearestLongCluster.estimatedVolumeUSD)} at risk`,
		);
	}
	if (nearestShortCluster) {
		lines.push(
			`- **Nearest Short Liq** (${nearestShortCluster.leverageTier}x): ${formatPrice(nearestShortCluster.priceLevel)} ` +
			`(+${nearestShortCluster.distancePct.toFixed(1)}% above) — est. ${formatUSD(nearestShortCluster.estimatedVolumeUSD)} at risk`,
		);
	}

	if (magneticLevels.length > 0) {
		lines.push('', '### Magnetic Price Levels (Highest Liquidation Concentration)');
		for (const ml of magneticLevels) {
			const dist = ((ml.price - currentPrice) / currentPrice) * 100;
			lines.push(
				`- **${formatPrice(ml.price)}** — ${dist >= 0 ? '+' : ''}${dist.toFixed(1)}% from current`,
			);
		}
	}

	lines.push(
		'',
		'### How to Read the Heatmap',
		'- **Red cells** = long liquidation zones (below current price) — if price drops here, longs get margin-called, adding selling pressure',
		'- **Green cells** = short liquidation zones (above current price) — if price rises here, shorts get squeezed, adding buying pressure',
		'- **Intensity** = estimated liquidation volume relative to maximum cluster',
		'',
		'> ⚠️ These are **estimated** levels based on aggregate OI and an assumed leverage distribution (5x: 30%, 10x: 25%, 25x: 20%, 50x: 15%, 100x: 10%). ' +
		'Actual liquidation prices depend on each trader\'s individual margin. Use as a directional guide only.',
	);

	return lines.join('\n');
}

registerTool({
	name: 'get_liquidation_heatmap',
	description:
		'Estimate liquidation clusters by leverage tier (5x, 10x, 25x, 50x, 100x) from open interest distribution and funding rate direction. ' +
		'Projects long and short liquidation price levels above and below current price. Identifies "magnetic" price levels with highest liquidation concentration. ' +
		'Use when the user asks about liquidation levels, margin calls, leverage risk, cascade risk, or which price levels could trigger forced liquidations.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Futures symbol to analyze (e.g. "BTC", "ETH", "SOL"). Defaults to BTC.',
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbol =
			typeof args.symbol === 'string' && args.symbol.trim()
				? args.symbol.trim()
				: 'BTC';
		const symbol = normalizeBinanceSymbol(rawSymbol);

		const cacheKey = toolCache.generateKey('get_liquidation_heatmap', { symbol });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		let data;
		try {
			data = await fetchLiquidationHeatmap(symbol);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : `Failed to fetch liquidation data for ${symbol}`;
			return {
				success: false,
				contentBlocks: [{ type: 'error', message, tool: 'get_liquidation_heatmap' }],
				textSummary: `Error: ${message}`,
			};
		}

		const {
			currentPrice, openInterestUSD, nearestLongCluster, nearestShortCluster,
			magneticLevels, fundingRate, longPct, shortPct, priceBuckets, heatmapData,
		} = data;

		// Heatmap rows: HIGH → LOW price (price-chart convention)
		const reversedBuckets = [...priceBuckets].reverse();
		const reversedData = [...heatmapData].reverse();

		const priceLabels = reversedBuckets.map(p => formatPrice(p));
		const leverageLabels = LEVERAGE_TIERS.map(t => `${t}x`);
		const fundingAnnualised = fundingRate * 3 * 365 * 100;

		const result: ToolResult = {
			success: true,
			contentBlocks: [
				{
					type: 'metric_card',
					title: 'Liquidation Heatmap',
					metrics: [
						{
							label: 'Nearest Long Liq',
							value: nearestLongCluster
								? formatPrice(nearestLongCluster.priceLevel)
								: 'N/A',
							change: nearestLongCluster
								? `${nearestLongCluster.distancePct.toFixed(1)}% below (${nearestLongCluster.leverageTier}x)`
								: undefined,
							direction: 'down',
						},
						{
							label: 'Nearest Short Liq',
							value: nearestShortCluster
								? formatPrice(nearestShortCluster.priceLevel)
								: 'N/A',
							change: nearestShortCluster
								? `+${nearestShortCluster.distancePct.toFixed(1)}% above (${nearestShortCluster.leverageTier}x)`
								: undefined,
							direction: 'up',
						},
						{
							label: 'Open Interest',
							value: formatUSD(openInterestUSD),
							direction: 'neutral',
						},
						{
							label: 'Funding Rate',
							value: `${(fundingRate * 100).toFixed(4)}%`,
							change: `${fundingAnnualised >= 0 ? '+' : ''}${fundingAnnualised.toFixed(1)}% ann.`,
							direction:
								fundingAnnualised > 10  ? 'up' :
								fundingAnnualised < -5  ? 'down' :
								'neutral',
						},
					],
				},
				{
					type: 'heatmap',
					title: `${symbol.replace(/USDT$/i, '')} Liquidation Heatmap — Red=Long Liq ↓ | Green=Short Liq ↑`,
					assets: leverageLabels,
					timeframes: priceLabels,
					data: reversedData,
					colorScale: 'redgreen',
				},
				{
					type: 'text',
					content: buildInterpretation({
						symbol,
						currentPrice,
						nearestLongCluster,
						nearestShortCluster,
						magneticLevels,
						fundingRate,
						longPct,
						shortPct,
						openInterestUSD,
					}),
				},
			],
			textSummary:
				`Liquidation heatmap for ${symbol.replace(/USDT$/i, '')}. ` +
				`Price: ${formatPrice(currentPrice)}. OI: ${formatUSD(openInterestUSD)}. ` +
				(nearestLongCluster
					? `Nearest long liq: ${formatPrice(nearestLongCluster.priceLevel)} (${nearestLongCluster.distancePct.toFixed(1)}% below, ${nearestLongCluster.leverageTier}x). `
					: '') +
				(nearestShortCluster
					? `Nearest short liq: ${formatPrice(nearestShortCluster.priceLevel)} (+${nearestShortCluster.distancePct.toFixed(1)}% above, ${nearestShortCluster.leverageTier}x). `
					: '') +
				`Funding: ${(fundingRate * 100).toFixed(4)}% (${fundingAnnualised.toFixed(1)}% ann.). ` +
				(magneticLevels.length > 0
					? `Magnetic levels: ${magneticLevels.map(m => formatPrice(m.price)).join(', ')}.`
					: ''),
			sources: [
				{ name: 'Binance Futures API', url: 'https://fapi.binance.com', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 5 * 60_000); // 5-minute cache
		return result;
	},
});
