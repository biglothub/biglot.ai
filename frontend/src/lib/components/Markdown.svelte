<script lang="ts">
    import { marked } from "marked";
    import sanitizeHtml from "sanitize-html";
    import hljs from "highlight.js";
    import { onMount } from "svelte";

    export let content = "";
    let container: HTMLDivElement;

    // Configure marked with GFM and syntax highlighting
    marked.setOptions({
        gfm: true,
        breaks: true,
    });

    // ── Helpers ──────────────────────────────────────────────────────
    function escapeHtml(str: string): string {
        return str
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    /** True when the block looks like a tool-call the LLM emitted as text */
    function looksLikeToolCall(text: string): boolean {
        return /\[เรียกใช้[:：]/.test(text)
            || /^\s*\[.*?(tool|call|เรียก)/im.test(text)
            || /^\s*\{\s*"tool"\s*:/m.test(text)
            || /^\s*\{\s*"function"\s*:/m.test(text)
            || /^\s*\{\s*"name"\s*:.*"args"\s*:/ms.test(text);
    }

    /** True when the YAML contains chart / analysis / trade-setup structured keys */
    function looksLikeStructuredData(text: string): boolean {
        const dataKeys = [
            'type:', 'title:', 'support:', 'resistance:', 'analysis:',
            'entry:', 'stop_loss:', 'target:', 'timeframe:', 'price:',
            'signal:', 'trend:', 'data:', 'value:', 'change:',
            'indicator:', 'rsi:', 'macd:', 'setup:', 'risk:',
        ];
        const lower = text.toLowerCase();
        return dataKeys.filter((k) => lower.includes(k)).length >= 2;
    }

    function getCardIcon(type: string): string {
        const t = type.toLowerCase();
        if (t.includes('candle') || t.includes('chart')) return '📊';
        if (t.includes('trade') || t.includes('setup')) return '🎯';
        if (t.includes('metric') || t.includes('price') || t.includes('gauge')) return '📈';
        if (t.includes('news')) return '📰';
        if (t.includes('heatmap') || t.includes('correlation')) return '🗺️';
        if (t.includes('indicator') || t.includes('rsi') || t.includes('macd')) return '📉';
        return '📋';
    }

    /** Parses simple YAML into key-value pairs + list items, then renders a styled card */
    function renderDataCard(text: string): string {
        const lines = text.split('\n');
        let title = '';
        let type = '';
        const kvPairs: [string, string][] = [];
        const listItems: string[] = [];
        let collectingList = false;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) { collectingList = false; continue; }

            // List items
            if (trimmed.startsWith('- ')) {
                listItems.push(trimmed.slice(2));
                collectingList = true;
                continue;
            }
            if (collectingList && /^\s{2,}/.test(lines[i])) {
                // Continuation of previous list item
                if (listItems.length > 0) {
                    listItems[listItems.length - 1] += ' ' + trimmed;
                }
                continue;
            }
            collectingList = false;

            // Key: value pairs
            const match = trimmed.match(/^([\w\s_]+?)[:：]\s*(.*)/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^["']|["']$/g, '');
                if (value === '|' || value === '>') continue; // multi-line scalar indicator
                if (key.toLowerCase() === 'title') title = value;
                else if (key.toLowerCase() === 'type') type = value;
                else if (value) kvPairs.push([key, value]);
            } else if (!title && !type && !trimmed.includes(':') && i === 0) {
                // Standalone label on the first line (e.g. "chart")
                type = trimmed;
            }
        }

        const icon = getCardIcon(type || title);
        const displayTitle = title || type;

        let html = '<div class="ydc">';

        if (displayTitle) {
            html += `<div class="ydc-head">${icon}<span>${escapeHtml(displayTitle)}</span></div>`;
        }
        if (type && title) {
            html += `<span class="ydc-badge">${escapeHtml(type)}</span>`;
        }

        if (kvPairs.length > 0) {
            html += '<div class="ydc-grid">';
            for (const [k, v] of kvPairs) {
                // Highlight values that look like prices or percentages
                const isHighlight = /^\$|^[+-]?\d.*%$/.test(v);
                const valClass = isHighlight ? 'ydc-val ydc-val-hl' : 'ydc-val';
                html += `<div class="ydc-key">${escapeHtml(k)}</div><div class="${valClass}">${escapeHtml(v)}</div>`;
            }
            html += '</div>';
        }

        if (listItems.length > 0) {
            html += '<div class="ydc-list">';
            for (const item of listItems) {
                html += `<div class="ydc-li">${escapeHtml(item)}</div>`;
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ── Custom renderer ──────────────────────────────────────────────
    const renderer = new marked.Renderer();

    renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
        const isYaml = lang === 'yaml' || lang === 'yml';
        const isToolLang = lang === 'tool_call' || lang === 'tool' || lang === 'function_call';

        // Strip tool-call blocks the LLM sometimes writes as text
        if (isToolLang) {
            return '';
        }
        if ((isYaml || !lang) && looksLikeToolCall(text)) {
            return '';
        }

        // Render structured YAML as a styled data card
        if (isYaml && looksLikeStructuredData(text)) {
            return renderDataCard(text);
        }

        // Normal code block rendering
        let highlighted: string;
        let language = lang || "plaintext";

        try {
            if (lang && hljs.getLanguage(lang)) {
                highlighted = hljs.highlight(text, { language: lang }).value;
                language = hljs.getLanguage(lang)?.name || lang;
            } else {
                highlighted = hljs.highlightAuto(text).value;
            }
        } catch {
            highlighted = text;
        }

        const escapedCode = escapeHtml(text);

        return `<div class="code-block-wrapper">
    <div class="code-header">
        <span class="code-language">${language}</span>
        <button type="button" class="copy-btn" data-copy-code="${escapedCode}">Copy</button>
    </div>
    <pre><code class="hljs">${highlighted}</code></pre>
</div>`;
    };

    renderer.link = function ({ href, title, text }: { href: string; title?: string | null; text: string }) {
        const isExternal = href && (href.startsWith("http://") || href.startsWith("https://"));
        const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";
        const titleAttr = title ? ` title="${title}"` : "";
        return `<a href="${href}"${titleAttr}${target}>${text}</a>`;
    };

    marked.use({ renderer });

    // Sanitization config - allow necessary tags for code blocks, tables, and data cards
    const sanitizeConfig = {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
            "div", "span", "button", "table", "thead", "tbody", "tr", "th", "td",
            "input", "img"
        ]),
        allowedAttributes: {
            ...sanitizeHtml.defaults.allowedAttributes,
            div: ["class"],
            span: ["class"],
            button: ["class", "data-copy-code", "type"],
            a: ["href", "title", "target", "rel"],
            code: ["class"],
            pre: ["class"],
            table: ["class"],
            th: ["class", "align"],
            td: ["class", "align"],
            input: ["type", "disabled", "checked"],
            img: ["src", "alt", "title", "class"],
        },
        allowedClasses: {
            div: ["code-block-wrapper", "code-header", "markdown-body", "hljs", "*"],
            span: ["code-language", "hljs-*", "*"],
            button: ["copy-btn"],
            code: ["hljs", "hljs-*"],
            pre: ["hljs"],
            table: ["*"],
            "*": ["*"],
        },
    };

    $: html = sanitizeHtml(marked.parse(content || "") as string, sanitizeConfig);

    function handleMarkdownClick(event: MouseEvent) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const button = target.closest('button[data-copy-code]');
        if (!(button instanceof HTMLButtonElement)) return;

        const code = button.getAttribute("data-copy-code") || "";
        void navigator.clipboard.writeText(code).then(() => {
            const originalText = button.textContent;
            button.textContent = "Copied!";
            button.classList.add("copied");
            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove("copied");
            }, 2000);
        });
    }

    onMount(() => {
        container?.addEventListener("click", handleMarkdownClick);
        return () => container?.removeEventListener("click", handleMarkdownClick);
    });
</script>

<div bind:this={container} class="prose-gold markdown-body">
    {@html html}
</div>

<style>
    /* ── Data card (structured YAML) ── */
    .markdown-body :global(.ydc) {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 16px 20px;
        margin: 12px 0;
    }

    .markdown-body :global(.ydc-head) {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.92);
        margin-bottom: 6px;
    }

    .markdown-body :global(.ydc-badge) {
        display: inline-block;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(245, 158, 11, 0.9);
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.2);
        border-radius: 4px;
        padding: 2px 8px;
        margin-bottom: 10px;
    }

    .markdown-body :global(.ydc-grid) {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 5px 20px;
        margin: 12px 0;
    }

    .markdown-body :global(.ydc-key) {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.45);
        font-weight: 500;
        white-space: nowrap;
    }

    .markdown-body :global(.ydc-val) {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.85);
        font-weight: 500;
    }

    .markdown-body :global(.ydc-val-hl) {
        color: rgba(245, 158, 11, 0.95);
        font-weight: 600;
    }

    .markdown-body :global(.ydc-list) {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .markdown-body :global(.ydc-li) {
        font-size: 12.5px;
        color: rgba(255, 255, 255, 0.7);
        padding-left: 14px;
        position: relative;
        line-height: 1.5;
    }

    .markdown-body :global(.ydc-li::before) {
        content: '•';
        position: absolute;
        left: 0;
        color: rgba(245, 158, 11, 0.6);
        font-weight: bold;
    }

    /* ── Code block styling ── */
    .markdown-body :global(.code-block-wrapper) {
        position: relative;
        margin: 1rem 0;
        border-radius: 0.5rem;
        overflow: hidden;
        background: #1e1e1e;
    }

    .markdown-body :global(.code-header) {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 1rem;
        background: #2d2d2d;
        border-bottom: 1px solid #404040;
    }

    .markdown-body :global(.code-language) {
        font-size: 0.75rem;
        color: #a0a0a0;
        text-transform: uppercase;
        font-weight: 500;
    }

    .markdown-body :global(.copy-btn) {
        padding: 0.25rem 0.75rem;
        font-size: 0.75rem;
        background: #404040;
        color: #e0e0e0;
        border: none;
        border-radius: 0.25rem;
        cursor: pointer;
        transition: all 0.2s;
    }

    .markdown-body :global(.copy-btn:hover) {
        background: #505050;
    }

    .markdown-body :global(.copy-btn.copied) {
        background: #22c55e;
        color: white;
    }

    .markdown-body :global(pre) {
        margin: 0;
        padding: 1rem;
        overflow-x: auto;
    }

    .markdown-body :global(pre code) {
        font-family: "Fira Code", "JetBrains Mono", Consolas, Monaco, monospace;
        font-size: 0.875rem;
        line-height: 1.6;
        white-space: pre;
        background: transparent;
    }

    .markdown-body :global(code:not(pre code)) {
        background: rgba(255, 255, 255, 0.1);
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        font-size: 0.875em;
        white-space: pre-wrap;
    }

    /* ── Table styling ── */
    .markdown-body :global(table) {
        width: 100%;
        border-collapse: collapse;
        margin: 1rem 0;
    }

    .markdown-body :global(th),
    .markdown-body :global(td) {
        border: 1px solid #404040;
        padding: 0.5rem 0.75rem;
        text-align: left;
    }

    .markdown-body :global(th) {
        background: rgba(255, 255, 255, 0.05);
        font-weight: 600;
    }

    .markdown-body :global(tr:hover) {
        background: rgba(255, 255, 255, 0.02);
    }

    /* External link indicator */
    .markdown-body :global(a[target="_blank"]::after) {
        content: " ↗";
        font-size: 0.75em;
        opacity: 0.7;
    }

    /* ── Highlight.js theme overrides for dark mode ── */
    .markdown-body :global(.hljs) {
        color: #abb2bf;
        background: transparent;
    }

    .markdown-body :global(.hljs-keyword),
    .markdown-body :global(.hljs-selector-tag),
    .markdown-body :global(.hljs-built_in) {
        color: #c678dd;
    }

    .markdown-body :global(.hljs-string),
    .markdown-body :global(.hljs-title) {
        color: #98c379;
    }

    .markdown-body :global(.hljs-number),
    .markdown-body :global(.hljs-literal) {
        color: #d19a66;
    }

    .markdown-body :global(.hljs-comment) {
        color: #5c6370;
        font-style: italic;
    }

    .markdown-body :global(.hljs-function) {
        color: #61afef;
    }

    .markdown-body :global(.hljs-variable),
    .markdown-body :global(.hljs-params) {
        color: #e06c75;
    }
</style>
