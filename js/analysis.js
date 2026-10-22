/**
 * analysis.js - 智能分析引擎
 * 适配两级分类：统计一律按「大类」，判断规则也用大类；
 * 异常检测用「同类历史单笔均值」做基准，避免被一次性大额拉爆阈值。
 */
const Analysis = (function () {

    // 刚性支出（小类）：房/车贷、房屋水电、通讯、养车、教育
    const FIXED_SUBS = { '房贷': 1, '车贷': 1, '住房': 1, '通讯': 1, '养车': 1, '教育': 1 };

    function groupOf(cat) {
        try {
            if (typeof Storage.getGroup === 'function') return Storage.getGroup(cat) || cat;
        } catch (e) { /* ignore */ }
        return cat;
    }

    function groupColor(g) {
        try {
            if (typeof Storage.getGroupColor === 'function') return Storage.getGroupColor(g);
            return Storage.getCategoryColor(g);
        } catch (e) { return '#999'; }
    }

    function monthName(y, m) { return (m + 1) + '月'; }

    function prevMonthEntries(y, m) {
        const d = new Date(y, m - 1, 1);
        return Storage.getEntriesByMonth(d.getFullYear(), d.getMonth());
    }

    // 往前 n 个月的记录（不含当月）
    function pastEntries(y, m, n) {
        const out = [];
        for (let i = 1; i <= n; i++) {
            const d = new Date(y, m - i, 1);
            const list = Storage.getEntriesByMonth(d.getFullYear(), d.getMonth());
            if (list && list.length) out.push({ y: d.getFullYear(), m: d.getMonth(), entries: list });
        }
        return out;
    }

    function daysInMonth(y, m) {
        const now = new Date();
        if (y === now.getFullYear() && m === now.getMonth()) return Math.max(1, now.getDate());
        return new Date(y, m + 1, 0).getDate();
    }

    function generate(year, month) {
        const entries = Storage.getEntriesByMonth(year, month);
        if (!entries.length) return [];

        const s = calcSummary(entries, year, month);
        const prev = calcSummary(prevMonthEntries(year, month), year, month);
        const past = pastEntries(year, month, 6);

        const insights = [];
        insights.push(buildOverview(s));
        insights.push(buildStructure(s));
        if (s.expense > 0) insights.push(buildFixedShare(s));
        insights.push(buildTrend(s, prev, past));
        const anomalies = detectAnomalies(entries, past, s);
        if (anomalies.length) insights.push(buildAnomaly(anomalies));
        if (s.income > 0) insights.push(buildSavings(s));
        const tips = buildTips(s, prev, entries);
        if (tips.length) insights.push({ type: 'info', title: '✨ 记账建议', html: tips });

        return insights;
    }

    function calcSummary(entries, y, m) {
        let income = 0, expense = 0, fixed = 0, fixedCount = 0;
        const byGroup = {}, bySub = {}, subCount = {}, groupCount = {};

        (entries || []).forEach(e => {
            const amt = parseFloat(e.amount) || 0;
            if (e.type === 'income') { income += amt; return; }
            expense += amt;
            const g = groupOf(e.category);
            byGroup[g] = (byGroup[g] || 0) + amt;
            bySub[e.category] = (bySub[e.category] || 0) + amt;
            subCount[e.category] = (subCount[e.category] || 0) + 1;
            groupCount[g] = (groupCount[g] || 0) + 1;
            if (FIXED_SUBS[e.category]) { fixed += amt; fixedCount += 1; }
        });

        const groups = Object.keys(byGroup)
            .map(g => ({ group: g, amount: byGroup[g], count: groupCount[g] || 0,
                pct: expense > 0 ? byGroup[g] / expense : 0 }))
            .sort((a, b) => b.amount - a.amount);

        const subsOf = g => Object.keys(bySub)
            .filter(c => groupOf(c) === g)
            .map(c => ({ cat: c, amount: bySub[c], count: subCount[c] || 0 }))
            .sort((a, b) => b.amount - a.amount);

        const days = (y != null && m != null) ? daysInMonth(y, m) : 30;

        return {
            income, expense,
            balance: income - expense,
            savingsRate: income > 0 ? (income - expense) / income : 0,
            groups, byGroup, bySub, subCount, subsOf,
            fixed, fixedCount,
            variable: expense - fixed,
            days,
            dailyAvg: days > 0 ? expense / days : 0,
            txnCount: (entries || []).length,
            expenseCount: (entries || []).filter(e => e.type !== 'income').length
        };
    }

    function buildOverview(s) {
        return {
            type: 'info',
            title: '📊 月度概览',
            html:
                '<div class="insight-stats">' +
                '<div class="insight-stat"><div class="insight-stat-value" style="color:#52c41a">' + formatMoney(s.income) + '</div><div class="insight-stat-label">收入</div></div>' +
                '<div class="insight-stat"><div class="insight-stat-value" style="color:#ff4d4f">' + formatMoney(s.expense) + '</div><div class="insight-stat-label">支出</div></div>' +
                '<div class="insight-stat"><div class="insight-stat-value" style="color:' + (s.balance >= 0 ? '#1890ff' : '#cf1322') + '">' + formatMoney(s.balance) + '</div><div class="insight-stat-label">结余</div></div>' +
                '<div class="insight-stat"><div class="insight-stat-value" style="color:#666">' + s.txnCount + '</div><div class="insight-stat-label">笔数</div></div>' +
                '</div>' +
                '<div style="margin-top:10px;font-size:13px;color:#666;">日均支出 <strong>¥' + s.dailyAvg.toFixed(2) +
                '</strong> · 共 ' + s.expenseCount + ' 笔支出，笔均 <strong>¥' +
                (s.expenseCount > 0 ? (s.expense / s.expenseCount).toFixed(0) : '0') + '</strong></div>'
        };
    }

    // 支出结构：按大类，第一名展开其下小类
    function buildStructure(s) {
        const top = s.groups.slice(0, 5);
        const rest = s.groups.slice(5);
        const rows = top.map(g => {
            const color = groupColor(g.group);
            return '<div style="margin-bottom:8px;">' +
                '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;">' +
                '<span><strong>' + esc(g.group) + '</strong>' +
                '<span style="color:#999;font-size:11px;margin-left:6px;">' + g.count + ' 笔</span></span>' +
                '<span>' + formatMoney(g.amount) + ' <span style="color:#999;">' + (g.pct * 100).toFixed(1) + '%</span></span>' +
                '</div>' +
                '<div class="progress-bar"><div class="progress-fill" style="width:' + (g.pct * 100).toFixed(1) + '%;background:' + color + ';"></div></div>' +
                '</div>';
        }).join('');

        let restHtml = '';
        if (rest.length) {
            const restSum = rest.reduce((a, x) => a + x.amount, 0);
            restHtml = '<div style="font-size:12px;color:#999;margin-top:6px;">另有 ' + rest.length +
                ' 个大类合计 ' + formatMoney(restSum) + '</div>';
        }

        let subHtml = '';
        if (top.length && top[0].pct > 0.25) {
            const subs = s.subsOf(top[0].group).slice(0, 3);
            if (subs.length) {
                subHtml = '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #e8e8e8;font-size:12px;color:#666;">' +
                    esc(top[0].group) + ' 内部：' +
                    subs.map(x => esc(x.cat) + ' ' + formatMoney(x.amount)).join(' · ') + '</div>';
            }
        }

        return { type: 'info', title: '🏷️ 支出结构', html: rows + restHtml + subHtml };
    }

    // 刚性 / 可变
    function buildFixedShare(s) {
        if (s.expense <= 0) return { type: 'info', title: '🏠 刚性支出', html: '本月暂无支出' };
        const fp = s.fixed / s.expense;
        const vp = 1 - fp;
        const fixedSubs = Object.keys(s.bySub).filter(c => FIXED_SUBS[c]).sort((a, b) => s.bySub[b] - s.bySub[a]);
        const detail = fixedSubs.slice(0, 4).map(c => esc(c) + ' ' + formatMoney(s.bySub[c])).join(' · ');

        let type = 'info';
        let judge = '';
        if (fp >= 0.5) { type = 'warning'; judge = '刚性占比偏高，能调整的空间有限，重点看可变那部分。'; }
        else if (fp >= 0.3) { type = 'info'; judge = '刚性占比中等，可变支出才是你能主动控制的部分。'; }
        else { type = 'success'; judge = '刚性占比不高，大部分开销是可调的。'; }

        const carBuy = s.bySub['购车'] || 0;
        const extra = carBuy > 0
            ? '<div style="font-size:12px;color:#d46b08;margin-top:4px;">本月另含购车一次性支出 ' +
              formatMoney(carBuy) + '，属于大额采购，未计入刚性。</div>'
            : '';

        return {
            type,
            title: '🏠 刚性支出',
            html:
                '<div style="display:flex;height:10px;border-radius:6px;overflow:hidden;margin-bottom:8px;">' +
                '<div style="width:' + (fp * 100).toFixed(1) + '%;background:#8c8c8c;"></div>' +
                '<div style="width:' + (vp * 100).toFixed(1) + '%;background:#91d5ff;"></div>' +
                '</div>' +
                '<div style="font-size:13px;line-height:1.9;">' +
                '刚性 <strong>' + formatMoney(s.fixed) + '</strong>（' + (fp * 100).toFixed(0) + '%）　·　' +
                '可变 <strong>' + formatMoney(s.variable) + '</strong>（' + (vp * 100).toFixed(0) + '%）</div>' +
                (detail ? '<div style="font-size:12px;color:#999;margin-top:4px;">' + detail + '</div>' : '') +
                '<div style="font-size:12px;color:#666;margin-top:4px;">' + judge + '</div>' + extra
        };
    }

    function buildTrend(s, prev, past) {
        if (!(prev.expense > 0)) {
            return { type: 'info', title: '📈 支出趋势', html: '上月没有支出记录，无法对比。' };
        }
        const diff = s.expense - prev.expense;
        const pct = diff / prev.expense * 100;
        const up = diff > 0;
        const type = Math.abs(pct) > 30 ? (up ? 'danger' : 'success') : 'info';

        let html = '本月支出 ' + formatMoney(s.expense) + '，' + (up ? '比上月多花' : '比上月少花') +
            ' <strong style="color:' + (up ? '#cf1322' : '#389e0d') + '">' + formatMoney(Math.abs(diff)) +
            '</strong>（' + (up ? '+' : '') + pct.toFixed(1) + '%）';

        // 近 6 个月均值对比
        if (past.length >= 2) {
            const amounts = past.map(p => p.entries.filter(e => e.type !== 'income')
                .reduce((a, e) => a + (parseFloat(e.amount) || 0), 0)).filter(v => v > 0);
            if (amounts.length >= 2) {
                const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
                const d2 = s.expense - avg;
                const p2 = avg > 0 ? d2 / avg * 100 : 0;
                html += '<div style="font-size:12px;color:#666;margin-top:6px;">近 ' + amounts.length +
                    ' 个月平均 ' + formatMoney(avg) + '，本月' + (d2 >= 0 ? '高出' : '低于') + '均值 <strong>' +
                    Math.abs(p2).toFixed(0) + '%</strong></div>';
            }
        }

        // 分类变化（按大类）
        const changes = [];
        Object.keys(s.byGroup).forEach(g => {
            const cur = s.byGroup[g] || 0;
            const old = prev.byGroup[g] || 0;
            if (old === 0 && cur > 0) changes.push({ g, diff: cur, pct: null, isNew: true });
            else if (old > 0) {
                const d = cur - old;
                const p = d / old * 100;
                if (Math.abs(p) >= 15 && Math.abs(d) >= 100) changes.push({ g, diff: d, pct: p, isNew: false });
            }
        });
        changes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
        if (changes.length) {
            html += '<div style="margin-top:8px;font-size:12px;color:#666;">大类变化：' +
                changes.slice(0, 3).map(c => {
                    if (c.isNew) return '<div>• ' + esc(c.g) + '：本月新增 ' + formatMoney(c.diff) + '</div>';
                    return '<div>• ' + esc(c.g) + '：' + (c.diff > 0 ? '↑' : '↓') + ' ' +
                        formatMoney(Math.abs(c.diff)) + '（' + Math.abs(c.pct).toFixed(0) + '%）</div>';
                }).join('') + '</div>';
        }

        return { type, title: up ? '📈 支出趋势' : '📉 支出趋势', html };
    }

    // 异常：① 与同类近 6 个月单笔均值比超 3 倍；② 历史样本不足时，单笔占全月 25% 且 ≥¥2000 也算
    function detectAnomalies(entries, past, s) {
        const hist = {};
        past.forEach(p => {
            p.entries.forEach(e => {
                if (e.type === 'income') return;
                (hist[e.category] = hist[e.category] || []).push(parseFloat(e.amount) || 0);
            });
        });

        const monthTotal = (s && s.expense) || 0;
        const out = [];
        entries.forEach(e => {
            if (e.type === 'income') return;
            const amt = parseFloat(e.amount) || 0;
            if (amt < 500) return;
            const list = hist[e.category];
            if (!list || list.length < 3) {
                // 没有可比历史（如首次购车），用占比兜底
                if (monthTotal > 0 && amt >= 2000 && amt / monthTotal >= 0.25) {
                    out.push({ e, amt, avg: null, ratio: null, share: amt / monthTotal });
                }
                return;
            }
            const avg = list.reduce((a, b) => a + b, 0) / list.length;
            if (avg > 0 && amt >= avg * 3) out.push({ e, amt, avg, ratio: amt / avg });
        });
        out.sort((a, b) => b.amt - a.amt);
        return out.slice(0, 3);
    }

    function buildAnomaly(list) {
        const items = list.map(x => {
            const note = x.e.note ? '（' + esc(x.e.note) + '）' : '';
            const why = x.avg == null
                ? ' — 占本月支出的 ' + (x.share * 100).toFixed(0) + '%'
                : ' — 是平时同类单笔（' + formatMoney(x.avg) + '）的 ' + x.ratio.toFixed(1) + ' 倍';
            return '<div style="margin-top:5px;">• <strong>' + esc(x.e.category) + '</strong> ' +
                formatMoney(x.amt) + ' · ' + esc(String(x.e.date).slice(5)) + note +
                '<span style="color:#999;font-size:11px;">' + why + '</span></div>';
        }).join('');
        return { type: 'danger', title: '⚠️ 大额异常', html: '这几笔明显偏离你平时的消费：' + items };
    }

    function buildSavings(s) {
        const rate = (s.savingsRate * 100).toFixed(1);
        let type, msg;
        if (s.savingsRate >= 0.3) { type = 'success'; msg = '储蓄率 <strong>' + rate + '%</strong>，健康水平，保持住。'; }
        else if (s.savingsRate >= 0.15) { type = 'success'; msg = '储蓄率 <strong>' + rate + '%</strong>，属于合理区间。'; }
        else if (s.savingsRate >= 0) { type = 'warning'; msg = '储蓄率只有 <strong>' + rate + '%</strong>，离 15% 的健康线还差一点。'; }
        else { type = 'danger'; msg = '本月入不敷出，超支 <strong>' + formatMoney(Math.abs(s.balance)) + '</strong>。'; }
        return { type, title: '🎯 储蓄评估', html: msg };
    }

    function buildTips(s, prev, entries) {
        const tips = [];
        const pctOf = g => s.expense > 0 ? (s.byGroup[g] || 0) / s.expense : 0;

        // 1) 单笔过于集中（最该先说）
        if (s.expense > 0) {
            const maxE = entries.filter(e => e.type !== 'income')
                .map(e => ({ e, amt: parseFloat(e.amount) || 0 }))
                .sort((a, b) => b.amt - a.amt)[0];
            if (maxE && maxE.amt / s.expense >= 0.35) {
                tips.push('最大一笔 <strong>' + formatMoney(maxE.amt) + '</strong>（' +
                    esc(maxE.e.note || maxE.e.category) + '）就占了全月 ' +
                    (maxE.amt / s.expense * 100).toFixed(0) + '%，本月开销基本由它决定。');
            }
        }

        // 2) 环比大涨
        if (prev.expense > 0 && s.expense > prev.expense * 1.3) {
            tips.push('支出比上月涨了 <strong>' + ((s.expense / prev.expense - 1) * 100).toFixed(0) +
                '%</strong>，如果不是一次性大额（买车、旅行这种），下个月得收一收。');
        }

        // 3) 刚性偏高
        if (s.expense > 0 && s.fixed / s.expense > 0.5) {
            tips.push('刚性支出占了 <strong>' + (s.fixed / s.expense * 100).toFixed(0) +
                '%</strong>，这类钱基本省不掉，预算要按这个基数往上加。');
        }

        // 4) 吃喝
        if (pctOf('吃喝') > 0.3) {
            const eatOut = s.bySub['聚餐外食'] || 0;
            const daily = (s.bySub['日常三餐'] || 0);
            tips.push('吃喝占了 <strong>' + (pctOf('吃喝') * 100).toFixed(0) + '%</strong>（' + formatMoney(s.byGroup['吃喝']) +
                '），其中聚餐外食 ' + formatMoney(eatOut) + '、日常三餐 ' + formatMoney(daily) +
                '。想省的话先看聚餐那部分。');
        }

        // 5) 购物
        const shopG = s.groups.find(g => g.group === '购物') || { amount: 0, count: 0 };
        if (pctOf('购物') > 0.25 || shopG.count >= 15) {
            tips.push('购物 ' + formatMoney(shopG.amount) + '（' + (pctOf('购物') * 100).toFixed(0) + '%），共 ' +
                shopG.count + ' 笔。笔数多的时候，多半是零散下单，合并采购能少花一截。');
        }

        // 6) 出行（不含购车）
        const carBuy = s.bySub['购车'] || 0;
        const drive = (s.byGroup['出行'] || 0) - carBuy;
        if (pctOf('出行') > 0.15 && carBuy === 0) {
            tips.push('出行 ' + formatMoney(drive) + '，占 ' + (pctOf('出行') * 100).toFixed(0) +
                '%。车险、保养这类是大头，可以留意有没有能提前规划的年付方案。');
        }

        return tips.slice(0, 4).map(t => '<div style="margin-top:5px;">• ' + t + '</div>').join('');
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatMoney(amt) {
        const n = Number(amt) || 0;
        const sign = n < 0 ? '-' : '';
        return sign + '¥' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    return { generate, formatMoney };
})();
