/* ============================================================
   STATUS MODULE (REVAMPED)
   ============================================================ */
const StatusModule = (function () {
    let state = null;
    let pickerTarget = 'status'; // 'status' atau 'my-status'
    let statusFirstPaint = true;

    function init(s) {
        state = s;
        const addBtn = document.getElementById('add-status');
        if (addBtn) addBtn.addEventListener('click', () => openStatusPicker('status'));

        // Tombol back halaman My Status
        const msBack = document.getElementById('ms-back');
        if (msBack) msBack.addEventListener('click', () => closeMyStatusPage());
        // Upload status dilakukan dari tombol + pada kartu Status saya, seperti WhatsApp.

        // Hydrate status dari cache segera
        try {
            const cached = JSON.parse(localStorage.getItem('pretv_statuses') || sessionStorage.getItem('pretv_statuses') || 'null');
            if (Array.isArray(cached) && cached.length) {
                state.statuses = cached;
                setTimeout(() => renderStatuses(), 0);
            }
        } catch (_) {}
    }

    async function loadStatuses() {
        // Tampilkan cache dulu biar langsung ada (tanpa tunggu Supabase)
        try {
            const cached = JSON.parse(localStorage.getItem('pretv_statuses') || sessionStorage.getItem('pretv_statuses') || 'null');
            if (Array.isArray(cached) && cached.length && !(state.statuses && state.statuses.length)) {
                state.statuses = cached;
                renderStatuses();
            }
        } catch (_) {}
        try {
            const { data } = await API.get('/api/chat/statuses');
            state.statuses = data || [];
            try {
                localStorage.setItem('pretv_statuses', JSON.stringify(state.statuses.slice(0, 40)));
                sessionStorage.setItem('pretv_statuses', JSON.stringify(state.statuses.slice(0, 40)));
            } catch (_) {}
            renderStatuses();
            if (!document.getElementById('my-status-page').classList.contains('hidden')) {
                renderMyStatusPage();
            }
        } catch (e) {
            if (!(state.statuses && state.statuses.length)) showToast(e.message || 'Gagal memuat status.');
            else renderStatuses();
        }
    }

    function renderStatuses() {
        const box = document.getElementById('status-list');
        if (!box) return;

        const mine = state.statuses.filter(s => s.user_id === state.me.id);
        const others = state.statuses.filter(s => s.user_id !== state.me.id);

        // Group others per-user
        const byUser = {};
        others.forEach(s => { (byUser[s.user_id] = byUser[s.user_id] || []).push(s); });
        Object.values(byUser).forEach(arr => arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));

        const ordered = Object.entries(byUser).sort((a, b) => {
            const la = new Date(a[1][a[1].length - 1].created_at).getTime();
            const lb = new Date(b[1][b[1].length - 1].created_at).getTime();
            return lb - la;
        });

        // Tile "Status saya"
        const me = state.me || {};
        const mySorted = mine.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const myLatest = mySorted[mySorted.length - 1];
        const myPreview = myLatest ? renderTilePreview(myLatest) : `<div class="tile-empty"><i class="fa-solid fa-plus"></i></div>`;
        const myAvatarHTML = me.avatar_url
            ? `<img src="${me.avatar_url}" alt="" />`
            : initials(me.display_name || me.username);

        const tileAnim = statusFirstPaint ? ' anim-enter' : '';
        statusFirstPaint = false;

        let html = `
            <div class="status-tile ${myLatest ? 'mine' : 'mine-new'}${tileAnim}" data-uid="__me__" id="my-status-tile" style="${tileAnim ? 'animation-delay:0.02s' : ''}">
                <div class="tile-bg">${myPreview}</div>
                <div class="tile-gradient"></div>
                <div class="tile-avatar">${myAvatarHTML}<span class="tile-plus" id="my-status-plus" role="button" aria-label="Tambah status"><i class="fa-solid fa-plus"></i></span></div>
                ${myLatest ? `<div class="tile-time">${timeAgo(myLatest.created_at)}</div>` : ''}
                <div class="tile-name">Status saya</div>
            </div>
        `;

        // Tile orang lain
        html += ordered.map(([uid, arr], i) => {
            const u = arr[0].user || {};
            const latest = arr[arr.length - 1];
            const preview = renderTilePreview(latest);
            const name = escapeHtml((u.display_name || u.username || '—').split(' ')[0]);
            const time = timeAgo(latest.created_at);
            const delay = tileAnim ? `style="animation-delay:${0.05 + i * 0.05}s"` : '';
            return `<div class="status-tile${tileAnim}" data-uid="${uid}" ${delay}>
                        <div class="tile-bg">${preview}</div>
                        <div class="tile-gradient"></div>
                        <div class="tile-avatar">${u.avatar_url ? `<img src="${u.avatar_url}" alt="" />` : initials(u.display_name || u.username)}</div>
                        <div class="tile-time">${time}</div>
                        <div class="tile-name">${name}</div>
                    </div>`;
        }).join('');

        box.innerHTML = html;

        const addMine = box.querySelector('#my-status-plus');
        if (addMine) addMine.addEventListener('click', (e) => {
            e.stopPropagation();
            openStatusPicker('status', true);
        });

        box.querySelectorAll('.status-tile').forEach(el => {
            el.addEventListener('click', () => {
                const uid = el.dataset.uid;
                if (uid === '__me__') {
                    if (!mySorted.length) return openStatusPicker('my-status');
                    openMyStatusPage();
                    return;
                }
                const arr = byUser[uid];
                if (arr && arr.length) {
                    const seq = ordered.map(([, a]) => a);
                    const seqIndex = ordered.findIndex(([u2]) => u2 === uid);
                    StatusViewer.open(arr, 0, seq, seqIndex);
                }
            });
        });
    }

    function renderTilePreview(s) {
        if (s.type === 'image' && s.media_url) return `<img src="${s.media_url}" alt="" loading="lazy" />`;
        if (s.type === 'video' && s.media_url) {
            // Spinner dulu; setelah frame siap tampil cover. Timeout 8s → tampilkan frame apa adanya.
            return `<div class="tile-video-loading" style="position:absolute;inset:0;z-index:2"><div class="spin-ring"></div></div><video class="is-loading" src="${s.media_url}#t=0.1" preload="metadata" muted playsinline onloadeddata="this.classList.remove('is-loading');this.style.cssText='width:100%;height:100%;object-fit:cover;opacity:1;visibility:visible;position:absolute;inset:0';var l=this.parentNode&&this.parentNode.querySelector('.tile-video-loading');if(l)l.remove();" onerror="var l=this.parentNode&&this.parentNode.querySelector('.tile-video-loading');if(l)l.innerHTML='<i class=\'fa-solid fa-video\' style=\'color:#fff;font-size:28px;opacity:.7\'></i>';" style="opacity:0;visibility:hidden;position:absolute;width:1px;height:1px"></video>`;
        }
        return `<div class="tile-text">${escapeHtml(s.content || '')}</div>`;
    }

    /* ---------- MY STATUS PAGE ---------- */
    function openMyStatusPage() {
        document.getElementById('my-status-page').classList.remove('hidden');
        renderMyStatusPage();
    }
    function closeMyStatusPage() {
        document.getElementById('my-status-page').classList.add('hidden');
    }
    function renderMyStatusPage() {
        const listEl = document.getElementById('my-status-list');
        if (!listEl) return;
        const mine = state.statuses
            .filter(s => s.user_id === state.me.id)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (!mine.length) {
            listEl.innerHTML = `<div class="my-status-empty"><i class="fa-regular fa-clock"></i><p class="muted">Belum ada status.</p></div>`;
            return;
        }

        listEl.innerHTML = mine.map(s => {
            const views = (typeof s.views === 'number') ? s.views : 0;
            const when = timeAgo(s.created_at);
            const timeFull = new Date(s.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', ':');
            const thumb = s.type === 'image' && s.media_url
                ? `<img src="${s.media_url}" alt="" />`
                : s.type === 'video' && s.media_url
                    ? `<video src="${s.media_url}#t=0.1" preload="metadata" muted playsinline></video>`
                    : `<div class="ms-thumb-text">${escapeHtml((s.content || '').slice(0, 40))}</div>`;
            return `<div class="my-status-row" data-id="${s.id}">
                        <div class="ms-thumb">${thumb}</div>
                        <div class="ms-body">
                            <div class="ms-title">${views}x dilihat</div>
                            <div class="ms-sub">${escapeHtml(timeFull)} &bull; ${escapeHtml(when)}</div>
                        </div>
                        <button class="ms-menu-btn" data-menu="${s.id}" aria-label="Menu"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                    </div>`;
        }).join('');

        // Klik row → viewer
        listEl.querySelectorAll('.my-status-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.ms-menu-btn')) return;
                const id = row.dataset.id;
                const sorted = mine.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                const idx = sorted.findIndex(x => x.id === id);
                StatusViewer.open(sorted, idx >= 0 ? idx : 0);
            });
        });

        // Menu 3-titik
        listEl.querySelectorAll('.ms-menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openStatusItemMenu(btn.dataset.menu);
            });
        });
    }

    function openStatusItemMenu(statusId) {
        const s = state.statuses.find(x => String(x.id) === String(statusId));
        if (!s) return;
        const backdrop = document.createElement('div');
        backdrop.className = 'action-sheet-backdrop';
        const sheet = document.createElement('div');
        sheet.className = 'action-sheet';
        sheet.innerHTML = `
            <div class="handle"></div>
            <div class="as-title">Status &bull; ${escapeHtml(timeAgo(s.created_at))}</div>
            <button class="as-btn" data-act="view"><svg class="icon icon-sm"><use href="#i-eye"/></svg> Lihat status</button>
            <button class="as-btn danger" data-act="delete"><svg class="icon icon-sm"><use href="#i-trash"/></svg> Hapus status</button>
            <button class="as-btn" data-act="close"><svg class="icon icon-sm"><use href="#i-close"/></svg> Tutup</button>
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
            if (act === 'close') return closeSheet();
            if (act === 'view') {
                closeSheet();
                const mine = state.statuses.filter(x => x.user_id === state.me.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                const idx = mine.findIndex(x => x.id === s.id);
                StatusViewer.open(mine, idx >= 0 ? idx : 0);
                return;
            }
            if (act === 'delete') {
                closeSheet();
                try {
                    await API.del('/api/chat/statuses/' + s.id);
                    showToast('Status dihapus.');
                    await loadStatuses();
                } catch (err) { showToast(err.message || 'Gagal hapus.'); }
            }
        };
    }

    /* ---------- PICKER & COMPOSER ---------- */
    function openStatusPicker(target, mediaOnly = false) {
        pickerTarget = target || 'status';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-card status-picker-card">
                <h3>${mediaOnly ? 'Tambah status' : 'Status baru'}</h3>
                <p class="muted small">${mediaOnly ? 'Pilih foto atau video' : 'Pilih tipe status'}</p>
                <div class="status-picker ${mediaOnly ? 'status-picker-media-only' : ''}">
                    ${mediaOnly ? '' : `<button class="btn picker-btn" data-type="text"><svg class="icon icon-sm"><use href="#i-chat"/></svg> Teks</button>`}
                    <button class="btn picker-btn" data-type="image"><svg class="icon icon-sm"><use href="#i-image"/></svg> Foto</button>
                    <button class="btn picker-btn" data-type="video"><svg class="icon icon-sm"><use href="#i-video"/></svg> Video</button>
                </div>
                <button class="btn" data-cancel style="width:100%;margin-top:4px"><svg class="icon icon-sm"><use href="#i-close"/></svg> Batal</button>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.closest('[data-cancel]')) { modal.remove(); return; }
            const btn = e.target.closest('button[data-type]');
            if (!btn) return;
            const type = btn.dataset.type;
            modal.remove();
            if (type === 'text') openTextComposer();
            else if (type === 'image') pickFileAndUpload('image/*', 'image');
            else if (type === 'video') pickFileAndUpload('video/*', 'video');
        });
    }

    function openTextComposer() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-card">
                <h3>Tulis status</h3>
                <textarea id="status-text-input" rows="4" placeholder="Apa yang sedang kamu pikirkan?"
                    style="width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;font-size:15px;outline:none;resize:none;font-family:inherit;box-sizing:border-box"></textarea>
                <div class="modal-actions">
                    <button class="btn" data-cancel><svg class="icon icon-sm"><use href="#i-close"/></svg> Batal</button>
                    <button class="btn primary" data-submit><svg class="icon icon-sm"><use href="#i-send"/></svg> Posting</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const input = modal.querySelector('#status-text-input');
        input.focus();
        modal.addEventListener('click', async (e) => {
            if (e.target === modal || e.target.closest('[data-cancel]')) { modal.remove(); return; }
            if (e.target.closest('button[data-submit]')) {
                const text = input.value.trim();
                if (!text) return;
                const btn = modal.querySelector('button[data-submit]');
                btn.disabled = true;
                try {
                    await API.post('/api/chat/statuses', { type: 'text', content: text });
                    modal.remove();
                    await loadStatuses();
                    if (pickerTarget === 'my-status') renderMyStatusPage();
                    showToast('Status diposting.');
                } catch (err) { showToast(err.message || 'Gagal posting.'); btn.disabled = false; }
            }
        });
    }

    async function compressVideoIfNeeded(file, targetMaxBytes = 18 * 1024 * 1024) {
        if (!file || !String(file.type || '').startsWith('video/')) return file;
        if (file.size <= targetMaxBytes) return file;

        showToast('Mengompres video...', 2500);

        const objectUrl = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.src = objectUrl;

        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('Timeout load video')), 20000);
            video.onloadedmetadata = () => { clearTimeout(t); resolve(); };
            video.onerror = () => { clearTimeout(t); reject(new Error('Gagal load video')); };
        });

        // Target 720p, bitrate menyesuaikan durasi agar ~ targetMaxBytes
        const maxW = 720;
        const scale = Math.min(1, maxW / (video.videoWidth || maxW));
        const w = Math.max(2, Math.round((video.videoWidth || 640) * scale / 2) * 2);
        const h = Math.max(2, Math.round((video.videoHeight || 360) * scale / 2) * 2);
        const duration = Math.max(1, video.duration || 15);
        // sisakan ruang untuk audio ~ target * 0.9
        const targetBits = Math.min(2_500_000, Math.max(600_000, Math.floor((targetMaxBytes * 8 * 0.85) / duration)));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        let stream;
        try {
            stream = canvas.captureStream(24);
        } catch (e) {
            URL.revokeObjectURL(objectUrl);
            throw new Error('Perangkat tidak mendukung kompresi video.');
        }

        // coba ambil audio dari video
        try {
            const vStream = video.captureStream ? video.captureStream() : (video.mozCaptureStream && video.mozCaptureStream());
            if (vStream) {
                vStream.getAudioTracks().forEach(t => stream.addTrack(t));
            }
        } catch (_) {}

        const mimeCandidates = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        const mime = mimeCandidates.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
        if (!mime) {
            URL.revokeObjectURL(objectUrl);
            // fallback: potong? atau tolak
            if (file.size > 60 * 1024 * 1024) throw new Error('Video terlalu besar & perangkat tidak bisa kompres. Maks ~20MB.');
            return file;
        }

        const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: targetBits });
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

        const done = new Promise((resolve, reject) => {
            recorder.onstop = () => resolve();
            recorder.onerror = () => reject(new Error('Gagal merekam video terkompresi'));
        });

        video.currentTime = 0;
        await video.play().catch(() => {});
        recorder.start(250);

        let raf = 0;
        const draw = () => {
            if (video.paused || video.ended) return;
            try { ctx.drawImage(video, 0, 0, w, h); } catch (_) {}
            raf = requestAnimationFrame(draw);
        };
        draw();

        await new Promise((resolve) => {
            video.onended = resolve;
            // safety: max 3 menit process
            setTimeout(resolve, Math.min(duration * 1000 + 2000, 180000));
        });
        cancelAnimationFrame(raf);
        try { video.pause(); } catch (_) {}
        if (recorder.state !== 'inactive') recorder.stop();
        await done;

        stream.getTracks().forEach(t => t.stop());
        URL.revokeObjectURL(objectUrl);

        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        if (!blob.size) throw new Error('Kompresi menghasilkan file kosong.');
        const outName = (file.name || 'status').replace(/\.[^.]+$/, '') + '.webm';
        const out = new File([blob], outName, { type: blob.type || 'video/webm', lastModified: Date.now() });
        if (out.size > 25 * 1024 * 1024) {
            showToast('Video masih besar setelah kompres. Coba lebih pendek.', 2500);
        } else {
            showToast('Video dikompres ✓', 1500);
        }
        return out;
    }
    // Ekspos global agar chat & grup bisa pakai
    window.compressVideoIfNeeded = compressVideoIfNeeded;

    async function snapshotFile(f) {
        // Salin file ke memori segera — di Android/WebView referensi File input sering "mati"
        // setelah dialog ditutup → error permission saat arrayBuffer().
        const type = f.type || (String(f.name || '').match(/\.mp4$/i) ? 'video/mp4' : 'application/octet-stream');
        const name = f.name || (type.startsWith('video/') ? 'video.mp4' : 'image.jpg');
        try {
            const buf = await f.arrayBuffer();
            return new File([buf], name, { type, lastModified: Date.now() });
        } catch (e) {
            // fallback: coba clone lewat blob slice
            try {
                const blob = f.slice(0, f.size, type);
                const buf = await blob.arrayBuffer();
                return new File([buf], name, { type, lastModified: Date.now() });
            } catch (e2) {
                throw new Error('File tidak bisa dibaca. Coba pilih ulang dari galeri.');
            }
        }
    }

    function pickFileAndUpload(accept, type) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept;
        // keep in DOM until snapshot selesai
        inp.style.cssText = 'position:fixed;left:-9999px;opacity:0;pointer-events:none';
        document.body.appendChild(inp);
        inp.onchange = async () => {
            const f = inp.files && inp.files[0];
            if (!f) { inp.remove(); return; }
            // Izinkan hingga ~60MB; video besar akan dikompres otomatis
            if (f.size > 60 * 1024 * 1024) {
                showToast('File terlalu besar. Maksimal 60 MB (akan dikompres otomatis jika video).');
                inp.remove();
                return;
            }
            try {
                showToast('Menyiapkan file...', 900);
                let stable = await snapshotFile(f);
                if (type === 'video' && stable.size > 18 * 1024 * 1024) {
                    try {
                        stable = await compressVideoIfNeeded(stable, 18 * 1024 * 1024);
                    } catch (ce) {
                        if (stable.size > 20 * 1024 * 1024) throw ce;
                        showToast('Kompres gagal, coba upload asli...', 1500);
                    }
                } else if (type !== 'video' && stable.size > 20 * 1024 * 1024) {
                    throw new Error('Foto terlalu besar. Maksimal 20 MB.');
                }
                inp.remove();
                openStatusCaptionComposer(stable, type);
            } catch (err) {
                inp.remove();
                showToast(err.message || 'Gagal membaca file.');
            }
        };
        inp.click();
    }

    function openStatusCaptionComposer(file, type) {
    const previewUrl = URL.createObjectURL(file);
    const page = document.createElement('div');
    page.className = 'sc-page';

    // 🎨 Status bar hitam
    setDarkStatusBar(true);
        page.innerHTML = `
            <div class="sc-top">
                <button type="button" class="icon-btn" id="sc-close" style="color:#fff" aria-label="Batal"><svg class="icon"><use href="#i-close"/></svg></button>
                <h1>${type === 'video' ? 'Status video' : 'Status foto'}</h1>
            </div>
            <div class="sc-preview" id="sc-preview"></div>
            <div class="sc-bottom">
                <input id="sc-caption" type="text" maxlength="500" placeholder="Tambahkan caption..." autocomplete="off" />
                <button type="button" class="sc-send" id="sc-send" aria-label="Posting"><i class="fa-solid fa-paper-plane"></i></button>
            </div>`;
        document.body.appendChild(page);
        const preview = page.querySelector('#sc-preview');
        if (type === 'video') {
            const v = document.createElement('video');
            v.src = previewUrl; v.controls = true; v.playsInline = true; v.muted = true;
            preview.appendChild(v);
            v.play().catch(() => {});
        } else {
            const img = document.createElement('img');
            img.src = previewUrl; img.alt = '';
            preview.appendChild(img);
        }
        const close = () => {
    URL.revokeObjectURL(previewUrl);
    page.remove();
    // 🎨 Status bar balik putih
    setDarkStatusBar(false);
};
        page.querySelector('#sc-close').onclick = close;
        page.querySelector('#sc-caption').focus();
        page.querySelector('#sc-send').onclick = async () => {
            const caption = page.querySelector('#sc-caption').value.trim();
            const btn = page.querySelector('#sc-send');
            if (btn.disabled) return;
            btn.disabled = true;
            btn.classList.add('loading');
            btn.innerHTML = '<span class="sc-spin" aria-hidden="true"></span>';
            btn.setAttribute('aria-label', 'Mengunggah...');
            const capInp = page.querySelector('#sc-caption');
            if (capInp) capInp.disabled = true;
            showToast('Mengunggah status...');
            try {
                const fd = new FormData();
                // pastikan File punya nama + type (penting untuk video Android)
                const uploadFile = (file instanceof File)
                    ? file
                    : new File([file], type === 'video' ? 'status.mp4' : 'status.jpg', { type: file.type || (type === 'video' ? 'video/mp4' : 'image/jpeg') });
                fd.append('file', uploadFile, uploadFile.name);
                const { url } = await API.upload('/api/chat/upload/status', fd);
                if (!url) throw new Error('Upload gagal: URL kosong.');
                await API.post('/api/chat/statuses', { type, media_url: url, content: caption || null });
                close();
                await loadStatuses();
                if (pickerTarget === 'my-status') renderMyStatusPage();
                showToast('Status diposting.');
            } catch (err) {
                const msg = String(err && err.message || err || '');
                if (/could not be read|permission/i.test(msg)) {
                    showToast('Gagal baca file. Pilih ulang video dari galeri (maks 20MB).');
                } else {
                    showToast(msg || 'Gagal upload.');
                }
                btn.disabled = false;
                btn.classList.remove('loading');
                btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
                btn.setAttribute('aria-label', 'Posting');
                if (capInp) capInp.disabled = false;
            }
        };
    }

    function showUploadToast(text) {
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerHTML = `<svg class="icon icon-sm spin"><use href="#i-upload"/></svg> <span>${escapeHtml(text)}</span>`;
        document.body.appendChild(el);
        return el;
    }

    return { init, loadStatuses, openStatusPicker };
})();
