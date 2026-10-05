/* ============================================================
   APP
   ============================================================ */
const App = (function () {
    const state = {
        me: null, currentView: 'chat', currentConversation: null, currentOtherUser: null,
        chatList: [], messages: [], statuses: [], typingUsers: {}, onlineUsers: {},
        groups: [], currentGroup: null, groupMessages: []
    };
    let booted = false;

    async function boot() {
    if (booted) return;
    booted = true;

    // 🎨 Set status bar putih saat app dibuka
    setDarkStatusBar(false);

    if (!API.token) { AuthModule.showAuth(); return; }
        try {
            const { user } = await API.get('/api/chat/me');
            state.me = user;
            localStorage.setItem('pretv_me', JSON.stringify(user));
        } catch (e) { API.token = null; AuthModule.showAuth(); return; }
        try { await Config.load(); } catch (e) { console.warn('[config]', e.message); }
        WSManager.connect();
        try { PresenceManager.start(); } catch (e) { console.warn('[presence]', e.message); }
        bindNav();
        bindGlobalWS();
        ChatModule.init(state);
        StatusModule.init(state);
        GroupModule.init(state);
        if (typeof AIModule !== "undefined") AIModule.init(state);
        ProfileModule.init(state);
        AdminModule.init(state);
        StatusViewer.init(state);
        AdminModule.showNavIfAdmin();
        switchView('chat');
        // Muat parallel di background — UI sudah diisi dari cache di init
        ChatModule.loadConversations();
        GroupModule.loadGroups();
        StatusModule.loadStatuses();
    }

    function bindNav() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => switchView(btn.dataset.view));
        });
    }

    function switchView(view) {
        if (view === 'admin' && !AdminModule.isAdmin()) { showToast('Akses ditolak.'); view = 'chat'; }
        state.currentView = view;
        // tutup AI chat jika pindah tab
        document.body.classList.remove('ai-open');
        const nav = document.getElementById('bottom-nav');
        if (nav) nav.classList.remove('hidden');

// 🎨 Default status bar putih saat pindah tab
setDarkStatusBar(false);
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
        const el = document.getElementById('view-' + view);
        if (el) el.classList.add('active');
        if (view === 'chat') ChatModule.restoreSearchOrLoad();
        if (view === 'status') StatusModule.loadStatuses();
        if (view === 'group') GroupModule.loadGroups();
        if (view === 'profile') ProfileModule.loadProfile();
        if (view === 'admin') AdminModule.loadForm();
    }

    function bindGlobalWS() {
        WSManager.on('presence', (d) => { state.onlineUsers[d.user_id] = d.online; ChatModule.onPresenceUpdate(d); ProfileModule.onPresenceUpdate(d); });
        WSManager.on('message:new', (d) => ChatModule.onNewMessage(d.message));
        WSManager.on('message:delete', (d) => ChatModule.onMessageDelete(d));
        WSManager.on('message:read', (d) => ChatModule.onMessageRead(d));
        WSManager.on('typing', (d) => ChatModule.onTyping(d));
        WSManager.on('status:new', () => { if (state.currentView === 'status') StatusModule.loadStatuses(); });
        WSManager.on('status:delete', () => { if (state.currentView === 'status') StatusModule.loadStatuses(); });
        WSManager.on('group:message:new', (d) => GroupModule.onNewMessage(d.message));
        WSManager.on('group:message:delete', (d) => GroupModule.onMessageDelete(d));
        WSManager.on('group:updated', () => GroupModule.loadGroups());
        WSManager.on('group:deleted', (d) => GroupModule.onGroupDeleted(d.group_id));
    }

    return { state, boot, switchView };
})();
