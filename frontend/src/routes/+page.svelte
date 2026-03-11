<script lang="ts">
    import Sidebar from "$lib/components/Sidebar.svelte";
    import ChatArea from "$lib/components/ChatArea.svelte";
    import InputArea from "$lib/components/InputArea.svelte";
    import { chatState, type AgentMode } from "$lib/state/chat.svelte";
    import AgentOrb from "$lib/components/AgentOrb.svelte";
    import WatchlistBar from "$lib/components/WatchlistBar.svelte";
    import { fade } from "svelte/transition";
    import { Sparkles } from "lucide-svelte";

    let sidebarOpen = $state(true);
    let autoDetectedMode = $state<AgentMode | null>(null);
    let autoDetectTimeout: ReturnType<typeof setTimeout> | undefined;

    function handleModeChange(e: Event) {
        const value = (e.target as HTMLSelectElement).value;
        chatState.setAgentMode(value as AgentMode);
    }

    // Watch for mode changes triggered by auto-detect (flash indicator briefly)
    $effect(() => {
        const _mode = chatState.agentMode;
        // Show "auto" badge briefly when loading starts (mode was just auto-set)
        if (chatState.isLoading && !autoDetectedMode) {
            autoDetectedMode = _mode;
            clearTimeout(autoDetectTimeout);
            autoDetectTimeout = setTimeout(() => {
                autoDetectedMode = null;
            }, 2500);
        }
    });
</script>

<div
    class="flex h-full overflow-hidden bg-background text-foreground font-sans"
>
    <!-- Sidebar -->
    <Sidebar bind:isOpen={sidebarOpen} />

    <!-- Main Content -->
    <main
        class="flex-1 flex flex-col relative z-0 overflow-hidden h-full transition-all duration-300 ease-in-out"
        class:ml-64={sidebarOpen}
        class:ml-0={!sidebarOpen}
    >
        <!-- Top Bar (Mode Selector like ChatGPT model picker) -->
        <header
            class="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-background/60 backdrop-blur-md"
        >
            <div class="flex items-center gap-2 min-w-0 flex-wrap">
                <div class="text-xs text-muted-foreground/70">
                    Mode
                </div>
                <select
                    class="text-xs bg-secondary/80 border border-white/10 rounded-full px-3 py-1.5 text-foreground/85 focus:outline-none focus:ring-0 focus:border-white/20 max-w-[16rem]"
                    value={chatState.agentMode}
                    onchange={handleModeChange}
                    title="Assistant mode"
                >
                    <optgroup label="General">
                        <option value="coach">Coach</option>
                        <option value="recovery">Recovery</option>
                        <option value="analyst">Market Analyst</option>
                        <option value="pinescript">PineScript Engineer</option>
                    </optgroup>
                    <optgroup label="Gold & Macro">
                        <option value="gold">Gold Specialist</option>
                        <option value="macro">Macro Analyst</option>
                        <option value="portfolio">Portfolio Manager</option>
                    </optgroup>
                </select>

                {#if autoDetectedMode}
                    <span
                        class="inline-flex items-center gap-1 text-[10px] text-primary/80 font-medium animate-pulse"
                        transition:fade={{ duration: 200 }}
                    >
                        <Sparkles size={10} />
                        auto
                    </span>
                {/if}
            </div>

            <div class="flex items-center gap-2">
                <AgentOrb
                    size="sm"
                    status={chatState.isLoading ? "analyzing" : "idle"}
                    showLabel={false}
                />
            </div>
        </header>

        <!-- Live Market Watchlist Bar -->
        <WatchlistBar />

        {#if chatState.currentChatId === null && chatState.messages.length === 0}
            <!-- Empty State / Home Page -->
            <div
                class="flex-1 flex flex-col items-center justify-center p-4"
                transition:fade
            >
                <div class="mb-12 scale-150">
                    <AgentOrb
                        size="lg"
                        status={chatState.isLoading ? "analyzing" : "idle"}
                    />
                </div>

                <div class="mb-8 text-center">
                    <h1
                        class="text-3xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 mb-2"
                    >
                        BigLot.ai
                    </h1>
                    <p class="text-muted-foreground">
                        Autonomous Trading Agent Platform
                    </p>
                </div>

                <div class="w-full max-w-3xl">
                    <InputArea />
                </div>
            </div>
        {:else}
            <!-- Chat Interface -->
            <div
                class="flex-1 flex flex-col h-full overflow-hidden"
                transition:fade
            >
                <ChatArea />
                <div
                    class="w-full border-t border-white/5 bg-background/50 backdrop-blur-sm pb-4"
                >
                    <InputArea />
                </div>
            </div>
        {/if}
    </main>
</div>
