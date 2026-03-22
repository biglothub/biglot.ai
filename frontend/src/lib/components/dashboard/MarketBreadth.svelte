<script lang="ts">
    import type { BreadthSnapshot } from '$lib/server/data/breadth.data';

    function heatmapColor(pct: number): string {
        if (pct > 5) return '#16a34a';
        if (pct > 2) return '#4ade80';
        if (pct > 0) return '#86efac';
        if (pct > -2) return '#fca5a5';
        if (pct > -5) return '#f87171';
        return '#dc2626';
    }

    const { data }: { data: BreadthSnapshot | null } = $props();

    const sectors = $derived(data?.sectors?.filter(s => s.ticker !== 'SPY') ?? []);
    const spy = $derived(data?.sectors?.find(s => s.ticker === 'SPY') ?? null);

    let view = $state<'1d' | '1w' | '1m' | 'vsspy'>('1m');

    const labels: Record<typeof view, string> = {
        '1d': '1D',
        '1w': '1W',
        '1m': '1M',
        'vsspy': 'vs SPY'
    };

    function getValue(sector: BreadthSnapshot['sectors'][0]): number {
        if (view === '1d') return sector.change1d;
        if (view === '1w') return sector.change1w;
        if (view === 'vsspy') return sector.vsSpY1m;
        return sector.change1m;
    }

    function fmt(n: number): string {
        return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
    }
</script>

<div class="rounded-xl border border-white/10 bg-white/5 p-4">
    <div class="mb-3 flex items-center justify-between">
        <h3 class="text-sm font-semibold text-white/80">Sector Rotation</h3>
        <div class="flex gap-1">
            {#each (['1d', '1w', '1m', 'vsspy'] as const) as v}
                <button
                    onclick={() => view = v}
                    class="rounded px-2 py-0.5 text-xs transition-colors {view === v
                        ? 'bg-white/20 text-white'
                        : 'text-white/50 hover:text-white/80'}"
                >
                    {labels[v]}
                </button>
            {/each}
        </div>
    </div>

    {#if !data || sectors.length === 0}
        <div class="flex h-24 items-center justify-center text-sm text-white/40">
            Market breadth data unavailable
        </div>
    {:else}
        <!-- Sector heatmap grid -->
        <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {#each sectors as sector}
                {@const val = getValue(sector)}
                {@const bg = heatmapColor(view === 'vsspy' ? val * 2 : val)}
                <div
                    class="flex flex-col rounded-lg p-2 text-center"
                    style="background-color: {bg}22; border: 1px solid {bg}44;"
                    title="{sector.name}: {fmt(val)}"
                >
                    <span class="text-xs font-bold text-white/90">{sector.ticker}</span>
                    <span class="mt-0.5 text-xs text-white/60 truncate">{sector.name}</span>
                    <span
                        class="mt-1 text-sm font-semibold"
                        style="color: {bg};"
                    >{fmt(val)}</span>
                </div>
            {/each}
        </div>

        <!-- SPY reference row -->
        {#if spy}
            <div class="mt-3 flex items-center justify-between border-t border-white/10 pt-2 text-xs text-white/50">
                <span>SPY {labels[view === 'vsspy' ? '1m' : view]}</span>
                <span class={spy.change1m >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {fmt(view === '1d' ? spy.change1d : view === '1w' ? spy.change1w : spy.change1m)}
                </span>
            </div>
        {/if}
    {/if}
</div>
