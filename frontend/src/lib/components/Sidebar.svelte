<script lang="ts">
    import {
        Plus,
        MessageSquare,
        Settings,
        LogOut,
        Trash2,
        PanelLeftClose,
        PanelLeftOpen,
        BarChart3,
        Loader2,
        Link2,
        Unlink2,
        BarChart,
        Search
    } from "lucide-svelte";
    import { chatState } from "$lib/state/chat.svelte";
    import { fade } from "svelte/transition";
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";

    let { isOpen = $bindable(true) } = $props();

    let searchQuery = $state('');

    const filteredChats = $derived(
        searchQuery.trim() === ''
            ? chatState.allChats
            : chatState.allChats.filter(chat =>
                chat.title.toLowerCase().includes(searchQuery.toLowerCase())
              )
    );

    function toggleSidebar() {
        isOpen = !isOpen;
    }

    function handleNewChatClick() {
        void chatState.newChat();
        void goto("/");
    }

    async function handleAddTelegramClick() {
        const tokenData = await chatState.createTelegramLink();
        if (!tokenData) {
            const message = chatState.telegramError ?? "Failed to create Telegram link.";
            alert(message);
            return;
        }

        if (typeof window !== "undefined") {
            window.open(tokenData.deepLink, "_blank", "noopener,noreferrer");
        }
    }

    async function handleUnlinkTelegramClick() {
        const confirmed = confirm("Unlink this Telegram account from BigLot.ai?");
        if (!confirmed) return;

        const ok = await chatState.unlinkTelegram();
        if (!ok) {
            const message =
                chatState.telegramError ?? "Failed to unlink Telegram account.";
            alert(message);
        }
    }

    async function handleChatHistoryClick(chatId: string) {
        try {
            await chatState.loadChat(chatId);
            await goto("/");
        } catch (e: any) {
            const msg =
                typeof e?.message === "string"
                    ? e.message
                    : "Failed to load chat.";
            alert(msg);
        }
    }

    onMount(() => {
        void chatState.loadAllChats();
        void chatState.refreshTelegramLinkStatus();
    });
</script>

<div
    class="fixed left-0 top-0 h-full bg-secondary/80 backdrop-blur-md border-r border-border transition-all duration-300 ease-in-out z-50 flex flex-col"
    class:w-64={isOpen}
    class:w-0={!isOpen}
    class:opacity-0={!isOpen && false}
    class:overflow-hidden={!isOpen}
>
    <!-- Header -->
    <div
        class="p-4 flex items-center justify-between border-b border-border/50"
    >
        <button
            onclick={handleNewChatClick}
            class="flex items-center gap-2 font-bold text-xl tracking-tight text-primary hover:opacity-80 transition-opacity"
        >
            {#if isOpen}
                <span
                    class="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent"
                    >BigLot.ai</span
                >
            {/if}
        </button>
        <button
            onclick={toggleSidebar}
            class="p-1 hover:bg-white/5 rounded-md text-muted-foreground transition-colors"
        >
            <PanelLeftClose size={20} />
        </button>
    </div>

    <!-- Nav -->
    <div class="p-3 space-y-0.5">
        <button
            onclick={handleNewChatClick}
            class="w-full flex items-center gap-3 px-3 py-2 text-sm text-primary hover:bg-primary/10 rounded-md transition-colors group"
        >
            <Plus
                size={16}
                class="group-hover:rotate-90 transition-transform duration-200"
            />
            <span class="font-medium">New Chat</span>
        </button>

        <a
            href="/dashboard"
            class="w-full flex items-center gap-3 px-3 py-2 text-sm text-foreground/70 hover:bg-white/5 hover:text-foreground rounded-md transition-colors"
        >
            <BarChart3 size={16} class="text-muted-foreground" />
            <span>Gold Dashboard</span>
            <span
                class="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400"
            ></span>
        </a>

        <a
            href="/analytics"
            class="w-full flex items-center gap-3 px-3 py-2 text-sm text-foreground/70 hover:bg-white/5 hover:text-foreground rounded-md transition-colors"
        >
            <BarChart size={16} class="text-muted-foreground" />
            <span>Analytics</span>
        </a>

        <button
            onclick={handleAddTelegramClick}
            disabled={chatState.isTelegramLinkLoading}
            class="w-full flex items-center gap-3 px-3 py-2 text-sm text-foreground/70 hover:bg-white/5 hover:text-foreground rounded-md transition-colors disabled:opacity-50"
        >
            <Link2 size={16} class="text-muted-foreground" />
            <span>
                {chatState.telegramLinkStatus.linked
                    ? "Reconnect Telegram"
                    : "Add Telegram Bot"}
            </span>
            {#if chatState.isTelegramLinkLoading}
                <Loader2 size={14} class="ml-auto animate-spin text-muted-foreground" />
            {:else if chatState.telegramLinkStatus.linked}
                <span
                    class="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400"
                ></span>
            {/if}
        </button>

        {#if chatState.telegramLinkStatus.linked}
            <div class="flex items-center gap-2 px-3 py-1.5 ml-7">
                <span class="text-[11px] text-muted-foreground truncate">
                    {chatState.telegramLinkStatus.displayName ?? "Telegram user"}
                </span>
                <button
                    onclick={handleUnlinkTelegramClick}
                    disabled={chatState.isTelegramLinkLoading}
                    class="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
                >
                    Unlink
                </button>
            </div>
        {/if}

        {#if chatState.telegramError}
            <div class="px-3 ml-7 text-[11px] text-red-400/80">
                {chatState.telegramError}
            </div>
        {/if}
    </div>

    <!-- Chat History List -->
    <div
        class="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
    >
        {#if chatState.allChats.length > 0}
            <div
                class="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
                History
            </div>

            <!-- Search Input -->
            <div class="relative mb-1">
                <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                    type="text"
                    placeholder="ค้นหาแชท..."
                    bind:value={searchQuery}
                    class="w-full bg-white/5 border border-border/50 rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
            </div>

            {#if filteredChats.length === 0}
                <div class="px-4 py-4 text-center text-xs text-muted-foreground">
                    ไม่พบแชท "{searchQuery}"
                </div>
            {/if}

            {#each filteredChats as chat}
                <div
                    onclick={() => handleChatHistoryClick(chat.id)}
                    class="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-md transition-colors text-left group relative pr-8 cursor-pointer
                    {chatState.currentChatId === chat.id
                        ? 'bg-primary/20 text-primary'
                        : 'text-foreground/80 hover:bg-white/5'}"
                    role="button"
                    tabindex="0"
                    onkeydown={(e) =>
                        e.key === "Enter" && handleChatHistoryClick(chat.id)}
                >
                    <MessageSquare
                        size={16}
                        class="text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0
                        {chatState.currentChatId === chat.id
                            ? 'text-primary'
                            : ''}"
                    />
                    <span class="truncate flex-1">{chat.title}</span>

                    <button
                        class="absolute right-2 p-1 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all z-10"
                        title="Delete Chat"
                        onclick={(e) => {
                            e.stopPropagation();
                            if (confirm("Delete this chat?"))
                                chatState.deleteChat(chat.id);
                        }}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            {/each}
        {:else}
            <div
                class="px-4 py-8 text-center text-sm text-muted-foreground italic"
            >
                No chat history yet
            </div>
        {/if}
    </div>

    <!-- Footer -->
    <div class="p-3 border-t border-border/50 space-y-1">
        <a
            href="/settings"
            class="w-full flex items-center gap-3 px-3 py-2 text-sm text-foreground/70 hover:bg-white/5 rounded-md transition-colors text-left"
        >
            <Settings size={18} />
            <span>Settings</span>
        </a>
        <div class="flex items-center gap-3 px-3 py-2 mt-1">
            <div
                class="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-xs font-bold text-white"
            >
                TR
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">Trader User</div>
                <div class="text-xs text-muted-foreground truncate">
                    Pro Plan
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Mobile Overlay -->
{#if isOpen}
    <button
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden w-full h-full border-0 cursor-default"
        onclick={toggleSidebar}
        aria-label="Close sidebar"
        transition:fade
    ></button>
{/if}

<!-- Toggle Button (Visible when sidebar closed) -->
{#if !isOpen}
    <button
        onclick={toggleSidebar}
        class="fixed left-4 top-4 p-2 bg-secondary/80 backdrop-blur-md border border-border rounded-md text-foreground hover:bg-white/10 transition-colors z-50"
    >
        <PanelLeftOpen size={20} />
    </button>
{/if}

<style>
    /* Custom scrollbar for webkit */
    ::-webkit-scrollbar {
        width: 6px;
    }
    ::-webkit-scrollbar-track {
        background: transparent;
    }
    ::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 10px;
    }
    ::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.2);
    }
</style>
