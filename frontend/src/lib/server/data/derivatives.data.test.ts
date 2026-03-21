// Tests for derivatives.data.ts — T-205
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	annualiseFundingRate,
	classifyFunding,
	formatUSD,
	fetchFundingRates,
	fetchOpenInterest,
	fetchLongShortRatios,
	fetchLiquidations,
	fetchDeribitOptions,
	fetchDerivativesSnapshot,
} from './derivatives.data';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

// Also import tool to register it (needed for full suite)
import '../tools/derivatives.tool';

beforeEach(() => {
	vi.restoreAllMocks();
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('annualiseFundingRate', () => {
	it('converts 0.01% (0.0001) funding to ~10.95% annually', () => {
		expect(annualiseFundingRate(0.0001)).toBeCloseTo(10.95, 1);
	});

	it('returns 0 for zero rate', () => {
		expect(annualiseFundingRate(0)).toBe(0);
	});

	it('handles negative funding rates', () => {
		expect(annualiseFundingRate(-0.0001)).toBeCloseTo(-10.95, 1);
	});

	it('handles high funding (0.001 → ~109.5%)', () => {
		expect(annualiseFundingRate(0.001)).toBeCloseTo(109.5, 0);
	});
});

describe('classifyFunding', () => {
	it('classifies extreme greed above 100%', () => {
		expect(classifyFunding(150)).toBe('Extreme greed');
		expect(classifyFunding(101)).toBe('Extreme greed');
	});

	it('classifies bullish between 30% and 100%', () => {
		expect(classifyFunding(100)).toBe('Bullish');
		expect(classifyFunding(50)).toBe('Bullish');
		expect(classifyFunding(31)).toBe('Bullish');
	});

	it('classifies neutral between -10% and 30%', () => {
		expect(classifyFunding(30)).toBe('Neutral');
		expect(classifyFunding(0)).toBe('Neutral');
		expect(classifyFunding(-9)).toBe('Neutral');
	});

	it('classifies bearish between -50% and -10%', () => {
		expect(classifyFunding(-10)).toBe('Bearish');
		expect(classifyFunding(-30)).toBe('Bearish');
		expect(classifyFunding(-49)).toBe('Bearish');
	});

	it('classifies extreme fear below -50%', () => {
		expect(classifyFunding(-50)).toBe('Extreme fear');
		expect(classifyFunding(-100)).toBe('Extreme fear');
	});
});

describe('formatUSD', () => {
	it('formats billions', () => {
		expect(formatUSD(2_500_000_000)).toBe('$2.50B');
	});

	it('formats millions', () => {
		expect(formatUSD(1_234_567)).toBe('$1.23M');
	});

	it('formats thousands', () => {
		expect(formatUSD(5_500)).toBe('$5.50K');
	});

	it('formats small values', () => {
		expect(formatUSD(99.99)).toBe('$99.99');
	});
});

// ─── fetchFundingRates ────────────────────────────────────────────────────────

describe('fetchFundingRates', () => {
	it('returns funding rates for symbols', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ symbol: 'BTCUSDT', lastFundingRate: '0.0001' })
		}));

		const result = await fetchFundingRates(['BTCUSDT']);
		expect(result).toHaveLength(1);
		expect(result[0].symbol).toBe('BTCUSDT');
		expect(result[0].rate).toBeCloseTo(0.0001);
		expect(result[0].annualised).toBeCloseTo(10.95, 0);
	});

	it('skips symbols on HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
		const result = await fetchFundingRates(['BTCUSDT']);
		expect(result).toHaveLength(0);
	});

	it('skips symbols on network error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
		const result = await fetchFundingRates(['BTCUSDT']);
		expect(result).toHaveLength(0);
	});

	it('returns multiple symbols when all succeed', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ symbol: 'BTCUSDT', lastFundingRate: '0.0001' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ symbol: 'ETHUSDT', lastFundingRate: '0.0002' }) })
		);

		const result = await fetchFundingRates(['BTCUSDT', 'ETHUSDT']);
		expect(result).toHaveLength(2);
	});

	it('handles empty symbols array', async () => {
		const result = await fetchFundingRates([]);
		expect(result).toHaveLength(0);
	});
});

// ─── fetchOpenInterest ────────────────────────────────────────────────────────

describe('fetchOpenInterest', () => {
	it('returns OI for symbol', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({ symbol: 'BTCUSDT', openInterest: '50000', sumOpenInterestValue: '5000000000' })
		}));

		const result = await fetchOpenInterest(['BTCUSDT']);
		expect(result).toHaveLength(1);
		expect(result[0].openInterestCoin).toBe(50000);
		expect(result[0].openInterestUSD).toBe(5_000_000_000);
	});

	it('skips on HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 429 }));
		const result = await fetchOpenInterest(['BTCUSDT']);
		expect(result).toHaveLength(0);
	});

	it('skips on network error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('timeout')));
		const result = await fetchOpenInterest(['BTCUSDT']);
		expect(result).toHaveLength(0);
	});
});

// ─── fetchLongShortRatios ─────────────────────────────────────────────────────

describe('fetchLongShortRatios', () => {
	it('returns L/S ratios', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => [{ symbol: 'BTCUSDT', longAccount: '0.55', shortAccount: '0.45' }]
		}));

		const result = await fetchLongShortRatios(['BTCUSDT']);
		expect(result).toHaveLength(1);
		expect(result[0].longPct).toBeCloseTo(0.55);
		expect(result[0].shortPct).toBeCloseTo(0.45);
	});

	it('skips when empty response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [] }));
		const result = await fetchLongShortRatios(['BTCUSDT']);
		expect(result).toHaveLength(0);
	});

	it('skips on HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }));
		const result = await fetchLongShortRatios(['BTCUSDT']);
		expect(result).toHaveLength(0);
	});
});

// ─── fetchLiquidations ────────────────────────────────────────────────────────

describe('fetchLiquidations', () => {
	it('aggregates long and short liquidations', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => [
				{ symbol: 'BTCUSDT', side: 'SELL', origQty: '1', price: '50000' },  // long liq
				{ symbol: 'BTCUSDT', side: 'SELL', origQty: '2', price: '50000' },  // long liq
				{ symbol: 'BTCUSDT', side: 'BUY',  origQty: '1', price: '50000' },  // short liq
			]
		}));

		const result = await fetchLiquidations(['BTCUSDT']);
		expect(result).toHaveLength(1);
		expect(result[0].longLiqUSD).toBe(150_000);   // 3 * 50000
		expect(result[0].shortLiqUSD).toBe(50_000);   // 1 * 50000
	});

	it('returns zero liq on empty response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [] }));
		const result = await fetchLiquidations(['BTCUSDT']);
		expect(result[0].longLiqUSD).toBe(0);
		expect(result[0].shortLiqUSD).toBe(0);
	});

	it('skips on HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }));
		const result = await fetchLiquidations(['BTCUSDT']);
		expect(result).toHaveLength(0);
	});
});

// ─── fetchDeribitOptions ──────────────────────────────────────────────────────

describe('fetchDeribitOptions', () => {
	const makeDeribitResponse = (instruments: Array<{ name: string; oi: number }>) => ({
		ok: true,
		json: async () => ({
			result: instruments.map(({ name, oi }) => ({
				instrument_name: name,
				open_interest: oi,
				underlying_price: 90000,
			}))
		})
	});

	it('returns put/call ratio and max pain', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
			makeDeribitResponse([
				{ name: 'BTC-28MAR25-90000-C', oi: 100 },
				{ name: 'BTC-28MAR25-90000-P', oi: 60 },
				{ name: 'BTC-28MAR25-95000-C', oi: 50 },
				{ name: 'BTC-28MAR25-85000-P', oi: 40 },
			])
		));

		const result = await fetchDeribitOptions();
		expect(result).not.toBeNull();
		expect(result!.totalCallOI).toBe(150);
		expect(result!.totalPutOI).toBe(100);
		expect(result!.putCallRatio).toBeCloseTo(100 / 150, 3);
		expect(result!.maxPain).toBeTypeOf('number');
	});

	it('returns null on HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }));
		const result = await fetchDeribitOptions();
		expect(result).toBeNull();
	});

	it('returns null on network error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('timeout')));
		const result = await fetchDeribitOptions();
		expect(result).toBeNull();
	});

	it('returns null when result is empty', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({ result: [] })
		}));
		const result = await fetchDeribitOptions();
		expect(result).toBeNull();
	});

	it('skips malformed instrument names', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
			makeDeribitResponse([
				{ name: 'BTC-28MAR25-90000-C', oi: 100 },
				{ name: 'MALFORMED', oi: 999 },
			])
		));

		const result = await fetchDeribitOptions();
		expect(result!.totalCallOI).toBe(100);
	});

	it('putCallRatio is null when no calls', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
			makeDeribitResponse([
				{ name: 'BTC-28MAR25-90000-P', oi: 100 },
			])
		));

		const result = await fetchDeribitOptions();
		expect(result!.putCallRatio).toBeNull();
	});
});

// ─── fetchDerivativesSnapshot ─────────────────────────────────────────────────

describe('fetchDerivativesSnapshot', () => {
	it('aggregates all sources for BTC', async () => {
		vi.stubGlobal('fetch', vi.fn()
			// funding
			.mockResolvedValueOnce({ ok: true, json: async () => ({ symbol: 'BTCUSDT', lastFundingRate: '0.0001' }) })
			// OI
			.mockResolvedValueOnce({ ok: true, json: async () => ({ symbol: 'BTCUSDT', openInterest: '100', sumOpenInterestValue: '10000000' }) })
			// L/S
			.mockResolvedValueOnce({ ok: true, json: async () => [{ symbol: 'BTCUSDT', longAccount: '0.52', shortAccount: '0.48' }] })
			// liquidations
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
			// Deribit options
			.mockResolvedValueOnce({ ok: true, json: async () => ({
				result: [
					{ instrument_name: 'BTC-28MAR25-90000-C', open_interest: 100, underlying_price: 90000 },
					{ instrument_name: 'BTC-28MAR25-90000-P', open_interest: 50, underlying_price: 90000 },
				]
			}) })
		);

		const snap = await fetchDerivativesSnapshot(['BTCUSDT']);
		expect(snap.fundingRates).toHaveLength(1);
		expect(snap.openInterest).toHaveLength(1);
		expect(snap.longShortRatios).toHaveLength(1);
		expect(snap.options).not.toBeNull();
		expect(snap.options!.putCallRatio).toBeCloseTo(0.5, 2);
	});

	it('does not fetch Deribit options for ETH-only symbols', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ symbol: 'ETHUSDT', lastFundingRate: '0.0001' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ symbol: 'ETHUSDT', openInterest: '100', sumOpenInterestValue: '200000' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => [{ symbol: 'ETHUSDT', longAccount: '0.50', shortAccount: '0.50' }] })
			.mockResolvedValueOnce({ ok: true, json: async () => [] });
		vi.stubGlobal('fetch', fetchMock);

		const snap = await fetchDerivativesSnapshot(['ETHUSDT']);
		expect(snap.options).toBeNull();
		// 4 calls: funding + OI + L/S + liquidations (no Deribit)
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('returns empty arrays when all sources fail', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

		const snap = await fetchDerivativesSnapshot(['BTCUSDT']);
		expect(snap.fundingRates).toHaveLength(0);
		expect(snap.openInterest).toHaveLength(0);
		expect(snap.longShortRatios).toHaveLength(0);
		expect(snap.options).toBeNull();
	});
});

// ─── Tool registration ─────────────────────────────────────────────────────────

describe('get_derivatives_data tool', () => {
	it('is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('get_derivatives_data')).toBeDefined();
	});

	it('returns error block when all sources fail', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));
		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_derivatives_data')!;
		const result = await tool.execute({});
		expect(result.success).toBe(false);
	});

	it('returns MetricCardBlock on success', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ symbol: 'BTCUSDT', lastFundingRate: '0.0001' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ symbol: 'BTCUSDT', openInterest: '100', sumOpenInterestValue: '10000000' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => [{ symbol: 'BTCUSDT', longAccount: '0.52', shortAccount: '0.48' }] })
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
			.mockResolvedValueOnce({ ok: false })  // Deribit fails → no options block
		);

		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_derivatives_data')!;
		const result = await tool.execute({ symbols: 'BTCUSDT' });
		expect(result.success).toBe(true);
		const metricBlock = result.contentBlocks.find(b => b.type === 'metric_card');
		expect(metricBlock).toBeDefined();
	});
});
