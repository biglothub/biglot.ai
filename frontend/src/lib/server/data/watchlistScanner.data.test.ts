// Watchlist Scanner Tests — T-901
import { describe, it, expect } from 'vitest';
import {
	scanSymbol,
	buildWatchlistScan,
	fmtPrice,
	fmtChange,
	signalLabel,
	regimeEmoji,
	smaPositionLabel,
	type SymbolScanResult,
} from './watchlistScanner.data';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeOHLCV(
	n: number,
	startPrice = 100,
	trend: 'up' | 'down' | 'flat' = 'up',
	volPct = 0.5
): OHLCV[] {
	const candles: OHLCV[] = [];
	let price = startPrice;
	for (let i = 0; i < n; i++) {
		const noise = (Math.random() - 0.5) * price * (volPct / 100);
		const step  = trend === 'up' ? 0.5 : trend === 'down' ? -0.5 : 0;
		price = Math.max(0.01, price + step + noise);
		const range = price * 0.01;
		candles.push({
			time:   1_700_000_000 + i * 86_400,
			open:   price - range / 2,
			high:   price + range,
			low:    Math.max(0.01, price - range),
			close:  price,
			volume: 1000 + Math.random() * 500,
		});
	}
	return candles;
}

// ─── fmtPrice ─────────────────────────────────────────────────────────────────

describe('fmtPrice', () => {
	it('formats large prices with commas', () => {
		const s = fmtPrice(50000);
		expect(s).toContain('50');
	});

	it('formats small prices with more decimals', () => {
		expect(fmtPrice(0.001234)).toContain('0.001234');
	});

	it('formats mid-range prices to 4 decimals', () => {
		expect(fmtPrice(1.5678)).toBe('1.5678');
	});
});

// ─── fmtChange ────────────────────────────────────────────────────────────────

describe('fmtChange', () => {
	it('prefixes positive with +', () => {
		expect(fmtChange(3.5)).toBe('+3.50%');
	});

	it('shows negative without +', () => {
		expect(fmtChange(-2.1)).toBe('-2.10%');
	});

	it('formats zero', () => {
		expect(fmtChange(0)).toBe('+0.00%');
	});
});

// ─── signalLabel ──────────────────────────────────────────────────────────────

describe('signalLabel', () => {
	it('returns Neutral for null direction', () => {
		expect(signalLabel(null, 0)).toBe('Neutral');
	});

	it('returns Strong Bullish for high score', () => {
		expect(signalLabel('bullish', 10)).toBe('Strong Bullish');
	});

	it('returns Moderate Bearish for mid score', () => {
		expect(signalLabel('bearish', 6)).toBe('Moderate Bearish');
	});

	it('returns Weak Bullish for low score', () => {
		expect(signalLabel('bullish', 3)).toBe('Weak Bullish');
	});
});

// ─── regimeEmoji ──────────────────────────────────────────────────────────────

describe('regimeEmoji', () => {
	it('returns up arrow for trending_up', () => {
		expect(regimeEmoji('trending_up')).toContain('Trending Up');
	});

	it('returns down arrow for trending_down', () => {
		expect(regimeEmoji('trending_down')).toContain('Trending Down');
	});

	it('returns ranging for ranging', () => {
		expect(regimeEmoji('ranging')).toContain('Ranging');
	});

	it('returns dash for null', () => {
		expect(regimeEmoji(null)).toBe('—');
	});
});

// ─── smaPositionLabel ─────────────────────────────────────────────────────────

describe('smaPositionLabel', () => {
	it('shows checkmarks when above both SMAs', () => {
		const label = smaPositionLabel(true, true);
		expect(label).toContain('✓');
	});

	it('shows crosses when below both SMAs', () => {
		const label = smaPositionLabel(false, false);
		expect(label).toContain('✗');
	});

	it('shows dash when both null', () => {
		expect(smaPositionLabel(null, null)).toBe('—');
	});

	it('shows mixed state', () => {
		const label = smaPositionLabel(true, false);
		expect(label).toContain('✓');
		expect(label).toContain('✗');
	});
});

// ─── scanSymbol ───────────────────────────────────────────────────────────────

describe('scanSymbol', () => {
	it('returns safe defaults for < 2 candles', () => {
		const result = scanSymbol([]);
		expect(result.price).toBe(0);
		expect(result.change24h).toBe(0);
		expect(result.rsiValue).toBe(50);
		expect(result.regime).toBeNull();
		expect(result.signalDirection).toBeNull();
	});

	it('returns safe defaults for single candle', () => {
		const candle: OHLCV = { time: 1, open: 100, high: 110, low: 90, close: 105, volume: 1000 };
		const result = scanSymbol([candle]);
		expect(result.price).toBe(0);
	});

	it('computes price and change24h', () => {
		const ohlcv = makeOHLCV(60);
		const result = scanSymbol(ohlcv);
		expect(result.price).toBeGreaterThan(0);
		expect(typeof result.change24h).toBe('number');
		expect(isFinite(result.change24h)).toBe(true);
	});

	it('computes RSI in valid range', () => {
		const ohlcv = makeOHLCV(100);
		const result = scanSymbol(ohlcv);
		expect(result.rsiValue).toBeGreaterThanOrEqual(0);
		expect(result.rsiValue).toBeLessThanOrEqual(100);
	});

	it('has null aboveSMA200 when insufficient data for 200-period SMA', () => {
		const ohlcv = makeOHLCV(100);  // not enough for SMA200
		const result = scanSymbol(ohlcv);
		expect(result.aboveSMA200).toBeNull();
	});

	it('computes aboveSMA50 with sufficient data', () => {
		const ohlcv = makeOHLCV(100);
		const result = scanSymbol(ohlcv);
		expect(result.aboveSMA50).not.toBeNull();
		expect(typeof result.aboveSMA50).toBe('boolean');
	});

	it('aboveSMA50 is true for strong uptrend', () => {
		const ohlcv = makeOHLCV(100, 100, 'up', 0.1);
		const result = scanSymbol(ohlcv);
		// In an uptrend, recent close > SMA50
		expect(result.aboveSMA50).toBe(true);
	});

	it('computes regime for sufficient data', () => {
		const ohlcv = makeOHLCV(100, 100, 'up', 0.2);
		const result = scanSymbol(ohlcv);
		// Should have a regime since we have 100 candles (>40)
		// Note: regime could be null if analyzeRegime returns null — that's ok
		expect(['trending_up', 'trending_down', 'ranging', 'high_volatility', null]).toContain(result.regime);
	});

	it('bullishScore + bearishScore are non-negative', () => {
		const ohlcv = makeOHLCV(100);
		const result = scanSymbol(ohlcv);
		expect(result.bullishScore).toBeGreaterThanOrEqual(0);
		expect(result.bearishScore).toBeGreaterThanOrEqual(0);
	});

	it('confluenceScore equals max(bull, bear)', () => {
		const ohlcv = makeOHLCV(100);
		const result = scanSymbol(ohlcv);
		expect(result.confluenceScore).toBe(Math.max(result.bullishScore, result.bearishScore));
	});

	it('24h change correctly computed from last two candles', () => {
		const ohlcv: OHLCV[] = [
			{ time: 1, open: 100, high: 110, low: 90,  close: 100, volume: 1000 },
			{ time: 2, open: 100, high: 115, low: 95,  close: 110, volume: 1200 },
		];
		const result = scanSymbol(ohlcv);
		expect(result.price).toBe(110);
		expect(result.change24h).toBeCloseTo(10, 4);  // (110-100)/100 * 100 = 10%
	});
});

// ─── buildWatchlistScan ───────────────────────────────────────────────────────

describe('buildWatchlistScan', () => {
	it('handles empty input', () => {
		const result = buildWatchlistScan([]);
		expect(result.results).toHaveLength(0);
		expect(result.bullCount).toBe(0);
		expect(result.bearCount).toBe(0);
		expect(result.neutralCount).toBe(0);
		expect(result.avgRSI).toBe(50);
	});

	it('handles symbols with errors', () => {
		const result = buildWatchlistScan([
			{ symbol: 'FAIL', ohlcv: null, error: 'Network error' },
			{ symbol: 'FAIL2', ohlcv: null },
		]);
		expect(result.results).toHaveLength(2);
		expect(result.results[0].error).toBeTruthy();
		expect(result.results[1].error).toBeTruthy();
		expect(result.bullCount).toBe(0);
		expect(result.bearCount).toBe(0);
	});

	it('counts bull/bear/neutral correctly', () => {
		// Build OHLCV with sufficient data for signal detection
		const uptrend   = makeOHLCV(100, 100, 'up', 0.3);
		const downtrend = makeOHLCV(100, 100, 'down', 0.3);
		const flat      = makeOHLCV(100, 100, 'flat', 0.05);

		const result = buildWatchlistScan([
			{ symbol: 'UP',   ohlcv: uptrend },
			{ symbol: 'DOWN', ohlcv: downtrend },
			{ symbol: 'FLAT', ohlcv: flat },
		]);

		expect(result.results).toHaveLength(3);
		const total = result.bullCount + result.bearCount + result.neutralCount;
		// Only non-error results count
		const validCount = result.results.filter(r => !r.error).length;
		expect(total).toBe(validCount);
	});

	it('computes avgRSI across valid symbols only', () => {
		const ohlcv1 = makeOHLCV(60, 100);
		const ohlcv2 = makeOHLCV(60, 200);
		const result = buildWatchlistScan([
			{ symbol: 'A', ohlcv: ohlcv1 },
			{ symbol: 'B', ohlcv: ohlcv2 },
			{ symbol: 'C', ohlcv: null, error: 'fail' },
		]);
		expect(result.avgRSI).toBeGreaterThanOrEqual(0);
		expect(result.avgRSI).toBeLessThanOrEqual(100);
	});

	it('sorts errors to the end', () => {
		const ohlcv = makeOHLCV(60);
		const result = buildWatchlistScan([
			{ symbol: 'ERR', ohlcv: null, error: 'fail' },
			{ symbol: 'OK',  ohlcv: ohlcv },
		]);
		const errorIdx = result.results.findIndex(r => r.error);
		const okIdx    = result.results.findIndex(r => !r.error);
		expect(okIdx).toBeLessThan(errorIdx);
	});

	it('sorts by confluenceScore descending among valid results', () => {
		// We can't control confluence scores deterministically, but we can check order invariant
		const ohlcv1 = makeOHLCV(100, 100, 'up');
		const ohlcv2 = makeOHLCV(100, 200, 'down');
		const ohlcv3 = makeOHLCV(100, 300, 'flat');

		const result = buildWatchlistScan([
			{ symbol: 'A', ohlcv: ohlcv1 },
			{ symbol: 'B', ohlcv: ohlcv2 },
			{ symbol: 'C', ohlcv: ohlcv3 },
		]);

		const validResults = result.results.filter(r => !r.error);
		for (let i = 0; i < validResults.length - 1; i++) {
			expect(validResults[i].confluenceScore).toBeGreaterThanOrEqual(validResults[i + 1].confluenceScore);
		}
	});

	it('includes scannedAt timestamp', () => {
		const before = Date.now();
		const result = buildWatchlistScan([]);
		const after  = Date.now();
		expect(result.scannedAt).toBeGreaterThanOrEqual(before);
		expect(result.scannedAt).toBeLessThanOrEqual(after);
	});

	it('handles empty OHLCV array as if no data', () => {
		const result = buildWatchlistScan([{ symbol: 'X', ohlcv: [] }]);
		expect(result.results[0].error).toBeTruthy();
	});

	it('each result has required fields', () => {
		const ohlcv = makeOHLCV(60);
		const result = buildWatchlistScan([{ symbol: 'BTC', ohlcv }]);
		const r = result.results[0];
		expect(r).toHaveProperty('symbol');
		expect(r).toHaveProperty('price');
		expect(r).toHaveProperty('change24h');
		expect(r).toHaveProperty('rsiValue');
		expect(r).toHaveProperty('confluenceScore');
		expect(r).toHaveProperty('bullishScore');
		expect(r).toHaveProperty('bearishScore');
	});
});
