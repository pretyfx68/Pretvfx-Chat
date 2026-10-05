/* ============================================================
   API
   ============================================================ */
const TOKEN_KEY = 'pretv_token';

function publicUser(u) {
    if (!u) return null;
    return { id: u.id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url || null, about: u.about || '', online: !!u.online, last_seen: u.last_seen, created_at: u.created_at };
}
async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function sessionUser() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; }
}

const API = {
    get token() { return localStorage.getItem(TOKEN_KEY); },
    set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); },
    async db() { return initSupabase(); },
    me() { const s = sessionUser(); if (!s?.id) throw new Error('Silakan login.'); return s; },

    // Kumpulan user_id yang pernah berbagi percakapan (chat) dengan meId.
    // Dipakai untuk membatasi Status hanya ke orang yang pernah diajak chat,
    // dan untuk daftar calon anggota grup.
    async _contactIds(sb, meId) {
        const { data: myConvs } = await sb.from('conversation_members').select('conversation_id').eq('user_id', meId);
        const convIds = [...new Set((myConvs || []).map(x => x.conversation_id))];
        const ids = new Set();
        if (convIds.length) {
            const { data: members } = await sb.from('conversation_members').select('user_id').in('conversation_id', convIds);
            (members || []).forEach(m => { if (String(m.user_id) !== String(meId)) ids.add(String(m.user_id)); });
        }
        return ids;
    },

    async call(method, url, body, isForm = false) {
        const path = String(url).split('?')[0];
        const qs = new URLSearchParams(String(url).includes('?') ? String(url).split('?')[1] : '');
        const sb = await this.db();

        if (path === '/api/chat/register' && method === 'POST') {
            const username = String(body.username || '').trim().replace(/^@/, '').toLowerCase();
            const password = String(body.password || '');
            const display_name = String(body.display_name || username).trim().slice(0, 60);
            if (!username || !password) throw new Error('Username dan password wajib diisi.');
            if (!/^[a-z0-9_.]{3,30}$/.test(username)) throw new Error('Username hanya huruf kecil, angka, titik, underscore (3–30).');
            if (password.length < 4) throw new Error('Password minimal 4 karakter.');
            const { data: exist, error: e1 } = await sb.from('chat_users').select('id').eq('username', username).maybeSingle();
            if (e1) throw new Error(e1.message);
            if (exist) throw new Error('Username sudah digunakan.');
            const hash = await sha256(password);
            const { data, error } = await sb.from('chat_users').insert([{ username, password_hash: hash, display_name }]).select('*').single();
            if (error) throw new Error(error.message);
            const user = publicUser(data);
            this.token = JSON.stringify(user);
            return { success: true, token: this.token, user };
        }

        if (path === '/api/chat/login' && method === 'POST') {
            const username = String(body.username || '').trim().replace(/^@/, '').toLowerCase();
            const password = String(body.password || '');
            const { data, error } = await sb.from('chat_users').select('*').eq('username', username).maybeSingle();
            if (error) throw new Error(error.message);
            if (!data) throw new Error('Username atau password salah.');
            const hash = await sha256(password);
            if (data.password_hash !== hash) throw new Error('Username atau password salah.');
            await sb.from('chat_users').update({ online: true, last_seen: new Date().toISOString() }).eq('id', data.id);
            const user = publicUser(data);
            this.token = JSON.stringify(user);
            return { success: true, token: this.token, user };
        }

        if (path === '/api/chat/me') {
            const me = this.me();
            const { data, error } = await sb.from('chat_users').select('*').eq('id', me.id).maybeSingle();
            if (error || !data) throw new Error('Sesi tidak valid.');
            const user = publicUser(data);
            this.token = JSON.stringify(user);
            return { success: true, user };
        }

        if (path === '/api/chat/logout' && method === 'POST') {
            try { const me = this.me(); await sb.from('chat_users').update({ online: false, last_seen: new Date().toISOString() }).eq('id', me.id); } catch (_) {}
            this.token = null;
            return { success: true };
        }

        if (path === '/api/chat/presence' && method === 'POST') {
            const me = this.me();
            const online = !!body.online;
            const patch = { online, last_seen: new Date().toISOString() };
            const { error } = await sb.from('chat_users').update(patch).eq('id', me.id);
            if (error) throw new Error(error.message);
            return { success: true, online, last_seen: patch.last_seen };
        }

        if (path === '/api/chat/password' && method === 'PUT') {
            const me = this.me();
            const oldPw = String(body.old_password || '');
            const newPw = String(body.new_password || '');
            if (newPw.length < 4) throw new Error('Password baru minimal 4 karakter.');
            const { data, error } = await sb.from('chat_users').select('password_hash').eq('id', me.id).maybeSingle();
            if (error || !data) throw new Error('User tidak ditemukan.');
            const oldHash = await sha256(oldPw);
            if (data.password_hash !== oldHash) throw new Error('Password lama salah.');
            const newHash = await sha256(newPw);
            const { error: e2 } = await sb.from('chat_users').update({ password_hash: newHash }).eq('id', me.id);
            if (e2) throw new Error(e2.message);
            return { success: true };
        }

        if (path === '/api/chat/users/search') {
            const me = this.me();
            const q = String(qs.get('q') || '').trim().toLowerCase().replace(/^@/, '');
            if (!q) return { success: true, data: [] };
            const { data, error } = await sb.from('chat_users').select('id, username, display_name, avatar_url, about, online, last_seen').or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).neq('id', me.id).limit(20);
            if (error) throw new Error(error.message);
            return { success: true, data: (data || []).map(publicUser) };
        }

        if (path.startsWith('/api/chat/users/') && method === 'GET') {
            const username = decodeURIComponent(path.split('/').pop()).replace(/^@/, '').toLowerCase();
            const { data, error } = await sb.from('chat_users').select('*').eq('username', username).maybeSingle();
            if (error || !data) throw new Error('User tidak ditemukan.');
            return { success: true, user: publicUser(data) };
        }

        if (path === '/api/chat/profile' && method === 'PUT') {
            const me = this.me();
            const patch = {};
            if (typeof body.display_name === 'string') patch.display_name = body.display_name.trim().slice(0, 60);
            if (typeof body.about === 'string') patch.about = body.about.trim().slice(0, 300);
            if (typeof body.username === 'string') {
                const uname = body.username.trim().replace(/^@/, '').toLowerCase();
                if (!/^[a-z0-9_.]{3,30}$/.test(uname)) throw new Error('Username hanya huruf kecil, angka, titik, underscore (3–30).');
                if (uname !== me.username) {
                    if (uname === ADMIN_USERNAME && me.username !== ADMIN_USERNAME) throw new Error('Username reserved.');
                    const { data: exist } = await sb.from('chat_users').select('id').eq('username', uname).maybeSingle();
                    if (exist) throw new Error('Username sudah digunakan.');
                    patch.username = uname;
                }
            }
            const { data, error } = await sb.from('chat_users').update(patch).eq('id', me.id).select('*').single();
            if (error) throw new Error(error.message);
            const user = publicUser(data);
            this.token = JSON.stringify(user);
            return { success: true, user };
        }

        if (path === '/api/chat/conversations' && method === 'GET') {
            return { success: true, data: await this._listConversations() };
        }

        if (path === '/api/chat/conversations' && method === 'POST') {
            const me = this.me();
            const otherId = String(body.user_id || '');
            if (!otherId || otherId === me.id) throw new Error('User tidak valid.');
            const { data: mine } = await sb.from('conversation_members').select('conversation_id').eq('user_id', me.id);
            const ids = (mine || []).map(x => x.conversation_id);
            if (ids.length) {
                const { data: shared } = await sb.from('conversation_members').select('conversation_id').eq('user_id', otherId).in('conversation_id', ids).limit(1);
                if (shared?.length) return { success: true, conversation_id: shared[0].conversation_id, existed: true };
            }
            const { data: conv, error: cErr } = await sb.from('conversations').insert([{ last_sender_id: me.id }]).select('*').single();
            if (cErr) throw new Error(cErr.message);
            const { error: mErr } = await sb.from('conversation_members').insert([{ conversation_id: conv.id, user_id: me.id }, { conversation_id: conv.id, user_id: otherId }]);
            if (mErr) throw new Error(mErr.message);
            return { success: true, conversation_id: conv.id, existed: false };
        }

        const msgMatch = path.match(/^\/api\/chat\/conversations\/([^/]+)\/messages$/);
        if (msgMatch && method === 'GET') {
            const convId = msgMatch[1];
            const limit = Math.min(parseInt(qs.get('limit') || '40', 10) || 40, 100);
            const { data, error } = await sb.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: false }).limit(limit);
            if (error) throw new Error(error.message);
            return { success: true, data: (data || []).reverse() };
        }
        if (msgMatch && method === 'POST') {
            const me = this.me();
            const convId = msgMatch[1];
            const message_type = String(body.message_type || 'text').toLowerCase();
            let content = String(body.content || '').trim();
            const media_url = body.media_url || null;
            const replyPayload = body.reply_to_id ? {
                reply_to_id: body.reply_to_id,
                reply_to_type: body.reply_to_type || null,
                reply_to_content: body.reply_to_content || null,
                reply_to_media_url: body.reply_to_media_url || null,
                reply_to_sender_id: body.reply_to_sender_id || null,
                reply_to_sender_name: body.reply_to_sender_name || null
            } : null;
            // Embed reply ke content agar user lain & reload tetap melihat quote
            if (replyPayload) content = encodeReplyInContent(content, replyPayload);
            const { data: others } = await sb.from('conversation_members').select('user_id').eq('conversation_id', convId).neq('user_id', me.id);
            const receiver_id = others?.[0]?.user_id || null;
            const row = { conversation_id: convId, sender_id: me.id, receiver_id, message_type, content: content || null, media_url };
            if (replyPayload) {
                row.reply_to_id = replyPayload.reply_to_id;
                row.reply_to_type = replyPayload.reply_to_type;
                row.reply_to_content = replyPayload.reply_to_content;
                row.reply_to_media_url = replyPayload.reply_to_media_url;
                row.reply_to_sender_id = replyPayload.reply_to_sender_id;
                row.reply_to_sender_name = replyPayload.reply_to_sender_name;
            }
            let msg, error;
            ({ data: msg, error } = await sb.from('messages').insert([row]).select('*').single());
            if (error && replyPayload) {
                // Fallback if reply columns belum ada — content sudah berisi embed
                delete row.reply_to_id; delete row.reply_to_type; delete row.reply_to_content;
                delete row.reply_to_media_url; delete row.reply_to_sender_id; delete row.reply_to_sender_name;
                ({ data: msg, error } = await sb.from('messages').insert([row]).select('*').single());
            }
            if (error) throw new Error(error.message);
            msg = applyReplyParse(msg);
            const preview = message_type === 'text' ? (parseReplyFromContent(content).content || '').slice(0, 80)
                : (message_type === 'image' || message_type === 'image_once' ? 'Foto'
                : message_type === 'video' || message_type === 'video_once' ? 'Video'
                : message_type === 'audio' ? 'Pesan suara'
                : message_type === 'sticker' ? 'Stiker' : 'Media');
            await sb.from('conversations').update({ last_message_at: msg.created_at, last_message_preview: preview, last_sender_id: me.id }).eq('id', convId);
            return { success: true, message: msg };
        }

        const delMsgMatch = path.match(/^\/api\/chat\/messages\/([^/]+)$/);
        if (delMsgMatch && method === 'DELETE') {
            const msgId = delMsgMatch[1];
            const { data: msg, error: e1 } = await sb.from('messages').select('*').eq('id', msgId).maybeSingle();
            if (e1 || !msg) throw new Error('Pesan tidak ditemukan.');
            if (msg.media_url) { try { await this._githubDelete(msg.media_url); } catch (e) { console.warn('Gagal hapus GitHub:', e.message); } }
            const { error: e2 } = await sb.from('messages').delete().eq('id', msgId);
            if (e2) throw new Error(e2.message);
            return { success: true };
        }

        if (path.match(/^\/api\/chat\/conversations\/[^/]+\/read$/) && method === 'POST') {
            const me = this.me();
            const convId = path.split('/')[4];
            const now = new Date().toISOString();
            await sb.from('messages').update({ read_at: now }).eq('conversation_id', convId).eq('receiver_id', me.id).is('read_at', null);
            return { success: true };
        }

        // Daftar kontak (pernah chat) milik user yang sedang login — dipakai
        // untuk memilih anggota grup dan tetap konsisten dengan filter Status.
        if (path === '/api/chat/contacts' && method === 'GET') {
            const me = this.me();
            const contactIds = await this._contactIds(sb, me.id);
            if (!contactIds.size) return { success: true, data: [] };
            const { data: us, error } = await sb.from('chat_users').select('id, username, display_name, avatar_url, online, last_seen').in('id', [...contactIds]);
            if (error) throw new Error(error.message);
            return { success: true, data: (us || []).map(publicUser) };
        }

        if (path === '/api/chat/statuses' && method === 'GET') {
            const me = this.me();
            let r = await sb.from('statuses').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(80);
            if (r.error) { r = await sb.from('statuses').select('*').order('created_at', { ascending: false }).limit(80); }
            if (r.error) throw new Error(r.error.message);
            // Hanya tampilkan status milik sendiri atau milik orang yang pernah diajak chat —
            // jangan sampai status muncul untuk orang yang belum pernah dikenal/diajak chat.
            const contactIds = await this._contactIds(sb, me.id);
            const data = (r.data || []).filter(s => String(s.user_id) === String(me.id) || contactIds.has(String(s.user_id)));
            const ids = [...new Set(data.map(s => s.user_id))];
            const users = {};
            if (ids.length) {
                const { data: us } = await sb.from('chat_users').select('*').in('id', ids);
                (us || []).forEach(u => { users[u.id] = publicUser(u); });
            }
            // Hitung viewer real dari status_views (fallback kalau kolom statuses.views kosong/0)
            const myStatusIds = data.filter(s => String(s.user_id) === String(me.id)).map(s => s.id);
            const viewCounts = {};
            if (myStatusIds.length) {
                try {
                    const { data: viewRows, error: vErr } = await sb.from('status_views').select('status_id').in('status_id', myStatusIds);
                    if (!vErr && viewRows) {
                        viewRows.forEach(v => { viewCounts[v.status_id] = (viewCounts[v.status_id] || 0) + 1; });
                    }
                } catch (e) {
                    console.warn('[statuses] status_views belum siap:', e.message || e);
                }
            }
            return {
                success: true,
                data: data.map(s => ({
                    ...s,
                    views: (viewCounts[s.id] != null) ? viewCounts[s.id] : (typeof s.views === 'number' ? s.views : 0),
                    user: users[s.user_id] || null
                }))
            };
        }
        if (path === '/api/chat/statuses' && method === 'POST') {
            const me = this.me();
            const type = String(body.type || 'text').toLowerCase();
            const content = String(body.content || '').trim();
            const media_url = body.media_url || null;
            const { data, error } = await sb.from('statuses').insert([{ user_id: me.id, type, content: content || null, media_url }]).select('*').single();
            if (error) throw new Error(error.message);
            return { success: true, status: data };
        }

        const delStatusMatch = path.match(/^\/api\/chat\/statuses\/([^/]+)$/);
        if (delStatusMatch && method === 'DELETE') {
            const stId = delStatusMatch[1];
            const { data: st, error: e1 } = await sb.from('statuses').select('*').eq('id', stId).maybeSingle();
            if (e1 || !st) throw new Error('Status tidak ditemukan.');
            if (st.media_url) { try { await this._githubDelete(st.media_url); } catch (e) { console.warn('Gagal hapus GitHub:', e.message); } }
            const { error: e2 } = await sb.from('statuses').delete().eq('id', stId);
            if (e2) throw new Error(e2.message);
            return { success: true };
        }

        // Status social details: unique viewers, likes, and replies.
        const statusDetailsMatch = path.match(/^\/api\/chat\/statuses\/([^/]+)\/details$/);
        if (statusDetailsMatch && method === 'GET') {
            const stId = statusDetailsMatch[1];
            let views = [], likes = [], replies = [];
            {
                const { data, error } = await sb.from('status_views').select('viewer_id, viewed_at').eq('status_id', stId).order('viewed_at', { ascending: false });
                if (error) console.warn('[status details] status_views:', error.message);
                else views = data || [];
            }
            {
                const { data, error } = await sb.from('status_likes').select('user_id, created_at').eq('status_id', stId);
                if (error) console.warn('[status details] status_likes:', error.message);
                else likes = data || [];
            }
            {
                const { data, error } = await sb.from('status_replies').select('user_id, content, created_at').eq('status_id', stId).order('created_at', { ascending: false }).limit(100);
                if (error) console.warn('[status details] status_replies:', error.message);
                else replies = data || [];
            }
            const userIds = [...new Set([...(views || []).map(x => x.viewer_id), ...(likes || []).map(x => x.user_id), ...(replies || []).map(x => x.user_id)])];
            const users = {};
            if (userIds.length) {
                const { data: us, error: uErr } = await sb.from('chat_users').select('id, username, display_name, avatar_url').in('id', userIds);
                if (uErr) throw new Error(uErr.message);
                (us || []).forEach(u => { users[u.id] = publicUser(u); });
            }
            const likedIds = new Set((likes || []).map(x => String(x.user_id)));
            return {
                success: true,
                views: (views || []).map(v => ({ ...v, user: users[v.viewer_id] || null, liked: likedIds.has(String(v.viewer_id)) })),
                likes: (likes || []).map(l => ({ ...l, user: users[l.user_id] || null })),
                replies: (replies || []).map(r => ({ ...r, user: users[r.user_id] || null })),
                views_count: (views || []).length,
                likes_count: (likes || []).length,
                replies_count: (replies || []).length,
                my_liked: likedIds.has(String(this.me().id))
            };
        }

        const likeMatch = path.match(/^\/api\/chat\/statuses\/([^/]+)\/like$/);
        if (likeMatch && method === 'POST') {
            const me = this.me();
            const stId = likeMatch[1];
            const { data: exists, error: e1 } = await sb.from('status_likes').select('user_id').eq('status_id', stId).eq('user_id', me.id).maybeSingle();
            if (e1) throw new Error(e1.message);
            let liked = false;
            if (exists) {
                const { error } = await sb.from('status_likes').delete().eq('status_id', stId).eq('user_id', me.id);
                if (error) throw new Error(error.message);
            } else {
                const { error } = await sb.from('status_likes').insert([{ status_id: stId, user_id: me.id }]);
                if (error) throw new Error(error.message);
                liked = true;
            }
            const { count, error: cErr } = await sb.from('status_likes').select('*', { count: 'exact', head: true }).eq('status_id', stId);
            if (cErr) throw new Error(cErr.message);
            return { success: true, liked, likes_count: count || 0 };
        }

        const replyMatch = path.match(/^\/api\/chat\/statuses\/([^/]+)\/reply$/);
        if (replyMatch && method === 'POST') {
            const me = this.me();
            const stId = replyMatch[1];
            const content = String(body.content || '').trim().slice(0, 500);
            if (!content) throw new Error('Balasan tidak boleh kosong.');

            const { data: st, error: stErr } = await sb.from('statuses').select('id, user_id, type, content, media_url').eq('id', stId).maybeSingle();
            if (stErr || !st) throw new Error('Status tidak ditemukan.');
            if (String(st.user_id) === String(me.id)) throw new Error('Pemilik status tidak dapat membalas status sendiri.');

            const { data, error } = await sb.from('status_replies').insert([{ status_id: stId, user_id: me.id, content }]).select('user_id, content, created_at').single();
            if (error) throw new Error(error.message);

            // Balasan status sudah tersimpan di status_replies (di atas) — itu yang dianggap "berhasil".
            // Meneruskannya sebagai pesan chat biasa (dengan kutipan status) bersifat best-effort:
            // kalau langkah ini gagal (mis. tabel conversation_members bermasalah), balasan TETAP dianggap terkirim.
            const ownerId = st.user_id;
            let convId = null, chatMsg = null;
            try {
                const { data: mineMembers } = await sb.from('conversation_members').select('conversation_id').eq('user_id', me.id);
                const sharedIds = (mineMembers || []).map(x => x.conversation_id);
                if (sharedIds.length) {
                    const { data: shared } = await sb.from('conversation_members').select('conversation_id').eq('user_id', ownerId).in('conversation_id', sharedIds).limit(1);
                    convId = shared?.[0]?.conversation_id || null;
                }
                if (!convId) {
                    const { data: conv, error: cErr } = await sb.from('conversations').insert([{ last_sender_id: me.id }]).select('*').single();
                    if (cErr) throw cErr;
                    convId = conv.id;
                    const { error: mErr } = await sb.from('conversation_members').insert([{ conversation_id: convId, user_id: me.id }, { conversation_id: convId, user_id: ownerId }]);
                    if (mErr) throw mErr;
                }
                const { data: cm, error: msgErr } = await sb.from('messages').insert([{
                    conversation_id: convId,
                    sender_id: me.id,
                    receiver_id: ownerId,
                    message_type: 'text',
                    content,
                    media_url: null,
                    reply_status_id: st.id,
                    reply_status_type: st.type || 'text',
                    reply_status_content: st.content || null,
                    reply_status_media_url: st.media_url || null
                }]).select('*').single();
                if (msgErr) throw msgErr;
                chatMsg = cm;
                await sb.from('conversations').update({ last_message_at: chatMsg.created_at, last_message_preview: '↩ ' + content.slice(0, 78), last_sender_id: me.id }).eq('id', convId);
            } catch (fwErr) {
                console.warn('[status reply] gagal meneruskan sebagai pesan chat (balasan tetap tersimpan):', fwErr?.message || fwErr);
                convId = null; chatMsg = null;
            }

            return { success: true, conversation_id: convId, message: chatMsg, reply: { ...data, user: publicUser(me) } };
        }

        // Rekam tepat satu tampilan per (status, viewer) dan hitung ulang total — dipakai
        // untuk daftar "Yang melihat" milik pemilik status, otomatis tersimpan di Supabase.
        const viewMatch = path.match(/^\/api\/chat\/statuses\/([^/]+)\/view$/);
        if (viewMatch && method === 'POST') {
            const me = this.me();
            const stId = viewMatch[1];
            const { data: st } = await sb.from('statuses').select('user_id').eq('id', stId).maybeSingle();
            if (st && String(me.id) !== String(st.user_id)) {
                // Coba upsert dulu (butuh unique status_id+viewer_id). Kalau gagal, coba insert.
                let recorded = false;
                const row = { status_id: stId, viewer_id: me.id, viewed_at: new Date().toISOString() };
                const { error: upErr } = await sb.from('status_views').upsert(row, { onConflict: 'status_id,viewer_id' });
                if (!upErr) {
                    recorded = true;
                } else {
                    console.warn('[status view] upsert gagal:', upErr.message);
                    const { error: insErr } = await sb.from('status_views').insert([row]);
                    if (!insErr) recorded = true;
                    else if (!/duplicate|unique|already/i.test(insErr.message || '')) {
                        console.warn('[status view] insert gagal:', insErr.message);
                        // Jangan throw — biar viewer tetap jalan; owner tetap 0 sampai schema diperbaiki
                    } else {
                        recorded = true; // sudah pernah view
                    }
                }
                if (recorded) {
                    try {
                        const { count } = await sb.from('status_views').select('*', { count: 'exact', head: true }).eq('status_id', stId);
                        // update kolom views (opsional — boleh gagal kalau kolom belum ada)
                        const { error: vuErr } = await sb.from('statuses').update({ views: count || 0 }).eq('id', stId);
                        if (vuErr) console.warn('[status view] update statuses.views gagal:', vuErr.message);
                    } catch (_) {}
                }
            }
            return { success: true };
        }

        // ============================================================
        // ADMIN: kelola pengguna (khusus ADMIN_USERNAME)
        // ============================================================
        if (path === '/api/admin/users' && method === 'GET') {
            const me = this.me();
            if (me.username !== ADMIN_USERNAME) throw new Error('Akses ditolak.');
            const { data, error } = await sb.from('chat_users').select('id, username, display_name, avatar_url, online, last_seen, created_at').order('created_at', { ascending: false });
            if (error) throw new Error(error.message);
            return { success: true, data: (data || []).map(publicUser) };
        }
        const adminDelUserMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
        if (adminDelUserMatch && method === 'DELETE') {
            const me = this.me();
            if (me.username !== ADMIN_USERNAME) throw new Error('Akses ditolak.');
            const targetId = adminDelUserMatch[1];
            const { data: target } = await sb.from('chat_users').select('username').eq('id', targetId).maybeSingle();
            if (target?.username === ADMIN_USERNAME) throw new Error('Akun admin tidak bisa dihapus.');
            const cleanup = async (fn) => { try { await fn(); } catch (e) { console.warn('[admin delete user]', e?.message || e); } };
            await cleanup(() => sb.from('status_likes').delete().eq('user_id', targetId));
            await cleanup(() => sb.from('status_views').delete().eq('viewer_id', targetId));
            await cleanup(() => sb.from('status_replies').delete().eq('user_id', targetId));
            await cleanup(() => sb.from('statuses').delete().eq('user_id', targetId));
            await cleanup(() => sb.from('group_members').delete().eq('user_id', targetId));
            await cleanup(() => sb.from('group_messages').delete().eq('sender_id', targetId));
            await cleanup(() => sb.from('messages').delete().eq('sender_id', targetId));
            await cleanup(() => sb.from('messages').delete().eq('receiver_id', targetId));
            await cleanup(() => sb.from('conversation_members').delete().eq('user_id', targetId));
            const { error } = await sb.from('chat_users').delete().eq('id', targetId);
            if (error) throw new Error(error.message);
            return { success: true };
        }

        // ============================================================
        // GRUP — terpisah dari chat perorangan. Anggota hanya boleh dari
        // kontak yang pernah diajak chat.
        // ============================================================
        if (path === '/api/groups' && method === 'GET') {
            const me = this.me();
            const { data: myMemberships, error: mErr } = await sb.from('group_members').select('group_id, last_read_at').eq('user_id', me.id);
            if (mErr) throw new Error(mErr.message);
            const groupIds = [...new Set((myMemberships || []).map(x => x.group_id))];
            if (!groupIds.length) return { success: true, data: [] };
            const { data: groups, error: gErr } = await sb.from('groups').select('*').in('id', groupIds);
            if (gErr) throw new Error(gErr.message);
            const { data: allMembers } = await sb.from('group_members').select('group_id, user_id').in('group_id', groupIds);
            const countByGroup = {};
            (allMembers || []).forEach(m => { countByGroup[m.group_id] = (countByGroup[m.group_id] || 0) + 1; });
            const readMap = {};
            (myMemberships || []).forEach(m => { readMap[m.group_id] = m.last_read_at; });
            const unreadByGroup = {};
            const mentionedByGroup = {};
            const myUname = String(me.username || '').toLowerCase();
            // Ambil last sender names untuk preview
            const lastSenderIds = [...new Set((groups || []).map(g => g.last_sender_id).filter(Boolean))];
            const senderMap = {};
            if (lastSenderIds.length) {
                try {
                    const { data: us } = await sb.from('chat_users').select('id, username, display_name').in('id', lastSenderIds);
                    (us || []).forEach(u => { senderMap[u.id] = u; });
                } catch (_) {}
            }
            for (const gid of groupIds) {
                const lastRead = readMap[gid] || '1970-01-01T00:00:00Z';
                try {
                    const { count } = await sb.from('group_messages').select('*', { count: 'exact', head: true }).eq('group_id', gid).gt('created_at', lastRead).neq('sender_id', me.id);
                    unreadByGroup[gid] = count || 0;
                } catch (_) { unreadByGroup[gid] = 0; }
                // Cek apakah ada pesan unread yang mention saya atau @semua
                mentionedByGroup[gid] = false;
                if (unreadByGroup[gid] > 0 && myUname) {
                    try {
                        const { data: umsgs } = await sb.from('group_messages')
                            .select('content')
                            .eq('group_id', gid)
                            .gt('created_at', lastRead)
                            .neq('sender_id', me.id)
                            .eq('message_type', 'text')
                            .order('created_at', { ascending: false })
                            .limit(30);
                        const reMe = new RegExp('(^|\\s)@' + myUname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
                        const reAll = /(^|\s)@(semua|everyone|all)\b/i;
                        mentionedByGroup[gid] = (umsgs || []).some(x => {
                            const c = String(x.content || '');
                            return reMe.test(c) || reAll.test(c);
                        });
                    } catch (_) {}
                }
            }
            const sorted = (groups || []).sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at));
            return {
                success: true,
                data: sorted.map(g => {
                    let preview = g.last_message_preview || '';
                    // Pastikan preview ada nama pengirim: "User: teks"
                    if (preview && g.last_sender_id && senderMap[g.last_sender_id]) {
                        const su = senderMap[g.last_sender_id];
                        const sn = su.display_name || su.username || 'User';
                        // Jika preview belum diawali nama (pesan lama / tanpa prefix)
                        if (!preview.includes(': ')) {
                            preview = sn + ': ' + preview;
                        }
                    }
                    return {
                        ...g,
                        last_message_preview: preview,
                        member_count: countByGroup[g.id] || 0,
                        unread_count: unreadByGroup[g.id] || 0,
                        mentioned: !!mentionedByGroup[g.id]
                    };
                })
            };
        }
        if (path === '/api/groups' && method === 'POST') {
            const me = this.me();
            const name = String(body.name || '').trim().slice(0, 60);
            if (!name) throw new Error('Nama grup wajib diisi.');
            const contactIds = await this._contactIds(sb, me.id);
            const memberIds = (Array.isArray(body.member_ids) ? body.member_ids : []).map(String).filter(id => contactIds.has(id));
            if (!memberIds.length) throw new Error('Pilih minimal 1 anggota yang pernah kamu ajak chat.');
            const avatar_url = body.avatar_url || null;
            let g, gErr;
            ({ data: g, error: gErr } = await sb.from('groups').insert([{ name, created_by: me.id, avatar_url }]).select('*').single());
            if (gErr && avatar_url) {
                // Kolom avatar_url mungkin belum ada di schema — fallback tanpa foto
                ({ data: g, error: gErr } = await sb.from('groups').insert([{ name, created_by: me.id }]).select('*').single());
            }
            if (gErr) throw new Error(gErr.message);
            const now = new Date().toISOString();
            const rows = [{ group_id: g.id, user_id: me.id, last_read_at: now }, ...memberIds.map(uid => ({ group_id: g.id, user_id: uid }))];
            const { error: memErr } = await sb.from('group_members').insert(rows);
            if (memErr) throw new Error(memErr.message);
            return { success: true, group: g };
        }

        const groupMembersMatch = path.match(/^\/api\/groups\/([^/]+)\/members$/);
        if (groupMembersMatch && method === 'GET') {
            const gid = groupMembersMatch[1];
            const { data: members, error } = await sb.from('group_members').select('user_id, joined_at').eq('group_id', gid);
            if (error) throw new Error(error.message);
            const uids = (members || []).map(m => m.user_id);
            let us = [];
            if (uids.length) { const r = await sb.from('chat_users').select('id, username, display_name, avatar_url').in('id', uids); us = r.data || []; }
            const userMap = {}; us.forEach(u => { userMap[u.id] = publicUser(u); });
            const { data: g } = await sb.from('groups').select('created_by').eq('id', gid).maybeSingle();
            return { success: true, created_by: g?.created_by || null, data: (members || []).map(m => ({ ...m, user: userMap[m.user_id] || null, is_owner: String(m.user_id) === String(g?.created_by) })) };
        }

        // Tambah anggota baru ke grup — semua anggota boleh menambah, hanya dari kontak
        if (groupMembersMatch && method === 'POST') {
            const me = this.me();
            const gid = groupMembersMatch[1];
            const { data: g } = await sb.from('groups').select('created_by').eq('id', gid).maybeSingle();
            if (!g) throw new Error('Grup tidak ditemukan.');
            const { data: isMember } = await sb.from('group_members').select('user_id').eq('group_id', gid).eq('user_id', me.id).maybeSingle();
            if (!isMember) throw new Error('Kamu bukan anggota grup ini.');
            const contactIds = await this._contactIds(sb, me.id);
            const { data: existing } = await sb.from('group_members').select('user_id').eq('group_id', gid);
            const existingIds = new Set((existing || []).map(x => String(x.user_id)));
            const memberIds = (Array.isArray(body.member_ids) ? body.member_ids : []).map(String).filter(id => contactIds.has(id) && !existingIds.has(id));
            if (!memberIds.length) throw new Error('Tidak ada kontak baru yang bisa ditambahkan.');
            const { error } = await sb.from('group_members').insert(memberIds.map(uid => ({ group_id: gid, user_id: uid })));
            if (error) throw new Error(error.message);
            return { success: true, added: memberIds.length };
        }

        const groupReadMatch = path.match(/^\/api\/groups\/([^/]+)\/read$/);
        if (groupReadMatch && method === 'POST') {
            const me = this.me();
            await sb.from('group_members').update({ last_read_at: new Date().toISOString() }).eq('group_id', groupReadMatch[1]).eq('user_id', me.id);
            return { success: true };
        }

        
        // Admin kick anggota
        const groupKickMatch = path.match(/^\/api\/groups\/([^/]+)\/members\/([^/]+)$/);
        if (groupKickMatch && method === 'DELETE') {
            const me = this.me();
            const gid = groupKickMatch[1];
            const targetId = groupKickMatch[2];
            const { data: g } = await sb.from('groups').select('created_by').eq('id', gid).maybeSingle();
            if (!g || String(g.created_by) !== String(me.id)) throw new Error('Hanya admin yang bisa mengeluarkan anggota.');
            if (String(targetId) === String(me.id)) throw new Error('Tidak bisa mengeluarkan diri sendiri. Gunakan keluar grup.');
            await sb.from('group_members').delete().eq('group_id', gid).eq('user_id', targetId);
            return { success: true };
        }

        // Update info grup (nama / avatar / about) — hanya admin
        const groupPatchMatch = path.match(/^\/api\/groups\/([^/]+)$/);
        if (groupPatchMatch && method === 'PUT') {
            const me = this.me();
            const gid = groupPatchMatch[1];
            const { data: g } = await sb.from('groups').select('*').eq('id', gid).maybeSingle();
            if (!g || String(g.created_by) !== String(me.id)) throw new Error('Hanya admin yang bisa mengubah info grup.');
            const patch = {};
            if (body.name != null) {
                const name = String(body.name || '').trim().slice(0, 60);
                if (!name) throw new Error('Nama grup wajib diisi.');
                patch.name = name;
            }
            if ('avatar_url' in body) patch.avatar_url = body.avatar_url || null;
            if ('about' in body) patch.about = String(body.about || '').trim().slice(0, 500) || null;
            if (!Object.keys(patch).length) return { success: true, group: g };
            let { data: updated, error } = await sb.from('groups').update(patch).eq('id', gid).select('*').single();
            // Fallback: kolom avatar_url belum ada di schema
            if (error && 'avatar_url' in patch && !('about' in patch && Object.keys(patch).length === 1)) {
                const { avatar_url, ...rest } = patch;
                if (Object.keys(rest).length) {
                    ({ data: updated, error } = await sb.from('groups').update(rest).eq('id', gid).select('*').single());
                    if (!error && updated) updated = { ...updated, avatar_url: patch.avatar_url };
                }
            }
            // Fallback khusus about: kolom about belum ada di tabel groups
            if (error && 'about' in patch) {
                const msg = (error.message || '').toLowerCase();
                if (msg.includes('about') || msg.includes('column') || msg.includes('schema')) {
                    throw new Error('Kolom about belum ada di tabel groups. Jalankan di Supabase SQL: ALTER TABLE groups ADD COLUMN IF NOT EXISTS about text;');
                }
            }
            if (error) throw new Error(error.message);
            return { success: true, group: updated };
        }

const groupLeaveMatch = path.match(/^\/api\/groups\/([^/]+)\/leave$/);
        if (groupLeaveMatch && method === 'POST') {
            const me = this.me();
            const gid = groupLeaveMatch[1];
            await sb.from('group_members').delete().eq('group_id', gid).eq('user_id', me.id);
            const { data: remaining } = await sb.from('group_members').select('user_id, joined_at').eq('group_id', gid).order('joined_at', { ascending: true });
            if (!remaining || !remaining.length) {
                await sb.from('group_messages').delete().eq('group_id', gid);
                await sb.from('groups').delete().eq('id', gid);
            } else {
                const { data: g } = await sb.from('groups').select('created_by').eq('id', gid).maybeSingle();
                if (g && String(g.created_by) === String(me.id)) await sb.from('groups').update({ created_by: remaining[0].user_id }).eq('id', gid);
            }
            return { success: true };
        }

        const groupMsgMatch = path.match(/^\/api\/groups\/([^/]+)\/messages$/);
        if (groupMsgMatch && method === 'GET') {
            const me = this.me();
            const gid = groupMsgMatch[1];
            const { data: isMember } = await sb.from('group_members').select('user_id').eq('group_id', gid).eq('user_id', me.id).maybeSingle();
            if (!isMember) throw new Error('Kamu bukan anggota grup ini.');
            const limit = Math.min(200, Number(qs.get('limit')) || 100);
            const { data, error } = await sb.from('group_messages').select('*').eq('group_id', gid).order('created_at', { ascending: false }).limit(limit);
            if (error) throw new Error(error.message);
            const rows = (data || []).slice().reverse();
            const uids = [...new Set(rows.map(m => m.sender_id))];
            const users = {};
            if (uids.length) {
                const { data: us } = await sb.from('chat_users').select('id, username, display_name, avatar_url').in('id', uids);
                (us || []).forEach(u => { users[u.id] = publicUser(u); });
            }
            return { success: true, data: rows.map(m => ({ ...m, user: users[m.sender_id] || null })) };
        }
        if (groupMsgMatch && method === 'POST') {
            const me = this.me();
            const gid = groupMsgMatch[1];
            const { data: isMember } = await sb.from('group_members').select('user_id').eq('group_id', gid).eq('user_id', me.id).maybeSingle();
            if (!isMember) throw new Error('Kamu bukan anggota grup ini.');
            const message_type = String(body.message_type || 'text');
            let content = body.content != null ? String(body.content).trim().slice(0, 2000) : '';
            const media_url = body.media_url || null;
            const replyPayload = body.reply_to_id ? {
                reply_to_id: body.reply_to_id,
                reply_to_type: body.reply_to_type || null,
                reply_to_content: body.reply_to_content || null,
                reply_to_media_url: body.reply_to_media_url || null,
                reply_to_sender_id: body.reply_to_sender_id || null,
                reply_to_sender_name: body.reply_to_sender_name || null
            } : null;
            if (replyPayload) content = encodeReplyInContent(content, replyPayload);
            if (!content && !media_url) throw new Error('Pesan tidak boleh kosong.');
            const row = { group_id: gid, sender_id: me.id, message_type, content: content || null, media_url };
            if (replyPayload) {
                row.reply_to_id = replyPayload.reply_to_id;
                row.reply_to_type = replyPayload.reply_to_type;
                row.reply_to_content = replyPayload.reply_to_content;
                row.reply_to_media_url = replyPayload.reply_to_media_url;
                row.reply_to_sender_id = replyPayload.reply_to_sender_id;
                row.reply_to_sender_name = replyPayload.reply_to_sender_name;
            }
            let msg, error;
            ({ data: msg, error } = await sb.from('group_messages').insert([row]).select('*').single());
            if (error && replyPayload) {
                delete row.reply_to_id; delete row.reply_to_type; delete row.reply_to_content;
                delete row.reply_to_media_url; delete row.reply_to_sender_id; delete row.reply_to_sender_name;
                ({ data: msg, error } = await sb.from('group_messages').insert([row]).select('*').single());
            }
            if (error) throw new Error(error.message);
            msg = applyReplyParse(msg);
            // Pesan AI ([AI] prefix) tampil sebagai akun Pretvfx AI di preview list grup
            const rawPlain = parseReplyFromContent(content || '').content || '';
            const isAiMsg = /^\[AI\]\s/.test(rawPlain) || /^⟦AI⟧/.test(rawPlain) || /^\[\[AI\]\]/.test(rawPlain);
            const senderLabel = isAiMsg
                ? 'Pretvfx AI'
                : (me.display_name || me.username || 'User').slice(0, 20);
            let plainContent = rawPlain;
            if (isAiMsg) {
                plainContent = plainContent.replace(/^\[AI\]\s*/, '').replace(/^⟦AI⟧\s*/, '').replace(/^\[\[AI\]\]\s*/, '');
            }
            const bodyPrev = media_url
                ? (message_type === 'video' || message_type === 'video_once' ? 'Video'
                   : message_type === 'audio' ? 'Pesan suara'
                   : message_type === 'sticker' ? 'Stiker'
                   : message_type === 'image_once' ? 'Foto' : 'Foto')
                : plainContent;
            const preview = senderLabel + ': ' + bodyPrev;
            await sb.from('groups').update({ last_message_at: msg.created_at, last_message_preview: preview.slice(0, 80), last_sender_id: me.id }).eq('id', gid);
            // Kembalikan pesan AI dengan identitas bot agar client langsung render benar
            if (isAiMsg) {
                return {
                    success: true,
                    message: {
                        ...msg,
                        is_ai: true,
                        user: { id: 'ai-bot-pretvfx', username: 'pretvfx-ai', display_name: 'Pretvfx AI', is_ai: true }
                    }
                };
            }
            return { success: true, message: { ...msg, user: publicUser(me) } };
        }

        const groupMsgDelMatch = path.match(/^\/api\/groups\/([^/]+)\/messages\/([^/]+)$/);
        if (groupMsgDelMatch && method === 'DELETE') {
            const me = this.me();
            const [, gid, msgId] = groupMsgDelMatch;
            const { data: msg, error: e1 } = await sb.from('group_messages').select('*').eq('id', msgId).eq('group_id', gid).maybeSingle();
            if (e1 || !msg) throw new Error('Pesan tidak ditemukan.');
            if (String(msg.sender_id) !== String(me.id)) throw new Error('Hanya bisa menghapus pesan sendiri.');
            if (msg.media_url) { try { await this._githubDelete(msg.media_url); } catch (e) { console.warn('Gagal hapus GitHub:', e.message); } }
            const { error: e2 } = await sb.from('group_messages').delete().eq('id', msgId);
            if (e2) throw new Error(e2.message);
            return { success: true };
        }

        const groupDelMatch = path.match(/^\/api\/groups\/([^/]+)$/);
        if (groupDelMatch && method === 'DELETE') {
            const me = this.me();
            const gid = groupDelMatch[1];
            const { data: g, error: gErr } = await sb.from('groups').select('created_by').eq('id', gid).maybeSingle();
            if (gErr || !g) throw new Error('Grup tidak ditemukan.');
            if (String(g.created_by) !== String(me.id)) throw new Error('Hanya pembuat grup yang bisa menghapus grup.');
            await sb.from('group_messages').delete().eq('group_id', gid);
            await sb.from('group_members').delete().eq('group_id', gid);
            const { error } = await sb.from('groups').delete().eq('id', gid);
            if (error) throw new Error(error.message);
            return { success: true };
        }

        if (path.startsWith('/api/chat/upload') && isForm) {
            const me = this.me();
            const file = body.get ? (body.get('file') || body.get('image') || body.get('video')) : null;
            if (!file) throw new Error('File tidak ditemukan.');
            const isVideo = String(file.type || '').startsWith('video/');
            const maxBytes = isVideo ? 25 * 1024 * 1024 : 20 * 1024 * 1024;
            if (file.size > maxBytes) throw new Error(isVideo ? 'Video terlalu besar (maks ~25MB setelah kompres).' : 'File terlalu besar (maks 20MB).');
            let folder = 'chat';
            if (path.includes('avatar')) folder = 'avatars';
            if (path.includes('status')) folder = 'statuses';
            if (path.includes('group')) folder = 'group';
            if (path.includes('sticker')) folder = 'stickers';
            const url = await this._githubUpload(file, folder, me.username || me.id);
            if (path.includes('avatar')) {
                const { data, error } = await sb.from('chat_users').update({ avatar_url: url }).eq('id', me.id).select('*').single();
                if (error) throw new Error(error.message);
                const user = publicUser(data);
                this.token = JSON.stringify(user);
                return { success: true, avatar_url: url, user };
            }
            return { success: true, url, message_type: isVideo ? 'video' : 'image' };
        }

        // ---- Stickers (shared pack via Supabase + GitHub) ----
        if (path === '/api/stickers' && method === 'GET') {
            const me = this.me();
            const { data, error } = await sb.from('stickers').select('id, user_id, media_url, created_at').order('created_at', { ascending: false }).limit(200);
            if (error) {
                const msg = (error.message || '').toLowerCase();
                if (msg.includes('stickers') || msg.includes('relation') || msg.includes('schema') || msg.includes('does not exist')) {
                    return { success: true, data: [], need_table: true };
                }
                throw new Error(error.message);
            }
            return { success: true, data: data || [] };
        }
        if (path === '/api/stickers' && method === 'POST') {
            const me = this.me();
            const media_url = String(body.media_url || '').trim();
            if (!media_url) throw new Error('media_url wajib.');
            const { data, error } = await sb.from('stickers').insert([{ user_id: me.id, media_url }]).select('id, user_id, media_url, created_at').single();
            if (error) {
                const msg = (error.message || '').toLowerCase();
                if (msg.includes('stickers') || msg.includes('relation') || msg.includes('schema') || msg.includes('does not exist')) {
                    throw new Error('Tabel stickers belum ada. Jalankan di Supabase SQL:\nCREATE TABLE IF NOT EXISTS stickers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text, media_url text NOT NULL, created_at timestamptz DEFAULT now());');
                }
                throw new Error(error.message);
            }
            return { success: true, sticker: data };
        }

        throw new Error('Endpoint tidak didukung: ' + path);
    },

    async _listConversations() {
        const me = this.me();
        const sb = await this.db();
        const { data: members, error } = await sb.from('conversation_members').select('conversation_id').eq('user_id', me.id);
        if (error) throw new Error(error.message);
        const ids = (members || []).map(m => m.conversation_id);
        if (!ids.length) return [];
        const { data: convs, error: cErr } = await sb.from('conversations').select('*').in('id', ids).order('last_message_at', { ascending: false });
        if (cErr) throw new Error(cErr.message);
        const { data: allMembers } = await sb.from('conversation_members').select('conversation_id, user_id').in('conversation_id', ids);
        const otherIds = [...new Set((allMembers || []).filter(m => m.user_id !== me.id).map(m => m.user_id))];
        const usersMap = {};
        if (otherIds.length) {
            const { data: users } = await sb.from('chat_users').select('id, username, display_name, avatar_url, online, last_seen').in('id', otherIds);
            (users || []).forEach(u => { usersMap[u.id] = publicUser(u); });
        }
        let unreadByConv = {};
        try {
            const { data: unreadRows } = await sb.from('messages').select('conversation_id').in('conversation_id', ids).eq('receiver_id', me.id).is('read_at', null);
            (unreadRows || []).forEach(r => { unreadByConv[r.conversation_id] = (unreadByConv[r.conversation_id] || 0) + 1; });
        } catch (_) { unreadByConv = {}; }
        const out = [];
        for (const c of (convs || [])) {
            const other = (allMembers || []).filter(m => m.conversation_id === c.id && m.user_id !== me.id).map(m => usersMap[m.user_id]).filter(Boolean)[0] || null;
            out.push({ id: c.id, last_message_at: c.last_message_at, last_message_preview: c.last_message_preview || '', last_sender_id: c.last_sender_id, other_user: other, unread_count: unreadByConv[c.id] || 0 });
        }
        return out;
    },

    async _githubUpload(file, folder, prefix) {
        await Config.load();
        const token = Config.get('github_token');
        const owner = Config.get('github_owner');
        const repo = Config.get('github_repo');
        const branch = Config.get('github_branch', 'main') || 'main';
        if (!token || !owner || !repo) throw new Error('Upload belum dikonfigurasi. Hubungi admin.');
        let name = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
        if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
            const t = String(file.type || '');
            if (t.includes('mp4')) name += '.mp4';
            else if (t.includes('webm')) name += '.webm';
            else if (t.includes('quicktime') || t.includes('mov')) name += '.mov';
            else if (t.includes('png')) name += '.png';
            else if (t.includes('webp')) name += '.webp';
            else if (t.includes('gif')) name += '.gif';
            else if (t.startsWith('image/')) name += '.jpg';
            else if (t.startsWith('video/')) name += '.mp4';
            else name += '.bin';
        }
        const ext = (name.match(/\.([a-z0-9]{1,8})$/i) || [, 'bin'])[1].toLowerCase();
        const repoPath = `${folder}/${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}.${ext}`;
        let buf;
        try {
            buf = await file.arrayBuffer();
        } catch (e) {
            throw new Error('File tidak bisa dibaca. Pilih ulang foto/video (maks 20MB).');
        }
        if (!buf || !buf.byteLength) throw new Error('File kosong atau rusak.');
        const bytes = new Uint8Array(buf);
        // base64 chunked — hindari stack overflow & memory spike di video besar
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const content = btoa(binary);
        const encodedPath = repoPath.split('/').map(encodeURIComponent).join('/');
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
        const res = await fetch(apiUrl, {
            method: 'PUT',
            headers: { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
            body: JSON.stringify({ message: `Pretvfx-Chat media: ${repoPath}`, content, branch })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('GitHub upload gagal: ' + (json.message || res.status));
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodedPath}`;
    },

    async _githubDelete(rawUrl) {
        await Config.load();
        const token = Config.get('github_token');
        const owner = Config.get('github_owner');
        const repo = Config.get('github_repo');
        const branch = Config.get('github_branch', 'main') || 'main';
        if (!token || !owner || !repo) return;
        const prefix = `https://raw.githubusercontent.com/${owner}/${repo}/`;
        if (!rawUrl.startsWith(prefix)) return;
        const rest = rawUrl.slice(prefix.length);
        const parts = rest.split('/');
        const fileBranch = parts.shift();
        const filePath = parts.join('/');
        if (!filePath) return;
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
        const getRes = await fetch(`${apiUrl}?ref=${fileBranch}`, {
            headers: { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }
        });
        if (!getRes.ok) return;
        const info = await getRes.json();
        if (!info.sha) return;
        const delRes = await fetch(apiUrl, {
            method: 'DELETE',
            headers: { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
            body: JSON.stringify({ message: `Pretvfx-Chat delete: ${filePath}`, sha: info.sha, branch: fileBranch })
        });
        if (!delRes.ok) {
            const j = await delRes.json().catch(() => ({}));
            throw new Error('GitHub delete gagal: ' + (j.message || delRes.status));
        }
    },

    get(url) { return this.call('GET', url); },
    post(url, body) { return this.call('POST', url, body); },
    put(url, body) { return this.call('PUT', url, body); },
    del(url) { return this.call('DELETE', url); },
    upload(url, formData) { return this.call('POST', url, formData, true); }
};
