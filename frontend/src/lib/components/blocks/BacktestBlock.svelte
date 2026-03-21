<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import {
        createChart,
        LineSeries,
        ColorType,
        CrosshairMode,
        type IChartApi,
        type UTCTimestamp,
    } from 'lightweight-charts';
    import type { BacktestBlock } from '$lib/types/contentBlock';

    let {
        symbol,
        timeframe,
        initialCapital,
        finalCapital,
        startTime,
        endTime,
        trades,
        equity,
        metrics,
        inSampleMetrics,
        outOfSampleMetrics,
        degradationPct,
    }: BacktestBlock = $props();

    // ─── Formatting ────────────────────────────────────────────────────────────

    function fmtPct(v: number, decimals = 1): string {
        const sign = v > 0 ? '+' : '';
        return `${sign}${v.toFixed(decimals)}%`;
    }

    function fmtNum(v: number, decimals = 2): string {
        if (!isFinite(v)) return '∞';
        return v.toFixed(decimals);
    }

    function fmtCurrency(v: number): string {
        return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    }

    function fmtDate(unix: number): string {
        return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    }

    function exitColor(reason: string): string {
        if (reason === 'take_profit') return '#22c55e';
        if (reason === 'stop_loss' || reason === 'max_drawdown') return '#ef4444';
        return 'rgba(255,255,255,0.45)';
    }

    const returnColor = $derived(metrics.totalReturn >= 0 ? '#22c55e' : '#ef4444');
    const hasWalkForward = $derived(inSampleMetrics !== undefined && outOfSampleMetrics !== undefined);

    // ─── Charts ────────────────────────────────────────────────────────────────

    let equityContainer = $state<HTMLDivElement>(null!);
    let drawdownContainer = $state<HTMLDivElement>(null!);
    let equityChart: IChartApi | null = null;
    let drawdownChart: IChartApi | null = null;
    let resizeObserver: ResizeObserver | null = null;

    function chartOptions(container: HTMLDivElement, height: number) {
        return {
            width: container.clientWidth,
            height,
            layout: {
                background: { type: ColorType.Solid as const, color: 'transparent' },
                textColor: 'rgba(255,255,255,0.45)',
                fontSize: 10,
                fontFamily: "'Inter', sans-serif",
            },
            grid: {
                vertLines: { color: 'rgba(255,255,255,0.04)' },
                horzLines: { color: 'rgba(255,255,255,0.04)' },
            },
            crosshair: { mode: CrosshairMode.Normal },
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
            timeScale: {
                borderColor: 'rgba(255,255,255,0.08)',
                timeVisible: true,
            },
            handleScroll: false,
            handleScale: false,
        };
    }

    onMount(() => {
        if (!equityContainer || equity.length === 0) return;

        equityChart = createChart(equityContainer, chartOptions(equityContainer, 160));
        const equitySeries = equityChart.addSeries(LineSeries, {
            color: '#6366f1',
            lineWidth: 2,
            priceLineVisible: false,
        });
        equitySeries.setData(
            equity.map((pt) => ({ time: pt.time as UTCTimestamp, value: pt.equity }))
        );
        equityChart.timeScale().fitContent();

        drawdownChart = createChart(drawdownContainer, chartOptions(drawdownContainer, 80));
        const ddSeries = drawdownChart.addSeries(LineSeries, {
            color: '#ef4444',
            lineWidth: 1,
            priceLineVisible: false,
        });
        ddSeries.setData(
            equity.map((pt) => ({ time: pt.time as UTCTimestamp, value: -pt.drawdownPct }))
        );
        drawdownChart.timeScale().fitContent();

        resizeObserver = new ResizeObserver(() => {
            if (equityChart && equityContainer) {
                equityChart.applyOptions({ width: equityContainer.clientWidth });
            }
            if (drawdownChart && drawdownContainer) {
                drawdownChart.applyOptions({ width: drawdownContainer.clientWidth });
            }
        });
        resizeObserver.observe(equityContainer);

        return () => {
            resizeObserver?.disconnect();
            equityChart?.remove();
            drawdownChart?.remove();
        };
    });
</script>

<div class="bt">
    <!-- Header -->
    <div class="bt-header">
        <div class="bt-title">
            <span class="bt-symbol">{symbol}</span>
            <span class="bt-tf">{timeframe}</span>
            <span class="bt-period">{fmtDate(startTime)} – {fmtDate(endTime)}</span>
        </div>
        <div class="bt-return" style="color:{returnColor}">{fmtPct(metrics.totalReturn)}</div>
    </div>

    <!-- Key Metrics Grid -->
    <div class="bt-metrics">
        <div class="bt-metric">
            <span class="bt-ml">Total Return</span>
            <span class="bt-mv" style="color:{returnColor}">{fmtPct(metrics.totalReturn)}</span>
        </div>
        <div class="bt-metric">
            <span class="bt-ml">Max Drawdown</span>
            <span class="bt-mv" style="color:#ef4444">-{fmtNum(metrics.maxDrawdown)}%</span>
        </div>
        <div class="bt-metric">
            <span class="bt-ml">Sharpe</span>
            <span class="bt-mv">{fmtNum(metrics.sharpe)}</span>
        </div>
        <div class="bt-metric">
            <span class="bt-ml">Win Rate</span>
            <span class="bt-mv">{fmtNum(metrics.winRate)}%</span>
        </div>
        <div class="bt-metric">
            <span class="bt-ml">Trades</span>
            <span class="bt-mv">{metrics.totalTrades}</span>
        </div>
        <div class="bt-metric">
            <span class="bt-ml">Profit Factor</span>
            <span class="bt-mv">{fmtNum(metrics.profitFactor)}</span>
        </div>
        <div class="bt-metric">
            <span class="bt-ml">Avg R</span>
            <span class="bt-mv">{fmtNum(metrics.avgRMultiple)}R</span>
        </div>
        <div class="bt-metric">
            <span class="bt-ml">Expectancy</span>
            <span class="bt-mv">{fmtCurrency(metrics.expectancy)}</span>
        </div>
        <div class="bt-metric">
            <span class="bt-ml">Capital</span>
            <span class="bt-mv">{fmtCurrency(finalCapital)}</span>
        </div>
        <div class="bt-metric">
            <span class="bt-ml">Max Consec. Losses</span>
            <span class="bt-mv" style="color:#ef4444">{metrics.maxConsecutiveLosses}</span>
        </div>
    </div>

    <!-- Equity Curve -->
    {#if equity.length > 0}
        <div class="bt-chart-label">Equity Curve</div>
        <div bind:this={equityContainer} class="bt-chart-eq"></div>
        <div class="bt-chart-label" style="color:#ef4444">Drawdown</div>
        <div bind:this={drawdownContainer} class="bt-chart-dd"></div>
    {/if}

    <!-- Walk-Forward Results -->
    {#if hasWalkForward && inSampleMetrics && outOfSampleMetrics}
        <div class="bt-wf">
            <div class="bt-wf-title">Walk-Forward Validation</div>
            <div class="bt-wf-grid">
                <div class="bt-wf-col">
                    <div class="bt-wf-label">In-Sample (70%)</div>
                    <div class="bt-wf-val">{fmtPct(inSampleMetrics.totalReturn)}</div>
                    <div class="bt-wf-sub">DD: {fmtNum(inSampleMetrics.maxDrawdown)}% · SR: {fmtNum(inSampleMetrics.sharpe)}</div>
                </div>
                <div class="bt-wf-col">
                    <div class="bt-wf-label">Out-of-Sample (30%)</div>
                    <div class="bt-wf-val">{fmtPct(outOfSampleMetrics.totalReturn)}</div>
                    <div class="bt-wf-sub">DD: {fmtNum(outOfSampleMetrics.maxDrawdown)}% · SR: {fmtNum(outOfSampleMetrics.sharpe)}</div>
                </div>
                {#if degradationPct !== undefined}
                    <div class="bt-wf-col">
                        <div class="bt-wf-label">Degradation</div>
                        <div class="bt-wf-val" style="color:{degradationPct > 30 ? '#ef4444' : '#f59e0b'}">{fmtNum(degradationPct)}%</div>
                        <div class="bt-wf-sub">{degradationPct < 20 ? 'Robust' : degradationPct < 40 ? 'Moderate' : 'High overfit risk'}</div>
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    <!-- Trades Table -->
    {#if trades.length > 0}
        <div class="bt-trades-label">Recent Trades ({Math.min(trades.length, 20)} of {trades.length})</div>
        <div class="bt-trades-wrap">
            <table class="bt-trades">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Dir</th>
                        <th>Entry</th>
                        <th>Exit</th>
                        <th>P&L</th>
                        <th>R</th>
                        <th>Reason</th>
                    </tr>
                </thead>
                <tbody>
                    {#each trades.slice(-20).reverse() as trade}
                        <tr class="bt-trade-row" class:bt-win={trade.pnl > 0} class:bt-loss={trade.pnl <= 0}>
                            <td class="bt-td-date">{fmtDate(trade.exitTime)}</td>
                            <td class="bt-td-dir" style="color:{trade.direction === 'long' ? '#22c55e' : '#ef4444'}">{trade.direction === 'long' ? 'L' : 'S'}</td>
                            <td>{trade.entryPrice.toFixed(2)}</td>
                            <td>{trade.exitPrice.toFixed(2)}</td>
                            <td style="color:{trade.pnl >= 0 ? '#22c55e' : '#ef4444'}">{trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(0)}</td>
                            <td style="color:{trade.rMultiple >= 0 ? '#22c55e' : '#ef4444'}">{trade.rMultiple >= 0 ? '+' : ''}{trade.rMultiple.toFixed(2)}R</td>
                            <td style="color:{exitColor(trade.exitReason)}">{trade.exitReason.replace(/_/g, ' ')}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>

<style>
    .bt {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: 'Inter', sans-serif;
    }

    .bt-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .bt-title {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .bt-symbol {
        font-size: 15px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.9);
    }

    .bt-tf {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.4);
        background: rgba(255, 255, 255, 0.06);
        padding: 2px 6px;
        border-radius: 4px;
    }

    .bt-period {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.35);
    }

    .bt-return {
        font-size: 18px;
        font-weight: 700;
    }

    .bt-metrics {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 8px;
    }

    @media (max-width: 600px) {
        .bt-metrics {
            grid-template-columns: repeat(2, 1fr);
        }
    }

    .bt-metric {
        display: flex;
        flex-direction: column;
        gap: 2px;
        background: rgba(255, 255, 255, 0.025);
        border-radius: 8px;
        padding: 8px 10px;
    }

    .bt-ml {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.35);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .bt-mv {
        font-size: 13px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.85);
    }

    .bt-chart-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.35);
    }

    .bt-chart-eq {
        width: 100%;
        height: 160px;
    }

    .bt-chart-dd {
        width: 100%;
        height: 80px;
    }

    .bt-wf {
        background: rgba(99, 102, 241, 0.06);
        border: 1px solid rgba(99, 102, 241, 0.15);
        border-radius: 8px;
        padding: 12px;
    }

    .bt-wf-title {
        font-size: 11px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 8px;
    }

    .bt-wf-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
    }

    .bt-wf-col {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .bt-wf-label {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.35);
    }

    .bt-wf-val {
        font-size: 15px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.8);
    }

    .bt-wf-sub {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.3);
    }

    .bt-trades-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.35);
    }

    .bt-trades-wrap {
        overflow-x: auto;
    }

    .bt-trades {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
    }

    .bt-trades th {
        text-align: left;
        padding: 4px 8px;
        color: rgba(255, 255, 255, 0.3);
        font-weight: 500;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .bt-trade-row td {
        padding: 4px 8px;
        color: rgba(255, 255, 255, 0.6);
        border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }

    .bt-win td { background: rgba(34, 197, 94, 0.03); }
    .bt-loss td { background: rgba(239, 68, 68, 0.03); }

    .bt-td-date { color: rgba(255, 255, 255, 0.35) !important; }
    .bt-td-dir { font-weight: 700; }
</style>
