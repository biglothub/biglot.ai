<script lang="ts">
    import { onMount, onDestroy } from 'svelte';

    type WatchlistItem = {
        symbol: string;
        label: string;
        price: number;
        change: number;
        currency: string;
    };

    let items = $state<WatchlistItem[]>([]);
    let loading = $state(true);
    let interval: ReturnType<typeof setInterval>;
    let ws: WebSocket | null = null;
    let flashSymbols = $state(new Set<string>());

    // Reconnect state
    let wsReconnectAttempt = 0;
    let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let wsDestroyed = false;
    let wsSymbols: string[] = [];

    const GOLD_SYMBOLS = new Set(['GC=F', 'SI=F']);
    // Symbols that can be streamed from Binance miniTicker (USDT pairs)
    const CRYPTO_WS_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT']);

    function calcWsReconnectDelay(attempt: number): number {
        const base = Math.min(1000 * Math.pow(2, attempt), 30_000);
        const jitter = base * 0.25 * (Math.random() * 2 - 1);
        return Math.max(1000, Math.round(base + jitter));
    }

    async function fetchWatchlist() {
        try {
            const res = await fetch('/api/watchlist');
            if (!res.ok) return;
            items = await res.json();
        } catch {
            // silently fail
        } finally {
            loading = false;
        }
    }

    /** Open Binance miniTicker WebSocket for crypto USDT pairs in the watchlist */
    function openPriceFeed(symbols: string[]): void {
        if (wsDestroyed || typeof WebSocket === 'undefined' || symbols.length === 0) return;
        if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

        const streams = symbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
        const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

        ws = new WebSocket(url);

        ws.onopen = () => {
            wsReconnectAttempt = 0;
        };

        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data as string) as { data?: Record<string, string>; e?: string };
                const data = (msg.data ?? msg) as Record<string, string>;
                if (data.e !== '24hrMiniTicker') return;
                const symbol = data.s;
                const price = Number(data.c);
                const open = Number(data.o);
                if (!symbol || !isFinite(price) || !isFinite(open)) return;
                const changePct = open > 0 ? ((price - open) / open) * 100 : 0;
                const idx = items.findIndex(i => i.symbol === symbol);
                if (idx !== -1) {
                    items[idx] = { ...items[idx], price, change: changePct };
                    // Flash animation
                    flashSymbols = new Set([...flashSymbols, symbol]);
                    setTimeout(() => {
                        flashSymbols = new Set([...flashSymbols].filter(s => s !== symbol));
                    }, 600);
                }
            } catch {
                // ignore parse errors
            }
        };

        ws.onerror = () => {
            // onclose fires after onerror and handles reconnect
        };

        ws.onclose = () => {
            ws = null;
            if (!wsDestroyed) {
                const delay = calcWsReconnectDelay(wsReconnectAttempt);
                wsReconnectAttempt++;
                wsReconnectTimer = setTimeout(() => {
                    if (!wsDestroyed) openPriceFeed(wsSymbols);
                }, delay);
            }
        };
    }

    onMount(async () => {
        await fetchWatchlist();
        wsSymbols = items.map(i => i.symbol).filter(s => CRYPTO_WS_SYMBOLS.has(s));
        openPriceFeed(wsSymbols);
        interval = setInterval(fetchWatchlist, 30_000);
    });

    onDestroy(() => {
        wsDestroyed = true;
        if (wsReconnectTimer !== null) clearTimeout(wsReconnectTimer);
        clearInterval(interval);
        if (ws) {
            ws.onclose = null; // prevent reconnect on explicit destroy
            ws.close();
            ws = null;
        }
    });

    function fmtPrice(item: WatchlistItem): string {
        if (item.currency === '%') return `${item.price.toFixed(2)}%`;
        if (item.currency === 'USD') {
            if (item.price >= 10_000) return `$${item.price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
            if (item.price >= 100) return `$${item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            return `$${item.price.toFixed(4)}`;
        }
        return item.price.toFixed(2);
    }

    function fmtChange(change: number): string {
        return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    }
</script>

<div class="watchlist-bar" aria-label="Live market watchlist">
    {#if loading}
        <div class="wl-loading">Loading markets...</div>
    {:else if items.length > 0}
        <div class="ticker-track">
            {#each [0, 1, 2, 3] as _copy}
                <div class="ticker-content">
                    {#each items as item (item.symbol)}
                        {@const isUp = item.change >= 0}
                        {@const isGold = GOLD_SYMBOLS.has(item.symbol)}
                        {@const isFlashing = flashSymbols.has(item.symbol)}
                        <div class="wl-item" class:wl-gold={isGold} class:wl-flash={isFlashing}>
                            <span class="wl-label" class:wl-label-gold={isGold}>{item.label}</span>
                            <span class="wl-price">{fmtPrice(item)}</span>
                            <span class="wl-change" class:wl-up={isUp} class:wl-down={!isUp}>
                                {fmtChange(item.change)}
                            </span>
                        </div>
                    {/each}
                    <span class="ticker-dot">·</span>
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .watchlist-bar {
        overflow: hidden;
        background: rgba(0, 0, 0, 0.3);
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        min-height: 36px;
        flex-shrink: 0;
    }

    .wl-loading {
        font-size: 0.62rem;
        color: rgba(255,255,255,0.25);
        padding: 0 0.75rem;
        line-height: 36px;
    }

    .ticker-track {
        display: flex;
        width: max-content;
        animation: wl-scroll 35s linear infinite;
    }
    .ticker-track:hover {
        animation-play-state: paused;
    }
    @keyframes wl-scroll {
        0% { transform: translateX(0); }
        100% { transform: translateX(-25%); }
    }
    .ticker-content {
        display: flex;
        align-items: center;
        flex-shrink: 0;
    }
    .ticker-dot {
        display: flex;
        align-items: center;
        padding: 0 0.85rem;
        color: rgba(255, 255, 255, 0.1);
        font-size: 1.4rem;
        line-height: 1;
    }

    .wl-item {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0 0.75rem;
        border-right: 1px solid rgba(255,255,255,0.04);
        white-space: nowrap;
        flex-shrink: 0;
        height: 36px;
    }

    .wl-flash {
        animation: wl-flash-anim 0.6s ease-out forwards;
    }

    @keyframes wl-flash-anim {
        0%   { background: rgba(255, 255, 255, 0.08); }
        100% { background: transparent; }
    }

    .wl-gold {
        border-left: 2px solid rgba(245, 158, 11, 0.4);
        background: rgba(245, 158, 11, 0.03);
    }

    .wl-label {
        font-size: 0.6rem;
        font-weight: 700;
        color: rgba(255,255,255,0.3);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .wl-label-gold {
        color: #f59e0b;
        opacity: 0.85;
    }

    .wl-price {
        font-size: 0.7rem;
        font-weight: 600;
        color: rgba(255,255,255,0.82);
        font-variant-numeric: tabular-nums;
    }

    .wl-change {
        font-size: 0.6rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        padding: 1px 5px;
        border-radius: 3px;
    }
    .wl-up {
        color: #22c55e;
        background: rgba(34,197,94,0.1);
    }
    .wl-down {
        color: #ef4444;
        background: rgba(239,68,68,0.1);
    }
</style>
