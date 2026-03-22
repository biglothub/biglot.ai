// Historical Scenario / Stress Test — T-1102
// Apply predefined historical shock scenarios to a portfolio

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScenarioShock {
	/** Symbol or asset class pattern (exact match, prefix, or '*' for all) */
	symbol:  string;
	/** Fractional price change (e.g. -0.34 = -34%) */
	shock:   number;
}

export interface Scenario {
	name:        string;
	description: string;
	period:      string;   // e.g. "Feb–Mar 2020"
	shocks:      ScenarioShock[];
}

export interface ScenarioResult {
	scenario:    string;
	description: string;
	period:      string;
	portfolioPnlPct: number;   // total portfolio % change
	portfolioPnlUsd: number;   // total portfolio $ change
	assetPnl:    AssetPnl[];   // per-asset PnL
}

export interface AssetPnl {
	symbol:   string;
	weight:   number;
	shock:    number;       // applied shock (fractional)
	pnlPct:   number;       // weight * shock
	pnlUsd:   number;
}

// ─── Predefined scenarios ─────────────────────────────────────────────────────

export const SCENARIOS: Scenario[] = [
	{
		name:        'COVID Crash 2020',
		description: 'Global equity and crypto sell-off as COVID-19 pandemic began',
		period:      'Feb–Mar 2020',
		shocks: [
			{ symbol: 'BTC',     shock: -0.50 },
			{ symbol: 'ETH',     shock: -0.55 },
			{ symbol: 'SOL',     shock: -0.65 },
			{ symbol: 'BNB',     shock: -0.50 },
			{ symbol: 'ADA',     shock: -0.55 },
			{ symbol: 'SPY',     shock: -0.34 },
			{ symbol: 'QQQ',     shock: -0.29 },
			{ symbol: 'GLD',     shock: -0.12 },
			{ symbol: 'TLT',     shock:  0.20 },  // flight to safety
			{ symbol: '*',       shock: -0.40 },  // fallback for all others
		],
	},
	{
		name:        'GFC 2008',
		description: 'Global Financial Crisis — worst equity drawdown since Great Depression',
		period:      'Oct 2007 – Mar 2009',
		shocks: [
			{ symbol: 'SPY',     shock: -0.57 },
			{ symbol: 'QQQ',     shock: -0.49 },
			{ symbol: 'GLD',     shock:  0.25 },
			{ symbol: 'TLT',     shock:  0.35 },
			{ symbol: 'BTC',     shock:  0.00 },  // didn't exist
			{ symbol: 'ETH',     shock:  0.00 },
			{ symbol: '*',       shock: -0.45 },
		],
	},
	{
		name:        '2022 Crypto Winter',
		description: 'Crypto bear market triggered by LUNA collapse, FTX, Fed rate hikes',
		period:      'Nov 2021 – Dec 2022',
		shocks: [
			{ symbol: 'BTC',     shock: -0.77 },
			{ symbol: 'ETH',     shock: -0.80 },
			{ symbol: 'SOL',     shock: -0.96 },
			{ symbol: 'BNB',     shock: -0.65 },
			{ symbol: 'ADA',     shock: -0.88 },
			{ symbol: 'SPY',     shock: -0.19 },
			{ symbol: 'QQQ',     shock: -0.32 },
			{ symbol: 'GLD',     shock: -0.02 },
			{ symbol: 'TLT',     shock: -0.35 },
			{ symbol: '*',       shock: -0.70 },
		],
	},
	{
		name:        '2018 BTC Bear',
		description: 'BTC fell 84% from ATH after 2017 bull run; broad crypto collapse',
		period:      'Dec 2017 – Dec 2018',
		shocks: [
			{ symbol: 'BTC',     shock: -0.84 },
			{ symbol: 'ETH',     shock: -0.94 },
			{ symbol: 'BNB',     shock: -0.90 },
			{ symbol: 'ADA',     shock: -0.97 },
			{ symbol: 'SOL',     shock: -0.85 },
			{ symbol: 'SPY',     shock: -0.06 },
			{ symbol: 'QQQ',     shock: -0.04 },
			{ symbol: 'GLD',     shock: -0.03 },
			{ symbol: '*',       shock: -0.85 },
		],
	},
	{
		name:        'DotCom Crash',
		description: 'Tech bubble burst — NASDAQ lost 78% over 2+ years',
		period:      'Mar 2000 – Oct 2002',
		shocks: [
			{ symbol: 'QQQ',     shock: -0.78 },
			{ symbol: 'SPY',     shock: -0.49 },
			{ symbol: 'GLD',     shock:  0.10 },
			{ symbol: 'TLT',     shock:  0.30 },
			{ symbol: 'BTC',     shock:  0.00 },
			{ symbol: 'ETH',     shock:  0.00 },
			{ symbol: '*',       shock: -0.50 },
		],
	},
	{
		name:        '2020 BTC Halving Bull',
		description: 'BTC halving-driven bull run; crypto broadly surged',
		period:      'Mar 2020 – Nov 2021',
		shocks: [
			{ symbol: 'BTC',     shock:  10.0  },  // +1000%
			{ symbol: 'ETH',     shock:  29.0  },  // +2900%
			{ symbol: 'SOL',     shock: 199.0  },  // +19900%
			{ symbol: 'BNB',     shock:  12.0  },
			{ symbol: 'ADA',     shock:  31.0  },
			{ symbol: 'SPY',     shock:  1.10  },
			{ symbol: 'QQQ',     shock:  1.40  },
			{ symbol: 'GLD',     shock:  0.15  },
			{ symbol: '*',       shock:  5.0   },
		],
	},
	{
		name:        'Taper Tantrum 2013',
		description: 'Fed signals QE tapering — bond sell-off, EM equity drawdown',
		period:      'May–Sep 2013',
		shocks: [
			{ symbol: 'TLT',     shock: -0.14 },
			{ symbol: 'GLD',     shock: -0.28 },
			{ symbol: 'SPY',     shock:  0.05 },
			{ symbol: 'QQQ',     shock:  0.08 },
			{ symbol: 'BTC',     shock:  0.00 },
			{ symbol: 'ETH',     shock:  0.00 },
			{ symbol: '*',       shock: -0.10 },
		],
	},
	{
		name:        '2013 BTC Rally',
		description: 'BTC surged from $13 to $1,100 — first mainstream crypto bubble',
		period:      'Jan–Dec 2013',
		shocks: [
			{ symbol: 'BTC',     shock:  84.6  },  // +8460%
			{ symbol: 'ETH',     shock:   0.00 },  // didn't exist
			{ symbol: 'SOL',     shock:   0.00 },
			{ symbol: 'BNB',     shock:   0.00 },
			{ symbol: 'SPY',     shock:   0.30 },
			{ symbol: 'QQQ',     shock:   0.37 },
			{ symbol: 'GLD',     shock:  -0.28 },
			{ symbol: '*',       shock:   0.00 },
		],
	},
];

// ─── Symbol matching ──────────────────────────────────────────────────────────

/** Normalise a symbol for matching (strip USDT/USD suffix, uppercase). */
export function normaliseSymbol(raw: string): string {
	return raw.toUpperCase().replace(/USDT$|USD$|-USD$|-USDT$/, '');
}

/**
 * Find the shock to apply to a given symbol in a scenario.
 * Priority: exact base match → '*' wildcard fallback.
 */
export function findShock(symbol: string, shocks: ScenarioShock[]): number {
	const base = normaliseSymbol(symbol);

	// Exact match on normalised base
	for (const s of shocks) {
		if (s.symbol !== '*' && normaliseSymbol(s.symbol) === base) {
			return s.shock;
		}
	}

	// Wildcard fallback
	const wildcard = shocks.find(s => s.symbol === '*');
	return wildcard ? wildcard.shock : 0;
}

// ─── Apply scenario ───────────────────────────────────────────────────────────

/**
 * Apply a single scenario to a portfolio.
 *
 * @param scenario     - the scenario definition
 * @param holdings     - map of symbol → USD value (already weighted)
 * @param totalValue   - total portfolio USD value
 */
export function applyScenario(
	scenario:   Scenario,
	holdings:   Map<string, number>,
	totalValue: number,
): ScenarioResult {
	const assetPnl: AssetPnl[] = [];
	let totalPnlUsd = 0;

	for (const [symbol, usdValue] of holdings) {
		const shock  = findShock(symbol, scenario.shocks);
		const weight = totalValue > 0 ? usdValue / totalValue : 0;
		const pnlUsd = usdValue * shock;
		const pnlPct = weight * shock;

		totalPnlUsd += pnlUsd;
		assetPnl.push({ symbol, weight, shock, pnlPct, pnlUsd });
	}

	const portfolioPnlPct = totalValue > 0 ? totalPnlUsd / totalValue : 0;

	return {
		scenario:        scenario.name,
		description:     scenario.description,
		period:          scenario.period,
		portfolioPnlPct,
		portfolioPnlUsd: totalPnlUsd,
		assetPnl,
	};
}

// ─── Run all scenarios ────────────────────────────────────────────────────────

export interface StressTestResult {
	totalValue:       number;
	results:          ScenarioResult[];
	worstScenario:    ScenarioResult;
	bestScenario:     ScenarioResult;
	maxSingleLossPct: number;   // worst scenario PnL %
}

/**
 * Run all predefined scenarios against a portfolio.
 *
 * @param symbols    - list of asset symbols
 * @param weights    - fractional weights (must sum to ≈1)
 * @param totalValue - total portfolio USD value
 */
export function runStressTest(
	symbols:    string[],
	weights:    number[],
	totalValue: number,
): StressTestResult {
	if (symbols.length === 0) throw new Error('Need at least one asset');
	if (symbols.length !== weights.length) throw new Error('symbols and weights must be same length');

	// Build holdings map: symbol → USD value
	const holdings = new Map<string, number>();
	for (let i = 0; i < symbols.length; i++) {
		holdings.set(symbols[i], totalValue * (weights[i] ?? 0));
	}

	const results = SCENARIOS.map(scenario => applyScenario(scenario, holdings, totalValue));

	// Sort by portfolio PnL ascending for worst→best order
	results.sort((a, b) => a.portfolioPnlPct - b.portfolioPnlPct);

	const worst = results[0];
	const best  = results[results.length - 1];

	return {
		totalValue,
		results,
		worstScenario:    worst,
		bestScenario:     best,
		maxSingleLossPct: Math.min(...results.map(r => r.portfolioPnlPct)),
	};
}
