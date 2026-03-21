<script lang="ts">
    import type { PageData } from './$types';
    import { Download, Bot, User, Link } from 'lucide-svelte';
    import { messagesToMarkdown, downloadMarkdown } from '$lib/utils/chatExport';

    const { data }: { data: PageData } = $props();

    let copied = $state(false);

    function exportMarkdown() {
        const md = messagesToMarkdown(data.messages, data.title);
        downloadMarkdown(`biglot-${data.chatId.slice(0, 8)}.md`, md);
    }

    function copyLink() {
        navigator.clipboard.writeText(window.location.href).then(() => {
            copied = true;
            setTimeout(() => { copied = false; }, 2000);
        });
    }

    const formattedDate = $derived(
        data.createdAt
            ? new Date(data.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
            : ''
    );
</script>

<svelte:head>
    <title>{data.title} — BigLot.ai</title>
    <meta name="description" content="Shared chat from BigLot.ai — AI-powered trading assistant" />
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
    <!-- Header -->
    <header class="sticky top-0 z-10 border-b border-white/10 bg-background/80 backdrop-blur-xl">
        <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
            <div>
                <div class="text-xs text-muted-foreground mb-0.5">BigLot.ai · Shared Chat</div>
                <h1 class="text-sm font-semibold text-foreground truncate max-w-xs">{data.title}</h1>
                {#if formattedDate}
                    <div class="text-xs text-muted-foreground/60">{formattedDate}</div>
                {/if}
            </div>
            <div class="flex gap-2">
                <button
                    onclick={copyLink}
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-muted-foreground"
                    title="Copy share link"
                >
                    <Link size={13} />
                    {copied ? 'Copied!' : 'Copy link'}
                </button>
                <button
                    onclick={exportMarkdown}
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-muted-foreground"
                    title="Export as Markdown"
                >
                    <Download size={13} />
                    Export
                </button>
            </div>
        </div>
    </header>

    <!-- Messages -->
    <main class="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {#if data.messages.length === 0}
            <div class="text-center text-muted-foreground text-sm py-16">No messages in this chat.</div>
        {/if}

        {#each data.messages as msg}
            {#if msg.role !== 'system'}
                <div class="flex gap-3 {msg.role === 'user' ? 'flex-row-reverse' : ''}">
                    <!-- Avatar -->
                    <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                        {msg.role === 'assistant'
                            ? 'bg-gradient-to-br from-primary to-yellow-600 text-black'
                            : 'bg-secondary border border-border text-foreground/80'}">
                        {#if msg.role === 'assistant'}
                            <Bot size={16} />
                        {:else}
                            <User size={16} />
                        {/if}
                    </div>

                    <!-- Content -->
                    <div class="flex-1 min-w-0">
                        <div class="text-xs font-semibold text-foreground/60 mb-1 {msg.role === 'user' ? 'text-right' : ''}">
                            {msg.role === 'assistant' ? 'BigLot.ai' : 'You'}
                        </div>
                        <div class="text-sm leading-relaxed whitespace-pre-wrap break-words
                            {msg.role === 'user'
                                ? 'w-fit ml-auto rounded-2xl rounded-br-md px-4 py-3 bg-primary/10 border border-primary/20'
                                : 'text-foreground'}">
                            {msg.content}
                        </div>
                    </div>
                </div>
            {/if}
        {/each}
    </main>

    <!-- Footer -->
    <footer class="text-center text-xs text-muted-foreground/40 py-8">
        Shared via <a href="/" class="underline hover:text-muted-foreground">BigLot.ai</a> — AI-powered trading assistant
    </footer>
</div>
