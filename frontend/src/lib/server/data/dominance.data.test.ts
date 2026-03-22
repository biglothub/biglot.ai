// Tests for dominance.data.ts — T-902

import { describe, it, expect } from 'vitest';
import {
	classifyMarketSentiment,
	sentimentLabel,
	sentimentDescription,
	buildDominanceSnapshot,
	fmtMarketCap,
	type GlobalMarketData,
} from './dominance.data';

// ─── Mock data builders ───────────────────────────────────────────────────────

function mockData(overrides: Partial<GlobalMarketData> = {}): GlobalMarketData {
	return {
		totalMarketCapUsd:         2_000_000_000_000,
		totalVolume24hUsd:           80_000_000_000,
		marketCapChangePercent24h:   1.5,
		btcDominance:                48,
		ethDominance:                18,
		altDominance:                34,
		activeCryptocurrencies:    12_000,
		markets:                     800,
		...overrides,
	};
}

// ─── classifyMarketSentiment ──────────────────────────────────────────────────

describe('classifyMarketSentiment', () => {
	it('returns risk_off when BTC dominance > 55%', () => {
		expect(classifyMarketSentiment(mockData({ btcDominance: 60, ethDominance: 15, altDominance: 25 }))).toBe('risk_off');
	});

	it('returns risk_off at exactly 56%', () => {
		expect(classifyMarketSentiment(mockData({ btcDominance: 56, ethDominance: 15, altDominance: 29 }))).toBe('risk_off');
	});

	it('returns alt_season when altDominance > 40%', () => {
		expect(classifyMarketSentiment(mockData({ btcDominance: 38, ethDominance: 18, altDominance: 44 }))).toBe('alt_season');
	});

	it('returns alt_season at exactly 41%', () => {
		expect(classifyMarketSentiment(mockData({ btcDominance: 40, ethDominance: 19, altDominance: 41 }))).toBe('alt_season');
	});

	it('returns eth_led when ETH dom > 20% and BTC dom < 48%', () => {
		expect(classifyMarketSentiment(mockData({ btcDominance: 45, ethDominance: 22, altDominance: 33 }))).toBe('eth_led');
	});

	it('returns btc_led for normal BTC-dominant market', () => {
		expect(classifyMarketSentiment(mockData({ btcDominance: 48, ethDominance: 18, altDominance: 34 }))).toBe('btc_led');
	});

	it('risk_off takes priority over alt_season', () => {
		// BTC dom > 55% wins even if alt dom > 40% (edge case)
		expect(classifyMarketSentiment(mockData({ btcDominance: 56, ethDominance: 2, altDominance: 42 }))).toBe('risk_off');
	});

	it('alt_season takes priority over eth_led', () => {
		expect(classifyMarketSentiment(mockData({ btcDominance: 35, ethDominance: 22, altDominance: 43 }))).toBe('alt_season');
	});
});

// ─── sentimentLabel ───────────────────────────────────────────────────────────

describe('sentimentLabel', () => {
	it('returns human-readable label for each sentiment', () => {
		expect(sentimentLabel('btc_led')).toBe('BTC-Led Market');
		expect(sentimentLabel('eth_led')).toBe('ETH-Led Market');
		expect(sentimentLabel('alt_season')).toBe('Alt Season');
		expect(sentimentLabel('risk_off')).toBe('Risk-Off (BTC Dominance)');
	});
});

// ─── sentimentDescription ─────────────────────────────────────────────────────

describe('sentimentDescription', () => {
	it('includes BTC dominance % for risk_off', () => {
		const data = mockData({ btcDominance: 60 });
		expect(sentimentDescription('risk_off', data)).toContain('60.0%');
	});

	it('includes alt dominance % for alt_season', () => {
		const data = mockData({ altDominance: 43 });
		expect(sentimentDescription('alt_season', data)).toContain('43.0%');
	});

	it('includes ETH dominance % for eth_led', () => {
		const data = mockData({ ethDominance: 22, btcDominance: 45 });
		expect(sentimentDescription('eth_led', data)).toContain('22.0%');
	});

	it('returns non-empty string for btc_led', () => {
		const data = mockData();
		expect(sentimentDescription('btc_led', data).length).toBeGreaterThan(0);
	});
});

// ─── buildDominanceSnapshot ───────────────────────────────────────────────────

describe('buildDominanceSnapshot', () => {
	it('enriches data with sentiment fields', async () => {
		const fetcher = async () => mockData({ btcDominance: 60, ethDominance: 15, altDominance: 25 });
		const snapshot = await buildDominanceSnapshot(fetcher);
		expect(snapshot.sentiment).toBe('risk_off');
		expect(snapshot.sentimentLabel).toBe('Risk-Off (BTC Dominance)');
		expect(snapshot.sentimentDescription.length).toBeGreaterThan(0);
	});

	it('correctly computes alt_season sentiment', async () => {
		const fetcher = async () => mockData({ btcDominance: 36, ethDominance: 18, altDominance: 46 });
		const snapshot = await buildDominanceSnapshot(fetcher);
		expect(snapshot.sentiment).toBe('alt_season');
		expect(snapshot.altDominance).toBe(46);
	});

	it('preserves all original market data fields', async () => {
		const raw = mockData();
		const snapshot = await buildDominanceSnapshot(async () => raw);
		expect(snapshot.totalMarketCapUsd).toBe(raw.totalMarketCapUsd);
		expect(snapshot.activeCryptocurrencies).toBe(raw.activeCryptocurrencies);
		expect(snapshot.markets).toBe(raw.markets);
	});

	it('propagates fetcher errors', async () => {
		const fetcher = async () => { throw new Error('API error'); };
		await expect(buildDominanceSnapshot(fetcher)).rejects.toThrow('API error');
	});
});

// ─── fmtMarketCap ─────────────────────────────────────────────────────────────

describe('fmtMarketCap', () => {
	it('formats trillions', () => {
		expect(fmtMarketCap(2_500_000_000_000)).toBe('$2.50T');
	});

	it('formats billions', () => {
		expect(fmtMarketCap(80_000_000_000)).toBe('$80.0B');
	});

	it('formats millions', () => {
		expect(fmtMarketCap(500_000_000)).toBe('$500.0M');
	});

	it('formats small values as plain USD', () => {
		expect(fmtMarketCap(1000)).toBe('$1,000');
	});
});
