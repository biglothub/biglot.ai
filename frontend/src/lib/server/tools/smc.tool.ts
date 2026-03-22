// Smart Money Concepts Tool — T-601
// Tool: analyze_smc
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { buildSMCAnalysis } from '../indicators/smc';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';

function fmt(price: number): string {
	if (price >= 1000) return price.toFixed(2);
	if (price >= 1) return price.toFixed(4);
	return price.toFixed(6);
}

function biasLabel(bias: 'bullish' | 'bearish' | 'neutral', score: number): string {
	const abs = Math.abs(score);
	const strength = abs >= 70 ? 'Strong' : abs >= 40 ? 'Moderate' : 'Weak';
	return `${strength} ${bias.charAt(0).toUpperCase() + bias.slice(1)}`;
}

registerTool({
	name: 'analyze_smc',
	description:
		'Analyse a symbol using Smart Money Concepts (SMC): Order Blocks (institutional demand/supply zones), Fair Value Gaps (price imbalances), Break of Structure (BOS), Change of Character (CHOCH), and Liquidity Zones (equal highs/lows). Computes overall institutional bias. Use when user asks about smart money, order blocks, FVG, ICT concepts, institutional levels, or market structure.',
	parameters: {
		type: 'object',
		properties: {
			symbol: { type: 'string', description: 'Trading symbol (e.g. BTCUSDT, ETHUSDT, SOLUSDT)' },
			interval: {
				type: 'string',
				enum: ['1d', '4h', '1h', '15m'],
				description: 'Candle interval (default: 4h)'
			},
			limit: {
				type: 'number',
				description: 'Number of candles to analyse (default: 200, max: 500)'
			},
		},
		required: ['symbol'],
	},
	timeout: 25_000,
	execute: async (args): Promise<ToolResult> => {
		if (!args.symbol) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'symbol is required.', tool: 'analyze_smc' }],
				textSummary: 'Error: symbol required.'
			};
		}

		const symbol = String(args.symbol).toUpperCase();
		const interval = ['1d', '4h', '1h', '15m'].includes(String(args.interval))
			? String(args.interval)
			: '4h';
		const limit = Math.min(500, typeof args.limit === 'number' && args.limit > 0 ? args.limit : 200);

		const cacheKey = toolCache.generateKey('analyze_smc', { symbol, interval, limit });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const ohlcvResult = await fetchBinanceOHLCV(symbol, interval, limit);
		if ('error' in ohlcvResult) {
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message: `Failed to fetch data for ${symbol}: ${ohlcvResult.error}`,
					tool: 'analyze_smc'
				}],
				textSummary: `Error: ${ohlcvResult.error}`
			};
		}

		const { ohlcv } = ohlcvResult;
		const smc = buildSMCAnalysis(ohlcv);
		const currentPrice = ohlcv[ohlcv.length - 1].close;

		const contentBlocks: ToolResult['contentBlocks'] = [];

		// ── Bias overview ──────────────────────────────────────────────────────
		const unmitigatedDemand = smc.orderBlocks.filter(ob => !ob.mitigated && ob.type === 'bullish').length;
		const unmitigatedSupply = smc.orderBlocks.filter(ob => !ob.mitigated && ob.type === 'bearish').length;
		const activeFVGs = smc.fairValueGaps.filter(g => !g.filled).length;
		const unsweptBSL = smc.liquidityZones.filter(z => z.type === 'BSL' && !z.swept).length;
		const unsweptSSL = smc.liquidityZones.filter(z => z.type === 'SSL' && !z.swept).length;

		const lastBreak = smc.structureBreaks.length > 0
			? smc.structureBreaks[smc.structureBreaks.length - 1]
			: null;

		contentBlocks.push({
			type: 'metric_card',
			title: `SMC Analysis — ${symbol} (${interval})`,
			metrics: [
				{
					label: 'Market Bias',
					value: biasLabel(smc.currentBias, smc.biasScore),
					direction: smc.currentBias === 'bullish' ? 'up' : smc.currentBias === 'bearish' ? 'down' : 'neutral',
				},
				{
					label: 'Bias Score',
					value: `${smc.biasScore > 0 ? '+' : ''}${smc.biasScore}`,
					direction: smc.biasScore > 0 ? 'up' : smc.biasScore < 0 ? 'down' : 'neutral',
				},
				{
					label: 'Last Structure Break',
					value: lastBreak ? `${lastBreak.type} ${lastBreak.direction === 'bullish' ? '▲' : '▼'}` : 'None',
					direction: lastBreak?.direction === 'bullish' ? 'up' : lastBreak?.direction === 'bearish' ? 'down' : 'neutral',
				},
				{
					label: 'Demand OBs (Unmitigated)',
					value: String(unmitigatedDemand),
					direction: unmitigatedDemand > 0 ? 'up' : 'neutral',
				},
				{
					label: 'Supply OBs (Unmitigated)',
					value: String(unmitigatedSupply),
					direction: unmitigatedSupply > 0 ? 'down' : 'neutral',
				},
				{
					label: 'Active FVGs',
					value: String(activeFVGs),
					direction: 'neutral',
				},
				{
					label: 'Unswept BSL',
					value: String(unsweptBSL),
					direction: 'up',
				},
				{
					label: 'Unswept SSL',
					value: String(unsweptSSL),
					direction: 'down',
				},
			],
		});

		// ── Key SMC levels table ───────────────────────────────────────────────
		type LevelRow = { type: string; level: string; detail: string; distance: string };
		const levelRows: LevelRow[] = [];

		// Unmitigated OBs
		for (const ob of smc.orderBlocks.filter(o => !o.mitigated).slice(0, 5)) {
			const dist = currentPrice > 0
				? (((ob.type === 'bullish' ? ob.high : ob.low) - currentPrice) / currentPrice * 100).toFixed(2)
				: '0.00';
			levelRows.push({
				type: ob.type === 'bullish' ? 'Demand OB' : 'Supply OB',
				level: `${fmt(ob.low)} – ${fmt(ob.high)}`,
				detail: `Strength ${(ob.strength * 100).toFixed(0)}%`,
				distance: `${parseFloat(dist) > 0 ? '+' : ''}${dist}%`,
			});
		}

		// Active FVGs (unfilled)
		for (const fvg of smc.fairValueGaps.filter(g => !g.filled).slice(-5)) {
			const dist = currentPrice > 0
				? ((fvg.mid - currentPrice) / currentPrice * 100).toFixed(2)
				: '0.00';
			levelRows.push({
				type: fvg.type === 'bullish' ? 'Bullish FVG' : 'Bearish FVG',
				level: `${fmt(fvg.bottom)} – ${fmt(fvg.top)}`,
				detail: `${fvg.fillPct.toFixed(0)}% filled`,
				distance: `${parseFloat(dist) > 0 ? '+' : ''}${dist}%`,
			});
		}

		// Liquidity zones
		for (const zone of smc.liquidityZones.filter(z => !z.swept).slice(0, 4)) {
			const dist = currentPrice > 0
				? ((zone.price - currentPrice) / currentPrice * 100).toFixed(2)
				: '0.00';
			levelRows.push({
				type: zone.type === 'BSL' ? 'Buy-Side Liq.' : 'Sell-Side Liq.',
				level: fmt(zone.price),
				detail: `${zone.touchCount} touches`,
				distance: `${parseFloat(dist) > 0 ? '+' : ''}${dist}%`,
			});
		}

		// Sort levels by absolute distance from current price
		levelRows.sort((a, b) => Math.abs(parseFloat(a.distance)) - Math.abs(parseFloat(b.distance)));

		if (levelRows.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: `Key SMC Levels — ${symbol} @ ${fmt(currentPrice)}`,
				headers: ['Type', 'Level', 'Detail', 'Distance'],
				rows: levelRows.map(r => [r.type, r.level, r.detail, r.distance]),
			});
		}

		// ── Recent structure breaks table ─────────────────────────────────────
		const recentBreaks = smc.structureBreaks.slice(-8);
		if (recentBreaks.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: 'Market Structure Breaks',
				headers: ['Type', 'Direction', 'Level'],
				rows: recentBreaks.map(b => [
					b.type,
					b.direction === 'bullish' ? '▲ Bullish' : '▼ Bearish',
					fmt(b.level),
				]),
			});
		}

		// ── Text summary ──────────────────────────────────────────────────────
		const fvgSummary = activeFVGs > 0
			? `${activeFVGs} active FVG${activeFVGs > 1 ? 's' : ''}`
			: 'no active FVGs';
		const obSummary = `${unmitigatedDemand} demand / ${unmitigatedSupply} supply OBs unmitigated`;
		const liqSummary = unsweptBSL + unsweptSSL > 0
			? `${unsweptBSL} BSL + ${unsweptSSL} SSL unswept`
			: 'no major liquidity pools detected';

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `SMC for ${symbol} ${interval}: ${biasLabel(smc.currentBias, smc.biasScore)} bias (${smc.biasScore > 0 ? '+' : ''}${smc.biasScore}). ${obSummary}. ${fvgSummary}. ${liqSummary}.`
		};

		toolCache.set(cacheKey, result, 15 * 60_000); // 15 min cache
		return result;
	},
});
