// T-202: Sentiment data tests
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	computeFundingSentiment,
	computeLongShortSentiment,
	computeCompositeScore,
	sentimentLabel,
	annualisedFundingRate,
	fetchFearGreed,
	fetchFundingRates,
	fetchLongShortRatios,
	fetchSentimentSnapshot,
} from './sentiment.data';

// Cache mock so tool tests don't cross-contaminate
vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_name: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

// Import the tool to register it
import '../tools/sentiment.tool';

afterEach(() => {
	vi.restoreAllMocks();
});

// ─── computeFundingSentiment ──────────────────────────────────────────────────

describe('computeFundingSentiment', () => {
	it('returns 50 for zero funding rate', () => {
		expect(computeFundingSentiment(0)).toBe(50);
	});

	it('returns > 50 for positive funding (bullish pressure)', () => {
		expect(computeFundingSentiment(0.0001)).toBeGreaterThan(50);
	});

	it('returns < 50 for negative funding (bearish pressure)', () => {
		expect(computeFundingSentiment(-0.0001)).toBeLessThan(50);
	});

	it('clamps at 100 for extreme positive funding', () => {
		expect(computeFundingSentiment(0.01)).toBe(100);
	});

	it('clamps at 0 for extreme negative funding', () => {
		expect(computeFundingSentiment(-0.01)).toBe(0);
	});
});

// ─── computeLongShortSentiment ────────────────────────────────────────────────

describe('computeLongShortSentiment', () => {
	it('returns 50 for balanced 50/50', () => {
		expect(computeLongShortSentiment(50)).toBe(50);
	});

	it('caps above 60 for extreme long (contrarian signal)', () => {
		expect(computeLongShortSentiment(80)).toBeLessThanOrEqual(60);
	});

	it('floors above 40 for extreme short (contrarian signal)', () => {
		expect(computeLongShortSentiment(10)).toBeGreaterThanOrEqual(40);
	});

	it('returns between 0 and 100 for all inputs', () => {
		for (let pct = 0; pct <= 100; pct += 10) {
			const result = computeLongShortSentiment(pct);
			expect(result).toBeGreaterThanOrEqual(0);
			expect(result).toBeLessThanOrEqual(100);
		}
	});
});

// ─── computeCompositeScore ────────────────────────────────────────────────────

describe('computeCompositeScore', () => {
	it('returns 50 when all inputs are null', () => {
		expect(computeCompositeScore(null, null, null)).toBe(50);
	});

	it('uses only fearGreed when others are null', () => {
		expect(computeCompositeScore(80, null, null)).toBe(80);
	});

	it('weights fear greed at 50%', () => {
		// All components = same value → result matches
		const score = computeCompositeScore(60, 60, 60);
		expect(score).toBe(60);
	});

	it('returns rounded integer', () => {
		const score = computeCompositeScore(55, 60, 45);
		expect(Number.isInteger(score)).toBe(true);
	});

	it('extreme fear scenario returns low score', () => {
		const score = computeCompositeScore(10, 20, 30);
		expect(score).toBeLessThan(30);
	});

	it('extreme greed scenario returns high score', () => {
		const score = computeCompositeScore(90, 80, 70);
		expect(score).toBeGreaterThan(70);
	});
});

// ─── sentimentLabel ───────────────────────────────────────────────────────────

describe('sentimentLabel', () => {
	it('returns Extreme Fear for score <= 20', () => {
		expect(sentimentLabel(10)).toBe('Extreme Fear');
		expect(sentimentLabel(20)).toBe('Extreme Fear');
	});

	it('returns Fear for score 21-40', () => {
		expect(sentimentLabel(30)).toBe('Fear');
		expect(sentimentLabel(40)).toBe('Fear');
	});

	it('returns Neutral for score 41-60', () => {
		expect(sentimentLabel(50)).toBe('Neutral');
		expect(sentimentLabel(60)).toBe('Neutral');
	});

	it('returns Greed for score 61-80', () => {
		expect(sentimentLabel(70)).toBe('Greed');
		expect(sentimentLabel(80)).toBe('Greed');
	});

	it('returns Extreme Greed for score > 80', () => {
		expect(sentimentLabel(90)).toBe('Extreme Greed');
		expect(sentimentLabel(100)).toBe('Extreme Greed');
	});
});

// ─── annualisedFundingRate ────────────────────────────────────────────────────

describe('annualisedFundingRate', () => {
	it('converts 0.0001 per 8h to ~10.95% p.a.', () => {
		const result = annualisedFundingRate(0.0001);
		expect(result).toBeCloseTo(10.95, 1);
	});

	it('returns 0 for zero rate', () => {
		expect(annualisedFundingRate(0)).toBe(0);
	});

	it('returns negative for negative rate', () => {
		expect(annualisedFundingRate(-0.0001)).toBeLessThan(0);
	});
});

// ─── fetchFearGreed ───────────────────────────────────────────────────────────

describe('fetchFearGreed', () => {
	it('returns parsed data on success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: [
					{ value: '45', value_classification: 'Fear' },
					{ value: '55', value_classification: 'Greed' },
				],
			}),
		}));

		const result = await fetchFearGreed();
		expect(result).not.toBeNull();
		expect(result?.value).toBe(45);
		expect(result?.label).toBe('Fear');
		expect(result?.yesterday).toBe(55);
	});

	it('returns null on HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));
		const result = await fetchFearGreed();
		expect(result).toBeNull();
	});

	it('returns null on network error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Network error')));
		const result = await fetchFearGreed();
		expect(result).toBeNull();
	});

	it('returns null when data array is empty', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({ data: [] }),
		}));
		const result = await fetchFearGreed();
		expect(result).toBeNull();
	});

	it('handles missing yesterday gracefully', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({ data: [{ value: '70', value_classification: 'Greed' }] }),
		}));
		const result = await fetchFearGreed();
		expect(result?.yesterday).toBeNull();
	});
});

// ─── fetchFundingRates ────────────────────────────────────────────────────────

describe('fetchFundingRates', () => {
	it('returns funding rate data on success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				symbol: 'BTCUSDT',
				lastFundingRate: '0.0001',
				markPrice: '65000.0',
			}),
		}));

		const result = await fetchFundingRates(['BTCUSDT']);
		expect(result).toHaveLength(1);
		expect(result[0].symbol).toBe('BTCUSDT');
		expect(result[0].rawRate).toBeCloseTo(0.0001);
		expect(result[0].markPrice).toBeCloseTo(65000);
	});

	it('returns empty array on fetch error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('error')));
		const result = await fetchFundingRates(['BTCUSDT']);
		expect(result).toHaveLength(0);
	});

	it('returns partial results when one symbol fails', async () => {
		let callCount = 0;
		vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				return {
					ok: true,
					json: async () => ({ symbol: 'BTCUSDT', lastFundingRate: '0.0001', markPrice: '65000' }),
				};
			}
			throw new Error('Network error');
		}));

		const result = await fetchFundingRates(['BTCUSDT', 'ETHUSDT']);
		expect(result).toHaveLength(1);
		expect(result[0].symbol).toBe('BTCUSDT');
	});

	it('annualises the funding rate correctly', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ symbol: 'BTCUSDT', lastFundingRate: '0.0001', markPrice: '65000' }),
		}));

		const result = await fetchFundingRates(['BTCUSDT']);
		expect(result[0].rate).toBeCloseTo(10.95, 1);
	});
});

// ─── fetchLongShortRatios ─────────────────────────────────────────────────────

describe('fetchLongShortRatios', () => {
	it('returns long/short data on success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [{ longAccount: '0.65', shortAccount: '0.35' }],
		}));

		const result = await fetchLongShortRatios(['BTCUSDT']);
		expect(result).toHaveLength(1);
		expect(result[0].longPct).toBeCloseTo(65, 0);
		expect(result[0].shortPct).toBeCloseTo(35, 0);
	});

	it('returns empty array on error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('error')));
		const result = await fetchLongShortRatios(['BTCUSDT']);
		expect(result).toHaveLength(0);
	});

	it('skips on empty response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [],
		}));
		const result = await fetchLongShortRatios(['BTCUSDT']);
		expect(result).toHaveLength(0);
	});

	it('longPct + shortPct sums to ~100', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [{ longAccount: '0.58', shortAccount: '0.42' }],
		}));
		const result = await fetchLongShortRatios(['BTCUSDT']);
		const sum = result[0].longPct + result[0].shortPct;
		expect(sum).toBeCloseTo(100, 0);
	});
});

// ─── fetchSentimentSnapshot (integration) ────────────────────────────────────

describe('fetchSentimentSnapshot', () => {
	it('returns snapshot with compositeScore and label', async () => {
		vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
			if (String(url).includes('alternative.me')) {
				return {
					ok: true,
					json: async () => ({ data: [{ value: '50', value_classification: 'Neutral' }] }),
				};
			}
			if (String(url).includes('premiumIndex')) {
				return {
					ok: true,
					json: async () => ({ symbol: 'BTCUSDT', lastFundingRate: '0.0001', markPrice: '65000' }),
				};
			}
			if (String(url).includes('LongShortAccountRatio')) {
				return {
					ok: true,
					json: async () => [{ longAccount: '0.55', shortAccount: '0.45' }],
				};
			}
			return { ok: false, status: 404 };
		}));

		const snap = await fetchSentimentSnapshot(['BTCUSDT']);
		expect(snap.fearGreed).not.toBeNull();
		expect(snap.compositeScore).toBeGreaterThanOrEqual(0);
		expect(snap.compositeScore).toBeLessThanOrEqual(100);
		expect(snap.compositeLabel).toBeDefined();
		expect(['Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed']).toContain(snap.compositeLabel);
	});

	it('returns snapshot even when all APIs fail', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

		const snap = await fetchSentimentSnapshot();
		expect(snap.compositeScore).toBe(50); // fallback
		expect(snap.fearGreed).toBeNull();
		expect(snap.fundingRates).toHaveLength(0);
		expect(snap.longShort).toHaveLength(0);
	});
});

// ─── Tool integration ─────────────────────────────────────────────────────────

describe('get_sentiment tool', () => {
	it('tool is registered', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_sentiment');
		expect(tool).toBeDefined();
	});

	it('returns GaugeBlock and MetricCardBlock on success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
			if (String(url).includes('alternative.me')) {
				return {
					ok: true,
					json: async () => ({ data: [{ value: '65', value_classification: 'Greed' }, { value: '55', value_classification: 'Neutral' }] }),
				};
			}
			if (String(url).includes('premiumIndex')) {
				return {
					ok: true,
					json: async () => ({ symbol: 'BTCUSDT', lastFundingRate: '0.0001', markPrice: '65000' }),
				};
			}
			if (String(url).includes('LongShortAccountRatio')) {
				return {
					ok: true,
					json: async () => [{ longAccount: '0.60', shortAccount: '0.40' }],
				};
			}
			return { ok: false };
		}));

		// Import tool registry to get the tool
		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_sentiment');
		const result = await tool!.execute({});

		expect(result.success).toBe(true);
		expect(result.contentBlocks).toHaveLength(2);
		expect(result.contentBlocks[0].type).toBe('gauge');
		expect(result.contentBlocks[1].type).toBe('metric_card');

		const gauge = result.contentBlocks[0] as import('$lib/types/contentBlock').GaugeBlock;
		expect(gauge.value).toBeGreaterThanOrEqual(0);
		expect(gauge.value).toBeLessThanOrEqual(100);
		expect(gauge.thresholds.length).toBeGreaterThan(0);
	});

	it('still succeeds when all APIs fail', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_sentiment');
		const result = await tool!.execute({});

		expect(result.success).toBe(true);
		expect(result.contentBlocks[0].type).toBe('gauge');
		const gauge = result.contentBlocks[0] as import('$lib/types/contentBlock').GaugeBlock;
		expect(gauge.value).toBe(50); // neutral fallback
	});

	it('accepts custom symbols parameter', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_sentiment');
		const result = await tool!.execute({ symbols: 'SOLUSDT,BNBUSDT' });

		expect(result.success).toBe(true);
	});
});
