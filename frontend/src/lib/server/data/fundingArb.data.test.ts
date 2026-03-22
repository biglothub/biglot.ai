// Funding Rate Arbitrage Scanner Tests — T-1103

import { describe, it, expect, vi } from 'vitest';
import {
	annualise8h,
	buildArbOpportunity,
	buildFundingArbSnapshot,
	FUNDING_PERIODS_PER_YEAR,
	DEFAULT_MIN_CARRY_PCT,
	DEFAULT_SYMBOLS,
	type PremiumIndexEntry,
	type PremiumIndexFetcher,
} from './fundingArb.data';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BTC_ENTRY: PremiumIndexEntry = {
	symbol:          'BTCUSDT',
	markPrice:       50_100,
	indexPrice:      50_000,
	lastFundingRate: 0.0001,    // 0.01% per 8h → ~10.95% p.a.
	nextFundingTime: Date.now() + 8 * 60 * 60 * 1000,
};

const ETH_ENTRY: PremiumIndexEntry = {
	symbol:          'ETHUSDT',
	markPrice:       2_990,
	indexPrice:      3_000,     // negative basis (perp < spot)
	lastFundingRate: -0.0001,   // negative funding
	nextFundingTime: Date.now() + 4 * 60 * 60 * 1000,
};

const FLAT_ENTRY: PremiumIndexEntry = {
	symbol:          'SOLUSDT',
	markPrice:       100,
	indexPrice:      100,
	lastFundingRate: 0,
	nextFundingTime: Date.now(),
};

// ─── annualise8h ──────────────────────────────────────────────────────────────

describe('annualise8h', () => {
	it('annualises 0.0001 to ~10.95%', () => {
		// 0.0001 * 1095 * 100 = 10.95
		expect(annualise8h(0.0001)).toBeCloseTo(10.95, 1);
	});

	it('returns 0 for zero rate', () => {
		expect(annualise8h(0)).toBe(0);
	});

	it('handles negative rates', () => {
		expect(annualise8h(-0.0001)).toBeCloseTo(-10.95, 1);
	});

	it('uses FUNDING_PERIODS_PER_YEAR constant', () => {
		expect(FUNDING_PERIODS_PER_YEAR).toBe(1095);
		expect(annualise8h(0.001)).toBeCloseTo(109.5, 0);
	});
});

// ─── buildArbOpportunity ──────────────────────────────────────────────────────

describe('buildArbOpportunity', () => {
	it('computes positive funding correctly', () => {
		const opp = buildArbOpportunity(BTC_ENTRY);
		expect(opp.symbol).toBe('BTCUSDT');
		expect(opp.fundingRateRaw).toBe(0.0001);
		expect(opp.fundingAnn).toBeCloseTo(10.95, 1);
	});

	it('computes basisPct correctly', () => {
		// (50100 - 50000) / 50000 * 100 = 0.2%
		const opp = buildArbOpportunity(BTC_ENTRY);
		expect(opp.basisPct).toBeCloseTo(0.2, 4);
	});

	it('computes basisAnn = basisPct * 1095', () => {
		const opp = buildArbOpportunity(BTC_ENTRY);
		expect(opp.basisAnn).toBeCloseTo(0.2 * 1095, 1);
	});

	it('computes carryAnn = fundingAnn - basisAnn', () => {
		const opp = buildArbOpportunity(BTC_ENTRY);
		expect(opp.carryAnn).toBeCloseTo(opp.fundingAnn - opp.basisAnn, 8);
	});

	it('positive carry for high funding / low basis', () => {
		const highFunding: PremiumIndexEntry = {
			symbol:          'XUSDT',
			markPrice:       100.01,
			indexPrice:      100,
			lastFundingRate: 0.001,  // 109.5% p.a.
			nextFundingTime: 0,
		};
		const opp = buildArbOpportunity(highFunding);
		expect(opp.direction).toBe('positive');
		expect(opp.carryAnn).toBeGreaterThan(0);
	});

	it('negative carry when funding is very negative with near-zero basis', () => {
		// Large negative funding, perp price ≈ spot → very negative carry
		const negFunding: PremiumIndexEntry = {
			symbol:          'ETHUSDT',
			markPrice:       3_000,     // no basis
			indexPrice:      3_000,
			lastFundingRate: -0.001,    // -109.5% p.a.
			nextFundingTime: 0,
		};
		const opp = buildArbOpportunity(negFunding);
		expect(opp.direction).toBe('negative');
		expect(opp.carryAnn).toBeLessThan(0);
	});

	it('neutral direction for zero funding rate and zero basis', () => {
		const opp = buildArbOpportunity(FLAT_ENTRY);
		expect(opp.direction).toBe('neutral');
		expect(opp.carryAnn).toBe(0);
	});

	it('handles zero indexPrice gracefully', () => {
		const zeroIndex: PremiumIndexEntry = {
			symbol:          'XUSDT',
			markPrice:       100,
			indexPrice:      0,
			lastFundingRate: 0.0001,
			nextFundingTime: 0,
		};
		const opp = buildArbOpportunity(zeroIndex);
		expect(opp.basisPct).toBe(0); // guard against division by zero
	});

	it('strategy string contains symbol base', () => {
		const opp = buildArbOpportunity(BTC_ENTRY);
		expect(opp.strategy).toContain('BTC');
	});

	it('positive carry strategy mentions "Short perp"', () => {
		const highFunding: PremiumIndexEntry = {
			symbol:          'BTCUSDT',
			markPrice:       50_000,
			indexPrice:      50_000,
			lastFundingRate: 0.001,  // very high funding
			nextFundingTime: 0,
		};
		const opp = buildArbOpportunity(highFunding);
		expect(opp.strategy).toMatch(/Short perp/i);
	});

	it('markPrice and indexPrice are preserved', () => {
		const opp = buildArbOpportunity(BTC_ENTRY);
		expect(opp.markPrice).toBe(50_100);
		expect(opp.indexPrice).toBe(50_000);
	});
});

// ─── buildFundingArbSnapshot ──────────────────────────────────────────────────

describe('buildFundingArbSnapshot', () => {
	const mockEntries: PremiumIndexEntry[] = [
		{
			symbol:          'BTCUSDT',
			markPrice:       50_100,
			indexPrice:      50_000,
			lastFundingRate: 0.0005,  // high funding → ~54.75% p.a.
			nextFundingTime: 0,
		},
		{
			symbol:          'ETHUSDT',
			markPrice:       2_990,
			indexPrice:      3_000,
			lastFundingRate: -0.0003,  // negative funding
			nextFundingTime: 0,
		},
		{
			symbol:          'SOLUSDT',
			markPrice:       100,
			indexPrice:      100,
			lastFundingRate: 0.00001, // tiny funding → ~1% p.a. — below threshold
			nextFundingTime: 0,
		},
	];

	const mockFetcher: PremiumIndexFetcher = vi.fn().mockResolvedValue(mockEntries);

	it('returns snapshot with correct symbolsScanned', async () => {
		const snap = await buildFundingArbSnapshot(DEFAULT_SYMBOLS, DEFAULT_MIN_CARRY_PCT, mockFetcher);
		expect(snap.symbolsScanned).toBe(3);
	});

	it('filters to opportunities above minCarryPct', async () => {
		const snap = await buildFundingArbSnapshot(DEFAULT_SYMBOLS, DEFAULT_MIN_CARRY_PCT, mockFetcher);
		snap.opportunities.forEach(o => {
			expect(Math.abs(o.carryAnn)).toBeGreaterThanOrEqual(DEFAULT_MIN_CARRY_PCT);
		});
	});

	it('excludes below-threshold symbols', async () => {
		const snap = await buildFundingArbSnapshot(DEFAULT_SYMBOLS, DEFAULT_MIN_CARRY_PCT, mockFetcher);
		const symbols = snap.opportunities.map(o => o.symbol);
		expect(symbols).not.toContain('SOLUSDT'); // ~1% carry — below threshold
	});

	it('sorts by absolute carry descending', async () => {
		const snap = await buildFundingArbSnapshot(DEFAULT_SYMBOLS, DEFAULT_MIN_CARRY_PCT, mockFetcher);
		for (let i = 1; i < snap.opportunities.length; i++) {
			expect(Math.abs(snap.opportunities[i].carryAnn))
				.toBeLessThanOrEqual(Math.abs(snap.opportunities[i - 1].carryAnn));
		}
	});

	it('bestOpportunity is the first (highest |carry|)', async () => {
		const snap = await buildFundingArbSnapshot(DEFAULT_SYMBOLS, DEFAULT_MIN_CARRY_PCT, mockFetcher);
		if (snap.bestOpportunity && snap.opportunities.length > 0) {
			expect(snap.bestOpportunity.symbol).toBe(snap.opportunities[0].symbol);
		}
	});

	it('counts positive and negative correctly', async () => {
		const snap = await buildFundingArbSnapshot(DEFAULT_SYMBOLS, DEFAULT_MIN_CARRY_PCT, mockFetcher);
		const positive = snap.opportunities.filter(o => o.direction === 'positive').length;
		const negative = snap.opportunities.filter(o => o.direction === 'negative').length;
		expect(snap.positiveCount).toBe(positive);
		expect(snap.negativeCount).toBe(negative);
	});

	it('bestOpportunity is null when no opps above threshold', async () => {
		const allFlat: PremiumIndexEntry[] = [
			{ symbol: 'BTCUSDT', markPrice: 100, indexPrice: 100, lastFundingRate: 0.00001, nextFundingTime: 0 },
		];
		const fetcher: PremiumIndexFetcher = vi.fn().mockResolvedValue(allFlat);
		const snap = await buildFundingArbSnapshot(DEFAULT_SYMBOLS, DEFAULT_MIN_CARRY_PCT, fetcher);
		expect(snap.bestOpportunity).toBeNull();
		expect(snap.opportunities).toHaveLength(0);
	});

	it('uses custom minCarryPct threshold', async () => {
		// With threshold = 0, SOLUSDT should also appear
		const snap = await buildFundingArbSnapshot(DEFAULT_SYMBOLS, 0, mockFetcher);
		const symbols = snap.opportunities.map(o => o.symbol);
		expect(symbols).toContain('SOLUSDT');
	});

	it('propagates minCarryThreshold into snapshot', async () => {
		const snap = await buildFundingArbSnapshot(DEFAULT_SYMBOLS, 20, mockFetcher);
		expect(snap.minCarryThreshold).toBe(20);
	});

	it('throws when fetcher rejects', async () => {
		const errorFetcher: PremiumIndexFetcher = vi.fn().mockRejectedValue(new Error('API error'));
		await expect(
			buildFundingArbSnapshot(DEFAULT_SYMBOLS, DEFAULT_MIN_CARRY_PCT, errorFetcher)
		).rejects.toThrow('API error');
	});

	it('handles empty response from fetcher', async () => {
		const emptyFetcher: PremiumIndexFetcher = vi.fn().mockResolvedValue([]);
		const snap = await buildFundingArbSnapshot(DEFAULT_SYMBOLS, DEFAULT_MIN_CARRY_PCT, emptyFetcher);
		expect(snap.symbolsScanned).toBe(0);
		expect(snap.opportunities).toHaveLength(0);
		expect(snap.bestOpportunity).toBeNull();
	});
});

// ─── DEFAULT_SYMBOLS ──────────────────────────────────────────────────────────

describe('DEFAULT_SYMBOLS', () => {
	it('has 20 symbols', () => {
		expect(DEFAULT_SYMBOLS).toHaveLength(20);
	});

	it('all symbols end with USDT', () => {
		DEFAULT_SYMBOLS.forEach(s => expect(s).toMatch(/USDT$/));
	});

	it('includes major symbols', () => {
		expect(DEFAULT_SYMBOLS).toContain('BTCUSDT');
		expect(DEFAULT_SYMBOLS).toContain('ETHUSDT');
		expect(DEFAULT_SYMBOLS).toContain('SOLUSDT');
	});
});
