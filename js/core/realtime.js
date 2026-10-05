/* ============================================================
   WS MANAGER
   ============================================================ */
const WSManager = (function () {
    let listeners = {};
    let channel = null;
    function emit(type, payload) { (listeners[type] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); }
    function mapMsg(m) {
        if (!m) return m;
        const base = { id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id, receiver_id: m.receiver_id || null, message_type: m.message_type || m.media_type || 'text', content: m.content || m.body || '', media_url: m.media_url || null, created_at: m.created_at, read_at: m.read_at || null, reply_status_id: m.reply_status_id || null, reply_status_type: m.reply_status_type || null, reply_status_content: m.reply_status_content || null, reply_status_media_url: m.reply_status_media_url || null, reply_to_id: m.reply_to_id || null, reply_to_type: m.reply_to_type || null, reply_to_content: m.reply_to_content || null, reply_to_media_url: m.reply_to_media_url || null, reply_to_sender_id: m.reply_to_sender_id || null, reply_to_sender_name: m.reply_to_sender_name || null };
        return applyReplyParse(base);
    }
    function mapGroupMsg(m) {
        if (!m) return m;
        const base = { id: m.id, group_id: m.group_id, sender_id: m.sender_id, message_type: m.message_type || 'text', content: m.content || '', media_url: m.media_url || null, created_at: m.created_at, user: m.user || null, reply_to_id: m.reply_to_id || null, reply_to_type: m.reply_to_type || null, reply_to_content: m.reply_to_content || null, reply_to_media_url: m.reply_to_media_url || null, reply_to_sender_id: m.reply_to_sender_id || null, reply_to_sender_name: m.reply_to_sender_name || null };
        return applyReplyParse(base);
    }
    async function connect() {
        try {
            const sb = await initSupabase();
            if (channel) { try { await sb.removeChannel(channel); } catch (_) { } channel = null; }
            channel = sb.channel('pretv-public')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => emit('message:new', { message: mapMsg(p.new) }))
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => {
                    if (p.new && p.new.read_at) emit('message:read', { conversation_id: p.new.conversation_id, reader_id: p.new.receiver_id, read_at: p.new.read_at });
                })
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => emit('message:delete', { message: { id: p.old.id, conversation_id: p.old.conversation_id } }))
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'statuses' }, () => emit('status:new', {}))
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'statuses' }, () => emit('status:delete', {}))
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_users' }, (p) => { if (p.new) emit('presence', { user_id: p.new.id, online: !!p.new.online, last_seen: p.new.last_seen }); })
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, (p) => emit('group:message:new', { message: mapGroupMsg(p.new) }))
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_messages' }, (p) => emit('group:message:delete', { message: { id: p.old.id, group_id: p.old.group_id } }))
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_members' }, () => emit('group:updated', {}))
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_members' }, () => emit('group:updated', {}))
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups' }, () => emit('group:updated', {}))
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'groups' }, (p) => emit('group:deleted', { group_id: p.old.id }))
                .subscribe((status, err) => {
                    if (status === 'SUBSCRIBED') console.log('[realtime] Terhubung.');
                    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') console.warn('[realtime] Gagal:', status, err && err.message);
                });
        } catch (e) { console.warn('[realtime]', e.message || e); }
    }
    function on(type, fn) { if (!listeners[type]) listeners[type] = []; listeners[type].push(fn); }
    function send() { }
    function close() { channel = null; }
    return { connect, on, send, close };
})();
