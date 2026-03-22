// Anomaly Detector Tool — T-1202
// detect_anomalies: scan watchlist for statistical market anomalies

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { fetchOHLCV, normalizeBinanceSymbol } from '../data/ohlcvProvider';
import { fetchLiquidations } from '../data/derivatives.data';
import {
	detectVolumeSpike,
	detectPriceGap,
	detectVolatilityExpansion,
	detectLiquidationCascade,
	detectCorrelationBreak,
	type Anomaly,
	type AnomalyType,
} from '../data/anomalyDetector.data';

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

const ANOMALY_LABELS: Record<AnomalyType, string> = {
	volume_spike:         'Volume Spike',
	price_gap:            'Price Gap',
	volatility_expansion: 'Volatility Expansion',
	liquidation_cascade:  'Liquidation Cascade',
	correlation_break:    'Correlation Break',
};

function generateExplanation(anomalies: Anomaly[]): string {
	const byType = new Map<AnomalyType, Anomaly[]>();
	for (const a of anomalies) {
		const list = byType.get(a.type) ?? [];
		list.push(a);
		byType.set(a.type, list);
	}

	const parts: string[] = ['## Market Anomaly Analysis\n'];

	const fmt = (sym: string) => sym.replace(/USDT$/i, '');

	const vs = byType.get('volume_spike');
	if (vs) {
		parts.push(
			`**Volume Spikes**: ${vs.map((a) => `${fmt(a.symbol)} (${a.currentValue})`).join(', ')} — ` +
			`Unusually high trading activity may signal institutional accumulation, distribution, or news-driven momentum.`,
		);
	}

	const pg = byType.get('price_gap');
	if (pg) {
		parts.push(
			`**Price Gaps**: ${pg.map((a) => `${fmt(a.symbol)} (${a.currentValue})`).join(', ')} — ` +
			`Large gaps suggest overnight news or thin-liquidity moves. Watch for potential gap fills.`,
		);
	}

	const ve = byType.get('volatility_expansion');
	if (ve) {
		parts.push(
			`**Volatility Expansion**: ${ve.map((a) => `${fmt(a.symbol)} (${a.currentValue})`).join(', ')} — ` +
			`ATR above recent average indicates increased uncertainty. Consider wider stops.`,
		);
	}

	const lc = byType.get('liquidation_cascade');
	if (lc) {
		parts.push(
			`**Liquidation Cascades**: ${lc.map((a) => `${fmt(a.symbol)} (${a.currentValue})`).join(', ')} — ` +
			`Forced liquidations can create short-term momentum and mark potential reversal zones.`,
		);
	}

	const cb = byType.get('correlation_break');
	if (cb) {
		parts.push(
			`**Correlation Breaks**: ${cb.map((a) => `${fmt(a.symbol)} — ${a.description}`).join('; ')} — ` +
			`Decoupling from BTC may reflect sector rotation or asset-specific catalysts.`,
		);
	}

	return parts.join('\n\n');
}

registerTool({
	name: 'detect_anomalies',
	description:
		'Scan a watchlist for statistical market anomalies: volume spikes >3x 20-day avg, price gaps >2 ATR, volatility expansion, liquidation cascades, and correlation breaks vs BTC. Ranks anomalies by severity score. Use when the user asks about unusual market activity, anomalies, or what is happening across the market.',
	parameters: {
		type: 'object',
		properties: {
			symbols: {
				type: 'string',
				description:
					'Comma-separated symbols to scan (e.g. "BTC,ETH,SOL"). Defaults to BTC,ETH,SOL,BNB,XRP. Up to 10 symbols.',
			},
		},
		required: [],
	},
	timeout: 45_000,
	execute: async (args): Promise<ToolResult> => {
		// ── Parse symbols ────────────────────────────────────────────────────
		let symbols: string[];
		if (typeof args.symbols === 'string' && args.symbols.trim()) {
			symbols = args.symbols
				.split(',')
				.map((s) => normalizeBinanceSymbol(s.trim()))
				.filter(Boolean)
				.slice(0, 10);
		} else {
			symbols = DEFAULT_SYMBOLS;
		}

		const cacheKey = toolCache.generateKey('detect_anomalies', { symbols: symbols.join(',') });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch data in parallel ────────────────────────────────────────────
		// 35 daily candles: enough for ATR(14) + 20-bar SMA of ATR + correlation
		const [btcResult, ohlcvResults, liquidations] = await Promise.all([
			fetchOHLCV('BTCUSDT', '1d', 35),
			Promise.allSettled(symbols.map((s) => fetchOHLCV(s, '1d', 35))),
			fetchLiquidations(symbols).catch(() => []),
		]);

		const btcOhlcv = 'error' in btcResult ? [] : btcResult.ohlcv;

		// ── Run anomaly detection ─────────────────────────────────────────────
		const allAnomalies: Anomaly[] = [];

		for (let i = 0; i < symbols.length; i++) {
			const sym = symbols[i];
			const r = ohlcvResults[i];
			if (r.status !== 'fulfilled' || 'error' in r.value) continue;

			const ohlcv = r.value.ohlcv;
			if (ohlcv.length < 16) continue;

			const spike = detectVolumeSpike(sym, ohlcv);
			if (spike) allAnomalies.push(spike);

			const gap = detectPriceGap(sym, ohlcv);
			if (gap) allAnomalies.push(gap);

			const volExp = detectVolatilityExpansion(sym, ohlcv);
			if (volExp) allAnomalies.push(volExp);

			if (btcOhlcv.length >= 32) {
				const corrBreak = detectCorrelationBreak(sym, ohlcv, btcOhlcv);
				if (corrBreak) allAnomalies.push(corrBreak);
			}

			const liq = liquidations.find((l) => l.symbol === sym);
			if (liq) {
				const cascade = detectLiquidationCascade(sym, liq.longLiqUSD, liq.shortLiqUSD);
				if (cascade) allAnomalies.push(cascade);
			}
		}

		// ── Sort by severity ──────────────────────────────────────────────────
		allAnomalies.sort((a, b) => b.severity - a.severity);

		const anomalyCount = allAnomalies.length;
		const highestSev = allAnomalies[0]?.severity ?? 0;
		const sevLabel =
			highestSev >= 8 ? 'Critical' :
			highestSev >= 6 ? 'High' :
			highestSev >= 4 ? 'Moderate' : 'Low';
		const topAnomaly = allAnomalies[0];

		const result: ToolResult = {
			success: true,
			contentBlocks: [
				{
					type: 'metric_card',
					title: 'Market Anomaly Scanner',
					metrics: [
						{
							label: 'Anomalies Detected',
							value: String(anomalyCount),
							change: anomalyCount === 0 ? 'None detected' : `${anomalyCount} alert${anomalyCount !== 1 ? 's' : ''}`,
							direction: anomalyCount === 0 ? 'neutral' : highestSev >= 6 ? 'down' : 'neutral',
						},
						{
							label: 'Highest Severity',
							value: anomalyCount > 0 ? `${highestSev}/10` : 'N/A',
							change: anomalyCount > 0 ? `${sevLabel} — ${topAnomaly.symbol.replace(/USDT$/i, '')} ${ANOMALY_LABELS[topAnomaly.type]}` : 'No alerts',
							direction: highestSev >= 6 ? 'down' : highestSev >= 3 ? 'neutral' : 'up',
						},
						{
							label: 'Symbols Scanned',
							value: String(symbols.length),
							direction: 'neutral',
						},
					],
				},
				...(anomalyCount > 0
					? [
							{
								type: 'table' as const,
								title: 'Detected Anomalies (Ranked by Severity)',
								headers: ['Symbol', 'Type', 'Severity', 'Current', 'Threshold', 'Description'],
								rows: allAnomalies.map((a) => [
									a.symbol.replace(/USDT$/i, ''),
									ANOMALY_LABELS[a.type],
									`${a.severity}/10`,
									a.currentValue,
									a.threshold,
									a.description,
								]),
							},
					  ]
					: []),
				{
					type: 'text',
					content:
						anomalyCount === 0
							? `No significant anomalies detected across ${symbols.length} symbols. Markets are trading within normal statistical ranges.`
							: generateExplanation(allAnomalies),
				},
			],
			textSummary:
				anomalyCount === 0
					? `No anomalies detected across ${symbols.join(', ')}.`
					: `Detected ${anomalyCount} anomal${anomalyCount === 1 ? 'y' : 'ies'} across ${symbols.length} symbols. ` +
					  `Highest severity: ${highestSev}/10 (${sevLabel}) — ${topAnomaly.symbol.replace(/USDT$/i, '')} ${ANOMALY_LABELS[topAnomaly.type]}. ` +
					  `Top 3: ${allAnomalies.slice(0, 3).map((a) => `${a.symbol.replace(/USDT$/i, '')} ${ANOMALY_LABELS[a.type]} (${a.severity}/10)`).join(', ')}.`,
			sources: [
				{ name: 'Binance Spot API', url: 'https://api.binance.com', accessedAt: Date.now() },
				{ name: 'Binance Futures API', url: 'https://fapi.binance.com', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 5 * 60_000); // 5-minute cache
		return result;
	},
});
