/* ============================================================
   PROFILE MODULE
   ============================================================ */
const ProfileModule = (function () {
    let state = null, bound = false;

    function init(s) {
        state = s;
        const avatarInput = document.getElementById('avatar-input');
        if (avatarInput) { avatarInput.removeEventListener('change', uploadAvatar); avatarInput.addEventListener('change', uploadAvatar); }
        if (bound) return;
        bound = true;
        document.addEventListener('click', (e) => {
            const editLabel = e.target.closest('label.avatar-edit, label[for="avatar-input"]');
            if (editLabel) { e.preventDefault(); const inp = document.getElementById('avatar-input'); if (inp) inp.click(); return; }
            if (e.target.closest('#save-profile')) { e.preventDefault(); saveProfile(); return; }
            if (e.target.closest('#change-password')) { e.preventDefault(); changePassword(); return; }
            if (e.target.closest('#logout-btn')) { e.preventDefault(); confirmLogout(); return; }
            const overlay = e.target.closest('#pretv-logout-modal');
            if (overlay) {
                if (e.target.id === 'pretv-logout-modal') { overlay.remove(); return; }
                if (e.target.closest('[data-cancel]')) { overlay.remove(); return; }
                if (e.target.closest('[data-confirm]')) { overlay.remove(); doLogout(); return; }
            }
        });
    }

    async function loadProfile() {
        let me = state.me;
        try {
            const res = await API.get('/api/chat/me');
            if (res && res.user) { me = res.user; state.me = me; try { localStorage.setItem('pretv_me', JSON.stringify(me)); } catch (_) { } }
        } catch (e) {
            console.warn('[profile]', e.message);
            try { const cached = JSON.parse(localStorage.getItem('pretv_me') || 'null'); if (cached) { me = cached; state.me = me; } } catch (_) { }
            if (!me) { showToast('Sesi tidak valid.'); setMsg('Gagal memuat profil.', true); return; }
        }
        const u = me || {};
        renderAvatar('me-avatar', u.avatar_url, u.display_name || u.username, 'xl');
        const nameF = document.getElementById('field-display_name');
        const userF = document.getElementById('field-username');
        const aboutF = document.getElementById('field-about');
        if (nameF) nameF.value = u.display_name || u.username || '';
        if (userF) userF.value = u.username ? ('@' + u.username) : '';
        if (aboutF) aboutF.value = u.about || '';
        setMsg('');
        const po = document.getElementById('pw-old'); if (po) po.value = '';
        const pn = document.getElementById('pw-new'); if (pn) pn.value = '';
        const pc = document.getElementById('pw-confirm'); if (pc) pc.value = '';
        setPwMsg('');
    }

    function renderAvatar(id, url, name, sizeClass) {
        const el = document.getElementById(id);
        if (!el) return;
        const cls = ('avatar ' + (sizeClass || '')).trim();
        const parent = el.parentNode;
        if (!parent) return;
        if (url) {
            if (el.tagName === 'IMG') { el.src = url; el.className = cls; el.alt = ''; }
            else { const img = document.createElement('img'); img.id = id; img.className = cls; img.src = url; img.alt = ''; parent.replaceChild(img, el); }
        } else {
            const initial = initials(name);
            if (el.tagName === 'SPAN') { el.className = cls; el.textContent = initial; }
            else { const span = document.createElement('span'); span.id = id; span.className = cls; span.textContent = initial; parent.replaceChild(span, el); }
        }
    }

    async function uploadAvatar(e) {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) { setMsg('Foto terlalu besar. Maksimal 5 MB.', true); showToast('Foto terlalu besar (maks 5 MB)'); e.target.value = ''; return; }
        if (!f.type.startsWith('image/')) { setMsg('File harus berupa gambar.', true); showToast('File harus gambar'); e.target.value = ''; return; }
        setMsg('Mengunggah foto...', false);
        const editLabel = document.querySelector('label.avatar-edit');
        if (editLabel) editLabel.classList.add('uploading');
        try {
            const fd = new FormData(); fd.append('file', f);
            const res = await API.upload('/api/chat/upload/avatar', fd);
            if (res && res.user) { state.me = res.user; try { localStorage.setItem('pretv_me', JSON.stringify(res.user)); } catch (_) { } }
            await loadProfile();
            setMsg('Foto profil diperbarui.');
            showToast('Foto diperbarui');
        } catch (err) { setMsg(err.message || 'Gagal upload.', true); showToast(err.message || 'Gagal upload foto'); }
        finally { if (editLabel) editLabel.classList.remove('uploading'); e.target.value = ''; }
    }

    async function saveProfile() {
        const nameF = document.getElementById('field-display_name');
        const userF = document.getElementById('field-username');
        const aboutF = document.getElementById('field-about');
        if (!nameF) return;
        const display_name = String(nameF.value || '').trim();
        let username = String(userF ? userF.value : '').trim().replace(/^@/, '').toLowerCase();
        const about = String(aboutF ? aboutF.value : '').trim();
        if (!display_name) { setMsg('Nama tampilan tidak boleh kosong.', true); return; }
        if (display_name.length > 60) { setMsg('Nama maksimal 60 karakter.', true); return; }
        if (!username || !/^[a-z0-9_.]{3,30}$/.test(username)) { setMsg('Username hanya huruf kecil, angka, titik, underscore (3–30).', true); return; }
        if (about.length > 300) { setMsg('Tentang maksimal 300 karakter.', true); return; }
        const btn = document.getElementById('save-profile');
        const original = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = 'Menyimpan...'; }
        setMsg('Menyimpan...', false);
        try {
            const res = await API.put('/api/chat/profile', { display_name, username, about });
            const user = res && res.user;
            if (user) { state.me = user; try { localStorage.setItem('pretv_me', JSON.stringify(user)); } catch (_) { } }
            await loadProfile();
            setMsg('Perubahan disimpan.');
            showToast('Profil disimpan');
        } catch (err) { setMsg(err.message || 'Gagal simpan.', true); showToast(err.message || 'Gagal simpan'); }
        finally { if (btn) { btn.disabled = false; btn.innerHTML = original || 'Simpan perubahan'; } }
    }

    async function changePassword() {
        const oldPw = document.getElementById('pw-old').value;
        const newPw = document.getElementById('pw-new').value;
        const confPw = document.getElementById('pw-confirm').value;
        if (!oldPw || !newPw || !confPw) { setPwMsg('Semua field wajib diisi.', true); return; }
        if (newPw.length < 4) { setPwMsg('Password baru minimal 4 karakter.', true); return; }
        if (newPw !== confPw) { setPwMsg('Konfirmasi password tidak sama.', true); return; }
        if (newPw === oldPw) { setPwMsg('Password baru harus beda dari yang lama.', true); return; }
        const btn = document.getElementById('change-password');
        const original = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = 'Menyimpan...'; }
        setPwMsg('Memproses...', false);
        try {
            await API.put('/api/chat/password', { old_password: oldPw, new_password: newPw });
            setPwMsg('Password berhasil diganti.', false);
            showToast('Password diganti');
            document.getElementById('pw-old').value = '';
            document.getElementById('pw-new').value = '';
            document.getElementById('pw-confirm').value = '';
        } catch (err) { setPwMsg(err.message || 'Gagal ganti password.', true); showToast(err.message || 'Gagal'); }
        finally { if (btn) { btn.disabled = false; btn.innerHTML = original || 'Ganti Password'; } }
    }

    function confirmLogout() {
        const existing = document.getElementById('pretv-logout-modal');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'pretv-logout-modal';
        overlay.style.cssText = ['position:fixed', 'inset:0', 'z-index:99999', 'background:rgba(0,0,0,.5)', 'display:flex', 'align-items:center', 'justify-content:center', 'padding:20px', 'box-sizing:border-box'].join(';');
        overlay.style.animation = 'fadeIn .18s ease';
        overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:20px;max-width:340px;width:100%;box-sizing:border-box;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:inherit;animation:popIn .22s cubic-bezier(.2,.9,.3,1)">
            <h3 style="margin:0 0 8px;font-size:17px;font-weight:600;color:#111;">Keluar dari akun?</h3>
            <p style="margin:0 0 18px;color:#666;font-size:14px;line-height:1.4;">Anda perlu login kembali untuk menggunakan chat.</p>
            <div style="display:flex;gap:8px;">
                <button type="button" data-cancel style="flex:1;padding:11px 14px;border:1px solid #ddd;border-radius:10px;background:#fff;color:#333;font-size:14px;font-weight:500;cursor:pointer;">Batal</button>
                <button type="button" data-confirm style="flex:1;padding:11px 14px;border:none;border-radius:10px;background:#e74c3c;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Logout</button>
            </div></div>`;
        document.body.appendChild(overlay);
    }

    async function doLogout() {
        const btn = document.getElementById('logout-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Keluar...'; }
        try { PresenceManager.stop(); } catch (_) { }
        try { await API.post('/api/chat/logout', {}); } catch (_) { }
        try { WSManager.close(); } catch (_) { }
        API.token = null;
        try { localStorage.removeItem('pretv_token'); localStorage.removeItem('pretv_me'); sessionStorage.clear(); } catch (_) { }
        const navAdmin = document.getElementById('nav-admin');
        if (navAdmin) navAdmin.classList.add('hidden');
        AuthModule.showAuth();
        if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="icon icon-sm"><use href="#i-logout"/></svg> Logout'; }
    }

    function onPresenceUpdate() { }
    function setMsg(text, isError) {
        const el = document.getElementById('profile-msg');
        if (!el) return;
        if (!text) { el.textContent = ''; el.className = 'muted small'; return; }
        el.textContent = text; el.className = isError ? 'error small' : 'muted small';
    }
    function setPwMsg(text, isError) {
        const el = document.getElementById('pw-msg');
        if (!el) return;
        if (!text) { el.textContent = ''; el.className = 'muted small'; return; }
        el.textContent = text; el.className = isError ? 'error small' : 'muted small';
    }

    return { init, loadProfile, onPresenceUpdate };
})();
