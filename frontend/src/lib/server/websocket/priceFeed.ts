// Real-Time WebSocket Price Feed — T-506
// Connects to Binance miniTicker stream, handles reconnect with exponential backoff.
// Designed to be injectable for testing (WebSocket constructor is a parameter).

// ─── Types ────────────────────────────────────────────────────────────────────

export type PriceUpdate = {
	symbol: string;
	price: number;
	priceChange24h: number;
	priceChangePct24h: number;
	volume24h: number;
	high24h: number;
	low24h: number;
	timestamp: number;
};

export type PriceFeedCallbacks = {
	onPrice?: (update: PriceUpdate) => void;
	onConnect?: () => void;
	onDisconnect?: () => void;
	onError?: (err: Event | Error) => void;
};

export type FeedStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/stream';

/**
 * Build a Binance combined stream URL for the given symbols.
 * Uses miniTicker for price + 24h stats.
 */
export function buildStreamUrl(symbols: string[]): string {
	if (symbols.length === 0) throw new Error('At least one symbol required');
	const streams = symbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
	return `${BINANCE_WS_BASE}?streams=${streams}`;
}

/**
 * Parse a Binance miniTicker stream message.
 * Returns null if the message is not a recognisable miniTicker payload.
 */
export function parseTickerMessage(raw: unknown): PriceUpdate | null {
	if (!raw || typeof raw !== 'object') return null;

	const msg = raw as Record<string, unknown>;

	// Combined stream: { stream: "btcusdt@miniTicker", data: { ... } }
	const data = (msg.data ?? msg) as Record<string, unknown>;

	if (data.e !== '24hrMiniTicker') return null;

	const symbol = typeof data.s === 'string' ? data.s : '';
	const price = Number(data.c);
	const open = Number(data.o);
	const high = Number(data.h);
	const low = Number(data.l);
	const volume = Number(data.v);
	const time = typeof data.E === 'number' ? data.E : Date.now();

	if (!symbol || !isFinite(price)) return null;

	const priceChange24h = price - open;
	const priceChangePct24h = open > 0 ? (priceChange24h / open) * 100 : 0;

	return {
		symbol: symbol.toUpperCase(),
		price,
		priceChange24h,
		priceChangePct24h,
		volume24h: isFinite(volume) ? volume : 0,
		high24h: isFinite(high) ? high : price,
		low24h: isFinite(low) ? low : price,
		timestamp: time,
	};
}

/**
 * Exponential backoff with jitter: baseMs * 2^attempt, capped at maxMs.
 */
export function calcReconnectDelay(attempt: number, baseMs = 1000, maxMs = 30_000): number {
	const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
	// Add ±25% jitter
	const jitter = delay * 0.25 * (Math.random() * 2 - 1);
	return Math.max(baseMs, Math.round(delay + jitter));
}

// ─── PriceFeed class ──────────────────────────────────────────────────────────

type WebSocketLike = {
	onopen: ((ev: Event) => void) | null;
	onmessage: ((ev: MessageEvent) => void) | null;
	onerror: ((ev: Event) => void) | null;
	onclose: ((ev: CloseEvent) => void) | null;
	close(): void;
	readyState: number;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

/** Ready state constants (mirrors WebSocket.READY_STATE_*) */
const WS_OPEN = 1;

/**
 * PriceFeed manages a live Binance WebSocket connection.
 * Supports multi-symbol subscriptions and automatic reconnection.
 *
 * Usage:
 *   const feed = new PriceFeed(['BTCUSDT', 'ETHUSDT'], {
 *     onPrice: (update) => console.log(update),
 *   });
 *   feed.connect();
 *   // later:
 *   feed.disconnect();
 */
export class PriceFeed {
	private symbols: Set<string>;
	private callbacks: PriceFeedCallbacks;
	private ws: WebSocketLike | null = null;
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private _status: FeedStatus = 'disconnected';
	private destroyed = false;
	private WebSocketClass: WebSocketConstructor;

	constructor(
		symbols: string[],
		callbacks: PriceFeedCallbacks = {},
		WebSocketImpl?: WebSocketConstructor
	) {
		this.symbols = new Set(symbols.map(s => s.toUpperCase()));
		this.callbacks = callbacks;
		// Default to browser WebSocket; can be injected for tests
		this.WebSocketClass = WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketConstructor);
	}

	get status(): FeedStatus { return this._status; }
	get subscribedSymbols(): string[] { return [...this.symbols]; }

	addSymbol(symbol: string): void {
		this.symbols.add(symbol.toUpperCase());
		// Reconnect to add new symbol to the stream
		if (this._status === 'connected') this.reconnect();
	}

	removeSymbol(symbol: string): void {
		this.symbols.delete(symbol.toUpperCase());
		if (this.symbols.size === 0) {
			this.disconnect();
		} else if (this._status === 'connected') {
			this.reconnect();
		}
	}

	connect(): void {
		if (this.destroyed || this.symbols.size === 0) return;
		if (this._status === 'connecting' || this._status === 'connected') return;
		this._openConnection();
	}

	disconnect(): void {
		this.destroyed = true;
		this._clearReconnectTimer();
		this._closeWs();
		this._status = 'disconnected';
	}

	private reconnect(): void {
		this._closeWs();
		this._status = 'disconnected';
		this._openConnection();
	}

	private _openConnection(): void {
		if (this.destroyed || this.symbols.size === 0) return;
		this._status = 'connecting';

		let url: string;
		try {
			url = buildStreamUrl([...this.symbols]);
		} catch {
			this._status = 'error';
			return;
		}

		const ws = new this.WebSocketClass(url);
		this.ws = ws;

		ws.onopen = () => {
			if (this.destroyed) { ws.close(); return; }
			this.reconnectAttempt = 0;
			this._status = 'connected';
			this.callbacks.onConnect?.();
		};

		ws.onmessage = (ev: MessageEvent) => {
			try {
				const parsed: unknown = JSON.parse(ev.data as string);
				const update = parseTickerMessage(parsed);
				if (update && this.symbols.has(update.symbol)) {
					this.callbacks.onPrice?.(update);
				}
			} catch {
				// Ignore parse errors
			}
		};

		ws.onerror = (ev: Event) => {
			this.callbacks.onError?.(ev);
		};

		ws.onclose = () => {
			if (this.destroyed) return;
			this._status = 'disconnected';
			this.callbacks.onDisconnect?.();
			this._scheduleReconnect();
		};
	}

	private _closeWs(): void {
		if (this.ws) {
			try {
				if (this.ws.readyState === WS_OPEN) this.ws.close();
			} catch {
				// ignore
			}
			this.ws = null;
		}
	}

	private _scheduleReconnect(): void {
		if (this.destroyed) return;
		const delay = calcReconnectDelay(this.reconnectAttempt);
		this.reconnectAttempt++;
		this.reconnectTimer = setTimeout(() => {
			if (!this.destroyed) this._openConnection();
		}, delay);
	}

	private _clearReconnectTimer(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}
}
