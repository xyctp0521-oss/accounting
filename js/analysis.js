/**
 * analysis.js - 智能分析引擎
 * 自动分析消费规律、异常支出、环比变化，生成洞察和建议
 */
const Analysis = (function () {

    /**
     * 生成完整的智能分析报告
     * @param {number} year
     * @param {number} month  0-indexed
     */
    function generate(year, month) {
        const entries = Storage.getEntriesByMonth(year, month);
        const prevEntries = Storage.getEntriesByMonth(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);

        if (entries.length === 0) return [];

        const insights = [];
        const summary = calcSummary(entries);
        const prevSummary = calcSummary(prevEntries);

        // 1. 月度概览
        insights.push(buildOverview(summary, prevSummary));

        // 2. 最大支出类别
        if (summary.expenseCats.length > 0) {
            insights.push(buildTopCategories(summary));
        }

        // 3. 环比变化
        if (prevSummary.expense > 0) {
            insights.push(buildMoMComparison(summary, prevSummary));
        }

        // 4. 消费时间规律
        insights.push(buildTimePattern(entries));

        // 5. 异常支出检测
        const anomalies = detectAnomalies(entries, summary);
        if (anomalies.length > 0) {
            insights.push(buildAnomalyAlert(anomalies));
        }

        // 6. 储蓄率评估
        if (summary.income > 0) {
            insights.push(buildSavingsRate(summary));
        }

        // 7. 智能建议
        const tips = generateTips(summary, prevSummary, entries);
        if (tips.length > 0) {
            insights.push(buildTips(tips));
        }

        return insights;
    }

    function calcSummary(entries) {
        let income = 0, expense = 0;
        const catMap = {};
        const dailyMap = {};

        entries.forEach(e => {
            const amt = parseFloat(e.amount) || 0;
            if (e.type === 'income') {
                income += amt;
            } else {
                expense += amt;
                catMap[e.category] = (catMap[e.category] || 0) + amt;
                const day = parseInt(e.date.slice(8, 10));
                dailyMap[day] = (dailyMap[day] || 0) + amt;
            }
        });

        const expenseCats = Object.entries(catMap)
            .map(([cat, amt]) => ({ category: cat, amount: amt, percentage: expense > 0 ? amt / expense : 0 }))
            .sort((a, b) => b.amount - a.amount);

        const avgExpense = expense;
        const dailyAvg = Object.keys(dailyMap).length > 0 ? expense / Object.keys(dailyMap).length : 0;

        // 计算消费金额的标准差，用于异常检测
        const expenseAmounts = entries.filter(e => e.type === 'expense').map(e => parseFloat(e.amount) || 0);
        const mean = expenseAmounts.length > 0 ? expenseAmounts.reduce((a, b) => a + b, 0) / expenseAmounts.length : 0;
        const variance = expenseAmounts.length > 0 ? expenseAmounts.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / expenseAmounts.length : 0;
        const stdDev = Math.sqrt(variance);

        return {
            income, expense,
            balance: income - expense,
            savingsRate: income > 0 ? (income - expense) / income : 0,
            expenseCats,
            dailyMap,
            dailyAvg,
            txnCount: entries.length,
            expenseCount: expenseAmounts.length,
            avgPerTxn: expenseAmounts.length > 0 ? expense / expenseAmounts.length : 0,
            mean, stdDev,
            catMap
        };
    }

    function buildOverview(s, prev) {
        const balanceStr = formatMoney(s.balance);
        const incomeStr = formatMoney(s.income);
        const expenseStr = formatMoney(s.expense);
        const trend = prev.expense > 0 ? ((s.expense - prev.expense) / prev.expense * 100) : null;
        let trendHtml = '';
        if (trend !== null) {
            const arrow = trend > 0 ? '📈' : '📉';
            const color = trend > 0 ? '#ff4d4f' : '#52c41a';
            trendHtml = `<span style="color:${color}">${arrow} 环比${trend > 0 ? '增长' : '减少'}${Math.abs(trend).toFixed(1)}%</span>`;
        }

        return {
            type: 'info',
            title: '📊 月度概览',
            html: `
                <div class="insight-stats">
                    <div class="insight-stat"><div class="insight-stat-value" style="color:#52c41a">${incomeStr}</div><div class="insight-stat-label">收入</div></div>
                    <div class="insight-stat"><div class="insight-stat-value" style="color:#ff4d4f">${expenseStr}</div><div class="insight-stat-label">支出</div></div>
                    <div class="insight-stat"><div class="insight-stat-value" style="color:#1890ff">${balanceStr}</div><div class="insight-stat-label">结余</div></div>
                    <div class="insight-stat"><div class="insight-stat-value" style="color:#666">${s.txnCount}</div><div class="insight-stat-label">笔数</div></div>
                </div>
                ${trendHtml ? `<div style="margin-top:10px;font-size:13px;">${trendHtml} · 日均支出 <strong>¥${s.dailyAvg.toFixed(2)}</strong></div>` : ''}
            `
        };
    }

    function buildTopCategories(s) {
        const top3 = s.expenseCats.slice(0, 3);
        const items = top3.map(c => {
            const color = Storage.getCategoryColor(c.category);
            return `<div style="margin-bottom:6px;">
                <span class="legend-color" style="background:${color};display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;"></span>
                <strong>${c.category}</strong> · ${formatMoney(c.amount)} (${(c.percentage * 100).toFixed(1)}%)
                <div class="progress-bar" style="margin-top:3px;"><div class="progress-fill" style="width:${c.percentage * 100}%;background:${color};"></div></div>
            </div>`;
        }).join('');

        return {
            type: 'info',
            title: '🏷️ 支出结构',
            html: items
        };
    }

    function buildMoMComparison(s, prev) {
        const diff = s.expense - prev.expense;
        const pct = prev.expense > 0 ? (diff / prev.expense * 100) : 0;
        const isIncrease = diff > 0;
        const type = Math.abs(pct) > 20 ? 'danger' : (Math.abs(pct) > 10 ? 'warning' : 'success');

        // 对比各类别
        const catChanges = [];
        Object.keys(s.catMap).forEach(cat => {
            const prevAmt = prev.catMap[cat] || 0;
            const currAmt = s.catMap[cat];
            if (prevAmt === 0 && currAmt > 0) {
                catChanges.push({ cat, change: currAmt, pct: 100, isNew: true });
            } else if (prevAmt > 0) {
                const change = currAmt - prevAmt;
                const catPct = change / prevAmt * 100;
                if (Math.abs(catPct) > 15 && Math.abs(change) > 50) {
                    catChanges.push({ cat, change, pct: catPct, isNew: false });
                }
            }
        });
        catChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        const topChanges = catChanges.slice(0, 3);

        let catHtml = '';
        if (topChanges.length > 0) {
            catHtml = '<div style="margin-top:8px;font-size:13px;">类别变化：</div>' + topChanges.map(c => {
                const color = c.change > 0 ? '#ff4d4f' : '#52c41a';
                const arrow = c.change > 0 ? '↑' : '↓';
                if (c.isNew) {
                    return `<div style="font-size:12px;color:#666;">• ${c.cat}：新增支出 ${formatMoney(c.change)}</div>`;
                }
                return `<div style="font-size:12px;color:#666;">• ${c.cat}：${arrow} ${formatMoney(Math.abs(c.change))} (${Math.abs(c.pct).toFixed(0)}%)</div>`;
            }).join('');
        }

        return {
            type,
            title: isIncrease ? '📈 环比增长' : '📉 环比下降',
            html: `本月支出 ${formatMoney(s.expense)}，${isIncrease ? '比上月多花' : '比上月少花'} <strong style="color:${isIncrease ? '#ff4d4f' : '#52c41a'}">${formatMoney(Math.abs(diff))}</strong>（${isIncrease ? '+' : ''}${pct.toFixed(1)}%）${catHtml}`
        };
    }

    function buildTimePattern(entries) {
        const expenses = entries.filter(e => e.type === 'expense');
        if (expenses.length === 0) return { type: 'info', title: '🕐 消费时间', html: '暂无支出数据' };

        let weekend = 0, weekday = 0;
        expenses.forEach(e => {
            const d = new Date(e.date);
            const day = d.getDay();
            const amt = parseFloat(e.amount) || 0;
            if (day === 0 || day === 6) weekend += amt;
            else weekday += amt;
        });

        const total = weekend + weekday;
        const wkPct = total > 0 ? (weekend / total * 100) : 0;
        const wdPct = 100 - wkPct;

        // 找出花费最多的星期几
        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const dayMap = [0, 0, 0, 0, 0, 0, 0];
        expenses.forEach(e => {
            const d = new Date(e.date);
            dayMap[d.getDay()] += parseFloat(e.amount) || 0;
        });
        const maxDay = dayMap.indexOf(Math.max(...dayMap));

        let pattern = '';
        let type = 'info';
        if (wkPct > 55) {
            pattern = `消费集中在<strong>周末</strong>，周末支出占 <strong>${wkPct.toFixed(0)}%</strong>（${formatMoney(weekend)}），工作日占 ${wdPct.toFixed(0)}%（${formatMoney(weekday)}）`;
            type = 'warning';
        } else if (wkPct < 20 && total > 500) {
            pattern = `消费主要在工作日，占比 <strong>${wdPct.toFixed(0)}%</strong>，周末仅 ${wkPct.toFixed(0)}%`;
        } else {
            pattern = `周末支出 ${wkPct.toFixed(0)}%（${formatMoney(weekend)}），工作日 ${wdPct.toFixed(0)}%（${formatMoney(weekday)}），分布较为均匀`;
        }

        return {
            type,
            title: '🕐 消费时间规律',
            html: `${pattern}<br>花费最多的是 <strong>${dayNames[maxDay]}</strong>，支出 ${formatMoney(dayMap[maxDay])}`
        };
    }

    function detectAnomalies(entries, summary) {
        if (summary.expenseCount < 5 || summary.stdDev === 0) return [];

        const threshold = summary.mean + 2 * summary.stdDev;
        const anomalies = entries
            .filter(e => e.type === 'expense' && (parseFloat(e.amount) || 0) > threshold)
            .map(e => ({ ...e, amount: parseFloat(e.amount) }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 3);

        return anomalies;
    }

    function buildAnomalyAlert(anomalies) {
        const items = anomalies.map(a => {
            const note = a.note ? `（${a.note}）` : '';
            return `<div style="margin-top:4px;">• <strong>${a.category}</strong> ${formatMoney(a.amount)} · ${a.date}${note}</div>`;
        }).join('');

        return {
            type: 'danger',
            title: '⚠️ 异常支出预警',
            html: `以下支出明显高于你的日常水平：${items}`
        };
    }

    function buildSavingsRate(s) {
        const rate = (s.savingsRate * 100).toFixed(1);
        let type, msg;
        if (s.savingsRate >= 0.3) {
            type = 'success';
            msg = `储蓄率 <strong>${rate}%</strong>，非常健康！继续保持，财源滚滚 💰`;
        } else if (s.savingsRate >= 0.15) {
            type = 'success';
            msg = `储蓄率 <strong>${rate}%</strong>，属于合理范围，可以适当优化`;
        } else if (s.savingsRate >= 0) {
            type = 'warning';
            msg = `储蓄率仅 <strong>${rate}%</strong>，建议控制在15%以上，为未来存点底气`;
        } else {
            type = 'danger';
            msg = `本月入不敷出，超支 ${formatMoney(Math.abs(s.balance))}，需要控制开支了！`;
        }

        return {
            type,
            title: '🎯 储蓄评估',
            html: msg
        };
    }

    function generateTips(s, prev, entries) {
        const tips = [];

        // 餐饮占比过高
        const dining = s.catMap['餐饮'] || 0;
        if (dining > 0 && s.expense > 0 && dining / s.expense > 0.25) {
            tips.push(`餐饮支出 ${formatMoney(dining)} 占总支出 ${(dining / s.expense * 100).toFixed(0)}%，建议尝试带饭或减少外卖`);
        }

        // 购物频次高
        const shopping = entries.filter(e => e.type === 'expense' && e.category === '购物');
        if (shopping.length > 8) {
            tips.push(`本月购物 ${shopping.length} 次，频次较高，建议合并采购减少冲动消费`);
        }

        // 交通占比高
        const transport = s.catMap['交通'] || 0;
        if (transport > 0 && s.expense > 0 && transport / s.expense > 0.15) {
            tips.push(`交通支出 ${formatMoney(transport)}，可以考虑公共交通或拼车出行`);
        }

        // 连续环比增长
        if (prev.expense > 0 && s.expense > prev.expense * 1.2) {
            tips.push(`支出连续增长，建议设置月度预算目标，控制总开支`);
        }

        // 娱乐占比
        const entertainment = s.catMap['娱乐'] || 0;
        if (entertainment > 0 && s.expense > 0 && entertainment / s.expense > 0.2) {
            tips.push(`娱乐支出 ${formatMoney(entertainment)} 占比较高，劳逸结合也要注意预算`);
        }

        // 单笔大额
        if (s.avgPerTxn > 200 && s.expenseCount > 10) {
            tips.push(`单笔平均支出 ${formatMoney(s.avgPerTxn)}，可以关注大额消费是否必要`);
        }

        return tips.slice(0, 4);
    }

    function buildTips(tips) {
        const items = tips.map(t => `<div style="margin-top:4px;">💡 ${t}</div>`).join('');
        return {
            type: 'info',
            title: '✨ 天炮建议',
            html: items
        };
    }

    function formatMoney(amt) {
        return '¥' + (amt || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    return { generate, formatMoney };
})();
