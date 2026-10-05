/* ============================================================
   STATUS VIEWER
   ============================================================ */
const StatusViewer = (function () {
    let state = null;
    let overlay = null;
    let group = [];
    let idx = 0;
    let sequence = null; // array of arrays (status milik tiap user lain), untuk auto-lanjut
    let seqIdx = null;   // index user aktif di dalam `sequence`
    let timer = null;
    let paused = false;
    let activeVideo = null;
    let renderToken = 0;
    let currentDetails = null;
    let slideDuration = 5000;
    let slideStartedAt = 0;
    let slideRemaining = 5000;


    function init(s) { state = s; }

    function stopActiveViewerMedia() {
        if (activeVideo) {
            try { activeVideo.pause(); } catch (_) {}
            // Jangan hapus src di sini agar transisi status video lebih mulus & suara tidak "hilang" aneh.
            activeVideo = null;
        }
        if (overlay) {
            overlay.querySelectorAll('video').forEach(v => {
                try { v.pause(); } catch (_) {}
            });
        }
    }

    function open(statuses, startIdx, seq, seqIndex) {
        group = statuses.slice();
      // 🎨 Status bar hitam
        setDarkStatusBar(true);
        idx = Math.max(0, Math.min(Number(startIdx) || 0, Math.max(0, group.length - 1)));
        sequence = (Array.isArray(seq) && seq.length) ? seq : null;
        seqIdx = (sequence && Number.isInteger(seqIndex)) ? seqIndex : null;
        paused = false;
        renderToken++;
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.className = 'sw-viewer';
        overlay.innerHTML = `
            <div class="sw-progress" id="sw-progress"></div>
            <div class="sw-header">
                <span id="sw-avatar"></span>
                <div class="meta">
                    <div class="name" id="sw-name">—</div>
                    <div class="time" id="sw-time">—</div>
                </div>
                <button class="sw-btn" id="sw-more" aria-label="Lainnya"><svg class="icon"><use href="#i-more"/></svg></button>
                <button class="sw-btn" id="sw-close" aria-label="Tutup"><svg class="icon"><use href="#i-close"/></svg></button>
            </div>
            <div class="sw-content" id="sw-content"></div>
            <div class="sw-nav left" id="sw-prev"></div>
            <div class="sw-nav right" id="sw-next"></div>
            <div class="sw-controls hidden" id="sw-controls">
                <button class="sw-ctrl-btn" id="sw-download"><svg class="icon icon-sm"><use href="#i-download"/></svg> Simpan</button>
                <button class="sw-ctrl-btn danger" id="sw-delete"><svg class="icon icon-sm"><use href="#i-trash"/></svg> Hapus</button>
            </div>
            <div class="sw-bottom" id="sw-bottom"></div>`;
        document.body.appendChild(overlay);

        rebuildProgressBars();
        const controls = overlay.querySelector('#sw-controls');
        const closeMenu = () => { if (controls) controls.classList.add('hidden'); };
        overlay.querySelector('#sw-close').onclick = close;
        // Jangan next/prev langsung di onclick — pakai logic hold di bawah
        overlay.querySelector('#sw-next').onclick = (e) => { e.preventDefault(); e.stopPropagation(); };
        overlay.querySelector('#sw-prev').onclick = (e) => { e.preventDefault(); e.stopPropagation(); };
        overlay.querySelector('#sw-more').onclick = (e) => {
            e.stopPropagation();
            if (controls) controls.classList.toggle('hidden');
        };
        // Tap di luar menu → tutup menu (tanpa harus pencet titik tiga lagi)
        overlay.addEventListener('click', (e) => {
            if (!controls || controls.classList.contains('hidden')) return;
            if (e.target.closest('#sw-controls') || e.target.closest('#sw-more')) return;
            closeMenu();
        });
        renderBottomActions();

        const content = overlay.querySelector('#sw-content');
        let holdStartedAt = 0;
        let holdPointerId = null;
        let wasLongPress = false;
        const LONG_MS = 180;

        const pause = () => {
            if (paused) return;
            paused = true;
            overlay.classList.add('paused');
            if (activeVideo && !activeVideo.paused) activeVideo.pause();
            if (timer) {
                clearTimeout(timer);
                timer = null;
                const elapsed = Date.now() - slideStartedAt;
                slideRemaining = Math.max(0, slideRemaining - elapsed);
            }
        };
        const resume = () => {
            if (!paused) return;
            const reply = overlay.querySelector('#sw-reply');
            if (reply && (document.activeElement === reply || (reply.value || '').trim())) return;
            paused = false;
            overlay.classList.remove('paused');
            if (activeVideo) {
                try { activeVideo.muted = false; } catch (_) {}
                activeVideo.play().catch(() => {});
            } else if (slideRemaining > 0) {
                slideStartedAt = Date.now();
                const tokenNow = renderToken;
                timer = setTimeout(() => { if (tokenNow === renderToken && !paused) next(); }, slideRemaining);
                const bar = overlay.querySelector(`.sw-bar[data-i="${idx}"]`) || overlay.querySelectorAll('.sw-bar')[idx];
                if (bar) {
                    bar.style.setProperty('--sw-dur', (slideRemaining / 1000) + 's');
                    const fill = bar.querySelector('.sw-bar-fill');
                    if (fill) {
                        fill.style.animation = 'none';
                        void fill.offsetWidth;
                        fill.style.animation = '';
                    }
                }
            }
        };

        // Hold = pause (WA-style). Lepas setelah hold lama = resume, BUKAN next/prev.
        const onHoldDown = (e) => {
            if (e.target.closest('#sw-bottom, #sw-more, #sw-close, #sw-controls, .sw-header')) return;
            holdStartedAt = Date.now();
            wasLongPress = false;
            holdPointerId = e.pointerId;
            pause();
            closeMenu();
        };
        const onHoldUp = (e) => {
            if (holdPointerId != null && e.pointerId !== holdPointerId) return;
            const held = Date.now() - holdStartedAt;
            const reply = overlay.querySelector('#sw-reply');
            if (reply && (document.activeElement === reply || (reply.value || '').trim())) {
                holdPointerId = null;
                return;
            }
            if (held >= LONG_MS) {
                wasLongPress = true;
                resume();
                holdPointerId = null;
                return;
            }
            // Tap singkat: next/prev tergantung sisi layar
            resume();
            const x = e.clientX != null ? e.clientX : (e.changedTouches && e.changedTouches[0]?.clientX);
            if (x != null) {
                const w = window.innerWidth || 1;
                if (x < w * 0.33) prev();
                else if (x > w * 0.67) next();
                // tengah: hanya pause/resume, tidak pindah
            }
            holdPointerId = null;
        };
        content.addEventListener('pointerdown', onHoldDown);
        content.addEventListener('pointerup', onHoldUp);
        content.addEventListener('pointercancel', () => { resume(); holdPointerId = null; });
        // Jangan auto-resume di pointerleave saat masih hold (bisa bikin aneh di mobile)
        overlay.querySelector('#sw-next').addEventListener('pointerdown', onHoldDown);
        overlay.querySelector('#sw-prev').addEventListener('pointerdown', onHoldDown);
        overlay.querySelector('#sw-next').addEventListener('pointerup', onHoldUp);
        overlay.querySelector('#sw-prev').addEventListener('pointerup', onHoldUp);

        const bindReplyPause = () => {
            const reply = overlay.querySelector('#sw-reply');
            if (!reply || reply.dataset.pauseBound) return;
            reply.dataset.pauseBound = '1';
            reply.addEventListener('focus', pause);
            reply.addEventListener('blur', () => {
                if (!(reply.value || '').trim()) resume();
            });
            reply.addEventListener('input', () => {
                if ((reply.value || '').trim()) pause();
            });
        };
        bindReplyPause();
        overlay._bindReplyPause = bindReplyPause;
        overlay._swPause = pause;
        overlay._swResume = resume;

        let startX = 0, startY = 0, swipeStart = 0;
        content.addEventListener('touchstart', (e) => {
            if (e.touches[0]) { startX = e.touches[0].clientX; startY = e.touches[0].clientY; swipeStart = Date.now(); }
        }, { passive: true });
        content.addEventListener('touchend', (e) => {
            if (!e.changedTouches[0]) return;
            if (wasLongPress) return;
            const dx = e.changedTouches[0].clientX - startX;
            const dy = e.changedTouches[0].clientY - startY;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                if (dx < 0) next(); else prev();
            }
        }, { passive: true });

        render();
    }

    function renderBottomActions() {
        if (!overlay) return;
        const s = group[idx];
        const bottom = overlay.querySelector('#sw-bottom');
        if (!bottom || !s) return;
        const isOwner = !!(state.me && String(s.user_id) === String(state.me.id));
        if (isOwner) {
            bottom.innerHTML = `
                <button class="sw-action owner-viewers" id="sw-viewers" aria-label="Yang melihat" title="Yang melihat">
                    <svg class="icon"><use href="#i-eye"/></svg>
                    <span class="count hidden" id="sw-viewer-count">0</span>
                </button>`;
            bottom.querySelector('#sw-viewers').onclick = () => openDetailsSheet();
            return;
        }
        bottom.innerHTML = `
            <input id="sw-reply" class="sw-reply" type="text" maxlength="500" placeholder="Balas status..." autocomplete="off" />
            <button class="sw-action sw-send" id="sw-send" aria-label="Kirim balasan" title="Kirim balasan">
                <svg class="icon"><use href="#i-send"/></svg>
            </button>
            <button class="sw-action" id="sw-like" aria-label="Suka" title="Suka">
                <svg class="icon"><use href="#i-heart"/></svg>
                <span class="count hidden" id="sw-like-count">0</span>
            </button>`;
        bottom.querySelector('#sw-send').onclick = () => submitReply();
        bottom.querySelector('#sw-like').onclick = () => toggleLike();
        const replyInp = bottom.querySelector('#sw-reply');
        if (replyInp) {
            replyInp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitReply(); }
            });
            // pause timer saat mulai balas
            if (overlay && overlay._swPause) {
                replyInp.addEventListener('focus', overlay._swPause);
                replyInp.addEventListener('input', () => {
                    if ((replyInp.value || '').trim() && overlay._swPause) overlay._swPause();
                });
                replyInp.addEventListener('blur', () => {
                    if (!(replyInp.value || '').trim() && overlay._swResume) overlay._swResume();
                });
            }
        }
    }

    function rebuildProgressBars() {
        if (!overlay) return;
        overlay.querySelector('#sw-progress').innerHTML = group.map((_, i) => `<div class="sw-bar" data-i="${i}"><div class="sw-bar-fill"></div></div>`).join('');
    }

    function setProgressBars(videoPercent = null) {
        if (!overlay) return;
        const bars = [...overlay.querySelectorAll('.sw-bar')];
        bars.forEach((b, i) => {
            const fill = b.querySelector('.sw-bar-fill');
            b.classList.remove('active', 'done');
            b.style.removeProperty('--sw-dur');
            fill.style.animation = 'none';
            fill.style.width = i < idx ? '100%' : '0%';
            if (i === idx) {
                b.classList.add('active');
                if (videoPercent != null) {
                    fill.style.width = Math.max(0, Math.min(100, videoPercent)) + '%';
                }
            } else if (i < idx) {
                b.classList.add('done');
                fill.style.width = '100%';
            }
        });
    }

    function render() {
        const s = group[idx];
        if (!s) return close();
        const token = ++renderToken;
        paused = false;
        if (timer) { clearTimeout(timer); timer = null; }
        stopActiveViewerMedia();

        const u = s.user || {};
        const av = overlay.querySelector('#sw-avatar');
        if (u.avatar_url) av.outerHTML = `<img id="sw-avatar" class="avatar" src="${u.avatar_url}" alt="" />`;
        else av.outerHTML = `<span id="sw-avatar" class="avatar">${initials(u.display_name || u.username)}</span>`;
        overlay.querySelector('#sw-name').textContent = (u.display_name || u.username) || '—';
        overlay.querySelector('#sw-time').textContent = formatStatusDate(s.created_at);
        loadDetails();

        if (s.user_id && state.me && s.user_id !== state.me.id && s.id && !s._counted) {
            s._counted = true;
            API.post('/api/chat/statuses/' + s.id + '/view', {})
                .catch(() => {})
                .finally(() => loadDetails());
        }

        const c = overlay.querySelector('#sw-content');
        c.innerHTML = '';
        if (s.type === 'image' && s.media_url) {
            const img = document.createElement('img');
            img.src = s.media_url;
            img.alt = '';
            img.draggable = false;
            c.appendChild(img);
        } else if (s.type === 'video' && s.media_url) {
            const loading = document.createElement('div');
            loading.className = 'sw-video-loading';
            loading.innerHTML = '<div class="spin-ring"></div>';
            c.appendChild(loading);
            const vid = document.createElement('video');
            // Jangan set src dulu di DOM yang terlihat — set setelah, tapi tetap di bawah overlay solid
            vid.playsInline = true;
            vid.setAttribute('webkit-playsinline', '');
            vid.preload = 'auto';
            vid.autoplay = true;
            vid.controls = false;
            vid.muted = false;
            vid.classList.add('is-loading');
            vid.setAttribute('aria-label', 'Status video');
            vid.style.cssText = 'opacity:0;visibility:hidden;position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000';
            activeVideo = vid;
            c.appendChild(vid);
            vid.src = s.media_url;

            const markReady = () => {
                if (token !== renderToken || activeVideo !== vid) return;
                vid.classList.remove('is-loading');
                vid.classList.add('is-ready');
                vid.style.cssText = 'width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;background:#000;display:block;opacity:1;visibility:visible;position:static';
                if (loading.parentNode) loading.remove();
            };
            const tryPlay = () => {
                if (token !== renderToken || activeVideo !== vid) return;
                // Keep sound when auto-advancing between statuses (user already interacted with viewer).
                vid.muted = false;
                const p = vid.play();
                if (p && p.catch) {
                    p.catch(() => {
                        // Last resort: muted play so progress still works, then unmute if possible.
                        vid.muted = true;
                        vid.play().then(() => {
                            try { vid.muted = false; } catch (_) {}
                        }).catch(() => {});
                    });
                }
            };
            if (vid.readyState >= 2) { markReady(); tryPlay(); }
            else {
                vid.addEventListener('loadeddata', () => { markReady(); tryPlay(); }, { once: true });
                vid.addEventListener('canplay', () => { markReady(); tryPlay(); }, { once: true });
            }
            setTimeout(() => { if (token === renderToken) tryPlay(); }, 400);
        } else {
            const text = document.createElement('div');
            text.className = 'sw-text';
            text.textContent = s.content || '';
            c.appendChild(text);
        }
        if (s.type !== 'text' && String(s.content || '').trim()) {
            c.insertAdjacentHTML('beforeend', `<div class="sw-caption">${escapeHtml(String(s.content).trim())}</div>`);
        }

        // Menu: penonton hanya Simpan; pemilik boleh Hapus
        const controlsEl = overlay.querySelector('#sw-controls');
        const isOwnerStatus = !!(state.me && String(s.user_id) === String(state.me.id));
        if (controlsEl) {
            controlsEl.innerHTML = isOwnerStatus
                ? `<button class="sw-ctrl-btn" id="sw-download"><svg class="icon icon-sm"><use href="#i-download"/></svg> Simpan</button>
                   <button class="sw-ctrl-btn danger" id="sw-delete"><svg class="icon icon-sm"><use href="#i-trash"/></svg> Hapus</button>`
                : `<button class="sw-ctrl-btn" id="sw-download"><svg class="icon icon-sm"><use href="#i-download"/></svg> Simpan</button>`;
        }
        overlay.querySelector('#sw-download').onclick = async () => {
            if (!s.media_url) { showToast('Tidak ada media'); return; }
            const dlBtn = overlay.querySelector('#sw-download');
            try {
                if (typeof AndroidDownloader !== 'undefined' && AndroidDownloader.saveBase64File) {
                    dlBtn.disabled = true;
                    const res = await fetch(s.media_url);
                    const blob = await res.blob();
                    const mime = blob.type || (s.type === 'video' ? 'video/mp4' : 'image/jpeg');
                    const ext = (mime.split('/')[1] || (s.type === 'video' ? 'mp4' : 'jpg')).split('+')[0];
                    const fileName = 'Status_' + Date.now() + '.' + ext;
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        AndroidDownloader.saveBase64File(reader.result, fileName, mime);
                        dlBtn.disabled = false;
                    };
                    reader.onerror = () => { showToast('Gagal memuat media.'); dlBtn.disabled = false; };
                    reader.readAsDataURL(blob);
                } else {
                    window.open(s.media_url, '_blank');
                }
            } catch (e) {
                showToast('Gagal menyimpan: ' + (e.message || 'error'));
                dlBtn.disabled = false;
            }
        };
        const delBtn = overlay.querySelector('#sw-delete');
        if (delBtn) {
            delBtn.onclick = async () => {
                if (!isOwnerStatus) return;
                try {
                    await API.del('/api/chat/statuses/' + s.id);
                    showToast('Status dihapus.');
                    group.splice(idx, 1);
                    if (!group.length) return close();
                    if (idx >= group.length) idx = group.length - 1;
                    render();
                    if (state.currentView === 'status') StatusModule.loadStatuses();
                } catch (e) { showToast(e.message || 'Gagal hapus status.'); }
            };
        }

        const bars = overlay.querySelectorAll('.sw-bar');
        setProgressBars();

        const vid = c.querySelector('video');
        if (vid && s.type === 'video') {
            const fill = bars[idx]?.querySelector('.sw-bar-fill');
            const update = () => {
                if (token !== renderToken || activeVideo !== vid || !fill || !isFinite(vid.duration) || !vid.duration) return;
                fill.style.width = Math.min(100, Math.max(0, (vid.currentTime / vid.duration) * 100)) + '%';
            };
            vid.addEventListener('timeupdate', update);
            vid.addEventListener('loadedmetadata', update);
            vid.addEventListener('durationchange', update);
            vid.addEventListener('play', update);
            vid.addEventListener('ended', () => { if (token === renderToken) next(); }, { once: true });
        } else {
            const duration = 5000;
            slideDuration = duration;
            slideRemaining = duration;
            slideStartedAt = Date.now();
            const bar = bars[idx];
            if (bar) {
                bar.style.setProperty('--sw-dur', (duration / 1000) + 's');
                const fill = bar.querySelector('.sw-bar-fill');
                fill.style.animation = 'none';
                void fill.offsetWidth;
                fill.style.animation = '';
            }
            timer = setTimeout(() => { if (token === renderToken && !paused) next(); }, duration);
        }
    }

    async function loadDetails() {
        const s = group[idx];
        if (!s?.id || !overlay) return;
        currentDetails = null;
        try {
            const details = await API.get('/api/chat/statuses/' + s.id + '/details');
            if (!overlay || group[idx]?.id !== s.id) return;
            currentDetails = details;
            s.views = details.views_count || 0;
            // sinkron ke state biar halaman "Status saya" ikut update angka
            const st = (state.statuses || []).find(x => String(x.id) === String(s.id));
            if (st) st.views = s.views;
            const viewerCount = overlay.querySelector('#sw-viewer-count');
            const likeCount = overlay.querySelector('#sw-like-count');
            if (viewerCount) {
                viewerCount.textContent = String(details.views_count || 0);
                viewerCount.classList.toggle('hidden', !(details.views_count > 0));
            }
            if (likeCount) {
                likeCount.textContent = String(details.likes_count || 0);
                likeCount.classList.toggle('hidden', !(details.likes_count > 0));
            }
            const viewerBtn = overlay.querySelector('#sw-viewers');
            const likeBtn = overlay.querySelector('#sw-like');
            if (viewerBtn) viewerBtn.title = `${details.views_count || 0} orang melihat`;
            if (likeBtn) {
                likeBtn.title = `${details.likes_count || 0} suka`;
                likeBtn.classList.toggle('liked', !!details.my_liked);
            }
            // Owner is the one who needs the viewer list the most; the list is still available to everyone.
            if (state.currentView === 'status') StatusModule.renderMyStatusPage?.();
        } catch (e) {
            currentDetails = null;
            console.warn('[status details]', e.message || e);
        }
    }

    async function toggleLike() {
        const s = group[idx];
        if (!s?.id || !overlay) return;
        const btn = overlay.querySelector('#sw-like');
        if (!btn) return;
        btn.disabled = true;
        try {
            const result = await API.post('/api/chat/statuses/' + s.id + '/like', {});
            btn.classList.toggle('liked', !!result.liked);
            const count = overlay.querySelector('#sw-like-count');
            count.textContent = String(result.likes_count || 0);
            count.classList.toggle('hidden', !(result.likes_count > 0));
            await loadDetails();
        } catch (e) {
            showToast(e.message || 'Gagal memberi suka.');
        } finally { btn.disabled = false; }
    }

    async function submitReply() {
        const s = group[idx];
        const input = overlay?.querySelector('#sw-reply');
        const sendBtn = overlay?.querySelector('#sw-send');
        if (!s?.id || !input) return;
        const content = input.value.trim();
        if (!content) return;
        input.disabled = true;
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.dataset.prevHtml = sendBtn.innerHTML;
            sendBtn.innerHTML = '<span class="sc-spin" style="width:18px;height:18px;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;display:block"></span>';
        }
        try {
            await API.post('/api/chat/statuses/' + s.id + '/reply', { content });
            input.value = '';
            showToast('Balasan sudah terkirim ✓', 2200);
            // Refresh detail (jumlah balasan) tanpa menutup viewer
            try { await loadDetails(); } catch (_) {}
            // Pastikan input tetap terlihat (tutup menu jika terbuka)
            const controls = overlay?.querySelector('#sw-controls');
            if (controls) controls.classList.add('hidden');
            if (overlay?._swResume) overlay._swResume();
        } catch (e) {
            showToast(e.message || 'Gagal mengirim balasan.');
        } finally {
            input.disabled = false;
            input.focus();
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerHTML = sendBtn.dataset.prevHtml || '<svg class="icon"><use href="#i-send"/></svg>';
            }
        }
    }

    function openDetailsSheet() {
        const s = group[idx];
        if (!s) return;
        // Hapus sheet viewers lama
        document.querySelectorAll('.action-sheet').forEach(el => {
            if (el.querySelector('.sw-viewers-sheet')) {
                const prev = el.previousElementSibling;
                if (prev && prev.classList.contains('action-sheet-backdrop')) prev.remove();
                el.remove();
            }
        });

        const backdrop = document.createElement('div');
        backdrop.className = 'action-sheet-backdrop';
        const sheet = document.createElement('div');
        sheet.className = 'action-sheet';
        sheet.innerHTML = `<div class="handle"></div>
            <div class="as-title">Yang melihat</div>
            <div class="sw-viewers-sheet" id="sw-viewers-body">
                <div style="padding:36px 18px;text-align:center">
                    <div style="width:28px;height:28px;border:3px solid #ddd;border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 10px"></div>
                    <p class="muted small" style="margin:0">Memuat...</p>
                </div>
            </div>`;
        document.body.appendChild(backdrop);
        document.body.appendChild(sheet);
        const closeSheet = () => {
            sheet.classList.add('closing');
            backdrop.style.animation = 'fadeOut .2s ease forwards';
            setTimeout(() => { sheet.remove(); backdrop.remove(); }, 210);
        };
        backdrop.onclick = closeSheet;

        const fillBody = (d) => {
            const body = sheet.querySelector('#sw-viewers-body');
            if (!body) return;
            d = d || { views: [], likes: [], views_count: 0, likes_count: 0 };
            const likeMap = new Map((d.likes || []).map(x => [String(x.user_id), x]));
            const rows = (d.views || []).map(v => {
                const u = v.user || {};
                const like = likeMap.get(String(v.viewer_id));
                const timeLine = `Dilihat ${formatStatusDate(v.viewed_at)}${like?.created_at ? ` · Disukai ${formatStatusDate(like.created_at)}` : ''}`;
                return `<div class="sw-viewer-row">
                    ${avatarHTML(u)}
                    <div class="who"><strong>${escapeHtml(u.display_name || u.username || 'Pengguna')}</strong><small>${escapeHtml(timeLine)}</small></div>
                    ${like ? '<i class="fa-solid fa-heart heart-mini" title="Menyukai"></i>' : ''}
                </div>`;
            }).join('');
            body.innerHTML = `
                <div class="sw-replies-head">${d.views_count || 0} dilihat${d.likes_count ? ' · ' + d.likes_count + ' suka' : ''}</div>
                ${rows || '<div class="my-status-empty" style="padding:28px 18px"><i class="fa-regular fa-eye"></i><p>Belum ada yang melihat status ini.</p></div>'}`;
        };

        if (currentDetails && String(group[idx]?.id) === String(s.id)) {
            fillBody(currentDetails);
        }
        loadDetails().then(() => {
            if (!sheet.isConnected) return;
            fillBody(currentDetails);
        }).catch(() => {
            if (!sheet.isConnected) return;
            if (!currentDetails) fillBody(null);
        });
    }

    function formatStatusDate(value) {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).replace('.', ':');
    }

    function next() {
        if (!overlay) return;
        if (idx + 1 < group.length) {
            stopActiveViewerMedia();
            idx++;
            render();
            return;
        }
        // Status user ini sudah habis — otomatis lanjut ke status user berikutnya (kalau ada), seperti WhatsApp.
        if (sequence && seqIdx != null && seqIdx + 1 < sequence.length) {
            stopActiveViewerMedia();
            seqIdx++;
            group = sequence[seqIdx].slice();
            idx = 0;
            rebuildProgressBars();
            render();
            return;
        }
        close();
    }

    function prev() {
        if (!overlay) return;
        stopActiveViewerMedia();
        if (idx > 0) { idx--; render(); return; }
        if (sequence && seqIdx != null && seqIdx > 0) {
            seqIdx--;
            group = sequence[seqIdx].slice();
            idx = group.length - 1;
            rebuildProgressBars();
            render();
            return;
        }
        render();
    }

    function close() {
        renderToken++;
      // 🎨 Status bar balik putih
setDarkStatusBar(false);
        if (timer) { clearTimeout(timer); timer = null; }
        stopActiveViewerMedia();
        if (!overlay) return;
        const el = overlay;
        overlay = null;
        el.classList.add('closing');
        setTimeout(() => el.remove(), 220);
        if (state && state.currentView === 'status') StatusModule.loadStatuses();
    }

    return { init, open, close };
})();
