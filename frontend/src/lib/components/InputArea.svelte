<script lang="ts">
    import {
        Send,
        Paperclip,
        Mic,
        Image,
        Globe,
        Loader2,
        Plus,
        GripHorizontal,
        Zap,
        MessageSquare,
        Users,
        Search,
        Square,
    } from "lucide-svelte";
    import type { ChatMode, FileAttachment } from "$lib/state/chat.svelte";
    import { chatState } from "$lib/state/chat.svelte";
    import { onMount } from "svelte";

    let input = $state("");
    let fileInput: HTMLInputElement;
    let fileInputDoc: HTMLInputElement;
    let textareaRef: HTMLTextAreaElement;
    let isProcessingFile = $state(false);

    async function handleSend() {
        if ((!input.trim() && !chatState.selectedImage && !chatState.selectedFile) || chatState.isLoading)
            return;
        const content = input;
        const imageUrl = chatState.selectedImage;
        const fileAttachment = chatState.selectedFile;
        input = "";
        chatState.clearSelectedImage();
        chatState.clearSelectedFile();
        await chatState.sendMessage(content, imageUrl || undefined, fileAttachment || undefined);
    }

    function handleFileClick() {
        fileInput?.click();
    }

    async function handleFileChange(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            chatState.selectedImage = e.target?.result as string;
        };
        reader.readAsDataURL(file);
    }

    const SUPPORTED_TEXT_EXTENSIONS = new Set([
        'txt', 'md', 'csv', 'json', 'py', 'js', 'ts',
        'html', 'css', 'xml', 'yaml', 'yml', 'log', 'sql', 'sh'
    ]);

    async function extractPdfText(file: File): Promise<string> {
        const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
        GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url
        ).href;

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await getDocument({ data: arrayBuffer }).promise;
        const pages: string[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = (content.items as Array<{ str: string }>)
                .map(item => item.str)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (pageText) pages.push(`[Page ${i}]\n${pageText}`);
        }

        return pages.join('\n\n');
    }

    async function extractExcelText(file: File): Promise<string> {
        const XLSX = await import('xlsx');
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        const parts: string[] = [];
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
            if (csv.trim()) parts.push(`## Sheet: ${sheetName}\n${csv}`);
        }

        return parts.join('\n\n');
    }

    async function extractDocxText(file: File): Promise<string> {
        const mammoth = await import('mammoth');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value;
    }

    async function handleDocFileChange(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        (e.target as HTMLInputElement).value = '';

        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

        const MAX_SIZE = 5 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            alert(`File is large (${(file.size / 1024 / 1024).toFixed(1)} MB). Content will be truncated to 40,000 characters when sent.`);
        }

        isProcessingFile = true;
        let content = '';

        try {
            if (ext === 'pdf') {
                content = await extractPdfText(file);
                if (!content.trim()) {
                    alert('This appears to be a scanned PDF with no text layer. Please use an OCR tool to extract text first.');
                    return;
                }
            } else if (ext === 'xlsx' || ext === 'xls') {
                content = await extractExcelText(file);
            } else if (ext === 'docx') {
                content = await extractDocxText(file);
            } else if (SUPPORTED_TEXT_EXTENSIONS.has(ext)) {
                content = await file.text();
            } else {
                alert(`Unsupported file type ".${ext}". Supported: pdf, xlsx, xls, docx, txt, csv, json, md, py, js, ts, html, css, xml, yaml, log, sql, sh`);
                return;
            }
        } catch (err) {
            alert(`Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return;
        } finally {
            isProcessingFile = false;
        }

        if (!content.trim()) {
            alert('File appears to be empty or could not extract any text content.');
            return;
        }

        chatState.selectedFile = {
            name: file.name,
            content,
            mimeType: file.type || `application/${ext}`
        };
    }

    function handleKeydown(e: KeyboardEvent) {
        // Enter to send (Shift+Enter for newline)
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        // Ctrl+K for new chat
        if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleNewChat();
        }
        // Escape to blur
        if (e.key === "Escape") {
            textareaRef?.blur();
        }
    }

    function handleNewChat() {
        chatState.newChat();
    }

    function toggleChatMode() {
        const modes: ChatMode[] = ['normal', 'agent', 'discussion', 'research'];
        const idx = modes.indexOf(chatState.chatMode);
        chatState.setChatMode(modes[(idx + 1) % modes.length]);
    }

    const RESEARCH_PRESETS = [
        { label: 'Gold Deep Dive', prompt: 'Deep research on gold market outlook and key drivers' },
        { label: 'BTC Analysis', prompt: 'Comprehensive analysis of Bitcoin price action and on-chain data' },
        { label: 'Macro Report', prompt: 'In-depth analysis of global macro environment and its impact on markets' },
        { label: 'US Economy', prompt: 'Deep research on US economic indicators and Fed policy outlook' },
    ];

    const DISCUSSION_PRESETS = [
        { label: 'BTC Bull vs Bear', prompt: 'วิเคราะห์ Bitcoin ควรซื้อหรือขาย ณ ตอนนี้' },
        { label: 'Gold Outlook', prompt: 'ทองคำจะขึ้นหรือลงในอีก 3 เดือน วิเคราะห์ให้หน่อย' },
        { label: 'SET Index', prompt: 'ตลาดหุ้นไทย SET Index แนวโน้มเป็นอย่างไร' },
        { label: 'US Recession?', prompt: 'เศรษฐกิจสหรัฐมีโอกาส recession ไหมในปีนี้' },
    ];

    function sendPreset(prompt: string) {
        input = prompt;
        handleSend();
    }

    // Global keyboard shortcuts
    onMount(() => {
        const handleGlobalKeydown = (e: KeyboardEvent) => {
            // Only handle if not typing in textarea
            if (document.activeElement?.tagName === 'TEXTAREA') return;
            if (document.activeElement?.tagName === 'INPUT') return;
            
            // Ctrl+K for new chat
            if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleNewChat();
            }
        };

        window.addEventListener('keydown', handleGlobalKeydown);
        return () => window.removeEventListener('keydown', handleGlobalKeydown);
    });
</script>

<div class="w-full max-w-3xl mx-auto p-4">
    <!-- File Preview -->
    {#if chatState.selectedFile}
        {@const _fext = chatState.selectedFile.name.split('.').pop()?.toLowerCase()}
        {@const _ficon = _fext === 'pdf' ? '📕' : _fext === 'xlsx' || _fext === 'xls' ? '📊' : _fext === 'docx' ? '📝' : '📄'}
        <div class="mb-2 relative inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/20 bg-secondary/60 text-sm text-foreground/80">
            <span>{_ficon}</span>
            <span class="max-w-[200px] truncate" title={chatState.selectedFile.name}>
                {chatState.selectedFile.name}
            </span>
            <button
                onclick={() => chatState.clearSelectedFile()}
                class="ml-1 p-0.5 text-muted-foreground hover:text-destructive transition-colors rounded-full"
                title="Remove file"
            >
                <Plus size={12} class="rotate-45" />
            </button>
        </div>
    {/if}

    <!-- Image Preview -->
    {#if chatState.selectedImage}
        <div class="mb-2 relative inline-block group">
            <img
                src={chatState.selectedImage}
                alt="Selected"
                class="w-20 h-20 object-cover rounded-xl border border-white/20"
            />
            <button
                onclick={() => chatState.clearSelectedImage()}
                class="absolute -top-2 -right-2 bg-secondary text-foreground p-1 rounded-full border border-white/10 hover:bg-destructive hover:text-white transition-colors"
                title="Remove Image"
            >
                <Plus size={12} class="rotate-45" />
            </button>
        </div>
    {/if}

    <!-- Discussion Preset Topics -->
    {#if chatState.chatMode === 'discussion' && chatState.messages.length === 0 && !chatState.isLoading}
        <div class="flex flex-wrap gap-2 mb-3">
            {#each DISCUSSION_PRESETS as preset}
                <button
                    onclick={() => sendPreset(preset.prompt)}
                    class="px-3 py-1.5 text-xs rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                >
                    {preset.label}
                </button>
            {/each}
        </div>
    {/if}

    <!-- Research Preset Topics -->
    {#if chatState.chatMode === 'research' && chatState.messages.length === 0 && !chatState.isLoading}
        <div class="flex flex-wrap gap-2 mb-3">
            {#each RESEARCH_PRESETS as preset}
                <button
                    onclick={() => sendPreset(preset.prompt)}
                    class="px-3 py-1.5 text-xs rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                >
                    {preset.label}
                </button>
            {/each}
        </div>
    {/if}

    <!-- Mode Toggle (above pill) -->
    <div class="flex items-center mb-2 px-1">
        <button
            onclick={toggleChatMode}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 border
                {chatState.chatMode === 'agent'
                    ? 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30'
                    : chatState.chatMode === 'discussion'
                        ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
                        : chatState.chatMode === 'research'
                            ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/30'
                            : 'bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10 hover:text-foreground'}"
            title={chatState.chatMode === 'agent'
                ? 'Agent Mode - Click to switch to Discussion'
                : chatState.chatMode === 'discussion'
                    ? 'Discussion Mode - Click to switch to Research'
                    : chatState.chatMode === 'research'
                        ? 'Research Mode - Click to switch to Normal'
                        : 'Normal Mode - Click to switch to Agent'}
        >
            {#if chatState.chatMode === 'agent'}
                <Zap size={14} />
                <span>Agent</span>
            {:else if chatState.chatMode === 'discussion'}
                <Users size={14} />
                <span>Discussion</span>
            {:else if chatState.chatMode === 'research'}
                <Search size={14} />
                <span>Research</span>
            {:else}
                <MessageSquare size={14} />
                <span>Normal</span>
            {/if}
        </button>
    </div>

    <div
        class="relative bg-secondary/80 backdrop-blur-xl border border-white/10 focus-within:border-white/20 transition-all rounded-[2rem] shadow-2xl flex items-end p-2 gap-2"
    >
        <!-- Left Actions -->
        <input
            type="file"
            accept="image/*"
            bind:this={fileInput}
            onchange={handleFileChange}
            class="hidden"
        />
        <input
            type="file"
            accept=".txt,.md,.csv,.json,.py,.js,.ts,.html,.css,.xml,.yaml,.yml,.log,.sql,.sh,.pdf,.xlsx,.xls,.docx"
            bind:this={fileInputDoc}
            onchange={handleDocFileChange}
            class="hidden"
        />
        <button
            onclick={handleFileClick}
            class="p-2.5 text-muted-foreground hover:text-primary hover:bg-white/5 rounded-full transition-colors mb-0.5"
            title="Add Image"
        >
            <Image size={20} />
        </button>
        <button
            onclick={() => fileInputDoc?.click()}
            disabled={isProcessingFile}
            class="p-2.5 text-muted-foreground hover:text-primary hover:bg-white/5 rounded-full transition-colors mb-0.5 disabled:opacity-50 disabled:cursor-wait"
            title="Attach File (pdf, xlsx, docx, txt, csv, json, py, ...)"
        >
            {#if isProcessingFile}
                <Loader2 size={20} class="animate-spin" />
            {:else}
                <Paperclip size={20} />
            {/if}
        </button>

        <!-- Textarea -->
        <textarea
            bind:this={textareaRef}
            bind:value={input}
            onkeydown={handleKeydown}
            disabled={chatState.isLoading}
            placeholder="Ask anything... (Shift+Enter for newline)"
            class="flex-1 bg-transparent border-0 outline-none ring-0 focus:ring-0 focus:outline-none text-foreground placeholder:text-muted-foreground resize-none py-3 min-h-[44px] max-h-[200px] scrollbar-none disabled:opacity-50 text-base"
            rows="1"
        ></textarea>

        <!-- Right Actions -->
        <div class="flex items-center gap-1 mb-0.5">
            {#if chatState.isLoading}
                <button
                    onclick={() => chatState.stopGeneration()}
                    class="p-2.5 rounded-full transition-all duration-200 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                    title="Stop generation"
                >
                    <Square size={16} fill="currentColor" />
                </button>
            {:else}
                <button
                    onclick={handleSend}
                    class="p-2.5 rounded-full transition-all duration-200
              {(input.trim() || chatState.selectedImage || chatState.selectedFile)
                        ? 'bg-primary text-secondary font-bold hover:opacity-90'
                        : 'bg-white/5 text-muted-foreground cursor-not-allowed'}"
                    disabled={!input.trim() && !chatState.selectedImage && !chatState.selectedFile}
                >
                    <Send size={18} />
                </button>
            {/if}
        </div>
    </div>

    <div class="mt-3 text-center text-xs text-muted-foreground/50">
        BigLot.ai can make mistakes. Consider checking important information.
    </div>
</div>
