const SUPABASE_URL = 'https://dyxhqsykaamhbgktjwkw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mavPX5DNtbxoRs8kGT3xfw_6Zsu8wns';
const ADMIN_USERNAME = 'pretvfx';

let _sb = null;
function initSupabase() {
    if (_sb) return _sb;
    if (typeof window.supabase === 'undefined') throw new Error('supabase-js belum dimuat');
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    return _sb;
}

/* ============================================================
   CONFIG MODULE
   ============================================================ */
const Config = (function () {
    let cache = null;
    async function load(force) {
        if (cache && !force) return cache;
        const sb = await initSupabase();
        const { data, error } = await sb.from('app_config').select('key, value');
        if (error) throw new Error('Gagal memuat config: ' + error.message);
        const cfg = {};
        (data || []).forEach(r => { cfg[r.key] = r.value; });
        cache = cfg;
        return cfg;
    }
    function get(key, fallback = '') { if (!cache) return fallback; return (cache[key] != null ? cache[key] : fallback); }
    async function set(key, value) {
        const sb = await initSupabase();
        const { error } = await sb.from('app_config').upsert({ key, value: String(value == null ? '' : value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error) throw new Error('Gagal simpan config: ' + error.message);
        if (!cache) cache = {};
        cache[key] = String(value == null ? '' : value);
    }
    async function setMany(obj) { for (const [k, v] of Object.entries(obj)) await set(k, v); }
    function snapshot() { return cache ? { ...cache } : null; }
    return { load, get, set, setMany, snapshot };
})();
