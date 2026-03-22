// Intermarket Analysis Data — T-703
// Risk-on/off signal, rolling correlations across SPY, TLT, GLD, USO, QQQ, BTC

import { pearsonCorrelation, toReturns, alignSeries } from '../risk/correlation';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AssetCategory = 'equity' | 'bonds' | 'commodity' | 'crypto';

export interface AssetDef {
	symbol:   string;
	label:    string;
	category: AssetCategory;
}

export interface AssetData extends AssetDef {
	closes:    number[];
	latestClose: number;
	change1d:  number; // % 1-day
	change20d: number; // % 20-day
}

export interface IntermarketSnapshot {
	assets:             AssetData[];
	correlationMatrix:  number[][];   // n×n, same order as assets
	labels:             string[];     // short labels for heatmap
	riskScore:          number;       // -100 (risk-off) to +100 (risk-on)
	riskLabel:          string;
	divergences:        DivergenceSignal[];
	fetchedAt:          number;
}

export interface DivergenceSignal {
	pair:         string;
	assetA:       string;
	assetB:       string;
	correlation:  number;
	interpretation: string;
}

// ─── Asset definitions ────────────────────────────────────────────────────────

export const INTERMARKET_ASSETS: AssetDef[] = [
	{ symbol: 'SPY',     label: 'SPY',  category: 'equity'    },
	{ symbol: 'QQQ',     label: 'QQQ',  category: 'equity'    },
	{ symbol: 'TLT',     label: 'TLT',  category: 'bonds'     },
	{ symbol: 'GLD',     label: 'GLD',  category: 'commodity' },
	{ symbol: 'USO',     label: 'USO',  category: 'commodity' },
	{ symbol: 'BTC-USD', label: 'BTC',  category: 'crypto'    },
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function pctChange(closes: number[], lookback: number): number {
	if (closes.length < 2) return 0;
	const idx  = Math.max(0, closes.length - 1 - lookback);
	const base = closes[idx];
	const last = closes[closes.length - 1];
	if (base === 0) return 0;
	return (last - base) / base * 100;
}

/**
 * Compute risk-on / risk-off score from 20-day returns.
 * Positive = risk-on (equities up, bonds down), negative = risk-off.
 * Score range: -100..+100.
 */
export function computeRiskScore(
	returns: Record<string, number>, // symbol → 20-day % change
): number {
	let score = 0;

	const spy = returns['SPY'] ?? 0;
	const qqq = returns['QQQ'] ?? 0;
	const tlt = returns['TLT'] ?? 0;
	const gld = returns['GLD'] ?? 0;
	const uso = returns['USO'] ?? 0;
	const btc = returns['BTC-USD'] ?? 0;

	// Equity momentum (max ±35)
	score += Math.max(-35, Math.min(35, spy * 3.5));

	// Bond signal: TLT up = risk-off, TLT down = risk-on (max ±25)
	score -= Math.max(-25, Math.min(25, tlt * 2.5));

	// BTC as high-beta risk indicator (max ±20)
	score += Math.max(-20, Math.min(20, btc * 1.0));

	// Gold divergence: GLD up + equities down = risk-off (max ±10)
	if (gld > 2 && spy < 0) score -= 10;
	if (gld < -2 && spy > 0) score += 5;

	// Oil as growth proxy (max ±5)
	score += Math.max(-5, Math.min(5, uso * 0.5));

	return Math.max(-100, Math.min(100, Math.round(score)));
}

export function riskLabel(score: number): string {
	if (score >= 60)  return 'Strong Risk-On';
	if (score >= 25)  return 'Moderate Risk-On';
	if (score >= -24) return 'Neutral';
	if (score >= -59) return 'Moderate Risk-Off';
	return 'Strong Risk-Off';
}

/**
 * Identify notable intermarket divergences from the correlation matrix.
 */
export function detectDivergences(
	labels: string[],
	matrix: number[][],
): DivergenceSignal[] {
	const signals: DivergenceSignal[] = [];

	const idx = (label: string) => labels.indexOf(label);
	const cor = (a: string, b: string): number | null => {
		const i = idx(a); const j = idx(b);
		if (i < 0 || j < 0) return null;
		return matrix[i][j];
	};

	// SPY vs TLT: normally negative (risk assets up, bonds down)
	const spyTlt = cor('SPY', 'TLT');
	if (spyTlt !== null) {
		signals.push({
			pair:         'SPY vs TLT',
			assetA:       'SPY',
			assetB:       'TLT',
			correlation:  spyTlt,
			interpretation: spyTlt > 0.3
				? 'Unusual positive correlation — flight-to-quality or late-cycle signal'
				: spyTlt < -0.3
				? 'Normal negative correlation — risk-on environment'
				: 'Neutral correlation — mixed signals',
		});
	}

	// BTC vs QQQ: strong positive = crypto following tech
	const btcQqq = cor('BTC', 'QQQ');
	if (btcQqq !== null) {
		signals.push({
			pair:         'BTC vs QQQ',
			assetA:       'BTC',
			assetB:       'QQQ',
			correlation:  btcQqq,
			interpretation: btcQqq > 0.5
				? 'BTC highly correlated with NASDAQ — moving as risk asset'
				: btcQqq < 0
				? 'BTC decoupling from tech — potential independent move'
				: 'Moderate BTC-tech correlation',
		});
	}

	// GLD vs SPY: negative = inflation hedge working
	const gldSpy = cor('GLD', 'SPY');
	if (gldSpy !== null) {
		signals.push({
			pair:         'GLD vs SPY',
			assetA:       'GLD',
			assetB:       'SPY',
			correlation:  gldSpy,
			interpretation: gldSpy < -0.3
				? 'Gold rising while equities fall — inflation hedge / risk-off'
				: gldSpy > 0.3
				? 'Gold and equities rising together — commodity demand or dollar weakness'
				: 'Neutral gold-equity relationship',
		});
	}

	return signals;
}

// ─── Yahoo Finance fetcher ────────────────────────────────────────────────────

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

export async function fetchYahooCloses(symbol: string, days: number): Promise<number[]> {
	try {
		const period2 = Math.floor(Date.now() / 1000);
		const period1 = period2 - (days + 10) * 86_400; // buffer for weekends
		const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`;
		const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
		if (!resp.ok) return [];
		const json = await resp.json() as Record<string, unknown>;
		const closes = (json as { chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: unknown[] }> } }> } })
			?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
		return (closes as unknown[]).filter((c): c is number => typeof c === 'number' && c > 0).slice(-days);
	} catch {
		return [];
	}
}

// ─── Main snapshot builder ────────────────────────────────────────────────────

export async function buildIntermarketSnapshot(
	windowDays = 30,
	fetcher: (symbol: string, days: number) => Promise<number[]> = fetchYahooCloses,
): Promise<IntermarketSnapshot> {
	// Fetch all prices concurrently
	const results = await Promise.allSettled(
		INTERMARKET_ASSETS.map(a => fetcher(a.symbol, windowDays + 5))
	);

	const assets: AssetData[] = INTERMARKET_ASSETS.map((def, i) => {
		const closes = results[i].status === 'fulfilled' ? results[i].value : [];
		return {
			...def,
			closes,
			latestClose: closes.at(-1) ?? 0,
			change1d:    pctChange(closes, 1),
			change20d:   pctChange(closes, 20),
		};
	}).filter(a => a.closes.length >= 5);

	const labels = assets.map(a => a.label);

	// Build correlation matrix on daily returns
	const n = assets.length;
	const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

	for (let i = 0; i < n; i++) {
		matrix[i][i] = 1;
		for (let j = i + 1; j < n; j++) {
			const [ra, rb] = alignSeries(
				toReturns(assets[i].closes),
				toReturns(assets[j].closes),
				20,
			);
			const corr = pearsonCorrelation(ra, rb);
			matrix[i][j] = corr;
			matrix[j][i] = corr;
		}
	}

	const returns20d: Record<string, number> = {};
	for (const a of assets) returns20d[a.symbol] = a.change20d;

	const riskScore     = computeRiskScore(returns20d);
	const divergences   = detectDivergences(labels, matrix);

	return { assets, correlationMatrix: matrix, labels, riskScore, riskLabel: riskLabel(riskScore), divergences, fetchedAt: Date.now() };
}
