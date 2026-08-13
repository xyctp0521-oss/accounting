/**
 * settings.js - 云端同步设置面板（Gitee 仓库 API）
 */
(function () {
    function init() {
        const modal = document.getElementById('settingsModal');
        const settingsBtn = document.getElementById('settingsBtn');
        const closeBtn = document.getElementById('closeSettings');
        const saveBtn = document.getElementById('saveConfigBtn');
        const testBtn = document.getElementById('testConnBtn');
        const ownerInput = document.getElementById('ownerInput');
        const repoInput = document.getElementById('repoInput');
        const pathInput = document.getElementById('pathInput');
        const tokenInput = document.getElementById('tokenInput');
        const testResult = document.getElementById('testResult');

        if (!settingsBtn) return;

        // 加载已有配置
        const cfg = Storage.CloudSync.getConfig();
        if (cfg.owner) ownerInput.value = cfg.owner;
        if (cfg.repo) repoInput.value = cfg.repo;
        if (cfg.path) pathInput.value = cfg.path;
        if (cfg.token) tokenInput.value = cfg.token;

        settingsBtn.addEventListener('click', () => {
            modal.style.display = 'flex';
        });

        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });

        function setTempConfig() {
            Storage.CloudSync.setConfig(
                ownerInput.value.trim(),
                repoInput.value.trim(),
                tokenInput.value.trim(),
                pathInput.value.trim()
            );
        }

        function validate() {
            const owner = ownerInput.value.trim();
            const repo = repoInput.value.trim();
            const token = tokenInput.value.trim();
            if (!owner || !repo || !token) {
                testResult.innerHTML = '<span class="test-fail">请填写仓库所有者、仓库名和私人令牌</span>';
                return false;
            }
            return true;
        }

        testBtn.addEventListener('click', async () => {
            if (!validate()) return;
            testResult.innerHTML = '<span class="test-loading">测试中...</span>';
            setTempConfig();
            const result = await Storage.CloudSync.testConnection();
            if (result.ok) {
                testResult.innerHTML = `<span class="test-ok">✓ 连接成功，云端有 ${result.count} 条数据</span>`;
            } else {
                testResult.innerHTML = `<span class="test-fail">✗ 连接失败：${result.reason}</span>`;
            }
        });

        saveBtn.addEventListener('click', async () => {
            if (!validate()) return;
            setTempConfig();
            testResult.innerHTML = '<span class="test-loading">保存并同步中...</span>';
            try {
                // 确保文件存在
                const init = await Storage.CloudSync.initFile();
                if (!init.ok) {
                    testResult.innerHTML = `<span class="test-fail">初始化失败：${init.reason}</span>`;
                    return;
                }
                // 推送到云端并拉取合并
                const result = await Storage.syncFromCloud();
                if (result.ok) {
                    testResult.innerHTML = `<span class="test-ok">✓ 已同步！云端 ${result.count} 条数据</span>`;
                    App.updateSyncStatus('synced', result.count);
                    App.refresh();
                    setTimeout(() => { modal.style.display = 'none'; }, 1500);
                }
            } catch (e) {
                testResult.innerHTML = `<span class="test-fail">同步失败：${e.message}</span>`;
                App.updateSyncStatus('offline');
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
