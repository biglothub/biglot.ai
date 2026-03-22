<script lang="ts">
    import type { ReasoningBlock } from '$lib/types/contentBlock';

    let { symbol, direction, confidence, verdict, evidenceFor, evidenceAgainst, keyUnknowns, reasoning }: ReasoningBlock = $props();

    let expanded = $state(false);

    const directionColor = $derived(
        direction === 'long'    ? '#22c55e' :
        direction === 'short'   ? '#ef4444' : '#94a3b8'
    );
    const directionBg = $derived(
        direction === 'long'    ? 'rgba(34,197,94,0.12)' :
        direction === 'short'   ? 'rgba(239,68,68,0.12)' : 'rgba(148,163,184,0.12)'
    );

    const confidenceColor = $derived(
        confidence >= 8 ? '#22c55e' :
        confidence >= 6 ? '#eab308' :
        confidence >= 4 ? '#f97316' : '#ef4444'
    );

    const confidenceLabel = $derived(
        confidence >= 8 ? 'High' :
        confidence >= 6 ? 'Moderate' :
        confidence >= 4 ? 'Low' : 'Very Low'
    );

    // Confidence arc (SVG)
    const arcR   = 28;
    const arcCx  = 36;
    const arcCy  = 36;
    const arcLen = $derived(Math.PI * arcR * (confidence / 10));
    const arcTotal = Math.PI * arcR;

    function tagColor(tag: string): string {
        return tag === 'bullish' ? '#22c55e' : tag === 'bearish' ? '#ef4444' : '#94a3b8';
    }
    function tagBg(tag: string): string {
        return tag === 'bullish' ? 'rgba(34,197,94,0.10)' : tag === 'bearish' ? 'rgba(239,68,68,0.10)' : 'rgba(148,163,184,0.10)';
    }
    function weightDots(w: number): string {
        return '●'.repeat(Math.min(3, Math.max(1, w))) + '○'.repeat(3 - Math.min(3, Math.max(1, w)));
    }

    // Markdown-lite renderer for verdict (bold + line breaks only)
    function renderMarkdown(text: string): string {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }
</script>

<div class="reasoning-block">
    <!-- Header -->
    <div class="rb-header">
        <div class="rb-title-row">
            <span class="rb-symbol">{symbol}</span>
            <span class="rb-direction" style="background:{directionBg}; color:{directionColor}">
                {direction.toUpperCase()}
            </span>
            <span class="rb-label">Trade Reasoning</span>
        </div>

        <!-- Confidence Arc -->
        <div class="rb-confidence">
            <svg width="72" height="44" viewBox="0 0 72 44" aria-label="Confidence {confidence}/10">
                <!-- Background arc (bottom half of circle) -->
                <path
                    d="M 8 36 A 28 28 0 0 1 64 36"
                    fill="none"
                    stroke="rgba(255,255,255,0.1)"
                    stroke-width="5"
                    stroke-linecap="round"
                />
                <!-- Foreground arc -->
                <path
                    d="M 8 36 A 28 28 0 0 1 64 36"
                    fill="none"
                    stroke={confidenceColor}
                    stroke-width="5"
                    stroke-linecap="round"
                    stroke-dasharray="{arcLen} {arcTotal}"
                />
                <text x="36" y="32" text-anchor="middle" font-size="13" font-weight="700" fill={confidenceColor}>{confidence}/10</text>
                <text x="36" y="42" text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.45)">{confidenceLabel}</text>
            </svg>
        </div>
    </div>

    <!-- Verdict -->
    <div class="rb-verdict">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html renderMarkdown(verdict)}
    </div>

    <!-- Evidence columns -->
    <div class="rb-evidence-grid">
        <!-- Evidence FOR -->
        <div class="rb-evidence-col">
            <div class="rb-col-header" style="color:#22c55e; border-color:rgba(34,197,94,0.25)">
                <span class="rb-col-icon">▲</span> Evidence For ({evidenceFor.length})
            </div>
            {#each evidenceFor as item}
                <div class="rb-evidence-item" style="border-color:{tagBg(item.tag)}; background:{tagBg(item.tag)}">
                    <div class="rb-item-top">
                        <span class="rb-item-cat" style="color:{tagColor(item.tag)}">{item.category}</span>
                        <span class="rb-item-weight" style="color:{tagColor(item.tag)}" title="Weight {item.weight}/3">{weightDots(item.weight)}</span>
                    </div>
                    <div class="rb-item-point">{item.point}</div>
                </div>
            {/each}
            {#if evidenceFor.length === 0}
                <div class="rb-empty">No bullish evidence found</div>
            {/if}
        </div>

        <!-- Evidence AGAINST -->
        <div class="rb-evidence-col">
            <div class="rb-col-header" style="color:#ef4444; border-color:rgba(239,68,68,0.25)">
                <span class="rb-col-icon">▼</span> Evidence Against ({evidenceAgainst.length})
            </div>
            {#each evidenceAgainst as item}
                <div class="rb-evidence-item" style="border-color:{tagBg(item.tag)}; background:{tagBg(item.tag)}">
                    <div class="rb-item-top">
                        <span class="rb-item-cat" style="color:{tagColor(item.tag)}">{item.category}</span>
                        <span class="rb-item-weight" style="color:{tagColor(item.tag)}" title="Weight {item.weight}/3">{weightDots(item.weight)}</span>
                    </div>
                    <div class="rb-item-point">{item.point}</div>
                </div>
            {/each}
            {#if evidenceAgainst.length === 0}
                <div class="rb-empty">No bearish evidence found</div>
            {/if}
        </div>
    </div>

    <!-- Key Unknowns -->
    {#if keyUnknowns.length > 0}
        <div class="rb-unknowns">
            <div class="rb-unknowns-title">⚠ Key Unknowns / Risks</div>
            <ul class="rb-unknowns-list">
                {#each keyUnknowns as unknown}
                    <li>{unknown}</li>
                {/each}
            </ul>
        </div>
    {/if}

    <!-- Chain-of-thought (expandable) -->
    {#if reasoning}
        <button class="rb-expand-btn" onclick={() => (expanded = !expanded)}>
            {expanded ? '▲ Hide' : '▼ Show'} Chain-of-Thought Reasoning
        </button>
        {#if expanded}
            <div class="rb-reasoning">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html renderMarkdown(reasoning)}
            </div>
        {/if}
    {/if}
</div>

<style>
    .reasoning-block {
        background: rgba(13, 17, 23, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        padding: 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        max-width: 680px;
    }

    .rb-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
    }

    .rb-title-row {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        flex-wrap: wrap;
    }

    .rb-symbol {
        font-size: 1.1rem;
        font-weight: 700;
        color: #f8fafc;
    }

    .rb-direction {
        font-size: 0.68rem;
        font-weight: 800;
        letter-spacing: 0.1em;
        padding: 3px 9px;
        border-radius: 999px;
    }

    .rb-label {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.4);
    }

    .rb-confidence {
        flex-shrink: 0;
    }

    .rb-verdict {
        font-size: 0.83rem;
        color: rgba(255, 255, 255, 0.8);
        line-height: 1.55;
        background: rgba(255, 255, 255, 0.04);
        border-left: 3px solid rgba(255, 255, 255, 0.15);
        padding: 0.55rem 0.75rem;
        border-radius: 0 8px 8px 0;
    }

    .rb-evidence-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.65rem;
    }

    @media (max-width: 480px) {
        .rb-evidence-grid {
            grid-template-columns: 1fr;
        }
    }

    .rb-evidence-col {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }

    .rb-col-header {
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding-bottom: 0.35rem;
        border-bottom: 1px solid;
        margin-bottom: 0.1rem;
    }

    .rb-col-icon {
        margin-right: 0.2em;
    }

    .rb-evidence-item {
        border-radius: 8px;
        padding: 0.45rem 0.6rem;
        border: 1px solid;
    }

    .rb-item-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.2rem;
    }

    .rb-item-cat {
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }

    .rb-item-weight {
        font-size: 0.6rem;
        letter-spacing: -0.02em;
    }

    .rb-item-point {
        font-size: 0.76rem;
        color: rgba(255, 255, 255, 0.75);
        line-height: 1.4;
    }

    .rb-empty {
        font-size: 0.73rem;
        color: rgba(255, 255, 255, 0.3);
        font-style: italic;
        padding: 0.3rem 0;
    }

    .rb-unknowns {
        background: rgba(251, 191, 36, 0.06);
        border: 1px solid rgba(251, 191, 36, 0.15);
        border-radius: 8px;
        padding: 0.6rem 0.75rem;
    }

    .rb-unknowns-title {
        font-size: 0.72rem;
        font-weight: 700;
        color: rgba(251, 191, 36, 0.85);
        margin-bottom: 0.35rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .rb-unknowns-list {
        margin: 0;
        padding-left: 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }

    .rb-unknowns-list li {
        font-size: 0.76rem;
        color: rgba(255, 255, 255, 0.65);
        line-height: 1.4;
    }

    .rb-expand-btn {
        background: none;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: rgba(255, 255, 255, 0.45);
        font-size: 0.72rem;
        padding: 0.4rem 0.75rem;
        cursor: pointer;
        text-align: left;
        transition: border-color 0.15s, color 0.15s;
    }

    .rb-expand-btn:hover {
        border-color: rgba(255, 255, 255, 0.25);
        color: rgba(255, 255, 255, 0.7);
    }

    .rb-reasoning {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.7);
        line-height: 1.65;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 8px;
        padding: 0.75rem 0.85rem;
        border: 1px solid rgba(255, 255, 255, 0.07);
        max-height: 420px;
        overflow-y: auto;
    }

    .rb-reasoning :global(strong) {
        color: #f8fafc;
        font-weight: 700;
    }
</style>
