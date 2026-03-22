// Efficient Frontier & Portfolio Optimization — T-1101
// Modern Portfolio Theory: mean-variance optimization via Monte Carlo sampling

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PortfolioPoint {
	weights:  number[];   // fractional weights summing to 1
	returns:  number;     // annualised expected return (decimal, e.g. 0.15 = 15%)
	risk:     number;     // annualised std dev (decimal)
	sharpe:   number;     // Sharpe ratio
}

export interface EfficientFrontierResult {
	assets:          string[];
	numPortfolios:   number;   // total random portfolios generated
	riskFreeRate:    number;   // annualised (decimal)

	maxSharpe:       PortfolioPoint;
	minVariance:     PortfolioPoint;
	equalWeight:     PortfolioPoint;

	/** Top-50 frontier points sorted by risk ascending (for scatter plot) */
	frontier:        FrontierPoint[];
}

export interface FrontierPoint {
	risk:    number;
	returns: number;
	sharpe:  number;
}

// ─── Log returns ──────────────────────────────────────────────────────────────

/**
 * Compute daily log returns from a price series.
 * Returns array of length (prices.length - 1).
 */
export function computeLogReturns(prices: number[]): number[] {
	const out: number[] = [];
	for (let i = 1; i < prices.length; i++) {
		const prev = prices[i - 1];
		const curr = prices[i];
		// Guard against zero / negative prices
		if (prev > 0 && curr > 0) {
			out.push(Math.log(curr / prev));
		} else {
			out.push(0);
		}
	}
	return out;
}

// ─── Mean & covariance ────────────────────────────────────────────────────────

/** Annualised mean log return (×252 trading days). */
export function annualisedMean(returns: number[]): number {
	if (returns.length === 0) return 0;
	const sum = returns.reduce((a, b) => a + b, 0);
	return (sum / returns.length) * 252;
}

/**
 * Annualised covariance matrix (×252).
 * `returnMatrix[i]` = array of daily log returns for asset i.
 * Assets must all have the same number of observations.
 */
export function computeCovMatrix(returnMatrix: number[][]): number[][] {
	const n      = returnMatrix.length;
	const nObs   = returnMatrix[0]?.length ?? 0;
	const means  = returnMatrix.map(r => r.reduce((a, b) => a + b, 0) / Math.max(nObs, 1));
	const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

	if (nObs < 2) return cov;

	for (let i = 0; i < n; i++) {
		for (let j = i; j < n; j++) {
			let s = 0;
			for (let k = 0; k < nObs; k++) {
				s += (returnMatrix[i][k] - means[i]) * (returnMatrix[j][k] - means[j]);
			}
			const c = (s / (nObs - 1)) * 252;
			cov[i][j] = c;
			cov[j][i] = c;
		}
	}
	return cov;
}

// ─── Portfolio statistics ─────────────────────────────────────────────────────

/**
 * Compute portfolio expected return, risk, and Sharpe ratio.
 * @param weights   - fractional weights (must sum to 1)
 * @param means     - annualised mean returns per asset
 * @param cov       - annualised covariance matrix
 * @param rfr       - annualised risk-free rate (default 0.05)
 */
export function portfolioStats(
	weights: number[],
	means:   number[],
	cov:     number[][],
	rfr    = 0.05,
): { returns: number; risk: number; sharpe: number } {
	const n = weights.length;

	// Expected return
	let ret = 0;
	for (let i = 0; i < n; i++) ret += weights[i] * means[i];

	// Portfolio variance = w^T · Cov · w
	let variance = 0;
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			variance += weights[i] * weights[j] * cov[i][j];
		}
	}
	const risk   = Math.sqrt(Math.max(0, variance));
	const sharpe = risk > 0 ? (ret - rfr) / risk : 0;

	return { returns: ret, risk, sharpe };
}

// ─── Random weight generation ─────────────────────────────────────────────────

/**
 * Simple xorshift PRNG (same as monteCarlo.ts for consistency).
 */
export function createRNG(seed = 42): () => number {
	let s = (seed >>> 0) || 1;
	return () => {
		s ^= s << 13;
		s ^= s >> 17;
		s ^= s << 5;
		return (s >>> 0) / 4_294_967_296;
	};
}

/**
 * Generate random portfolio weights via Dirichlet-like sampling:
 * draw exponentials (−ln(U)) then normalise.
 */
export function randomWeights(n: number, rng: () => number): number[] {
	const raw: number[] = [];
	for (let i = 0; i < n; i++) {
		// Clamp to avoid log(0)
		raw.push(-Math.log(Math.max(rng(), 1e-10)));
	}
	const total = raw.reduce((a, b) => a + b, 0);
	return raw.map(v => v / total);
}

// ─── Equal weight ─────────────────────────────────────────────────────────────

export function equalWeights(n: number): number[] {
	return new Array(n).fill(1 / n);
}

// ─── Main optimizer ───────────────────────────────────────────────────────────

/**
 * Run Monte Carlo portfolio optimization.
 *
 * @param assets        - asset names (same order as priceSeries)
 * @param priceSeries   - daily close prices per asset; must all be same length ≥ 2
 * @param riskFreeRate  - annualised risk-free rate (default 0.05)
 * @param numPortfolios - number of random portfolios to sample (default 2000)
 */
export function runEfficientFrontier(
	assets:        string[],
	priceSeries:   number[][],
	riskFreeRate = 0.05,
	numPortfolios = 2000,
): EfficientFrontierResult {
	const n = assets.length;
	if (n === 0) throw new Error('Need at least one asset');
	if (priceSeries.length !== n) throw new Error('priceSeries length must match assets length');

	// ── Compute return matrix ────────────────────────────────────────────────
	const returnMatrix = priceSeries.map(prices => computeLogReturns(prices));

	// Align to shortest series
	const minLen = Math.min(...returnMatrix.map(r => r.length));
	const alignedReturns = returnMatrix.map(r => r.slice(r.length - minLen));

	// ── Mean returns & covariance ────────────────────────────────────────────
	const means = alignedReturns.map(annualisedMean);
	const cov   = computeCovMatrix(alignedReturns);

	// ── Equal-weight portfolio ────────────────────────────────────────────────
	const ewWeights = equalWeights(n);
	const ewStats   = portfolioStats(ewWeights, means, cov, riskFreeRate);
	const equalWeightPortfolio: PortfolioPoint = { weights: ewWeights, ...ewStats };

	// Single asset: skip Monte Carlo
	if (n === 1) {
		const single: PortfolioPoint = { weights: [1], ...portfolioStats([1], means, cov, riskFreeRate) };
		return {
			assets,
			numPortfolios: 1,
			riskFreeRate,
			maxSharpe:    single,
			minVariance:  single,
			equalWeight:  single,
			frontier:     [{ risk: single.risk, returns: single.returns, sharpe: single.sharpe }],
		};
	}

	// ── Monte Carlo ──────────────────────────────────────────────────────────
	const rng = createRNG(9973);

	let bestSharpePoint:   PortfolioPoint | null = null;
	let minVariancePoint:  PortfolioPoint | null = null;
	const allPoints: PortfolioPoint[] = [];

	for (let i = 0; i < numPortfolios; i++) {
		const w     = randomWeights(n, rng);
		const stats = portfolioStats(w, means, cov, riskFreeRate);
		const point: PortfolioPoint = { weights: w, ...stats };
		allPoints.push(point);

		if (!bestSharpePoint  || point.sharpe  > bestSharpePoint.sharpe)  bestSharpePoint  = point;
		if (!minVariancePoint || point.risk    < minVariancePoint.risk)    minVariancePoint = point;
	}

	// ── Frontier: select Pareto-efficient (non-dominated) points ─────────────
	// A portfolio is on the efficient frontier if no other has both higher
	// return AND lower risk. Sort by risk, keep running max-return.
	const sorted = allPoints.slice().sort((a, b) => a.risk - b.risk);
	let maxRet   = -Infinity;
	const frontierCandidates: PortfolioPoint[] = [];
	for (const pt of sorted) {
		if (pt.returns > maxRet) {
			maxRet = pt.returns;
			frontierCandidates.push(pt);
		}
	}

	// Down-sample to 50 points for the scatter table
	const step = Math.max(1, Math.floor(frontierCandidates.length / 50));
	const frontier: FrontierPoint[] = frontierCandidates
		.filter((_, i) => i % step === 0)
		.slice(0, 50)
		.map(({ risk, returns, sharpe }) => ({ risk, returns, sharpe }));

	return {
		assets,
		numPortfolios,
		riskFreeRate,
		maxSharpe:   bestSharpePoint  ?? equalWeightPortfolio,
		minVariance: minVariancePoint ?? equalWeightPortfolio,
		equalWeight: equalWeightPortfolio,
		frontier,
	};
}
