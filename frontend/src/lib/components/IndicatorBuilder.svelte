<script lang="ts">
    import {
        Play,
        Save,
        Trash2,
        Code2,
        BarChart3,
        Loader2,
        RefreshCw,
        Zap,
        Copy,
        Check,
        AlertTriangle,
        Settings2,
        ExternalLink,
        Table2,
        Bot,
        Shield,
        Clock,
        Activity,
        Cpu,
        Fingerprint,
        ChevronRight,
        Terminal,
    } from "lucide-svelte";
    import { onMount } from "svelte";
    import { indicatorBuilder } from "$lib/state/indicatorBuilder.svelte";
    import { type IndicatorModule } from "$lib/indicatorEngine";
    import IndicatorChart from "./IndicatorChart.svelte";
    import type {
        IndicatorActivityLog,
        IndicatorValue,
        OHLCV,
        CustomIndicator,
        IndicatorConfig,
    } from "$lib/types/indicator";

    const TEMPLATE_GROUPS = [
        {
            label: "Momentum",
            items: [
                "RSI divergence with 70/30 zones and alert markers",
                "MACD momentum shift with histogram coloring",
                "Stochastic reversal with trend filter",
            ],
        },
        {
            label: "Trend",
            items: [
                "EMA crossover with higher timeframe confirmation",
                "SuperTrend with pullback continuation signals",
                "Trend tracer with buy/sell labels and background bias",
            ],
        },
        {
            label: "Structure",
            items: [
                "Order block detector with mitigation highlights",
                "Trend lines with break confirmation and retest labels",
                "Support resistance zones with liquidity sweep markers",
            ],
        },
    ] as const;

    onMount(() => {
        indicatorBuilder.loadIndicators();
    });

    let prompt = $state("");
    let reviewTab = $state<"preview" | "data" | "config">("preview");
    let loadedModule = $state<IndicatorModule | null>(null);
    let editableCode = $state("");
    let copied = $state(false);
    let sqlCopied = $state(false);
    let saving = $state(false);
    let saveSuccess = $state(false);
    let userParams = $state<Record<string, number>>({});
    let testResults = $state<IndicatorValue[] | null>(null);
    let testError = $state<string | null>(null);
    let chartOhlcvData = $state<OHLCV[]>([]);

    let displayedLogs = $state<IndicatorActivityLog[]>([]);
    let showFinalSuccess = $state(false);
    let logContainer: HTMLDivElement;
    let elapsedSeconds = $state(0);
    let elapsedInterval: ReturnType<typeof setInterval> | undefined;
    let sessionId = $state("");

    $effect(() => {
        const rawLogs = indicatorBuilder.progress.activityLog || [];
        const status = indicatorBuilder.progress.status;

        if (rawLogs.length > 0 && displayedLogs.length > 0) {
            if (rawLogs[0].id !== displayedLogs[0].id) {
                displayedLogs = [];
                showFinalSuccess = false;
                return;
            }
        } else if (rawLogs.length === 0 && displayedLogs.length > 0) {
            displayedLogs = [];
            showFinalSuccess = false;
            return;
        }

        if (rawLogs.length > displayedLogs.length) {
            const nextIndex = displayedLogs.length;
            const logToAdd = rawLogs[nextIndex];
            const delay = nextIndex === 0 ? 0 : 800;

            const timeout = setTimeout(() => {
                displayedLogs = [...displayedLogs, logToAdd];
            }, delay);

            return () => clearTimeout(timeout);
        }

        if (
            status === "ready" &&
            rawLogs.length === displayedLogs.length &&
            !showFinalSuccess
        ) {
            const timeout = setTimeout(() => {
                showFinalSuccess = true;
            }, 800);
            return () => clearTimeout(timeout);
        }
    });

    const progress = $derived(indicatorBuilder.progress);
    const isGenerating = $derived(
        progress.status === "generating" || progress.status === "submitting",
    );
    const isReady = $derived(progress.status === "ready");
    const hasActivity = $derived(progress.status !== "idle");
    const activeCode = $derived(editableCode || progress.generatedCode || "");
    const savedIndicators = $derived(indicatorBuilder.indicators);
    const codeLineCount = $derived(
        activeCode ? activeCode.split("\n").length : 0,
    );
    const activeConfig = $derived<IndicatorConfig | null>(
        loadedModule?.indicatorConfig ?? progress.generatedConfig ?? null,
    );
    const configEntries = $derived(
        Object.entries(activeConfig?.params ?? {}),
    );
    const elapsedDisplay = $derived(
        elapsedSeconds < 60
            ? `${elapsedSeconds}s`
            : `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`,
    );

    // Auto-scroll log container
    $effect(() => {
        displayedLogs.length;
        if (logContainer) {
            requestAnimationFrame(() => {
                logContainer.scrollTop = logContainer.scrollHeight;
            });
        }
    });

    // Elapsed timer
    $effect(() => {
        if (isGenerating) {
            elapsedSeconds = 0;
            elapsedInterval = setInterval(() => {
                elapsedSeconds += 1;
            }, 1000);
        } else {
            if (elapsedInterval) clearInterval(elapsedInterval);
        }
        return () => {
            if (elapsedInterval) clearInterval(elapsedInterval);
        };
    });

    // Session ID per generation run
    $effect(() => {
        if (isGenerating && !sessionId) {
            sessionId = Math.random().toString(36).slice(2, 8).toUpperCase();
        }
        if (!isGenerating && !isReady) {
            sessionId = "";
        }
    });

    function formatLogTime(timestamp: number): string {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    }

    function getLogDotClass(type: IndicatorActivityLog["type"]): string {
        if (type === "task_created") return "dot-created";
        if (type === "task_progress") return "dot-progress";
        if (type === "task_stopped") return "dot-stopped";
        return "dot-system";
    }

    function getLogTypeLabel(type: IndicatorActivityLog["type"]): string {
        if (type === "task_created") return "CREATED";
        if (type === "task_progress") return "PROGRESS";
        if (type === "task_stopped") return "STOPPED";
        return "SYSTEM";
    }

    function formatSavedDate(timestamp: string): string {
        return new Date(timestamp).toLocaleDateString([], {
            month: "short",
            day: "numeric",
        });
    }

    function signalBadge(signal?: IndicatorValue["signal"]): string {
        if (signal === "buy") return "BUY";
        if (signal === "sell") return "SELL";
        return "NEUTRAL";
    }

    function applyTemplate(template: string) {
        prompt = template;
    }

    function handleSubmit() {
        if (!prompt.trim() || isGenerating) return;

        loadedModule = null;
        editableCode = "";
        testError = null;
        testResults = null;
        chartOhlcvData = [];
        reviewTab = "preview";
        showFinalSuccess = false;
        sessionId = "";
        indicatorBuilder.generateFromPrompt(prompt);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    }

    function generatePreviewFromPine(pineCode: string): string {
        const lower = pineCode.toLowerCase();

        const helpers = `
function sma(values, period) {
    const result = [];
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += values[j];
        result.push(sum / period);
    }
    return result;
}
function ema(values, period) {
    const result = [];
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        if (prev === null) {
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += values[j];
            prev = sum / period;
        } else {
            prev = values[i] * k + prev * (1 - k);
        }
        result.push(prev);
    }
    return result;
}
function stdev(values, period) {
    const result = [];
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += values[j];
        const mean = sum / period;
        let sqSum = 0;
        for (let j = i - period + 1; j <= i; j++) sqSum += (values[j] - mean) ** 2;
        result.push(Math.sqrt(sqSum / period));
    }
    return result;
}
function trueRange(data) {
    return data.map((d, i) => {
        if (i === 0) return d.high - d.low;
        const prev = data[i - 1].close;
        return Math.max(d.high - d.low, Math.abs(d.high - prev), Math.abs(d.low - prev));
    });
}
`;

        const periodMatches = pineCode.match(/input(?:\.int)?\s*\(\s*(\d+)/g);
        const periods = periodMatches
            ? periodMatches.map((m: string) => parseInt(m.match(/(\d+)/)![1]))
            : [];

        if (
            lower.includes("ta.rsi") ||
            lower.includes("rsi(") ||
            (lower.includes("rsi") && lower.includes("indicator"))
        ) {
            const period = periods[0] || 14;
            return `${helpers}
function calculate(data, params) {
    const period = params.period || ${period};
    const closes = data.map(d => d.close);
    const results = [];
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        if (i <= period) {
            avgGain += gain / period;
            avgLoss += loss / period;
            if (i < period) { results.push({ timestamp: data[i].timestamp, values: { rsi: null } }); continue; }
        } else {
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
        }
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - 100 / (1 + rs);
        let signal = 'neutral';
        if (rsi > 70) signal = 'sell';
        else if (rsi < 30) signal = 'buy';
        results.push({ timestamp: data[i].timestamp, values: { rsi, overbought: 70, oversold: 30 }, signal });
    }
    return results;
}`;
        }

        if (lower.includes("ta.macd") || lower.includes("macd")) {
            const fast = periods[0] || 12;
            const slow = periods[1] || 26;
            const sig = periods[2] || 9;
            return `${helpers}
function calculate(data, params) {
    const closes = data.map(d => d.close);
    const fastEma = ema(closes, ${fast});
    const slowEma = ema(closes, ${slow});
    const macdLine = fastEma.map((f, i) => (f !== null && slowEma[i] !== null) ? f - slowEma[i] : null);
    const macdValues = macdLine.filter(v => v !== null);
    const signalEma = ema(macdValues, ${sig});
    const results = [];
    let si = 0;
    for (let i = 0; i < data.length; i++) {
        const m = macdLine[i];
        let s = null, h = null, signal = 'neutral';
        if (m !== null && si < signalEma.length) {
            s = signalEma[si] ?? null;
            h = s !== null ? m - s : null;
            if (h !== null && h > 0) signal = 'buy';
            else if (h !== null && h < 0) signal = 'sell';
            si++;
        }
        results.push({ timestamp: data[i].timestamp, values: { macd: m, signal_line: s, histogram: h }, signal });
    }
    return results;
}`;
        }

        if (
            lower.includes("ta.bb") ||
            lower.includes("bollinger") ||
            (lower.includes("bb") && lower.includes("basis"))
        ) {
            const period = periods[0] || 20;
            const mult = 2;
            return `${helpers}
function calculate(data, params) {
    const period = params.period || ${period};
    const mult = params.mult || ${mult};
    const closes = data.map(d => d.close);
    const basis = sma(closes, period);
    const sd = stdev(closes, period);
    return data.map((d, i) => ({
        timestamp: d.timestamp,
        values: {
            basis: basis[i],
            upper: basis[i] !== null ? basis[i] + mult * sd[i] : null,
            lower: basis[i] !== null ? basis[i] - mult * sd[i] : null,
            close: d.close
        },
        signal: basis[i] !== null && d.close < basis[i] - mult * sd[i] ? 'buy' : basis[i] !== null && d.close > basis[i] + mult * sd[i] ? 'sell' : 'neutral'
    }));
}`;
        }

        if (
            lower.includes("ta.stoch") ||
            lower.includes("stochastic") ||
            (lower.includes("%k") && lower.includes("%d"))
        ) {
            const kPeriod = periods[0] || 14;
            const dPeriod = periods[1] || 3;
            return `${helpers}
function calculate(data, params) {
    const kPeriod = params.kPeriod || ${kPeriod};
    const dPeriod = params.dPeriod || ${dPeriod};
    const kValues = [];
    for (let i = 0; i < data.length; i++) {
        if (i < kPeriod - 1) { kValues.push(null); continue; }
        let hh = -Infinity, ll = Infinity;
        for (let j = i - kPeriod + 1; j <= i; j++) { hh = Math.max(hh, data[j].high); ll = Math.min(ll, data[j].low); }
        kValues.push(hh === ll ? 50 : ((data[i].close - ll) / (hh - ll)) * 100);
    }
    const dValues = sma(kValues.map(v => v ?? 0), dPeriod);
    return data.map((d, i) => ({
        timestamp: d.timestamp,
        values: { k: kValues[i], d: dValues[i], overbought: 80, oversold: 20 },
        signal: kValues[i] !== null && kValues[i] > 80 ? 'sell' : kValues[i] !== null && kValues[i] < 20 ? 'buy' : 'neutral'
    }));
}`;
        }

        if (
            lower.includes("ta.atr") ||
            lower.includes("atr(") ||
            lower.includes("average true range")
        ) {
            const period = periods[0] || 14;
            return `${helpers}
function calculate(data, params) {
    const period = params.period || ${period};
    const tr = trueRange(data);
    const atrValues = sma(tr, period);
    return data.map((d, i) => ({
        timestamp: d.timestamp,
        values: { atr: atrValues[i] },
        signal: 'neutral'
    }));
}`;
        }

        if (
            lower.includes("ta.crossover") ||
            lower.includes("ta.crossunder") ||
            lower.includes("crossover") ||
            lower.includes("cross(")
        ) {
            const fast = periods[0] || 9;
            const slow = periods[1] || 21;
            const usesEma = lower.includes("ta.ema") || lower.includes("ema(");
            const fn = usesEma ? "ema" : "sma";
            return `${helpers}
function calculate(data, params) {
    const closes = data.map(d => d.close);
    const fastLine = ${fn}(closes, ${fast});
    const slowLine = ${fn}(closes, ${slow});
    return data.map((d, i) => {
        let signal = 'neutral';
        if (i > 0 && fastLine[i] !== null && slowLine[i] !== null && fastLine[i - 1] !== null && slowLine[i - 1] !== null) {
            if (fastLine[i] > slowLine[i] && fastLine[i - 1] <= slowLine[i - 1]) signal = 'buy';
            if (fastLine[i] < slowLine[i] && fastLine[i - 1] >= slowLine[i - 1]) signal = 'sell';
        }
        return { timestamp: d.timestamp, values: { fast_ma: fastLine[i], slow_ma: slowLine[i] }, signal };
    });
}`;
        }

        if (lower.includes("ta.vwap") || lower.includes("vwap")) {
            return `${helpers}
function calculate(data, params) {
    let cumVol = 0, cumTP = 0;
    return data.map((d) => {
        const tp = (d.high + d.low + d.close) / 3;
        cumVol += d.volume;
        cumTP += tp * d.volume;
        const vwap = cumVol > 0 ? cumTP / cumVol : tp;
        return {
            timestamp: d.timestamp,
            values: { vwap, close: d.close },
            signal: d.close > vwap ? 'buy' : d.close < vwap ? 'sell' : 'neutral'
        };
    });
}`;
        }

        if (
            lower.includes("ta.sma") ||
            lower.includes("ta.ema") ||
            lower.includes("sma(") ||
            lower.includes("ema(")
        ) {
            const period = periods[0] || 20;
            const usesEma = lower.includes("ta.ema") || lower.includes("ema(");
            const fn = usesEma ? "ema" : "sma";
            const label = usesEma ? "ema" : "sma";
            return `${helpers}
function calculate(data, params) {
    const period = params.period || ${period};
    const closes = data.map(d => d.close);
    const maValues = ${fn}(closes, period);
    return data.map((d, i) => ({
        timestamp: d.timestamp,
        values: { ${label}: maValues[i], close: d.close },
        signal: maValues[i] !== null && d.close > maValues[i] ? 'buy' : maValues[i] !== null && d.close < maValues[i] ? 'sell' : 'neutral'
    }));
}`;
        }

        return `${helpers}
function calculate(data, params) {
    const period = params.period || 20;
    const closes = data.map(d => d.close);
    const maValues = sma(closes, period);
    return data.map((d, i) => ({
        timestamp: d.timestamp,
        values: { indicator: maValues[i], close: d.close },
        signal: 'neutral'
    }));
}`;
    }

    async function loadPreviewModule(jsCode: string) {
        try {
            const cleanCode = normalizePreviewJs(jsCode);

            const calculateFn = new Function(
                "data",
                "params",
                `
                const module = { exports: {} };
                const exports = module.exports;
                ${cleanCode}

                const resolvedCalculate =
                    typeof calculate === "function"
                        ? calculate
                        : typeof module.exports === "function"
                          ? module.exports
                          : typeof module.exports?.calculate === "function"
                            ? module.exports.calculate
                            : typeof exports?.calculate === "function"
                              ? exports.calculate
                              : null;

                if (typeof resolvedCalculate !== "function") {
                    throw new Error("Function 'calculate' not found in preview code");
                }

                const output = resolvedCalculate(data, params);
                if (!Array.isArray(output)) {
                    throw new Error("Preview calculate() must return an array");
                }
                return output;
            `,
            );

            return calculateFn;
        } catch (e) {
            console.error("Failed to load preview module", e);
            testError = "Preview generation failed: " + (e as Error).message;
            return null;
        }
    }

    function normalizePreviewJs(rawCode: string): string {
        return rawCode
            .replace(/^```[a-zA-Z]*\s*\r?\n/, "")
            .replace(/\r?\n```[\t ]*$/, "")
            .replace(/^import\s+.*;?\s*$/gm, "")
            .replace(
                /^\s*export\s+default\s+function\s*\(/gm,
                "const calculate = function(",
            )
            .replace(/^\s*export\s+default\s+/gm, "const calculate = ")
            .replace(
                /^\s*export\s+(?=(async\s+)?function|const|let|var)\s*/gm,
                "",
            )
            .replace(
                /^\s*module\.exports\s*=\s*function\s*\(/gm,
                "const calculate = function(",
            )
            .replace(/^\s*module\.exports\s*=\s*calculate\s*;?\s*$/gm, "")
            .replace(/^\s*exports\.calculate\s*=\s*calculate\s*;?\s*$/gm, "")
            .trim();
    }

    async function tryLoadAndTest() {
        const pineCode = editableCode || progress.generatedCode;
        if (!pineCode) return;

        testError = null;
        testResults = null;

        if (progress.generatedConfig) {
            loadedModule = {
                indicatorConfig: progress.generatedConfig,
                calculate: () => [],
            };
        } else {
            loadedModule = {
                indicatorConfig: {
                    name: "PineScript Indicator",
                    description: "Custom PineScript",
                    overlayType: "separate",
                    params: {},
                },
                calculate: () => [],
            };
        }

        let previewCode = progress.generatedPreviewCode;

        if (!previewCode && pineCode) {
            previewCode = generatePreviewFromPine(pineCode);
        }

        if (previewCode) {
            try {
                const calculateFn = await loadPreviewModule(previewCode);
                if (calculateFn) {
                    loadedModule.calculate = calculateFn as any;

                    let price = 100;
                    const dummyData: OHLCV[] = Array.from(
                        { length: 200 },
                        (_, i) => {
                            const change = (Math.random() - 0.48) * 3;
                            const open = price;
                            price += change;
                            const close = price;
                            const high =
                                Math.max(open, close) + Math.random() * 2;
                            const low =
                                Math.min(open, close) - Math.random() * 2;
                            return {
                                timestamp: Date.now() - (200 - i) * 60000,
                                open,
                                high,
                                low,
                                close,
                                volume: 800 + Math.random() * 1200,
                            };
                        },
                    );

                    chartOhlcvData = dummyData;

                    const results = loadedModule.calculate(
                        dummyData,
                        userParams,
                    );
                    testResults = results;
                    reviewTab = "preview";
                }
            } catch (e) {
                testError = "Preview execution failed: " + (e as Error).message;
            }
        } else {
            testError =
                "Could not generate preview. Please check the PineScript code.";
        }
    }

    async function handleSave() {
        const code = editableCode || progress.generatedCode;
        if (!code || !loadedModule || saving) return;

        saving = true;
        saveSuccess = false;
        try {
            await indicatorBuilder.saveIndicator(
                loadedModule.indicatorConfig.name,
                prompt,
                code,
                loadedModule.indicatorConfig,
                `gpt-${Date.now()}`,
            );
            saveSuccess = true;
            await indicatorBuilder.loadIndicators();
            setTimeout(() => (saveSuccess = false), 3000);
        } catch (err) {
            console.error("Save failed:", err);
            testError = "Failed to save indicator: " + (err as Error).message;
        } finally {
            saving = false;
        }
    }

    function handleCopyCode() {
        const code = editableCode || progress.generatedCode;
        if (!code) return;
        navigator.clipboard.writeText(code);
        copied = true;
        setTimeout(() => (copied = false), 2000);
    }

    function handleOpenTradingView() {
        handleCopyCode();
        window.open("https://www.tradingview.com/chart/", "_blank");
    }

    function handleReset() {
        indicatorBuilder.reset();
        indicatorBuilder.setActiveIndicator(null);
        prompt = "";
        loadedModule = null;
        editableCode = "";
        testResults = null;
        testError = null;
        chartOhlcvData = [];
        reviewTab = "preview";
        showFinalSuccess = false;
        sessionId = "";
    }

    function loadSavedIndicator(indicator: CustomIndicator) {
        indicatorBuilder.setActiveIndicator(indicator);
        prompt = indicator.description || indicator.name;
        editableCode = indicator.code;
        reviewTab = "preview";
        testError = null;
        indicatorBuilder.progress = {
            status: "ready",
            generatedCode: indicator.code,
            generatedConfig: indicator.config,
        };
        tryLoadAndTest();
    }

    async function deleteSavedIndicator(id: string) {
        if (!confirm("Delete this indicator?")) return;
        await indicatorBuilder.deleteIndicator(id);
    }

    $effect(() => {
        if (progress.generatedCode && !editableCode) {
            editableCode = progress.generatedCode;
        }
    });

    $effect(() => {
        if (isReady && progress.generatedCode && !loadedModule) {
            tryLoadAndTest();
        }
    });
</script>

<svelte:head>
    <title>Indicators — BigLot.ai</title>
</svelte:head>

{#if indicatorBuilder.dbError === "missing_table"}
    <div class="db-overlay">
        <div class="db-card">
            <div class="db-card-head">
                <div class="db-icon"><AlertTriangle size={22} /></div>
                <div>
                    <h2>Database Setup Required</h2>
                    <p>The <code>custom_indicators</code> table is missing in Supabase.</p>
                </div>
            </div>
            <p style="font-size:0.825rem;color:rgba(255,255,255,0.4);">Run this SQL in Supabase SQL Editor before using the builder.</p>
            <div class="db-sql-wrap">
                <pre class="db-sql"><code>CREATE TABLE custom_indicators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  code TEXT NOT NULL,
  config JSONB NOT NULL,
  generation_id TEXT,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE custom_indicators DISABLE ROW LEVEL SECURITY;</code></pre>
                <button
                    class="db-copy-btn icon-btn"
                    onclick={() => {
                        navigator.clipboard.writeText(
                            `CREATE TABLE custom_indicators (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  name TEXT NOT NULL,\n  description TEXT,\n  code TEXT NOT NULL,\n  config JSONB NOT NULL,\n  generation_id TEXT,\n  version INTEGER DEFAULT 1,\n  is_active BOOLEAN DEFAULT false,\n  created_at TIMESTAMPTZ DEFAULT now(),\n  updated_at TIMESTAMPTZ DEFAULT now()\n);\n\nALTER TABLE custom_indicators DISABLE ROW LEVEL SECURITY;`
                        );
                        sqlCopied = true;
                        setTimeout(() => (sqlCopied = false), 2000);
                    }}
                >
                    {#if sqlCopied}<Check size={12} />{:else}<Copy size={12} />{/if}
                </button>
            </div>
            <div>
                <button
                    class="btn-primary"
                    onclick={() => window.open("https://supabase.com/dashboard/project/_/sql", "_blank")}
                >
                    <ExternalLink size={13} />
                    Open Supabase SQL Editor
                </button>
            </div>
        </div>
    </div>
{/if}

<div class="min-h-full overflow-y-auto bg-background text-foreground" style="-webkit-font-smoothing:antialiased;font-family:var(--font-sans);">

    <!-- Sticky header -->
    <header class="sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-background/80 backdrop-blur-sm px-6 py-3">
        <div class="flex items-center gap-3 min-w-0">
            <span class="text-sm font-mono text-white/30">/indicators</span>
            {#if isReady && activeConfig}
                <span class="text-white/15 text-sm select-none">·</span>
                <span class="text-sm text-white/50 truncate">{activeConfig.name}</span>
            {/if}
        </div>
        <div class="flex items-center gap-2">
            {#if hasActivity}
                <button class="btn-ghost" onclick={handleReset}>
                    <RefreshCw size={13} />
                    Reset
                </button>
            {/if}
            <button
                class="btn-primary"
                onclick={handleSubmit}
                disabled={!prompt.trim() || isGenerating}
            >
                {#if isGenerating}
                    <Loader2 size={13} class="spin" />
                    Generating
                {:else if isReady}
                    <Zap size={13} />
                    Regenerate
                {:else}
                    <Zap size={13} />
                    Generate
                {/if}
            </button>
        </div>
    </header>

    <div class="max-w-6xl mx-auto px-6 py-6 flex flex-col gap-6">

        <!-- 1. Prompt -->
        <section class="flex flex-col gap-3">
            <textarea
                bind:value={prompt}
                onkeydown={handleKeydown}
                disabled={isGenerating}
                rows="5"
                placeholder="e.g. RSI divergence with 70/30 zones, trend filter, and alert markers on a 4H chart."
                class="prompt-textarea"
            ></textarea>

            {#if displayedLogs.length > 0 || isGenerating}
                <div class="agent-panel" class:panel-active={isGenerating}>

                    <!-- Header -->
                    <div class="agent-header">
                        <div class="agent-header-left">
                            <div class="agent-avatar-wrap">
                                <div class="agent-avatar">
                                    <Bot size={14} />
                                </div>
                                <div class="agent-status-dot" class:agent-online={isGenerating} class:agent-offline={!isGenerating && isReady} class:agent-idle={!isGenerating && !isReady}></div>
                            </div>
                            <div class="agent-info">
                                <div class="agent-name">
                                    <span>BigLot.ai</span>
                                    <span class="agent-badge">AGENT</span>
                                </div>
                                <div class="agent-status-text">
                                    {#if isGenerating || (isReady && !showFinalSuccess)}
                                        <span class="status-working"><Activity size={10} /> Working</span>
                                    {:else if isReady && showFinalSuccess}
                                        <span class="status-completed"><Check size={10} /> Completed</span>
                                    {:else}
                                        <span class="status-idle">Idle</span>
                                    {/if}
                                </div>
                            </div>
                        </div>
                        <div class="agent-header-right">
                            {#if isGenerating}
                                <div class="agent-elapsed">
                                    <Clock size={10} />
                                    <span class="elapsed-value">{elapsedDisplay}</span>
                                </div>
                            {/if}
                            <div class="agent-secure-pill">
                                <Shield size={10} />
                                <span>Secure</span>
                            </div>
                        </div>
                    </div>

                    <!-- Current Step -->
                    {#if isGenerating && progress.currentStep}
                        <div class="agent-step">
                            <div class="step-icon">
                                <Cpu size={13} class="spin-slow" />
                            </div>
                            <div class="step-content">
                                <span class="step-label">Current Task</span>
                                <span class="step-text">{progress.currentStep}</span>
                            </div>
                            <ChevronRight size={12} class="step-chevron" />
                        </div>
                    {/if}

                    <!-- Activity Log -->
                    <div class="agent-log" bind:this={logContainer}>
                        {#if displayedLogs.length}
                            <div class="agent-timeline">
                                {#each displayedLogs as entry, i (entry.id)}
                                    <div class="log-entry" class:entry-latest={i === displayedLogs.length - 1 && isGenerating}>
                                        <div class="timeline-track">
                                            <div class="timeline-dot {getLogDotClass(entry.type)}"
                                                 class:dot-active={(isGenerating || !showFinalSuccess) && i === displayedLogs.length - 1}></div>
                                            {#if i < displayedLogs.length - 1 || isGenerating || showFinalSuccess}
                                                <div class="timeline-line" class:line-done={i < displayedLogs.length - 1}></div>
                                            {/if}
                                        </div>
                                        <div class="log-content">
                                            <div class="log-message">{entry.message}</div>
                                            <div class="log-meta">
                                                <span class="log-type-badge type-{entry.type}">{getLogTypeLabel(entry.type)}</span>
                                                <span class="log-time">{formatLogTime(entry.receivedAt)}</span>
                                            </div>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {:else}
                            <div class="log-empty">
                                <Terminal size={14} />
                                <span>Awaiting agent activity...</span>
                            </div>
                        {/if}

                        {#if isGenerating || (isReady && !showFinalSuccess)}
                            <div class="typing-dots">
                                <div class="typing-dot"></div>
                                <div class="typing-dot" style="animation-delay:0.15s"></div>
                                <div class="typing-dot" style="animation-delay:0.3s"></div>
                            </div>
                        {/if}

                        {#if isReady && showFinalSuccess}
                            <div class="success-entry">
                                <div class="success-icon">
                                    <Check size={14} />
                                </div>
                                <div class="success-content">
                                    <div class="success-text">Code generated successfully</div>
                                    <div class="success-sub">Ready to test and deploy</div>
                                </div>
                            </div>
                        {/if}
                    </div>

                    <!-- Footer -->
                    <div class="agent-footer">
                        <div class="footer-left">
                            <Fingerprint size={10} />
                            <span>{sessionId || '---'}</span>
                        </div>
                        <span class="footer-brand">Powered by BigLot.ai</span>
                    </div>
                </div>
            {/if}

            {#if progress.status === 'error'}
                <div class="flex items-start gap-2 text-sm text-red-400 bg-red-400/5 border border-red-400/10 rounded-lg px-4 py-3">
                    <AlertTriangle size={13} class="mt-0.5 shrink-0" />
                    <span>{progress.error}</span>
                </div>
            {/if}

            <!-- Template chips -->
            <div class="flex flex-wrap gap-1.5">
                {#each TEMPLATE_GROUPS as group}
                    {#each group.items as item}
                        <button class="template-chip" onclick={() => applyTemplate(item)}>{item}</button>
                    {/each}
                {/each}
            </div>
        </section>

        <!-- 2. Result split -->
        {#if isReady && activeCode}
            <section class="result-split">

                <!-- Left: PineScript code (always visible) -->
                <div class="code-pane">
                    <div class="pane-header">
                        <div class="flex items-center gap-2">
                            <Code2 size={13} class="text-white/30" />
                            <span class="font-mono text-xs text-white/40">PineScript</span>
                            <span class="text-xs text-white/20">{codeLineCount} lines</span>
                        </div>
                        <button class="icon-btn" onclick={handleCopyCode} title="Copy code">
                            {#if copied}
                                <Check size={12} class="text-green-400" />
                            {:else}
                                <Copy size={12} />
                            {/if}
                        </button>
                    </div>
                    <pre class="code-body"><code>{activeCode}</code></pre>
                </div>

                <!-- Right: Preview / Data / Config tabs -->
                <div class="preview-pane">
                    <div class="pane-header">
                        <div class="flex items-center">
                            <button
                                class="tab-btn"
                                class:tab-active={reviewTab === 'preview'}
                                onclick={() => (reviewTab = 'preview')}
                            >
                                <BarChart3 size={12} />
                                Preview
                            </button>
                            <button
                                class="tab-btn"
                                class:tab-active={reviewTab === 'data'}
                                onclick={() => (reviewTab = 'data')}
                            >
                                <Table2 size={12} />
                                Data
                            </button>
                            {#if activeConfig}
                                <button
                                    class="tab-btn"
                                    class:tab-active={reviewTab === 'config'}
                                    onclick={() => (reviewTab = 'config')}
                                >
                                    <Settings2 size={12} />
                                    Config
                                </button>
                            {/if}
                        </div>
                        {#if testError}
                            <span class="text-xs text-red-400 flex items-center gap-1">
                                <AlertTriangle size={11} />
                                Preview error
                            </span>
                        {/if}
                    </div>

                    <div class="pane-body">
                        {#if reviewTab === 'preview'}
                            {#if testResults && testResults.length > 0}
                                <IndicatorChart
                                    ohlcvData={chartOhlcvData}
                                    indicatorResults={testResults}
                                    overlayType={activeConfig?.overlayType || 'separate'}
                                    indicatorName={activeConfig?.name || 'Indicator'}
                                    height={460}
                                />
                            {:else}
                                <div class="pane-empty">
                                    <p class="text-sm text-white/30 mb-3">Preview not run yet.</p>
                                    <button class="btn-ghost" onclick={tryLoadAndTest}>
                                        <Play size={13} />
                                        Run Preview
                                    </button>
                                </div>
                            {/if}

                        {:else if reviewTab === 'data'}
                            {#if testResults && testResults.length > 0}
                                <div class="data-scroll">
                                    <table class="data-table">
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Signal</th>
                                                {#each Object.keys(testResults[0]?.values || {}) as key}
                                                    <th>{key}</th>
                                                {/each}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each testResults.slice(-20) as row, i}
                                                <tr>
                                                    <td>{Math.max(0, (testResults?.length ?? 0) - 20) + i + 1}</td>
                                                    <td class="signal-cell signal-{row.signal || 'neutral'}">{signalBadge(row.signal)}</td>
                                                    {#each Object.values(row.values) as val}
                                                        <td>{typeof val === 'number' ? val.toFixed(4) : (val ?? '—')}</td>
                                                    {/each}
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            {:else}
                                <div class="pane-empty">
                                    <p class="text-sm text-white/30">No data yet. Run a preview first.</p>
                                </div>
                            {/if}

                        {:else if reviewTab === 'config' && activeConfig}
                            <div class="config-scroll">
                                <div class="config-meta">
                                    <div class="config-row">
                                        <span>Name</span>
                                        <strong>{activeConfig.name}</strong>
                                    </div>
                                    <div class="config-row">
                                        <span>Overlay</span>
                                        <strong>{activeConfig.overlayType}</strong>
                                    </div>
                                    {#if activeConfig.description}
                                        <div class="config-row">
                                            <span>Description</span>
                                            <strong>{activeConfig.description}</strong>
                                        </div>
                                    {/if}
                                </div>
                                {#if configEntries.length > 0}
                                    <div class="config-params">
                                        {#each configEntries as [key, param]}
                                            <div class="config-param-row">
                                                <span class="param-key">{param.label || key}</span>
                                                <span class="param-val">default {param.default}</span>
                                                <span class="param-range">{param.min ?? '—'} – {param.max ?? '—'}</span>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>

            </section>

            <!-- Action bar -->
            <div class="flex items-center gap-2 flex-wrap">
                <button class="btn-ghost" onclick={tryLoadAndTest}>
                    <Play size={13} />
                    Test Run
                </button>
                <button class="btn-ghost" onclick={handleCopyCode} class:btn-success={copied}>
                    {#if copied}<Check size={13} />{:else}<Copy size={13} />{/if}
                    {copied ? 'Copied' : 'Copy Code'}
                </button>
                <button class="btn-ghost" onclick={handleOpenTradingView}>
                    <ExternalLink size={13} />
                    TradingView
                </button>
                <button class="btn-primary" onclick={handleSave} disabled={saving}>
                    {#if saving}
                        <Loader2 size={13} class="spin" />
                        Saving
                    {:else if saveSuccess}
                        <Check size={13} />
                        Saved
                    {:else}
                        <Save size={13} />
                        Save Indicator
                    {/if}
                </button>
            </div>
        {/if}

        <!-- 3. Library -->
        {#if savedIndicators.length > 0}
            <section>
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs uppercase tracking-widest text-white/25">Library</span>
                    <span class="text-xs text-white/25">{savedIndicators.length}</span>
                </div>
                <div class="library-grid">
                    {#each savedIndicators as indicator}
                        <div class="library-card">
                            <div class="min-w-0 flex-1">
                                <div class="text-sm text-white/75 truncate">{indicator.name}</div>
                                <div class="text-xs text-white/25 mt-0.5">{formatSavedDate(indicator.created_at)} · v{indicator.version}</div>
                            </div>
                            <div class="flex items-center gap-1 shrink-0">
                                <button class="icon-btn" title="Load" onclick={() => loadSavedIndicator(indicator)}>
                                    <Play size={12} />
                                </button>
                                <button class="icon-btn icon-btn-danger" title="Delete" onclick={() => deleteSavedIndicator(indicator.id)}>
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>
                    {/each}
                </div>
            </section>
        {/if}

    </div>
</div>

<style>
    /* Spinner */
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Prompt textarea */
    .prompt-textarea {
        width: 100%;
        background: rgba(255, 255, 255, 0.025);
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 0.75rem;
        padding: 0.875rem 1rem;
        font-size: 0.875rem;
        color: #f1f5f9;
        resize: none;
        font-family: var(--font-sans);
        line-height: 1.6;
        transition: border-color 0.15s;
        outline: none;
    }
    .prompt-textarea:focus { border-color: rgba(255, 255, 255, 0.15); }
    .prompt-textarea::placeholder { color: rgba(255, 255, 255, 0.2); }
    .prompt-textarea:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Template chips */
    .template-chip {
        padding: 0.25rem 0.7rem;
        border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.45);
        background: transparent;
        cursor: pointer;
        transition: border-color 0.15s, color 0.15s, background 0.15s;
        white-space: nowrap;
        font-family: var(--font-sans);
        line-height: 1.5;
    }
    .template-chip:hover {
        border-color: rgba(255, 255, 255, 0.18);
        color: rgba(255, 255, 255, 0.8);
        background: rgba(255, 255, 255, 0.03);
    }

    /* Result split */
    .result-split {
        display: grid;
        grid-template-columns: 40% 1fr;
        gap: 0.75rem;
        min-height: 520px;
    }

    .code-pane,
    .preview-pane {
        display: flex;
        flex-direction: column;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 0.875rem;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.012);
    }

    .pane-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.875rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        flex-shrink: 0;
        min-height: 38px;
    }

    .code-body {
        flex: 1;
        overflow: auto;
        padding: 1rem;
        font-size: 0.7rem;
        line-height: 1.65;
        font-family: var(--font-mono, monospace);
        color: rgba(255, 255, 255, 0.65);
        margin: 0;
        white-space: pre;
    }
    .code-body::-webkit-scrollbar { width: 4px; height: 4px; }
    .code-body::-webkit-scrollbar-track { background: transparent; }
    .code-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

    .pane-body {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    /* Tabs */
    .tab-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.4rem 0.75rem;
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.35);
        background: transparent;
        border: none;
        border-bottom: 1.5px solid transparent;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s;
        font-family: var(--font-sans);
        white-space: nowrap;
        margin-bottom: -1px;
    }
    .tab-btn:hover { color: rgba(255, 255, 255, 0.65); }
    .tab-active {
        color: rgba(255, 255, 255, 0.9) !important;
        border-bottom-color: rgba(255, 255, 255, 0.35) !important;
    }

    /* Data table */
    .data-scroll {
        flex: 1;
        overflow: auto;
        padding: 0.5rem;
    }
    .data-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
    .data-scroll::-webkit-scrollbar-track { background: transparent; }
    .data-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

    .data-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.7rem;
        font-family: var(--font-mono, monospace);
    }
    .data-table th {
        padding: 0.35rem 0.6rem;
        text-align: left;
        color: rgba(255, 255, 255, 0.3);
        font-weight: 500;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        white-space: nowrap;
        font-family: var(--font-sans);
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .data-table td {
        padding: 0.3rem 0.6rem;
        color: rgba(255, 255, 255, 0.6);
        border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        white-space: nowrap;
    }
    .signal-cell { font-family: var(--font-sans); font-weight: 600; font-size: 0.65rem; letter-spacing: 0.05em; }
    .signal-buy  { color: #4ade80; }
    .signal-sell { color: #f87171; }
    .signal-neutral { color: rgba(255,255,255,0.3); }

    /* Config */
    .config-scroll {
        flex: 1;
        overflow: auto;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    .config-meta { display: flex; flex-direction: column; gap: 0.5rem; }
    .config-row {
        display: flex;
        align-items: baseline;
        gap: 0.75rem;
        font-size: 0.8rem;
    }
    .config-row span { color: rgba(255,255,255,0.35); min-width: 80px; font-size: 0.72rem; }
    .config-row strong { color: rgba(255,255,255,0.75); font-weight: 500; }
    .config-params { display: flex; flex-direction: column; gap: 0.35rem; }
    .config-param-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.4rem 0.6rem;
        border-radius: 0.375rem;
        background: rgba(255,255,255,0.025);
        font-size: 0.72rem;
    }
    .param-key { color: rgba(255,255,255,0.6); flex: 1; }
    .param-val { color: rgba(255,255,255,0.4); font-family: var(--font-mono, monospace); }
    .param-range { color: rgba(255,255,255,0.25); font-family: var(--font-mono, monospace); font-size: 0.65rem; }

    /* Pane empty state */
    .pane-empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        text-align: center;
    }

    /* Buttons */
    .btn-ghost {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.4rem 0.875rem;
        border-radius: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: transparent;
        color: rgba(255, 255, 255, 0.6);
        font-size: 0.8rem;
        cursor: pointer;
        transition: border-color 0.15s, color 0.15s, background 0.15s;
        font-family: var(--font-sans);
        white-space: nowrap;
    }
    .btn-ghost:hover {
        border-color: rgba(255, 255, 255, 0.16);
        color: rgba(255, 255, 255, 0.9);
        background: rgba(255, 255, 255, 0.03);
    }
    .btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-success {
        border-color: rgba(74, 222, 128, 0.25) !important;
        color: #4ade80 !important;
    }

    .btn-primary {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.4rem 0.875rem;
        border-radius: 0.5rem;
        border: 1px solid rgba(245, 158, 11, 0.3);
        background: rgba(245, 158, 11, 0.1);
        color: #fbbf24;
        font-size: 0.8rem;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        font-family: var(--font-sans);
        white-space: nowrap;
    }
    .btn-primary:hover {
        background: rgba(245, 158, 11, 0.18);
        border-color: rgba(245, 158, 11, 0.5);
    }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

    .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border-radius: 0.375rem;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: transparent;
        color: rgba(255, 255, 255, 0.4);
        cursor: pointer;
        transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .icon-btn:hover {
        border-color: rgba(255, 255, 255, 0.14);
        color: rgba(255, 255, 255, 0.75);
        background: rgba(255, 255, 255, 0.04);
    }
    .icon-btn-danger:hover {
        border-color: rgba(239, 68, 68, 0.2);
        color: #f87171;
        background: rgba(239, 68, 68, 0.05);
    }

    /* Library */
    .library-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.5rem;
    }
    .library-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.6rem 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 0.625rem;
        background: rgba(255, 255, 255, 0.012);
        transition: border-color 0.15s;
    }
    .library-card:hover { border-color: rgba(255, 255, 255, 0.1); }

    /* DB overlay */
    .db-overlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(12px);
        padding: 1.5rem;
    }
    .db-card {
        max-width: 560px;
        width: 100%;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 1rem;
        background: rgba(12, 12, 12, 0.95);
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    .db-card-head {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
    }
    .db-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: 0.625rem;
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.2);
        color: #fbbf24;
        flex-shrink: 0;
    }
    .db-card h2 { font-size: 1rem; font-weight: 600; color: #f1f5f9; margin: 0 0 0.25rem; }
    .db-card > p { font-size: 0.825rem; color: rgba(255,255,255,0.5); margin: 0; }
    .db-sql-wrap {
        position: relative;
        border-radius: 0.5rem;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.06);
        background: rgba(255,255,255,0.02);
    }
    .db-sql {
        padding: 0.875rem 1rem;
        font-family: var(--font-mono, monospace);
        font-size: 0.72rem;
        color: rgba(255,255,255,0.6);
        line-height: 1.6;
        overflow-x: auto;
        margin: 0;
        white-space: pre;
    }
    .db-copy-btn {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
    }

    /* ── Agent Activity Panel ── */
    .agent-panel {
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 0.875rem;
        background: #060606;
        overflow: hidden;
        transition: border-color 0.6s ease, box-shadow 0.6s ease;
    }
    .panel-active {
        border-color: rgba(251, 191, 36, 0.12);
        box-shadow:
            0 0 0 1px rgba(251, 191, 36, 0.05),
            0 4px 24px -4px rgba(0, 0, 0, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }

    /* Header */
    .agent-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.875rem 1.125rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        background: linear-gradient(180deg, rgba(251, 191, 36, 0.03) 0%, transparent 100%);
    }
    .agent-header-left { display: flex; align-items: center; gap: 0.75rem; }
    .agent-header-right { display: flex; align-items: center; gap: 0.75rem; }

    /* Avatar */
    .agent-avatar-wrap { position: relative; flex-shrink: 0; }
    .agent-avatar {
        width: 2.125rem;
        height: 2.125rem;
        border-radius: 50%;
        background: linear-gradient(135deg, #b45309, #fbbf24);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.2), 0 2px 8px -2px rgba(251, 191, 36, 0.3);
    }
    .panel-active .agent-avatar { animation: avatar-breathe 3s ease-in-out infinite; }
    @keyframes avatar-breathe {
        0%, 100% { box-shadow: 0 0 0 1px rgba(251,191,36,0.25), 0 0 12px -2px rgba(251,191,36,0.15); }
        50%      { box-shadow: 0 0 0 1px rgba(251,191,36,0.3),  0 0 18px -2px rgba(251,191,36,0.25); }
    }

    /* Status dot */
    .agent-status-dot {
        position: absolute;
        bottom: -1px;
        right: -1px;
        width: 0.625rem;
        height: 0.625rem;
        border-radius: 50%;
        border: 2px solid #060606;
        transition: background 0.3s ease;
    }
    .agent-online {
        background: #fbbf24;
        box-shadow: 0 0 6px rgba(251, 191, 36, 0.4);
        animation: status-pulse 2s ease-in-out infinite;
    }
    .agent-offline { background: #fbbf24; opacity: 0.5; }
    .agent-idle { background: rgba(255, 255, 255, 0.2); }
    @keyframes status-pulse {
        0%, 100% { box-shadow: 0 0 4px rgba(251,191,36,0.3); }
        50%      { box-shadow: 0 0 8px rgba(251,191,36,0.5); }
    }

    /* Name & badge */
    .agent-info { flex: 1; min-width: 0; }
    .agent-name {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.88);
        letter-spacing: -0.01em;
    }
    .agent-badge {
        font-size: 0.55rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        color: rgba(251, 191, 36, 0.7);
        border: 1px solid rgba(251, 191, 36, 0.2);
        border-radius: 4px;
        padding: 0.1rem 0.35rem;
        text-transform: uppercase;
        line-height: 1;
    }

    /* Status text */
    .agent-status-text {
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.35);
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.125rem;
    }
    .status-working {
        color: #fbbf24;
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
    }
    .status-working :global(svg) { animation: activity-pulse 1.2s ease-in-out infinite; }
    @keyframes activity-pulse {
        0%, 100% { opacity: 0.5; }
        50%      { opacity: 1; }
    }
    .status-completed {
        color: #fbbf24;
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
    }
    .status-idle { color: rgba(255, 255, 255, 0.3); }

    /* Header right */
    .agent-elapsed {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.4);
        font-family: var(--font-mono, monospace);
        font-variant-numeric: tabular-nums;
    }
    .agent-elapsed :global(svg) { color: rgba(255, 255, 255, 0.3); }
    .elapsed-value { min-width: 2rem; text-align: right; }
    .agent-secure-pill {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.25);
        letter-spacing: 0.03em;
        padding: 0.15rem 0.5rem 0.15rem 0.35rem;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.04);
    }
    .agent-secure-pill :global(svg) { color: rgba(251, 191, 36, 0.5); }

    /* ── Current Step ── */
    .agent-step {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1.125rem;
        background: rgba(251, 191, 36, 0.02);
        border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }
    .step-icon {
        width: 1.5rem;
        height: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background: rgba(251, 191, 36, 0.08);
        border: 1px solid rgba(251, 191, 36, 0.12);
        flex-shrink: 0;
    }
    .step-icon :global(svg) { color: #fbbf24; }
    .spin-slow { animation: spin 2s linear infinite; }
    .step-content {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
    }
    .step-label {
        font-size: 0.58rem;
        font-weight: 500;
        color: rgba(251, 191, 36, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .step-text {
        font-size: 0.78rem;
        color: rgba(255, 255, 255, 0.7);
        line-height: 1.3;
    }
    .step-chevron {
        color: rgba(255, 255, 255, 0.12);
        flex-shrink: 0;
        animation: chevron-pulse 2s ease-in-out infinite;
    }
    @keyframes chevron-pulse {
        0%, 100% { opacity: 0.3; transform: translateX(0); }
        50%      { opacity: 0.6; transform: translateX(2px); }
    }

    /* ── Activity Log ── */
    .agent-log {
        padding: 0.875rem 1.125rem;
        display: flex;
        flex-direction: column;
        gap: 0;
        max-height: 280px;
        overflow-y: auto;
        scroll-behavior: smooth;
    }
    .agent-log::-webkit-scrollbar { width: 3px; }
    .agent-log::-webkit-scrollbar-track { background: transparent; }
    .agent-log::-webkit-scrollbar-thumb { background: rgba(251, 191, 36, 0.12); border-radius: 2px; }

    .agent-timeline { display: flex; flex-direction: column; }

    .log-entry {
        display: flex;
        align-items: stretch;
        gap: 0.75rem;
        animation: entry-appear 0.4s ease-out both;
    }
    @keyframes entry-appear {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    /* Timeline */
    .timeline-track {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 0.5rem;
        flex-shrink: 0;
        padding-top: 0.375rem;
    }
    .timeline-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
        z-index: 1;
        transition: box-shadow 0.3s ease;
    }
    .timeline-line {
        width: 1px;
        flex: 1;
        min-height: 0.75rem;
        background: rgba(251, 191, 36, 0.06);
        transition: background 0.3s ease;
    }
    .line-done { background: rgba(251, 191, 36, 0.12); }

    /* Dot colors — all gold shades */
    .dot-created  { background: #fbbf24; box-shadow: 0 0 4px rgba(251,191,36,0.2); }
    .dot-progress { background: #f59e0b; }
    .dot-stopped  { background: #d97706; }
    .dot-system   { background: rgba(255, 255, 255, 0.2); }
    .dot-active {
        box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.15), 0 0 8px rgba(251, 191, 36, 0.1);
        animation: dot-ring 1.5s ease-in-out infinite;
    }
    @keyframes dot-ring {
        0%, 100% { box-shadow: 0 0 0 2px rgba(251,191,36,0.12), 0 0 6px rgba(251,191,36,0.08); }
        50%      { box-shadow: 0 0 0 4px rgba(251,191,36,0.2),  0 0 10px rgba(251,191,36,0.15); }
    }

    /* Log content */
    .log-content { min-width: 0; flex: 1; padding-bottom: 0.75rem; }
    .log-message {
        font-size: 0.74rem;
        color: rgba(255, 255, 255, 0.6);
        line-height: 1.5;
        word-break: break-word;
    }
    .entry-latest .log-message { color: rgba(255, 255, 255, 0.75); }
    .log-meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.25rem;
    }

    /* Type badges */
    .log-type-badge {
        font-size: 0.55rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 0.075rem 0.3rem;
        border-radius: 3px;
        line-height: 1.4;
    }
    .type-task_created  { color: rgba(251,191,36,0.8); background: rgba(251,191,36,0.1); }
    .type-task_progress { color: rgba(245,158,11,0.7); background: rgba(245,158,11,0.08); }
    .type-task_stopped  { color: rgba(217,119,6,0.7); background: rgba(217,119,6,0.08); }
    .type-system        { color: rgba(255,255,255,0.35); background: rgba(255,255,255,0.03); }
    .log-time {
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.2);
        font-family: var(--font-mono, monospace);
        font-variant-numeric: tabular-nums;
    }

    /* Empty state */
    .log-empty {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.5rem 0;
        color: rgba(255, 255, 255, 0.2);
        font-size: 0.72rem;
    }
    .log-empty :global(svg) { color: rgba(255, 255, 255, 0.15); }

    /* ── Typing Dots ── */
    .typing-dots {
        display: flex;
        align-items: center;
        gap: 4px;
        padding-left: 1.5rem;
        padding-top: 0.25rem;
        padding-bottom: 0.25rem;
    }
    .typing-dot {
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: rgba(251, 191, 36, 0.35);
        animation: typing-bounce 1.4s ease-in-out infinite;
    }
    @keyframes typing-bounce {
        0%, 80%, 100% { transform: translateY(0); opacity: 0.25; }
        40%            { transform: translateY(-3px); opacity: 0.7; }
    }

    /* ── Success ── */
    .success-entry {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.625rem 0;
        margin-top: 0.25rem;
        animation: success-appear 0.5s ease-out both;
    }
    @keyframes success-appear {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
    }
    .success-icon {
        width: 1.5rem;
        height: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgba(251, 191, 36, 0.1);
        border: 1px solid rgba(251, 191, 36, 0.2);
        box-shadow: 0 0 12px rgba(251, 191, 36, 0.1);
        flex-shrink: 0;
    }
    .success-icon :global(svg) { color: #fbbf24; }
    .success-content { display: flex; flex-direction: column; gap: 0.125rem; }
    .success-text {
        font-size: 0.74rem;
        color: #fbbf24;
        font-weight: 500;
        letter-spacing: -0.01em;
    }
    .success-sub {
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.25);
    }

    /* ── Footer ── */
    .agent-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 1.125rem;
        border-top: 1px solid rgba(255, 255, 255, 0.03);
        background: rgba(255, 255, 255, 0.008);
    }
    .footer-left {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.15);
        font-family: var(--font-mono, monospace);
        letter-spacing: 0.03em;
    }
    .footer-left :global(svg) { color: rgba(255, 255, 255, 0.1); }
    .footer-brand {
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.12);
        letter-spacing: 0.02em;
    }
</style>
