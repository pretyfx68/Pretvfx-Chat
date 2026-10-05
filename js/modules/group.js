/* ============================================================
   GROUP MODULE — terpisah dari chat perorangan
   ============================================================ */
const GroupModule = (function () {
    let state, list, msgsEl, composer, input, fileInput, sendBtn;
    let groupsFirstPaint = true;
    let memberCache = {}; // { groupId: { userId: userObj } } — dipakai sbg fallback nama pengirim saat pesan realtime masuk tanpa data user

    function init(s) {
        state = s;
        list = document.getElementById('group-list');
        msgsEl = document.getElementById('group-messages');
        composer = document.getElementById('group-composer');
        input = document.getElementById('group-composer-input');
        // Tampilkan grup dari cache SEGERA
        try {
            const cached = JSON.parse(localStorage.getItem('pretv_group_list') || 'null');
            if (Array.isArray(cached) && cached.length) {
                state.groups = cached;
                renderGroups();
            }
        } catch (_) {}
        fileInput = document.getElementById('group-file-input');
        sendBtn = document.getElementById('group-send-btn');

        document.getElementById('add-group').addEventListener('click', openCreateGroupModal);
        document.getElementById('gconv-back').addEventListener('click', closeGroup);
        document.getElementById('gconv-info').addEventListener('click', openGroupInfoSheet);
        // Buka info grup dari avatar / nama (delegasi — tahan ganti DOM avatar)
        const gconvTop = document.querySelector('#view-group-conv .conv-top') || document.getElementById('view-group-conv');
        if (gconvTop) {
            gconvTop.addEventListener('click', (e) => {
                if (e.target.closest('#gconv-info') || e.target.closest('#gconv-back')) return;
                if (e.target.closest('#gconv-avatar') || e.target.closest('.conv-meta') || e.target.closest('#gconv-name') || e.target.closest('#gconv-status')) {
                    openGroupInfoSheet();
                }
            });
        }
        composer.addEventListener('submit', onSendText);
        input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendText(e); } });
        input.addEventListener('input', () => { autoGrow(); updateGroupComposerMode(); });
        fileInput.addEventListener('change', onGroupPickMedia);
        const gMic = document.getElementById('group-mic-btn');
        if (gMic) gMic.addEventListener('click', startGroupVoice);
        const gRecCancel = document.getElementById('group-rec-cancel');
        if (gRecCancel) gRecCancel.addEventListener('click', cancelGroupVoice);
        const gRecSend = document.getElementById('group-rec-send');
        if (gRecSend) gRecSend.addEventListener('click', sendGroupVoice);
        const gSticker = document.getElementById('group-sticker-btn');
        if (gSticker) gSticker.addEventListener('click', () => StickerModule.open('group'));
        const gAttachBtn = document.getElementById('group-attach-btn');
        const gAttachMenu = document.getElementById('group-attach-menu');
        if (gAttachBtn && gAttachMenu) {
            gAttachBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                gAttachMenu.classList.toggle('hidden');
            });
            gAttachMenu.addEventListener('click', (e) => {
                const b = e.target.closest('[data-attach]');
                if (!b) return;
                gAttachMenu.classList.add('hidden');
                const kind = b.dataset.attach;
                const map = { video: 'group-file-input-video', foto: 'group-file-input-foto', kamera: 'group-file-input-kamera' };
                const inp = document.getElementById(map[kind]);
                if (inp) inp.click();
            });
            document.addEventListener('click', (e) => {
                if (!gAttachMenu.classList.contains('hidden') && !e.target.closest('#group-attach-btn') && !e.target.closest('#group-attach-menu')) {
                    gAttachMenu.classList.add('hidden');
                }
            });
        }
        ['group-file-input-foto','group-file-input-video','group-file-input-kamera'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', onGroupPickMedia);
        });
        updateGroupComposerMode();
        msgsEl.addEventListener('click', onGroupAudioPlayClick);

        msgsEl.addEventListener('click', (e) => {
            const msgEl = e.target.closest('.msg');
            if (!msgEl) return;
            const mediaWrap = e.target.closest('.media-wrap');
            if (mediaWrap && !msgEl.classList.contains('is-uploading')) {
                const mediaMsg = state.groupMessages.find(x => String(x.id) === String(msgEl.dataset.id));
                if (mediaMsg?.media_url) {
                    let t = mediaMsg.message_type || mediaWrap.dataset.mediaType || 'image';
                    const isOnce = t === 'image_once' || t === 'video_once' || mediaWrap.dataset.viewOnce === '1';
                    if (isOnce && String(mediaMsg.sender_id) !== String(state.me.id)) {
                        let viewed = false;
                        try { viewed = localStorage.getItem('pretv_viewonce_' + mediaMsg.id) === '1'; } catch (_) {}
                        if (viewed) { showToast('Foto/video telah dilihat.'); return; }
                        try { localStorage.setItem('pretv_viewonce_' + mediaMsg.id, '1'); } catch (_) {}
                        setTimeout(() => {
                            const el = msgsEl.querySelector(`.msg[data-id="${mediaMsg.id}"]`);
                            if (el) {
                                const wrap = document.createElement('div');
                                wrap.innerHTML = renderMessage(mediaMsg, { showHead: shouldShowHead(mediaMsg) });
                                el.replaceWith(wrap.firstChild);
                            }
                        }, 400);
                    }
                    if (t === 'image_once') t = 'image';
                    if (t === 'video_once') t = 'video';
                    const url = String(mediaMsg.media_url).split('#')[0];
                    openChatMediaViewer(url, t, isOnce);
                    return;
                }
            }
            if (e.target.closest('.msg-audio')) {
                if (!e.target.closest('[data-audio-play]')) {
                    const playBtn = msgEl.querySelector('[data-audio-play]');
                    if (playBtn) onGroupAudioPlayClick({ target: playBtn, preventDefault() {}, stopPropagation() {} });
                }
                return;
            }
            if (e.target.closest('.msg-reply-quote')) {
                const rid = e.target.closest('.msg-reply-quote').dataset.replyTo;
                if (rid) {
                    const target = msgsEl.querySelector(`.msg[data-id="${rid}"], .msg-with-av[data-id="${rid}"]`);
                    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.style.outline = '2px solid var(--primary)'; setTimeout(() => { target.style.outline = ''; }, 1200); }
                }
                return;
            }
            // Tap singkat: menu hanya pesan sendiri; long-press untuk semua
            if (!msgEl.classList.contains('me')) return;
            const id = msgEl.dataset.id;
            if (!id || String(id).startsWith('tmp-')) return;
            openGroupMessageMenu(id);
        });
        msgsEl.addEventListener('contextmenu', e => {
            const m = e.target.closest('.msg');
            if (!m) return;
            e.preventDefault();
            const id = m.dataset.id;
            if (id && !String(id).startsWith('tmp-')) openGroupMessageMenu(id);
        });
        // Swipe-to-reply (teks, media, stiker)
        bindSwipeToReply(msgsEl, (msgId) => {
            const m = state.groupMessages.find(x => String(x.id) === String(msgId));
            if (!m || String(m.id).startsWith('tmp-')) return;
            const mine = String(m.sender_id) === String(state.me.id);
            const u = m.user || (memberCache[m.group_id] && memberCache[m.group_id][m.sender_id]) || null;
            // Nama asli untuk disimpan di quote (jangan "Anda")
            m._replySenderName = mine
                ? (state.me?.display_name || state.me?.username || 'Pengguna')
                : (u?.display_name || u?.username || 'Pesan');
            setGroupReplyTo(m);
        });
        document.getElementById('group-reply-close')?.addEventListener('click', clearGroupReplyTo);
        // Mention @
        input.addEventListener('input', onGroupMentionInput);
        input.addEventListener('keydown', onGroupMentionKeydown);
    }

    /* ---------- @ MENTION ---------- */
    let mentionMembers = [];
    let mentionActiveIdx = 0;
    function hideMentionPicker() {
        const p = document.getElementById('group-mention-picker');
        if (p) { p.classList.remove('visible'); p.innerHTML = ''; }
    }
    let mentionMembersFetched = {};
    async function ensureMentionMembers() {
        if (!state.currentGroup) return [];
        const gid = state.currentGroup.id;
        // Selalu fetch daftar anggota penuh minimal sekali per grup (agar bisa di-scroll semua)
        if (!mentionMembersFetched[gid]) {
            try {
                const res = await API.get(`/api/groups/${gid}/members`);
                const map = memberCache[gid] || {};
                (res.data || []).forEach(m => { if (m.user) map[m.user_id || m.user.id] = m.user; });
                memberCache[gid] = map;
                mentionMembersFetched[gid] = true;
            } catch (_) {}
        }
        const map = memberCache[gid] || {};
        return Object.values(map).filter(u => u && String(u.id) !== String(state.me.id));
    }
    async function onGroupMentionInput() {
        autoGrow(); updateGroupComposerMode();
        const val = input.value;
        const cursor = input.selectionStart || val.length;
        const before = val.slice(0, cursor);
        const m = before.match(/(^|\s)@([a-zA-Z0-9._]*)$/);
        if (!m) { hideMentionPicker(); return; }
        const q = (m[2] || '').toLowerCase();
        const members = await ensureMentionMembers();
        const filtered = members.filter(u => {
            const un = String(u.username || '').toLowerCase();
            const dn = String(u.display_name || '').toLowerCase();
            return !q || un.includes(q) || dn.includes(q);
        }); // semua anggota, bisa di-scroll
        const picker = document.getElementById('group-mention-picker');
        if (!picker) return;
        // @Semua selalu di atas (kecuali filter spesifik user)
        const showAll = !q || 'semua'.startsWith(q) || 'everyone'.startsWith(q) || 'all'.startsWith(q);
        if (!filtered.length && !showAll) { hideMentionPicker(); return; }
        const items = [];
        if (showAll) {
            items.push({ _all: true, username: 'semua', display_name: 'Semua', id: '__all__' });
        }
        // Selalu sediakan Pretvfx-AI di picker
        if (typeof AIModule !== 'undefined') {
            const ai = AIModule.getAiUser();
            const qn = (q || '').toLowerCase();
            if (!qn || ai.username.includes(qn) || ai.display_name.toLowerCase().includes(qn) || 'ai'.includes(qn) || 'pretv'.includes(qn)) {
                items.push({ ...ai, _ai: true });
            }
        }
        filtered.forEach(u => {
            if (u.username && u.username.toLowerCase() === 'pretvfx-ai') return;
            items.push(u);
        });
        if (!items.length) { hideMentionPicker(); return; }
        mentionMembers = items;
        mentionActiveIdx = 0;
        picker.innerHTML = items.map((u, i) => {
            if (u._all) {
                return `<div class="mp-item mp-all${i === 0 ? ' active' : ''}" data-idx="${i}" data-uname="semua">
                    <span class="mp-av">@</span>
                    <div><div class="mp-name">Semua</div>
                    <div class="mp-uname">Sebut semua anggota</div></div>
                </div>`;
            }
            const av = u.avatar_url
                ? `<span class="mp-av"><img src="${escapeHtml(u.avatar_url)}" alt="" /></span>`
                : `<span class="mp-av">${escapeHtml((u.display_name || u.username || '?').charAt(0).toUpperCase())}</span>`;
            return `<div class="mp-item${i === 0 ? ' active' : ''}" data-idx="${i}" data-uname="${escapeHtml(u.username || '')}">
                ${av}
                <div><div class="mp-name">${escapeHtml(u.display_name || u.username || 'User')}</div>
                <div class="mp-uname">@${escapeHtml(u.username || '')}</div></div>
            </div>`;
        }).join('');
        picker.classList.add('visible');
        // pastikan bisa di-scroll (touch tidak ke-block)
        picker.style.pointerEvents = 'auto';
        picker.querySelectorAll('.mp-item').forEach(el => {
            el.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                insertMention(el.dataset.uname);
            });
        });
    }
    function insertMention(username) {
        if (!username || !input) return;
        const val = input.value;
        const cursor = input.selectionStart || val.length;
        const before = val.slice(0, cursor);
        const after = val.slice(cursor);
        const replaced = before.replace(/(^|\s)@([a-zA-Z0-9._]*)$/, `$1@${username} `);
        input.value = replaced + after;
        const pos = replaced.length;
        input.setSelectionRange(pos, pos);
        hideMentionPicker();
        autoGrow(); updateGroupComposerMode();
        input.focus();
    }
    function onGroupMentionKeydown(e) {
        const picker = document.getElementById('group-mention-picker');
        if (!picker || !picker.classList.contains('visible')) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            mentionActiveIdx = Math.min(mentionActiveIdx + 1, mentionMembers.length - 1);
            picker.querySelectorAll('.mp-item').forEach((el, i) => el.classList.toggle('active', i === mentionActiveIdx));
            picker.querySelectorAll('.mp-item')[mentionActiveIdx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            mentionActiveIdx = Math.max(mentionActiveIdx - 1, 0);
            picker.querySelectorAll('.mp-item').forEach((el, i) => el.classList.toggle('active', i === mentionActiveIdx));
            picker.querySelectorAll('.mp-item')[mentionActiveIdx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (mentionMembers[mentionActiveIdx]) {
                e.preventDefault();
                insertMention(mentionMembers[mentionActiveIdx].username);
            }
        } else if (e.key === 'Escape') {
            hideMentionPicker();
        }
    }

    function autoGrow() { if (!input) return; input.style.height = ''; input.style.height = '42px'; }

    /* ---------- DAFTAR GRUP ---------- */
    function saveGroupsCache() {
        try { localStorage.setItem('pretv_group_list', JSON.stringify((state.groups || []).slice(0, 60))); } catch (_) {}
    }
    async function loadGroups() {
        if (!(state.groups && state.groups.length)) {
            try {
                const cached = JSON.parse(localStorage.getItem('pretv_group_list') || 'null');
                if (Array.isArray(cached) && cached.length) { state.groups = cached; renderGroups(); }
            } catch (_) {}
        }
        try {
            const { data } = await API.get('/api/groups');
            state.groups = data || [];
            saveGroupsCache();
            renderGroups();
        } catch (e) {
            console.warn('[groups]', e.message || e);
            if (state.groups && state.groups.length) renderGroups();
        }
    }

    function renderGroups() {
        if (!list) return;
        const totalUnread = state.groups.reduce((sum, g) => sum + (g.unread_count || 0), 0);
        updateNavBadge('nav-badge-group', totalUnread);
        if (!state.groups.length) {
            list.innerHTML = `<div class="empty"><svg class="icon icon-lg muted"><use href="#i-group"/></svg><p>Belum ada grup.</p><p class="muted small">Buat grup bersama orang yang pernah kamu ajak chat.</p></div>`;
            return;
        }
        const gAnim = groupsFirstPaint ? ' anim-enter' : '';
        groupsFirstPaint = false;
        list.innerHTML = state.groups.map((g, i) => {
            const mentionBadge = (g.mentioned && g.unread_count) ? `<span class="badge-mention" title="Kamu disebut">@</span>` : '';
            const badge = g.unread_count ? `<span class="badge">${g.unread_count > 99 ? '99+' : g.unread_count}</span>` : '';
            const av = g.avatar_url
                ? `<img class="avatar group-avatar" src="${g.avatar_url}" alt="" />`
                : `<span class="avatar group-avatar"><i class="fa-solid fa-users"></i></span>`;
            const delay = gAnim ? `style="animation-delay:${0.03 + i * 0.05}s"` : '';
            // Preview: pastikan format "Nama: teks"
            // Pesan AI lama tersimpan "user: [AI] teks" → tampilkan sebagai "Pretvfx AI: teks"
            let prev = g.last_message_preview || ((g.member_count || 0) + ' anggota');
            {
                const aiMatch = String(prev).match(/^([^:]{1,40}):\s*(?:\[AI\]|⟦AI⟧|\[\[AI\]\])\s*(.*)$/i);
                if (aiMatch) {
                    prev = 'Pretvfx AI: ' + (aiMatch[2] || '').trim();
                } else if (/^\[AI\]\s/i.test(prev)) {
                    prev = 'Pretvfx AI: ' + String(prev).replace(/^\[AI\]\s*/i, '');
                }
            }
            let prevHtml = escapeHtml(prev);
            // Bold-kan bagian nama pengirim jika ada "Nama: "
            const colonIdx = prev.indexOf(': ');
            if (colonIdx > 0 && colonIdx < 40) {
                prevHtml = `<span class="prev-sender">${escapeHtml(prev.slice(0, colonIdx + 1))}</span> ${escapeHtml(prev.slice(colonIdx + 2))}`;
            }
            return `<div class="chat-item${gAnim}" data-id="${g.id}" ${delay}>
                ${av}
                <div class="body">
                    <div class="row1"><div class="name">${escapeHtml(g.name || 'Grup')}</div><div class="time">${mentionBadge}${badge}${g.last_message_at ? ' ' + timeShort(g.last_message_at) : ''}</div></div>
                    <div class="preview">${prevHtml}</div>
                </div>
            </div>`;
        }).join('');
        list.querySelectorAll('.chat-item').forEach(el => { el.addEventListener('click', () => openGroup(el.dataset.id)); });
    }

    /* ---------- BUAT GRUP ---------- */
    async function openCreateGroupModal() {
        document.getElementById('gc-create-page')?.remove();
        const page = document.createElement('div');
        page.className = 'gc-page';
        page.id = 'gc-create-page';
        let contacts = [];
        let selected = new Set();
        let avatarFile = null;
        let avatarPreviewUrl = null;

        page.innerHTML = `
            <div class="gc-top">
                <button type="button" class="icon-btn" id="gc-back" aria-label="Kembali"><svg class="icon"><use href="#i-back"/></svg></button>
                <h1>Grup baru</h1>
            </div>
            <div class="gc-search">
                <svg class="icon icon-sm search-ico"><use href="#i-search"/></svg>
                <input id="gc-filter" type="text" placeholder="Nama, @username..." autocomplete="off" disabled />
            </div>
            <div class="gc-section">Kontak</div>
            <div class="gc-list" id="gc-list">
                <div class="empty" style="padding:40px 20px"><div style="width:28px;height:28px;border:3px solid #ddd;border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px"></div><p class="muted small">Memuat kontak...</p></div>
            </div>
            <button type="button" class="gc-fab" id="gc-next" disabled title="Lanjut"><i class="fa-solid fa-arrow-right"></i></button>
        `;
        document.body.appendChild(page);
        page.querySelector('#gc-back').onclick = () => page.remove();

        try {
            const { data } = await API.get('/api/chat/contacts');
            contacts = data || [];
        } catch (e) {
            showToast(e.message || 'Gagal memuat kontak.');
            page.remove();
            return;
        }
        if (!contacts.length) {
            showToast('Belum ada kontak. Chat dulu dengan seseorang sebelum membuat grup.');
            page.remove();
            return;
        }

        function renderStep1() {
            page.innerHTML = `
                <div class="gc-top">
                    <button type="button" class="icon-btn" id="gc-back" aria-label="Kembali"><svg class="icon"><use href="#i-back"/></svg></button>
                    <h1>Grup baru</h1>
                </div>
                <div class="gc-search">
                    <svg class="icon icon-sm search-ico"><use href="#i-search"/></svg>
                    <input id="gc-filter" type="text" placeholder="Nama, @username..." autocomplete="off" />
                </div>
                <div class="gc-section">Kontak</div>
                <div class="gc-list" id="gc-list"></div>
                <button type="button" class="gc-fab" id="gc-next" disabled title="Lanjut"><i class="fa-solid fa-arrow-right"></i></button>
            `;
            const list = page.querySelector('#gc-list');
            const filterInp = page.querySelector('#gc-filter');
            const nextBtn = page.querySelector('#gc-next');
            const paint = () => {
                const q = (filterInp.value || '').trim().toLowerCase();
                const rows = contacts.filter(u => {
                    if (!q) return true;
                    const n = (u.display_name || '').toLowerCase();
                    const un = (u.username || '').toLowerCase();
                    return n.includes(q) || un.includes(q);
                });
                list.innerHTML = rows.map(u => {
                    const checked = selected.has(String(u.id)) ? 'checked' : '';
                    return `<label class="gc-row"><input type="checkbox" value="${u.id}" ${checked} />${avatarHTML(u)}<span class="who">${escapeHtml(u.display_name || u.username)}</span></label>`;
                }).join('') || '<div class="empty"><p class="muted small">Tidak ada kontak.</p></div>';
                list.querySelectorAll('input[type=checkbox]').forEach(cb => {
                    cb.addEventListener('change', () => {
                        if (cb.checked) selected.add(String(cb.value));
                        else selected.delete(String(cb.value));
                        nextBtn.disabled = selected.size === 0;
                    });
                });
                nextBtn.disabled = selected.size === 0;
            };
            paint();
            filterInp.addEventListener('input', paint);
            page.querySelector('#gc-back').onclick = () => page.remove();
            nextBtn.onclick = () => { if (selected.size) renderStep2(); };
        }

        function renderStep2() {
            const members = contacts.filter(u => selected.has(String(u.id)));
            page.innerHTML = `
                <div class="gc-top">
                    <button type="button" class="icon-btn" id="gc-back" aria-label="Kembali"><svg class="icon"><use href="#i-back"/></svg></button>
                    <h1>Info grup</h1>
                </div>
                <div class="gc-info">
                    <label class="gc-avatar-pick" id="gc-avatar-pick" title="Foto grup">
                        <i class="fa-solid fa-camera" id="gc-avatar-icon"></i>
                        <span class="cam"><i class="fa-solid fa-camera"></i></span>
                        <input type="file" id="gc-avatar-file" accept="image/*" hidden />
                    </label>
                    <input class="gc-name-input" id="gc-name" type="text" maxlength="60" placeholder="Nama grup" autocomplete="off" />
                    <p class="muted small" style="text-align:center;margin:0 0 8px">Berikan nama grup dan foto opsional</p>
                    <div class="gc-members-preview">
                        <div class="title">Anggota: ${members.length + 1} (termasuk kamu)</div>
                        ${members.map(u => `<div class="gc-row" style="padding:8px 0;border:0">${avatarHTML(u)}<span class="who">${escapeHtml(u.display_name || u.username)}</span></div>`).join('')}
                    </div>
                </div>
                <button type="button" class="gc-fab" id="gc-create" title="Buat grup"><i class="fa-solid fa-check"></i></button>
            `;
            page.querySelector('#gc-back').onclick = () => renderStep1();
            const pick = page.querySelector('#gc-avatar-pick');
            const fileInp = page.querySelector('#gc-avatar-file');
            pick.addEventListener('click', (e) => { if (e.target !== fileInp) fileInp.click(); });
            fileInp.addEventListener('change', () => {
                const f = fileInp.files && fileInp.files[0];
                if (!f) return;
                if (!f.type.startsWith('image/')) { showToast('File harus gambar'); return; }
                if (f.size > 5 * 1024 * 1024) { showToast('Maks 5 MB'); return; }
                avatarFile = f;
                if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
                avatarPreviewUrl = URL.createObjectURL(f);
                const icon = page.querySelector('#gc-avatar-icon');
                if (icon) icon.remove();
                let img = pick.querySelector('img');
                if (!img) { img = document.createElement('img'); pick.insertBefore(img, pick.firstChild); }
                img.src = avatarPreviewUrl;
            });
            page.querySelector('#gc-name').focus();
            page.querySelector('#gc-create').onclick = async () => {
                const name = page.querySelector('#gc-name').value.trim();
                if (!name) { showToast('Nama grup wajib diisi.'); return; }
                const btn = page.querySelector('#gc-create');
                btn.disabled = true;
                try {
                    let avatar_url = null;
                    if (avatarFile) {
                        const fd = new FormData();
                        fd.append('file', avatarFile);
                        try {
                            const up = await API.upload('/api/chat/upload/group', fd);
                            avatar_url = up.url || up.media_url || null;
                        } catch (upErr) {
                            console.warn('avatar upload', upErr);
                            showToast('Foto grup gagal diunggah, lanjut tanpa foto.');
                        }
                    }
                    const { group } = await API.post('/api/groups', {
                        name,
                        member_ids: [...selected],
                        avatar_url
                    });
                    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
                    page.remove();
                    await loadGroups();
                    openGroup(group.id);
                    showToast('Grup dibuat.');
                } catch (err) {
                    showToast(err.message || 'Gagal membuat grup.');
                    btn.disabled = false;
                }
            };
        }

        renderStep1();
    }

    /* ---------- OBROLAN GRUP ---------- */
    async function openGroup(gid) {
        const g = state.groups.find(x => String(x.id) === String(gid));
        if (!g) return;
        state.currentGroup = g;
        document.getElementById('gconv-name').textContent = g.name || 'Grup';
        document.getElementById('gconv-status').textContent = (g.member_count || 0) + ' anggota';
        const gav = document.getElementById('gconv-avatar');
        if (gav) {
            if (g.avatar_url) {
                if (gav.tagName === 'IMG') { gav.src = g.avatar_url; gav.className = 'avatar sm group-avatar'; }
                else {
                    const img = document.createElement('img');
                    img.id = 'gconv-avatar';
                    img.className = 'avatar sm group-avatar';
                    img.src = g.avatar_url;
                    img.alt = '';
                    gav.replaceWith(img);
                }
            } else {
                if (gav.tagName === 'IMG') {
                    const span = document.createElement('span');
                    span.id = 'gconv-avatar';
                    span.className = 'avatar sm group-avatar';
                    span.innerHTML = '<i class="fa-solid fa-users"></i>';
                    gav.replaceWith(span);
                } else {
                    gav.className = 'avatar sm group-avatar';
                    gav.innerHTML = '<i class="fa-solid fa-users"></i>';
                }
            }
        }
        document.getElementById('view-group').classList.remove('active');
        document.getElementById('view-group-conv').classList.add('active');
        document.getElementById('bottom-nav').classList.add('hidden');
        const gMsgCacheKey = 'pretv_gmsgs_' + gid;
        let showedCache = false;
        try {
            const cached = JSON.parse(localStorage.getItem(gMsgCacheKey) || 'null');
            if (Array.isArray(cached) && cached.length) {
                state.groupMessages = cached
                    .filter(m => m && m.id && !String(m.id).startsWith('tmp-'))
                    .map(m => { const x = Object.assign({}, m); delete x.uploading; return applyReplyParse(x); });
                memberCache[gid] = memberCache[gid] || {};
                state.groupMessages.forEach(m => { if (m.user) memberCache[gid][m.sender_id] = m.user; });
                renderMessages();
                scrollToBottom(false);
                showedCache = true;
            } else {
                msgsEl.innerHTML = '';
            }
        } catch (_) { msgsEl.innerHTML = ''; }
        try {
            const { data } = await API.get(`/api/groups/${gid}/messages?limit=100`);
            const fresh = (data || []).map(m => { const x = Object.assign({}, m); delete x.uploading; return applyReplyParse(x); });
            const oldIds = (state.groupMessages || []).map(m => String(m.id)).join(',');
            const newIds = fresh.map(m => String(m.id)).join(',');
            state.groupMessages = fresh;
            try { localStorage.setItem(gMsgCacheKey, JSON.stringify(fresh.slice(-80))); } catch (_) {}
            memberCache[gid] = memberCache[gid] || {};
            state.groupMessages.forEach(m => { if (m.user) memberCache[gid][m.sender_id] = m.user; });
            if (oldIds !== newIds || !showedCache) {
                renderMessages();
            }
            scrollToBottom(false);
            setTimeout(() => scrollToBottom(false), 120);
            API.post(`/api/groups/${gid}/read`, {}).catch(() => {});
            const gg = state.groups.find(x => x.id === gid);
            if (gg) { gg.unread_count = 0; gg.mentioned = false; renderGroups(); }
        } catch (e) {
            if (!(state.groupMessages && state.groupMessages.length)) showToast(e.message || 'Gagal memuat pesan grup.');
        }
    }

    function closeGroup() {
        const el = document.getElementById('view-group-conv');
        const finish = () => {
            if (el) {
                el.classList.remove('active');
                el.style.animation = '';
            }
            document.getElementById('view-group').classList.add('active');
            document.getElementById('bottom-nav').classList.remove('hidden');
        };
        if (el && el.classList.contains('active')) {
            el.style.animation = 'slideToRight .2s ease forwards';
            setTimeout(finish, 190);
        } else {
            finish();
        }
        state.currentGroup = null;
        setTimeout(() => loadGroups(), 220);
    }

    function scrollToBottom(smooth) {
        if (!msgsEl) return;
        const go = () => { msgsEl.scrollTop = msgsEl.scrollHeight; };
        go();
        requestAnimationFrame(() => { go(); if (!smooth) setTimeout(go, 50); setTimeout(go, 150); });
        if (smooth) msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: 'smooth' });
    }

    function renderMessages() {
        let prevSender = null;
        msgsEl.innerHTML = state.groupMessages.map((m) => {
            const sid = String(m.sender_id);
            const me = sid === String(state.me.id);
            const showHead = !me && sid !== prevSender;
            prevSender = me ? null : sid;
            return renderMessage(m, { showHead });
        }).join('');
        bindAudioMeta(msgsEl);
    }
    function shouldShowHead(m) {
        if (String(m.sender_id) === String(state.me.id)) return false;
        // lihat pesan terakhir di list (sebelum yang ini ditambah)
        const list = state.groupMessages;
        // cari index m; ambil prev
        let prev = null;
        for (let i = list.length - 1; i >= 0; i--) {
            if (String(list[i].id) === String(m.id)) {
                prev = list[i - 1] || null;
                break;
            }
        }
        if (!prev && list.length && String(list[list.length - 1].id) !== String(m.id)) {
            prev = list[list.length - 1];
        }
        if (!prev) return true;
        return String(prev.sender_id) !== String(m.sender_id);
    }

    function renderMessage(m, opts) {
        opts = opts || {};
        m = applyReplyParse(Object.assign({}, m));
        // Deteksi pesan AI (prefix [AI])
        if (typeof AIModule !== 'undefined' && m.content) {
            const det = AIModule.detectAiContent(m.content);
            if (det.isAi) {
                m.content = det.text;
                m.is_ai = true;
                m.user = AIModule.getAiUser();
                m.sender_id = AIModule.getAiUser().id;
            }
        }
        const isAi = !!m.is_ai;
        const me = !isAi && String(m.sender_id) === String(state.me.id);
        const cls = me ? 'me' : 'other';
        const uploading = !!m.uploading;
        // showHead = tampilkan avatar + nama; AI selalu tampilkan head + logo
        const showHead = isAi ? true : (!me && (opts.showHead !== false));
        let inner = '';
        let fallbackUser = m.user || (memberCache[m.group_id] && memberCache[m.group_id][m.sender_id]) || null;
        if (isAi && typeof AIModule !== 'undefined') {
            fallbackUser = AIModule.getAiUser();
            m.user = fallbackUser;
        }
        if (showHead) {
            const name = escapeHtml(fallbackUser?.display_name || fallbackUser?.username || 'Pengguna');
            inner += `<div class="msg-sender">${name}</div>`;
        }
        const mt = m.message_type || 'text';
        const isOnce = mt === 'image_once' || mt === 'video_once';
        const baseType = mt === 'image_once' ? 'image' : mt === 'video_once' ? 'video' : mt;
        if (m.reply_to_id) inner += renderReplyQuoteHtml(m);
        if (isOnce && m.media_url) {
            const opened = !me && (() => { try { return localStorage.getItem('pretv_viewonce_' + m.id) === '1'; } catch (_) { return false; } })();
            const label = baseType === 'video' ? 'Video' : 'Foto';
            if (opened) {
                inner += `<div class="vo-bubble vo-opened" data-view-once="1" data-media-type="${baseType}">
                    <div class="vo-ico"><svg class="icon"><use href="#i-view-once"/></svg></div>
                    <div class="vo-body"><div class="vo-title">${label} telah dilihat</div><div class="vo-sub">Sekali lihat</div></div>
                </div>`;
            } else {
                const sub = me ? (uploading ? 'Mengirim...' : 'Sekali lihat · bisa dibuka berkali-kali') : (uploading ? 'Mengirim...' : 'Ketuk untuk membuka');
                inner += `<div class="vo-bubble media-wrap" data-view-once="1" data-media-type="${baseType}">
                    <div class="vo-ico"><svg class="icon"><use href="#i-view-once"/></svg><span class="vo-1">1</span></div>
                    <div class="vo-body"><div class="vo-title">${label}</div><div class="vo-sub">${sub}</div></div>
                </div>`;
            }
        } else if (mt === 'image' && m.media_url) {
            inner += `<div class="media-wrap ${uploading ? 'media-uploading' : ''}" data-media-type="image"><img src="${m.media_url}" alt="Foto" loading="lazy" />${uploading ? `<div class="media-upload-status"><span class="media-upload-spinner"></span><span>Sedang mengirim...</span></div>` : ''}</div>`;
        } else if (mt === 'video' && m.media_url) {
            inner += `<div class="media-wrap ${uploading ? 'media-uploading' : ''}" data-media-type="video">${uploading ? '' : '<div class="media-video-loading"><div class="spin-ring"></div></div>'}<video class="${uploading ? '' : 'is-loading'}" src="${m.media_url}#t=0.1" muted playsinline preload="metadata" disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" onloadeddata="this.classList.remove('is-loading');this.classList.add('is-ready');this.style.opacity=1;var l=this.parentNode.querySelector('.media-video-loading');if(l)l.remove();"></video>${uploading ? '' : '<div class="video-play-badge"><i class="fa-solid fa-play"></i></div>'}${uploading ? `<div class="media-upload-status"><span class="media-upload-spinner"></span><span>Sedang mengirim...</span></div>` : ''}</div>`;
        } else if (mt === 'audio' && m.media_url) {
            const u = me ? state.me : (m.user || (memberCache[m.group_id] && memberCache[m.group_id][m.sender_id]) || null);
            const avUrl = u && u.avatar_url;
            const nm = (u && (u.display_name || u.username)) || '?';
            const parts = String(nm).trim().split(/\s+/).filter(Boolean);
            const ini = ((parts[0]||'?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
            const avInner = avUrl ? `<img src="${avUrl}" alt="" />` : ini;
            const bars = Array.from({length:28},()=>'<span></span>').join('');
            inner += `<div class="msg-audio" data-audio-id="${m.id}">
                <div class="audio-av">${avInner}<span class="mic-badge"><svg class="icon" style="width:9px;height:9px"><use href="#i-mic"/></svg></span></div>
                <div class="audio-main">
                    <div class="audio-row">
                        <button type="button" class="audio-play" data-audio-play="${m.id}" aria-label="Putar"><svg class="icon"><use href="#i-play"/></svg></button>
                        <div class="audio-wave" id="aw-${m.id}">${bars}</div>
                    </div>
                    <div class="audio-meta"><span class="audio-dur" id="adur-${m.id}">0:00</span></div>
                </div>
                <audio preload="none" src="${m.media_url}" data-src="${m.media_url}" id="audio-${m.id}"></audio>
            </div>`;
        } else if (mt === 'sticker') {
            inner += renderStickerInner(m);
        }
        if (m.content && mt !== 'sticker') inner += `<span class="msg-text">${linkifyText(m.content)}</span>`;
        const statusText = uploading ? `<span class="uploading-text">Mengirim...</span>` : '';
        const stickerCls = (mt === 'sticker') ? (' sticker-msg' + (m.reply_to_id ? ' sticker-with-reply' : '')) : '';
        const bubble = `<div class="msg ${cls}${stickerCls} ${uploading ? 'is-uploading' : ''}" data-id="${m.id}">${inner}<div class="meta"><span>${uploading ? '' : timeShort(m.created_at)}</span>${statusText}</div></div>`;
        if (me) return bubble;
        // Avatar di ATAS (sejajar nama), bukan di bawah — gaya WhatsApp
        if (showHead) {
            const avUrl = fallbackUser?.avatar_url || '';
            const initial = (fallbackUser?.display_name || fallbackUser?.username || '?').trim().charAt(0).toUpperCase() || '?';
            let avHtml;
            if (avUrl) {
                const fb = isAi ? (typeof AIModule !== 'undefined' ? AIModule.AI_AVATAR_FALLBACK : '') : '';
                const onerr = isAi
                    ? ` onerror="this.onerror=null;this.src='./assets/ai-logo.svg';"`
                    : '';
                avHtml = `<span class="msg-av"><img src="${escapeHtml(avUrl)}" alt=""${onerr} /></span>`;
            } else {
                avHtml = `<span class="msg-av">${escapeHtml(initial)}</span>`;
            }
            return `<div class="msg-with-av${isAi ? ' ai-msg-group' : ''}" data-id="${m.id}">${avHtml}${bubble}</div>`;
        }
        // Pesan lanjutan pengirim sama: spacer biar rata, tanpa avatar/nama
        return `<div class="msg-with-av" data-id="${m.id}"><span class="msg-av-spacer"></span>${bubble}</div>`;
    }

    function findMsgNode(id) {
        // Bisa di wrapper .msg-with-av atau langsung .msg
        return msgsEl.querySelector(`.msg-with-av[data-id="${id}"]`) || msgsEl.querySelector(`.msg[data-id="${id}"]`);
    }
    function removeMsgNode(id) {
        const el = findMsgNode(id);
        if (el) el.remove();
    }
    function replaceMsgNode(id, html) {
        const el = findMsgNode(id);
        if (!el) return false;
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        el.replaceWith(wrap.firstChild);
        return true;
    }

    function replaceTempGroupMessage(tempId, message) {
        const existingIdx = state.groupMessages.findIndex(m => String(m.id) === String(message.id));
        const tempIdx = state.groupMessages.findIndex(m => String(m.id) === String(tempId));
        if (existingIdx >= 0 && tempIdx >= 0 && existingIdx !== tempIdx) {
            state.groupMessages.splice(tempIdx, 1);
            removeMsgNode(tempId);
            return;
        }
        if (tempIdx >= 0) {
            state.groupMessages[tempIdx] = message;
            if (!replaceMsgNode(tempId, renderMessage(message, { showHead: shouldShowHead(message) }))) {
                msgsEl.insertAdjacentHTML('beforeend', renderMessage(message, { showHead: shouldShowHead(message) }));
            }
        } else if (existingIdx < 0) {
            state.groupMessages.push(message);
            msgsEl.insertAdjacentHTML('beforeend', renderMessage(message, { showHead: shouldShowHead(message) }));
        }
        const g = state.groups.find(x => String(x.id) === String(message.group_id));
        if (g) {
            g.last_message_at = message.created_at;
            // Deteksi AI → preview pakai nama Pretvfx AI
            let isAi = !!(message.is_ai || message.user?.is_ai);
            let bodyRaw = message.content || '';
            if (!isAi && typeof AIModule !== 'undefined' && AIModule.detectAiContent) {
                const det = AIModule.detectAiContent(bodyRaw);
                if (det.isAi) { isAi = true; bodyRaw = det.text; }
            }
            const sn = isAi
                ? ((typeof AIModule !== 'undefined' && AIModule.AI_DISPLAY) ? AIModule.AI_DISPLAY : 'Pretvfx AI')
                : (message.user?.display_name || message.user?.username || state.me?.display_name || state.me?.username || 'User');
            const bodyPrev = isAi
                ? bodyRaw
                : (message.content || (message.message_type === 'image' || message.message_type === 'image_once' ? 'Foto' : message.message_type === 'video' || message.message_type === 'video_once' ? 'Video' : message.message_type === 'sticker' ? 'Stiker' : message.message_type === 'audio' ? 'Pesan suara' : ''));
            g.last_message_preview = sn + ': ' + bodyPrev;
            g.last_sender_id = message.sender_id;
        }
    }

    let groupReplyTo = null;
    function setGroupReplyTo(m) {
        groupReplyTo = m;
        window.__activeReplyMsg = m;
        window.__activeReplyIsGroup = true;
        const bar = document.getElementById('group-reply-bar');
        if (!bar) return;
        const nameEl = document.getElementById('group-reply-name');
        const textEl = document.getElementById('group-reply-text');
        const thumbEl = document.getElementById('group-reply-thumb');
        // AI dianggap akun sendiri
        let isAi = !!(m.is_ai || m.user?.is_ai || String(m.sender_id) === 'ai-bot-pretvfx');
        if (!isAi && typeof AIModule !== 'undefined' && AIModule.detectAiContent && m.content) {
            try { isAi = !!AIModule.detectAiContent(m.content).isAi; } catch (_) {}
        }
        const isMe = !isAi && String(m.sender_id) === String(state.me.id);
        const u = m.user || (memberCache[m.group_id] && memberCache[m.group_id][m.sender_id]) || null;
        if (isAi) {
            nameEl.textContent = (typeof AIModule !== 'undefined' && AIModule.AI_DISPLAY) ? AIModule.AI_DISPLAY : 'Pretvfx AI';
        } else {
            // Bar composer: "Anda" OK untuk pesan sendiri; nama asli disimpan lewat buildReplyPayload
            nameEl.textContent = isMe
                ? 'Anda'
                : (u?.display_name || u?.username || m._replySenderName || 'Pesan');
        }
        textEl.textContent = replyPreviewText(m);
        const mt = m.message_type || 'text';
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
    function clearGroupReplyTo() {
        groupReplyTo = null;
        window.__activeReplyMsg = null;
        window.__groupReplySticker = null;
        document.getElementById('group-reply-bar')?.classList.remove('visible');
    }

    async function onSendText(e) {
        if (e) e.preventDefault();
        const text = input.value.trim();
        if (!text || !state.currentGroup) return;
        const tempId = 'tmp-' + Date.now();
        if (!groupReplyTo && window.__groupReplySticker) {
            groupReplyTo = window.__groupReplySticker;
            window.__groupReplySticker = null;
        }
        const replyPayload = buildReplyPayload(groupReplyTo, state.me.id);
        const optimistic = { id: tempId, group_id: state.currentGroup.id, sender_id: state.me.id, message_type: 'text', content: text, created_at: new Date().toISOString(), user: state.me, ...replyPayload };
        state.groupMessages.push(optimistic);
        msgsEl.insertAdjacentHTML('beforeend', renderMessage(optimistic, { showHead: shouldShowHead(optimistic) }));
        scrollToBottom(true);
        input.value = ''; autoGrow(); updateGroupComposerMode();
        clearGroupReplyTo();
        window.__groupReplySticker = null;
        hideMentionPicker();
        try {
            const { message } = await API.post(`/api/groups/${state.currentGroup.id}/messages`, { message_type: 'text', content: text, ...replyPayload });
            replaceTempGroupMessage(tempId, applyReplyParse({ ...message, ...replyPayload }));
            scrollToBottom(true);
            // AI auto-reply jika tag @Pretvfx-AI
            if (typeof AIModule !== 'undefined' && AIModule.isAiMention(text)) {
                AIModule.maybeReplyInGroup(state.currentGroup.id, { content: text }).then(() => {
                    // reload / realtime akan menambah pesan AI
                }).catch(() => {});
            }
        } catch (e) {
            showToast('Gagal mengirim pesan.');
            const idx = state.groupMessages.findIndex(m => m.id === tempId);
            if (idx >= 0) state.groupMessages.splice(idx, 1);
            removeMsgNode(tempId);
        }
    }

    function updateGroupComposerMode() {
        const hasText = !!(input && input.value.trim());
        const sendEl = document.getElementById('group-send-btn');
        const micEl = document.getElementById('group-mic-btn');
        if (sendEl) sendEl.classList.toggle('hidden', !hasText);
        if (micEl) micEl.classList.toggle('hidden', hasText);
    }

    // Pakai cache voice yang sama (session) — voiceCache di ChatModule tidak aksesibel,
    // jadi mirror cache di scope group juga via window
    if (!window.__voiceCache) window.__voiceCache = new Map();
    const gVoiceCache = window.__voiceCache;
    let gActiveVoiceId = null;

    function formatAudioDur(s) {
        const n = Number(s);
        if (!isFinite(n) || n < 0) return '0:00';
        const sec = Math.floor(n);
        return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }
    function bindAudioMeta(root) { /* on-demand */ }

    function gSetPlayIcon(btn, mode) {
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

    function gResetVoiceUi(id) {
        const btn = msgsEl && msgsEl.querySelector('[data-audio-play="' + id + '"]');
        const wave = document.getElementById('aw-' + id);
        const durEl = document.getElementById('adur-' + id);
        const audio = document.getElementById('audio-' + id);
        gSetPlayIcon(btn, 'play');
        if (wave) wave.classList.remove('playing');
        if (durEl && audio && isFinite(audio.duration) && audio.duration > 0)
            durEl.textContent = formatAudioDur(audio.duration);
    }

    function gPauseAll(exceptId) {
        if (!msgsEl) return;
        msgsEl.querySelectorAll('audio[id^="audio-"]').forEach(a => {
            const oid = a.id.replace('audio-', '');
            if (exceptId && oid === String(exceptId)) return;
            try { a.pause(); } catch (_) {}
            gResetVoiceUi(oid);
        });
        if (!exceptId) gActiveVoiceId = null;
    }

    async function gResolveSrc(audio) {
        const original = audio.getAttribute('data-src') || audio.getAttribute('src') || '';
        if (!original || original.startsWith('blob:')) return original;
        if (gVoiceCache.has(original)) return gVoiceCache.get(original);
        const res = await fetch(original, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        gVoiceCache.set(original, blobUrl);
        if (gVoiceCache.size > 20) {
            const first = gVoiceCache.keys().next().value;
            const old = gVoiceCache.get(first);
            gVoiceCache.delete(first);
            try { URL.revokeObjectURL(old); } catch (_) {}
        }
        return blobUrl;
    }

    function ensureGroupAudioBound(audio, btn, wave, durEl) {
        if (audio._bound) return;
        audio._bound = true;
        if (!audio.getAttribute('data-src') && audio.src)
            audio.setAttribute('data-src', audio.getAttribute('src') || audio.src);
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
            gSetPlayIcon(btn, 'play');
            if (wave) wave.classList.remove('playing');
            if (durEl && isFinite(audio.duration)) durEl.textContent = formatAudioDur(audio.duration);
            if (gActiveVoiceId === audio.id.replace('audio-', '')) gActiveVoiceId = null;
        });
        audio.addEventListener('error', () => {
            gSetPlayIcon(btn, 'play');
            if (wave) wave.classList.remove('playing');
        });
    }

    async function playGroupVoiceNote(audio, btn, wave, durEl) {
        const id = audio.id.replace('audio-', '');
        ensureGroupAudioBound(audio, btn, wave, durEl);

        if (!audio.paused) {
            try { audio.pause(); } catch (_) {}
            gSetPlayIcon(btn, 'play');
            if (wave) wave.classList.remove('playing');
            if (durEl && isFinite(audio.duration) && audio.duration > 0)
                durEl.textContent = formatAudioDur(audio.duration);
            gActiveVoiceId = null;
            return;
        }
        if (btn && btn.dataset.state === 'playing') {
            gSetPlayIcon(btn, 'play');
            if (wave) wave.classList.remove('playing');
            gActiveVoiceId = null;
        }

        gPauseAll(id);
        gSetPlayIcon(btn, 'loading');
        try {
            const src = await gResolveSrc(audio);
            if (audio.src !== src) {
                audio.src = src;
                audio.preload = 'auto';
            }
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
            gActiveVoiceId = id;
            gSetPlayIcon(btn, 'pause');
            if (wave) wave.classList.add('playing');
            if (durEl && isFinite(audio.duration) && audio.duration > 0)
                durEl.textContent = formatAudioDur(audio.duration);
        } catch (err) {
            gSetPlayIcon(btn, 'play');
            if (wave) wave.classList.remove('playing');
            gActiveVoiceId = null;
            showToast('Gagal memutar suara');
        }
    }

    function onGroupAudioPlayClick(e) {
        const btn = e.target.closest('[data-audio-play]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (btn.dataset.state === 'loading') return;
        const id = btn.dataset.audioPlay;
        const audio = document.getElementById('audio-' + id);
        if (!audio) return;
        const wave = document.getElementById('aw-' + id);
        const durEl = document.getElementById('adur-' + id);
        playGroupVoiceNote(audio, btn, wave, durEl);
    }


    let gMediaRecorder = null, gRecChunks = [], gRecTimer = null, gRecStart = 0, gRecStream = null;

    async function startGroupVoice() {
    if (!state.currentGroup) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Perangkat tidak mendukung rekaman suara.');
        return;
    }

    // 🎤 Minta izin mic via bridge
    if (typeof AndroidMic !== 'undefined' && AndroidMic && AndroidMic.hasMicPermission) {
        const has = AndroidMic.hasMicPermission();
        if (!has) {
            AndroidMic.requestMic();
            showToast('Izinkan akses mikrofon, lalu coba lagi.', 3000);
            return;
        }
    }

    try {
        gRecStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // ... dst
            gRecChunks = [];
            const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
                : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
            gMediaRecorder = mime ? new MediaRecorder(gRecStream, { mimeType: mime }) : new MediaRecorder(gRecStream);
            gMediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) gRecChunks.push(ev.data); };
            gMediaRecorder.start(200);
            gRecStart = Date.now();
            composer.classList.add('recording');
            const micEl = document.getElementById('group-mic-btn');
            if (micEl) micEl.classList.add('recording');
            const timeEl = document.getElementById('group-rec-time');
            if (timeEl) timeEl.textContent = '0:00';
            clearInterval(gRecTimer);
            gRecTimer = setInterval(() => {
                const s = Math.floor((Date.now() - gRecStart) / 1000);
                if (timeEl) timeEl.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
                if (s >= 120) sendGroupVoice();
            }, 250);
        } catch (err) {
            showToast('Izin mikrofon ditolak atau tidak tersedia.');
        }
    }

    function stopGroupRecTracks() {
        try { if (gMediaRecorder && gMediaRecorder.state !== 'inactive') gMediaRecorder.stop(); } catch (_) {}
        gMediaRecorder = null;
        if (gRecStream) { gRecStream.getTracks().forEach(t => t.stop()); gRecStream = null; }
        clearInterval(gRecTimer); gRecTimer = null;
        composer.classList.remove('recording');
        const micEl = document.getElementById('group-mic-btn');
        if (micEl) micEl.classList.remove('recording');
    }

    function cancelGroupVoice() {
        gRecChunks = [];
        stopGroupRecTracks();
        updateGroupComposerMode();
    }

    async function sendGroupVoice() {
        if (!state.currentGroup) { cancelGroupVoice(); return; }
        const chunks = gRecChunks.slice();
        const mimeType = (gMediaRecorder && gMediaRecorder.mimeType) || 'audio/webm';
        stopGroupRecTracks();
        if (!chunks.length) { showToast('Rekaman kosong.'); updateGroupComposerMode(); return; }
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 200) { showToast('Rekaman terlalu pendek.'); updateGroupComposerMode(); return; }
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], 'voice-' + Date.now() + '.' + ext, { type: mimeType });
        const tempId = 'tmp-audio-' + Date.now();
        const tempUrl = URL.createObjectURL(blob);
        // Support reply (quote) saat kirim pesan suara di grup — seperti WhatsApp
        if (!groupReplyTo && window.__groupReplySticker) {
            groupReplyTo = window.__groupReplySticker;
            window.__groupReplySticker = null;
        }
        const replyPayload = buildReplyPayload(groupReplyTo, state.me.id);
        const optimistic = {
            id: tempId, group_id: state.currentGroup.id, sender_id: state.me.id,
            message_type: 'audio', media_url: tempUrl, content: '', created_at: new Date().toISOString(), uploading: true,
            user: state.me, ...replyPayload
        };
        state.groupMessages.push(optimistic);
        msgsEl.insertAdjacentHTML('beforeend', renderMessage(optimistic, { showHead: shouldShowHead(optimistic) }));
        scrollToBottom(true);
        clearGroupReplyTo();
        window.__groupReplySticker = null;
        try {
            const fd = new FormData();
            fd.append('file', file);
            const { url } = await API.upload('/api/chat/upload/group', fd);
            const { message } = await API.post(`/api/groups/${state.currentGroup.id}/messages`, {
                message_type: 'audio', media_url: url, content: '', ...replyPayload
            });
            URL.revokeObjectURL(tempUrl);
            replaceTempGroupMessage(tempId, applyReplyParse({ ...message, ...replyPayload }));
            scrollToBottom(true);
        } catch (e) {
            URL.revokeObjectURL(tempUrl);
            const at = state.groupMessages.findIndex(m => m.id === tempId);
            if (at >= 0) state.groupMessages.splice(at, 1);
            const el = msgsEl.querySelector(`.msg[data-id="${tempId}"]`);
            if (el) el.remove();
            showToast(e.message || 'Gagal kirim suara.');
        }
        updateGroupComposerMode();
    }

    let gPendingMedia = null;

    async function onGroupPickMedia(e) {
        const file0 = e.target.files?.[0];
        if (!file0 || !state.currentGroup) return;
        try { e.target.value = ''; } catch (_) {}
        if (fileInput) fileInput.value = '';
        if (!/^image\/(.+)|^video\/(.+)/i.test(file0.type)) { showToast('File harus foto atau video.'); return; }
        let file = file0;
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
        gPendingMedia = { file, type, url, viewOnce: false };
        openGroupMediaCompose();
    }

    function openGroupMediaCompose() {
        if (!gPendingMedia) return;
        let sheet = document.getElementById('media-compose-sheet');
        if (sheet) sheet.remove();
        sheet = document.createElement('div');
        sheet.id = 'media-compose-sheet';
        sheet.className = 'media-compose';

// 🎨 Status bar hitam
setDarkStatusBar(true);
        const isVid = gPendingMedia.type === 'video';
        sheet.innerHTML = `
            <div class="mc-top">
                <button type="button" class="mc-btn" data-mc="close" aria-label="Tutup"><svg class="icon"><use href="#i-close"/></svg></button>
                <div class="mc-spacer"></div>
                <button type="button" class="mc-btn" data-mc="once" aria-label="Sekali lihat" title="Sekali lihat"><svg class="icon"><use href="#i-view-once"/></svg></button>
            </div>
            <div class="mc-once-hint ${gPendingMedia.viewOnce ? '' : 'hidden'}" id="mc-once-hint">Sekali lihat aktif — anggota hanya bisa buka 1 kali</div>
            <div class="mc-preview">
                ${isVid ? `<video src="${gPendingMedia.url}" controls playsinline></video>` : `<img src="${gPendingMedia.url}" alt="" />`}
            </div>
            <div class="mc-bottom">
                <input type="text" class="mc-caption" id="mc-caption" placeholder="Tambah keterangan..." maxlength="500" />
                <button type="button" class="mc-send" data-mc="send" aria-label="Kirim"><svg class="icon"><use href="#i-send"/></svg></button>
            </div>`;
        document.body.appendChild(sheet);
        const onceBtn = sheet.querySelector('[data-mc="once"]');
        if (gPendingMedia.viewOnce) onceBtn.classList.add('active');
        sheet.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-mc]');
    if (!btn) return;
    const act = btn.dataset.mc;
    if (act === 'close') {
        URL.revokeObjectURL(gPendingMedia.url);
        gPendingMedia = null;
        sheet.remove();
        // 🎨 Status bar balik putih
        setDarkStatusBar(false);
    } else if (act === 'once') {
        gPendingMedia.viewOnce = !gPendingMedia.viewOnce;
        btn.classList.toggle('active', gPendingMedia.viewOnce);
        const hint = document.getElementById('mc-once-hint');
        if (hint) hint.classList.toggle('hidden', !gPendingMedia.viewOnce);
    } else if (act === 'send') {
        const caption = (document.getElementById('mc-caption')?.value || '').trim();
        sheet.remove();
        // 🎨 Status bar balik putih (upload jalan di background)
        setDarkStatusBar(false);
        sendGroupPendingMedia(caption);
    }
});
  }
    async function sendGroupPendingMedia(caption) {
        if (!gPendingMedia || !state.currentGroup) return;
        const { file, type, url, viewOnce } = gPendingMedia;
        gPendingMedia = null;
        const msgType = viewOnce ? (type + '_once') : type;
        const tempId = 'tmp-media-' + Date.now();
        // Support reply (quote) saat kirim foto/video di grup — seperti WhatsApp
        if (!groupReplyTo && window.__groupReplySticker) {
            groupReplyTo = window.__groupReplySticker;
            window.__groupReplySticker = null;
        }
        const replyPayload = buildReplyPayload(groupReplyTo, state.me.id);
        const optimistic = {
            id: tempId, group_id: state.currentGroup.id, sender_id: state.me.id,
            message_type: msgType, media_url: url, content: caption || '',
            created_at: new Date().toISOString(), uploading: true, _size: file.size,
            user: state.me, ...replyPayload
        };
        state.groupMessages.push(optimistic);
        msgsEl.insertAdjacentHTML('beforeend', renderMessage(optimistic, { showHead: shouldShowHead(optimistic) }));
        scrollToBottom(true);
        clearGroupReplyTo();
        window.__groupReplySticker = null;
        sendBtn.disabled = true;
        try {
            const fd = new FormData();
            fd.append('file', file);
            const { url: remote } = await API.upload('/api/chat/upload/group', fd);
            const { message } = await API.post(`/api/groups/${state.currentGroup.id}/messages`, {
                message_type: msgType, media_url: remote, content: caption || '', ...replyPayload
            });
            URL.revokeObjectURL(url);
            replaceTempGroupMessage(tempId, applyReplyParse({ ...message, ...replyPayload }));
            scrollToBottom(true);
        } catch (e) {
            URL.revokeObjectURL(url);
            const at = state.groupMessages.findIndex(m => m.id === tempId);
            if (at >= 0) state.groupMessages.splice(at, 1);
            const el = msgsEl.querySelector(`.msg[data-id="${tempId}"]`);
            if (el) el.remove();
            showToast(e.message || 'Gagal mengirim media.');
        } finally {
            sendBtn.disabled = false;
            updateGroupComposerMode();
        }
    }

    async function onSendMedia(e) { onGroupPickMedia(e); }


    function openGroupMessageMenu(msgId) {
        const m = state.groupMessages.find(x => String(x.id) === String(msgId));
        if (!m) return;
        const mine = String(m.sender_id) === String(state.me.id);
        const u = m.user || (memberCache[m.group_id] && memberCache[m.group_id][m.sender_id]) || null;
        const title = mine ? 'Pesan kamu' : ('Pesan dari ' + (u?.display_name || u?.username || 'Anggota'));
        const backdrop = document.createElement('div');
        backdrop.className = 'action-sheet-backdrop';
        const sheet = document.createElement('div');
        sheet.className = 'action-sheet';
        const canCopy = (m.message_type || 'text') === 'text' && (m.content || '').trim();
        const canForward = !!(m.media_url || (m.message_type || 'text') === 'text' || (m.message_type || '') === 'sticker');
        sheet.innerHTML = `
            <div class="handle"></div>
            <div class="as-title">${escapeHtml(title)}</div>
            <button class="as-btn" data-act="reply"><svg class="icon icon-sm"><use href="#i-back"/></svg> Balas</button>
            ${canForward ? `<button class="as-btn" data-act="forward"><svg class="icon icon-sm"><use href="#i-share"/></svg> Teruskan</button>` : ''}
            ${canCopy ? `<button class="as-btn" data-act="copy"><svg class="icon icon-sm"><use href="#i-check"/></svg> Salin teks</button>` : ''}
            ${m.media_url && !String(m.message_type||'').includes('once') ? `<button class="as-btn" data-act="open"><svg class="icon icon-sm"><use href="#i-download"/></svg> Buka media</button>` : ''}
            ${mine ? `<button class="as-btn danger" data-act="delete"><svg class="icon icon-sm"><use href="#i-trash"/></svg> Hapus pesan</button>` : ''}
        `;
        document.body.appendChild(backdrop);
        document.body.appendChild(sheet);
        const closeSheet = () => { sheet.classList.add('closing'); backdrop.style.animation = 'fadeOut .2s ease forwards'; setTimeout(() => { sheet.remove(); backdrop.remove(); }, 210); };
        backdrop.onclick = closeSheet;
        sheet.onclick = async (e) => {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;
            if (act === 'reply') {
                closeSheet();
                m._replySenderName = mine
                    ? (state.me?.display_name || state.me?.username || 'Pengguna')
                    : (u?.display_name || u?.username || 'Pesan');
                setGroupReplyTo(m);
                return;
            }
            if (act === 'forward') {
                closeSheet();
                if (typeof openForwardPicker === 'function') openForwardPicker(m);
                else if (typeof ChatModule !== 'undefined' && ChatModule.openForwardPicker) ChatModule.openForwardPicker(m);
                else showToast('Fitur teruskan belum siap');
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
                    await API.del(`/api/groups/${state.currentGroup.id}/messages/${m.id}`);
                    state.groupMessages = state.groupMessages.filter(x => String(x.id) !== String(m.id));
                    renderMessages();
                    showToast('Pesan dihapus.');
                } catch (err) { showToast(err.message || 'Gagal hapus.'); }
            }
        };
    }

    /* ---------- INFO / HAPUS GRUP / KELUAR GRUP ---------- */
    function openGiTextPrompt({ title, value, placeholder, maxLength, multiline }) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-card" style="text-align:left">
                    <h3 style="margin:0 0 4px;font-size:17px">${escapeHtml(title || '')}</h3>
                    ${multiline
                        ? `<textarea class="gi-prompt-input" rows="4" ${maxLength ? `maxlength="${maxLength}"` : ''} placeholder="${escapeHtml(placeholder || '')}"></textarea>`
                        : `<input class="gi-prompt-input" type="text" ${maxLength ? `maxlength="${maxLength}"` : ''} placeholder="${escapeHtml(placeholder || '')}" />`}
                    <div class="modal-actions">
                        <button type="button" class="btn" data-act="cancel" style="flex:1">Batal</button>
                        <button type="button" class="btn primary" data-act="save" style="flex:1">Simpan</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            const field = modal.querySelector('.gi-prompt-input');
            field.value = value || '';
            setTimeout(() => { field.focus(); if (field.select) field.select(); }, 30);
            const close = (result) => { modal.remove(); resolve(result); };
            modal.querySelector('[data-act="cancel"]').onclick = () => close(null);
            modal.querySelector('[data-act="save"]').onclick = () => close(field.value);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(null); });
            if (!multiline) field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(field.value); } });
        });
    }

    
    async function openAddMemberSheet(g, currentMembers, onAdded) {
        document.getElementById('gi-add-page')?.remove();
        const page = document.createElement('div');
        page.className = 'gc-page';
        page.id = 'gi-add-page';
        page.innerHTML = `
            <div class="gc-top">
                <button type="button" class="icon-btn" id="gia-back" aria-label="Kembali"><svg class="icon"><use href="#i-back"/></svg></button>
                <h1>Tambah anggota</h1>
            </div>
            <div class="gc-search">
                <svg class="icon icon-sm search-ico"><use href="#i-search"/></svg>
                <input id="gia-filter" type="text" placeholder="Nama, @username..." autocomplete="off" disabled />
            </div>
            <div class="gc-section">Kontak</div>
            <div class="gc-list" id="gia-list">
                <div class="empty" style="padding:40px 20px"><div style="width:28px;height:28px;border:3px solid #ddd;border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px"></div><p class="muted small">Memuat kontak...</p></div>
            </div>
            <button type="button" class="gc-fab" id="gia-add" disabled title="Tambah"><i class="fa-solid fa-check"></i></button>
        `;
        document.body.appendChild(page);
        page.querySelector('#gia-back').onclick = () => page.remove();

        const existingIds = new Set(currentMembers.map(m => String(m.user_id)));
        let contacts = [];
        try {
            const { data } = await API.get('/api/chat/contacts');
            contacts = (data || []).filter(u => !existingIds.has(String(u.id)));
        } catch (e) {
            showToast(e.message || 'Gagal memuat kontak.');
            page.remove();
            return;
        }
        if (!contacts.length) {
            showToast('Tidak ada kontak baru yang bisa ditambahkan.');
            page.remove();
            return;
        }

        const selected = new Set();
        const list = page.querySelector('#gia-list');
        const filterInp = page.querySelector('#gia-filter');
        const addBtn = page.querySelector('#gia-add');
        filterInp.disabled = false;
        const paintList = () => {
            const q = (filterInp.value || '').trim().toLowerCase();
            const rows = contacts.filter(u => {
                if (!q) return true;
                const n = (u.display_name || '').toLowerCase();
                const un = (u.username || '').toLowerCase();
                return n.includes(q) || un.includes(q);
            });
            list.innerHTML = rows.map(u => {
                const checked = selected.has(String(u.id)) ? 'checked' : '';
                return `<label class="gc-row"><input type="checkbox" value="${u.id}" ${checked} />${avatarHTML(u)}<span class="who">${escapeHtml(u.display_name || u.username)}</span></label>`;
            }).join('') || '<div class="empty"><p class="muted small">Tidak ada kontak.</p></div>';
            list.querySelectorAll('input[type=checkbox]').forEach(cb => {
                cb.addEventListener('change', () => {
                    if (cb.checked) selected.add(String(cb.value));
                    else selected.delete(String(cb.value));
                    addBtn.disabled = selected.size === 0;
                });
            });
        };
        paintList();
        filterInp.addEventListener('input', paintList);
        addBtn.onclick = async () => {
            if (!selected.size) return;
            addBtn.disabled = true;
            try {
                await API.post(`/api/groups/${g.id}/members`, { member_ids: [...selected] });
                const addedUsers = contacts.filter(u => selected.has(String(u.id)));
                page.remove();
                showToast('Anggota ditambahkan.');
                onAdded(addedUsers);
            } catch (err) {
                showToast(err.message || 'Gagal menambah anggota.');
                addBtn.disabled = false;
            }
        };
    }

    async function openGroupInfoSheet() {
        const g = state.currentGroup;
        if (!g) return;

        document.getElementById('gi-page')?.remove();
        const page = document.createElement('div');
        page.className = 'gi-page';
        page.id = 'gi-page';

        const avInner0 = g.avatar_url
            ? `<img src="${escapeHtml(g.avatar_url)}" alt="" />`
            : `<i class="fa-solid fa-users"></i>`;
        page.innerHTML = `
            <div class="gi-top">
                <button type="button" class="icon-btn" data-act="close" aria-label="Kembali"><svg class="icon"><use href="#i-back"/></svg></button>
                <h1>Info grup</h1>
            </div>
            <div class="gi-scroll">
                <div class="gi-hero">
                    <div class="gi-hero-av">${avInner0}</div>
                    <div class="gi-hero-name">${escapeHtml(g.name || 'Grup')}</div>
                    <p class="gi-hero-sub">Grup · ${g.member_count || '...'} anggota</p>
                </div>
                <div class="gi-section">
                    <div class="gi-section-title">Anggota</div>
                    <div style="padding:28px 18px;text-align:center">
                        <div style="width:28px;height:28px;border:3px solid #ddd;border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 10px"></div>
                        <p class="muted small" style="margin:0">Memuat anggota...</p>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(page);
        page.querySelector('[data-act="close"]').onclick = () => page.remove();

        let members = [], createdBy = null;
        try {
            const res = await API.get(`/api/groups/${g.id}/members`);
            members = res.data || [];
            createdBy = res.created_by;
        } catch (e) {
            showToast(e.message || 'Gagal memuat anggota.');
            page.remove();
            return;
        }
        const iAmOwner = String(createdBy) === String(state.me.id);

        let paint = () => {
            const avInner = g.avatar_url
                ? `<img src="${escapeHtml(g.avatar_url)}" alt="" />`
                : `<i class="fa-solid fa-users"></i>`;
            const menuBtn = iAmOwner
                ? `<div class="gi-menu-wrap">
                    <button type="button" class="icon-btn" data-act="menu" aria-label="Menu"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                    <div class="gi-menu hidden" id="gi-menu">
                        <div class="gi-menu-item" data-act="edit-name"><i class="fa-solid fa-pen"></i> Edit nama grup</div>
                        <div class="gi-menu-item" data-act="edit-bio"><i class="fa-solid fa-align-left"></i> Edit bio grup</div>
                        <div class="gi-menu-item" data-act="change-avatar"><i class="fa-solid fa-camera"></i> Ganti foto grup</div>
                        ${g.avatar_url ? `<div class="gi-menu-item danger" data-act="remove-avatar"><i class="fa-solid fa-trash"></i> Hapus foto grup</div>` : ''}
                    </div>
                </div>`
                : '';
            const bioText = g.about || '';
            const isLongBio = bioText.length > 140;
            const bioHtml = bioText
                ? `<p class="gi-hero-bio${isLongBio ? ' clamped' : ''}" id="gi-bio-text">${escapeHtml(bioText)}</p>${isLongBio ? `<span class="gi-hero-bio-more" data-act="toggle-bio">Baca selengkapnya</span>` : ''}`
                : (iAmOwner ? `<p class="gi-hero-bio placeholder">Belum ada deskripsi grup.</p>` : '');
            // Semua anggota bisa menambah peserta (bukan hanya admin/owner)
            const addMemberRow = `<div class="gi-action gi-add-member" data-act="add-member"><i class="fa-solid fa-user-plus"></i> Tambah anggota</div>`;
            const memberRows = members.map(m => {
                const isMe = String(m.user_id) === String(state.me.id);
                const name = escapeHtml(m.user?.display_name || m.user?.username || 'Pengguna');
                const uname = m.user?.username ? '@' + escapeHtml(m.user.username) : '';
                const kick = (iAmOwner && !isMe && !m.is_owner)
                    ? `<button type="button" class="gi-kick" data-act="kick" data-uid="${m.user_id}">Keluarkan</button>`
                    : '';
                return `<div class="gi-row">
                    ${avatarHTML(m.user)}
                    <div class="who"><strong>${name}${isMe ? ' (Kamu)' : ''}</strong>${uname ? `<small>${uname}</small>` : ''}</div>
                    ${m.is_owner ? '<span class="role-badge">Admin</span>' : ''}
                    ${kick}
                </div>`;
            }).join('');

            page.innerHTML = `
                <div class="gi-top">
                    <button type="button" class="icon-btn" data-act="close" aria-label="Kembali"><svg class="icon"><use href="#i-back"/></svg></button>
                    <h1>Info grup</h1>
                    ${menuBtn}
                </div>
                <div class="gi-scroll">
                    <div class="gi-hero">
                        <div class="gi-hero-av" data-act="view-avatar">${avInner}</div>
                        <div class="gi-hero-name">${escapeHtml(g.name || 'Grup')}</div>
                        <p class="gi-hero-sub">Grup · ${members.length} anggota</p>
                        ${bioHtml}
                        <input type="file" id="gi-avatar-file" accept="image/*" hidden />
                    </div>
                    <div class="gi-section">
                        <div class="gi-section-title">${members.length} anggota</div>
                        ${addMemberRow}
                        ${memberRows}
                    </div>
                    <div class="gi-section" style="margin-top:8px">
                        ${iAmOwner
                            ? `<div class="gi-action danger" data-act="delete-group"><i class="fa-solid fa-trash"></i> Hapus grup</div>`
                            : `<div class="gi-action danger" data-act="leave-group"><i class="fa-solid fa-right-from-bracket"></i> Keluar dari grup</div>`}
                    </div>
                </div>
            `;
            const inp = page.querySelector('#gi-avatar-file');
            if (inp) {
                inp.onchange = async (ev) => {
                    const f = ev.target.files && ev.target.files[0];
                    ev.target.value = '';
                    if (!f) return;
                    if (!f.type.startsWith('image/')) { showToast('File harus gambar'); return; }
                    if (f.size > 5 * 1024 * 1024) { showToast('Maks 5 MB'); return; }
                    try {
                        showToast('Mengunggah foto...', 1200);
                        const fd = new FormData();
                        fd.append('file', f);
                        const up = await API.upload('/api/chat/upload/group', fd);
                        const url = up.url || up.media_url;
                        const { group } = await API.put(`/api/groups/${g.id}`, { avatar_url: url });
                        Object.assign(g, group || {});
                        g.avatar_url = url;
                        state.currentGroup = g;
                        const gg = state.groups.find(x => String(x.id) === String(g.id));
                        if (gg) gg.avatar_url = url;
                        paint();
                        const gav = document.getElementById('gconv-avatar');
                        if (gav) {
                            if (gav.tagName === 'IMG') gav.src = url;
                            else {
                                const img = document.createElement('img');
                                img.id = 'gconv-avatar';
                                img.className = 'avatar sm group-avatar';
                                img.src = url;
                                img.alt = '';
                                gav.replaceWith(img);
                            }
                        }
                        renderGroups();
                        showToast('Foto grup diperbarui.');
                    } catch (err) { showToast(err.message || 'Gagal unggah foto.'); }
                };
            }
        };
        paint();

        page.addEventListener('click', async (e) => {
            const actEl = e.target.closest('[data-act]');
            const openMenu = page.querySelector('#gi-menu');
            if (!actEl) {
                if (openMenu && !openMenu.classList.contains('hidden')) openMenu.classList.add('hidden');
                return;
            }
            const act = actEl.dataset.act;
            if (act === 'menu') {
                if (openMenu) openMenu.classList.toggle('hidden');
                return;
            }
            if (openMenu) openMenu.classList.add('hidden');
            if (act === 'toggle-bio') {
                const bioEl = page.querySelector('#gi-bio-text');
                if (!bioEl) return;
                const nowClamped = bioEl.classList.toggle('clamped');
                actEl.textContent = nowClamped ? 'Baca selengkapnya' : 'Sembunyikan';
                return;
            }
            if (act === 'close') { page.remove(); return; }
            if (act === 'view-avatar') {
                if (g.avatar_url) openChatMediaViewer(g.avatar_url, 'image');
                else if (iAmOwner) showToast('Gunakan menu ⋮ untuk menambahkan foto grup.');
                return;
            }
            if (act === 'change-avatar') {
                page.querySelector('#gi-avatar-file')?.click();
                return;
            }
            if (act === 'edit-name') {
                const newName = await openGiTextPrompt({ title: 'Edit nama grup', value: g.name || '', placeholder: 'Nama grup', maxLength: 60, multiline: false });
                if (newName == null) return;
                const name = newName.trim();
                if (!name) { showToast('Nama grup wajib diisi.'); return; }
                try {
                    const { group } = await API.put(`/api/groups/${g.id}`, { name });
                    Object.assign(g, group || {});
                    g.name = name;
                    state.currentGroup = g;
                    const gg = state.groups.find(x => String(x.id) === String(g.id));
                    if (gg) gg.name = name;
                    paint();
                    const gn = document.getElementById('gconv-name');
                    if (gn) gn.textContent = name;
                    renderGroups();
                    showToast('Nama grup diperbarui.');
                } catch (err) { showToast(err.message || 'Gagal mengubah nama grup.'); }
                return;
            }
            if (act === 'edit-bio') {
                const newAbout = await openGiTextPrompt({ title: 'Edit bio grup', value: g.about || '', placeholder: 'Tulis deskripsi singkat tentang grup ini...', multiline: true });
                if (newAbout == null) return;
                const about = newAbout.trim();
                try {
                    const { group } = await API.put(`/api/groups/${g.id}`, { about });
                    Object.assign(g, group || {});
                    g.about = about || null;
                    state.currentGroup = g;
                    const gg = state.groups.find(x => String(x.id) === String(g.id));
                    if (gg) gg.about = g.about;
                    paint();
                    showToast('Bio grup diperbarui.');
                } catch (err) { showToast(err.message || 'Gagal mengubah bio grup.'); }
                return;
            }
            if (act === 'add-member') {
                openAddMemberSheet(g, members, (addedUsers) => {
                    members = members.concat(addedUsers.map(u => ({ user_id: u.id, user: u, is_owner: false })));
                    g.member_count = members.length;
                    const gg = state.groups.find(x => String(x.id) === String(g.id));
                    if (gg) gg.member_count = members.length;
                    paint();
                    document.getElementById('gconv-status').textContent = members.length + ' anggota';
                });
                return;
            }
            if (act === 'remove-avatar') {
                try {
                    const { group } = await API.put(`/api/groups/${g.id}`, { avatar_url: null });
                    Object.assign(g, group || { avatar_url: null });
                    g.avatar_url = null;
                    state.currentGroup = g;
                    const gg = state.groups.find(x => String(x.id) === String(g.id));
                    if (gg) gg.avatar_url = null;
                    paint();
                    const gav = document.getElementById('gconv-avatar');
                    if (gav) {
                        const span = document.createElement('span');
                        span.id = 'gconv-avatar';
                        span.className = 'avatar sm group-avatar';
                        span.innerHTML = '<i class="fa-solid fa-users"></i>';
                        gav.replaceWith(span);
                    }
                    renderGroups();
                    showToast('Foto grup dihapus.');
                } catch (err) { showToast(err.message || 'Gagal hapus foto.'); }
                return;
            }
            if (act === 'kick') {
                const uid = actEl.dataset.uid;
                if (!uid) return;
                try {
                    await API.del(`/api/groups/${g.id}/members/${uid}`);
                    members = members.filter(m => String(m.user_id) !== String(uid));
                    g.member_count = members.length;
                    const gg = state.groups.find(x => String(x.id) === String(g.id));
                    if (gg) gg.member_count = members.length;
                    paint();
                    document.getElementById('gconv-status').textContent = members.length + ' anggota';
                    showToast('Anggota dikeluarkan.');
                } catch (err) { showToast(err.message || 'Gagal mengeluarkan anggota.'); }
                return;
            }
            if (act === 'delete-group') {
                page.remove();
                try {
                    await API.del(`/api/groups/${g.id}`);
                    showToast('Grup dihapus.');
                    onGroupDeleted(g.id);
                } catch (err) { showToast(err.message || 'Gagal menghapus grup.'); }
                return;
            }
            if (act === 'leave-group') {
                page.remove();
                try {
                    await API.post(`/api/groups/${g.id}/leave`, {});
                    showToast('Kamu keluar dari grup.');
                    onGroupDeleted(g.id);
                } catch (err) { showToast(err.message || 'Gagal keluar dari grup.'); }
            }
        });
    }

    /* ---------- REALTIME ---------- */
    function onNewMessage(m) {
        // Update preview list grup
        const g = state.groups.find(x => String(x.id) === String(m.group_id));
        if (g) {
            let isAi = !!(m.is_ai || m.user?.is_ai);
            let bodyRaw = m.content || '';
            if (!isAi && typeof AIModule !== 'undefined' && AIModule.detectAiContent) {
                const det = AIModule.detectAiContent(bodyRaw);
                if (det.isAi) { isAi = true; bodyRaw = det.text; }
            }
            const sn = isAi
                ? ((typeof AIModule !== 'undefined' && AIModule.AI_DISPLAY) ? AIModule.AI_DISPLAY : 'Pretvfx AI')
                : (m.user?.display_name || m.user?.username || 'User');
            const bodyPrev = isAi
                ? bodyRaw
                : (m.content || (m.message_type === 'image' || m.message_type === 'image_once' ? 'Foto' : m.message_type === 'video' || m.message_type === 'video_once' ? 'Video' : m.message_type === 'sticker' ? 'Stiker' : m.message_type === 'audio' ? 'Pesan suara' : ''));
            g.last_message_at = m.created_at;
            g.last_message_preview = sn + ': ' + bodyPrev;
            g.last_sender_id = m.sender_id;
            // Deteksi mention untuk badge @
            const myUname = String(state.me?.username || '').toLowerCase();
            if (myUname && m.content && String(m.sender_id) !== String(state.me.id)) {
                const reMe = new RegExp('(^|\\s)@' + myUname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
                const reAll = /(^|\s)@(semua|everyone|all)\b/i;
                if (reMe.test(m.content) || reAll.test(m.content)) {
                    g.mentioned = true;
                    g.unread_count = (g.unread_count || 0) + 1;
                } else if (!state.currentGroup || String(state.currentGroup.id) !== String(m.group_id)) {
                    g.unread_count = (g.unread_count || 0) + 1;
                }
            } else if (!state.currentGroup || String(state.currentGroup.id) !== String(m.group_id)) {
                if (String(m.sender_id) !== String(state.me.id)) {
                    g.unread_count = (g.unread_count || 0) + 1;
                }
            }
            if (state.currentView === 'group') renderGroups();
        }
        if (!state.currentGroup || String(state.currentGroup.id) !== String(m.group_id)) {
            return;
        }
        if (state.groupMessages.find(x => String(x.id) === String(m.id))) return;
        const tempIdx = state.groupMessages.findIndex(x =>
            String(x.id).startsWith('tmp-') &&
            String(x.sender_id) === String(m.sender_id) &&
            ((x.content && x.content === m.content) || (x.message_type === m.message_type && x.message_type !== 'text'))
        );
        if (tempIdx >= 0) {
            const oldId = state.groupMessages[tempIdx].id;
            state.groupMessages[tempIdx] = m;
            if (!replaceMsgNode(oldId, renderMessage(m, { showHead: shouldShowHead(m) }))) {
                msgsEl.insertAdjacentHTML('beforeend', renderMessage(m, { showHead: shouldShowHead(m) }));
            }
            return;
        }
        if (m.user) {
            memberCache[m.group_id] = memberCache[m.group_id] || {};
            memberCache[m.group_id][m.sender_id] = m.user;
        }
        state.groupMessages.push(m);
        msgsEl.insertAdjacentHTML('beforeend', renderMessage(m, { showHead: shouldShowHead(m) }));
        scrollToBottom(true);
    }
    function onMessageDelete(d) {
        const id = d.message?.id;
        if (!id) return;
        state.groupMessages = state.groupMessages.filter(x => String(x.id) !== String(id));
        removeMsgNode(id);
    }
    function onGroupDeleted(gid) {
        if (state.currentGroup && String(state.currentGroup.id) === String(gid)) closeGroup();
        else loadGroups();
    }

    return { init, loadGroups, onNewMessage, onMessageDelete, onGroupDeleted };
})();
