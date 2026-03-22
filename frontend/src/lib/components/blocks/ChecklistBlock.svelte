<script lang="ts">
    import type { ChecklistBlock, ChecklistItemStatus } from '$lib/types/contentBlock';

    let { symbol, direction, items, passCount, failCount, warningCount, readinessScore, recommendation }: ChecklistBlock = $props();

    const directionColor = $derived(
        direction === 'long'  ? '#22c55e' :
        direction === 'short' ? '#ef4444' : '#94a3b8'
    );
    const directionBg = $derived(
        direction === 'long'  ? 'rgba(34,197,94,0.12)' :
        direction === 'short' ? 'rgba(239,68,68,0.12)' : 'rgba(148,163,184,0.12)'
    );

    const recColor = $derived(
        recommendation === 'PROCEED' ? '#22c55e' :
        recommendation === 'ABORT'   ? '#ef4444' : '#eab308'
    );
    const recBg = $derived(
        recommendation === 'PROCEED' ? 'rgba(34,197,94,0.12)' :
        recommendation === 'ABORT'   ? 'rgba(239,68,68,0.12)' : 'rgba(234,179,8,0.12)'
    );

    const scoreColor = $derived(
        readinessScore >= 75 ? '#22c55e' :
        readinessScore >= 50 ? '#eab308' :
        readinessScore >= 25 ? '#f97316' : '#ef4444'
    );

    // Arc gauge params
    const arcR   = 30;
    const arcCx  = 38;
    const arcCy  = 38;
    const arcTotal = Math.PI * arcR;
    const arcLen = $derived(Math.PI * arcR * (readinessScore / 100));

    function statusIcon(s: ChecklistItemStatus): string {
        if (s === 'pass')    return '✓';
        if (s === 'fail')    return '✗';
        if (s === 'warning') return '⚠';
        return '–';
    }

    function statusColor(s: ChecklistItemStatus): string {
        if (s === 'pass')    return '#22c55e';
        if (s === 'fail')    return '#ef4444';
        if (s === 'warning') return '#eab308';
        return '#64748b';
    }

    function statusBg(s: ChecklistItemStatus): string {
        if (s === 'pass')    return 'rgba(34,197,94,0.08)';
        if (s === 'fail')    return 'rgba(239,68,68,0.08)';
        if (s === 'warning') return 'rgba(234,179,8,0.08)';
        return 'rgba(100,116,139,0.06)';
    }
</script>

<div class="checklist-block">
    <!-- Header -->
    <div class="cb-header">
        <div class="cb-title-row">
            <span class="cb-symbol">{symbol}</span>
            <span class="cb-direction" style="background:{directionBg}; color:{directionColor}">
                {direction.toUpperCase()}
            </span>
            <span class="cb-label">Pre-Trade Checklist</span>
        </div>

        <!-- Score arc -->
        <div class="cb-score-wrap">
            <svg width="76" height="46" viewBox="0 0 76 46" aria-label="Readiness {readinessScore}/100">
                <path d="M 8 38 A 30 30 0 0 1 68 38"
                    fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="5" stroke-linecap="round" />
                <path d="M 8 38 A 30 30 0 0 1 68 38"
                    fill="none" stroke={scoreColor} stroke-width="5" stroke-linecap="round"
                    stroke-dasharray="{arcLen} {arcTotal}" />
                <text x={arcCx} y="33" text-anchor="middle" font-size="12" font-weight="700" fill={scoreColor}>{readinessScore}</text>
                <text x={arcCx} y="43" text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.4)">/ 100</text>
            </svg>
        </div>
    </div>

    <!-- Recommendation badge -->
    <div class="cb-recommendation" style="background:{recBg}; border-color:color-mix(in srgb,{recColor} 30%,transparent); color:{recColor}">
        <span class="cb-rec-icon">
            {recommendation === 'PROCEED' ? '▶' : recommendation === 'ABORT' ? '✕' : '◈'}
        </span>
        {recommendation}
        <span class="cb-rec-tally">
            {passCount}✓ &nbsp; {warningCount}⚠ &nbsp; {failCount}✗
        </span>
    </div>

    <!-- Checklist items -->
    <div class="cb-items">
        {#each items as item}
            <div class="cb-item" style="background:{statusBg(item.status)}; border-color:color-mix(in srgb,{statusColor(item.status)} 20%,transparent)">
                <div class="cb-item-left">
                    <span class="cb-num">{item.number}</span>
                    <span class="cb-icon" style="color:{statusColor(item.status)}">{statusIcon(item.status)}</span>
                    <div class="cb-item-body">
                        <div class="cb-question" style="color:{item.status === 'skip' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)'}">{item.question}</div>
                        <div class="cb-explanation">{item.explanation}</div>
                    </div>
                </div>
                <span class="cb-status-pill" style="background:color-mix(in srgb,{statusColor(item.status)} 15%,transparent); color:{statusColor(item.status)}">
                    {item.status.toUpperCase()}
                </span>
            </div>
        {/each}
    </div>
</div>

<style>
    .checklist-block {
        background: rgba(13, 17, 23, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        padding: 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        max-width: 640px;
    }

    .cb-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
    }

    .cb-title-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .cb-symbol {
        font-size: 1.05rem;
        font-weight: 700;
        color: #f8fafc;
    }

    .cb-direction {
        font-size: 0.65rem;
        font-weight: 800;
        letter-spacing: 0.1em;
        padding: 2px 8px;
        border-radius: 999px;
    }

    .cb-label {
        font-size: 0.73rem;
        color: rgba(255, 255, 255, 0.38);
    }

    .cb-score-wrap {
        flex-shrink: 0;
    }

    .cb-recommendation {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border: 1px solid;
        border-radius: 8px;
        padding: 0.5rem 0.75rem;
        font-size: 0.82rem;
        font-weight: 800;
        letter-spacing: 0.06em;
    }

    .cb-rec-icon {
        font-size: 0.7rem;
    }

    .cb-rec-tally {
        margin-left: auto;
        font-size: 0.72rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.55);
        letter-spacing: 0.02em;
    }

    .cb-items {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }

    .cb-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.6rem;
        border: 1px solid;
        border-radius: 8px;
        padding: 0.5rem 0.65rem;
    }

    .cb-item-left {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        flex: 1;
        min-width: 0;
    }

    .cb-num {
        font-size: 0.65rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.25);
        min-width: 1rem;
        padding-top: 1px;
    }

    .cb-icon {
        font-size: 0.78rem;
        font-weight: 700;
        min-width: 1rem;
        padding-top: 1px;
    }

    .cb-item-body {
        flex: 1;
        min-width: 0;
    }

    .cb-question {
        font-size: 0.79rem;
        font-weight: 600;
        line-height: 1.3;
    }

    .cb-explanation {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.5);
        line-height: 1.45;
        margin-top: 0.15rem;
    }

    .cb-status-pill {
        font-size: 0.58rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        padding: 2px 7px;
        border-radius: 999px;
        flex-shrink: 0;
        align-self: center;
    }
</style>
