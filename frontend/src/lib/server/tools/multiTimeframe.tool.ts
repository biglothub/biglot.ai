// Multi-Timeframe Analysis Tool — T-502
// Tool: multi_timeframe_analysis
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { buildMTFAnalysis } from '../indicators/multiTF';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';
import type { OHLCV } from '$lib/types/contentBlock';

const TIMEFRAMES = ['1d', '4h', '1h', '15m'] as const;

function trendEmoji(trend: string): string {
	if (trend === 'bullish') return '▲';
	if (trend === 'bearish') return '▼';
	return '—';
}

registerTool({
	name: 'multi_timeframe_analysis',
	description:
		'Analyse a symbol across 1D, 4H, 1H, and 15M simultaneously. Shows trend alignment, RSI per timeframe, MACD bias, key support/resistance levels, and confluence zones. Returns a HeatmapBlock showing alignment. Use when user asks about multi-timeframe analysis, trend confirmation, or whether timeframes are aligned.',
	parameters: {
		type: 'object',
		properties: {
			symbol: { type: 'string', description: 'Trading symbol (e.g. BTCUSDT, ETHUSDT)' },
			timeframes: {
				type: 'string',
				description: 'Comma-separated timeframes to analyse (default: "1d,4h,1h,15m")'
			},
		},
		required: ['symbol']
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		if (!args.symbol) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'symbol is required.', tool: 'multi_timeframe_analysis' }],
				textSummary: 'Error: symbol required.'
			};
		}

		const symbol = String(args.symbol).toUpperCase();
		const requestedTFs = typeof args.timeframes === 'string'
			? args.timeframes.split(',').map(s => s.trim()).filter(tf => TIMEFRAMES.includes(tf as never))
			: [...TIMEFRAMES];

		const tfs = requestedTFs.length > 0 ? requestedTFs : [...TIMEFRAMES];

		const cacheKey = toolCache.generateKey('multi_timeframe_analysis', { symbol, tfs });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// Fetch all timeframes in parallel
		const fetched = await Promise.all(
			tfs.map(async (tf) => {
				const result = await fetchBinanceOHLCV(symbol, tf, 100);
				if ('error' in result) return null;
				return result.ohlcv;
			})
		);

		const ohlcvByTF = new Map<string, OHLCV[]>();
		for (let i = 0; i < tfs.length; i++) {
			if (fetched[i]) ohlcvByTF.set(tfs[i], fetched[i]!);
		}

		if (ohlcvByTF.size === 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `No data fetched for ${symbol}.`, tool: 'multi_timeframe_analysis' }],
				textSummary: `Error: No data for ${symbol}.`
			};
		}

		const analysis = buildMTFAnalysis(symbol, ohlcvByTF);

		// HeatmapBlock: rows = metrics, columns = timeframes
		// Values encoded as scores (-2 to +2) → displayed as heatmap
		const tfLabels = analysis.timeframes.map(t => t.timeframe.toUpperCase());
		const metrics = ['Trend', 'RSI', 'MACD', 'Score'];

		// Heatmap: data[row][col] where row=metric, col=timeframe
		// Normalised to percentage for color scale
		const heatmapData: number[][] = [
			// Trend: bullish=1, neutral=0.5, bearish=0
			analysis.timeframes.map(t => t.trend === 'bullish' ? 100 : t.trend === 'bearish' ? 0 : 50),
			// RSI: raw value (already 0-100)
			analysis.timeframes.map(t => t.rsi ?? 50),
			// MACD: bullish=75, neutral=50, bearish=25
			analysis.timeframes.map(t => t.macdSignal === 'bullish' ? 75 : t.macdSignal === 'bearish' ? 25 : 50),
			// Score: map -2..+2 → 0..100
			analysis.timeframes.map(t => (t.score + 2) / 4 * 100),
		];

		const contentBlocks: ToolResult['contentBlocks'] = [];

		// Heatmap
		contentBlocks.push({
			type: 'heatmap',
			title: `${symbol} — Multi-Timeframe Alignment`,
			assets: tfLabels,
			timeframes: metrics,
			data: heatmapData,
			colorScale: 'redgreen',
		});

		// Summary metric card
		contentBlocks.push({
			type: 'metric_card',
			title: `MTF Summary — ${symbol}`,
			metrics: [
				{
					label: 'Overall Bias',
					value: `${analysis.overallAlignment.toUpperCase()} ${trendEmoji(analysis.overallAlignment)}`,
					direction: analysis.overallAlignment === 'bullish' ? 'up' : analysis.overallAlignment === 'bearish' ? 'down' : 'neutral'
				},
				{
					label: 'TF Confluence',
					value: `${(analysis.confluenceScore * 100).toFixed(0)}%`,
					direction: analysis.confluenceScore >= 0.75 ? 'up' : 'neutral'
				},
				{
					label: 'Bullish TFs',
					value: analysis.bullishTFs.join(', ') || 'None',
					direction: 'up'
				},
				{
					label: 'Bearish TFs',
					value: analysis.bearishTFs.join(', ') || 'None',
					direction: 'down'
				},
			]
		});

		// Per-TF detail table
		contentBlocks.push({
			type: 'table',
			title: 'Timeframe Breakdown',
			headers: ['TF', 'Trend', 'RSI', 'MACD', 'EMA20', 'Score'],
			rows: analysis.timeframes.map(t => [
				t.timeframe.toUpperCase(),
				`${t.trend.toUpperCase()} ${trendEmoji(t.trend)}`,
				t.rsi !== null ? t.rsi.toFixed(1) : 'N/A',
				t.macdSignal.toUpperCase(),
				t.ema20 !== null ? t.ema20.toFixed(2) : 'N/A',
				t.score.toFixed(1),
			])
		});

		// Confluence zones
		if (analysis.keyConfluenceZones.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: 'Confluence Zones',
				headers: ['Price', 'Type', 'TFs'],
				rows: analysis.keyConfluenceZones.slice(0, 5).map(z => [
					z.price.toFixed(4),
					z.type.toUpperCase(),
					`${z.count} TFs`,
				])
			});
		}

		const alignmentStr = analysis.bullishTFs.length === analysis.timeframes.length
			? 'Full bullish alignment'
			: analysis.bearishTFs.length === analysis.timeframes.length
			? 'Full bearish alignment'
			: `Mixed: ${analysis.bullishTFs.length}B/${analysis.bearishTFs.length}B/${analysis.timeframes.length - analysis.bullishTFs.length - analysis.bearishTFs.length}N`;

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `${symbol} MTF: ${analysis.overallAlignment.toUpperCase()} (${(analysis.confluenceScore * 100).toFixed(0)}% confluence). ${alignmentStr}. Bullish: ${analysis.bullishTFs.join(', ') || 'none'}. Bearish: ${analysis.bearishTFs.join(', ') || 'none'}.`
		};

		toolCache.set(cacheKey, result, 15 * 60_000);
		return result;
	}
});
