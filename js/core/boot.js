(function () {
    function revealAuth() {
        var sp = document.getElementById('boot-splash');
        var au = document.getElementById('auth-screen');
        if (sp) sp.classList.add('hidden');
        if (au) au.classList.remove('hidden');
    }
    function revealApp() {
        var sp = document.getElementById('boot-splash');
        var au = document.getElementById('auth-screen');
        var ap = document.getElementById('app-screen');
        if (sp) sp.classList.add('hidden');
        if (au) au.classList.add('hidden');
        if (ap) ap.classList.remove('hidden');
        document.body.classList.remove('auth-body');
        document.body.classList.add('app-body');
    }
    try {
        if (localStorage.getItem('pretv_token')) revealApp();
        else revealAuth();
    } catch (e) { revealAuth(); }
})();
