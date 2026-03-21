// Tests for Real-Time WebSocket Price Feed — T-506
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	buildStreamUrl,
	parseTickerMessage,
	calcReconnectDelay,
	PriceFeed,
	type PriceUpdate,
} from './priceFeed';

// ─── buildStreamUrl ───────────────────────────────────────────────────────────

describe('buildStreamUrl', () => {
	it('builds URL for a single symbol', () => {
		const url = buildStreamUrl(['BTCUSDT']);
		expect(url).toContain('btcusdt@miniTicker');
	});

	it('builds combined stream URL for multiple symbols', () => {
		const url = buildStreamUrl(['BTCUSDT', 'ETHUSDT']);
		expect(url).toContain('btcusdt@miniTicker');
		expect(url).toContain('ethusdt@miniTicker');
		expect(url).toContain('/stream?streams=');
	});

	it('lowercases symbols in the stream path', () => {
		const url = buildStreamUrl(['BNBUSDT']);
		expect(url).toContain('bnbusdt@miniTicker');
		expect(url).not.toContain('BNBUSDT');
	});

	it('throws for empty symbol array', () => {
		expect(() => buildStreamUrl([])).toThrow('At least one symbol required');
	});
});

// ─── parseTickerMessage ───────────────────────────────────────────────────────

describe('parseTickerMessage', () => {
	const validPayload = {
		stream: 'btcusdt@miniTicker',
		data: {
			e: '24hrMiniTicker',
			s: 'BTCUSDT',
			c: '50000.00',  // close (current price)
			o: '49000.00',  // open
			h: '51000.00',  // high
			l: '48000.00',  // low
			v: '1234.56',   // volume
			E: 1700000000000,
		},
	};

	it('parses a valid combined stream message', () => {
		const result = parseTickerMessage(validPayload);
		expect(result).not.toBeNull();
		expect(result!.symbol).toBe('BTCUSDT');
		expect(result!.price).toBe(50000);
		expect(result!.high24h).toBe(51000);
		expect(result!.low24h).toBe(48000);
		expect(result!.volume24h).toBeCloseTo(1234.56);
	});

	it('computes 24h price change correctly', () => {
		const result = parseTickerMessage(validPayload);
		expect(result!.priceChange24h).toBeCloseTo(1000); // 50000 - 49000
		expect(result!.priceChangePct24h).toBeCloseTo((1000 / 49000) * 100);
	});

	it('parses flat miniTicker without wrapper', () => {
		const flat = {
			e: '24hrMiniTicker',
			s: 'ETHUSDT',
			c: '3000',
			o: '2900',
			h: '3100',
			l: '2800',
			v: '500',
			E: 1700000000000,
		};
		const result = parseTickerMessage(flat);
		expect(result).not.toBeNull();
		expect(result!.symbol).toBe('ETHUSDT');
		expect(result!.price).toBe(3000);
	});

	it('returns null for wrong event type', () => {
		const invalid = { data: { e: 'trade', s: 'BTCUSDT', c: '50000', o: '49000', E: 0 } };
		expect(parseTickerMessage(invalid)).toBeNull();
	});

	it('returns null for non-object input', () => {
		expect(parseTickerMessage(null)).toBeNull();
		expect(parseTickerMessage('string')).toBeNull();
		expect(parseTickerMessage(42)).toBeNull();
	});

	it('returns null for missing symbol', () => {
		const bad = { data: { e: '24hrMiniTicker', c: '50000', o: '49000' } };
		expect(parseTickerMessage(bad)).toBeNull();
	});
});

// ─── calcReconnectDelay ───────────────────────────────────────────────────────

describe('calcReconnectDelay', () => {
	it('returns at least baseMs on attempt 0', () => {
		// Run multiple times to account for jitter
		for (let i = 0; i < 10; i++) {
			const delay = calcReconnectDelay(0, 1000, 30_000);
			expect(delay).toBeGreaterThanOrEqual(1000);
		}
	});

	it('increases delay with each attempt', () => {
		// Average should increase — test deterministically at 0 jitter
		const d0 = calcReconnectDelay(0, 1000, 30_000);
		const d3 = calcReconnectDelay(3, 1000, 30_000);
		// Can't guarantee due to jitter, but high attempts should generally be larger
		// Use median: at attempt 3 base is 8000ms, at attempt 0 base is 1000ms
		// Even with 25% jitter on attempt 0 it's max 1250ms < min 6000ms at attempt 3
		expect(d3).toBeGreaterThan(1250);
	});

	it('caps at maxMs', () => {
		for (let i = 0; i < 10; i++) {
			const delay = calcReconnectDelay(100, 1000, 30_000);
			expect(delay).toBeLessThanOrEqual(30_000 * 1.25);
		}
	});
});

// ─── PriceFeed ────────────────────────────────────────────────────────────────

type MockWSInstance = {
	readyState: number;
	onopen: ((ev: Event) => void) | null;
	onmessage: ((ev: MessageEvent) => void) | null;
	onerror: ((ev: Event) => void) | null;
	onclose: ((ev: CloseEvent) => void) | null;
	close: ReturnType<typeof vi.fn>;
	triggerOpen(): void;
	triggerMessage(data: unknown): void;
	triggerClose(): void;
};

/** Factory that creates a class constructor whose instances are controllable from tests */
function makeMockWSClass() {
	let lastInstance: MockWSInstance | null = null;
	let callCount = 0;

	class MockWS {
		readyState = 0;
		onopen: ((ev: Event) => void) | null = null;
		onmessage: ((ev: MessageEvent) => void) | null = null;
		onerror: ((ev: Event) => void) | null = null;
		onclose: ((ev: CloseEvent) => void) | null = null;
		close = vi.fn();

		constructor(_url: string) {
			callCount++;
			lastInstance = this as unknown as MockWSInstance;
		}
		triggerOpen() { this.readyState = 1; this.onopen?.({} as Event); }
		triggerMessage(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
		triggerClose() { this.readyState = 3; this.onclose?.({ code: 1006 } as CloseEvent); }
	}

	return {
		MockWS,
		getInstance: () => lastInstance as MockWSInstance | null,
		getCallCount: () => callCount,
	};
}

describe('PriceFeed', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('starts disconnected', () => {
		const { MockWS } = makeMockWSClass();
		const feed = new PriceFeed(['BTCUSDT'], {}, MockWS as unknown as new (url: string) => WebSocket);
		expect(feed.status).toBe('disconnected');
	});

	it('connects and calls onConnect callback', () => {
		const { MockWS, getInstance } = makeMockWSClass();
		const onConnect = vi.fn();
		const feed = new PriceFeed(['BTCUSDT'], { onConnect }, MockWS as unknown as new (url: string) => WebSocket);
		feed.connect();

		expect(feed.status).toBe('connecting');
		getInstance()!.triggerOpen();
		expect(feed.status).toBe('connected');
		expect(onConnect).toHaveBeenCalledOnce();
	});

	it('calls onPrice with parsed updates', () => {
		const { MockWS, getInstance } = makeMockWSClass();
		const onPrice = vi.fn();
		const feed = new PriceFeed(['BTCUSDT'], { onPrice }, MockWS as unknown as new (url: string) => WebSocket);
		feed.connect();
		getInstance()!.triggerOpen();

		getInstance()!.triggerMessage({
			data: {
				e: '24hrMiniTicker',
				s: 'BTCUSDT',
				c: '50000',
				o: '49000',
				h: '51000',
				l: '48000',
				v: '100',
				E: Date.now(),
			},
		});

		expect(onPrice).toHaveBeenCalledOnce();
		const update: PriceUpdate = onPrice.mock.calls[0][0];
		expect(update.symbol).toBe('BTCUSDT');
		expect(update.price).toBe(50000);
	});

	it('schedules reconnect after close', () => {
		const { MockWS, getInstance, getCallCount } = makeMockWSClass();
		const feed = new PriceFeed(['BTCUSDT'], {}, MockWS as unknown as new (url: string) => WebSocket);
		feed.connect();
		getInstance()!.triggerOpen();
		getInstance()!.triggerClose();

		expect(feed.status).toBe('disconnected');
		expect(getCallCount()).toBe(1);

		// Advance timers to trigger reconnect
		vi.advanceTimersByTime(2000);
		expect(getCallCount()).toBeGreaterThanOrEqual(2);
	});

	it('does not reconnect after disconnect() is called', () => {
		const { MockWS, getInstance, getCallCount } = makeMockWSClass();
		const feed = new PriceFeed(['BTCUSDT'], {}, MockWS as unknown as new (url: string) => WebSocket);
		feed.connect();
		getInstance()!.triggerOpen();
		feed.disconnect();
		vi.advanceTimersByTime(60_000);

		// Only one WebSocket was created
		expect(getCallCount()).toBe(1);
	});

	it('ignores messages for unsubscribed symbols', () => {
		const { MockWS, getInstance } = makeMockWSClass();
		const onPrice = vi.fn();
		const feed = new PriceFeed(['BTCUSDT'], { onPrice }, MockWS as unknown as new (url: string) => WebSocket);
		feed.connect();
		getInstance()!.triggerOpen();

		// Deliver message for ETHUSDT which is not subscribed
		getInstance()!.triggerMessage({
			data: {
				e: '24hrMiniTicker',
				s: 'ETHUSDT',
				c: '3000',
				o: '2900',
				h: '3100',
				l: '2800',
				v: '50',
				E: Date.now(),
			},
		});

		expect(onPrice).not.toHaveBeenCalled();
	});

	it('returns current subscribed symbols', () => {
		const { MockWS } = makeMockWSClass();
		const feed = new PriceFeed(['BTCUSDT', 'ETHUSDT'], {}, MockWS as unknown as new (url: string) => WebSocket);
		expect(feed.subscribedSymbols).toContain('BTCUSDT');
		expect(feed.subscribedSymbols).toContain('ETHUSDT');
	});

	it('does not create WebSocket if no symbols', () => {
		const { MockWS, getCallCount } = makeMockWSClass();
		const feed = new PriceFeed([], {}, MockWS as unknown as new (url: string) => WebSocket);
		feed.connect();
		expect(getCallCount()).toBe(0);
	});
});
