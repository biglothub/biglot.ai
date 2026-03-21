<script lang="ts">
    import type { EquityPoint } from '$lib/server/analytics/performanceData';

    const { curve, startEquity }: { curve: EquityPoint[]; startEquity: number } = $props();

    const WIDTH = 600;
    const HEIGHT = 180;
    const PAD = { top: 12, right: 16, bottom: 28, left: 56 };

    const allEquities = $derived([startEquity, ...curve.map(p => p.equity)]);
    const minEq = $derived(Math.min(...allEquities));
    const maxEq = $derived(Math.max(...allEquities));
    const eqRange = $derived(maxEq - minEq || 1);

    function xPos(i: number): number {
        return PAD.left + (i / Math.max(curve.length - 1, 1)) * (WIDTH - PAD.left - PAD.right);
    }
    function yPos(eq: number): number {
        return PAD.top + (1 - (eq - minEq) / eqRange) * (HEIGHT - PAD.top - PAD.bottom);
    }

    const linePath = $derived(
        curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(p.equity).toFixed(1)}`).join(' ')
    );

    const baseY = $derived(yPos(startEquity));

    const areaPath = $derived(
        curve.length > 0
            ? `${linePath} L${xPos(curve.length - 1).toFixed(1)},${(HEIGHT - PAD.bottom).toFixed(1)} L${xPos(0).toFixed(1)},${(HEIGHT - PAD.bottom).toFixed(1)} Z`
            : ''
    );

    function fmt(n: number): string {
        if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
        if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
        return `$${n.toFixed(0)}`;
    }

    const yTicks = $derived([minEq, minEq + eqRange * 0.5, maxEq]);
    const isProfit = $derived(curve.length > 0 ? curve[curve.length - 1].equity >= startEquity : true);
</script>

<div class="rounded-xl border border-white/10 bg-white/5 p-4">
    <h3 class="mb-3 text-sm font-semibold text-white/80">Equity Curve</h3>

    {#if curve.length === 0}
        <div class="flex h-24 items-center justify-center text-sm text-white/40">No trades yet</div>
    {:else}
        <svg viewBox="0 0 {WIDTH} {HEIGHT}" class="w-full" style="height:{HEIGHT}px">
            <defs>
                <linearGradient id="eq-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color={isProfit ? '#22c55e' : '#ef4444'} stop-opacity="0.25" />
                    <stop offset="100%" stop-color={isProfit ? '#22c55e' : '#ef4444'} stop-opacity="0" />
                </linearGradient>
            </defs>

            <!-- Y-axis ticks -->
            {#each yTicks as tick}
                {@const y = yPos(tick)}
                <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} stroke="rgba(255,255,255,0.07)" stroke-width="1" />
                <text x={PAD.left - 4} y={y + 4} text-anchor="end" font-size="9" fill="rgba(255,255,255,0.4)">{fmt(tick)}</text>
            {/each}

            <!-- Baseline (start equity) -->
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={baseY} y2={baseY} stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="4,3" />

            <!-- Area fill -->
            <path d={areaPath} fill="url(#eq-area)" />

            <!-- Equity line -->
            <path d={linePath} fill="none" stroke={isProfit ? '#22c55e' : '#ef4444'} stroke-width="2" stroke-linejoin="round" />

            <!-- X-axis labels -->
            {#if curve.length > 1}
                <text x={xPos(0)} y={HEIGHT - 4} text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.4)">{curve[0].date.slice(5)}</text>
                <text x={xPos(curve.length - 1)} y={HEIGHT - 4} text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.4)">{curve[curve.length - 1].date.slice(5)}</text>
            {/if}
        </svg>
    {/if}
</div>
