<script lang="ts">
    import type { OHLCV } from '$lib/types/contentBlock';

    let {
        ohlcv,
        interval,
        livePrice,
        showHeader = true,
        chrome = 'standalone'
    }: {
        ohlcv: OHLCV[] | null;
        interval?: string;
        livePrice?: number;
        showHeader?: boolean;
        chrome?: 'standalone' | 'embedded';
    } = $props();

    const svgW = 600;
    const svgH = 184;
    const pad = { top: 12, right: 8, bottom: 18, left: 52 };

    const chartW = $derived(svgW - pad.left - pad.right);
    const chartH = $derived(svgH - pad.top - pad.bottom);

    const layout = $derived.by(() => {
        if (!ohlcv || ohlcv.length === 0) return null;
        const highs = ohlcv.map(c => c.high);
        const lows = ohlcv.map(c => c.low);
        const maxP = Math.max(...highs);
        const minP = Math.min(...lows);
        const range = maxP - minP || 1;
        const candleW = Math.max(2, Math.min(8, (chartW / ohlcv.length) * 0.7));
        const gap = chartW / ohlcv.length;
        return { maxP, minP, range, candleW, gap };
    });

    function priceToY(price: number): number {
        if (!layout) return 0;
        return pad.top + ((layout.maxP - price) / layout.range) * chartH;
    }

    function fmtAxisPrice(p: number): string {
        if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
        return p.toFixed(2);
    }

    const axisTicks = $derived.by(() => {
        if (!layout) return [];
        const count = 5;
        const step = layout.range / (count - 1);
        return Array.from({ length: count }, (_, i) => layout.minP + step * i);
    });

    // Area path for gradient fill under close prices
    const areaPath = $derived.by(() => {
        if (!ohlcv || ohlcv.length === 0 || !layout) return '';
        const pts = ohlcv.map((c, i) => {
            const x = pad.left + i * layout.gap + layout.gap / 2;
            const y = priceToY(c.close);
            return `${x},${y}`;
        });
        const lastX = pad.left + (ohlcv.length - 1) * layout.gap + layout.gap / 2;
        const firstX = pad.left + layout.gap / 2;
        const baseY = pad.top + chartH;
        return `M ${firstX},${baseY} L ${pts.join(' L ')} L ${lastX},${baseY} Z`;
    });
</script>

<div class="mini-chart-wrap" class:mini-chart-wrap-embedded={chrome === 'embedded'}>
    {#if ohlcv && ohlcv.length > 0 && layout}
        {#if showHeader}
            <div class="mini-chart-header">
                <span class="mini-chart-title">GC=F <span class="gold-accent">Gold</span> Futures</span>
                {#if interval}
                    <span class="mini-chart-interval">{interval}</span>
                {/if}
            </div>
        {/if}
        <svg
            viewBox="0 0 {svgW} {svgH}"
            class="mini-chart-svg"
            preserveAspectRatio="xMidYMid meet"
        >
            <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.12"/>
                    <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
                </linearGradient>
            </defs>

            <!-- Grid lines -->
            {#each axisTicks as tick}
                {@const y = priceToY(tick)}
                <line x1={pad.left} y1={y} x2={svgW - pad.right} y2={y} stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
                <text x={pad.left - 6} y={y + 3} text-anchor="end" font-size="8" fill="rgba(255,255,255,0.25)">
                    {fmtAxisPrice(tick)}
                </text>
            {/each}

            <!-- Area fill under close prices -->
            <path d={areaPath} fill="url(#areaGrad)" />

            <!-- Candles -->
            {#each ohlcv as candle, i}
                {@const x = pad.left + i * layout.gap + layout.gap / 2}
                {@const isGreen = candle.close >= candle.open}
                {@const bodyTop = priceToY(Math.max(candle.open, candle.close))}
                {@const bodyBot = priceToY(Math.min(candle.open, candle.close))}
                {@const bodyH = Math.max(1, bodyBot - bodyTop)}
                {@const wickTop = priceToY(candle.high)}
                {@const wickBot = priceToY(candle.low)}
                {@const color = isGreen ? '#22c55e' : '#ef4444'}

                <line x1={x} y1={wickTop} x2={x} y2={wickBot} stroke={color} stroke-width="1" opacity="0.6"/>
                <rect
                    x={x - layout.candleW / 2}
                    y={bodyTop}
                    width={layout.candleW}
                    height={bodyH}
                    fill={color}
                    rx="0.5"
                />
            {/each}

            <!-- Live price line -->
            {#if livePrice !== undefined && isFinite(livePrice) && layout && livePrice >= layout.minP && livePrice <= layout.maxP}
                {@const livePriceY = priceToY(livePrice)}
                <line
                    x1={pad.left}
                    y1={livePriceY}
                    x2={svgW - pad.right}
                    y2={livePriceY}
                    stroke="#f59e0b"
                    stroke-width="1"
                    stroke-dasharray="4 3"
                    opacity="0.7"
                />
                <rect x={svgW - pad.right} y={livePriceY - 7} width={pad.right + 2} height="14" fill="#f59e0b" opacity="0.85" rx="2"/>
                <text x={svgW - pad.right + 3} y={livePriceY + 3} font-size="7" fill="#000" font-weight="700">
                    {fmtAxisPrice(livePrice)}
                </text>
            {/if}
        </svg>
    {:else}
        <div class="mini-chart-empty">Chart data unavailable</div>
    {/if}
</div>

<style>
    .mini-chart-wrap {
        background: rgba(10, 12, 18, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: var(--dashboard-chart-radius, 12px);
        padding: var(--dashboard-chart-padding, 0.75rem);
        overflow: hidden;
    }
    .mini-chart-wrap-embedded {
        background: transparent;
        border: 0;
        border-radius: 0;
        padding: 0;
    }
    .mini-chart-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.5rem;
    }
    .mini-chart-title {
        font-size: var(--dashboard-chart-title-size, 0.64rem);
        font-weight: 600;
        color: rgba(255,255,255,0.38);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .gold-accent {
        color: #f59e0b;
        opacity: 0.85;
    }
    .mini-chart-interval {
        font-size: var(--dashboard-chart-pill-size, 0.62rem);
        color: #f59e0b;
        background: rgba(245,158,11,0.1);
        border: 1px solid rgba(245,158,11,0.2);
        padding: 0.22rem 0.5rem;
        border-radius: 999px;
        font-weight: 600;
        letter-spacing: 0.04em;
    }
    .mini-chart-svg {
        width: 100%;
        height: auto;
        display: block;
    }
    .mini-chart-empty {
        font-size: var(--dashboard-support-size, 0.78rem);
        color: rgba(255,255,255,0.25);
        text-align: center;
        padding: var(--dashboard-chart-empty-padding, 1.5rem);
    }
</style>
