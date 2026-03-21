<script lang="ts">
    import { tick } from "svelte";
    import {
        Bot,
        User,
        Copy,
        Check,
        ThumbsUp,
        ThumbsDown,
        RefreshCcw,
    } from "lucide-svelte";
    import { chatState } from "$lib/state/chat.svelte";
    import Markdown from "./Markdown.svelte";
    import ContentBlockRenderer from "./blocks/ContentBlockRenderer.svelte";
    import ToolProgress from "./blocks/ToolProgress.svelte";
    import SourcesBlock from "./blocks/SourcesBlock.svelte";
    import type { SourcesBlock as SourcesBlockType } from "$lib/types/contentBlock";

    let copiedIndex = $state<number | null>(null);
    const modeLabel: Record<string, string> = {
        coach: "Coach",
        recovery: "Recovery",
        analyst: "Market Analyst",
        pinescript: "PineScript Engineer",
    };

    let scroller: HTMLDivElement | null = $state(null);
    let stickToBottom = $state(true);
    const BOTTOM_THRESHOLD_PX = 96;

    function copyToClipboard(text: string, index: number) {
        navigator.clipboard.writeText(text);
        copiedIndex = index;
        setTimeout(() => {
            if (copiedIndex === index) copiedIndex = null;
        }, 2000);
    }

    function updateStickToBottom() {
        if (!scroller) return;
        const distanceFromBottom =
            scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        stickToBottom = distanceFromBottom < BOTTOM_THRESHOLD_PX;
    }

    async function maybeAutoScroll() {
        if (!scroller) return;
        if (!stickToBottom) return;
        // Wait for DOM to paint the new/updated message before scrolling.
        await tick();
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
    }

    $effect(() => {
        // Track message count, last content, and content blocks so streaming updates
        // keep the view pinned only when the user hasn't scrolled away.
        const n = chatState.messages.length;
        const last = n > 0 ? chatState.messages[n - 1]?.content ?? "" : "";
        const lastBlocks = n > 0 ? chatState.messages[n - 1]?.contentBlocks?.length ?? 0 : 0;
        void last;
        void lastBlocks;
        void maybeAutoScroll();
    });
</script>

<div
    bind:this={scroller}
    onscroll={updateStickToBottom}
    class="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
>
    <div class="max-w-3xl mx-auto space-y-8 pb-32">
        {#if chatState.messages.length === 0}
            <div class="glass-panel p-6 text-center">
                <div class="text-sm font-semibold text-foreground/80">
                    No messages in this chat
                </div>
                {#if chatState.lastDbError}
                    <div class="mt-2 text-xs text-muted-foreground">
                        Database error: {chatState.lastDbError}
                    </div>
                {:else}
                    <div class="mt-2 text-xs text-muted-foreground">
                        If you expected older messages here, your `messages` table may be empty or message inserts failed earlier.
                    </div>
                {/if}
            </div>
        {/if}

        {#each chatState.messages as message, i}
            <div
                class="flex flex-col gap-4 {message.role === 'user'
                    ? 'items-end'
                    : 'items-start'}"
            >
                <div
                    class="flex gap-4 max-w-[85%] {message.role === 'user'
                        ? 'flex-row-reverse'
                        : ''}"
                >
                    <!-- Avatar -->
                    <div
                        class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
            {message.role === 'assistant'
                            ? 'bg-gradient-to-br from-primary to-yellow-600 text-black shadow-lg shadow-primary/20'
                            : 'bg-secondary border border-border text-foreground/80'}"
                    >
                        {#if message.role === "assistant"}
                            <Bot size={18} />
                        {:else}
                            <User size={18} />
                        {/if}
                    </div>

                    <!-- Message Content -->
                    <div class="flex flex-col gap-2 w-full min-w-0">
                        <div
                            class="text-sm font-semibold text-foreground/80 px-1"
                        >
                            {message.role === "assistant" ? "BigLot.ai" : "You"}
                        </div>

                        <div
                            class="text-base text-foreground leading-relaxed flex flex-col gap-3 {message.role ===
                            'user'
                                ? 'w-fit max-w-full rounded-2xl rounded-br-md px-4 py-3 bg-primary/10 border border-primary/20 shadow-lg shadow-primary/5'
                                : ''}"
                        >
                            {#if message.image_url}
                                <div
                                    class="relative max-w-sm rounded-2xl overflow-hidden border border-white/10 group"
                                >
                                    <img
                                        src={message.image_url}
                                        alt="Attached preview"
                                        class="w-full h-auto max-h-[400px] object-cover"
                                        onload={() => {
                                            void maybeAutoScroll();
                                        }}
                                    />
                                </div>
                            {/if}

                            {#if message.role === "assistant"}
                                {@const sourcesBlock = message.contentBlocks?.find((b): b is SourcesBlockType => b.type === 'sources')}
                                {@const otherBlocks = message.contentBlocks?.filter((b) => b.type !== 'sources')}
                                {@const isStreaming = chatState.isLoading && i === chatState.messages.length - 1}
                                {#if otherBlocks?.length}
                                    {#each otherBlocks as block}
                                        <ContentBlockRenderer {block} />
                                    {/each}
                                {/if}
                                {#if message.content}
                                    <div class="inline-sources-row">
                                        <div class="streaming-wrapper" class:is-streaming={isStreaming}>
                                            <Markdown content={message.content} />
                                            {#if isStreaming}
                                                <span class="streaming-cursor"></span>
                                            {/if}
                                        </div>
                                        {#if sourcesBlock}
                                            <SourcesBlock sources={sourcesBlock.sources} />
                                        {/if}
                                    </div>
                                {:else if isStreaming}
                                    <div class="streaming-wrapper is-streaming">
                                        <span class="streaming-cursor"></span>
                                    </div>
                                {:else if sourcesBlock}
                                    <SourcesBlock sources={sourcesBlock.sources} />
                                {/if}
                                {#if message.toolCalls?.length}
                                    <ToolProgress tools={message.toolCalls} />
                                {/if}
                            {:else}
                                {#if message.file_name}
                                    {@const _ext = message.file_name.split('.').pop()?.toLowerCase()}
                                    {@const _icon = _ext === 'pdf' ? '📕' : _ext === 'xlsx' || _ext === 'xls' ? '📊' : _ext === 'docx' ? '📝' : '📄'}
                                    <div class="flex items-center gap-1.5 text-xs text-muted-foreground/70 mb-1.5 px-1">
                                        <span>{_icon}</span>
                                        <span class="truncate max-w-[220px]" title={message.file_name}>{message.file_name}</span>
                                    </div>
                                {/if}
                                <div class="whitespace-pre-wrap break-words">
                                    {message.content}
                                </div>
                            {/if}
                        </div>

                        <!-- Actions -->
                        {#if message.content}
                            <div
                                class="flex items-center gap-2 mt-1 {message.role ===
                                'user'
                                    ? 'justify-end'
                                    : ''}"
                            >
                                <button
                                    onclick={() =>
                                        copyToClipboard(message.content, i)}
                                    class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-md transition-colors"
                                    title="Copy"
                                >
                                    {#if copiedIndex === i}
                                        <Check
                                            size={14}
                                            class="text-green-500"
                                        />
                                    {:else}
                                        <Copy size={14} />
                                    {/if}
                                </button>

                                {#if message.role === "assistant"}
                                    <button
                                        class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-md transition-colors"
                                        title="Regenerate"
                                    >
                                        <RefreshCcw size={14} />
                                    </button>
                                    <div
                                        class="h-3 w-px bg-white/10 mx-1"
                                    ></div>
                                    <button
                                        class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-md transition-colors"
                                        title="Good response"
                                        disabled={!message.id}
                                        onclick={() => {
                                            void chatState.submitFeedback(i, "up");
                                        }}
                                    >
                                        <ThumbsUp
                                            size={14}
                                            class={message.feedback === "up"
                                                ? "text-green-500"
                                                : ""}
                                        />
                                    </button>
                                    <button
                                        class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-md transition-colors"
                                        title="Bad response"
                                        disabled={!message.id}
                                        onclick={() => {
                                            void chatState.submitFeedback(i, "down");
                                        }}
                                    >
                                        <ThumbsDown
                                            size={14}
                                            class={message.feedback === "down"
                                                ? "text-red-500"
                                                : ""}
                                        />
                                    </button>
                                {/if}
                            </div>

                            {#if message.role === "assistant" && message.mode}
                                <div class="text-[11px] text-muted-foreground/70 px-1">
                                    mode: {modeLabel[message.mode] ?? message.mode}
                                </div>
                            {/if}
                        {/if}
                    </div>
                </div>
            </div>
        {/each}
    </div>
</div>

<style>
    /* ── Streaming cursor (ChatGPT-style blinking caret) ── */
    .streaming-wrapper {
        display: inline;
    }

    .streaming-cursor {
        display: inline-block;
        width: 7px;
        height: 1.1em;
        margin-left: 2px;
        background: currentColor;
        opacity: 0.7;
        border-radius: 1px;
        vertical-align: text-bottom;
        animation: blink-cursor 0.6s steps(2) infinite;
    }

    @keyframes blink-cursor {
        0% { opacity: 0.7; }
        50% { opacity: 0; }
        100% { opacity: 0.7; }
    }

    /* Fade-in for new streaming content */
    .streaming-wrapper.is-streaming :global(.markdown-body) {
        animation: fadeInContent 0.15s ease-out;
    }

    @keyframes fadeInContent {
        from { opacity: 0.6; }
        to { opacity: 1; }
    }
</style>
