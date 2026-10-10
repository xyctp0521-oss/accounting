/**
 * annual.js - 年度报表视图
 * 依赖：Storage（数据）、Charts（canvas 图表）、App.jumpTo（月份联动）
 * 结构：报表按钮打开全屏年报视图；年份切换重算；点击 12 月柱跳回主界面对应月
 */
const Annual = (function () {
    const USER_COLORS = { '小羊': '#1890ff', '南瓜': '#999999', '共同': '#eb2f96' };
    let year = new Date().getFullYear();
    let activeCat = null;
    let otherCats = [];   // 被合并进「其他」的分类名
    const $ = id => document.getElementById(id);

    function fmt(n) {
        const v = Number(n);
        if (!isFinite(v)) return '¥0.00';
        return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtInt(n) {
        const v = Number(n);
        if (!isFinite(v)) return '0';
        return Math.round(v).toLocaleString('zh-CN');
    }
    function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
    function dayOfYear(d) {
        const start = new Date(d.getFullYear(), 0, 0);
        return Math.floor((d - start) / 86400000);
    }
    function yearEntries(y) {
        const p = String(y) + '-';
        return Storage.getAll().filter(e => e && e.date && String(e.date).indexOf(p) === 0);
    }

    // ===== 打开 / 关闭 / 年份 =====
    function open() {
        if (!Storage) return;
        $('annualView').classList.add('show');
        renderAnnual();
    }
    function close() {
        $('annualView').classList.remove('show');
    }
    function setYear(y) {
        year = y;
        activeCat = null;
        renderAnnual();
    }

    // ===== 渲染 =====
    function renderAnnual() {
        $('annualYear').textContent = year + '年';
        const entries = yearEntries(year);
        renderTotals(entries);
        renderMonthBars(entries);
        renderCategories(entries);
        renderMember(entries);
        renderInsights(entries);
    }

    function renderTotals(entries) {
        let income = 0, expense = 0;
        entries.forEach(e => {
            const amt = parseFloat(e.amount) || 0;
            if (e.type === 'income') income += amt;
            else expense += amt;
        });
        const balance = income - expense;
        const rate = income > 0 ? ((balance / income) * 100).toFixed(0) : '0';
        $('annualIncome').textContent = fmt(income);
        $('annualExpense').textContent = fmt(expense);
        $('annualBalance').textContent = (balance >= 0 ? '' : '-') + fmt(Math.abs(balance));
        $('annualRate').textContent = rate + '%';
    }

    function renderMonthBars(entries) {
        const byMonth = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
        entries.forEach(e => {
            const mm = parseInt(String(e.date).slice(5, 7), 10);
            if (mm < 1 || mm > 12) return;
            const amt = parseFloat(e.amount) || 0;
            if (e.type === 'income') byMonth[mm - 1].income += amt;
            else byMonth[mm - 1].expense += amt;
        });
        const data = byMonth.map((m, i) => ({ label: (i + 1) + '月', income: m.income, expense: m.expense }));
        Charts.drawBar($('annualBar'), data);
    }

    function renderCategories(entries) {
        const catSum = {};
        let total = 0;
        entries.forEach(e => {
            if (e.type !== 'expense') return;
            const amt = parseFloat(e.amount) || 0;
            catSum[e.category] = (catSum[e.category] || 0) + amt;
            total += amt;
        });
        let list = Object.keys(catSum).map(c => ({ cat: c, value: catSum[c] }))
            .sort((a, b) => b.value - a.value);
        const chartData = [];
        otherCats = [];
        if (list.length > 10) {
            const top = list.slice(0, 10);
            const restVal = list.slice(10).reduce((s, x) => s + x.value, 0);
            otherCats = list.slice(10).map(x => x.cat);
            chartData.push(...top.map(x => ({ label: x.cat, value: x.value, color: Storage.getCategoryColor(x.cat) })));
            chartData.push({ label: '其他', value: restVal, color: '#ccc' });
            list = top.concat([{ cat: '其他', value: restVal }]);
        } else {
            chartData.push(...list.map(x => ({ label: x.cat, value: x.value, color: Storage.getCategoryColor(x.cat) })));
        }
        Charts.drawPie($('annualPie'), chartData);

        const ul = $('annualCatList');
        if (list.length === 0) {
            ul.innerHTML = '<li class="a-empty">该年度暂无支出记录</li>';
            return;
        }
        ul.innerHTML = list.map(x => {
            const color = x.cat === '其他' ? '#ccc' : Storage.getCategoryColor(x.cat);
            const pct = total > 0 ? ((x.value / total) * 100).toFixed(1) : '0.0';
            const active = activeCat === x.cat ? ' active' : '';
            return '<li class="a-cat-item' + active + '" data-cat="' + x.cat + '">' +
                '<span class="a-cat-dot" style="background:' + color + '"></span>' +
                '<span class="a-cat-name">' + x.cat + '</span>' +
                '<span class="a-cat-barwrap"><span class="a-cat-bar" style="width:' + pct + '%;background:' + color + '"></span></span>' +
                '<span class="a-cat-amt">' + fmt(x.value) + '</span>' +
                '<span class="a-cat-pct">' + pct + '%</span>' +
                '</li>';
        }).join('');
        renderCatDetail();
    }

    function renderCatDetail() {
        const canvas = $('annualCatDetail');
        const hint = $('annualCatHint');
        if (!activeCat) {
            hint.textContent = '点击上方分类查看趋势';
            Charts.drawLine(canvas, [], '');
            return;
        }
        hint.textContent = '「' + activeCat + '」全年逐月支出（点击其它分类或再次点击可切换）';
        const entries = yearEntries(year);
        const byMonth = Array(12).fill(0);
        entries.forEach(e => {
            if (e.type !== 'expense' || e.category !== activeCat) return;
            const mm = parseInt(String(e.date).slice(5, 7), 10);
            if (mm >= 1 && mm <= 12) byMonth[mm - 1] += parseFloat(e.amount) || 0;
        });
        const data = byMonth.map((v, i) => ({ label: (i + 1) + '月', value: Math.round(v * 100) / 100 }));
        Charts.drawLine(canvas, data, activeCat + ' 逐月支出');
    }

    function renderMember(entries) {
        const users = ['小羊', '南瓜', '共同'];
        const stats = users.map(u => {
            const mine = entries.filter(e => e.user === u);
            let income = 0, expense = 0;
            mine.forEach(e => {
                const amt = parseFloat(e.amount) || 0;
                if (e.type === 'income') income += amt;
                else expense += amt;
            });
            return { user: u, income, expense, count: mine.length };
        });
        const maxExpense = Math.max.apply(null, stats.map(s => s.expense).concat([0]));
        const box = $('annualMember');
        if (entries.length === 0) {
            box.innerHTML = '<div class="a-empty">该年度暂无记录</div>';
            return;
        }
        box.innerHTML = stats.map(s => {
            const cls = s.user === '小羊' ? 'user-xiaoyang' : (s.user === '南瓜' ? 'user-nangua' : 'user-both');
            const color = USER_COLORS[s.user];
            const w = maxExpense > 0 ? Math.max(3, (s.expense / maxExpense) * 100) : 0;
            const nums = '支出 ' + fmt(s.expense) + ' · 收入 ' + fmt(s.income) + ' · ' + s.count + ' 笔';
            return '<div class="a-member-row">' +
                '<span class="user-tag ' + cls + '">' + s.user + '</span>' +
                '<span class="a-m-barwrap"><span class="a-m-bar" style="width:' + w + '%;background:' + color + '"></span></span>' +
                '<span class="a-m-nums">' + nums + '</span>' +
                '</div>';
        }).join('');
    }

    function renderInsights(entries) {
        const box = $('annualInsight');
        if (entries.length === 0) {
            box.innerHTML = '<div class="a-empty">该年度暂无记录，先去记几笔吧</div>';
            return;
        }
        let expenseTotal = 0, maxExpense = 0, maxEntry = null;
        const catMilk = { sum: 0, count: 0 };
        const catSum = {};
        const monthExp = Array(12).fill(0);
        entries.forEach(e => {
            const amt = parseFloat(e.amount) || 0;
            if (e.type === 'expense') {
                expenseTotal += amt;
                catSum[e.category] = (catSum[e.category] || 0) + amt;
                const mm = parseInt(String(e.date).slice(5, 7), 10);
                if (mm >= 1 && mm <= 12) monthExp[mm - 1] += amt;
                if (amt > maxExpense) { maxExpense = amt; maxEntry = e; }
                if (e.category === '奶茶') { catMilk.sum += amt; catMilk.count += 1; }
            }
        });
        const catRank = Object.keys(catSum).map(c => ({ cat: c, value: catSum[c] })).sort((a, b) => b.value - a.value);
        const topCat = catRank.length ? catRank[0] : null;
        const now = new Date();
        const days = year < now.getFullYear() ? (isLeap(year) ? 366 : 365)
            : (year === now.getFullYear() ? Math.max(1, dayOfYear(now)) : 365);
        const daily = expenseTotal / days;
        const hotIdx = monthExp.indexOf(Math.max.apply(null, monthExp));
        const hotMonth = hotIdx >= 0 ? (hotIdx + 1) + '月' : '-';
        const maxNote = maxEntry ? (String(maxEntry.date).slice(5) + ' · ' + (maxEntry.note || '无备注')) : '-';

        const items = [
            { label: '日均支出', value: fmt(daily) },
            { label: '最烧钱月份', value: hotMonth + ' 支出 ' + fmt(monthExp[hotIdx] || 0) },
            { label: '最大支出分类', value: topCat ? (topCat.cat + ' ' + fmt(topCat.value) + ' 占 ' + (expenseTotal > 0 ? (topCat.value / expenseTotal * 100).toFixed(0) : 0) + '%') : '-' },
            { label: '最大单笔支出', value: fmt(maxExpense) },
            { label: '最大单笔明细', value: maxNote },
            { label: '记账总笔数', value: entries.length + ' 笔' },
            { label: '奶茶年度账单', value: fmt(catMilk.sum) + ' · ' + catMilk.count + ' 杯' }
        ];
        box.innerHTML = items.map(it =>
            '<div class="a-insight-item"><div class="a-insight-label">' + it.label + '</div>' +
            '<div class="a-insight-value">' + it.value + '</div></div>'
        ).join('');
    }

    // ===== 事件 =====
    function bindEvents() {
        $('reportBtn').addEventListener('click', open);
        $('annualBack').addEventListener('click', close);
        $('prevYear').addEventListener('click', () => setYear(year - 1));
        $('nextYear').addEventListener('click', () => setYear(year + 1));
        $('annualBar').addEventListener('click', onBarClick);
        $('annualCatList').addEventListener('click', onCatClick);
        const pie = $('annualPie');
        if (pie) {
            pie.style.cursor = 'pointer';
            pie.addEventListener('click', ev => {
                const rect = pie.getBoundingClientRect();
                const cat = Charts.pieHitTest(pie, ev.clientX - rect.left, ev.clientY - rect.top);
                if (!cat) return;
                const cats = cat === '其他' ? (otherCats.length ? otherCats : ['其他']) : cat;
                if (typeof Extras !== 'undefined' && Extras.showCategoryTop) {
                    Extras.showCategoryTop(cats, yearEntries(year), year + '年');
                }
            });
        }
    }

    function onBarClick(ev) {
        const canvas = $('annualBar');
        const rect = canvas.getBoundingClientRect();
        if (!rect.width) return;
        const frac = (ev.clientX - rect.left) / rect.width;
        let idx = Math.floor(frac * 12);
        if (idx < 0) idx = 0;
        if (idx > 11) idx = 11;
        close();
        if (typeof App !== 'undefined' && App.jumpTo) {
            App.jumpTo(year, idx + 1);
        }
    }

    function onCatClick(ev) {
        const li = ev.target.closest('.a-cat-item');
        if (!li) return;
        const cat = li.getAttribute('data-cat');

        // 无论哪个分类都弹出金额 Top10 明细
        if (typeof Extras !== 'undefined' && Extras.showCategoryTop) {
            const cats = cat === '其他' ? (otherCats.length ? otherCats : ['其他']) : cat;
            Extras.showCategoryTop(cats, yearEntries(year), year + '年');
        }

        // 「其他」是聚合项，不做逐月趋势
        if (cat === '其他') return;
        activeCat = (activeCat === cat) ? null : cat;
        const list = $('annualCatList');
        list.querySelectorAll('.a-cat-item').forEach(el => {
            el.classList.toggle('active', el.getAttribute('data-cat') === activeCat);
        });
        renderCatDetail();
    }

    document.addEventListener('DOMContentLoaded', () => {
        try { bindEvents(); } catch (e) { console.warn('年报初始化失败:', e); }
    });
})();
