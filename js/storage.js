/**
 * storage.js - 数据存储层
 * 使用 localStorage 持久化收支记录
 */
const Storage = (function () {
    const KEY = 'tianpao_accounting_data';

    const CATEGORIES = {
        expense: ['餐饮', '奶茶', '交通', '购物', '住房', '娱乐', '医疗', '教育', '通讯', '社交', '其他'],
        income: ['工资', '奖金', '投资', '兼职', '礼金', '其他']
    };

    const COLORS = {
        '餐饮': '#ff7875', '奶茶': '#a0522d', '交通': '#ffa940', '购物': '#ffc53d', '住房': '#73d13d',
        '娱乐': '#36cfc9', '医疗': '#5cdbd3', '教育': '#40a9ff', '通讯': '#597ef7',
        '社交': '#9254de', '其他': '#f759ab',
        '工资': '#52c41a', '奖金': '#73d13d', '投资': '#95de64', '兼职': '#b7eb8f',
        '礼金': '#d9f7be', '其他': '#bae637'
    };

    function getCategoryColor(cat) {
        return COLORS[cat] || '#999';
    }

    // ── 云端同步层 (Gitee 仓库 API) ──
    const PENDING_KEY = 'tianpao_cloud_pending';
    const DEFAULT_PATH = 'data.json';

    function utf8_to_b64(str) {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch {
            return btoa(str);
        }
    }
    function b64_to_utf8(b64) {
        try {
            return decodeURIComponent(escape(window.atob(b64)));
        } catch {
            return window.atob(b64);
        }
    }

    // 默认云端仓库（公开安全，不含令牌）
    const DEFAULT_CLOUD = { owner: 'sh1n3y', repo: 'cangku', path: 'data.json' };

    const CloudSync = {
        getConfig() {
            try {
                const stored = JSON.parse(localStorage.getItem('tianpao_cloud_config') || '{}');
                return { ...DEFAULT_CLOUD, ...stored };
            } catch { return { ...DEFAULT_CLOUD }; }
        },
        setConfig(owner, repo, token, path) {
            localStorage.setItem('tianpao_cloud_config', JSON.stringify({ owner, repo, token, path: path || DEFAULT_PATH }));
        },
        isConfigured() {
            const c = this.getConfig();
            return !!(c.owner && c.repo && c.token);
        },
        _markPending() {
            localStorage.setItem(PENDING_KEY, '1');
        },
        _clearPending() {
            localStorage.removeItem(PENDING_KEY);
        },
        hasPending() {
            return localStorage.getItem(PENDING_KEY) === '1';
        },
        _apiUrl(path) {
            const { owner, repo, path: filePath } = this.getConfig();
            const encodedPath = encodeURIComponent(filePath || DEFAULT_PATH);
            return `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${encodedPath}${path ? '?' + path : ''}`;
        },
        async _getFile() {
            const { token } = this.getConfig();
            const resp = await fetch(this._apiUrl(`access_token=${encodeURIComponent(token)}`), {
                cache: 'no-store'
            });
            if (!resp.ok) {
                if (resp.status === 404) return { exists: false, sha: null, content: null };
                const err = await resp.text();
                throw new Error(`${resp.status} ${err}`);
            }
            const data = await resp.json();
            console.log('[CloudSync] _getFile response:', data);
            // Gitee 有时返回数组（目录）或对象（文件）
            if (Array.isArray(data)) {
                return { exists: false, sha: null, content: null };
            }
            if (!data.sha) {
                // sha 缺失，当作不存在处理，让上层尝试创建
                return { exists: false, sha: null, content: null };
            }
            return {
                exists: true,
                sha: data.sha,
                content: data.content ? b64_to_utf8(data.content.replace(/\s/g, '')) : '[]'
            };
        },
        async _updateFile(content, sha) {
            const { token } = this.getConfig();
            const body = JSON.stringify({
                access_token: token,
                message: 'update accounting data',
                content: utf8_to_b64(content),
                sha: sha
            });
            // Gitee 要求 access_token 放在 URL query
            const resp = await fetch(this._apiUrl(`access_token=${encodeURIComponent(token)}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body
            });
            if (!resp.ok) {
                const err = await resp.text();
                throw new Error(`${resp.status} ${err}`);
            }
            const data = await resp.json();
            return data && data.content && data.content.sha;
        },
        async _createFile(content) {
            const { token } = this.getConfig();
            const body = JSON.stringify({
                access_token: token,
                message: 'create accounting data',
                content: utf8_to_b64(content)
            });
            const resp = await fetch(this._apiUrl(`access_token=${encodeURIComponent(token)}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body
            });
            if (!resp.ok) {
                const err = await resp.text();
                throw new Error(`${resp.status} ${err}`);
            }
            return true;
        },
        async initFile() {
            if (!this.isConfigured()) return { ok: false, reason: 'not_configured' };
            try {
                const file = await this._getFile();
                if (file.exists) {
                    return { ok: true, sha: file.sha, exists: true };
                }
                await this._createFile('[]');
                const newFile = await this._getFile();
                return { ok: true, sha: newFile.sha, exists: false };
            } catch (e) {
                return { ok: false, reason: e.message };
            }
        },
        async pull() {
            if (!this.isConfigured()) return null;
            try {
                const file = await this._getFile();
                if (!file.exists) return [];
                const data = JSON.parse(file.content || '[]');
                return Array.isArray(data) ? data : [];
            } catch (e) {
                console.warn('拉取云端数据失败:', e.message);
                return null;
            }
        },
        async push(entries) {
            if (!this.isConfigured()) return { ok: false, reason: 'not_configured' };
            try {
                const file = await this._getFile();
                const content = JSON.stringify(entries);
                if (file.exists) {
                    await this._updateFile(content, file.sha);
                } else {
                    await this._createFile(content);
                }
                this._clearPending();
                return { ok: true };
            } catch (e) {
                this._markPending();
                throw e;
            }
        },
        async syncFromCloud() {
            if (!this.isConfigured()) return { ok: false, reason: 'not_configured' };
            const cloudData = await this.pull();
            if (!Array.isArray(cloudData)) return { ok: false, reason: 'empty' };
            const local = load();
            const merged = mergeById(local, cloudData);
            localStorage.setItem(KEY, JSON.stringify(merged));
            await this.push(merged);
            return { ok: true, count: merged.length, pulled: cloudData.length };
        },
        async testConnection() {
            if (!this.isConfigured()) return { ok: false, reason: 'not_configured' };
            try {
                const file = await this._getFile();
                const data = file.exists ? JSON.parse(file.content || '[]') : [];
                return { ok: true, count: Array.isArray(data) ? data.length : 0 };
            } catch (e) {
                return { ok: false, reason: e.message };
            }
        }
    };

    function mergeById(local, cloud) {
        const map = new Map();
        const all = [...cloud, ...local]; // 本地优先（后写入覆盖）
        for (const e of all) {
            if (e && e.id) map.set(e.id, e);
        }
        return Array.from(map.values());
    }

    function load() {
        try {
            return JSON.parse(localStorage.getItem(KEY)) || [];
        } catch (e) {
            console.error('加载数据失败:', e);
            return [];
        }
    }

    function save(entries) {
        try {
            localStorage.setItem(KEY, JSON.stringify(entries));
            // 异步推送到云端，不阻塞 UI
            CloudSync.push(entries).catch(err => {
                console.warn('云端同步失败（离线模式）:', err.message);
                CloudSync._markPending();
            });
        } catch (e) {
            console.error('保存数据失败:', e);
        }
    }

    function add(entry) {
        const entries = load();
        entry.id = Date.now() + Math.random().toString(36).slice(2, 6);
        entries.push(entry);
        save(entries);
        return entry;
    }

    function update(id, updates) {
        const entries = load();
        const idx = entries.findIndex(e => e.id === id);
        if (idx >= 0) {
            entries[idx] = { ...entries[idx], ...updates };
            save(entries);
            return entries[idx];
        }
        return null;
    }

    function remove(id) {
        const entries = load().filter(e => e.id !== id);
        save(entries);
    }

    function clear() {
        localStorage.removeItem(KEY);
    }

    function getEntriesByMonth(year, month) {
        // month is 0-indexed
        const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
        return load().filter(e => e.date.startsWith(prefix));
    }

    function getAll() {
        return load();
    }

    function getMonthlySummary(year, month) {
        const entries = getEntriesByMonth(year, month);
        let income = 0, expense = 0;
        const byCategory = {};
        const byDay = {};

        entries.forEach(e => {
            const amt = parseFloat(e.amount) || 0;
            if (e.type === 'income') {
                income += amt;
            } else {
                expense += amt;
                byCategory[e.category] = (byCategory[e.category] || 0) + amt;
                const day = e.date.slice(8, 10);
                byDay[day] = (byDay[day] || 0) + amt;
            }
        });

        return { income, expense, balance: income - expense, byCategory, byDay, count: entries.length };
    }

    function generateSampleData() {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const samples = [];
        const cats = CATEGORIES.expense;
        const incomeCats = CATEGORIES.income;

        // 当前月前5个月的示例数据
        for (let offset = 5; offset >= 0; offset--) {
            const dt = new Date(y, m - offset, 1);
            const yy = dt.getFullYear();
            const mm = dt.getMonth();
            const daysInMonth = new Date(yy, mm + 1, 0).getDate();

            // 每月初一笔工资
            samples.push({
                id: `s_${offset}_income`,
                date: `${yy}-${String(mm + 1).padStart(2, '0')}-01`,
                type: 'income',
                category: '工资',
                amount: Math.round(8000 + Math.random() * 2000),
                note: '月度工资'
            });

            // 随机20-30笔支出
            const count = 20 + Math.floor(Math.random() * 10);
            for (let i = 0; i < count; i++) {
                const day = 1 + Math.floor(Math.random() * daysInMonth);
                const cat = cats[Math.floor(Math.random() * cats.length)];
                let amount;
                // 餐饮/交通小额，购物/住房/医疗可能大额
                if (cat === '餐饮') amount = Math.round((15 + Math.random() * 80) * 100) / 100;
                else if (cat === '交通') amount = Math.round((5 + Math.random() * 50) * 100) / 100;
                else if (cat === '购物') amount = Math.round((50 + Math.random() * 400) * 100) / 100;
                else if (cat === '住房') amount = Math.round(1500 + Math.random() * 500);
                else if (cat === '娱乐') amount = Math.round((30 + Math.random() * 200) * 100) / 100;
                else if (cat === '医疗') amount = Math.round((50 + Math.random() * 300) * 100) / 100;
                else if (cat === '教育') amount = Math.round((100 + Math.random() * 500) * 100) / 100;
                else if (cat === '通讯') amount = Math.round((30 + Math.random() * 50) * 100) / 100;
                else if (cat === '社交') amount = Math.round((50 + Math.random() * 300) * 100) / 100;
                else amount = Math.round((20 + Math.random() * 200) * 100) / 100;

                samples.push({
                    id: `s_${offset}_${i}`,
                    date: `${yy}-${String(mm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                    type: 'expense',
                    category: cat,
                    amount: amount,
                    note: ''
                });
            }

            // 偶尔一笔额外收入
            if (Math.random() > 0.5) {
                samples.push({
                    id: `s_${offset}_extra`,
                    date: `${yy}-${String(mm + 1).padStart(2, '0')}-${String(10 + Math.floor(Math.random() * 10)).padStart(2, '0')}`,
                    type: 'income',
                    category: incomeCats[Math.floor(Math.random() * 3)],
                    amount: Math.round((500 + Math.random() * 3000) * 100) / 100,
                    note: ''
                });
            }
        }

        save(samples);
        return samples;
    }

    return {
        CATEGORIES,
        getCategoryColor,
        add,
        update,
        remove,
        clear,
        getAll,
        getEntriesByMonth,
        getMonthlySummary,
        generateSampleData,
        save,
        load,
        CloudSync,
        syncFromCloud: () => CloudSync.syncFromCloud()
    };
})();
