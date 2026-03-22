// Volume Profile Tool — T-801
// Tool: get_volume_profile

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { buildVolumeProfile, detectVPOCShift, fmtPrice } from '../indicators/volumeProfile';
import { fetchOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'get_volume_profile',
	description:
		'Volume Profile analysis — computes volume-at-price distribution (POC, VAH, VAL, value area) from OHLCV data. POC (Point of Control) = price level with most traded volume. VAH/VAL = range containing 70% of volume. Detects VPOC shift (institutional buying/selling pressure). Returns MetricCard + volume distribution table. Use when asked about key price levels, volume nodes, support/resistance by volume, or where most trading occurred.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Asset symbol (e.g. BTCUSDT, AAPL, SPY). Default: BTCUSDT',
			},
			interval: {
				type: 'string',
				description: 'Candle interval: 1h, 4h, 1d, 1w. Default: 1d',
			},
			limit: {
				type: 'number',
				description: 'Number of candles to analyse (default: 100, min: 20, max: 500)',
			},
			bins: {
				type: 'number',
				description: 'Number of price bins (default: 24, min: 5, max: 100)',
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol   = typeof args.symbol   === 'string' && args.symbol   ? args.symbol.toUpperCase()  : 'BTCUSDT';
		const interval = typeof args.interval === 'string' && args.interval ? args.interval              : '1d';
		const limit    = Math.min(500, Math.max(20, typeof args.limit === 'number' ? args.limit : 100));
		const bins     = Math.min(100, Math.max(5,  typeof args.bins  === 'number' ? args.bins  : 24));

		const cacheKey = toolCache.generateKey('get_volume_profile', { symbol, interval, limit, bins });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch OHLCV ────────────────────────────────────────────────────────
		const fetchResult = await fetchOHLCV(symbol, interval, limit);
		if ('error' in fetchResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch data for ${symbol}: ${fetchResult.error}`, tool: 'get_volume_profile' }],
				textSummary: `Error: no data for ${symbol}.`,
			};
		}

		const candles = fetchResult.ohlcv;
		if (candles.length < 20) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Insufficient data for ${symbol}. Need at least 20 candles, got ${candles.length}.`, tool: 'get_volume_profile' }],
				textSummary: `Error: insufficient data for ${symbol}.`,
			};
		}

		const profile = buildVolumeProfile(candles, bins);
		if (!profile) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not build volume profile for ${symbol}.`, tool: 'get_volume_profile' }],
				textSummary: `Error building volume profile for ${symbol}.`,
			};
		}

		const vpocShift = detectVPOCShift(candles, bins);
		const currentPrice = candles[candles.length - 1].close;
		const priceVsPOC   = ((currentPrice - profile.poc) / profile.poc) * 100;
		const aboveVAH     = currentPrice > profile.vah;
		const belowVAL     = currentPrice < profile.val;
		const inValueArea  = !aboveVAH && !belowVAL;

		// ── MetricCard ─────────────────────────────────────────────────────────
		const pricePos = aboveVAH ? 'Above Value Area (bullish breakout)' :
		                 belowVAL ? 'Below Value Area (bearish breakdown)' :
		                 'Inside Value Area';

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Volume Profile — ${symbol} (${interval}, ${limit} candles)`,
			metrics: [
				{
					label:     'POC (Point of Control)',
					value:     fmtPrice(profile.poc),
					change:    `${priceVsPOC >= 0 ? '+' : ''}${priceVsPOC.toFixed(2)}% from current price`,
					direction: priceVsPOC >= 0 ? 'up' : 'down',
				},
				{
					label:     'Value Area High (VAH)',
					value:     fmtPrice(profile.vah),
					change:    `${((profile.vah - profile.poc) / profile.poc * 100).toFixed(2)}% above POC`,
					direction: 'up',
				},
				{
					label:     'Value Area Low (VAL)',
					value:     fmtPrice(profile.val),
					change:    `${((profile.poc - profile.val) / profile.poc * 100).toFixed(2)}% below POC`,
					direction: 'down',
				},
				{
					label:     'Price Position',
					value:     pricePos,
					change:    `Value area width: ${profile.valueAreaPct.toFixed(1)}% of range`,
					direction: inValueArea ? 'neutral' : aboveVAH ? 'up' : 'down',
				},
				...(vpocShift ? [{
					label:     'VPOC Shift',
					value:     vpocShift.direction === 'up' ? 'Migrating UP' : vpocShift.direction === 'down' ? 'Migrating DOWN' : 'Stable',
					change:    `${fmtPrice(vpocShift.previousPOC)} → ${fmtPrice(vpocShift.currentPOC)} (${vpocShift.shiftPct >= 0 ? '+' : ''}${vpocShift.shiftPct.toFixed(2)}%)`,
					direction: vpocShift.direction === 'up' ? 'up' as const : vpocShift.direction === 'down' ? 'down' as const : 'neutral' as const,
				}] : []),
			],
		};

		const contentBlocks: ContentBlock[] = [metricBlock];

		// ── Volume Distribution Table (top 15 bins by volume) ─────────────────
		const sortedBins = [...profile.bins].sort((a, b) => b.volume - a.volume).slice(0, 15);
		const tableRows  = sortedBins.map(b => {
			const isPOC = Math.abs(b.priceLevel - profile.poc) < (profile.priceRangeHigh - profile.priceRangeLow) / profile.binCount;
			const isVAH = Math.abs(b.priceHigh  - profile.vah) < (profile.priceRangeHigh - profile.priceRangeLow) / profile.binCount;
			const isVAL = Math.abs(b.priceLow   - profile.val) < (profile.priceRangeHigh - profile.priceRangeLow) / profile.binCount;
			const tag   = isPOC ? '★ POC' : isVAH ? '▲ VAH' : isVAL ? '▼ VAL' : '';
			return [
				`${fmtPrice(b.priceLow)} – ${fmtPrice(b.priceHigh)}`,
				fmtPrice(b.priceLevel),
				b.volume.toLocaleString('en-US', { maximumFractionDigits: 0 }),
				`${b.pct.toFixed(1)}%`,
				tag,
			];
		});

		const tableBlock: TableBlock = {
			type:    'table',
			title:   `Top Volume Nodes — ${symbol}`,
			headers: ['Price Range', 'Mid Price', 'Volume', '% of Total', 'Level'],
			rows:    tableRows,
		};
		contentBlocks.push(tableBlock);

		// ── All bins sorted by price (volume distribution) ────────────────────
		const allBinsTable: TableBlock = {
			type:    'table',
			title:   `Full Volume Distribution — ${symbol} (${bins} bins)`,
			headers: ['Price Level', 'Volume', 'Distribution %', 'Level'],
			rows:    profile.bins.slice().reverse().map(b => {
				const isPOC = Math.abs(b.priceLevel - profile.poc) < (profile.priceRangeHigh - profile.priceRangeLow) / profile.binCount;
				const isVAH = b.priceHigh >= profile.vah - 0.001 && b.priceLow <= profile.vah + 0.001;
				const isVAL = b.priceHigh >= profile.val - 0.001 && b.priceLow <= profile.val + 0.001;
				const tag   = isPOC ? 'POC' : isVAH ? 'VAH' : isVAL ? 'VAL' :
				              (b.priceLevel >= profile.val && b.priceLevel <= profile.vah) ? 'VA' : '';
				const bar   = '█'.repeat(Math.max(1, Math.round(b.pct / 2)));
				return [
					fmtPrice(b.priceLevel),
					b.volume.toLocaleString('en-US', { maximumFractionDigits: 0 }),
					`${bar} ${b.pct.toFixed(1)}%`,
					tag,
				];
			}),
		};
		contentBlocks.push(allBinsTable);

		const vpocText = vpocShift
			? ` VPOC is ${vpocShift.direction} (${vpocShift.shiftPct >= 0 ? '+' : ''}${vpocShift.shiftPct.toFixed(2)}%).`
			: '';

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `${symbol} volume profile (${limit} candles, ${bins} bins): POC=${fmtPrice(profile.poc)}, VAH=${fmtPrice(profile.vah)}, VAL=${fmtPrice(profile.val)}, value area=${profile.valueAreaPct.toFixed(1)}% of range. Current price is ${pricePos.toLowerCase()}.${vpocText}`,
			sources: [{ name: 'Volume Profile Analysis', url: 'https://www.investopedia.com/terms/v/volumeprofile.asp', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, result, 15 * 60_000); // 15 min cache
		return result;
	},
});
