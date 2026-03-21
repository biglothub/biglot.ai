// Derivatives Data Tool — get_derivatives_data
// Sources: Binance Futures (OI, funding, liquidations, L/S ratios), Deribit (options)
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	fetchDerivativesSnapshot,
	annualiseFundingRate,
	classifyFunding,
	formatUSD,
} from '../data/derivatives.data';

registerTool({
	name: 'get_derivatives_data',
	description:
		'Fetch crypto derivatives data: open interest, funding rates, long/short ratios, liquidations, and BTC options (put/call ratio, max pain) from Binance Futures and Deribit. Use when user asks about derivatives, open interest, OI, funding rates, liquidations, options, max pain, put/call ratio.',
	parameters: {
		type: 'object',
		properties: {
			symbols: {
				type: 'string',
				description: 'Comma-separated Binance USDT-perp symbols (default: BTCUSDT,ETHUSDT)'
			}
		},
		required: []
	},
	timeout: 25_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbols = typeof args.symbols === 'string' ? args.symbols : 'BTCUSDT,ETHUSDT';
		const symbols = rawSymbols
			.split(',')
			.map(s => s.trim().toUpperCase())
			.filter(Boolean)
			.slice(0, 5); // cap at 5 symbols

		const cacheKey = toolCache.generateKey('get_derivatives_data', { symbols });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const snap = await fetchDerivativesSnapshot(symbols);

		if (
			snap.fundingRates.length === 0 &&
			snap.openInterest.length === 0 &&
			snap.longShortRatios.length === 0
		) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Failed to fetch derivatives data.', tool: 'get_derivatives_data' }],
				textSummary: 'Error: Could not fetch derivatives data.'
			};
		}

		const contentBlocks: ToolResult['contentBlocks'] = [];
		const summaryParts: string[] = [];

		// ─── MetricCard: funding + OI ─────────────────────────────────────────
		const metrics: { label: string; value: string; change?: string; direction?: 'up' | 'down' | 'neutral' }[] = [];

		for (const fr of snap.fundingRates) {
			const ann = annualiseFundingRate(fr.rate);
			const dir: 'up' | 'down' | 'neutral' = ann > 10 ? 'up' : ann < -10 ? 'down' : 'neutral';
			metrics.push({
				label: `${fr.symbol} Funding (ann.)`,
				value: `${ann >= 0 ? '+' : ''}${ann.toFixed(1)}% — ${classifyFunding(ann)}`,
				direction: dir
			});
			summaryParts.push(`${fr.symbol} funding: ${ann.toFixed(1)}%`);
		}

		for (const oi of snap.openInterest) {
			metrics.push({
				label: `${oi.symbol} Open Interest`,
				value: formatUSD(oi.openInterestUSD),
				direction: 'neutral'
			});
			summaryParts.push(`${oi.symbol} OI: ${formatUSD(oi.openInterestUSD)}`);
		}

		for (const ls of snap.longShortRatios) {
			const longPct = (ls.longPct * 100).toFixed(1);
			const shortPct = (ls.shortPct * 100).toFixed(1);
			const dir: 'up' | 'down' | 'neutral' =
				ls.longPct > 0.55 ? 'up' : ls.longPct < 0.45 ? 'down' : 'neutral';
			metrics.push({
				label: `${ls.symbol} Long/Short`,
				value: `${longPct}% / ${shortPct}%`,
				direction: dir
			});
			summaryParts.push(`${ls.symbol} L/S: ${longPct}%/${shortPct}%`);
		}

		for (const liq of snap.liquidations) {
			if (liq.longLiqUSD > 0 || liq.shortLiqUSD > 0) {
				metrics.push({
					label: `${liq.symbol} Liq 24h`,
					value: `Longs ${formatUSD(liq.longLiqUSD)} / Shorts ${formatUSD(liq.shortLiqUSD)}`,
					direction: 'neutral'
				});
			}
		}

		contentBlocks.push({
			type: 'metric_card',
			title: `Derivatives — ${new Date().toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC`,
			metrics
		});

		// ─── Options table (BTC only) ─────────────────────────────────────────
		if (snap.options) {
			const { maxPain, putCallRatio, totalCallOI, totalPutOI } = snap.options;

			const rows: (string | number)[][] = [
				['Max Pain Strike', maxPain !== null ? `$${maxPain.toLocaleString()}` : 'N/A'],
				['Put/Call Ratio', putCallRatio !== null ? putCallRatio.toFixed(3) : 'N/A'],
				['Total Call OI', totalCallOI.toLocaleString()],
				['Total Put OI', totalPutOI.toLocaleString()],
			];

			contentBlocks.push({
				type: 'table',
				title: 'BTC Options (Deribit)',
				headers: ['Metric', 'Value'],
				rows
			});

			if (maxPain !== null) summaryParts.push(`BTC max pain: $${maxPain.toLocaleString()}`);
			if (putCallRatio !== null) summaryParts.push(`P/C ratio: ${putCallRatio.toFixed(3)}`);
		}

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Derivatives: ${summaryParts.join(', ')}.`,
			sources: [
				{ name: 'Binance Futures API', url: 'https://fapi.binance.com', accessedAt: Date.now() },
				...(snap.options ? [{ name: 'Deribit API', url: 'https://www.deribit.com', accessedAt: Date.now() }] : [])
			]
		};

		toolCache.set(cacheKey, result, 300_000); // 5 min cache
		return result;
	}
});
