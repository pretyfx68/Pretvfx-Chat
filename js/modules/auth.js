/* ============================================================
   AUTH MODULE
   ============================================================ */
const AuthModule = (function () {
    function init() {
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        if (!loginForm) return;
        if (API.token) { API.get('/api/chat/me').then(() => showApp()).catch(() => { API.token = null; showAuth(); }); }
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
                const isLogin = tab.dataset.tab === 'login';
                loginForm.classList.toggle('hidden', !isLogin);
                registerForm.classList.toggle('hidden', isLogin);
            });
        });
        const cleanUsername = u => String(u || '').trim().replace(/^@/, '').toLowerCase();
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = loginForm.querySelector('button');
            const err = document.getElementById('login-error');
            err.textContent = '';
            btn.disabled = true;
            const prev = btn.textContent;
            btn.textContent = 'Memproses...';
            try {
                const fd = new FormData(loginForm);
                const data = await API.post('/api/chat/login', { username: cleanUsername(fd.get('username')), password: fd.get('password') });
                API.token = data.token;
                showApp();
            } catch (e) { err.textContent = e.message || 'Login gagal.'; }
            finally { btn.disabled = false; btn.textContent = prev; }
        });
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = registerForm.querySelector('button');
            const err = document.getElementById('register-error');
            err.textContent = '';
            btn.disabled = true;
            const prev = btn.textContent;
            btn.textContent = 'Mendaftar...';
            try {
                const fd = new FormData(registerForm);
                const data = await API.post('/api/chat/register', {
                    username: cleanUsername(fd.get('username')),
                    password: String(fd.get('password') || ''),
                    display_name: String(fd.get('display_name') || '').trim().slice(0, 60)
                });
                API.token = data.token;
                showApp();
            } catch (e) { err.textContent = e.message || 'Daftar gagal.'; }
            finally { btn.disabled = false; btn.textContent = prev; }
        });
    }
    function showApp() {
    document.getElementById('boot-splash')?.classList.add('hidden');
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    document.body.classList.remove('auth-body');
    document.body.classList.add('app-body');
    App.boot();
    // ⬇ TAMBAH BARIS INI:
    setTimeout(registerPushTokenFromAndroid, 1500);
}
    function showAuth() {
    // 🎨 Status bar putih di halaman login
    setDarkStatusBar(false);

    document.getElementById('boot-splash')?.classList.add('hidden');
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
        document.body.classList.add('auth-body');
        document.body.classList.remove('app-body');
    }
    return { init, showApp, showAuth };
})();
