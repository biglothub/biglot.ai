// Order Flow Tool — T-503
// Returns order book depth, CVD, buy/sell pressure for a symbol
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	fetchOrderFlowSnapshot,
	classifyBuyPressure,
} from '../data/orderFlow.data';

registerTool({
	name: 'get_order_flow',
	description:
		'Analyse real-time order flow for a crypto symbol: order book depth, bid/ask walls, cumulative volume delta (CVD), and buy/sell pressure. Use when the user asks about order flow, buying pressure, bid/ask walls, or volume delta.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading symbol e.g. BTCUSDT, ETHUSDT',
			},
		},
		required: ['symbol'],
	},
	timeout: 15_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol = typeof args.symbol === 'string' ? args.symbol.toUpperCase().trim() : '';
		if (!symbol) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'symbol is required.', tool: 'get_order_flow' }],
				textSummary: 'Error: symbol required.',
			};
		}

		const cacheKey = toolCache.generateKey('get_order_flow', { symbol });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const snap = await fetchOrderFlowSnapshot(symbol);

		if (!snap.stats) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch order book for ${symbol}.`, tool: 'get_order_flow' }],
				textSummary: `Error: Failed to fetch order flow for ${symbol}.`,
			};
		}

		const { stats } = snap;
		const pressureLabel = classifyBuyPressure(stats.buyPressure);
		const buySellPct = snap.buySellRatio !== null
			? `${(snap.buySellRatio * 100).toFixed(1)}% buy / ${((1 - snap.buySellRatio) * 100).toFixed(1)}% sell`
			: 'N/A';

		// CVD trend: compare first vs last point
		const cvdTrend = snap.cvdPoints.length >= 2
			? snap.cvdPoints[snap.cvdPoints.length - 1].cvd - snap.cvdPoints[0].cvd
			: 0;
		const cvdLabel = cvdTrend > 0 ? 'Rising (Bullish)' : cvdTrend < 0 ? 'Falling (Bearish)' : 'Flat';

		const metricsBlock: ToolResult['contentBlocks'][number] = {
			type: 'metric_card',
			title: `Order Flow — ${symbol}`,
			metrics: [
				{
					label: 'Best Bid',
					value: `$${stats.bestBid.toFixed(2)}`,
					direction: 'neutral',
				},
				{
					label: 'Best Ask',
					value: `$${stats.bestAsk.toFixed(2)}`,
					direction: 'neutral',
				},
				{
					label: 'Spread',
					value: `$${stats.spread.toFixed(4)} (${stats.spreadPct.toFixed(4)}%)`,
					direction: 'neutral',
				},
				{
					label: 'Buy Pressure',
					value: `${stats.buyPressure.toFixed(1)}% — ${pressureLabel}`,
					direction: stats.buyPressure >= 55 ? 'up' : stats.buyPressure <= 45 ? 'down' : 'neutral',
				},
				{
					label: 'Volume Ratio',
					value: buySellPct,
					direction: (snap.buySellRatio ?? 0.5) >= 0.55 ? 'up' : (snap.buySellRatio ?? 0.5) <= 0.45 ? 'down' : 'neutral',
				},
				{
					label: 'CVD Trend',
					value: `${cvdLabel} (Δ${cvdTrend >= 0 ? '+' : ''}${cvdTrend.toFixed(2)})`,
					direction: cvdTrend > 0 ? 'up' : cvdTrend < 0 ? 'down' : 'neutral',
				},
			],
		};

		const wallRows: string[][] = [];
		if (stats.bidWallPrice !== null && stats.bidWallQty !== null) {
			wallRows.push(['Bid Wall', `$${stats.bidWallPrice.toFixed(2)}`, stats.bidWallQty.toFixed(4), 'Support']);
		}
		if (stats.askWallPrice !== null && stats.askWallQty !== null) {
			wallRows.push(['Ask Wall', `$${stats.askWallPrice.toFixed(2)}`, stats.askWallQty.toFixed(4), 'Resistance']);
		}

		const contentBlocks: ToolResult['contentBlocks'] = [metricsBlock];

		if (wallRows.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: 'Order Book Walls',
				headers: ['Type', 'Price', 'Quantity', 'Role'],
				rows: wallRows,
			});
		}

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Order flow for ${symbol}: bid pressure ${stats.buyPressure.toFixed(1)}% (${pressureLabel}), spread ${stats.spreadPct.toFixed(4)}%, CVD ${cvdLabel}, volume ratio ${buySellPct}.`,
		};

		toolCache.set(cacheKey, result, 30_000); // 30s cache for live data
		return result;
	},
});
