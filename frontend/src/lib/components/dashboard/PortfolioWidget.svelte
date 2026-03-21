<script lang="ts">
    import type { PortfolioSnapshot } from '$lib/types/portfolio';

    const { snapshot }: { snapshot: PortfolioSnapshot | null } = $props();

    function fmt(n: number): string {
        const sign = n >= 0 ? '+' : '';
        if (Math.abs(n) >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(2)}M`;
        if (Math.abs(n) >= 1_000) return `${sign}$${(n / 1_000).toFixed(2)}K`;
        return `${sign}$${n.toFixed(2)}`;
    }

    function pnlClass(n: number): string {
        return n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-white/60';
    }
</script>

<div class="rounded-xl border border-white/10 bg-white/5 p-4">
    <h3 class="mb-3 text-sm font-semibold text-white/80">Portfolio</h3>

    {#if !snapshot || (snapshot.positions.length === 0 && snapshot.closedTrades.length === 0)}
        <div class="flex h-16 items-center justify-center text-sm text-white/40">
            No positions tracked. Use the chat to add positions.
        </div>
    {:else}
        <!-- Summary row -->
        <div class="mb-3 grid grid-cols-3 gap-2 text-center">
            <div>
                <div class="text-xs text-white/50">Open</div>
                <div class="text-sm font-bold text-white">{snapshot.positions.length}</div>
            </div>
            <div>
                <div class="text-xs text-white/50">Unrealised</div>
                <div class="text-sm font-bold {pnlClass(snapshot.totalUnrealisedPnL)}">{fmt(snapshot.totalUnrealisedPnL)}</div>
            </div>
            <div>
                <div class="text-xs text-white/50">Realised</div>
                <div class="text-sm font-bold {pnlClass(snapshot.totalRealised)}">{fmt(snapshot.totalRealised)}</div>
            </div>
        </div>

        <!-- Open positions list -->
        {#if snapshot.positions.length > 0}
            <div class="space-y-1.5">
                {#each snapshot.positions.slice(0, 5) as pos}
                    <div class="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-white/90">{pos.symbol}</span>
                            <span class="rounded px-1 py-0.5 text-[10px] font-semibold {pos.direction === 'long' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
                                {pos.direction.toUpperCase()}
                            </span>
                        </div>
                        <div class="text-right">
                            <div class="text-xs text-white/50">@ {pos.entryPrice}</div>
                            {#if pos.unrealisedPnLUSD !== null}
                                <div class="text-xs font-semibold {pnlClass(pos.unrealisedPnLUSD)}">{fmt(pos.unrealisedPnLUSD)}</div>
                            {/if}
                        </div>
                    </div>
                {/each}
                {#if snapshot.positions.length > 5}
                    <div class="text-center text-xs text-white/40">+{snapshot.positions.length - 5} more</div>
                {/if}
            </div>
        {/if}

        <!-- Stats row -->
        {#if snapshot.winRate !== null || snapshot.avgRMultiple !== null}
            <div class="mt-3 flex gap-4 border-t border-white/10 pt-2 text-xs text-white/50">
                {#if snapshot.winRate !== null}
                    <span>Win rate: <strong class="text-white/80">{(snapshot.winRate * 100).toFixed(1)}%</strong></span>
                {/if}
                {#if snapshot.avgRMultiple !== null}
                    <span>Avg R: <strong class="{pnlClass(snapshot.avgRMultiple)}">{snapshot.avgRMultiple.toFixed(2)}</strong></span>
                {/if}
                <span>{snapshot.closedTrades.length} closed trades</span>
            </div>
        {/if}
    {/if}
</div>
