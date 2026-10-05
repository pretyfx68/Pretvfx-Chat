async function registerPushTokenFromAndroid() {
    console.log('=== [push] MULAI ===');
    console.log('[push] AndroidFCM ada?', typeof AndroidFCM !== 'undefined');

    if (typeof AndroidFCM === 'undefined') {
        console.warn('❌ AndroidFCM TIDAK ADA — JavaScript Interface belum kepasang');
        return;
    }

    let token = '';
    try {
        token = AndroidFCM.getFcmToken();
        console.log('[push] Token dari Android:', token ? token.slice(0, 30) + '...' : '(KOSONG)');
    } catch (e) {
        console.error('❌ Error ambil token:', e);
        return;
    }

    if (!token) {
        console.warn('❌ Token KOSONG — cek event onCompleteRegister Sketchware');
        return;
    }

    const me = JSON.parse(localStorage.getItem('pretv_token') || 'null');
    console.log('[push] User login?', me?.id ? '✅ ' + me.id : '❌ BELUM');

    if (!me?.id) {
        console.warn('❌ Belum login');
        return;
    }

    try {
        const sb = await initSupabase();
        console.log('[push] Kirim ke Supabase...');
        const { error } = await sb.from('device_tokens').upsert({
            user_id: me.id,
            token: token,
            platform: 'android',
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,token' });

        if (error) {
            console.error('❌ Supabase error:', error.message);
            return;
        }
        console.log('✅ TOKEN TERSIMPAN!');
    } catch (e) {
        console.error('❌ Gagal:', e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    AuthModule.init();
    setTimeout(registerPushTokenFromAndroid, 2000);
});
/* 🎨 Kontrol status bar Android dari HTML */
function setDarkStatusBar(on) {
    try {
        if (typeof AndroidUI !== 'undefined' && AndroidUI && AndroidUI.setDarkMode) {
            AndroidUI.setDarkMode(!!on);
        }
    } catch (_) {}
}
