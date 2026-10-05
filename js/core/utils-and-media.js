/* ============================================================
   UTILITIES
   ============================================================ */
function showToast(msg, ms = 2500) {
    const el = document.getElementById('toast');
    if (!el) return alert(msg);
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), ms);
}
function updateNavBadge(elId, count) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (count > 0) { el.textContent = count > 99 ? '99+' : String(count); el.classList.remove('hidden'); }
    else el.classList.add('hidden');
}
function initials(name = '') { return String(name || '?').trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase(); }
function avatarHTML(user) {
    if (user?.avatar_url) return `<img class="avatar" src="${user.avatar_url}" alt="" loading="lazy" />`;
    return `<span class="avatar">${initials(user?.display_name || user?.username)}</span>`;
}

/** True online hanya jika flag online DAN last_seen masih segar (< 2 menit). */
function isReallyOnline(u) {
    if (!u) return false;
    if (!u.online) return false;
    if (!u.last_seen) return true;
    try {
        const t = new Date(u.last_seen).getTime();
        if (isNaN(t)) return !!u.online;
        return (Date.now() - t) < 2 * 60 * 1000;
    } catch (_) { return !!u.online; }
}
function presenceLabel(u) {
    if (isReallyOnline(u)) return 'online';
    if (u && u.last_seen) return 'terakhir dilihat ' + timeAgo(u.last_seen);
    return '';
}

function timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'baru saja';
    if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}
function timeShort(iso) { if (!iso) return ''; return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
/** Ubah URL http/https di teks pesan jadi link klikable (buka tab baru). Aman: teks lain tetap di-escape. */
function linkifyText(s) {
    const raw = String(s || '');
    if (!raw) return '';
    // Split by URL or @mention (@username / @semua)
    const re = /(https?:\/\/[^\s<>"']+)|(@[a-zA-Z0-9._]{2,32})/gi;
    let out = '', last = 0, m;
    while ((m = re.exec(raw)) !== null) {
        out += escapeHtml(raw.slice(last, m.index));
        if (m[1]) {
            const url = m[1].replace(/[.,;:!?)]+$/, '');
            const trailing = m[1].slice(url.length);
            out += `<a href="javascript:void(0)" data-external-url="${escapeHtml(url)}" class="msg-link">${escapeHtml(url)}</a>${escapeHtml(trailing)}`;
        } else if (m[2]) {
            out += `<span class="mention-tag">${escapeHtml(m[2])}</span>`;
        }
        last = m.index + m[0].length;
    }
    out += escapeHtml(raw.slice(last));
    return out;
}

/** Preview teks untuk reply quote / reply bar */
function replyPreviewText(m) {
    if (!m) return '';
    const mt = m.message_type || m.reply_to_type || 'text';
    if (mt === 'image_once') return 'Foto sekali lihat';
    if (mt === 'video_once') return 'Video sekali lihat';
    if (mt === 'image') return 'Foto';
    if (mt === 'video') return 'Video';
    if (mt === 'audio') return 'Pesan suara';
    if (mt === 'sticker') return 'Stiker';
    const c = m.content || m.reply_to_content || '';
    return String(c).slice(0, 80) || 'Pesan';
}

/* Reply metadata — format pendek ASCII, selalu di-strip saat tampil (hemat storage) */
/* Format: [[r|id|type|name|preview|mediaurl?]]teks */
function encodeReplyInContent(content, replyPayload) {
    if (!replyPayload || !replyPayload.reply_to_id) return content || '';
    const id = String(replyPayload.reply_to_id).slice(0, 40);
    const t = String(replyPayload.reply_to_type || 'text').slice(0, 16);
    const sn = String(replyPayload.reply_to_sender_name || 'Pesan').replace(/[|\]]/g, '').slice(0, 24);
    let c = String(replyPayload.reply_to_content || '').replace(/[|\]]/g, ' ').slice(0, 40);
    if (t === 'image_once') c = 'Foto sekali lihat';
    else if (t === 'video_once') c = 'Video sekali lihat';
    else if (t === 'image') c = c || 'Foto';
    else if (t === 'video') c = c || 'Video';
    else if (t === 'audio') c = 'Pesan suara';
    else if (t === 'sticker') c = 'Stiker';
    // Simpan media_url hanya untuk stiker/foto/video biasa (thumbnail quote) — bukan view-once
    let media = '';
    if (t === 'sticker' || t === 'image' || t === 'video') {
        const mu = String(replyPayload.reply_to_media_url || '');
        if (/^https?:\/\//i.test(mu) || mu.startsWith('emoji:')) {
            media = mu.replace(/[|\]]/g, '').slice(0, 180);
        }
    }
    return '[[r|' + id + '|' + t + '|' + sn + '|' + c + (media ? '|' + media : '') + ']]' + (content || '');
}
function parseReplyFromContent(raw) {
    let s = String(raw || '');
    // Format: [[r|id|type|name|preview|media?]]
    if (s.startsWith('[[r|')) {
        const end = s.indexOf(']]');
        if (end > 0) {
            const parts = s.slice(4, end).split('|');
            const rest = s.slice(end + 2);
            if (parts.length >= 4) {
                let preview = parts[3] || '';
                let media = null;
                // parts[4+] bisa media url (boleh mengandung karakter setelah split salah — join sisa jika http)
                if (parts.length >= 5) {
                    const maybe = parts.slice(4).join('|');
                    if (/^https?:\/\//i.test(maybe) || maybe.startsWith('emoji:')) {
                        media = maybe;
                    } else {
                        preview = parts.slice(3).join('|');
                    }
                }
                return {
                    content: rest,
                    reply: {
                        reply_to_id: parts[0] || null,
                        reply_to_type: parts[1] || 'text',
                        reply_to_sender_name: parts[2] || 'Pesan',
                        reply_to_content: preview,
                        reply_to_media_url: media,
                        reply_to_sender_id: null
                    }
                };
            }
        }
    }
    // Legacy: invisible-mark + base64 (bersihkan agar tidak tampil)
    const legacyPrefix = '\u2060R:';
    if (s.startsWith(legacyPrefix) || s.startsWith('R:ey') || s.startsWith('\u2060R:')) {
        // Coba parse base64 lama
        try {
            let body = s;
            if (body.charCodeAt(0) === 0x2060) body = body.slice(1);
            if (body.startsWith('R:')) {
                const mark2 = body.indexOf('\u2060', 2);
                let b64, rest;
                if (mark2 > 0) {
                    b64 = body.slice(2, mark2);
                    rest = body.slice(mark2 + 1);
                } else {
                    // mark hilang — cari akhir base64 (sebelum teks biasa)
                    const m = body.match(/^R:([A-Za-z0-9+/=]+)(.*)$/s);
                    if (m) { b64 = m[1]; rest = m[2] || ''; }
                }
                if (b64) {
                    const meta = JSON.parse(decodeURIComponent(escape(atob(b64))));
                    return {
                        content: rest || '',
                        reply: {
                            reply_to_id: meta.id,
                            reply_to_type: meta.t,
                            reply_to_content: meta.c,
                            reply_to_media_url: null,
                            reply_to_sender_id: meta.sid,
                            reply_to_sender_name: meta.sn
                        }
                    };
                }
            }
        } catch (_) {}
        // Gagal parse: buang prefix kotor supaya tidak tampil base64
        const cleaned = s.replace(/^\u2060?R:[A-Za-z0-9+/=]+\u2060?/, '').replace(/^R:[A-Za-z0-9+/=]+/, '');
        return { content: cleaned || '', reply: null };
    }
    return { content: s, reply: null };
}
function applyReplyParse(m) {
    if (!m) return m;
    const parsed = parseReplyFromContent(m.content);
    m.content = parsed.content;
    if (parsed.reply && !m.reply_to_id) {
        Object.assign(m, parsed.reply);
    } else if (parsed.reply && m.reply_to_id) {
        // pastikan content sudah bersih
    }
    return m;
}

function renderReplyQuoteHtml(m) {
    if (!m || !m.reply_to_id) return '';
    // Quote ke pesan AI → selalu tampilkan "Pretvfx AI" (bukan nama user yang nge-trigger)
    let quoteName = m.reply_to_sender_name || 'Pesan';
    let quoteContent = m.reply_to_content || '';
    const isAiQuote = String(m.reply_to_sender_id) === 'ai-bot-pretvfx'
        || quoteName === 'Pretvfx AI'
        || /^\[AI\]\s/.test(String(quoteContent))
        || /^⟦AI⟧/.test(String(quoteContent))
        || /^\[\[AI\]\]/.test(String(quoteContent));
    if (isAiQuote) {
        quoteName = (typeof AIModule !== 'undefined' && AIModule.AI_DISPLAY) ? AIModule.AI_DISPLAY : 'Pretvfx AI';
        quoteContent = String(quoteContent).replace(/^\[AI\]\s*/, '').replace(/^⟦AI⟧\s*/, '').replace(/^\[\[AI\]\]\s*/, '');
    }
    const name = escapeHtml(quoteName);
    const rtype = m.reply_to_type || 'text';
    const isOnce = rtype === 'image_once' || rtype === 'video_once';
    const text = escapeHtml(replyPreviewText({
        message_type: rtype,
        content: quoteContent
    }));
    // Thumbnail: foto/video biasa + stiker (bukan view-once)
    let thumb = '';
    const mu = m.reply_to_media_url ? String(m.reply_to_media_url) : '';
    if (!isOnce && mu) {
        if (rtype === 'sticker') {
            if (mu.startsWith('emoji:')) {
                thumb = `<div class="mrq-thumb mrq-sticker-em">${escapeHtml(mu.slice(6))}</div>`;
            } else if (/^https?:\/\//i.test(mu)) {
                const src = mu.split('#')[0];
                const isVid = /\.(mp4|webm|mov)(\?|$)/i.test(src);
                thumb = isVid
                    ? `<div class="mrq-thumb mrq-sticker"><video src="${src}" muted autoplay loop playsinline></video></div>`
                    : `<div class="mrq-thumb mrq-sticker"><img src="${src}" alt="" /></div>`;
            }
        } else if (rtype === 'image' || rtype === 'video') {
            const src = mu.split('#')[0];
            thumb = rtype === 'video'
                ? `<div class="mrq-thumb"><video src="${src}#t=0.1" muted playsinline preload="metadata"></video></div>`
                : `<div class="mrq-thumb"><img src="${src}" alt="" /></div>`;
        }
    }
    return `<div class="msg-reply-quote" data-reply-to="${escapeHtml(String(m.reply_to_id))}">
        <div class="mrq-bar"></div>
        <div class="mrq-body"><div class="mrq-name">${name}</div><div class="mrq-text">${text}</div></div>
        ${thumb}
    </div>`;
}

function buildReplyPayload(replyTo, meId) {
    if (!replyTo || !replyTo.id) return {};
    const mt = replyTo.message_type || 'text';
    const isOnce = mt === 'image_once' || mt === 'video_once';
    // Nama yang disimpan di DB harus nama asli (bukan "Anda") —
    // supaya user lain juga melihat nama yang benar, bukan kata "Anda".
    function realName(obj) {
        if (!obj) return '';
        const n = (obj.display_name || obj.username || '').trim();
        if (!n || n === 'Anda') return '';
        return n;
    }
    // Deteksi pesan AI (prefix [AI] / is_ai / user bot) → quote pakai "Pretvfx AI"
    function isAiMsg(m) {
        if (!m) return false;
        if (m.is_ai) return true;
        if (m.user?.is_ai || m.user?.id === 'ai-bot-pretvfx') return true;
        if (String(m.sender_id) === 'ai-bot-pretvfx') return true;
        const c = String(m.content || '');
        if (/^\[AI\]\s/.test(c) || /^⟦AI⟧/.test(c) || /^\[\[AI\]\]/.test(c)) return true;
        if (typeof AIModule !== 'undefined' && AIModule.detectAiContent) {
            try { return !!AIModule.detectAiContent(c).isAi; } catch (_) {}
        }
        return false;
    }
    let senderName = '';
    let replyContent = (replyTo.content || '').slice(0, 200);
    if (isAiMsg(replyTo)) {
        senderName = (typeof AIModule !== 'undefined' && AIModule.AI_DISPLAY) ? AIModule.AI_DISPLAY : 'Pretvfx AI';
        // Bersihkan prefix [AI] dari teks quote
        replyContent = replyContent.replace(/^\[AI\]\s*/, '').replace(/^⟦AI⟧\s*/, '').replace(/^\[\[AI\]\]\s*/, '');
    } else if (String(replyTo.sender_id) === String(meId)) {
        try {
            const me = JSON.parse(localStorage.getItem('pretv_me') || '{}');
            senderName = realName(me);
        } catch (_) {}
        if (!senderName && typeof App !== 'undefined' && App.state?.me) {
            senderName = realName(App.state.me);
        }
        if (!senderName) senderName = realName(replyTo.user) || realName({ display_name: replyTo._replySenderName });
        if (!senderName) senderName = 'Pengguna';
    } else if (replyTo.user) {
        senderName = realName(replyTo.user) || 'Pengguna';
    } else if (replyTo._replySenderName && replyTo._replySenderName !== 'Anda') {
        senderName = String(replyTo._replySenderName).trim() || 'Pengguna';
    } else {
        senderName = 'Pengguna';
    }
    // View-once: jangan kirim media_url di reply (biar tidak bocor)
    if (isOnce) {
        replyContent = mt === 'video_once' ? 'Video sekali lihat' : 'Foto sekali lihat';
    }
    return {
        reply_to_id: replyTo.id,
        reply_to_type: mt,
        reply_to_content: replyContent,
        reply_to_media_url: isOnce ? null : (replyTo.media_url || null),
        reply_to_sender_id: isAiMsg(replyTo) ? 'ai-bot-pretvfx' : (replyTo.sender_id || null),
        reply_to_sender_name: senderName
    };
}

/** Swipe horizontal pada bubble pesan → balas (WA style). Bekerja di teks, media, stiker. */
function bindSwipeToReply(container, onReply) {
    if (!container || container._swipeBound) return;
    container._swipeBound = true;
    let startX = 0, startY = 0, curX = 0, active = null, moved = false, axis = null;
    const THRESH = 56;
    const MAX = 72;

    function getMsgEl(t) {
        return t.closest?.('.msg') || null;
    }
    function resetEl(el) {
        if (!el) return;
        el.style.transform = '';
        el.style.transition = '';
        el.classList.remove('swiping', 'swipe-reply-hint');
        const wrap = el.closest('.msg-with-av');
        if (wrap) wrap.classList.remove('swiping', 'swipe-reply-hint');
    }

    container.addEventListener('touchstart', (e) => {
        const msgEl = getMsgEl(e.target);
        if (!msgEl || !msgEl.dataset.id || String(msgEl.dataset.id).startsWith('tmp-')) return;
        if (e.target.closest('[data-audio-play], a, button, .audio-play')) return;
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY; curX = startX;
        active = msgEl; moved = false; axis = null;
        msgEl.style.transition = 'none';
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!active) return;
        const t = e.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (!axis) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            if (axis === 'y') { active = null; return; }
        }
        if (axis !== 'x') return;
        moved = true;
        // Both sides: swipe right for other, swipe left for me — or always allow horizontal toward center
        const isMe = active.classList.contains('me');
        let shift = dx;
        if (isMe) {
            // me: tarik ke kiri (dx negatif)
            shift = Math.max(-MAX, Math.min(0, dx));
        } else {
            // other: tarik ke kanan (dx positif) — user said "tarik ke kiri" for both, but WA does right for received
            // User: "yg user tarik ke kiri trus yg pengirim juga tarik kiri" — so both swipe left
            shift = Math.max(-MAX, Math.min(0, dx));
        }
        active.style.transform = `translateX(${shift}px)`;
        active.classList.add('swiping');
        if (Math.abs(shift) > 28) active.classList.add('swipe-reply-hint');
        else active.classList.remove('swipe-reply-hint');
        curX = t.clientX;
    }, { passive: true });

    function endSwipe() {
        if (!active) return;
        const el = active;
        const isMe = el.classList.contains('me');
        const dx = curX - startX;
        const shift = isMe ? Math.max(-MAX, Math.min(0, dx)) : Math.max(-MAX, Math.min(0, dx));
        const triggered = moved && Math.abs(shift) >= THRESH;
        const id = el.dataset.id;
        el.style.transition = 'transform .18s ease';
        el.style.transform = '';
        el.classList.remove('swiping', 'swipe-reply-hint');
        active = null; axis = null; moved = false;
        if (triggered && id && typeof onReply === 'function') {
            try { onReply(id); } catch (_) {}
        }
    }
    container.addEventListener('touchend', endSwipe, { passive: true });
    container.addEventListener('touchcancel', endSwipe, { passive: true });
}
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a.msg-link[data-external-url]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const url = a.dataset.externalUrl;
    try {
        if (typeof AndroidBrowser !== 'undefined' && AndroidBrowser && AndroidBrowser.open) {
            AndroidBrowser.open(url);
        } else {
            window.open(url, '_blank');
        }
    } catch (_) {
        window.open(url, '_blank');
    }
}, true);

function openChatMediaViewer(url, type, secureMode) {
    if (!url) return;
    url = String(url).split('#')[0];
  // 🎨 Status bar hitam
setDarkStatusBar(true);

    // 🔒 AKTIFKAN FLAG_SECURE saat view-once dibuka
    if (secureMode) {
        try {
            if (typeof AndroidSecure !== 'undefined' && AndroidSecure && AndroidSecure.enableSecure) {
                AndroidSecure.enableSecure();
                console.log('[secure] enableSecure() dipanggil ✓');
            } else {
                console.warn('[secure] AndroidSecure TIDAK ADA — bridge gagal terpasang!');
            }
        } catch (e) {
            console.warn('[secure] enableSecure gagal:', e.message);
        }
    }

    const old = document.querySelector('.media-lightbox');
    if (old) old.remove();
    const box = document.createElement('div');
    box.className = 'media-lightbox';
    box.innerHTML = `
        <div class="media-lightbox-top">
            <button type="button" class="mlb-back" aria-label="Tutup"><svg class="icon"><use href="#i-back"/></svg></button>
            <div class="mlb-spacer"></div>
            ${secureMode ? '' : '<button type="button" class="mlb-download" aria-label="Unduh"><svg class="icon"><use href="#i-download"/></svg></button>'}
        </div>
        <div class="media-lightbox-body" id="mlb-body"></div>
        <div class="media-lightbox-bottom"><div class="mlb-hint">Ketuk untuk menutup</div></div>`;

    const close = () => {
    const v = box.querySelector('video');
    if (v) { try { v.pause(); } catch (_) {} try { v.removeAttribute('src'); v.load(); } catch (_) {} }
    box.remove();
    document.removeEventListener('keydown', onKey);

    // 🎨 Status bar balik putih
    setDarkStatusBar(false);

    // 🔓 MATIKAN FLAG_SECURE saat viewer ditutup
    if (secureMode) {
        try {
            if (typeof AndroidSecure !== 'undefined' && AndroidSecure && AndroidSecure.disableSecure) {
                AndroidSecure.disableSecure();
            }
        } catch (_) {}
    }
};
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    box.querySelector('.mlb-back').onclick = (e) => { e.stopPropagation(); close(); };
    const body = box.querySelector('#mlb-body');
    const isVideo = type === 'video' || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
    const dlBtn = box.querySelector('.mlb-download');
    if (dlBtn) {
        dlBtn.onclick = async (e) => {
            e.stopPropagation();
            dlBtn.disabled = true;
            try {
                if (typeof AndroidDownloader !== 'undefined' && AndroidDownloader.saveBase64File) {
                    const res = await fetch(url);
                    const blob = await res.blob();
                    const mime = blob.type || (isVideo ? 'video/mp4' : 'image/jpeg');
                    const ext = (mime.split('/')[1] || (isVideo ? 'mp4' : 'jpg')).split('+')[0];
                    const fileName = (isVideo ? 'Video_' : 'Foto_') + Date.now() + '.' + ext;
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        AndroidDownloader.saveBase64File(reader.result, fileName, mime);
                        dlBtn.disabled = false;
                    };
                    reader.onerror = () => { showToast('Gagal memuat media.'); dlBtn.disabled = false; };
                    reader.readAsDataURL(blob);
                } else {
                    window.open(url, '_blank');
                    dlBtn.disabled = false;
                }
            } catch (err) {
                showToast('Gagal menyimpan: ' + (err.message || 'error'));
                dlBtn.disabled = false;
            }
        };
    }
    if (isVideo) {
        const loading = document.createElement('div');
        loading.className = 'media-video-loading';
        loading.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:1';
        loading.innerHTML = '<div class="spin-ring"></div>';
        body.style.position = 'relative';
        body.appendChild(loading);
        const v = document.createElement('video');
        v.src = url;
        v.controls = true;
        v.playsInline = true;
        v.setAttribute('webkit-playsinline', '');
        v.setAttribute('playsinline', '');
        v.preload = 'auto';
        v.style.cssText = 'width:100%;height:100%;max-height:100%;object-fit:contain;background:#000';
        body.appendChild(v);
        const tryPlay = () => { loading.remove(); v.play().catch(() => {}); };
        if (v.readyState >= 2) tryPlay();
        else {
            v.addEventListener('loadeddata', tryPlay, { once: true });
            v.addEventListener('canplay', tryPlay, { once: true });
            v.addEventListener('error', () => {
                loading.innerHTML = '<span style="color:#fff;font-size:14px">Gagal memuat video</span>';
            }, { once: true });
        }
        v.addEventListener('click', (e) => e.stopPropagation());
    } else {
        const img = document.createElement('img');
        img.src = url; img.alt = 'Foto'; img.draggable = false;
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
        body.appendChild(img);
    }
    body.addEventListener('click', (e) => { if (e.target === body) close(); });
    document.body.appendChild(box);
    document.addEventListener('keydown', onKey);
}
