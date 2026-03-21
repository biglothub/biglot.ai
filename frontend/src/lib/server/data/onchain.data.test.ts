// Tests for onchain.data.ts — T-204
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	classifyMVRV,
	classifyNVT,
	formatHashRate,
	fetchCoinMetrics,
	fetchBlockchainStats,
	fetchOnChainData,
} from './onchain.data';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('classifyMVRV', () => {
	it('returns Highly Overvalued above 3.7', () => {
		expect(classifyMVRV(4.0)).toBe('Highly Overvalued');
		expect(classifyMVRV(3.8)).toBe('Highly Overvalued');
	});

	it('returns Overvalued between 2.4 and 3.7', () => {
		expect(classifyMVRV(3.7)).toBe('Overvalued');
		expect(classifyMVRV(2.5)).toBe('Overvalued');
	});

	it('returns Fair Value between 1.5 and 2.4', () => {
		expect(classifyMVRV(2.4)).toBe('Fair Value');
		expect(classifyMVRV(1.6)).toBe('Fair Value');
	});

	it('returns Undervalued between 1.0 and 1.5', () => {
		expect(classifyMVRV(1.5)).toBe('Undervalued');
		expect(classifyMVRV(1.1)).toBe('Undervalued');
	});

	it('returns Deeply Undervalued at or below 1.0', () => {
		expect(classifyMVRV(1.0)).toBe('Deeply Undervalued');
		expect(classifyMVRV(0.5)).toBe('Deeply Undervalued');
	});
});

describe('classifyNVT', () => {
	it('returns Overvalued above 150', () => {
		expect(classifyNVT(200)).toBe('Overvalued (High NVT)');
		expect(classifyNVT(151)).toBe('Overvalued (High NVT)');
	});

	it('returns Neutral between 90 and 150', () => {
		expect(classifyNVT(150)).toBe('Neutral');
		expect(classifyNVT(100)).toBe('Neutral');
	});

	it('returns Fairly Valued between 45 and 90', () => {
		expect(classifyNVT(90)).toBe('Fairly Valued');
		expect(classifyNVT(50)).toBe('Fairly Valued');
	});

	it('returns Undervalued at or below 45', () => {
		expect(classifyNVT(45)).toBe('Undervalued (Low NVT)');
		expect(classifyNVT(20)).toBe('Undervalued (Low NVT)');
	});
});

describe('formatHashRate', () => {
	it('formats BTC hash rate in EH/s', () => {
		expect(formatHashRate(600, 'btc')).toBe('600.0 EH/s');
	});

	it('formats BTC hash rate in ZH/s when >= 1000', () => {
		expect(formatHashRate(1000, 'btc')).toBe('1.0 ZH/s');
		expect(formatHashRate(1500, 'btc')).toBe('1.5 ZH/s');
	});

	it('formats ETH hash rate in PH/s', () => {
		expect(formatHashRate(850, 'eth')).toBe('850.0 PH/s');
	});
});

// ─── fetchCoinMetrics ─────────────────────────────────────────────────────────

describe('fetchCoinMetrics', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns parsed metrics on success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: [{
					asset: 'btc',
					time: '2024-01-01T00:00:00Z',
					AdrActCnt: '950000',
					HashRate: '600000000000',
					NVTAdj: '75.5',
					CapMrktCurUSD: '1200000000000',
					CapRealUSD: '600000000000',
					TxCnt: '350000',
				}]
			})
		}));

		const result = await fetchCoinMetrics('btc');
		expect(result).not.toBeNull();
		expect(result!.AdrActCnt).toBe(950000);
		expect(result!.HashRate).toBe(600000000000);
		expect(result!.NVTAdj).toBe(75.5);
		expect(result!.CapMrktCurUSD).toBe(1200000000000);
		expect(result!.CapRealUSD).toBe(600000000000);
		expect(result!.TxCnt).toBe(350000);
	});

	it('returns null on HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 429 }));
		const result = await fetchCoinMetrics('btc');
		expect(result).toBeNull();
	});

	it('returns null when data array is empty', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({ data: [] })
		}));
		const result = await fetchCoinMetrics('btc');
		expect(result).toBeNull();
	});

	it('returns null on fetch error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network error')));
		const result = await fetchCoinMetrics('btc');
		expect(result).toBeNull();
	});

	it('skips null and empty string values', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: [{
					asset: 'btc',
					time: '2024-01-01T00:00:00Z',
					AdrActCnt: null,
					HashRate: '',
					NVTAdj: '75.5',
					CapMrktCurUSD: null,
					CapRealUSD: null,
					TxCnt: null,
				}]
			})
		}));

		const result = await fetchCoinMetrics('btc');
		expect(result).not.toBeNull();
		expect(result!.AdrActCnt).toBeUndefined();
		expect(result!.HashRate).toBeUndefined();
		expect(result!.NVTAdj).toBe(75.5);
	});

	it('works for eth asset', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: [{ asset: 'eth', time: '2024-01-01T00:00:00Z', AdrActCnt: '500000', HashRate: null, NVTAdj: '80', CapMrktCurUSD: null, CapRealUSD: null, TxCnt: '1200000' }]
			})
		}));

		const result = await fetchCoinMetrics('eth');
		expect(result!.AdrActCnt).toBe(500000);
		expect(result!.TxCnt).toBe(1200000);
	});
});

// ─── fetchBlockchainStats ─────────────────────────────────────────────────────

describe('fetchBlockchainStats', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns stats on success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				n_tx: 300000,
				n_unique_addresses: 800000,
				hash_rate: 550000000,
				total_fees_btc: 100,
				n_btc_mined: 900,
				blocks_size: 1000000
			})
		}));

		const result = await fetchBlockchainStats();
		expect(result).not.toBeNull();
		expect(result!.n_tx).toBe(300000);
		expect(result!.hash_rate).toBe(550000000);
	});

	it('returns null on HTTP error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));
		const result = await fetchBlockchainStats();
		expect(result).toBeNull();
	});

	it('returns null on fetch error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('timeout')));
		const result = await fetchBlockchainStats();
		expect(result).toBeNull();
	});
});

// ─── fetchOnChainData ─────────────────────────────────────────────────────────

describe('fetchOnChainData', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	const cmResponse = {
		ok: true,
		json: async () => ({
			data: [{
				asset: 'btc',
				time: '2024-01-01T00:00:00Z',
				AdrActCnt: '950000',
				HashRate: '600000000000', // GH/s → 600 EH/s after / 1e9
				NVTAdj: '75.5',
				CapMrktCurUSD: '1200000000000',
				CapRealUSD: '600000000000',
				TxCnt: '350000',
			}]
		})
	};

	it('returns full BTC snapshot using CoinMetrics data', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce(cmResponse)              // CoinMetrics
			.mockResolvedValueOnce({ ok: false })            // Blockchain.com fails
		);

		const snap = await fetchOnChainData('btc');
		expect(snap.asset).toBe('btc');
		expect(snap.activeAddresses).toBe(950000);
		expect(snap.hashRateEH).toBeCloseTo(600, 0);
		expect(snap.nvtRatio).toBe(75.5);
		expect(snap.mvrv).toBeCloseTo(2.0, 2); // 1.2T / 0.6T = 2.0
		expect(snap.transactions24h).toBe(350000);
		expect(snap.source).toBe('CoinMetrics Community');
	});

	it('falls back to Blockchain.com hash rate when CoinMetrics missing HashRate', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					data: [{
						asset: 'btc',
						time: '2024-01-01T00:00:00Z',
						AdrActCnt: '900000',
						HashRate: null,
						NVTAdj: null,
						CapMrktCurUSD: null,
						CapRealUSD: null,
						TxCnt: '300000',
					}]
				})
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					n_tx: 310000,
					n_unique_addresses: 800000,
					hash_rate: 550000000, // GH/s → 0.55 EH/s after /1e9
					total_fees_btc: 50,
					n_btc_mined: 900,
					blocks_size: 1000000
				})
			})
		);

		const snap = await fetchOnChainData('btc');
		expect(snap.hashRateEH).toBeCloseTo(0.55, 2);
		expect(snap.transactions24h).toBe(300000); // prefers CM TxCnt
	});

	it('uses Blockchain.com txn count as fallback when CM TxCnt missing', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					data: [{
						asset: 'btc',
						time: '2024-01-01T00:00:00Z',
						AdrActCnt: null,
						HashRate: null,
						NVTAdj: null,
						CapMrktCurUSD: null,
						CapRealUSD: null,
						TxCnt: null,
					}]
				})
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					n_tx: 310000,
					n_unique_addresses: 800000,
					hash_rate: 550000000,
					total_fees_btc: 50,
					n_btc_mined: 900,
					blocks_size: 1000000
				})
			})
		);

		const snap = await fetchOnChainData('btc');
		expect(snap.transactions24h).toBe(310000);
		// CM data was present (partial), so source is still CoinMetrics Community
		expect(snap.source).toBe('CoinMetrics Community');
	});

	it('returns unavailable source when all APIs fail', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockRejectedValueOnce(new Error('timeout'))
			.mockRejectedValueOnce(new Error('timeout'))
		);

		const snap = await fetchOnChainData('btc');
		expect(snap.source).toBe('unavailable');
		expect(snap.activeAddresses).toBeNull();
		expect(snap.hashRateEH).toBeNull();
		expect(snap.mvrv).toBeNull();
	});

	it('does not fetch Blockchain.com for ETH', async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: [{
					asset: 'eth',
					time: '2024-01-01T00:00:00Z',
					AdrActCnt: '500000',
					HashRate: '1000000000', // GH/s → 1000 TH/s after /1e6
					NVTAdj: '80',
					CapMrktCurUSD: '400000000000',
					CapRealUSD: '200000000000',
					TxCnt: '1200000',
				}]
			})
		});
		vi.stubGlobal('fetch', fetchMock);

		const snap = await fetchOnChainData('eth');
		expect(snap.asset).toBe('eth');
		expect(snap.hashRateEH).toBeCloseTo(1000, 0); // 1e9 / 1e6 = 1000 TH/s
		expect(fetchMock).toHaveBeenCalledTimes(1); // only CoinMetrics called
	});

	it('does not compute MVRV when CapRealUSD is zero', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					data: [{
						asset: 'btc',
						time: '2024-01-01T00:00:00Z',
						AdrActCnt: '900000',
						HashRate: '500000000000',
						NVTAdj: '70',
						CapMrktCurUSD: '1000000000000',
						CapRealUSD: '0',
						TxCnt: '300000',
					}]
				})
			})
			.mockResolvedValueOnce({ ok: false })
		);

		const snap = await fetchOnChainData('btc');
		expect(snap.mvrv).toBeNull();
	});

	it('defaults to btc when no asset provided', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce(cmResponse)
			.mockResolvedValueOnce({ ok: false })
		);

		const snap = await fetchOnChainData();
		expect(snap.asset).toBe('btc');
	});
});
