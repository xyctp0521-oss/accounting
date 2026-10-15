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
    let catLevel = 'group';    // 'group' 大类层 / 'sub' 小类层
    let activeGroup = null;    // 下钻中的大类
    let activeIsGroup = false; // 当前趋势图选中的是大类还是小类
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
        catLevel = 'group';
        activeGroup = null;
        activeIsGroup = false;
        renderAnnual();
    }

    // ===== 渲染 =====
    function renderAnnual() {
        $('annualYear').textContent = year + '年';
        const entries = yearEntries(year);
        const ms = monthStats(entries);
        renderBill(entries, ms);
        renderTotals(entries);
        renderMonthBars(entries);
        renderCompare(ms);
        renderRate(ms);
        renderCategories(entries);
        renderMember(entries);
        renderInsights(entries);
    }

    // 12 个月的收入/支出/结余/储蓄率
    function monthStats(entries) {
        const arr = Array.from({ length: 12 }, () => ({ income: 0, expense: 0, count: 0 }));
        entries.forEach(e => {
            const mm = parseInt(String(e.date).slice(5, 7), 10);
            if (mm < 1 || mm > 12) return;
            const amt = parseFloat(e.amount) || 0;
            if (e.type === 'income') arr[mm - 1].income += amt;
            else { arr[mm - 1].expense += amt; arr[mm - 1].count += 1; }
        });
        return arr.map(m => {
            const balance = m.income - m.expense;
            return {
                income: m.income, expense: m.expense, count: m.count, balance: balance,
                rate: m.income > 0 ? (balance / m.income) * 100 : null
            };
        });
    }

    // ===== 月度环比 =====
    function renderCompare(ms) {
        const box = $('annualCompare');
        const active = [];
        ms.forEach((m, i) => { if (m.income > 0 || m.expense > 0) active.push(i); });
        if (active.length === 0) {
            box.innerHTML = '<div class="a-empty">该年度暂无记录</div>';
            return;
        }
        let html = '<div class="cmp-title">月度支出环比</div>' +
            '<table class="cmp-table"><thead><tr>' +
            '<th>月份</th><th>收入</th><th>支出</th><th>结余</th><th>支出环比</th>' +
            '</tr></thead><tbody>';
        active.forEach((idx, k) => {
            const m = ms[idx];
            let cmp = '<span class="cmp-none">—</span>';
            if (k > 0) {
                const prev = ms[active[k - 1]];
                const diff = m.expense - prev.expense;
                if (Math.abs(diff) < 0.005) {
                    cmp = '<span class="cmp-flat">持平</span>';
                } else {
                    const up = diff > 0;
                    const pct = prev.expense > 0 ? Math.abs(diff / prev.expense * 100).toFixed(0) : '—';
                    cmp = '<span class="cmp-' + (up ? 'up' : 'down') + '">' +
                        (up ? '↑' : '↓') + ' ' + fmtInt(Math.abs(diff)) +
                        (pct === '—' ? '' : ' (' + pct + '%)') + '</span>';
                }
            }
            const balCls = m.balance >= 0 ? 'cmp-pos' : 'cmp-neg';
            html += '<tr>' +
                '<td class="cmp-month">' + (idx + 1) + '月</td>' +
                '<td>' + fmtInt(m.income) + '</td>' +
                '<td>' + fmtInt(m.expense) + '</td>' +
                '<td class="' + balCls + '">' + (m.balance >= 0 ? '' : '-') + fmtInt(Math.abs(m.balance)) + '</td>' +
                '<td>' + cmp + '</td>' +
                '</tr>';
        });
        html += '</tbody></table>';
        box.innerHTML = html;
    }

    // ===== 储蓄率趋势 =====
    function renderRate(ms) {
        const data = ms.map((m, i) => ({
            label: (i + 1) + '月',
            value: m.rate == null ? NaN : Math.round(m.rate * 10) / 10
        }));
        Charts.drawRate($('annualRateChart'), data);

        const valid = ms.filter(m => m.rate != null);
        const hint = $('annualRateHint');
        if (!valid.length) {
            hint.textContent = '暂无收入记录，无法计算储蓄率';
            return;
        }
        const avg = valid.reduce((s, m) => s + m.rate, 0) / valid.length;
        let hi = valid[0], lo = valid[0];
        valid.forEach(m => {
            if (m.rate > hi.rate) hi = m;
            if (m.rate < lo.rate) lo = m;
        });
        const hiIdx = ms.indexOf(hi) + 1, loIdx = ms.indexOf(lo) + 1;
        const neg = valid.filter(m => m.rate < 0).length;
        hint.innerHTML = '全年平均储蓄率 <b>' + avg.toFixed(0) + '%</b>　·　' +
            '最高 ' + hiIdx + '月 <b>' + hi.rate.toFixed(0) + '%</b>　·　' +
            '最低 ' + loIdx + '月 <b>' + lo.rate.toFixed(0) + '%</b>' +
            (neg > 0 ? '　·　有 <b style="color:#cf1322">' + neg + '</b> 个月入不敷出' : '');
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

    // 大类 -> 其下所有小类（含数据中实际出现的）
    function catsOfGroup(group) {
        const tree = Storage.CATEGORY_TREE.expense || [];
        const grp = tree.find(x => x.name === group);
        const subs = grp ? grp.subs.slice() : [group];
        Storage.getAll().forEach(e => {
            if (Storage.getGroup(e.category) === group && subs.indexOf(e.category) < 0) subs.push(e.category);
        });
        return subs;
    }

    function renderCategories(entries) {
        const isSub = catLevel === 'sub' && activeGroup;
        const catSum = {};
        let total = 0;
        entries.forEach(e => {
            if (e.type !== 'expense') return;
            const amt = parseFloat(e.amount) || 0;
            if (isSub) {
                if (Storage.getGroup(e.category) !== activeGroup) return;
                catSum[e.category] = (catSum[e.category] || 0) + amt;
                total += amt;
            } else {
                const g = Storage.getGroup(e.category);
                catSum[g] = (catSum[g] || 0) + amt;
                total += amt;
            }
        });
        const list = Object.keys(catSum).map(c => ({ cat: c, value: catSum[c] }))
            .sort((a, b) => b.value - a.value);

        const base = activeGroup ? Storage.getGroupColor(activeGroup) : '#999';
        const chartData = list.map((x, i) => ({
            label: x.cat,
            value: x.value,
            color: isSub ? Storage.shadeColor(base, i, Math.max(list.length, 2)) : Storage.getGroupColor(x.cat)
        }));
        Charts.drawPie($('annualPie'), chartData);

        const ul = $('annualCatList');
        if (list.length === 0) {
            ul.innerHTML = '<li class="a-empty">该年度暂无支出记录</li>';
            return;
        }
        let html = '';
        if (isSub) {
            html += '<li class="a-cat-item a-cat-back" data-cat="__back__">' +
                '<span class="a-cat-name">← 返回全部大类</span></li>';
        }
        html += list.map(x => {
            const color = isSub
                ? Storage.shadeColor(base, list.indexOf(x), Math.max(list.length, 2))
                : Storage.getGroupColor(x.cat);
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
        ul.innerHTML = html;
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
        const set = activeIsGroup ? catsOfGroup(activeCat) : [activeCat];
        entries.forEach(e => {
            if (e.type !== 'expense' || set.indexOf(e.category) < 0) return;
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
                catSum[Storage.getGroup(e.category)] = (catSum[Storage.getGroup(e.category)] || 0) + amt;
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

    // ===== 年度账单 =====
    let lastBill = null;

    function renderBill(entries, ms) {
        const box = $('annualBill');
        if (!entries || entries.length === 0) {
            lastBill = null;
            box.innerHTML = '<div class="a-empty">该年度暂无记录</div>';
            return;
        }
        let income = 0, expense = 0, maxExp = 0, maxEntry = null, milkCount = 0, milkSum = 0;
        const catSum = {}, daySet = new Set();
        entries.forEach(e => {
            const amt = parseFloat(e.amount) || 0;
            if (e.date) daySet.add(String(e.date).slice(0, 10));
            if (e.type === 'income') { income += amt; return; }
            expense += amt;
            const g = Storage.getGroup(e.category);
            catSum[g] = (catSum[g] || 0) + amt;
            if (amt > maxExp) { maxExp = amt; maxEntry = e; }
            if (e.category === '奶茶') { milkCount += 1; milkSum += amt; }
        });
        const catRank = Object.keys(catSum).map(c => ({ cat: c, value: catSum[c] })).sort((a, b) => b.value - a.value);
        const used = [];
        ms.forEach((m, i) => { if (m.income > 0 || m.expense > 0) used.push(i); });
        let hotIdx = -1, coldIdx = -1;
        used.forEach(i => {
            if (hotIdx < 0 || ms[i].expense > ms[hotIdx].expense) hotIdx = i;
            if (coldIdx < 0 || ms[i].expense < ms[coldIdx].expense) coldIdx = i;
        });
        const balance = income - expense;
        const rate = income > 0 ? balance / income * 100 : 0;
        const now = new Date();
        const days = year < now.getFullYear() ? (isLeap(year) ? 366 : 365)
            : (year === now.getFullYear() ? Math.max(1, dayOfYear(now)) : 365);
        const daily = expense / days;

        let quote;
        if (rate >= 40) quote = '今年存下了 ' + rate.toFixed(0) + '% 的收入，克制得不错。';
        else if (rate >= 20) quote = '收支健康，' + (catRank[0] ? catRank[0].cat : '大额开销') + '是今年最大的去处。';
        else if (rate >= 0) quote = '赚的差不多都花掉了，' + (catRank[0] ? catRank[0].cat : '开销') + '值得回头看看。';
        else quote = '今年支出超过了收入，' + (hotIdx >= 0 ? (hotIdx + 1) + '月' : '某个月') + '是转折点。';

        lastBill = {
            year: year, income: income, expense: expense, balance: balance, rate: rate,
            count: entries.length, days: daySet.size, daily: daily,
            topCat: catRank[0] ? catRank[0].cat : '-', topCatVal: catRank[0] ? catRank[0].value : 0,
            maxAmt: maxExp, maxNote: maxEntry ? (String(maxEntry.date).slice(5) + ' ' + (maxEntry.note || '无备注')) : '-',
            hotMonth: hotIdx >= 0 ? (hotIdx + 1) + '月' : '-', hotVal: hotIdx >= 0 ? ms[hotIdx].expense : 0,
            coldMonth: coldIdx >= 0 ? (coldIdx + 1) + '月' : '-', coldVal: coldIdx >= 0 ? ms[coldIdx].expense : 0,
            milkCount: milkCount, milkSum: milkSum, quote: quote
        };

        const b = lastBill;
        const cells = [
            ['全年收入', fmtInt(b.income), 'a-income'],
            ['全年结余', (b.balance >= 0 ? '' : '-') + fmtInt(Math.abs(b.balance)), b.balance >= 0 ? 'a-income' : 'a-expense'],
            ['储蓄率', b.rate.toFixed(0) + '%', 'a-rate'],
            ['日均支出', fmtInt(b.daily), ''],
            ['记账笔数', b.count + ' 笔', ''],
            ['记账天数', b.days + ' 天', ''],
            ['最烧钱分类', b.topCat, ''],
            ['花最多月份', b.hotMonth, '']
        ];
        box.innerHTML =
            '<div class="bill-hero">' +
            '<div class="bill-hero-label">' + b.year + ' 年总支出</div>' +
            '<div class="bill-hero-value">' + fmt(b.expense) + '</div>' +
            '<div class="bill-hero-sub">共 ' + b.count + ' 笔 · 覆盖 ' + b.days + ' 天 · 日均 ' + fmtInt(b.daily) + '</div>' +
            '</div>' +
            '<div class="bill-grid">' + cells.map(c =>
                '<div class="bill-cell"><div class="bc-label">' + c[0] + '</div>' +
                '<div class="bc-value ' + c[2] + '">' + c[1] + '</div></div>'
            ).join('') + '</div>' +
            '<div class="bill-quote">' + b.quote + '</div>';
    }

    // 把年度账单画成竖版图片并下载
    function saveBillImage() {
        const b = lastBill;
        if (!b) return;
        const W = 750, H = 1240, dpr = 2;
        const cv = document.createElement('canvas');
        cv.width = W * dpr; cv.height = H * dpr;
        const ctx = cv.getContext('2d');
        ctx.scale(dpr, dpr);
        const F = '"PingFang SC","Microsoft YaHei",sans-serif';

        const rr = (x, y, w, h, r) => {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        };

        ctx.fillStyle = '#fffdf9'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ff9c3d'; ctx.fillRect(0, 0, W, 168);
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.font = '500 22px ' + F; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('小羊记账', 48, 62);
        ctx.fillStyle = '#fff';
        ctx.font = '500 40px ' + F;
        ctx.fillText(b.year + ' 年度账单', 48, 118);
        ctx.font = '400 20px ' + F;
        ctx.fillText('共 ' + b.count + ' 笔 · 覆盖 ' + b.days + ' 天', 48, 150);

        ctx.fillStyle = '#8c8c8c'; ctx.font = '400 22px ' + F;
        ctx.fillText('全年总支出', 48, 232);
        ctx.fillStyle = '#262626'; ctx.font = '500 60px ' + F;
        ctx.fillText(fmt(b.expense), 48, 294);
        ctx.fillStyle = '#8c8c8c'; ctx.font = '400 20px ' + F;
        ctx.fillText('日均 ' + fmtInt(b.daily) + ' · 储蓄率 ' + b.rate.toFixed(0) + '%', 48, 330);

        const box = [
            ['全年收入', fmtInt(b.income), '#389e0d'],
            ['全年结余', (b.balance >= 0 ? '' : '-') + fmtInt(Math.abs(b.balance)), b.balance >= 0 ? '#389e0d' : '#cf1322'],
            ['最烧钱分类', b.topCat, '#fa541c'],
            ['最大一笔', fmtInt(b.maxAmt), '#cf1322']
        ];
        box.forEach((c, i) => {
            const x = 48 + (i % 2) * 336, y = 372 + Math.floor(i / 2) * 122;
            ctx.fillStyle = '#fff8f0'; rr(x, y, 318, 106, 14); ctx.fill();
            ctx.fillStyle = '#8c8c8c'; ctx.font = '400 19px ' + F;
            ctx.fillText(c[0], x + 20, y + 38);
            ctx.fillStyle = c[2]; ctx.font = '500 30px ' + F;
            ctx.fillText(c[1], x + 20, y + 78);
        });

        const rows = [
            ['最大一笔花在哪', b.maxNote],
            ['花得最多的月份', b.hotMonth + '　支出 ' + fmtInt(b.hotVal)],
            ['花得最省的月份', b.coldMonth + '　支出 ' + fmtInt(b.coldVal)],
            ['奶茶', b.milkCount + ' 杯　共 ' + fmtInt(b.milkSum)],
            ['记账笔数', b.count + ' 笔'],
            ['记账天数', b.days + ' 天']
        ];
        let y = 664;
        rows.forEach(r => {
            ctx.fillStyle = '#595959'; ctx.font = '400 22px ' + F; ctx.textAlign = 'left';
            ctx.fillText(r[0], 48, y);
            ctx.fillStyle = '#262626'; ctx.font = '500 22px ' + F; ctx.textAlign = 'right';
            ctx.fillText(String(r[1]).slice(0, 26), W - 48, y);
            ctx.textAlign = 'left';
            ctx.strokeStyle = '#f0f0f0';
            ctx.beginPath(); ctx.moveTo(48, y + 16); ctx.lineTo(W - 48, y + 16); ctx.stroke();
            y += 56;
        });

        ctx.fillStyle = '#fff3e6'; rr(48, y + 20, W - 96, 96, 14); ctx.fill();
        ctx.fillStyle = '#ad6800'; ctx.font = '400 22px ' + F;
        const q = b.quote.length > 30 ? b.quote.slice(0, 30) : b.quote;
        ctx.fillText(q, 72, y + 76);

        ctx.fillStyle = '#bfbfbf'; ctx.font = '400 18px ' + F; ctx.textAlign = 'center';
        ctx.fillText('生成于 ' + new Date().toLocaleDateString('zh-CN') + ' · 小羊记账', W / 2, H - 40);

        cv.toBlob(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = b.year + '年度账单.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }, 'image/png');
    }

    // ===== 事件 =====
    function bindEvents() {
        $('reportBtn').addEventListener('click', open);
        $('annualBack').addEventListener('click', close);
        $('prevYear').addEventListener('click', () => setYear(year - 1));
        $('nextYear').addEventListener('click', () => setYear(year + 1));
        const billBtn = $('billSaveBtn');
        if (billBtn) billBtn.addEventListener('click', saveBillImage);
        $('annualBar').addEventListener('click', onBarClick);
        $('annualCatList').addEventListener('click', onCatClick);
        const pie = $('annualPie');
        if (pie) {
            pie.style.cursor = 'pointer';
            pie.addEventListener('click', ev => {
                const rect = pie.getBoundingClientRect();
                const cat = Charts.pieHitTest(pie, ev.clientX - rect.left, ev.clientY - rect.top);
                if (!cat) return;
                if (catLevel === 'sub') { showTop(cat, false); return; }
                const subs = catsOfGroup(cat).filter(c => Storage.getGroup(c) === cat);
                if (subs.length > 1) {
                    activeGroup = cat;
                    catLevel = 'sub';
                    activeCat = cat;
                    activeIsGroup = true;
                    renderAnnual();
                } else {
                    showTop(cat, true);
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

    function showTop(cat, isGroup) {
        if (typeof Extras === 'undefined' || !Extras.showCategoryTop) return;
        const cats = isGroup ? catsOfGroup(cat) : cat;
        Extras.showCategoryTop(cats, yearEntries(year), year + '年', isGroup ? cat : null);
    }

    function onCatClick(ev) {
        const li = ev.target.closest('.a-cat-item');
        if (!li) return;
        const cat = li.getAttribute('data-cat');

        // 返回上层
        if (cat === '__back__') {
            catLevel = 'group';
            activeGroup = null;
            activeCat = null;
            activeIsGroup = false;
            renderAnnual();
            return;
        }

        if (catLevel === 'group') {
            const subs = catsOfGroup(cat).filter(c => Storage.getGroup(c) === cat);
            if (subs.length > 1) {
                // 下钻到该大类的小类
                activeGroup = cat;
                catLevel = 'sub';
                activeCat = cat;
                activeIsGroup = true;
                renderAnnual();
            } else {
                // 只有一个小类，直接看明细
                showTop(cat, true);
                activeCat = (activeCat === cat) ? null : cat;
                activeIsGroup = !!activeCat;
                renderAnnual();
            }
            return;
        }

        // 小类层：弹 Top10 + 切换逐月趋势
        showTop(cat, false);
        activeCat = (activeCat === cat) ? null : cat;
        activeIsGroup = false;
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
