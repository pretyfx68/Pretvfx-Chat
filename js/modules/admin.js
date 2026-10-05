/* ============================================================
   ADMIN MODULE
   ============================================================ */
const AdminModule = (function () {
    let state = null, bound = false;
    let allUsers = [];
    function init(s) {
        state = s;
        if (bound) return;
        bound = true;
        const saveBtn = document.getElementById('admin-save');
        const testBtn = document.getElementById('admin-test');
        if (saveBtn) saveBtn.addEventListener('click', onSave);
        if (testBtn) testBtn.addEventListener('click', onTestUpload);
        const aiSaveBtn = document.getElementById('admin-ai-save');
        if (aiSaveBtn) aiSaveBtn.addEventListener('click', onSaveAI);
        const searchInp = document.getElementById('admin-user-search');
        if (searchInp) searchInp.addEventListener('input', () => renderUsers(searchInp.value.trim().toLowerCase()));
    }
    function isAdmin() { return state && state.me && state.me.username === ADMIN_USERNAME; }
    function showNavIfAdmin() {
        const btn = document.getElementById('nav-admin');
        if (!btn) return;
        if (isAdmin()) btn.classList.remove('hidden');
        else btn.classList.add('hidden');
    }
    async function loadForm() {
        if (!isAdmin()) { showToast('Akses ditolak.'); App.switchView('chat'); return; }
        try {
            await Config.load(true);
            const c = Config.snapshot() || {};
            document.getElementById('cfg-github_token').value = c.github_token || '';
            document.getElementById('cfg-github_owner').value = c.github_owner || '';
            document.getElementById('cfg-github_repo').value = c.github_repo || '';
            document.getElementById('cfg-github_branch').value = c.github_branch || 'main';
            const gk = document.getElementById('cfg-groq_api_key');
            const gm = document.getElementById('cfg-groq_model');
            if (gk) gk.value = c.groq_api_key || '';
            if (gm) gm.value = c.groq_model || 'llama-3.3-70b-versatile';
            setMsg('');
            setAIMsg('');
        } catch (e) { setMsg('Gagal memuat: ' + e.message, true); }
        loadUsers();
    }

    /* ---------- KELOLA PENGGUNA ---------- */
    async function loadUsers() {
        const box = document.getElementById('admin-user-table');
        if (!box) return;
        box.innerHTML = `<div class="admin-user-empty">Memuat...</div>`;
        try {
            const { data } = await API.get('/api/admin/users');
            allUsers = data || [];
            renderUsers('');
        } catch (e) { box.innerHTML = `<div class="admin-user-empty">Gagal memuat: ${escapeHtml(e.message || '')}</div>`; }
    }
    function renderUsers(q) {
        const box = document.getElementById('admin-user-table');
        if (!box) return;
        const list = q ? allUsers.filter(u => (u.username || '').toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q)) : allUsers;
        if (!list.length) { box.innerHTML = `<div class="admin-user-empty">Tidak ada pengguna.</div>`; return; }
        box.innerHTML = list.map(u => {
            const isMe = u.username === ADMIN_USERNAME;
            return `<div class="admin-user-row ${isMe ? 'is-admin' : ''}" data-id="${u.id}">
                ${avatarHTML(u)}
                <div class="body">
                    <div class="name">${escapeHtml(u.display_name || u.username)}${isMe ? ' <i class="fa-solid fa-shield" style="color:var(--primary);font-size:11px" title="Admin"></i>' : ''}</div>
                    <div class="sub">@${escapeHtml(u.username)} &bull; ${isReallyOnline(u) ? 'online' : 'terakhir ' + timeAgo(u.last_seen)}</div>
                </div>
                <button class="adm-del" data-del="${u.id}" aria-label="Hapus pengguna" title="Hapus pengguna"><svg class="icon icon-sm"><use href="#i-trash"/></svg></button>
            </div>`;
        }).join('');
        box.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', () => onDeleteUser(btn.dataset.del));
        });
    }
    async function onDeleteUser(userId) {
        const u = allUsers.find(x => String(x.id) === String(userId));
        if (!u) return;
        if (u.username === ADMIN_USERNAME) { showToast('Akun admin tidak bisa dihapus.'); return; }
        if (!confirm(`Hapus pengguna @${u.username}? Semua chat, status, dan keanggotaan grup miliknya juga akan dihapus.`)) return;
        try {
            await API.del('/api/admin/users/' + userId);
            showToast('Pengguna dihapus.');
            await loadUsers();
        } catch (e) { showToast(e.message || 'Gagal menghapus pengguna.'); }
    }
    async function onSave() {
        if (!isAdmin()) return;
        const token = document.getElementById('cfg-github_token').value.trim();
        const owner = document.getElementById('cfg-github_owner').value.trim();
        const repo = document.getElementById('cfg-github_repo').value.trim();
        const branch = document.getElementById('cfg-github_branch').value.trim() || 'main';
        if (!token || !owner || !repo) { setMsg('Token, owner, dan repo wajib diisi.', true); return; }
        const btn = document.getElementById('admin-save');
        btn.disabled = true;
        setMsg('Menyimpan...', false);
        try {
            await Config.setMany({ github_token: token, github_owner: owner, github_repo: repo, github_branch: branch });
            await Config.load(true);
            setMsg('Tersimpan pada ' + new Date().toLocaleString('id-ID'), false);
            showToast('Konfigurasi disimpan.');
        } catch (e) { setMsg('Gagal: ' + e.message, true); }
        finally { btn.disabled = false; }
    }
    async function onTestUpload() {
        if (!isAdmin()) return;
        const btn = document.getElementById('admin-test');
        btn.disabled = true;
        setMsg('Test upload...', false);
        try {
            const blob = new Blob(['hello from pretv chat admin test'], { type: 'text/plain' });
            const file = new File([blob], 'test.txt', { type: 'text/plain' });
            const url = await API._githubUpload(file, 'test', 'admin');
            setMsg('Test berhasil: ' + url, false);
            showToast('Test upload OK!');
        } catch (e) { setMsg('Test gagal: ' + e.message, true); showToast('Test upload gagal'); }
        finally { btn.disabled = false; }
    }
    async function onSaveAI() {
        if (!isAdmin()) return;
        const key = (document.getElementById('cfg-groq_api_key')?.value || '').trim();
        const model = (document.getElementById('cfg-groq_model')?.value || '').trim() || 'llama-3.3-70b-versatile';
        if (!key) { setAIMsg('Groq API Key wajib diisi.', true); return; }
        const btn = document.getElementById('admin-ai-save');
        if (btn) btn.disabled = true;
        setAIMsg('Menyimpan...', false);
        try {
            await Config.setMany({ groq_api_key: key, groq_model: model });
            await Config.load(true);
            setAIMsg('AI config tersimpan ' + new Date().toLocaleString('id-ID'), false);
            showToast('AI config disimpan.');
        } catch (e) { setAIMsg('Gagal: ' + e.message, true); }
        finally { if (btn) btn.disabled = false; }
    }
    function setMsg(text, isError) {
        const el = document.getElementById('admin-msg');
        if (!el) return;
        el.textContent = text || '';
        el.className = isError ? 'error small' : 'muted small';
    }
    function setAIMsg(text, isError) {
        const el = document.getElementById('admin-ai-msg');
        if (!el) return;
        el.textContent = text || '';
        el.className = isError ? 'error small' : 'muted small';
    }
    return { init, loadForm, showNavIfAdmin, isAdmin };
})();
