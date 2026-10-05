

function isStickerVideoUrl(url) {
    if (!url) return false;
    const u = String(url).toLowerCase().split('?')[0];
    return /\.(mp4|webm|mov|m4v)$/.test(u) || u.includes('/stickers/') && (u.includes('.mp4') || u.includes('.webm'));
}
function isStickerEmoji(m) {
    if (!m) return false;
    if (m.media_url && String(m.media_url).startsWith('emoji:')) return true;
    if (!m.media_url && m.content && /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]|[\u{1F1E0}-\u{1F1FF}])+$/u.test(String(m.content).trim())) return true;
    return false;
}
function getStickerEmoji(m) {
    if (!m) return '';
    if (m.media_url && String(m.media_url).startsWith('emoji:')) return String(m.media_url).slice(6);
    return String(m.content || '').trim();
}
function renderStickerInner(m) {
    const emoji = isStickerEmoji(m) ? getStickerEmoji(m) : '';
    if (emoji) {
        return `<span class="sticker-emoji" data-sticker-key="emoji:${escapeHtml(emoji)}" role="img">${emoji}</span>`;
    }
    const url = m.media_url || '';
    if (isStickerVideoUrl(url)) {
        return `<video class="sticker-vid" src="${escapeHtml(url)}" data-sticker-url="${escapeHtml(url)}" autoplay muted loop playsinline webkit-playsinline disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback"></video>`;
    }
    if (url) {
        return `<img class="sticker-img" src="${escapeHtml(url)}" alt="Stiker" loading="lazy" data-sticker-url="${escapeHtml(url)}" />`;
    }
    return '';
}

/* ============================================================
   STICKER MODULE (WA-style panel + favorites + create via GitHub)
   ============================================================ */
const StickerModule = (function () {
    function uid() {
        try { return (App && App.state && App.state.me && App.state.me.id) || JSON.parse(localStorage.getItem('pretv_me') || '{}').id || 'guest'; }
        catch (_) { return 'guest'; }
    }
    function MINE_KEY() { return 'pretv_sticker_mine_' + uid(); }
    function RECENT_KEY() { return 'pretv_sticker_recent_' + uid(); }
    const BUILTIN_EMOJI = ['🗿','😀','💔','😭','🤣','😂','🤯','💀','😹','😸','❤️','🥶','🥺','🥲','😇','🙄','😅','🔥','🙏🏻'];
    let mode = 'chat';
    let tab = 'all';
    let shared = [];
    let sharedLoaded = false;

    function getMine() {
        try { return JSON.parse(localStorage.getItem(MINE_KEY()) || '[]'); } catch (_) { return []; }
    }
    function setMine(arr) {
        try { localStorage.setItem(MINE_KEY(), JSON.stringify(arr.slice(0, 120))); } catch (_) {}
    }
    function normalizeMine() {
        return getMine().map(x => typeof x === 'string' ? x : (x && x.url) || '').filter(Boolean);
    }
    function addToStickers(key) {
        if (!key) return;
        const mine = normalizeMine().filter(u => u !== key);
        mine.unshift(key);
        setMine(mine);
        showToast('Ditambahkan ke Stiker');
    }
    function alreadyMine(key) { return normalizeMine().includes(key); }
    function getRecent() {
        try { return JSON.parse(localStorage.getItem(RECENT_KEY()) || '[]'); } catch (_) { return []; }
    }
    function pushRecent(key) {
        if (!key) return;
        const arr = getRecent().filter(u => u !== key);
        arr.unshift(key);
        try { localStorage.setItem(RECENT_KEY(), JSON.stringify(arr.slice(0, 24))); } catch (_) {}
    }

    async function loadShared(force) {
        if (sharedLoaded && !force) return shared;
        try {
            const res = await API.get('/api/stickers');
            const rows = (res && res.data) || [];
            shared = [...new Set(rows.map(r => r.media_url).filter(Boolean))];
            sharedLoaded = true;
        } catch (e) { console.warn('[sticker] load shared:', e.message); }
        return shared;
    }

    function close() {
        document.getElementById('sticker-panel')?.remove();
        document.getElementById('sticker-backdrop')?.remove();
    }

    async function open(m) {
        mode = m || 'chat';
        close();
        const backdrop = document.createElement('div');
        backdrop.id = 'sticker-backdrop';
        backdrop.className = 'sticker-backdrop';
        backdrop.onclick = close;
        const panel = document.createElement('div');
        panel.id = 'sticker-panel';
        panel.className = 'sticker-panel';
        panel.innerHTML = `
            <div class="sp-handle"></div>
            <div class="sp-tabs">
                <button type="button" class="sp-tab ${tab==='all'?'active':''}" data-tab="all" title="Semua"><svg class="icon"><use href="#i-sticker"/></svg></button>
                <button type="button" class="sp-tab ${tab==='mine'?'active':''}" data-tab="mine" title="Stiker saya"><svg class="icon"><use href="#i-user"/></svg></button>
            </div>
            <div class="sp-search-row">
                <input type="search" id="sp-search" placeholder="Cari stiker..." autocomplete="off" />
            </div>
            <div class="sp-grid" id="sp-grid"><div class="sp-empty">Memuat stiker...</div></div>
            <input type="file" id="sp-create-input" accept="image/*" hidden />
            <input type="file" id="sp-create-video" accept="video/*" hidden />
        `;
        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
        panel.querySelectorAll('.sp-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                tab = btn.dataset.tab;
                panel.querySelectorAll('.sp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
                paintGrid();
            });
        });
        panel.querySelector('#sp-search').addEventListener('input', () => paintGrid());
        panel.querySelector('#sp-create-input').addEventListener('change', (e) => onCreateSticker(e, 'image'));
        panel.querySelector('#sp-create-video').addEventListener('change', (e) => onCreateSticker(e, 'video'));
        await loadShared(true);
        paintGrid();
    }

    function itemHtml(key) {
        if (!key) return '';
        if (String(key).startsWith('emoji:')) {
            const em = String(key).slice(6);
            return `<button type="button" class="spk" data-key="emoji:${em}"><span class="spk-em">${em}</span></button>`;
        }
        if (typeof isStickerVideoUrl === 'function' && isStickerVideoUrl(key)) {
            return `<button type="button" class="spk" data-key="${escapeHtml(key)}"><video src="${escapeHtml(key)}" muted loop playsinline autoplay></video></button>`;
        }
        if (!/^https?:\/\//i.test(key) && !String(key).includes('/') && String(key).length <= 8) {
            return `<button type="button" class="spk" data-key="emoji:${key}"><span class="spk-em">${key}</span></button>`;
        }
        return `<button type="button" class="spk" data-key="${escapeHtml(key)}"><img src="${escapeHtml(key)}" alt="" loading="lazy" /></button>`;
    }

    function paintGrid() {
        const grid = document.getElementById('sp-grid');
        if (!grid) return;
        const q = (document.getElementById('sp-search')?.value || '').trim().toLowerCase();
        const mine = normalizeMine();
        const matchQ = (key) => !q || String(key).toLowerCase().includes(q);

        let html = `<div class="sp-create-row">
            <button type="button" class="sp-create" id="sp-create-btn"><span class="sp-create-ico"><svg class="icon"><use href="#i-image"/></svg></span>Stiker foto</button>
            <button type="button" class="sp-create" id="sp-create-vid-btn"><span class="sp-create-ico" style="background:#8e44ad"><svg class="icon"><use href="#i-video"/></svg></span>Stiker video</button>
        </div>`;

        const rowOf = (keys) => {
            if (!keys.length) return '';
            return `<div class="sp-row">${keys.map(itemHtml).join('')}</div>`;
        };

        if (tab === 'mine') {
            // Hanya stiker kustom (foto/video/logo) — tanpa emoji bawaan
            const custom = mine.filter(k => {
                const s = String(k);
                return !s.startsWith('emoji:') && (s.startsWith('http') || s.includes('/'));
            }).filter(matchQ);
            const sharedOnly = shared.filter(u => !mine.includes(u) && matchQ(u));
            if (!custom.length && !sharedOnly.length) {
                html += `<div class="sp-empty">Belum ada stiker simpanan.<br>Buat stiker foto/video, atau ketuk stiker orang lain → Tambahkan ke Stiker.</div>`;
            } else {
                if (custom.length) {
                    html += `<div class="sp-section">Stiker saya</div>` + rowOf(custom);
                }
                if (sharedOnly.length) {
                    html += `<div class="sp-section">Komunitas</div>` + rowOf(sharedOnly);
                }
            }
        } else {
            // Tab emoji: HANYA emoji (+ terbaru emoji), tanpa logo/foto custom
            const recentEmoji = getRecent().filter(k => String(k).startsWith('emoji:') || (!String(k).startsWith('http') && String(k).length <= 8)).filter(matchQ);
            if (recentEmoji.length) {
                html += `<div class="sp-section">Terbaru</div>` + rowOf(recentEmoji);
            }
            const emojis = BUILTIN_EMOJI
                .map(em => 'emoji:' + em)
                .filter(key => {
                    if (!q) return true;
                    return key.toLowerCase().includes(q) || key.slice(6).includes(q);
                });
            html += `<div class="sp-section">Emoji</div>` + rowOf(emojis);
        }

        grid.innerHTML = html;
        grid.querySelector('#sp-create-btn')?.addEventListener('click', () => document.getElementById('sp-create-input')?.click());
        grid.querySelector('#sp-create-vid-btn')?.addEventListener('click', () => document.getElementById('sp-create-video')?.click());
        grid.querySelectorAll('.spk').forEach(btn => {
            btn.addEventListener('click', () => { close(); sendSticker(btn.dataset.key); });
        });
        grid.querySelectorAll('video').forEach(v => { v.muted = true; v.play().catch(() => {}); });
    }

    function getVideoDuration(file) {
        return new Promise((resolve, reject) => {
            const v = document.createElement('video');
            v.preload = 'metadata';
            const url = URL.createObjectURL(file);
            v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(url); resolve(d); };
            v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Video tidak bisa dibaca')); };
            v.src = url;
        });
    }

    async function onCreateSticker(e, kind) {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        try {
            if (kind === 'video') {
                if (!f.type.startsWith('video/')) { showToast('File harus video'); return; }
                if (f.size > 8 * 1024 * 1024) { showToast('Video stiker maks 8 MB'); return; }
                const dur = await getVideoDuration(f);
                if (dur > 7.5) { showToast('Stiker video maksimal 7 detik'); return; }
                openStickerPreview({ kind: 'video', file: f });
            } else {
                if (!f.type.startsWith('image/')) { showToast('File harus gambar'); return; }
                if (f.size > 5 * 1024 * 1024) { showToast('Maks 5 MB'); return; }
                const blob = await cropToSticker(f);
                const file = new File([blob], 'sticker-' + Date.now() + '.png', { type: 'image/png' });
                openStickerPreview({ kind: 'image', file });
            }
        } catch (err) {
            showToast(err.message || 'Gagal proses stiker');
        }
    }

    function openStickerPreview(pending) {
        document.getElementById('sticker-preview-sheet')?.remove();
        const url = URL.createObjectURL(pending.file);
        const sheet = document.createElement('div');
        sheet.id = 'sticker-preview-sheet';
        sheet.className = 'sticker-preview-sheet';

// 🎨 Status bar hitam
setDarkStatusBar(true);
        const isVid = pending.kind === 'video';
        sheet.innerHTML = `
            <div class="spv-top">
                <button type="button" data-spv="close" aria-label="Tutup"><svg class="icon"><use href="#i-close"/></svg></button>
            </div>
            <div class="spv-preview">
                ${isVid
                    ? `<video src="${url}" autoplay muted loop playsinline></video>`
                    : `<img src="${url}" alt="Preview stiker" />`}
            </div>
            <div class="spv-bottom">
                <button type="button" class="spv-send" data-spv="send"><svg class="icon"><use href="#i-send"/></svg> Kirim stiker</button>
            </div>`;
        document.body.appendChild(sheet);
        const cleanup = () => {
    URL.revokeObjectURL(url);
    sheet.remove();
    // 🎨 Status bar balik putih
    setDarkStatusBar(false);
};
        let isUploading = false;
sheet.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-spv]');
    if (!btn) return;
    const act = btn.dataset.spv;

    // === TOMBOL X (CLOSE) — selalu bisa diklik, termasuk saat upload ===
    if (act === 'close') {
        cleanup();
        return;
    }

    // === TOMBOL KIRIM STIKER ===
    if (act === 'send') {
        if (isUploading) return;
        isUploading = true;
        btn.disabled = true;
        btn.textContent = 'Mengunggah...';
        try {
            await uploadAndSaveSticker(pending.file, pending.kind);
            cleanup();
        } catch (err) {
            isUploading = false;
            btn.disabled = false;
            btn.innerHTML = '<svg class="icon"><use href="#i-send"/></svg> Kirim stiker';
            showToast(err.message || 'Gagal unggah');
        }
    }
});
    }

    async function uploadAndSaveSticker(file, kind) {
        showToast(kind === 'video' ? 'Mengunggah stiker video...' : 'Mengunggah stiker...');
        const fd = new FormData();
        fd.append('file', file);
        const up = await API.upload('/api/chat/upload/sticker', fd);
        const url = up && up.url;
        if (!url) throw new Error('Upload gagal');
        try { await API.post('/api/stickers', { media_url: url }); } catch (dbErr) { console.warn(dbErr.message); }
        const mine = normalizeMine().filter(u => u !== url);
        mine.unshift(url);
        setMine(mine);
        shared = [url, ...shared.filter(u => u !== url)];
        pushRecent(url);
        tab = 'mine';
        showToast(kind === 'video' ? 'Stiker video tersimpan' : 'Stiker tersimpan (GitHub + database)');
        const panel = document.getElementById('sticker-panel');
        if (panel) {
            panel.querySelectorAll('.sp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'mine'));
            paintGrid();
        } else {
            // kirim langsung ke chat aktif
            sendSticker(url);
        }
    }

    function cropToSticker(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const obj = URL.createObjectURL(file);
            img.onload = () => {
                const size = Math.min(img.width, img.height, 512);
                const s = Math.min(img.width, img.height);
                const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
                const c = document.createElement('canvas');
                c.width = size; c.height = size;
                c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, size, size);
                URL.revokeObjectURL(obj);
                c.toBlob(b => b ? resolve(b) : reject(new Error('Gagal proses gambar')), 'image/png', 0.92);
            };
            img.onerror = () => { URL.revokeObjectURL(obj); reject(new Error('Gagal baca gambar')); };
            img.src = obj;
        });
    }

    function stickerPayload(key) {
        if (String(key).startsWith('emoji:')) {
            const em = String(key).slice(6);
            return { message_type: 'sticker', media_url: 'emoji:' + em, content: em };
        }
        if (!/^https?:\/\//i.test(key) && key.length <= 8) {
            return { message_type: 'sticker', media_url: 'emoji:' + key, content: key };
        }
        return { message_type: 'sticker', media_url: key, content: '' };
    }

    function getActiveReplyForSticker(isGroup) {
        // Prioritas: window globals dari reply bar / sticker action
        let m = window.__activeReplyMsg || null;
        if (isGroup) m = m || window.__groupReplySticker || null;
        else m = m || window.__chatReplySticker || null;
        if (!m || !m.id) return {};
        return buildReplyPayload(m, App.state.me?.id);
    }
    function clearActiveReplyUI(isGroup) {
        window.__activeReplyMsg = null;
        window.__chatReplySticker = null;
        window.__groupReplySticker = null;
        if (isGroup) {
            document.getElementById('group-reply-bar')?.classList.remove('visible');
        } else {
            document.getElementById('chat-reply-bar')?.classList.remove('visible');
        }
    }

    function optimisticHtml(key, tempId, replyPayload) {
        const p = stickerPayload(key);
        const fake = { id: tempId, message_type: 'sticker', media_url: p.media_url, content: p.content, ...(replyPayload || {}) };
        let quote = '';
        if (fake.reply_to_id) quote = renderReplyQuoteHtml(fake);
        // Stiker + quote: tetap pakai bubble tipis agar quote terlihat
        if (quote) {
            return `<div class="msg me sticker-msg sticker-with-reply" data-id="${tempId}">${quote}${renderStickerInner(fake)}<div class="meta"><span></span></div></div>`;
        }
        return `<div class="msg me sticker-msg" data-id="${tempId}">${renderStickerInner(fake)}<div class="meta"><span></span></div></div>`;
    }

    async function sendSticker(key) {
        if (!key) return;
        if (mode === 'group') return sendGroupSticker(key);
        const state = App.state;
        if (!state.currentConversation) { showToast('Buka chat dulu'); return; }
        const replyPayload = getActiveReplyForSticker(false);
        const payload = { ...stickerPayload(key), ...replyPayload };
        // Embed reply di content jika perlu (stiker content biasanya kosong)
        if (replyPayload.reply_to_id) {
            payload.content = encodeReplyInContent(payload.content || '', replyPayload);
        }
        const tempId = 'tmp-sticker-' + Date.now();
        state.messages.push({ id: tempId, conversation_id: state.currentConversation.id, sender_id: state.me.id, ...payload, created_at: new Date().toISOString() });
        const msgsEl = document.getElementById('messages');
        if (msgsEl) {
            msgsEl.insertAdjacentHTML('beforeend', optimisticHtml(key, tempId, replyPayload));
            msgsEl.scrollTop = msgsEl.scrollHeight;
            msgsEl.querySelectorAll(`[data-id="${tempId}"] video`).forEach(v => { v.muted = true; v.play().catch(()=>{}); });
        }
        clearActiveReplyUI(false);
        try {
            const { message } = await API.post(`/api/chat/conversations/${state.currentConversation.id}/messages`, payload);
            const parsed = applyReplyParse({ ...message, ...replyPayload });
            const idx = state.messages.findIndex(m => m.id === tempId);
            if (idx >= 0) state.messages[idx] = parsed;
            const el = msgsEl && msgsEl.querySelector(`[data-id="${tempId}"]`);
            if (el && message) {
                el.dataset.id = message.id;
                const meta = el.querySelector('.meta span');
                if (meta) meta.textContent = timeShort(message.created_at || new Date().toISOString());
            }
            const c = state.chatList.find(x => String(x.id) === String(state.currentConversation.id));
            if (c) { c.last_message_at = message.created_at; c.last_message_preview = 'Stiker'; c.last_sender_id = state.me.id; }
            pushRecent(key);
        } catch (e) {
            showToast(e.message || 'Gagal kirim stiker');
            const idx = state.messages.findIndex(m => m.id === tempId);
            if (idx >= 0) state.messages.splice(idx, 1);
            document.querySelector(`.msg[data-id="${tempId}"]`)?.remove();
        }
    }

    async function sendGroupSticker(key) {
        const state = App.state;
        if (!state.currentGroup) { showToast('Buka grup dulu'); return; }
        const replyPayload = getActiveReplyForSticker(true);
        const payload = { ...stickerPayload(key), ...replyPayload };
        if (replyPayload.reply_to_id) {
            payload.content = encodeReplyInContent(payload.content || '', replyPayload);
        }
        const tempId = 'tmp-sticker-' + Date.now();
        state.groupMessages.push({ id: tempId, group_id: state.currentGroup.id, sender_id: state.me.id, ...payload, created_at: new Date().toISOString() });
        const msgsEl = document.getElementById('group-messages');
        if (msgsEl) {
            msgsEl.insertAdjacentHTML('beforeend', optimisticHtml(key, tempId, replyPayload));
            msgsEl.scrollTop = msgsEl.scrollHeight;
            msgsEl.querySelectorAll(`[data-id="${tempId}"] video`).forEach(v => { v.muted = true; v.play().catch(()=>{}); });
        }
        clearActiveReplyUI(true);
        try {
            const { message } = await API.post(`/api/groups/${state.currentGroup.id}/messages`, payload);
            const parsed = applyReplyParse({ ...message, ...replyPayload });
            const idx = state.groupMessages.findIndex(m => m.id === tempId);
            if (idx >= 0) state.groupMessages[idx] = parsed;
            const el = msgsEl && msgsEl.querySelector(`[data-id="${tempId}"]`);
            if (el && message) {
                el.dataset.id = message.id;
                const meta = el.querySelector('.meta span');
                if (meta) meta.textContent = timeShort(message.created_at || new Date().toISOString());
            }
            const g = state.groups.find(x => String(x.id) === String(state.currentGroup.id));
            if (g) {
                const sn = (state.me?.display_name || state.me?.username || 'User');
                g.last_message_at = message.created_at;
                g.last_message_preview = sn + ': Stiker';
                g.last_sender_id = state.me.id;
            }
            pushRecent(key);
        } catch (e) {
            showToast(e.message || 'Gagal kirim stiker');
            const idx = state.groupMessages.findIndex(m => m.id === tempId);
            if (idx >= 0) state.groupMessages.splice(idx, 1);
            document.querySelector(`.msg[data-id="${tempId}"]`)?.remove();
        }
    }

    function openStickerAction(key, opts) {
        if (!key) return;
        opts = opts || {};
        const isMine = !!opts.isMine;
        document.getElementById('sticker-action-sheet')?.remove();
        document.getElementById('sticker-action-backdrop')?.remove();
        const bd = document.createElement('div');
        bd.id = 'sticker-action-backdrop';
        bd.className = 'sticker-backdrop';
        bd.style.zIndex = '9890';
        const sheet = document.createElement('div');
        sheet.id = 'sticker-action-sheet';
        sheet.className = 'sticker-action';
        const already = alreadyMine(key);
        // "Tambahkan ke Stiker" HANYA untuk stiker dari orang lain
        let addBtn = '';
        if (!isMine) {
            addBtn = `<button type="button" data-act="add">
                <span class="sa-ico"><svg class="icon"><use href="#i-plus"/></svg></span>
                ${already ? 'Sudah di Stiker' : 'Tambahkan ke Stiker'}
            </button>`;
        }
        // Hapus hanya untuk stiker milik sendiri
        const delBtn = isMine
            ? `<button type="button" data-act="delete" style="color:#e74c3c">
                <span class="sa-ico" style="background:#fdecea;color:#e74c3c"><svg class="icon"><use href="#i-trash"/></svg></span>
                Hapus stiker
            </button>`
            : '';
        const canReply = !!(opts.msgId && !String(opts.msgId).startsWith('tmp-'));
        const replyBtn = canReply
            ? `<button type="button" data-act="reply">
                <span class="sa-ico"><svg class="icon"><use href="#i-back"/></svg></span>
                Balas
            </button>` : '';
        sheet.innerHTML = `
            ${replyBtn}
            ${addBtn}
            <button type="button" data-act="send">
                <span class="sa-ico"><svg class="icon"><use href="#i-send"/></svg></span>
                Kirim stiker ini
            </button>
            ${delBtn}
            <button type="button" data-act="close" style="color:#54656f">
                <span class="sa-ico"><svg class="icon"><use href="#i-close"/></svg></span>
                Tutup
            </button>`;
        const closeAll = () => { sheet.remove(); bd.remove(); };
        bd.onclick = closeAll;
        sheet.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-act]');
            if (!b) return;
            const act = b.dataset.act;
            if (act === 'close') return closeAll();
            if (act === 'reply') {
                closeAll();
                const msgId = opts.msgId;
                const inGroup = document.getElementById('view-group-conv')?.classList.contains('active');
                if (inGroup) {
                    const m = (App.state.groupMessages || []).find(x => String(x.id) === String(msgId));
                    if (m) {
                        const mine = String(m.sender_id) === String(App.state.me?.id);
                        // Simpan nama asli (bukan "Anda") agar quote di bubble benar untuk semua user
                        const realName = mine
                            ? (App.state.me?.display_name || App.state.me?.username || m.user?.display_name || m.user?.username || 'Pengguna')
                            : (m.user?.display_name || m.user?.username || 'Pesan');
                        m._replySenderName = realName;
                        try {
                            const bar = document.getElementById('group-reply-bar');
                            if (bar) {
                                document.dispatchEvent(new CustomEvent('pretv-reply-sticker', { detail: { msg: m, group: true } }));
                            }
                        } catch (_) {}
                        const nameEl = document.getElementById('group-reply-name');
                        const textEl = document.getElementById('group-reply-text');
                        const thumbEl = document.getElementById('group-reply-thumb');
                        const bar = document.getElementById('group-reply-bar');
                        if (nameEl && textEl) {
                            // Di bar composer, "Anda" OK untuk pesan sendiri (UX)
                            nameEl.textContent = mine ? 'Anda' : realName;
                            textEl.textContent = 'Stiker';
                            if (thumbEl) { thumbEl.innerHTML = ''; thumbEl.classList.add('hidden'); }
                            bar?.classList.add('visible');
                            window.__groupReplySticker = m;
                        }
                    }
                } else {
                    const m = (App.state.messages || []).find(x => String(x.id) === String(msgId));
                    if (m) {
                        const mine = String(m.sender_id) === String(App.state.me?.id);
                        const realName = mine
                            ? (App.state.me?.display_name || App.state.me?.username || 'Pengguna')
                            : (App.state.currentOtherUser?.display_name || App.state.currentOtherUser?.username || 'Pesan');
                        m._replySenderName = realName;
                        const nameEl = document.getElementById('chat-reply-name');
                        const textEl = document.getElementById('chat-reply-text');
                        const thumbEl = document.getElementById('chat-reply-thumb');
                        const bar = document.getElementById('chat-reply-bar');
                        if (nameEl && textEl) {
                            nameEl.textContent = mine ? 'Anda' : realName;
                            textEl.textContent = 'Stiker';
                            if (thumbEl) { thumbEl.innerHTML = ''; thumbEl.classList.add('hidden'); }
                            bar?.classList.add('visible');
                            window.__chatReplySticker = m;
                        }
                    }
                }
                return;
            }
            if (act === 'add') {
                if (!already) {
                    addToStickers(key);
                    pushRecent(key);
                    if (/^https?:\/\//i.test(key)) {
                        try { await API.post('/api/stickers', { media_url: key }); } catch (_) {}
                    }
                } else showToast('Sudah di Stiker');
                return closeAll();
            }
            if (act === 'send') {
                closeAll();
                mode = document.getElementById('view-group-conv')?.classList.contains('active') ? 'group' : 'chat';
                sendSticker(key);
            }
            if (act === 'delete') {
                closeAll();
                const msgId = opts.msgId;
                if (!msgId || String(msgId).startsWith('tmp-')) {
                    showToast('Pesan belum terkirim');
                    return;
                }
                try {
                    const inGroup = document.getElementById('view-group-conv')?.classList.contains('active');
                    if (inGroup) {
                        const gid = App.state.currentGroup?.id;
                        await API.del(`/api/groups/${gid}/messages/${msgId}`);
                        App.state.groupMessages = (App.state.groupMessages || []).filter(x => String(x.id) !== String(msgId));
                        const el = document.querySelector(`#group-messages .msg[data-id="${msgId}"]`);
                        if (el) { el.style.transition = 'opacity .2s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }
                    } else {
                        await API.del('/api/chat/messages/' + msgId);
                        App.state.messages = (App.state.messages || []).filter(x => String(x.id) !== String(msgId));
                        const el = document.querySelector(`#messages .msg[data-id="${msgId}"]`);
                        if (el) { el.style.transition = 'opacity .2s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }
                    }
                    showToast('Stiker dihapus.');
                } catch (err) {
                    showToast(err.message || 'Gagal hapus stiker');
                }
            }
        });
        document.body.appendChild(bd);
        document.body.appendChild(sheet);
    }

    document.addEventListener('click', (e) => {
        const el = e.target.closest('.sticker-img, .sticker-vid, .sticker-emoji');
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        const key = el.dataset.stickerKey || el.dataset.stickerUrl || (el.classList.contains('sticker-emoji') ? ('emoji:' + el.textContent.trim()) : el.src);
        const msgEl = el.closest('.msg');
        const isMine = !!(msgEl && msgEl.classList.contains('me'));
        const msgId = msgEl ? msgEl.dataset.id : null;
        openStickerAction(key, { isMine, msgId });
    }, true);

    const obs = new MutationObserver(() => {
        document.querySelectorAll('.sticker-vid').forEach(v => {
            if (v.dataset.auto !== '1') {
                v.dataset.auto = '1';
                v.muted = true;
                v.loop = true;
                v.playsInline = true;
                v.play().catch(() => {});
            }
        });
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', () => obs.observe(document.body, { childList: true, subtree: true }));

    return { open, close, addToStickers, sendSticker, loadShared };
})();
