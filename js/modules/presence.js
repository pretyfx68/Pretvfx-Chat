/* ============================================================
   PRESENCE MODULE — online saat app aktif, offline saat keluar
   ============================================================ */
const PresenceManager = (function () {
    let heartbeatTimer = null;
    let bound = false;
    let lastOnline = null;
    const HEARTBEAT_MS = 45000;

    async function setOnline(online) {
        if (!API.token) return;
        // Hindari spam update yang sama
        if (lastOnline === !!online && online) {
            // tetap refresh last_seen lewat heartbeat
        }
        try {
            await API.post('/api/chat/presence', { online: !!online });
            lastOnline = !!online;
        } catch (e) {
            console.warn('[presence]', e.message || e);
        }
    }

    function startHeartbeat() {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
            if (document.visibilityState === 'visible') setOnline(true);
        }, HEARTBEAT_MS);
    }

    function stopHeartbeat() {
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }

    function goOnline() {
        setOnline(true);
        startHeartbeat();
    }

    function goOffline() {
        stopHeartbeat();
        // beacon-style: fire-and-forget agar sempat terkirim saat page close
        try {
            if (!API.token) return;
            const me = (() => { try { return JSON.parse(localStorage.getItem('pretv_me') || 'null'); } catch (_) { return null; } })();
            // Pakai API normal; browser modern biasanya masih sempat fetch saat pagehide
            setOnline(false);
        } catch (_) {}
    }

    function onVisibility() {
        if (document.visibilityState === 'visible') goOnline();
        else goOffline();
    }

    function onPageHide() { goOffline(); }

    function bind() {
        if (bound) return;
        bound = true;
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('beforeunload', onPageHide);
        // Android WebView / resume
        window.addEventListener('focus', () => { if (document.visibilityState === 'visible') goOnline(); });
        window.addEventListener('blur', () => {
            // Jangan langsung offline di blur (bisa false positive di mobile),
            // andalkan visibilitychange / pagehide.
        });
    }

    function start() {
        bind();
        if (document.visibilityState === 'visible') goOnline();
        else goOffline();
    }

    function stop() {
        stopHeartbeat();
        goOffline();
    }

    return { start, stop, setOnline };
})();
