// Monte Carlo Portfolio Simulation — T-904
// Bootstrap resampling of historical trade returns to project future equity paths

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonteCarloConfig {
	paths:          number;  // number of simulation paths (default 1000)
	horizon:        number;  // trades/periods to project (default 100)
	initialCapital: number;  // starting equity in USD
	targetReturn:   number;  // e.g. 0.20 = 20% gain target (fractional)
	ruinThreshold:  number;  // e.g. 0.30 = ruin at 30% drawdown (fractional)
}

export interface HorizonOutcome {
	horizon: number;  // trade number (e.g. 25, 50, 100)
	p5:      number;  // 5th percentile equity
	p25:     number;
	p50:     number;  // median equity
	p75:     number;
	p95:     number;
	label:   string;  // e.g. "25 trades"
}

export interface MonteCarloResult {
	paths:               number;
	initialCapital:      number;
	medianFinalValue:    number;
	medianReturn:        number;   // % (median final / initial - 1)
	targetProbability:   number;   // % of paths that hit target return
	ruinProbability:     number;   // % of paths that hit ruin threshold
	expectedMaxDrawdown: number;   // median max drawdown across paths (%)
	horizonOutcomes:     HorizonOutcome[];
	returnsUsed:         number;   // number of historical returns in the sample
}

// ─── Utility: percentile from sorted array ────────────────────────────────────

export function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.max(0, Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1))));
	return sorted[idx];
}

// ─── Utility: bootstrap sample ────────────────────────────────────────────────

/** Sample n values with replacement from arr using a seeded PRNG. */
export function sampleWithReplacement(arr: number[], n: number, rng: () => number): number[] {
	const result: number[] = new Array(n);
	for (let i = 0; i < n; i++) {
		result[i] = arr[Math.floor(rng() * arr.length)];
	}
	return result;
}

// ─── Utility: simple xorshift PRNG ───────────────────────────────────────────

export function createRNG(seed = 42): () => number {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s ^= s >> 17;
		s ^= s << 5;
		return (s >>> 0) / 4_294_967_296;
	};
}

// ─── Single path simulation ───────────────────────────────────────────────────

export interface PathResult {
	finalEquity:   number;
	maxDrawdown:   number;  // % (positive, e.g. 0.25 = 25%)
	hitTarget:     boolean;
	hitRuin:       boolean;
	equityAtSteps: number[];  // equity at each step
}

export function simulatePath(
	returns:        number[],     // historical return values (dollar PnL per trade)
	config:         MonteCarloConfig,
	rng:            () => number,
): PathResult {
	const { initialCapital, horizon, targetReturn, ruinThreshold } = config;

	const sampled = sampleWithReplacement(returns, horizon, rng);

	let equity     = initialCapital;
	let peakEquity = initialCapital;
	let maxDD      = 0;
	let hitTarget  = false;
	let hitRuin    = false;
	const equityAtSteps: number[] = [initialCapital];

	for (const ret of sampled) {
		equity += ret;
		if (equity < 0) equity = 0; // floor at 0

		if (equity > peakEquity) peakEquity = equity;

		const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
		if (dd > maxDD) maxDD = dd;

		// Check ruin (drawdown from peak exceeds threshold)
		if (dd >= ruinThreshold && !hitRuin) hitRuin = true;

		// Check target (equity grew by targetReturn from initial)
		if (equity >= initialCapital * (1 + targetReturn) && !hitTarget) hitTarget = true;

		equityAtSteps.push(equity);
	}

	return {
		finalEquity: equity,
		maxDrawdown: maxDD,
		hitTarget,
		hitRuin,
		equityAtSteps,
	};
}

// ─── Horizon checkpoints ──────────────────────────────────────────────────────

export function getHorizonCheckpoints(horizon: number): number[] {
	const candidates = [10, 25, 50, 100, 200, 500];
	return candidates.filter(c => c <= horizon).concat(horizon === candidates[candidates.length - 1] ? [] : [horizon]);
}

// ─── Main Monte Carlo runner ──────────────────────────────────────────────────

export function runMonteCarlo(
	historicalReturns: number[],
	config: Partial<MonteCarloConfig> = {},
): MonteCarloResult {
	const cfg: MonteCarloConfig = {
		paths:          config.paths          ?? 1000,
		horizon:        config.horizon        ?? Math.max(50, historicalReturns.length),
		initialCapital: config.initialCapital ?? 10_000,
		targetReturn:   config.targetReturn   ?? 0.20,
		ruinThreshold:  config.ruinThreshold  ?? 0.30,
	};

	if (historicalReturns.length < 5) {
		throw new Error('Need at least 5 historical returns to run simulation');
	}

	const rng = createRNG(12345);

	// ── Run all paths ─────────────────────────────────────────────────────────
	const finalEquities: number[] = [];
	const maxDrawdowns:  number[] = [];
	let   ruinCount   = 0;
	let   targetCount = 0;

	// Collect equity at horizon checkpoints across all paths
	const checkpoints = getHorizonCheckpoints(cfg.horizon);
	const checkpointEquities: Map<number, number[]> = new Map(checkpoints.map(c => [c, []]));

	for (let p = 0; p < cfg.paths; p++) {
		const path = simulatePath(historicalReturns, cfg, rng);
		finalEquities.push(path.finalEquity);
		maxDrawdowns.push(path.maxDrawdown);
		if (path.hitRuin)   ruinCount++;
		if (path.hitTarget) targetCount++;

		for (const checkpoint of checkpoints) {
			const idx = Math.min(checkpoint, path.equityAtSteps.length - 1);
			checkpointEquities.get(checkpoint)!.push(path.equityAtSteps[idx]);
		}
	}

	// ── Aggregate ─────────────────────────────────────────────────────────────
	finalEquities.sort((a, b) => a - b);
	maxDrawdowns.sort((a, b) => a - b);

	const medianFinal  = percentile(finalEquities, 50);
	const medianReturn = (medianFinal - cfg.initialCapital) / cfg.initialCapital;
	const medianMaxDD  = percentile(maxDrawdowns, 50) * 100;

	// ── Horizon outcomes ──────────────────────────────────────────────────────
	const horizonOutcomes: HorizonOutcome[] = checkpoints.map(cp => {
		const equities = checkpointEquities.get(cp)!.slice().sort((a, b) => a - b);
		return {
			horizon: cp,
			p5:      percentile(equities, 5),
			p25:     percentile(equities, 25),
			p50:     percentile(equities, 50),
			p75:     percentile(equities, 75),
			p95:     percentile(equities, 95),
			label:   `${cp} trade${cp === 1 ? '' : 's'}`,
		};
	});

	return {
		paths:               cfg.paths,
		initialCapital:      cfg.initialCapital,
		medianFinalValue:    medianFinal,
		medianReturn:        medianReturn * 100,  // store as %
		targetProbability:   (targetCount / cfg.paths) * 100,
		ruinProbability:     (ruinCount   / cfg.paths) * 100,
		expectedMaxDrawdown: medianMaxDD,
		horizonOutcomes,
		returnsUsed:         historicalReturns.length,
	};
}
