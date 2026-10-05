/* ============================================================
   CHAT MODULE
   ============================================================ */
const ChatModule = (function () {
    let state, list, msgsEl, composer, input, fileInput, sendBtn, typingBar, newMsgIndicator;

    const CHAT_CACHE_KEY = 'pretv_chat_list';
    function hydrateChatsFromCache() {
        try {
            const cached = JSON.parse(localStorage.getItem(CHAT_CACHE_KEY) || 'null');
            if (Array.isArray(cached) && cached.length) {
                state.chatList = cached;
                renderConversations();
                return true;
            }
        } catch (_) {}
        return false;
    }
    function saveChatsCache() {
        try { localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify((state.chatList || []).slice(0, 80))); } catch (_) {}
    }

    function init(s) {
        state = s;
        list = document.getElementById('chat-list');
        msgsEl = document.getElementById('messages');
        composer = document.getElementById('composer');
        input = document.getElementById('composer-input');
        fileInput = document.getElementById('file-input');
        sendBtn = document.getElementById('send-btn');
        typingBar = document.getElementById('typing-bar');
        newMsgIndicator = document.getElementById('new-msg-indicator');
        hydrateChatsFromCache();

        document.getElementById('conv-back').addEventListener('click', closeConv);
        document.getElementById('conv-profile').addEventListener('click', refreshConversation);
        const aiFab = document.getElementById('ai-fab');
        if (aiFab) aiFab.addEventListener('click', () => {
            if (typeof AIModule !== 'undefined' && AIModule.openAiChat) {
                AIModule.openAiChat();
            } else showToast('AI belum siap');
        });
        const searchInp = document.getElementById('search-input');
        searchInp.addEventListener('input', debounce(onSearch, 300));
        const clearBtn = document.getElementById('search-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                searchInp.value = '';
                clearBtn.classList.remove('visible');
                clearSearchUI();
                renderConversations();
            });
        }
        composer.addEventListener('submit', onSendText);
        input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendText(e); } });
        input.addEventListener('input', () => { autoGrow(); updateComposerMode(); });
        fileInput.addEventListener('change', onPickMedia);
        newMsgIndicator.addEventListener('click', () => { scrollToBottom(true); newMsgIndicator.classList.add('hidden'); });
        const micBtn = document.getElementById('mic-btn');
        if (micBtn) micBtn.addEventListener('click', startVoiceRecord);
        const recCancel = document.getElementById('rec-cancel');
        if (recCancel) recCancel.addEventListener('click', cancelVoiceRecord);
        const recSend = document.getElementById('rec-send');
        if (recSend) recSend.addEventListener('click', sendVoiceRecord);
        const stickerBtn = document.getElementById('sticker-btn');
        if (stickerBtn) stickerBtn.addEventListener('click', () => StickerModule.open('chat'));
        const attachBtn = document.getElementById('attach-btn');
        const attachMenu = document.getElementById('attach-menu');
        if (attachBtn && attachMenu) {
            attachBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                attachMenu.classList.toggle('hidden');
            });
            attachMenu.addEventListener('click', (e) => {
                const b = e.target.closest('[data-attach]');
                if (!b) return;
                attachMenu.classList.add('hidden');
                const kind = b.dataset.attach;
                const map = { video: 'file-input-video', foto: 'file-input-foto', kamera: 'file-input-kamera' };
                const inp = document.getElementById(map[kind]);
                if (inp) inp.click();
            });
            document.addEventListener('click', (e) => {
                if (!attachMenu.classList.contains('hidden') && !e.target.closest('#attach-btn') && !e.target.closest('#attach-menu')) {
                    attachMenu.classList.add('hidden');
                }
            });
        }
        ['file-input-foto','file-input-video','file-input-kamera'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', onPickMedia);
        });
        updateComposerMode();
        msgsEl.addEventListener('click', onAudioPlayClick);

        // Tap bubble kita → buka menu hapus
        msgsEl.addEventListener('click', (e) => {
            const msgEl = e.target.closest('.msg');
            if (!msgEl) return;
            const mediaWrap = e.target.closest('.media-wrap');
            if (mediaWrap && !msgEl.classList.contains('is-uploading')) {
                const mediaMsg = state.messages.find(x => String(x.id) === String(msgEl.dataset.id));
                if (mediaMsg?.media_url) {
                    let t = mediaMsg.message_type || mediaWrap.dataset.mediaType || 'image';
                    const isOnce = t === 'image_once' || t === 'video_once' || mediaWrap.dataset.viewOnce === '1';
                    if (isOnce && mediaMsg.sender_id !== state.me.id) {
                        if (hasViewedOnce(mediaMsg.id)) {
                            showToast('Foto/video telah dilihat.');
                            return;
                        }
                        markViewedOnce(mediaMsg.id);
                        // re-render bubble locked after open
                        setTimeout(() => {
                            const el = msgsEl.querySelector(`.msg[data-id="${mediaMsg.id}"]`);
                            if (el) {
                                const wrap = document.createElement('div');
                                wrap.innerHTML = renderMessage(mediaMsg);
                                el.replaceWith(wrap.firstChild);
                            }
                        }, 400);
                    }
                    if (t === 'image_once') t = 'image';
                    if (t === 'video_once') t = 'video';
                    // buang fragment #t=... supaya video full bisa play
                    const url = String(mediaMsg.media_url).split('#')[0];
                    openChatMediaViewer(url, t, isOnce);   // ← isOnce = true hanya untuk view-once
                    return;
                }
            }
            // Voice note: jangan buka menu. Play hanya via tombol [data-audio-play] (handler sendiri).
            if (e.target.closest('.msg-audio')) {
                // Kalau klik di luar tombol play (avatar/wave), treat as play toggle sekali
                if (!e.target.closest('[data-audio-play]')) {
                    const playBtn = msgEl.querySelector('[data-audio-play]');
                    if (playBtn) onAudioPlayClick({ target: playBtn, preventDefault() {}, stopPropagation() {} });
                }
                return;
            }
            // Tap singkat: menu hanya pesan sendiri
            if (!msgEl.classList.contains('me')) return;
            const id = msgEl.dataset.id;
            if (!id || String(id).startsWith('tmp-')) return;
            openMessageMenu(id);
        });
        msgsEl.addEventListener('contextmenu', e => {
            const m = e.target.closest('.msg');
            if (!m) return;
            e.preventDefault();
            const id = m.dataset.id;
            if (id && !String(id).startsWith('tmp-')) openMessageMenu(id);
        });
        // Swipe-to-reply ala WhatsApp (tarik pesan — semua tipe termasuk stiker)
        bindSwipeToReply(msgsEl, (msgId) => {
            const m = state.messages.find(x => String(x.id) === String(msgId));
            if (!m || String(m.id).startsWith('tmp-')) return;
            const mine = String(m.sender_id) === String(state.me.id);
            // Nama asli untuk disimpan di quote (jangan "Anda" — biar user lain lihat nama benar)
            m._replySenderName = mine
                ? (state.me?.display_name || state.me?.username || 'Pengguna')
                : (state.currentOtherUser?.display_name || state.currentOtherUser?.username || 'Pesan');
            setReplyTo(m);
        });
        document.getElementById('chat-reply-close')?.addEventListener('click', clearReplyTo);
    }

    let replyToMsg = null;
    function setReplyTo(m) {
        replyToMsg = m;
        window.__activeReplyMsg = m;
        window.__activeReplyIsGroup = false;
        const bar = document.getElementById('chat-reply-bar');
        if (!bar) return;
        const nameEl = document.getElementById('chat-reply-name');
        const textEl = document.getElementById('chat-reply-text');
        const thumbEl = document.getElementById('chat-reply-thumb');
        const isMe = String(m.sender_id) === String(state.me.id);
        nameEl.textContent = isMe ? (state.me?.display_name || state.me?.username || 'Anda') : (state.currentOtherUser?.display_name || state.currentOtherUser?.username || 'Pesan');
        textEl.textContent = replyPreviewText(m);
        const mt = m.message_type || 'text';
        // Preview: foto/video/stiker (bukan view-once)
        if ((mt === 'image' || mt === 'video' || mt === 'sticker') && m.media_url) {
            const src = String(m.media_url);
            if (mt === 'sticker' && src.startsWith('emoji:')) {
                thumbEl.innerHTML = `<span style="font-size:28px;line-height:42px;display:block;text-align:center">${escapeHtml(src.slice(6))}</span>`;
            } else {
                const url = src.split('#')[0];
                const isVid = mt === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(url);
                thumbEl.innerHTML = isVid
                    ? `<video src="${url}${mt==='video'?'#t=0.1':''}" muted ${mt==='sticker'?'autoplay loop':''} playsinline preload="metadata"></video>`
                    : `<img src="${url}" alt="" />`;
            }
            thumbEl.classList.remove('hidden');
        } else {
            thumbEl.innerHTML = '';
            thumbEl.classList.add('hidden');
        }
        bar.classList.add('visible');
        input?.focus();
    }
    function clearReplyTo() {
        replyToMsg = null;
        window.__activeReplyMsg = null;
        window.__chatReplySticker = null;
        document.getElementById('chat-reply-bar')?.classList.remove('visible');
    }

    function openMessageMenu(msgId) {
        const m = state.messages.find(x => String(x.id) === String(msgId));
        if (!m) return;
        const mine = m.sender_id === state.me.id;

        const backdrop = document.createElement('div');
        backdrop.className = 'action-sheet-backdrop';
        const sheet = document.createElement('div');
        sheet.className = 'action-sheet';
        const canCopy = (m.message_type || 'text') === 'text' && (m.content || '').trim();
        const canForward = !!(m.media_url || (m.message_type || 'text') === 'text' || (m.message_type || '') === 'sticker');
        sheet.innerHTML = `
            <div class="handle"></div>
            <div class="as-title">${mine ? 'Pesan kamu' : 'Pesan dari ' + escapeHtml(state.currentOtherUser?.display_name || '')}</div>
            <button class="as-btn" data-act="reply"><svg class="icon icon-sm"><use href="#i-back"/></svg> Balas</button>
            ${canForward ? `<button class="as-btn" data-act="forward"><svg class="icon icon-sm"><use href="#i-share"/></svg> Teruskan</button>` : ''}
            ${canCopy ? `<button class="as-btn" data-act="copy"><svg class="icon icon-sm"><use href="#i-check"/></svg> Salin teks</button>` : ''}
            ${m.media_url && !String(m.message_type||'').includes('once') ? `<button class="as-btn" data-act="open"><svg class="icon icon-sm"><use href="#i-download"/></svg> Buka media</button>` : ''}
            ${mine ? `<button class="as-btn danger" data-act="delete"><svg class="icon icon-sm"><use href="#i-trash"/></svg> Hapus pesan</button>` : ''}
        `;
        document.body.appendChild(backdrop);
        document.body.appendChild(sheet);

        const closeSheet = () => {
            sheet.classList.add('closing');
            backdrop.style.animation = 'fadeOut .2s ease forwards';
            setTimeout(() => { sheet.remove(); backdrop.remove(); }, 210);
        };
        backdrop.onclick = closeSheet;
        sheet.onclick = async (e) => {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;
            if (act === 'reply') {
                closeSheet();
                m._replySenderName = mine
                    ? (state.me?.display_name || state.me?.username || 'Pengguna')
                    : (state.currentOtherUser?.display_name || state.currentOtherUser?.username || 'Pesan');
                setReplyTo(m);
                return;
            }
            if (act === 'forward') {
                closeSheet();
                openForwardPicker(m);
                return;
            }
            if (act === 'copy') {
                closeSheet();
                try {
                    await navigator.clipboard.writeText(String(m.content || ''));
                    showToast('Teks disalin');
                } catch (_) {
                    showToast('Gagal salin');
                }
                return;
            }
            if (act === 'open') { window.open(m.media_url, '_blank'); return closeSheet(); }
            if (act === 'delete') {
                closeSheet();
                try {
                    await API.del('/api/chat/messages/' + m.id);
                    state.messages = state.messages.filter(x => String(x.id) !== String(m.id));
                    const el = msgsEl.querySelector(`.msg[data-id="${m.id}"]`);
                    if (el) { el.style.transition = 'opacity .2s, transform .2s'; el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; setTimeout(() => el.remove(), 200); }
                    loadConversations();
                    showToast('Pesan dihapus.');
                } catch (err) { showToast(err.message || 'Gagal hapus.'); }
            }
        };
    }

    
    async function openForwardPicker(m) {
        const backdrop = document.createElement('div');
        backdrop.className = 'action-sheet-backdrop';
        const sheet = document.createElement('div');
        sheet.className = 'action-sheet';
        sheet.style.maxHeight = '70vh';
        sheet.innerHTML = `<div class="handle"></div><div class="as-title">Teruskan ke...</div><div id="fwd-list" style="overflow:auto;max-height:50vh;padding:4px 0"><div class="muted small" style="padding:12px">Memuat...</div></div>`;
        document.body.appendChild(backdrop);
        document.body.appendChild(sheet);
        const close = () => { sheet.classList.add('closing'); backdrop.style.animation = 'fadeOut .2s ease forwards'; setTimeout(() => { sheet.remove(); backdrop.remove(); }, 210); };
        backdrop.onclick = close;

        let chats = state.chatList || [];
        let groups = (state.groups || []);
        try {
            if (!chats.length) {
                const { data } = await API.get('/api/chat/conversations');
                chats = data || [];
                state.chatList = chats;
            }
            if (!groups.length && typeof GroupModule !== 'undefined') {
                await GroupModule.loadGroups();
                groups = state.groups || [];
            }
        } catch (_) {}

        const list = document.getElementById('fwd-list');
        let html = '';
        if (chats.length) {
            html += `<div class="muted small" style="padding:8px 16px 4px">Chat</div>`;
            chats.forEach(c => {
                const name = escapeHtml(c.other_user?.display_name || c.other_user?.username || 'Chat');
                const id = c.id || c.conversation_id;
                html += `<button class="as-btn" data-fwd-type="chat" data-fwd-id="${escapeHtml(String(id))}" style="justify-content:flex-start">${name}</button>`;
            });
        }
        if (groups.length) {
            html += `<div class="muted small" style="padding:8px 16px 4px">Grup</div>`;
            groups.forEach(g => {
                html += `<button class="as-btn" data-fwd-type="group" data-fwd-id="${escapeHtml(String(g.id))}" style="justify-content:flex-start">${escapeHtml(g.name || 'Grup')}</button>`;
            });
        }
        if (!html) html = `<div class="muted small" style="padding:12px">Tidak ada chat/grup.</div>`;
        list.innerHTML = html;

        list.querySelectorAll('button[data-fwd-id]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const type = btn.dataset.fwdType;
                const id = btn.dataset.fwdId;
                close();
                try {
                    const mt = m.message_type || 'text';
                    const body = {
                        message_type: mt,
                        content: m.content || '',
                        media_url: m.media_url || null
                    };
                    // View-once tetap view-once saat diteruskan
                    if (type === 'chat') {
                        await API.post(`/api/chat/conversations/${id}/messages`, body);
                        showToast('Diteruskan ke chat');
                    } else {
                        await API.post(`/api/groups/${id}/messages`, body);
                        showToast('Diteruskan ke grup');
                    }
                } catch (e) {
                    showToast(e.message || 'Gagal teruskan');
                }
            });
        });
    }

function autoGrow() { if (!input) return; input.style.height = ''; input.style.height = '42px'; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    async function loadConversations(skipRender) {
        if (!(state.chatList && state.chatList.length)) hydrateChatsFromCache();
        try {
            const { data } = await API.get('/api/chat/conversations');
            state.chatList = data || [];
            saveChatsCache();
            if (!skipRender) {
                const q = (document.getElementById('search-input')?.value || '').trim();
                if (q) filterChatListByQuery(q);
                else renderConversations();
            }
        } catch (e) {
            if (!(state.chatList && state.chatList.length)) showToast(e.message);
            else if (!skipRender) renderConversations();
        }
    }

    let _chatListFirstPaint = true;
    function renderConversations() {
        const totalUnread = state.chatList.reduce((sum, c) => sum + (c.unread_count || 0), 0);
        updateNavBadge('nav-badge-chat', totalUnread);
        if (!state.chatList.length) {
            list.innerHTML = `<div class="empty"><p>Belum ada percakapan.</p><p class="muted small">Cari pengguna untuk memulai chat.</p></div>`;
            return;
        }
        const anim = _chatListFirstPaint ? ' anim-enter' : '';
        _chatListFirstPaint = false;
        list.innerHTML = state.chatList.map((c, i) => {
            const u = c.other_user || {};
            const badge = c.unread_count ? `<span class="badge">${c.unread_count}</span>` : '';
            const delay = anim ? `style="animation-delay:${0.03 + i * 0.05}s"` : '';
            return `<div class="chat-item${anim}" data-id="${c.id}" ${delay}>${avatarHTML(u)}<div class="body"><div class="row1"><div class="name">${escapeHtml(u.display_name || u.username || '—')}${badge}</div><div class="time">${c.last_message_at ? timeShort(c.last_message_at) : ''}</div></div><div class="preview">${escapeHtml(c.last_message_preview || 'Mulai percakapan')}</div></div></div>`;
        }).join('');
        list.querySelectorAll('.chat-item').forEach(el => { el.addEventListener('click', () => openConv(el.dataset.id)); });
    }

    async function openConv(convId) {
        const conv = state.chatList.find(c => c.id === convId);
        if (!conv) return;
        state.currentConversation = { id: convId };
        state.currentOtherUser = conv.other_user;
        document.getElementById('conv-name').textContent = conv.other_user?.display_name || conv.other_user?.username || '—';
        document.getElementById('conv-status').textContent = presenceLabel(conv.other_user);
        const av = document.getElementById('conv-avatar');
        const u = conv.other_user || {};
        if (u.avatar_url) av.outerHTML = `<img id="conv-avatar" class="avatar sm" src="${u.avatar_url}" alt="" />`;
        else av.outerHTML = `<span id="conv-avatar" class="avatar sm">${initials(u.display_name || u.username)}</span>`;
        document.getElementById('view-chat').classList.remove('active');
        document.getElementById('view-conv').classList.add('active');
        document.getElementById('bottom-nav').classList.add('hidden');
        const msgCacheKey = 'pretv_msgs_' + convId;
        // Cache dulu — bersihkan flag uploading biar tidak glitch
        let showedCache = false;
        try {
            const cached = JSON.parse(localStorage.getItem(msgCacheKey) || 'null');
            if (Array.isArray(cached) && cached.length) {
                state.messages = cached
                    .filter(m => m && m.id && !String(m.id).startsWith('tmp-'))
                    .map(m => { const x = Object.assign({}, m); delete x.uploading; return applyReplyParse(x); });
                renderMessages();
                scrollToBottom(false);
                showedCache = true;
            } else {
                msgsEl.innerHTML = '';
            }
        } catch (_) { msgsEl.innerHTML = ''; }
        try {
            const { data } = await API.get(`/api/chat/conversations/${convId}/messages?limit=40`);
            const fresh = (data || []).map(m => { const x = Object.assign({}, m); delete x.uploading; return applyReplyParse(x); });
            // Re-render HANYA jika daftar pesan berubah (hindari glitch foto)
            const oldIds = (state.messages || []).map(m => String(m.id)).join(',');
            const newIds = fresh.map(m => String(m.id)).join(',');
            state.messages = fresh;
            try { localStorage.setItem(msgCacheKey, JSON.stringify(fresh.slice(-60))); } catch (_) {}
            if (oldIds !== newIds || !showedCache) {
                renderMessages();
            }
            scrollToBottom(false);
            setTimeout(() => scrollToBottom(false), 120);
            API.post(`/api/chat/conversations/${convId}/read`, {}).catch(() => { });
            const c = state.chatList.find(x => x.id === convId);
            if (c) { c.unread_count = 0; renderConversations(); }
        } catch (e) {
            if (!(state.messages && state.messages.length)) showToast(e.message);
        }
    }

    function closeConv() {
        const convEl = document.getElementById('view-conv');
        const finish = () => {
            if (convEl) {
                convEl.classList.remove('active');
                convEl.style.animation = '';
            }
            document.getElementById('view-chat').classList.add('active');
            document.getElementById('bottom-nav').classList.remove('hidden');
        };
        if (convEl && convEl.classList.contains('active')) {
            convEl.style.animation = 'slideToRight .2s ease forwards';
            setTimeout(finish, 190);
        } else {
            finish();
        }
        state.currentConversation = null;
        state.currentOtherUser = null;
        typingBar.classList.add('hidden');
        // jangan full re-render agresif — cukup soft refresh
        setTimeout(() => loadConversations(), 220);
    }

    function renderMessages() {
        msgsEl.innerHTML = state.messages.map(renderMessage).join('');
        bindAudioMeta(msgsEl);
    }

    function isViewOnceType(t) { return t === 'image_once' || t === 'video_once'; }
    function viewOnceKey(id) { return 'pretv_viewonce_' + id; }
    function hasViewedOnce(id) {
        try { return localStorage.getItem(viewOnceKey(id)) === '1'; } catch (_) { return false; }
    }
    function markViewedOnce(id) {
        try { localStorage.setItem(viewOnceKey(id), '1'); } catch (_) {}
    }
    function formatBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' kB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function waveBars() {
        return Array.from({ length: 28 }, () => '<span></span>').join('');
    }
    function avatarHtmlForMsg(m, me) {
        const u = me ? state.me : state.currentOtherUser;
        const url = u && u.avatar_url;
        const name = (u && (u.display_name || u.username)) || '?';
        if (url) return `<img src="${url}" alt="" />`;
        const parts = String(name).trim().split(/\s+/).filter(Boolean);
        const ini = ((parts[0]||'?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
        return ini;
    }
    function renderViewOnceBubble(m, me, baseType, uploading) {
        const label = baseType === 'video' ? 'Video' : 'Foto';
        const opened = !me && hasViewedOnce(m.id);
        if (opened) {
            return `<div class="vo-bubble vo-opened" data-view-once="1" data-media-type="${baseType}">
                <div class="vo-ico"><svg class="icon"><use href="#i-view-once"/></svg></div>
                <div class="vo-body"><div class="vo-title">${label} telah dilihat</div><div class="vo-sub">Sekali lihat</div></div>
            </div>`;
        }
        const sizeHint = m._size ? formatBytes(m._size) : (uploading ? 'Mengirim...' : 'Ketuk untuk membuka');
        const sub = me
            ? (uploading ? 'Mengirim...' : 'Sekali lihat · bisa dibuka berkali-kali')
            : sizeHint;
        return `<div class="vo-bubble media-wrap" data-view-once="1" data-media-type="${baseType}" data-id="${m.id}">
            <div class="vo-ico">
                <svg class="icon"><use href="#i-view-once"/></svg>
                <span class="vo-1">1</span>
            </div>
            <div class="vo-body"><div class="vo-title">${label}</div><div class="vo-sub">${sub}</div></div>
        </div>`;
    }
    function renderAudioBubble(m, me) {
        return `<div class="msg-audio" data-audio-id="${m.id}">
            <div class="audio-av">${avatarHtmlForMsg(m, me)}<span class="mic-badge"><svg class="icon" style="width:9px;height:9px"><use href="#i-mic"/></svg></span></div>
            <div class="audio-main">
                <div class="audio-row">
                    <button type="button" class="audio-play" data-audio-play="${m.id}" aria-label="Putar"><svg class="icon"><use href="#i-play"/></svg></button>
                    <div class="audio-wave" id="aw-${m.id}">${waveBars()}</div>
                </div>
                <div class="audio-meta"><span class="audio-dur" id="adur-${m.id}">0:00</span></div>
            </div>
            <audio preload="none" src="${m.media_url}" data-src="${m.media_url}" id="audio-${m.id}"></audio>
        </div>`;
    }

    function renderMessage(m) {
        m = applyReplyParse(Object.assign({}, m));
        const me = m.sender_id === state.me.id;
        const cls = me ? 'me' : 'other';
        let inner = '';
        const uploading = !!m.uploading;
        const mt = m.message_type || 'text';
        const isOnce = isViewOnceType(mt);
        const baseType = mt === 'image_once' ? 'image' : mt === 'video_once' ? 'video' : mt;
        // Quote reply dulu (di atas konten)
        if (m.reply_to_id) inner += renderReplyQuoteHtml(m);
        /* View-once: NEVER show real thumbnail in bubble (WA style) */
        if (isOnce && m.media_url) {
            inner += renderViewOnceBubble(m, me, baseType, uploading);
        } else if (mt === 'image' && m.media_url) {
            inner += `<div class="media-wrap ${uploading ? 'media-uploading' : ''}" data-media-type="image">` +
                `<img src="${m.media_url}" alt="Foto" loading="lazy" />` +
                (uploading ? `<div class="media-upload-status"><span class="media-upload-spinner"></span><span>Sedang mengirim...</span></div>` : '') +
                `</div>`;
        } else if (mt === 'video' && m.media_url) {
            inner += `<div class="media-wrap ${uploading ? 'media-uploading' : ''}" data-media-type="video">` +
                (uploading ? '' : `<div class="media-video-loading"><div class="spin-ring"></div></div>`) +
                `<video class="${uploading ? '' : 'is-loading'}" src="${m.media_url}#t=0.1" muted playsinline preload="metadata" disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" onloadeddata="this.classList.remove('is-loading');this.classList.add('is-ready');this.style.opacity=1;var l=this.parentNode.querySelector('.media-video-loading');if(l)l.remove();"></video>` +
                (uploading ? '' : `<div class="video-play-badge"><i class="fa-solid fa-play"></i></div>`) +
                (uploading ? `<div class="media-upload-status"><span class="media-upload-spinner"></span><span>Sedang mengirim...</span></div>` : '') +
                `</div>`;
        } else if (mt === 'audio' && m.media_url) {
            inner += renderAudioBubble(m, me);
        } else if (mt === 'sticker') {
            inner += renderStickerInner(m);
        }
        if (m.reply_status_id) {
            const isMediaStatus = (m.reply_status_type === 'image' || m.reply_status_type === 'video') && m.reply_status_media_url;
            const thumb = isMediaStatus
                ? (m.reply_status_type === 'video'
                    ? `<video src="${m.reply_status_media_url}#t=0.1" muted playsinline preload="metadata"></video>`
                    : `<img src="${m.reply_status_media_url}" alt="" />`)
                : '';
            inner += `<div class="msg-quote-status">
                ${thumb ? `<div class="mqs-thumb">${thumb}</div>` : ''}
                <div class="mqs-body">
                    <div class="mqs-label"><i class="fa-solid fa-circle-play"></i> ${me ? escapeHtml(state.me?.display_name || state.me?.username || 'Anda') : escapeHtml(state.currentOtherUser?.display_name || 'Dia')} &bull; Status</div>
                    <div class="mqs-text">${isMediaStatus ? (m.reply_status_type === 'video' ? 'Video' : 'Foto') : escapeHtml((m.reply_status_content || '').slice(0, 60) || 'Status')}</div>
                </div>
            </div>`;
        }
        if (m.content && mt !== 'sticker') inner += `<div>${linkifyText(m.content)}</div>`;
        let tick = '';
        if (me) tick = m.read_at
            ? `<span class="tick read" title="Dibaca"><svg class="icon"><use href="#i-check-check"/></svg></span>`
            : `<span class="tick sent" title="Terkirim"><svg class="icon"><use href="#i-check"/></svg></span>`;
        const statusText = uploading ? `<span class="uploading-text">Mengirim...</span>` : '';
        const stickerCls = (mt === 'sticker') ? (' sticker-msg' + (m.reply_to_id ? ' sticker-with-reply' : '')) : '';
        return `<div class="msg ${cls}${stickerCls} ${uploading ? 'is-uploading' : ''}" data-id="${m.id}">${inner}<div class="meta"><span>${uploading ? '' : timeShort(m.created_at)}</span>${statusText}${tick}</div></div>`;
    }

    function replaceTempMessage(tempId, message) {
        const existingIdx = state.messages.findIndex(m => String(m.id) === String(message.id));
        const tempIdx = state.messages.findIndex(m => String(m.id) === String(tempId));
        if (existingIdx >= 0 && tempIdx >= 0 && existingIdx !== tempIdx) {
            // Realtime sudah memasukkan pesan asli — buang optimistic saja
            state.messages.splice(tempIdx, 1);
            const el = msgsEl.querySelector(`.msg[data-id="${tempId}"]`);
            if (el) el.remove();
            return;
        }
        if (tempIdx >= 0) {
            state.messages[tempIdx] = message;
            const el = msgsEl.querySelector(`.msg[data-id="${tempId}"]`);
            if (el) {
                const wrap = document.createElement('div');
                wrap.innerHTML = renderMessage(message);
                el.replaceWith(wrap.firstChild);
            } else {
                msgsEl.insertAdjacentHTML('beforeend', renderMessage(message));
            }
        } else if (existingIdx < 0) {
            state.messages.push(message);
            msgsEl.insertAdjacentHTML('beforeend', renderMessage(message));
        }
        // Soft-update preview di daftar chat tanpa re-render isi pesan
        const c = state.chatList.find(x => String(x.id) === String(message.conversation_id));
        if (c) {
            c.last_message_at = message.created_at;
            c.last_message_preview = message.content || (message.message_type === 'image' ? 'Foto' : message.message_type === 'video' ? 'Video' : message.message_type === 'sticker' ? 'Stiker' : message.message_type === 'audio' ? 'Pesan suara' : '');
            c.last_sender_id = message.sender_id;
        }
    }

    async function onSendText(e) {
        if (e) e.preventDefault();
        const text = input.value.trim();
        if (!text || !state.currentConversation) return;
        const tempId = 'tmp-' + Date.now();
        // Support reply dari stiker action sheet
        if (!replyToMsg && window.__chatReplySticker) {
            replyToMsg = window.__chatReplySticker;
            window.__chatReplySticker = null;
        }
        const replyPayload = buildReplyPayload(replyToMsg, state.me.id);
        const optimistic = { id: tempId, conversation_id: state.currentConversation.id, sender_id: state.me.id, message_type: 'text', content: text, created_at: new Date().toISOString(), ...replyPayload };
        state.messages.push(optimistic);
        msgsEl.insertAdjacentHTML('beforeend', renderMessage(optimistic));
        scrollToBottom(true);
        input.value = ''; autoGrow(); updateComposerMode();
        clearReplyTo();
        window.__chatReplySticker = null;
        try {
            const { message } = await API.post(`/api/chat/conversations/${state.currentConversation.id}/messages`, { message_type: 'text', content: text, ...replyPayload });
            replaceTempMessage(tempId, applyReplyParse({ ...message, ...replyPayload }));
            scrollToBottom(true);
        } catch (e) {
            showToast('Gagal mengirim pesan.');
            const idx = state.messages.findIndex(m => m.id === tempId);
            if (idx >= 0) state.messages.splice(idx, 1);
            const el = msgsEl.querySelector(`.msg[data-id="${tempId}"]`);
            if (el) el.remove();
        }
    }

    function updateComposerMode() {
        const hasText = !!(input && input.value.trim());
        const sendEl = document.getElementById('send-btn');
        const micEl = document.getElementById('mic-btn');
        if (sendEl) sendEl.classList.toggle('hidden', !hasText);
        if (micEl) micEl.classList.toggle('hidden', hasText);
    }

    // Cache sementara voice yang sudah diputar (hidup selama app terbuka)
    if (!window.__voiceCache) window.__voiceCache = new Map();
    const voiceCache = window.__voiceCache; // media_url -> blob:URL
    let activeVoiceId = null;

    function formatAudioDur(s) {
        const n = Number(s);
        if (!isFinite(n) || n < 0) return '0:00';
        const sec = Math.floor(n);
        return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }
    function bindAudioMeta(root) { /* on-demand */ }

    function setPlayIcon(btn, mode) {
        if (!btn) return;
        if (mode === 'loading') {
            btn.innerHTML = '<svg class="icon spin"><use href="#i-upload"/></svg>';
            btn.dataset.state = 'loading';
        } else if (mode === 'pause') {
            btn.innerHTML = '<svg class="icon"><use href="#i-pause"/></svg>';
            btn.dataset.state = 'playing';
        } else {
            btn.innerHTML = '<svg class="icon"><use href="#i-play"/></svg>';
            btn.dataset.state = 'idle';
        }
    }

    function resetVoiceUi(id, root) {
        root = root || document;
        const btn = root.querySelector('[data-audio-play="' + id + '"]');
        const wave = document.getElementById('aw-' + id);
        const durEl = document.getElementById('adur-' + id);
        const audio = document.getElementById('audio-' + id);
        setPlayIcon(btn, 'play');
        if (wave) wave.classList.remove('playing');
        if (durEl && audio && isFinite(audio.duration) && audio.duration > 0)
            durEl.textContent = formatAudioDur(audio.duration);
        else if (durEl && !durEl.textContent) durEl.textContent = '0:00';
    }

    function pauseAllVoices(exceptId, root) {
        root = root || document;
        root.querySelectorAll('audio[id^="audio-"]').forEach(a => {
            const oid = a.id.replace('audio-', '');
            if (exceptId && oid === String(exceptId)) return;
            try { a.pause(); } catch (_) {}
            resetVoiceUi(oid, root);
        });
        if (!exceptId) activeVoiceId = null;
    }

    async function resolveVoiceSrc(audio) {
        const original = audio.getAttribute('data-src') || audio.getAttribute('src') || '';
        if (!original || original.startsWith('blob:')) return original;
        if (voiceCache.has(original)) return voiceCache.get(original);
        // Fetch sekali, simpan blob sementara di memori
        const res = await fetch(original, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        voiceCache.set(original, blobUrl);
        // Batasi cache max 20 file — revoke yang lama
        if (voiceCache.size > 20) {
            const first = voiceCache.keys().next().value;
            const old = voiceCache.get(first);
            voiceCache.delete(first);
            try { URL.revokeObjectURL(old); } catch (_) {}
        }
        return blobUrl;
    }

    function ensureAudioBound(audio, btn, wave, durEl) {
        if (audio._bound) return;
        audio._bound = true;
        if (!audio.getAttribute('data-src') && audio.src) {
            audio.setAttribute('data-src', audio.getAttribute('src') || audio.src);
        }
        audio.addEventListener('loadedmetadata', () => {
            if (durEl && isFinite(audio.duration) && audio.duration > 0)
                durEl.textContent = formatAudioDur(audio.duration);
        });
        audio.addEventListener('timeupdate', () => {
            if (!durEl) return;
            if (!audio.paused && isFinite(audio.currentTime))
                durEl.textContent = formatAudioDur(audio.currentTime);
        });
        audio.addEventListener('ended', () => {
            setPlayIcon(btn, 'play');
            if (wave) wave.classList.remove('playing');
            if (durEl && isFinite(audio.duration)) durEl.textContent = formatAudioDur(audio.duration);
            if (activeVoiceId === audio.id.replace('audio-', '')) activeVoiceId = null;
        });
        audio.addEventListener('error', () => {
            setPlayIcon(btn, 'play');
            if (wave) wave.classList.remove('playing');
        });
    }

    async function playVoiceNote(audio, btn, wave, durEl) {
        const id = audio.id.replace('audio-', '');
        const root = audio.closest('.messages') || document;
        ensureAudioBound(audio, btn, wave, durEl);

        // Pause jika sedang berputar (sumber kebenaran: audio.paused)
        if (!audio.paused) {
            try { audio.pause(); } catch (_) {}
            setPlayIcon(btn, 'play');
            if (wave) wave.classList.remove('playing');
            if (durEl && isFinite(audio.duration) && audio.duration > 0)
                durEl.textContent = formatAudioDur(audio.duration);
            activeVoiceId = null;
            return;
        }
        // Juga jika UI bilang playing tapi audio sudah pause (edge)
        if (btn && btn.dataset.state === 'playing') {
            setPlayIcon(btn, 'play');
            if (wave) wave.classList.remove('playing');
            activeVoiceId = null;
            // lanjut play dari posisi terakhir di bawah
        }

        pauseAllVoices(id, root);
        setPlayIcon(btn, 'loading');

        try {
            // Pakai cache blob jika sudah pernah diputar
            const src = await resolveVoiceSrc(audio);
            if (audio.src !== src) {
                audio.src = src;
                audio.preload = 'auto';
            }
            // Tunggu siap jika belum
            if (audio.readyState < 2) {
                await new Promise((resolve, reject) => {
                    const ok = () => { cleanup(); resolve(); };
                    const err = () => { cleanup(); reject(new Error('load')); };
                    const cleanup = () => {
                        audio.removeEventListener('canplay', ok);
                        audio.removeEventListener('loadeddata', ok);
                        audio.removeEventListener('error', err);
                    };
                    audio.addEventListener('canplay', ok);
                    audio.addEventListener('loadeddata', ok);
                    audio.addEventListener('error', err);
                    try { audio.load(); } catch (_) {}
                    setTimeout(() => { cleanup(); resolve(); }, 10000);
                });
            }
            await audio.play();
            activeVoiceId = id;
            setPlayIcon(btn, 'pause');
            if (wave) wave.classList.add('playing');
            if (durEl && isFinite(audio.duration) && audio.duration > 0)
                durEl.textContent = formatAudioDur(audio.duration);
        } catch (err) {
            setPlayIcon(btn, 'play');
            if (wave) wave.classList.remove('playing');
            activeVoiceId = null;
            showToast('Gagal memutar suara');
        }
    }

    function onAudioPlayClick(e) {
        const btn = e.target.closest('[data-audio-play]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (btn.dataset.state === 'loading') return; // cegah double-tap saat loading
        const id = btn.dataset.audioPlay;
        const audio = document.getElementById('audio-' + id);
        if (!audio) return;
        const wave = document.getElementById('aw-' + id);
        const durEl = document.getElementById('adur-' + id);
        playVoiceNote(audio, btn, wave, durEl);
    }

    /* ---- Voice record ---- */
    let mediaRecorder = null, recChunks = [], recTimer = null, recStart = 0, recStream = null;

    async function startVoiceRecord() {
    if (!state.currentConversation) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Perangkat tidak mendukung rekaman suara.');
        return;
    }

    // 🎤 Minta izin mic via bridge (muncul hanya saat tap mic)
    if (typeof AndroidMic !== 'undefined' && AndroidMic && AndroidMic.hasMicPermission) {
        const has = AndroidMic.hasMicPermission();
        if (!has) {
            AndroidMic.requestMic();
            showToast('Izinkan akses mikrofon, lalu coba lagi.', 3000);
            return; // user harus tap lagi setelah kasih izin
        }
    }

    try {
        recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // ... dst
            recChunks = [];
            const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
                : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
            mediaRecorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
            mediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) recChunks.push(ev.data); };
            mediaRecorder.start(200);
            recStart = Date.now();
            composer.classList.add('recording');
            const micEl = document.getElementById('mic-btn');
            if (micEl) micEl.classList.add('recording');
            const timeEl = document.getElementById('rec-time');
            if (timeEl) timeEl.textContent = '0:00';
            clearInterval(recTimer);
            recTimer = setInterval(() => {
                const s = Math.floor((Date.now() - recStart) / 1000);
                if (timeEl) timeEl.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
                if (s >= 120) sendVoiceRecord();
            }, 250);
        } catch (err) {
            showToast('Izin mikrofon ditolak atau tidak tersedia.');
        }
    }

    function stopRecTracks() {
        try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch (_) {}
        mediaRecorder = null;
        if (recStream) { recStream.getTracks().forEach(t => t.stop()); recStream = null; }
        clearInterval(recTimer); recTimer = null;
        composer.classList.remove('recording');
        const micEl = document.getElementById('mic-btn');
        if (micEl) micEl.classList.remove('recording');
    }

    function cancelVoiceRecord() {
        recChunks = [];
        stopRecTracks();
        updateComposerMode();
    }

    async function sendVoiceRecord() {
        if (!state.currentConversation) { cancelVoiceRecord(); return; }
        const chunks = recChunks.slice();
        const mimeType = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
        stopRecTracks();
        if (!chunks.length) { showToast('Rekaman kosong.'); updateComposerMode(); return; }
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 200) { showToast('Rekaman terlalu pendek.'); updateComposerMode(); return; }
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], 'voice-' + Date.now() + '.' + ext, { type: mimeType });
        const tempId = 'tmp-audio-' + Date.now();
        const tempUrl = URL.createObjectURL(blob);
        // Support reply (quote) saat kirim pesan suara — seperti WhatsApp
        if (!replyToMsg && window.__chatReplySticker) {
            replyToMsg = window.__chatReplySticker;
            window.__chatReplySticker = null;
        }
        const replyPayload = buildReplyPayload(replyToMsg, state.me.id);
        const optimistic = {
            id: tempId, conversation_id: state.currentConversation.id, sender_id: state.me.id,
            message_type: 'audio', media_url: tempUrl, content: '', created_at: new Date().toISOString(), uploading: true,
            ...replyPayload
        };
        state.messages.push(optimistic);
        msgsEl.insertAdjacentHTML('beforeend', renderMessage(optimistic));
        scrollToBottom(true);
        clearReplyTo();
        window.__chatReplySticker = null;
        try {
            const fd = new FormData();
            fd.append('file', file);
            const { url } = await API.upload('/api/chat/upload/chat', fd);
            const { message } = await API.post(`/api/chat/conversations/${state.currentConversation.id}/messages`, {
                message_type: 'audio', media_url: url, content: '', ...replyPayload
            });
            URL.revokeObjectURL(tempUrl);
            replaceTempMessage(tempId, applyReplyParse({ ...message, ...replyPayload }));
            scrollToBottom(true);
        } catch (e) {
            URL.revokeObjectURL(tempUrl);
            const at = state.messages.findIndex(m => m.id === tempId);
            if (at >= 0) state.messages.splice(at, 1);
            const el = msgsEl.querySelector(`.msg[data-id="${tempId}"]`);
            if (el) el.remove();
            showToast(e.message || 'Gagal kirim suara.');
        }
        updateComposerMode();
    }

    /* ---- Media pick + view-once compose sheet ---- */
    let pendingMedia = null; // { file, type, url, viewOnce }

    async function onPickMedia(e) {
        const file0 = e.target.files?.[0];
        if (!file0 || !state.currentConversation) return;
        try { e.target.value = ''; } catch (_) {}
        if (fileInput) fileInput.value = '';
        if (!/^image\/(.+)|^video\/(.+)/i.test(file0.type)) { showToast('File harus foto atau video.'); return; }
        let file = file0;
        // Video besar: kompres dulu (boleh sampai ~200MB mentah → target ~18MB)
        if (file.type.startsWith('video/')) {
            if (file.size > 200 * 1024 * 1024) { showToast('Video terlalu besar (maks ~200 MB).'); return; }
            try {
                if (typeof window.compressVideoIfNeeded === 'function') {
                    file = await window.compressVideoIfNeeded(file, 18 * 1024 * 1024);
                } else if (file.size > 25 * 1024 * 1024) {
                    showToast('Video terlalu besar (maks 25 MB).'); return;
                }
            } catch (err) {
                showToast(err.message || 'Gagal kompres video'); return;
            }
        } else if (file.size > 20 * 1024 * 1024) {
            showToast('Foto terlalu besar (maks 20 MB).'); return;
        }
        const type = file.type.startsWith('video') ? 'video' : 'image';
        const url = URL.createObjectURL(file);
        pendingMedia = { file, type, url, viewOnce: false };
        openMediaComposeSheet();
    }

    function openMediaComposeSheet() {
        if (!pendingMedia) return;
        let sheet = document.getElementById('media-compose-sheet');
        if (sheet) sheet.remove();
        sheet = document.createElement('div');
        sheet.id = 'media-compose-sheet';
        sheet.className = 'media-compose';

// 🎨 Status bar hitam
setDarkStatusBar(true);
        const isVid = pendingMedia.type === 'video';
        sheet.innerHTML = `
            <div class="mc-top">
                <button type="button" class="mc-btn" data-mc="close" aria-label="Tutup"><svg class="icon"><use href="#i-close"/></svg></button>
                <div class="mc-spacer"></div>
                <button type="button" class="mc-btn" data-mc="once" aria-label="Sekali lihat" title="Sekali lihat"><svg class="icon"><use href="#i-view-once"/></svg></button>
            </div>
            <div class="mc-once-hint ${pendingMedia.viewOnce ? '' : 'hidden'}" id="mc-once-hint">Sekali lihat aktif — penerima hanya bisa buka 1 kali</div>
            <div class="mc-preview" id="mc-preview">
                ${isVid
                    ? `<video src="${pendingMedia.url}" controls playsinline></video>`
                    : `<img src="${pendingMedia.url}" alt="" />`}
            </div>
            <div class="mc-bottom">
                <input type="text" class="mc-caption" id="mc-caption" placeholder="Tambah keterangan..." maxlength="500" />
                <button type="button" class="mc-send" data-mc="send" aria-label="Kirim"><svg class="icon"><use href="#i-send"/></svg></button>
            </div>`;
        document.body.appendChild(sheet);
        const onceBtn = sheet.querySelector('[data-mc="once"]');
        if (pendingMedia.viewOnce) onceBtn.classList.add('active');
        sheet.addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-mc]');
            if (!btn) return;
            const act = btn.dataset.mc;
            if (act === 'close') {
                URL.revokeObjectURL(pendingMedia.url);
                pendingMedia = null;
                sheet.remove();
            } else if (act === 'once') {
                pendingMedia.viewOnce = !pendingMedia.viewOnce;
                btn.classList.toggle('active', pendingMedia.viewOnce);
                const hint = document.getElementById('mc-once-hint');
                if (hint) hint.classList.toggle('hidden', !pendingMedia.viewOnce);
            } else if (act === 'send') {
                const caption = (document.getElementById('mc-caption')?.value || '').trim();
                sheet.remove();
                sendPendingMedia(caption);
            }
        });
    }

    async function sendPendingMedia(caption) {
        if (!pendingMedia || !state.currentConversation) return;
        const { file, type, url, viewOnce } = pendingMedia;
        pendingMedia = null;
        const msgType = viewOnce ? (type + '_once') : type;
        const tempId = 'tmp-media-' + Date.now();
        // Support reply (quote) saat kirim foto/video — seperti WhatsApp
        if (!replyToMsg && window.__chatReplySticker) {
            replyToMsg = window.__chatReplySticker;
            window.__chatReplySticker = null;
        }
        const replyPayload = buildReplyPayload(replyToMsg, state.me.id);
        const optimistic = {
            id: tempId, conversation_id: state.currentConversation.id, sender_id: state.me.id,
            message_type: msgType, media_url: url, content: caption || '',
            created_at: new Date().toISOString(), uploading: true, _size: file.size,
            ...replyPayload
        };
        state.messages.push(optimistic);
        msgsEl.insertAdjacentHTML('beforeend', renderMessage(optimistic));
        scrollToBottom(true);
        clearReplyTo();
        window.__chatReplySticker = null;
        sendBtn.disabled = true;
        try {
            const fd = new FormData();
            fd.append('file', file);
            const { url: remote } = await API.upload('/api/chat/upload/chat', fd);
            const { message } = await API.post(`/api/chat/conversations/${state.currentConversation.id}/messages`, {
                message_type: msgType, media_url: remote, content: caption || '', ...replyPayload
            });
            URL.revokeObjectURL(url);
            replaceTempMessage(tempId, applyReplyParse({ ...message, ...replyPayload }));
            scrollToBottom(true);
        } catch (e) {
            URL.revokeObjectURL(url);
            const at = state.messages.findIndex(m => m.id === tempId);
            if (at >= 0) state.messages.splice(at, 1);
            const el = msgsEl.querySelector(`.msg[data-id="${tempId}"]`);
            if (el) el.remove();
            showToast(e.message || 'Gagal mengirim media.');
        } finally {
            sendBtn.disabled = false;
            updateComposerMode();
        }
    }

    async function onSendMedia(e) { onPickMedia(e); }

    async function refreshConversation() {
        if (!state.currentConversation) return;
        const btn = document.getElementById('conv-profile');
        const icon = document.getElementById('conv-refresh-icon');
        if (btn) btn.disabled = true;
        if (icon) icon.classList.add('spin');
        try {
            const { data } = await API.get(`/api/chat/conversations/${state.currentConversation.id}/messages?limit=100`);
            const wasNearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120;
            state.messages = data || [];
            renderMessages();
            if (wasNearBottom) scrollToBottom(false);
            await loadConversations();
            showToast('Pesan diperbarui.', 1200);
        } catch (e) {
            showToast(e.message || 'Gagal refresh pesan.');
        } finally {
            if (icon) icon.classList.remove('spin');
            if (btn) btn.disabled = false;
        }
    }

    function onNewMessage(m) {
        // Soft update daftar hanya jika tidak sedang di dalam percakapan ini
        if (!state.currentConversation || String(state.currentConversation.id) !== String(m.conversation_id)) {
            loadConversations();
            return;
        }
        if (state.messages.find(x => String(x.id) === String(m.id))) return;
        // Ganti optimistic temp milik pengirim yang sama + konten sama
        const tempIdx = state.messages.findIndex(x =>
            String(x.id).startsWith('tmp-') &&
            String(x.sender_id) === String(m.sender_id) &&
            ((x.content && x.content === m.content) || (x.message_type === m.message_type && x.message_type !== 'text'))
        );
        if (tempIdx >= 0) {
            const oldId = state.messages[tempIdx].id;
            state.messages[tempIdx] = m;
            const el = msgsEl.querySelector(`.msg[data-id="${oldId}"]`);
            if (el) {
                const wrap = document.createElement('div');
                wrap.innerHTML = renderMessage(m);
                el.replaceWith(wrap.firstChild);
            }
            return;
        }
        state.messages.push(m);
        msgsEl.insertAdjacentHTML('beforeend', renderMessage(m));
        const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120;
        if (nearBottom) scrollToBottom(true);
        else { newMsgIndicator.querySelector('span').textContent = '1'; newMsgIndicator.classList.remove('hidden'); }
        if (m.receiver_id === state.me.id) API.post(`/api/chat/conversations/${m.conversation_id}/read`, {}).catch(() => { });
    }

    function onMessageDelete(d) {
        const id = d.message?.id;
        if (!id) return;
        state.messages = state.messages.filter(x => String(x.id) !== String(id));
        const el = msgsEl.querySelector(`.msg[data-id="${id}"]`);
        if (el) { el.style.transition = 'opacity .2s, transform .2s'; el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; setTimeout(() => el.remove(), 200); }
    }

    function onMessageRead(data) {
        if (!state.currentConversation || state.currentConversation.id !== data.conversation_id) return;
        state.messages.forEach(m => { if (m.sender_id === state.me.id && !m.read_at) m.read_at = data.read_at; });
        renderMessages();
    }
    function onTyping(data) {
        if (!state.currentConversation || state.currentConversation.id !== data.conversation_id) return;
        if (data.user_id === state.me.id) return;
        typingBar.textContent = data.is_typing ? `${data.username} sedang mengetik...` : '';
        typingBar.classList.toggle('hidden', !data.is_typing);
    }
    function onPresenceUpdate(data) {
        if (!data || data.user_id == null) return;
        const uid = String(data.user_id);
        // Update chat list cache
        (state.chatList || []).forEach(c => {
            if (c.other_user && String(c.other_user.id) === uid) {
                c.other_user.online = !!data.online;
                c.other_user.last_seen = data.last_seen || c.other_user.last_seen;
            }
        });
        if (state.currentOtherUser && String(state.currentOtherUser.id) === uid) {
            state.currentOtherUser.online = !!data.online;
            state.currentOtherUser.last_seen = data.last_seen || state.currentOtherUser.last_seen;
            const el = document.getElementById('conv-status');
            if (el) el.textContent = presenceLabel(state.currentOtherUser);
        }
    }

    function clearSearchUI() {
        const box = document.getElementById('search-results');
        if (box) { box.classList.add('hidden'); box.classList.remove('has-people'); box.innerHTML = ''; }
        const clearBtn = document.getElementById('search-clear');
        if (clearBtn) clearBtn.classList.remove('visible');
    }

    function peopleAvatarHTML(u) {
        const name = u.display_name || u.username || '?';
        if (u.avatar_url) return `<div class="sp-av"><img src="${escapeHtml(u.avatar_url)}" alt="" /></div>`;
        return `<div class="sp-av">${escapeHtml(initials(name))}</div>`;
    }

    function renderSearchPeople(users) {
        if (!users || !users.length) return '';
        const items = users.map((u, i) => {
            const name = escapeHtml(u.display_name || u.username || '—');
            const uname = u.username ? escapeHtml(u.username) : '';
            return `<div class="sp-item" data-username="${escapeHtml(u.username || '')}" style="animation-delay:${Math.min(i, 10) * 0.03}s">
                ${peopleAvatarHTML(u)}
                <div class="sp-name">${name}</div>
                ${uname ? `<div class="sp-uname">@${uname}</div>` : ''}
            </div>`;
        }).join('');
        return `<div class="search-section-label">Orang</div><div class="search-people">${items}</div>`;
    }

    function filterChatListByQuery(q) {
        const ql = (q || '').toLowerCase();
        if (!ql) { renderConversations(); return; }
        const matched = (state.chatList || []).filter(c => {
            const u = c.other_user || {};
            const name = String(u.display_name || '').toLowerCase();
            const uname = String(u.username || '').toLowerCase();
            const prev = String(c.last_message_preview || '').toLowerCase();
            return name.includes(ql) || uname.includes(ql) || prev.includes(ql);
        });
        if (!matched.length) {
            list.innerHTML = `<div class="empty" style="padding:24px 16px"><p class="muted small">Tidak ada chat yang cocok.</p></div>`;
            return;
        }
        list.innerHTML = matched.map((c) => {
            const u = c.other_user || {};
            const badge = c.unread_count ? `<span class="badge">${c.unread_count}</span>` : '';
            return `<div class="chat-item" data-id="${c.id}">${avatarHTML(u)}<div class="body"><div class="row1"><div class="name">${escapeHtml(u.display_name || u.username || '—')}${badge}</div><div class="time">${c.last_message_at ? timeShort(c.last_message_at) : ''}</div></div><div class="preview">${escapeHtml(c.last_message_preview || 'Mulai percakapan')}</div></div></div>`;
        }).join('');
        list.querySelectorAll('.chat-item').forEach(el => { el.addEventListener('click', () => openConv(el.dataset.id)); });
    }

    async function onSearch() {
        const inp = document.getElementById('search-input');
        const q = (inp ? inp.value : '').trim();
        const box = document.getElementById('search-results');
        const clearBtn = document.getElementById('search-clear');
        if (clearBtn) clearBtn.classList.toggle('visible', !!q);
        if (!q) {
            clearSearchUI();
            renderConversations();
            return;
        }
        try {
            if (!(state.chatList && state.chatList.length)) {
                try { await loadConversations(true); } catch (_) {}
            }
            // Filter daftar chat yang sudah ada
            filterChatListByQuery(q);

            const { data } = await API.get('/api/chat/users/search?q=' + encodeURIComponent(q));
            const knownIds = new Set((state.chatList || []).map(c => String(c.other_user?.id || '')).filter(Boolean));
            const knownUsernames = new Set((state.chatList || []).map(c => String(c.other_user?.username || '').toLowerCase()).filter(Boolean));
            try {
                const contacts = await API.get('/api/chat/contacts');
                (contacts.data || contacts || []).forEach(u => {
                    if (u && u.id) knownIds.add(String(u.id));
                    if (u && u.username) knownUsernames.add(String(u.username).toLowerCase());
                });
            } catch (_) {}

            // Semua hasil search (termasuk yang sudah chat) untuk strip horizontal ala Telegram
            const allPeople = (data || []).slice(0, 24);
            // User baru (belum pernah chat) juga ditampilkan di strip
            const newOnly = allPeople.filter(u =>
                !knownIds.has(String(u.id)) && !knownUsernames.has(String(u.username || '').toLowerCase())
            );

            // Gabungkan: prioritaskan contact/known dulu, lalu user baru
            const knownFromSearch = allPeople.filter(u =>
                knownIds.has(String(u.id)) || knownUsernames.has(String(u.username || '').toLowerCase())
            );
            const people = [...knownFromSearch, ...newOnly];
            // dedupe by id
            const seen = new Set();
            const uniquePeople = people.filter(u => {
                const k = String(u.id || u.username);
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
            });

            if (!uniquePeople.length) {
                box.innerHTML = '';
                box.classList.add('hidden');
                box.classList.remove('has-people');
                return;
            }
            box.innerHTML = renderSearchPeople(uniquePeople);
            box.classList.add('has-people');
            box.classList.remove('hidden');
            box.querySelectorAll('.sp-item').forEach(el => {
                el.addEventListener('click', () => {
                    const uname = el.dataset.username;
                    if (!uname) return;
                    // kalau sudah ada conversation, buka langsung
                    const existing = (state.chatList || []).find(c =>
                        String(c.other_user?.username || '').toLowerCase() === uname.toLowerCase()
                    );
                    if (existing) openConv(existing.id);
                    else openUserModal(uname);
                });
            });
        } catch (e) { showToast(e.message); }
    }

    /** Dipanggil saat kembali ke tab Chat — jangan reset query search */
    async function restoreSearchOrLoad() {
        const inp = document.getElementById('search-input');
        const q = (inp ? inp.value : '').trim();
        if (q) {
            // refresh data di belakang, tapi pertahankan UI search
            try {
                const { data } = await API.get('/api/chat/conversations');
                state.chatList = data || [];
            } catch (_) {}
            await onSearch();
        } else {
            clearSearchUI();
            await loadConversations();
        }
    }

    async function openUserModal(username) {
        try {
            const { user } = await API.get('/api/chat/users/' + encodeURIComponent(username));
            const modal = document.getElementById('modal-user');
            document.getElementById('mu-name').textContent = user.display_name;
            document.getElementById('mu-username').textContent = '@' + user.username;
            document.getElementById('mu-about').textContent = user.about || 'Tidak ada bio.';
            const av = document.getElementById('mu-avatar');
            if (user.avatar_url) av.outerHTML = `<img id="mu-avatar" class="avatar xl" src="${user.avatar_url}" alt="" />`;
            else av.outerHTML = `<span id="mu-avatar" class="avatar xl">${initials(user.display_name)}</span>`;
            modal.classList.remove('hidden');
            document.getElementById('mu-close').onclick = () => modal.classList.add('hidden');
            document.getElementById('mu-chat').onclick = async () => {
                try {
                    const { conversation_id } = await API.post('/api/chat/conversations', { user_id: user.id });
                    modal.classList.add('hidden');
                    document.getElementById('search-input').value = '';
                    clearSearchUI();
                    await loadConversations();
                    openConv(conversation_id);
                } catch (e) { showToast(e.message); }
            };
        } catch (e) { showToast(e.message); }
    }

    function openOtherProfile() { if (!state.currentOtherUser) return; openUserModal(state.currentOtherUser.username); }
    function scrollToBottom(smooth) {
        if (!msgsEl) return;
        const go = () => { msgsEl.scrollTop = msgsEl.scrollHeight; };
        go();
        requestAnimationFrame(() => { go(); if (!smooth) setTimeout(go, 50); setTimeout(go, 150); });
        if (smooth) msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: 'smooth' });
    }

    return { init, loadConversations, restoreSearchOrLoad, onNewMessage, onMessageDelete, onMessageRead, onTyping, onPresenceUpdate, refreshConversation, openForwardPicker, openStatusPicker: () => StatusModule.openStatusPicker() };
})();
