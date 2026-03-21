<script lang="ts">
    import type { MonthlyReturn } from '$lib/server/analytics/performanceData';

    const { months }: { months: MonthlyReturn[] } = $props();

    const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    function heatColor(pct: number | null): string {
        if (pct === null) return 'rgba(255,255,255,0.05)';
        const clamped = Math.max(-10, Math.min(10, pct));
        if (clamped > 0) {
            const intensity = Math.min(1, clamped / 10);
            return `rgba(34,197,94,${0.15 + intensity * 0.65})`;
        } else {
            const intensity = Math.min(1, Math.abs(clamped) / 10);
            return `rgba(239,68,68,${0.15 + intensity * 0.65})`;
        }
    }

    function fmt(pct: number | null): string {
        if (pct === null) return '';
        return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    }

    // Group by year
    const years = $derived([...new Set(months.map(m => m.year))].sort());
</script>

<div class="rounded-xl border border-white/10 bg-white/5 p-4">
    <h3 class="mb-3 text-sm font-semibold text-white/80">Monthly Returns</h3>

    {#if months.length === 0}
        <div class="flex h-16 items-center justify-center text-sm text-white/40">No data yet</div>
    {:else}
        <div class="overflow-x-auto">
            <table class="w-full text-xs">
                <thead>
                    <tr>
                        <th class="py-1 pr-2 text-left text-white/40 font-normal">Year</th>
                        {#each MONTH_LABELS as label}
                            <th class="px-0.5 py-1 text-center text-white/40 font-normal w-9">{label}</th>
                        {/each}
                    </tr>
                </thead>
                <tbody>
                    {#each years as year}
                        <tr>
                            <td class="pr-2 py-0.5 text-white/60 font-semibold">{year}</td>
                            {#each MONTH_LABELS as _, idx}
                                {@const entry = months.find(m => m.year === year && m.month === idx + 1)}
                                <td class="px-0.5 py-0.5">
                                    <div
                                        class="flex h-7 w-8 items-center justify-center rounded text-[10px] font-medium"
                                        style="background:{heatColor(entry?.returnPct ?? null)};color:{entry ? (entry.returnPct ?? 0) >= 0 ? '#86efac' : '#fca5a5' : 'rgba(255,255,255,0.2)'}"
                                    >
                                        {entry ? fmt(entry.returnPct) : ''}
                                    </div>
                                </td>
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>
