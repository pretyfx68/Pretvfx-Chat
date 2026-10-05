/* ============================================================
   AI MODULE — Pretvfx-AI via Groq (chat privat + tag grup)
   ============================================================ */
const AIModule = (function () {
    const AI_USERNAME = 'pretvfx-ai';
    const AI_DISPLAY = 'Pretvfx AI';
    const AI_AVATAR = './assets/ai-logo.png';
    const AI_AVATAR_SVG = './assets/ai-logo.svg';
    const AI_AVATAR_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0ea5e9"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs><rect width="128" height="128" rx="28" fill="url(#g)"/><text x="64" y="82" text-anchor="middle" font-size="52" font-family="system-ui,sans-serif" font-weight="700" fill="#fff">AI</text></svg>'
    );
    const HISTORY_KEY = 'pretv_ai_history';

    let state = null;
    let history = [];
    let sending = false;

    function init(s) {
        state = s;
        loadHistory();
        const back = document.getElementById('ai-back');
        if (back) back.addEventListener('click', closeAiChat);
        const clearBtn = document.getElementById('ai-clear-history');
        if (clearBtn) clearBtn.addEventListener('click', clearHistory);
        const form = document.getElementById('ai-composer');
        if (form) form.addEventListener('submit', onSend);
        const input = document.getElementById('ai-composer-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSend(e);
                }
            });
            input.addEventListener('input', autoGrow);
        }
        // Set avatar sources
        function bindAiImg(el) {
            if (!el) return;
            el.src = AI_AVATAR;
            el.onerror = function () {
                this.onerror = function () { this.src = AI_AVATAR_FALLBACK; this.onerror = null; };
                this.src = AI_AVATAR_SVG;
            };
        }
        bindAiImg(document.getElementById('ai-header-avatar'));
        bindAiImg(document.querySelector('.ai-welcome-logo'));
    }

    function getAiUser() {
        return {
            id: 'ai-bot-pretvfx',
            username: AI_USERNAME,
            display_name: AI_DISPLAY,
            avatar_url: AI_AVATAR,
            about: 'Asisten AI resmi Pretvfx. Tanyakan apa saja.',
            online: true,
            is_ai: true
        };
    }

    function isAiMention(text) {
        if (!text) return false;
        return /@pretvfx[-_]?ai\b/i.test(text);
    }

    function stripAiMention(text) {
        return String(text || '').replace(/@pretvfx[-_]?ai\b/gi, '').trim();
    }

    function loadHistory() {
        try {
            history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
            if (!Array.isArray(history)) history = [];
        } catch (_) { history = []; }
    }

    function saveHistory() {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-80)));
        } catch (_) {}
    }

    function autoGrow() {
        const input = document.getElementById('ai-composer-input');
        if (!input) return;
        input.style.height = '';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }

    function clearHistory() {
        if (!history.length) {
            if (typeof showToast === 'function') showToast('Riwayat sudah kosong');
            return;
        }
        history = [];
        try { localStorage.removeItem(HISTORY_KEY); } catch (_) {}
        renderMessages();
        if (typeof showToast === 'function') showToast('Riwayat AI dihapus');
    }

    function openAiChat() {
        // Hide other views, show AI
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const el = document.getElementById('view-ai');
        if (el) el.classList.add('active');
        document.body.classList.add('ai-open');
        // Hide bottom nav
        const nav = document.getElementById('bottom-nav');
        if (nav) nav.classList.add('hidden');

        const name = (state && state.me && (state.me.display_name || state.me.username)) || 'kamu';
        const hour = new Date().getHours();
        let greet = 'Halo';
        if (hour < 11) greet = 'Selamat pagi';
        else if (hour < 15) greet = 'Selamat siang';
        else if (hour < 18) greet = 'Selamat sore';
        else greet = 'Selamat malam';
        const sub = document.getElementById('ai-welcome-sub');
        if (sub) sub.textContent = greet + ', ' + name;

        renderMessages();
        const input = document.getElementById('ai-composer-input');
        if (input) setTimeout(() => input.focus(), 200);
        if (typeof setDarkStatusBar === 'function') setDarkStatusBar(false);
    }

    function closeAiChat() {
        document.body.classList.remove('ai-open');
        const el = document.getElementById('view-ai');
        if (el) el.classList.remove('active');
        const nav = document.getElementById('bottom-nav');
        if (nav) nav.classList.remove('hidden');
        if (typeof App !== 'undefined' && App.switchView) {
            App.switchView('chat');
        } else {
            const chat = document.getElementById('view-chat');
            if (chat) chat.classList.add('active');
        }
    }

    function renderMessages() {
        const box = document.getElementById('ai-messages');
        if (!box) return;
        const welcome = document.getElementById('ai-welcome');
        // Clear message bubbles / rows but keep welcome node
        box.querySelectorAll('.ai-msg, .ai-msg-row').forEach(n => n.remove());

        if (!history.length) {
            if (welcome) welcome.style.display = '';
            return;
        }
        if (welcome) welcome.style.display = 'none';

        history.forEach(m => {
            appendBubble(m.role === 'user' ? 'user' : 'bot', m.content || '', false);
        });
        box.scrollTop = box.scrollHeight;
    }

    function appendBubble(role, content, isLoading) {
        const box = document.getElementById('ai-messages');
        if (!box) return null;
        const welcome = document.getElementById('ai-welcome');
        if (welcome) welcome.style.display = 'none';

        if (role === 'user') {
            const div = document.createElement('div');
            div.className = 'ai-msg me' + (isLoading ? ' loading' : '');
            div.textContent = content || '';
            if (isLoading) div.dataset.loading = '1';
            box.appendChild(div);
            box.scrollTop = box.scrollHeight;
            return div;
        }

        // Bot: row dengan logo AI + bubble
        const row = document.createElement('div');
        row.className = 'ai-msg-row bot-row';
        const av = document.createElement('img');
        av.className = 'ai-msg-av';
        av.src = AI_AVATAR;
        av.alt = 'AI';
        av.onerror = function () {
            this.onerror = function () { this.src = AI_AVATAR_FALLBACK; this.onerror = null; };
            this.src = (typeof AI_AVATAR_SVG !== 'undefined' ? AI_AVATAR_SVG : './assets/ai-logo.svg');
        };
        const div = document.createElement('div');
        div.className = 'ai-msg bot' + (isLoading ? ' loading' : '');
        div.textContent = content || '';
        if (isLoading) div.dataset.loading = '1';
        row.appendChild(av);
        row.appendChild(div);
        box.appendChild(row);
        box.scrollTop = box.scrollHeight;
        return div;
    }

    async function getGroqConfig() {
        try {
            await Config.load(false);
            const key = Config.get('groq_api_key', '');
            const model = Config.get('groq_model', 'llama-3.3-70b-versatile') || 'llama-3.3-70b-versatile';
            return { key, model };
        } catch (_) {
            return { key: '', model: 'llama-3.3-70b-versatile' };
        }
    }

    async function callGroq(userText) {
        const { key, model } = await getGroqConfig();
        if (!key) throw new Error('Pretvfx-AI belum terhubung');

        const messages = [
            {
                role: 'system',
                content: 'Kamu adalah Pretvfx AI, asisten ramah di aplikasi chat Pretvfx. Jawab singkat, jelas, dalam bahasa Indonesia kecuali user minta bahasa lain. Jangan sebut bahwa kamu model AI kecuali ditanya. Bersikap membantu dan ramah.'
            }
        ];
        // konteks dari history
        history.slice(-10).forEach(m => {
            if (m && m.content) {
                messages.push({
                    role: m.role === 'user' ? 'user' : 'assistant',
                    content: String(m.content).slice(0, 1200)
                });
            }
        });
        messages.push({ role: 'user', content: String(userText || '').slice(0, 2000) });

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + key
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.7,
                max_tokens: 1024
            })
        });
        if (!res.ok) {
            // Jangan tampilkan detail teknis ke user
            throw new Error('Pretvfx-AI belum terhubung');
        }
        const data = await res.json();
        const reply = data?.choices?.[0]?.message?.content;
        if (!reply) throw new Error('Pretvfx-AI belum terhubung');
        return String(reply).trim();
    }

    async function onSend(e) {
        if (e) e.preventDefault();
        if (sending) return;
        const input = document.getElementById('ai-composer-input');
        const btn = document.getElementById('ai-send-btn');
        if (!input) return;
        const text = String(input.value || '').trim();
        if (!text) return;

        sending = true;
        if (btn) btn.disabled = true;
        input.value = '';
        autoGrow();

        history.push({ role: 'user', content: text, at: Date.now() });
        saveHistory();
        appendBubble('user', text);

        const loadingEl = appendBubble('bot', 'Sedang menulis...', true);

        try {
            const reply = await callGroq(text);
            if (loadingEl) {
                loadingEl.classList.remove('loading');
                loadingEl.removeAttribute('data-loading');
                loadingEl.textContent = reply;
            }
            history.push({ role: 'assistant', content: reply, at: Date.now() });
            saveHistory();
        } catch (err) {
            const msg = err.message || 'Gagal menjawab';
            if (loadingEl) {
                loadingEl.classList.remove('loading');
                loadingEl.textContent = (msg && msg.includes('Pretvfx-AI')) ? msg : ('Pretvfx-AI belum terhubung');
            }
            if (typeof showToast === 'function') showToast(msg);
        } finally {
            sending = false;
            if (btn) btn.disabled = false;
            const box = document.getElementById('ai-messages');
            if (box) box.scrollTop = box.scrollHeight;
            if (input) input.focus();
        }
    }

    /** Dipanggil setelah pesan grup terkirim jika mengandung @Pretvfx-AI */
    async function maybeReplyInGroup(groupId, userMessage) {
        if (!isAiMention(userMessage.content || userMessage)) return;
        const text = stripAiMention(userMessage.content || userMessage);
        try {
            if (typeof showToast === 'function') showToast('Pretvfx AI sedang menulis...');
            const reply = text
                ? await callGroq(text)
                : 'Halo! Ada yang bisa aku bantu? Ketik pertanyaan setelah tag @Pretvfx-AI.';
            await postGroupAiReply(groupId, reply);
        } catch (e) {
            console.warn('[AI]', e);
            if (typeof showToast === 'function') showToast('Pretvfx-AI belum terhubung');
            try {
                await postGroupAiReply(groupId, 'Pretvfx-AI belum terhubung');
            } catch (_) {}
        }
    }

    async function postGroupAiReply(groupId, content) {
        // Prefix ASCII agar tidak rusak di DB / font / slice
        const encoded = '[AI] ' + content;
        try {
            const { message } = await API.post(`/api/groups/${groupId}/messages`, {
                message_type: 'text',
                content: encoded
            });
            return message;
        } catch (e) {
            if (state && state.currentGroup && String(state.currentGroup.id) === String(groupId)) {
                const ai = getAiUser();
                const fake = {
                    id: 'ai-' + Date.now(),
                    group_id: groupId,
                    sender_id: ai.id,
                    message_type: 'text',
                    content: content,
                    created_at: new Date().toISOString(),
                    is_ai: true,
                    user: ai
                };
                state.groupMessages = state.groupMessages || [];
                state.groupMessages.push(fake);
                if (typeof GroupModule !== 'undefined' && GroupModule.renderMessages) {
                    GroupModule.renderMessages();
                }
            }
            throw e;
        }
    }

    function detectAiContent(content) {
        if (!content) return { isAi: false, text: content };
        const s = String(content);
        // Format baru
        if (s.startsWith('[AI] ')) {
            return { isAi: true, text: s.slice(5) };
        }
        // Kompatibel pesan lama (prefix unicode / typo slice)
        if (s.startsWith('⟦AI⟧')) {
            return { isAi: true, text: s.slice(4) };
        }
        if (s.startsWith('[[AI]]')) {
            return { isAi: true, text: s.slice(6) };
        }
        return { isAi: false, text: content };
    }

    function avatarUrl() {
        return AI_AVATAR;
    }

    return {
        init,
        getAiUser,
        isAiMention,
        stripAiMention,
        maybeReplyInGroup,
        callGroq,
        openAiChat,
        closeAiChat,
        clearHistory,
        avatarUrl,
        detectAiContent,
        AI_USERNAME,
        AI_DISPLAY,
        AI_AVATAR,
        AI_AVATAR_FALLBACK
    };
})();
