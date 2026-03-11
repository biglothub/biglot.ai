import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getSupabaseAdminClient } from '$lib/server/supabaseAdmin.server';

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null;
}

export const POST: RequestHandler = async ({ request }) => {
    let payload: JsonObject;
    try {
        const body = await request.json();
        if (!isRecord(body)) return json({ error: 'Invalid request body' }, { status: 400 });
        payload = body;
    } catch {
        return json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const action = payload.action;
    const biglotUserId = typeof payload.biglotUserId === 'string' ? payload.biglotUserId : null;

    if (!biglotUserId) return json({ error: 'biglotUserId required' }, { status: 400 });

    const supabase = getSupabaseAdminClient();

    // ── List bots ─────────────────────────────────────────────────────
    if (action === 'list') {
        const { data, error } = await supabase
            .from('custom_bots')
            .select('*')
            .eq('biglot_user_id', biglotUserId)
            .order('created_at', { ascending: false });

        if (error) return json({ error: error.message }, { status: 500 });
        return json({ bots: data ?? [] });
    }

    // ── Create bot ────────────────────────────────────────────────────
    if (action === 'create') {
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        if (!name) return json({ error: 'name is required' }, { status: 400 });

        const insert = {
            biglot_user_id: biglotUserId,
            name,
            description: typeof payload.description === 'string' ? payload.description.trim() : '',
            avatar: typeof payload.avatar === 'string' ? payload.avatar.trim() : '🤖',
            system_prompt: typeof payload.system_prompt === 'string' ? payload.system_prompt.trim() : '',
            tools: Array.isArray(payload.tools) ? payload.tools.filter((t): t is string => typeof t === 'string') : [],
            default_model: typeof payload.default_model === 'string' && payload.default_model ? payload.default_model : null,
            conversation_starters: Array.isArray(payload.conversation_starters)
                ? payload.conversation_starters.filter((s): s is string => typeof s === 'string')
                : [],
            is_active: true,
        };

        const { data, error } = await supabase
            .from('custom_bots')
            .insert(insert)
            .select()
            .single();

        if (error) return json({ error: error.message }, { status: 500 });
        return json({ bot: data });
    }

    return json({ error: `Unknown action: ${action}` }, { status: 400 });
};
