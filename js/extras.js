/**
 * extras.js - 扩展功能
 * 1) 固定支出模板：每月一键生成房贷/车贷/话费等固定账
 * 2) 储值卡余额：充值登记、消费扣余额（不重复计支出）
 */
const Extras = (function () {
    const EXPENSE_CATS = ['餐饮', '奶茶', '交通', '养车', '购车', '贷款', '住房', '家居日用', '购物', '美容个护',
        '娱乐', '游戏', '人情礼金', '旅行出游', '运动', '医疗', '教育', '通讯', '社交', '其他'];

    function uid(prefix) {
        return (prefix || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function fmt(n) {
        return '¥' + (parseFloat(n) || 0).toFixed(2);
    }

    // ============ 固定支出 ============
    function getFixed() {
        return Storage.loadMeta().fixed || [];
    }

    function addFixed(item) {
        const meta = Storage.loadMeta();
        meta.fixed.push(Object.assign({ id: uid('fx'), user: '小羊', day: 1 }, item));
        Storage.saveMeta({ fixed: meta.fixed });
        renderFixedList();
    }

    function removeFixed(id) {
        const meta = Storage.loadMeta();
        meta.fixed = meta.fixed.filter(t => t.id !== id);
        Storage.saveMeta({ fixed: meta.fixed });
        renderFixedList();
    }

    function pendingForMonth(y, m) {
        const entries = Storage.getEntriesByMonth(y, m);
        return getFixed().filter(t => !entries.some(e => e.fixedId === t.id));
    }

    function generatePending(y, m) {
        const pending = pendingForMonth(y, m);
        if (pending.length === 0) return 0;
        const lastDay = new Date(y, m + 1, 0).getDate();
        const all = Storage.getAll();
        pending.forEach(t => {
            const day = Math.min(Math.max(parseInt(t.day, 10) || 1, 1), lastDay);
            all.push({
                id: uid('e'),
                date: `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                type: 'expense',
                category: t.category || '其他',
                user: t.user || '小羊',
                amount: parseFloat(t.amount) || 0,
                note: t.name || '',
                fixedId: t.id
            });
        });
        Storage.save(all);
        return pending.length;
    }

    function renderTodoBar(y, m) {
        const bar = document.getElementById('todoBar');
        if (!bar) return;
        const pending = pendingForMonth(y, m);
        if (pending.length === 0) {
            bar.style.display = 'none';
            bar.innerHTML = '';
            return;
        }
        const total = pending.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
        bar.style.display = '';
        bar.innerHTML = '<span class="todo-text">本月有 <strong>' + pending.length + '</strong> 笔固定支出未记账（合计 ' +
            fmt(total) + '）：' + pending.map(t => t.name).join('、') + '</span>' +
            '<button id="genFixedBtn" class="btn btn-primary btn-sm">一键生成</button>';
        document.getElementById('genFixedBtn').addEventListener('click', () => {
            const n = generatePending(y, m);
            if (n > 0) {
                App.refresh();
                alert('已生成 ' + n + ' 笔固定支出');
            }
        });
    }

    function renderFixedList() {
        const ul = document.getElementById('fixedList');
        if (!ul) return;
        const list = getFixed();
        if (list.length === 0) {
            ul.innerHTML = '<li class="ex-empty">还没有固定支出模板</li>';
            return;
        }
        ul.innerHTML = list.map(t =>
            '<li class="ex-item">' +
            '<span class="ex-name">' + (t.name || '') + '</span>' +
            '<span class="ex-meta">' + fmt(t.amount) + ' · ' + (t.category || '其他') + ' · ' + (t.user || '小羊') + ' · 每月' + (t.day || 1) + '号</span>' +
            '<button class="ex-del" data-id="' + t.id + '">删除</button>' +
            '</li>'
        ).join('');
        ul.querySelectorAll('.ex-del').forEach(btn => {
            btn.addEventListener('click', () => removeFixed(btn.dataset.id));
        });
    }

    // ============ 储值卡 ============
    function getCards() {
        return Storage.loadMeta().cards || [];
    }

    function saveCards(cards) {
        Storage.saveMeta({ cards: cards });
        renderCardList();
        renderCardOptions();
    }

    function addCard(name, balance) {
        const cards = getCards();
        cards.push({ id: uid('cd'), name: name, balance: parseFloat(balance) || 0 });
        saveCards(cards);
    }

    function removeCard(id) {
        saveCards(getCards().filter(c => c.id !== id));
    }

    function useCard(id, amount, note) {
        const cards = getCards();
        const card = cards.find(c => c.id === id);
        if (!card) return;
        const amt = parseFloat(amount) || 0;
        if (amt <= 0) return;
        card.balance = Math.round(((parseFloat(card.balance) || 0) - amt) * 100) / 100;
        card.lastUse = { amount: amt, note: note || '', date: new Date().toISOString().slice(0, 10) };
        saveCards(cards);
    }

    // 从历史「充值」记录自动识别卡片（余额按充值总额估算，用户可改）
    function scanFromHistory() {
        const entries = Storage.getAll();
        const map = {};
        entries.forEach(e => {
            if (e.type !== 'expense') return;
            const n = (e.note || '').trim();
            if (!/充值|储值/.test(n)) return;
            const amt = parseFloat(e.amount) || 0;
            if (amt < 100) return;
            const name = n.replace(/(充值|储值)/g, '').replace(/[-—]+$/, '').trim() || n;
            if (!map[name]) map[name] = { name: name, balance: 0, count: 0 };
            map[name].balance += amt;
            map[name].count += 1;
        });
        const found = Object.values(map);
        if (found.length === 0) {
            alert('没有识别到金额 ≥100 的充值记录');
            return;
        }
        const existing = getCards().map(c => c.name);
        const cards = getCards();
        let added = 0;
        found.forEach(f => {
            if (existing.indexOf(f.name) >= 0) return;
            cards.push({
                id: uid('cd'),
                name: f.name,
                balance: Math.round(f.balance * 100) / 100,
                from: f.count + ' 笔充值'
            });
            added += 1;
        });
        if (added === 0) {
            alert('这些卡片已存在，未重复添加');
            return;
        }
        saveCards(cards);
        alert('识别到 ' + added + ' 张卡，请核对余额是否为「当前实际剩余」');
    }

    function renderCardList() {
        const ul = document.getElementById('cardList');
        if (!ul) return;
        const cards = getCards();
        if (cards.length === 0) {
            ul.innerHTML = '<li class="ex-empty">还没有储值卡</li>';
            return;
        }
        ul.innerHTML = cards.map(c =>
            '<li class="ex-item">' +
            '<span class="ex-name">' + (c.name || '') + '</span>' +
            '<span class="ex-meta">余额 <strong class="' + ((parseFloat(c.balance) || 0) > 0 ? 'ex-ok' : 'ex-zero') + '">' + fmt(c.balance) + '</strong>' +
            (c.from ? ' · ' + c.from : '') + '</span>' +
            '<button class="ex-del" data-id="' + c.id + '">删除</button>' +
            '</li>'
        ).join('');
        ul.querySelectorAll('.ex-del').forEach(btn => {
            btn.addEventListener('click', () => removeCard(btn.dataset.id));
        });
    }

    function renderCardOptions() {
        const sel = document.getElementById('cdUseCard');
        if (!sel) return;
        const cards = getCards();
        const cur = sel.value;
        sel.innerHTML = cards.length ? cards.map(c => '<option value="' + c.id + '">' + c.name + '（余 ' + fmt(c.balance) + '）</option>').join('')
            : '<option value="">暂无卡片</option>';
        if (cur) sel.value = cur;
    }

    // ============ 分类 Top10 明细弹窗 ============
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function closeCatTop() {
        const modal = document.getElementById('catTopModal');
        if (modal) modal.style.display = 'none';
    }

    /**
     * 展示某分类金额最高的 10 笔
     * @param {string|string[]} cats 分类名，或多个分类合并（如年报的「其他」）
     * @param {Array} entries 统计范围（已由调用方限定年份/月份）
     * @param {string} scope 范围文案，如「2026年」「2026年10月」
     */
    function showCategoryTop(cats, entries, scope) {
        const modal = document.getElementById('catTopModal');
        if (!modal) return;
        const catArr = Array.isArray(cats) ? cats : [cats];
        const label = catArr.length === 1 ? catArr[0] : catArr.join('、');

        const all = (entries || [])
            .filter(e => e && e.type === 'expense' && catArr.indexOf(e.category) >= 0)
            .map(e => Object.assign({}, e, { amt: parseFloat(e.amount) || 0 }))
            .sort((a, b) => b.amt - a.amt);

        const total = all.reduce((s, e) => s + e.amt, 0);
        const top = all.slice(0, 10);

        document.getElementById('catTopTitle').textContent = (scope ? scope + ' · ' : '') + (catArr.length === 1 ? catArr[0] : '其他分类');

        const meta = document.getElementById('catTopMeta');
        const topSum = top.reduce((s, e) => s + e.amt, 0);
        meta.innerHTML =
            '<span>共 <strong>' + all.length + '</strong> 笔</span>' +
            '<span>合计 <strong>' + fmt(total) + '</strong></span>' +
            '<span>Top10 占 <strong>' + (total > 0 ? (topSum / total * 100).toFixed(1) : '0.0') + '%</strong></span>';

        const list = document.getElementById('catTopList');
        if (!top.length) {
            list.innerHTML = '<li class="ct-empty">该范围内没有支出记录</li>';
        } else {
            list.innerHTML = top.map((e, i) =>
                '<li class="ct-item">' +
                '<span class="ct-rank' + (i < 3 ? ' ct-rank-top' : '') + '">' + (i + 1) + '</span>' +
                '<span class="ct-main">' +
                '<span class="ct-note">' + esc(e.note || '无备注') + '</span>' +
                '<span class="ct-sub">' + esc(e.date) + ' · ' + esc(e.user || '-') + '</span>' +
                '</span>' +
                '<span class="ct-amt">' + fmt(e.amt) + '</span>' +
                '</li>'
            ).join('');
        }
        modal.style.display = '';
    }

    function bindCatTopModal() {
        const modal = document.getElementById('catTopModal');
        if (!modal) return;
        const closeBtn = document.getElementById('closeCatTop');
        if (closeBtn) closeBtn.addEventListener('click', closeCatTop);
        modal.addEventListener('click', e => { if (e.target === modal) closeCatTop(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCatTop(); });
    }

    // ============ 初始化 ============
    function init() {
        bindCatTopModal();
        const catSel = document.getElementById('fxCat');
        if (catSel) {
            catSel.innerHTML = EXPENSE_CATS.map(c => '<option value="' + c + '">' + c + '</option>').join('');
        }

        const fixedBtn = document.getElementById('fixedBtn');
        const fixedModal = document.getElementById('fixedModal');
        if (fixedBtn && fixedModal) {
            fixedBtn.addEventListener('click', () => { renderFixedList(); fixedModal.style.display = ''; });
            document.getElementById('closeFixed').addEventListener('click', () => { fixedModal.style.display = 'none'; });
            fixedModal.addEventListener('click', e => { if (e.target === fixedModal) fixedModal.style.display = 'none'; });
            document.getElementById('fxAddBtn').addEventListener('click', () => {
                const name = document.getElementById('fxName').value.trim();
                const amount = parseFloat(document.getElementById('fxAmount').value);
                const day = parseInt(document.getElementById('fxDay').value, 10) || 1;
                if (!name || isNaN(amount) || amount <= 0) { alert('请填写名称和金额'); return; }
                addFixed({
                    name: name,
                    category: document.getElementById('fxCat').value,
                    amount: amount,
                    user: document.getElementById('fxUser').value,
                    day: Math.min(Math.max(day, 1), 28)
                });
                document.getElementById('fxName').value = '';
                document.getElementById('fxAmount').value = '';
                App.refresh();
            });
        }

        const cardsBtn = document.getElementById('cardsBtn');
        const cardsModal = document.getElementById('cardsModal');
        if (cardsBtn && cardsModal) {
            cardsBtn.addEventListener('click', () => { renderCardList(); renderCardOptions(); cardsModal.style.display = ''; });
            document.getElementById('closeCards').addEventListener('click', () => { cardsModal.style.display = 'none'; });
            cardsModal.addEventListener('click', e => { if (e.target === cardsModal) cardsModal.style.display = 'none'; });
            document.getElementById('cdAddBtn').addEventListener('click', () => {
                const name = document.getElementById('cdName').value.trim();
                const balance = parseFloat(document.getElementById('cdBalance').value);
                if (!name || isNaN(balance)) { alert('请填写卡名和余额'); return; }
                addCard(name, balance);
                document.getElementById('cdName').value = '';
                document.getElementById('cdBalance').value = '';
            });
            document.getElementById('cdUseBtn').addEventListener('click', () => {
                const id = document.getElementById('cdUseCard').value;
                const amt = parseFloat(document.getElementById('cdUseAmount').value);
                const note = document.getElementById('cdUseNote').value.trim();
                if (!id || isNaN(amt) || amt <= 0) { alert('请选择卡片并填写消费金额'); return; }
                useCard(id, amt, note);
                document.getElementById('cdUseAmount').value = '';
                document.getElementById('cdUseNote').value = '';
            });
            document.getElementById('cdScanBtn').addEventListener('click', scanFromHistory);
        }
    }

    return {
        init,
        renderTodoBar,
        getFixed,
        getCards,
        pendingForMonth,
        showCategoryTop
    };
})();
window.Extras = Extras;
