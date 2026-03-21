<script lang="ts">
    import Sidebar from "$lib/components/Sidebar.svelte";
    import { chatState } from "$lib/state/chat.svelte";
    import {
        Activity,
        BarChart3,
        Calendar,
        Globe,
        MessageSquare,
        RefreshCw,
        Send
    } from "lucide-svelte";
    import { onMount } from "svelte";
    import { fade, fly } from "svelte/transition";
    import EquityCurve from "$lib/components/analytics/EquityCurve.svelte";
    import MonthlyReturns from "$lib/components/analytics/MonthlyReturns.svelte";
    import TradeDistribution from "$lib/components/analytics/TradeDistribution.svelte";
    import type { PerformanceData } from "$lib/server/analytics/performanceData";

    type AnalyticsResponse = {
        stats: {
            totalChats: number;
            totalMessages: number;
            totalIndicators: number;
            recentChatsLast7Days: number;
        };
        agentModes: Record<string, number>;
        recentIndicators: Array<{
            name: string;
            created_at: string;
        }>;
        period: string;
    };

    type ModeRow = {
        mode: string;
        label: string;
        count: number;
        percentage: number;
        accent: string;
    };

    const MODE_META: Record<string, { label: string; accent: string }> = {
        coach: { label: "Trading Coach", accent: "#d6b57b" },
        recovery: { label: "Recovery", accent: "#b78368" },
        analyst: { label: "Market Analyst", accent: "#9db1c7" },
        pinescript: { label: "PineScript Engineer", accent: "#a28fca" },
        gold: { label: "Gold Specialist", accent: "#d7a84b" },
        macro: { label: "Macro Analyst", accent: "#91b0a4" },
        portfolio: { label: "Portfolio Manager", accent: "#c0cad8" }
    };

    let sidebarOpen = $state(true);
    let isLoading = $state(true);
    let isRefreshing = $state(false);
    let analytics = $state<AnalyticsResponse | null>(null);
    let error = $state<string | null>(null);
    let lastLoadedAt = $state<Date | null>(null);
    let perfData = $state<PerformanceData | null>(null);
    let perfLoading = $state(false);

    const periodLabel = $derived(analytics ? formatPeriod(analytics.period) : "Last 7 days");
    const modeRows = $derived(analytics ? buildModeRows(analytics.agentModes) : []);

    onMount(() => {
        void loadAnalytics();
        void loadPerfData();
    });

    async function loadAnalytics(mode: "initial" | "refresh" = "initial") {
        const isFirstLoad = mode === "initial" && analytics === null;

        if (isFirstLoad) {
            isLoading = true;
        } else {
            isRefreshing = true;
        }

        error = null;

        try {
            const url = `/api/analytics?biglotUserId=${encodeURIComponent(chatState.biglotUserId)}`;
            const res = await fetch(url);

            if (!res.ok) {
                throw new Error("Failed to load analytics");
            }

            analytics = await res.json() as AnalyticsResponse;
            lastLoadedAt = new Date();
        } catch (e: unknown) {
            error = e instanceof Error ? e.message : "Failed to load analytics";
            console.error("Analytics error:", e);
        } finally {
            if (isFirstLoad) {
                isLoading = false;
            } else {
                isRefreshing = false;
            }
        }
    }

    async function loadPerfData() {
        perfLoading = true;
        try {
            const res = await fetch(`/api/analytics/performance?user_id=${encodeURIComponent(chatState.biglotUserId)}&start_equity=10000`);
            if (res.ok) perfData = await res.json() as PerformanceData;
        } catch { /* silent */ } finally {
            perfLoading = false;
        }
    }

    function buildModeRows(agentModes: Record<string, number>): ModeRow[] {
        const entries = Object.entries(agentModes);
        const total = entries.reduce((sum, [, count]) => sum + count, 0);

        return entries
            .sort(([, a], [, b]) => b - a)
            .map(([mode, count]) => ({
                mode,
                label: getModeLabel(mode),
                count,
                percentage: total > 0 ? Math.round((count / total) * 100) : 0,
                accent: getModeAccent(mode)
            }));
    }

    function getModeLabel(mode: string): string {
        return MODE_META[mode]?.label ?? startCase(mode);
    }

    function getModeAccent(mode: string): string {
        return MODE_META[mode]?.accent ?? "#d6b57b";
    }

    function startCase(value: string): string {
        return value
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function formatPeriod(period: string): string {
        const labels: Record<string, string> = {
            last_7_days: "Last 7 days"
        };

        return labels[period] ?? startCase(period);
    }

    function formatDate(dateStr: string): string {
        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric"
        }).format(new Date(dateStr));
    }

    function formatRefreshedAt(date: Date): string {
        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        }).format(date);
    }

    function formatNumber(value: number): string {
        return new Intl.NumberFormat().format(value);
    }
</script>

<svelte:head>
    <title>Analytics — BigLot.ai</title>
</svelte:head>

<div class="flex h-full overflow-hidden bg-background text-foreground font-sans">
    <Sidebar bind:isOpen={sidebarOpen} />

    <main
        class="analytics-main flex-1 overflow-hidden h-full transition-all duration-300"
        class:ml-64={sidebarOpen}
        class:ml-0={!sidebarOpen}
    >
        <div class="analytics-scroll">
            <div class="analytics-container">
                <header class="analytics-hero">
                    <div class="hero-copy">
                        <p class="hero-eyebrow">{periodLabel}</p>
                        <h1 class="hero-title">Personal Analytics</h1>
                        <p class="hero-description">
                            A quieter ledger of how you use BigLot.ai. Shared indicator activity is
                            called out separately until library ownership exists.
                        </p>
                    </div>

                    <div class="hero-actions">
                        {#if lastLoadedAt}
                            <div class="meta-pill">
                                <Calendar size={14} />
                                <span>Refreshed {formatRefreshedAt(lastLoadedAt)}</span>
                            </div>
                        {/if}

                        <button
                            class="refresh-button"
                            onclick={() => loadAnalytics("refresh")}
                            disabled={isLoading || isRefreshing}
                        >
                            <span class:is-spinning={isLoading || isRefreshing}>
                                <RefreshCw size={15} />
                            </span>
                            <span>{isRefreshing ? "Refreshing" : "Refresh"}</span>
                        </button>
                    </div>
                </header>

                {#if error && analytics}
                    <div class="inline-notice" transition:fade={{ duration: 180 }}>
                        <div>
                            <p class="notice-label">Refresh failed</p>
                            <p class="notice-copy">{error}</p>
                        </div>
                        <button class="notice-action" onclick={() => loadAnalytics("refresh")}>
                            Try again
                        </button>
                    </div>
                {/if}

                {#if isLoading && !analytics}
                    <div class="content-stack" aria-hidden="true">
                        <section class="analytics-panel">
                            <div class="panel-head">
                                <div class="skeleton-line skeleton-line-short"></div>
                                <div class="skeleton-line skeleton-line-medium"></div>
                            </div>

                            <div class="stat-grid">
                                {#each Array.from({ length: 3 }) as _, index}
                                    <article
                                        class="stat-card skeleton-card"
                                        data-skeleton-index={index}
                                    >
                                        <div class="skeleton-badge"></div>
                                        <div class="skeleton-line skeleton-line-short"></div>
                                        <div class="skeleton-line skeleton-line-value"></div>
                                        <div class="skeleton-line skeleton-line-medium"></div>
                                    </article>
                                {/each}
                            </div>
                        </section>

                        <div class="panel-grid">
                            <section class="analytics-panel">
                                <div class="panel-head">
                                    <div class="skeleton-line skeleton-line-short"></div>
                                    <div class="skeleton-line skeleton-line-medium"></div>
                                </div>

                                <div class="stack-list">
                                    {#each Array.from({ length: 4 }) as _, index}
                                        <div class="skeleton-row" data-skeleton-row={index}>
                                            <div class="skeleton-line skeleton-line-medium"></div>
                                            <div class="skeleton-bar">
                                                <div class="skeleton-bar-fill"></div>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </section>

                            <section class="analytics-panel">
                                <div class="panel-head">
                                    <div class="skeleton-line skeleton-line-short"></div>
                                    <div class="skeleton-line skeleton-line-medium"></div>
                                </div>

                                <div class="library-card skeleton-card">
                                    <div class="skeleton-badge"></div>
                                    <div class="skeleton-line skeleton-line-short"></div>
                                    <div class="skeleton-line skeleton-line-value"></div>
                                </div>

                                <div class="stack-list">
                                    {#each Array.from({ length: 3 }) as _, index}
                                        <div class="list-row skeleton-row" data-list-row={index}>
                                            <div class="skeleton-line skeleton-line-medium"></div>
                                            <div class="skeleton-line skeleton-line-short"></div>
                                        </div>
                                    {/each}
                                </div>
                            </section>
                        </div>
                    </div>
                {:else if error && !analytics}
                    <section class="state-card" transition:fly={{ y: 14, duration: 220 }}>
                        <p class="state-kicker">Unavailable</p>
                        <h2 class="state-title">Analytics could not be loaded</h2>
                        <p class="state-copy">{error}</p>
                        <button class="refresh-button" onclick={() => loadAnalytics("initial")}>
                            <RefreshCw size={15} />
                            <span>Retry</span>
                        </button>
                    </section>
                {:else if analytics}
                    <div class="content-stack" transition:fade={{ duration: 180 }}>
                        <section class="analytics-panel">
                            <div class="panel-head">
                                <div>
                                    <p class="panel-eyebrow">Personal usage</p>
                                    <h2 class="panel-title">Your conversation footprint</h2>
                                </div>
                                <p class="panel-caption">Scoped to your chats and prompts</p>
                            </div>

                            <div class="stat-grid">
                                <article class="stat-card">
                                    <div class="stat-icon">
                                        <MessageSquare size={18} />
                                    </div>
                                    <p class="stat-label">Conversations</p>
                                    <p class="stat-value">{formatNumber(analytics.stats.totalChats)}</p>
                                    <p class="stat-meta">All chats tied to this workspace identity</p>
                                </article>

                                <article class="stat-card">
                                    <div class="stat-icon">
                                        <Send size={18} />
                                    </div>
                                    <p class="stat-label">Prompts</p>
                                    <p class="stat-value">{formatNumber(analytics.stats.totalMessages)}</p>
                                    <p class="stat-meta">Your user messages across every conversation</p>
                                </article>

                                <article class="stat-card">
                                    <div class="stat-icon">
                                        <Activity size={18} />
                                    </div>
                                    <p class="stat-label">Active chats</p>
                                    <p class="stat-value">
                                        {formatNumber(analytics.stats.recentChatsLast7Days)}
                                    </p>
                                    <p class="stat-meta">Chats with prompts during the last 7 days</p>
                                </article>
                            </div>
                        </section>

                        <div class="panel-grid">
                            <section class="analytics-panel">
                                <div class="panel-head">
                                    <div>
                                        <p class="panel-eyebrow">Mode mix</p>
                                        <h2 class="panel-title">Where your prompts go</h2>
                                    </div>
                                    <p class="panel-caption">Share of total prompts by assistant mode</p>
                                </div>

                                {#if modeRows.length > 0}
                                    <div class="stack-list">
                                        {#each modeRows as row}
                                            <div class="mode-row">
                                                <div class="mode-copy">
                                                    <span
                                                        class="mode-dot"
                                                        style="background-color: {row.accent}; --mode-accent: {row.accent};"
                                                    ></span>
                                                    <div>
                                                        <p class="mode-name">{row.label}</p>
                                                        <p class="mode-meta">
                                                            {formatNumber(row.count)} prompt{row.count === 1
                                                                ? ""
                                                                : "s"}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div class="mode-meter">
                                                    <div class="mode-track">
                                                        <div
                                                            class="mode-fill"
                                                            style="width: {row.percentage}%; --mode-accent: {row.accent};"
                                                        ></div>
                                                    </div>
                                                    <span class="mode-percentage">{row.percentage}%</span>
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                {:else}
                                    <div class="empty-card">
                                        <p class="empty-title">No prompt activity yet</p>
                                        <p class="empty-copy">
                                            Once you start using assistant modes, their share of your prompt
                                            flow will appear here.
                                        </p>
                                    </div>
                                {/if}
                            </section>

                            <section class="analytics-panel">
                                <div class="panel-head">
                                    <div>
                                        <p class="panel-eyebrow">Indicator library</p>
                                        <h2 class="panel-title">Shared library snapshot</h2>
                                    </div>
                                    <span class="scope-pill">Library-wide</span>
                                </div>

                                <p class="section-note">
                                    These totals are shared across all users until indicators have explicit
                                    ownership in the schema.
                                </p>

                                <div class="library-card">
                                    <div class="stat-icon">
                                        <BarChart3 size={18} />
                                    </div>
                                    <div>
                                        <p class="stat-label">Indicators available</p>
                                        <p class="stat-value compact">
                                            {formatNumber(analytics.stats.totalIndicators)}
                                        </p>
                                    </div>
                                </div>

                                {#if analytics.recentIndicators.length > 0}
                                    <div class="stack-list">
                                        {#each analytics.recentIndicators as indicator}
                                            <div class="list-row">
                                                <div class="indicator-copy">
                                                    <p class="indicator-name">{indicator.name}</p>
                                                    <p class="indicator-meta">Latest additions to the shared library</p>
                                                </div>
                                                <span class="indicator-date">
                                                    {formatDate(indicator.created_at)}
                                                </span>
                                            </div>
                                        {/each}
                                    </div>
                                {:else}
                                    <div class="empty-card">
                                        <div class="empty-icon">
                                            <Globe size={18} />
                                        </div>
                                        <p class="empty-title">No library entries yet</p>
                                        <p class="empty-copy">
                                            When indicators are created, the newest additions will appear here
                                            with shared-library labeling.
                                        </p>
                                    </div>
                                {/if}
                            </section>
                        </div>
                    </div>
                {/if}
            </div>
        </div>

    <!-- ── Performance Analytics ─────────────────────────────────── -->
    {#if !isLoading}
        <section class="analytics-container" style="padding-top:0">
            <div class="analytics-panel" style="margin-bottom:1.5rem">
                <div class="panel-head">
                    <div>
                        <p class="panel-eyebrow">Trade Performance</p>
                        <h2 class="panel-title">Portfolio Analytics</h2>
                    </div>
                </div>
                {#if perfLoading}
                    <div class="flex h-32 items-center justify-center text-sm text-white/40">Loading performance data…</div>
                {:else if perfData && perfData.totalTrades > 0}
                    <div class="grid gap-4 mt-4" style="grid-template-columns:1fr 1fr">
                        <EquityCurve curve={perfData.equityCurve} startEquity={10000} />
                        <TradeDistribution dist={perfData.distribution} />
                    </div>
                    <div class="mt-4">
                        <MonthlyReturns months={perfData.monthlyReturns} />
                    </div>
                    <!-- Metrics row -->
                    <div class="mt-4 grid grid-cols-4 gap-3 text-center text-sm">
                        {#if perfData.metrics.sharpe !== null}
                            <div class="rounded-lg bg-white/5 p-3">
                                <div class="text-xs text-white/40 mb-1">Sharpe</div>
                                <div class="font-bold {perfData.metrics.sharpe >= 1 ? 'text-green-400' : perfData.metrics.sharpe >= 0 ? 'text-white/80' : 'text-red-400'}">{perfData.metrics.sharpe.toFixed(2)}</div>
                            </div>
                        {/if}
                        {#if perfData.metrics.sortino !== null}
                            <div class="rounded-lg bg-white/5 p-3">
                                <div class="text-xs text-white/40 mb-1">Sortino</div>
                                <div class="font-bold {perfData.metrics.sortino >= 1 ? 'text-green-400' : 'text-white/80'}">{perfData.metrics.sortino.toFixed(2)}</div>
                            </div>
                        {/if}
                        {#if perfData.metrics.calmar !== null}
                            <div class="rounded-lg bg-white/5 p-3">
                                <div class="text-xs text-white/40 mb-1">Calmar</div>
                                <div class="font-bold text-white/80">{perfData.metrics.calmar.toFixed(2)}</div>
                            </div>
                        {/if}
                        <div class="rounded-lg bg-white/5 p-3">
                            <div class="text-xs text-white/40 mb-1">Max DD</div>
                            <div class="font-bold text-red-400">{perfData.metrics.maxDrawdownPct.toFixed(1)}%</div>
                        </div>
                    </div>
                {:else}
                    <div class="flex h-24 items-center justify-center text-sm text-white/40">No closed trades yet. Close some positions to see performance analytics.</div>
                {/if}
            </div>
        </section>
    {/if}
    </main>
</div>

<style>
    .analytics-main {
        position: relative;
        background:
            radial-gradient(circle at top, rgba(214, 181, 123, 0.14), transparent 30%),
            radial-gradient(circle at 85% 15%, rgba(244, 238, 220, 0.08), transparent 24%),
            linear-gradient(180deg, #0d0c0a 0%, #060606 100%);
    }

    .analytics-main::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background:
            linear-gradient(135deg, rgba(214, 181, 123, 0.08), transparent 40%),
            linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.02));
    }

    .analytics-scroll {
        position: relative;
        z-index: 1;
        height: 100%;
        overflow-y: auto;
    }

    .analytics-container {
        max-width: 1080px;
        margin: 0 auto;
        padding: 3.5rem 2rem 4rem;
    }

    .analytics-hero,
    .panel-head,
    .mode-row,
    .list-row,
    .library-card,
    .inline-notice,
    .state-card,
    .empty-card {
        border: 1px solid rgba(214, 181, 123, 0.16);
    }

    .analytics-hero {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 1.5rem;
        padding: 0 0 2rem;
        margin-bottom: 1.75rem;
        border-width: 0 0 1px;
    }

    .hero-copy {
        max-width: 42rem;
    }

    .hero-eyebrow,
    .panel-eyebrow,
    .stat-label,
    .notice-label,
    .state-kicker {
        margin: 0;
        color: rgba(227, 207, 165, 0.72);
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 0.72rem;
    }

    .hero-title,
    .panel-title,
    .state-title {
        margin: 0.35rem 0 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
        font-weight: 600;
        letter-spacing: -0.03em;
        color: rgba(255, 250, 239, 0.96);
    }

    .hero-title {
        font-size: clamp(2.5rem, 5vw, 4.1rem);
        line-height: 0.96;
    }

    .panel-title,
    .state-title {
        font-size: clamp(1.55rem, 2vw, 2rem);
        line-height: 1.04;
    }

    .hero-description,
    .panel-caption,
    .stat-meta,
    .mode-meta,
    .indicator-meta,
    .empty-copy,
    .notice-copy,
    .state-copy,
    .section-note {
        margin: 0;
        color: rgba(245, 239, 228, 0.62);
        line-height: 1.55;
    }

    .hero-description {
        margin-top: 1rem;
        max-width: 34rem;
        font-size: 0.98rem;
    }

    .hero-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 0.75rem;
        align-items: center;
    }

    .meta-pill,
    .refresh-button,
    .notice-action,
    .scope-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        border-radius: 999px;
        font-size: 0.82rem;
        letter-spacing: 0.02em;
    }

    .meta-pill,
    .scope-pill {
        padding: 0.8rem 1rem;
        color: rgba(249, 244, 236, 0.72);
        background: rgba(255, 255, 255, 0.03);
    }

    .refresh-button,
    .notice-action {
        padding: 0.82rem 1.1rem;
        background: linear-gradient(180deg, rgba(214, 181, 123, 0.18), rgba(214, 181, 123, 0.1));
        color: rgba(255, 247, 232, 0.95);
        border: 1px solid rgba(214, 181, 123, 0.24);
        cursor: pointer;
        transition:
            background-color 160ms ease,
            border-color 160ms ease,
            transform 160ms ease;
    }

    .refresh-button:hover,
    .notice-action:hover {
        background: linear-gradient(180deg, rgba(214, 181, 123, 0.24), rgba(214, 181, 123, 0.14));
        border-color: rgba(214, 181, 123, 0.34);
        transform: translateY(-1px);
    }

    .refresh-button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
        transform: none;
    }

    .is-spinning {
        animation: analytics-spin 0.9s linear infinite;
    }

    .inline-notice,
    .state-card,
    .analytics-panel,
    .stat-card,
    .mode-row,
    .list-row,
    .library-card,
    .empty-card {
        background: rgba(12, 11, 9, 0.8);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22);
    }

    .inline-notice {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border-radius: 1.25rem;
        padding: 1rem 1.15rem;
        margin-bottom: 1.4rem;
    }

    .content-stack {
        display: grid;
        gap: 1.4rem;
    }

    .analytics-panel {
        border-radius: 1.5rem;
        padding: 1.5rem;
    }

    .panel-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 1rem;
        padding: 0 0 1.2rem;
        margin-bottom: 1.35rem;
        border-width: 0 0 1px;
        background: transparent;
        box-shadow: none;
    }

    .panel-caption {
        max-width: 16rem;
        text-align: right;
        font-size: 0.9rem;
    }

    .stat-grid,
    .panel-grid {
        display: grid;
        gap: 1rem;
    }

    .stat-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .panel-grid {
        grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    }

    .stat-card,
    .library-card,
    .empty-card,
    .state-card {
        border-radius: 1.25rem;
        padding: 1.25rem;
    }

    .stat-card {
        min-height: 13rem;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 1rem;
    }

    .stat-icon,
    .empty-icon,
    .skeleton-badge {
        width: 2.6rem;
        height: 2.6rem;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 245, 223, 0.82);
        background: linear-gradient(180deg, rgba(214, 181, 123, 0.22), rgba(214, 181, 123, 0.08));
        border: 1px solid rgba(214, 181, 123, 0.18);
    }

    .stat-value {
        margin: 0;
        font-size: clamp(2.2rem, 4vw, 3rem);
        line-height: 0.95;
        color: rgba(255, 250, 242, 0.98);
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.05em;
    }

    .stat-value.compact {
        font-size: clamp(1.9rem, 3vw, 2.5rem);
    }

    .stack-list {
        display: grid;
        gap: 0.9rem;
    }

    .mode-row,
    .list-row {
        border-radius: 1.15rem;
        padding: 0.95rem 1rem;
    }

    .mode-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    }

    .mode-copy,
    .indicator-copy {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        min-width: 0;
    }

    .mode-dot {
        width: 0.68rem;
        height: 0.68rem;
        border-radius: 999px;
        flex-shrink: 0;
        box-shadow: 0 0 14px color-mix(in srgb, var(--mode-accent, #d6b57b) 70%, transparent);
    }

    .mode-name,
    .indicator-name,
    .empty-title {
        margin: 0;
        color: rgba(255, 249, 238, 0.94);
        font-size: 0.98rem;
    }

    .mode-meter {
        display: flex;
        align-items: center;
        gap: 0.8rem;
        min-width: min(46%, 16rem);
    }

    .mode-track,
    .skeleton-bar {
        flex: 1;
        height: 0.48rem;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.07);
    }

    .mode-fill,
    .skeleton-bar-fill {
        height: 100%;
        border-radius: inherit;
    }

    .mode-fill {
        background: linear-gradient(
            90deg,
            color-mix(in srgb, var(--mode-accent, #d6b57b) 35%, transparent),
            var(--mode-accent, #d6b57b)
        );
    }

    .mode-percentage,
    .indicator-date {
        flex-shrink: 0;
        font-size: 0.85rem;
        color: rgba(245, 239, 228, 0.72);
        font-variant-numeric: tabular-nums;
    }

    .section-note {
        margin-bottom: 1rem;
        font-size: 0.92rem;
    }

    .library-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
    }

    .scope-pill {
        color: rgba(255, 244, 220, 0.86);
        border: 1px solid rgba(214, 181, 123, 0.18);
    }

    .state-card,
    .empty-card {
        display: grid;
        gap: 0.8rem;
    }

    .state-card {
        max-width: 34rem;
    }

    .skeleton-line,
    .skeleton-bar-fill {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.08), rgba(214, 181, 123, 0.18));
    }

    .skeleton-line {
        height: 0.72rem;
        border-radius: 999px;
    }

    .skeleton-line-short {
        width: 7rem;
    }

    .skeleton-line-medium {
        width: 12rem;
    }

    .skeleton-line-value {
        width: 5.5rem;
        height: 2.1rem;
    }

    .skeleton-card {
        pointer-events: none;
    }

    .skeleton-row {
        display: grid;
        gap: 0.85rem;
    }

    .empty-icon {
        color: rgba(255, 245, 223, 0.72);
    }

    @keyframes analytics-spin {
        to {
            transform: rotate(360deg);
        }
    }

    @media (max-width: 960px) {
        .analytics-container {
            padding: 2rem 1.25rem 3rem;
        }

        .analytics-hero,
        .panel-head,
        .mode-row,
        .inline-notice {
            align-items: flex-start;
            flex-direction: column;
        }

        .hero-actions,
        .mode-meter {
            width: 100%;
        }

        .hero-actions {
            justify-content: flex-start;
        }

        .panel-caption {
            max-width: none;
            text-align: left;
        }

        .stat-grid,
        .panel-grid {
            grid-template-columns: 1fr;
        }

        .mode-meter {
            min-width: 0;
        }
    }

    @media (max-width: 640px) {
        .analytics-container {
            padding-inline: 1rem;
        }

        .analytics-panel,
        .state-card {
            padding: 1.1rem;
        }

        .stat-card {
            min-height: auto;
        }

        .list-row {
            align-items: flex-start;
            flex-direction: column;
        }
    }
</style>
