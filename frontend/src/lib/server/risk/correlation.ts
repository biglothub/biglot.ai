// Correlation Matrix — T-304
// Pure functions for Pearson correlation and matrix construction

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute Pearson correlation coefficient between two equal-length arrays.
 * Returns 0 if standard deviation is zero or arrays are too short.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
	const n = Math.min(x.length, y.length);
	if (n < 2) return 0;

	let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
	for (let i = 0; i < n; i++) {
		sumX += x[i];
		sumY += y[i];
		sumXY += x[i] * y[i];
		sumX2 += x[i] * x[i];
		sumY2 += y[i] * y[i];
	}

	const num = n * sumXY - sumX * sumY;
	const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

	if (den === 0) return 0;

	// Clamp to [-1, 1] to guard against floating point drift
	return Math.max(-1, Math.min(1, num / den));
}

/**
 * Convert an array of closing prices to percentage returns.
 * Returns an array one element shorter than the input.
 */
export function toReturns(closes: number[]): number[] {
	const returns: number[] = [];
	for (let i = 1; i < closes.length; i++) {
		if (closes[i - 1] === 0) continue;
		returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
	}
	return returns;
}

/**
 * Trim two series to the last `windowDays` elements and then align to equal length.
 */
export function alignSeries(a: number[], b: number[], windowDays: number): [number[], number[]] {
	const sliceA = a.slice(-windowDays);
	const sliceB = b.slice(-windowDays);
	const len = Math.min(sliceA.length, sliceB.length);
	return [sliceA.slice(-len), sliceB.slice(-len)];
}

/**
 * Build an n×n correlation matrix from a map of label → price closes.
 * Returns labels (potentially filtered to those with enough data) and a square matrix.
 *
 * @param labels  Ordered list of asset labels
 * @param seriesMap  Map of label → closing price array
 * @param windowDays  Rolling window (30 | 60 | 90 | 180)
 * @param minPoints  Minimum return points required to include an asset (default 5)
 */
export function buildCorrelationMatrix(
	labels: string[],
	seriesMap: Map<string, number[]>,
	windowDays: number,
	minPoints = 5
): { labels: string[]; matrix: number[][] } {
	// Build returns for each label, filtered by data quality
	const returnsMap = new Map<string, number[]>();
	for (const label of labels) {
		const closes = seriesMap.get(label);
		if (!closes || closes.length < 2) continue;
		const windowed = closes.slice(-windowDays - 1); // extra point for first return
		const returns = toReturns(windowed);
		if (returns.length >= minPoints) {
			returnsMap.set(label, returns);
		}
	}

	const validLabels = labels.filter(l => returnsMap.has(l));
	const n = validLabels.length;

	// n×n matrix
	const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

	for (let i = 0; i < n; i++) {
		matrix[i][i] = 1; // self-correlation
		for (let j = i + 1; j < n; j++) {
			const [a, b] = alignSeries(
				returnsMap.get(validLabels[i])!,
				returnsMap.get(validLabels[j])!,
				windowDays
			);
			const r = pearsonCorrelation(a, b);
			matrix[i][j] = r;
			matrix[j][i] = r; // symmetric
		}
	}

	return { labels: validLabels, matrix };
}

/**
 * Map a correlation value (-1..1) to a descriptive label.
 */
export function corrLabel(r: number): string {
	const abs = Math.abs(r);
	const sign = r >= 0 ? '+' : '−';
	if (abs >= 0.8) return `${sign}Strong`;
	if (abs >= 0.5) return `${sign}Moderate`;
	if (abs >= 0.2) return `${sign}Weak`;
	return 'None';
}
