<script lang="ts">
    import type { ContentBlock } from "$lib/types/contentBlock";
    import TextBlock from "./TextBlock.svelte";
    import MetricCard from "./MetricCard.svelte";
    import TableBlock from "./TableBlock.svelte";
    import ImageBlock from "./ImageBlock.svelte";
    import EmbedBlock from "./EmbedBlock.svelte";
    import NewsList from "./NewsList.svelte";
    import ErrorBlock from "./ErrorBlock.svelte";
    import PlanBlock from "./PlanBlock.svelte";
    import GaugeBlock from "./GaugeBlock.svelte";
    import HeatmapBlock from "./HeatmapBlock.svelte";
    import TradeSetupBlock from "./TradeSetupBlock.svelte";
    import SourcesBlock from "./SourcesBlock.svelte";
    import DiscussionBlock from "./DiscussionBlock.svelte";
    import ResearchReportBlock from "./ResearchReportBlock.svelte";

    let { block }: { block: ContentBlock } = $props();
</script>

{#if block.type === "text"}
    <TextBlock content={block.content} />
{:else if block.type === "metric_card"}
    <MetricCard title={block.title} metrics={block.metrics} />
{:else if block.type === "chart"}
    {#await import("./ChartBlock.svelte") then module}
        {@const ChartBlock = module.default}
        <ChartBlock
            chartType={block.chartType}
            symbol={block.symbol}
            interval={block.interval}
            data={block.data}
            indicators={block.indicators}
        />
    {:catch}
        <ErrorBlock message="Failed to load chart renderer." />
    {/await}
{:else if block.type === "table"}
    <TableBlock title={block.title} headers={block.headers} rows={block.rows} />
{:else if block.type === "image"}
    <ImageBlock url={block.url} alt={block.alt} caption={block.caption} />
{:else if block.type === "embed"}
    <EmbedBlock url={block.url} height={block.height} title={block.title} />
{:else if block.type === "news_list"}
    <NewsList items={block.items} />
{:else if block.type === "error"}
    <ErrorBlock message={block.message} tool={block.tool} />
{:else if block.type === "plan"}
    <PlanBlock plan={block} />
{:else if block.type === "gauge"}
    <GaugeBlock type="gauge" title={block.title} value={block.value} label={block.label} thresholds={block.thresholds} />
{:else if block.type === "heatmap"}
    <HeatmapBlock type="heatmap" title={block.title} assets={block.assets} timeframes={block.timeframes} data={block.data} colorScale={block.colorScale} />
{:else if block.type === "trade_setup"}
    <TradeSetupBlock type="trade_setup" asset={block.asset} direction={block.direction} thesis={block.thesis} entryZone={block.entryZone} stopLoss={block.stopLoss} targets={block.targets} riskRewardRatio={block.riskRewardRatio} maxRiskPct={block.maxRiskPct} invalidation={block.invalidation} timeframe={block.timeframe} />
{:else if block.type === "sources"}
    <SourcesBlock sources={block.sources} />
{:else if block.type === "discussion"}
    <DiscussionBlock discussion={block} />
{:else if block.type === "research_report"}
    <ResearchReportBlock report={block} />
{:else if block.type === "backtest"}
    {#await import("./BacktestBlock.svelte") then module}
        {@const BacktestBlock = module.default}
        <BacktestBlock {...block} />
    {:catch}
        <ErrorBlock message="Failed to load backtest renderer." />
    {/await}
{/if}
