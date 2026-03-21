<script lang="ts">
    import type { TradeDistribution } from '$lib/server/analytics/performanceData';

    const { dist }: { dist: TradeDistribution } = $props();

    function fmt(n: number | null): string {
        if (n === null) return 'N/A';
        const sign = n >= 0 ? '+' : '';
        if (Math.abs(n) >= 1000) return `${sign}$${(n / 1000).toFixed(1)}K`;
        return `${sign}$${n.toFixed(2)}`;
    }

    const totalTrades = $derived(dist.winCount + dist.lossCount + dist.breakEvenCount);
    const winPct = $derived(totalTrades > 0 ? (dist.winCount / totalTrades * 100).toFixed(1) : '0.0');
    const lossPct = $derived(totalTrades > 0 ? (dist.lossCount / totalTrades * 100).toFixed(1) : '0.0');

    const maxBucketCount = $derived(Math.max(...dist.rMultipleHistogram.map(b => b.count), 1));
</script>

<div class="rounded-xl border border-white/10 bg-white/5 p-4">
    <h3 class="mb-3 text-sm font-semibold text-white/80">Trade Distribution</h3>

    <!-- Win/Loss summary -->
    <div class="mb-4 grid grid-cols-3 gap-2 text-center">
        <div class="rounded-lg bg-green-500/10 p-2">
            <div class="text-xs text-white/50">Wins</div>
            <div class="text-sm font-bold text-green-400">{dist.winCount} <span class="text-xs font-normal">({winPct}%)</span></div>
            <div class="text-xs text-white/40">avg {fmt(dist.avgWin)}</div>
        </div>
        <div class="rounded-lg bg-white/5 p-2">
            <div class="text-xs text-white/50">Break Even</div>
            <div class="text-sm font-bold text-white/60">{dist.breakEvenCount}</div>
        </div>
        <div class="rounded-lg bg-red-500/10 p-2">
            <div class="text-xs text-white/50">Losses</div>
            <div class="text-sm font-bold text-red-400">{dist.lossCount} <span class="text-xs font-normal">({lossPct}%)</span></div>
            <div class="text-xs text-white/40">avg {fmt(dist.avgLoss)}</div>
        </div>
    </div>

    <!-- R-Multiple histogram -->
    {#if dist.rMultipleHistogram.some(b => b.count > 0)}
        <div class="mt-2">
            <div class="mb-1 text-xs text-white/40">R-Multiple Distribution</div>
            <div class="flex items-end gap-1 h-16">
                {#each dist.rMultipleHistogram as bucket}
                    {@const heightPct = maxBucketCount > 0 ? (bucket.count / maxBucketCount * 100) : 0}
                    {@const isPositive = !bucket.bucket.startsWith('<') && !bucket.bucket.startsWith('-')}
                    <div class="flex flex-1 flex-col items-center gap-0.5">
                        <div class="w-full rounded-t-sm" style="height:{heightPct}%;background:{isPositive ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'}; min-height:{bucket.count > 0 ? '2px' : '0'}"></div>
                        {#if bucket.count > 0}
                            <span class="text-[9px] text-white/40">{bucket.count}</span>
                        {/if}
                    </div>
                {/each}
            </div>
            <div class="flex gap-1 mt-0.5">
                {#each dist.rMultipleHistogram as bucket}
                    <div class="flex-1 text-center text-[8px] text-white/30 leading-tight">{bucket.bucket}</div>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Best / Worst -->
    <div class="mt-3 flex gap-4 border-t border-white/10 pt-2 text-xs text-white/50">
        <span>Best: <strong class="text-green-400">{fmt(dist.largestWin)}</strong></span>
        <span>Worst: <strong class="text-red-400">{fmt(dist.largestLoss)}</strong></span>
    </div>
</div>
