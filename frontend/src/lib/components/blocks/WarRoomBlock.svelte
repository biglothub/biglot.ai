<script lang="ts">
    import type { WarRoomBlock, WarRoomTurn } from '$lib/types/contentBlock';

    let { topic, panelists, turns, consensusDirection, consensusConfidence, dissentCount, consensusSummary, status }: WarRoomBlock = $props();

    let expandedTurn = $state<string | null>(null);

    function toggleTurn(turnId: string) {
        expandedTurn = expandedTurn === turnId ? null : turnId;
    }

    function stanceColor(stance: string): string {
        return stance === 'bullish' ? '#22c55e' : stance === 'bearish' ? '#ef4444' : '#94a3b8';
    }
    function stanceBg(stance: string): string {
        return stance === 'bullish' ? 'rgba(34,197,94,0.12)' : stance === 'bearish' ? 'rgba(239,68,68,0.12)' : 'rgba(148,163,184,0.10)';
    }
    function panelistColor(color: string): string {
        const map: Record<string, string> = {
            blue: '#3b82f6', purple: '#a855f7', amber: '#f59e0b', red: '#ef4444',
        };
        return map[color] ?? '#94a3b8';
    }
    function panelistBg(color: string): string {
        const map: Record<string, string> = {
            blue: 'rgba(59,130,246,0.10)', purple: 'rgba(168,85,247,0.10)',
            amber: 'rgba(245,158,11,0.10)', red: 'rgba(239,68,68,0.10)',
        };
        return map[color] ?? 'rgba(148,163,184,0.10)';
    }

    const consensusColor = $derived(stanceColor(consensusDirection));
    const consensusBg = $derived(stanceBg(consensusDirection));

    const confidenceLabel = $derived(
        consensusConfidence >= 8 ? 'High' :
        consensusConfidence >= 6 ? 'Moderate' :
        consensusConfidence >= 4 ? 'Low' : 'Very Low'
    );

    const dirIcon = $derived(
        consensusDirection === 'bullish' ? '▲' :
        consensusDirection === 'bearish' ? '▼' : '→'
    );

    function getPanelist(panelistId: string) {
        return panelists.find(p => p.id === panelistId);
    }

    function renderMarkdown(text: string): string {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }
</script>

<div class="war-room">
    <!-- Header -->
    <div class="wr-header">
        <div class="wr-title-row">
            <span class="wr-icon">⚔</span>
            <span class="wr-title">{topic}</span>
            {#if status === 'error'}
                <span class="wr-status-badge" style="background:rgba(239,68,68,0.12);color:#ef4444">Error</span>
            {/if}
        </div>
        <div class="wr-meta">
            {panelists.length} AI Specialists · Risk Manager speaks last
        </div>
    </div>

    <!-- Panelist Turns -->
    <div class="wr-turns">
        {#each turns as turn (turn.turnId)}
            {@const panelist = getPanelist(turn.panelistId)}
            {@const pColor = panelistColor(panelist?.color ?? 'blue')}
            {@const pBg = panelistBg(panelist?.color ?? 'blue')}
            {@const isExpanded = expandedTurn === turn.turnId}

            <div class="wr-turn" style="border-left-color:{pColor}">
                <!-- Turn Header -->
                <button class="wr-turn-header" onclick={() => toggleTurn(turn.turnId)}>
                    <div class="wr-panelist-info">
                        <span class="wr-emoji">{panelist?.emoji ?? '?'}</span>
                        <div class="wr-panelist-details">
                            <span class="wr-panelist-name" style="color:{pColor}">{panelist?.name ?? turn.panelistId}</span>
                            <span class="wr-specialty">{panelist?.specialty ?? ''}</span>
                        </div>
                    </div>
                    <div class="wr-turn-badges">
                        <span class="wr-stance-badge" style="background:{stanceBg(turn.stance)};color:{stanceColor(turn.stance)}">
                            {turn.stance === 'bullish' ? '▲' : turn.stance === 'bearish' ? '▼' : '→'} {turn.stance.toUpperCase()}
                        </span>
                        <span class="wr-conf-badge" style="background:{pBg};color:{pColor}">
                            {turn.confidence}/10
                        </span>
                        <span class="wr-expand-icon">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                </button>

                <!-- Key Points (always visible) -->
                {#if turn.keyPoints.length > 0}
                    <ul class="wr-key-points">
                        {#each turn.keyPoints as point}
                            <li>{point}</li>
                        {/each}
                    </ul>
                {/if}

                <!-- Full Analysis (expandable) -->
                {#if isExpanded}
                    <div class="wr-full-analysis">
                        <!-- Data Citations -->
                        {#if turn.dataCitations.length > 0}
                            <div class="wr-citations">
                                <span class="wr-citations-label">Data cited:</span>
                                {#each turn.dataCitations as cite}
                                    <span class="wr-citation-tag" style="background:{pBg};color:{pColor}">{cite}</span>
                                {/each}
                            </div>
                        {/if}
                        <!-- Analysis Text -->
                        <div class="wr-analysis-text">
                            {@html renderMarkdown(turn.content)}
                        </div>
                        <!-- Model -->
                        <div class="wr-model-label">Model: {turn.model}</div>
                    </div>
                {/if}
            </div>
        {/each}
    </div>

    <!-- Consensus Footer -->
    <div class="wr-consensus" style="background:{consensusBg};border-color:{consensusColor}">
        <div class="wr-consensus-header">
            <span class="wr-consensus-icon">{dirIcon}</span>
            <span class="wr-consensus-direction" style="color:{consensusColor}">
                {consensusDirection.toUpperCase()} CONSENSUS
            </span>
            <span class="wr-confidence-badge" style="background:{consensusBg};color:{consensusColor}">
                {confidenceLabel} · {consensusConfidence}/10
            </span>
            {#if dissentCount > 0}
                <span class="wr-dissent-badge">{dissentCount} dissenter{dissentCount > 1 ? 's' : ''}</span>
            {/if}
        </div>
        <p class="wr-consensus-summary">{consensusSummary}</p>
    </div>
</div>

<style>
    .war-room {
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        overflow: hidden;
        font-family: inherit;
    }

    /* Header */
    .wr-header {
        padding: 14px 16px 10px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .wr-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .wr-icon {
        font-size: 16px;
    }
    .wr-title {
        font-size: 14px;
        font-weight: 600;
        color: #e2e8f0;
    }
    .wr-status-badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 20px;
        font-weight: 500;
    }
    .wr-meta {
        font-size: 11px;
        color: #64748b;
        margin-top: 3px;
    }

    /* Turns */
    .wr-turns {
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .wr-turn {
        border-left: 3px solid #3b82f6;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        padding: 0;
    }
    .wr-turn:last-child {
        border-bottom: none;
    }

    .wr-turn-header {
        width: 100%;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 16px 8px;
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        color: inherit;
    }
    .wr-turn-header:hover {
        background: rgba(255,255,255,0.02);
    }

    .wr-panelist-info {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
    }
    .wr-emoji {
        font-size: 20px;
        flex-shrink: 0;
    }
    .wr-panelist-details {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
    }
    .wr-panelist-name {
        font-size: 13px;
        font-weight: 600;
    }
    .wr-specialty {
        font-size: 10px;
        color: #64748b;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .wr-turn-badges {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }
    .wr-stance-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 20px;
        white-space: nowrap;
    }
    .wr-conf-badge {
        font-size: 11px;
        font-weight: 500;
        padding: 2px 7px;
        border-radius: 20px;
    }
    .wr-expand-icon {
        font-size: 9px;
        color: #475569;
    }

    /* Key Points */
    .wr-key-points {
        margin: 0 16px 10px 46px;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .wr-key-points li {
        font-size: 12px;
        color: #94a3b8;
        padding-left: 12px;
        position: relative;
    }
    .wr-key-points li::before {
        content: '·';
        position: absolute;
        left: 0;
        color: #475569;
    }

    /* Full Analysis */
    .wr-full-analysis {
        padding: 0 16px 14px 46px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .wr-citations {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
    }
    .wr-citations-label {
        font-size: 10px;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .wr-citation-tag {
        font-size: 10px;
        padding: 2px 7px;
        border-radius: 4px;
        font-weight: 500;
    }
    .wr-analysis-text {
        font-size: 12px;
        color: #94a3b8;
        line-height: 1.6;
    }
    .wr-model-label {
        font-size: 10px;
        color: #334155;
        font-style: italic;
    }

    /* Consensus Footer */
    .wr-consensus {
        padding: 12px 16px;
        border-top: 1px solid;
        margin-top: 0;
    }
    .wr-consensus-header {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 6px;
    }
    .wr-consensus-icon {
        font-size: 14px;
    }
    .wr-consensus-direction {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.05em;
    }
    .wr-confidence-badge {
        font-size: 11px;
        font-weight: 500;
        padding: 2px 8px;
        border-radius: 20px;
    }
    .wr-dissent-badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 20px;
        background: rgba(234,179,8,0.12);
        color: #eab308;
    }
    .wr-consensus-summary {
        font-size: 12px;
        color: #94a3b8;
        margin: 0;
        line-height: 1.5;
    }
</style>
