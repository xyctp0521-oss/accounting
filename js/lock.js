/**
 * lock.js — PIN 门禁（界面级，非加密保护）
 * ⚠️ 静态站点无法做真正的密码保护：PIN 硬编码于源码，任何人查看网页源码即可看到；
 *    本地数据存于浏览器 localStorage，仍可通过开发者工具读取。
 *    本门禁仅用于防止他人随手打开查看账目。
 */
(function () {
    var PIN = '521412';
    var SESSION_KEY = 'tianpao_unlocked';

    function unlock() {
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
        document.body.classList.remove('is-locked');
        var overlay = document.getElementById('pinLock');
        if (overlay) overlay.style.display = 'none';
    }

    function lock() {
        document.body.classList.add('is-locked');
    }

    function init() {
        try {
            var overlay = document.getElementById('pinLock');
            var input = document.getElementById('pinInput');
            var btn = document.getElementById('pinSubmit');
            var err = document.getElementById('pinError');

            // 容错：若门禁元素缺失，直接放行，避免部署异常把用户锁死
            if (!overlay || !input || !btn) { unlock(); return; }

            try {
                if (sessionStorage.getItem(SESSION_KEY) === '1') { unlock(); return; }
            } catch (e) {}

            lock();

            function attempt() {
                var val = (input.value || '').trim();
                if (val === PIN) {
                    unlock();
                } else {
                    if (err) err.textContent = '密码错误，请重试';
                    input.value = '';
                    input.focus();
                }
            }

            btn.addEventListener('click', attempt);
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') attempt();
            });
            setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
        } catch (e) {
            // 任何异常都放行，保证可用性优先于门禁
            console.error('[lock.js] 异常，已自动解锁:', e);
            unlock();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
