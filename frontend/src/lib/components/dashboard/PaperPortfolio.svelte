<script lang="ts">
    import type { PaperPortfolioSnapshot } from '$lib/server/paperTrading/paperTrader';

    const { snapshot }: { snapshot: PaperPortfolioSnapshot | null } = $props();

    function fmt(n: number): string {
        const sign = n >= 0 ? '+' : '';
        if (Math.abs(n) >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(2)}M`;
        if (Math.abs(n) >= 1_000)     return `${sign}$${(n / 1_000).toFixed(2)}K`;
        return `${sign}$${n.toFixed(2)}`;
    }

    function fmtPrice(n: number): string {
        if (n >= 1000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (n >= 1)    return `$${n.toFixed(4)}`;
        return `$${n.toFixed(6)}`;
    }

    function pnlClass(n: number): string {
        return n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-white/60';
    }

    const isEmpty = $derived(
        !snapshot ||
        (snapshot.openCount === 0 && snapshot.tradeCount === 0)
    );
</script>

<div class="rounded-xl border border-white/10 bg-white/5 p-4">
    <h3 class="mb-3 text-sm font-semibold text-white/80">Paper Trading</h3>

    {#if isEmpty}
        <div class="flex h-16 items-center justify-center text-sm text-white/40">
            No paper trades yet. Ask the AI to paper buy an asset.
        </div>
    {:else if snapshot}
        <!-- Summary row -->
        <div class="mb-3 grid grid-cols-4 gap-2 text-center">
            <div>
                <div class="text-xs text-white/50">Open</div>
                <div class="text-sm font-bold text-white">{snapshot.openCount}</div>
            </div>
            <div>
                <div class="text-xs text-white/50">Closed</div>
                <div class="text-sm font-bold text-white">{snapshot.tradeCount}</div>
            </div>
            <div>
                <div class="text-xs text-white/50">Unrealised</div>
                <div class="text-sm font-bold {pnlClass(snapshot.totalUnrealisedPnL)}">{fmt(snapshot.totalUnrealisedPnL)}</div>
            </div>
            <div>
                <div class="text-xs text-white/50">Realised</div>
                <div class="text-sm font-bold {pnlClass(snapshot.totalRealisedPnL)}">{fmt(snapshot.totalRealisedPnL)}</div>
            </div>
        </div>

        <!-- Open positions -->
        {#if snapshot.openTrades.length > 0}
            <div class="space-y-1.5">
                {#each snapshot.openTrades.slice(0, 5) as trade}
                    <div class="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-white/90">{trade.symbol}</span>
                            <span class="rounded px-1 py-0.5 text-[10px] font-semibold {trade.side === 'long' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
                                {trade.side.toUpperCase()}
                            </span>
                            <span class="text-[10px] text-white/40">{trade.qty}</span>
                        </div>
                        <div class="text-right">
                            <div class="text-xs text-white/50">@ {fmtPrice(trade.entryPrice)}</div>
                            <div class="text-xs font-semibold {pnlClass(trade.unrealisedPnL)}">
                                {fmt(trade.unrealisedPnL)}
                                <span class="text-[10px]">({trade.unrealisedPct >= 0 ? '+' : ''}{trade.unrealisedPct.toFixed(1)}%)</span>
                            </div>
                        </div>
                    </div>
                {/each}
                {#if snapshot.openTrades.length > 5}
                    <div class="text-center text-xs text-white/40">+{snapshot.openTrades.length - 5} more</div>
                {/if}
            </div>
        {/if}

        <!-- Stats footer -->
        <div class="mt-3 flex gap-4 border-t border-white/10 pt-2 text-xs text-white/50">
            {#if snapshot.winRate !== null}
                <span>Win rate: <strong class="text-white/80">{(snapshot.winRate * 100).toFixed(1)}%</strong></span>
            {/if}
            <span class="ml-auto text-[10px] italic">Virtual — no real money</span>
        </div>
    {/if}
</div>
