/**
 * app.js - 主控制器
 * 负责渲染、事件绑定、协调各模块
 */
const App = (function () {
    let currentDate = new Date();
    let selectedType = 'expense';
    let sortBy = 'date';
    let sortDir = 'desc';
    let mainOtherCats = [];   // 主界面饼图被合并进「其他」的分类（大类模式下不再使用）
    let pieLevel = 'group';       // 'group' 大类层 / 'sub' 小类层
    let pieActiveGroup = null;    // 下钻中的大类

    async function init() {
        // 默认日期设为今天
        document.getElementById('entryDate').value = todayStr();
        // 初始化分类下拉
        updateCategoryOptions();
        // 绑定事件
        bindEvents();
        // 数据迁移：旧「娱乐/篮球」记录归入「运动」分类（本地幂等）
        try { Storage.migrateSportCategories(); } catch (e) { console.warn('分类迁移失败:', e); }
        // 扩展功能（固定支出 / 储值卡）
        try { Extras.init(); } catch (e) { console.warn('扩展功能初始化失败:', e); }
        // 先用本地数据渲染（快速显示）
        render();
        // 同步元数据（固定支出模板 / 储值卡）
        Storage.syncMeta().then(() => {
            try { render(); } catch (e) { /* ignore */ }
        }).catch(() => {});
        // 如果配置了云端，从云端同步
        if (Storage.CloudSync.isConfigured()) {
            updateSyncStatus('syncing');
            try {
                const result = await Storage.syncFromCloud();
                if (result.ok) {
                    updateSyncStatus('synced', result.count);
                    // 云端合并后再次迁移（处理云端旧记录），改动会自动 push 回云端
                    try { Storage.migrateSportCategories(); } catch (e) { console.warn('分类迁移失败:', e); }
                    render();
                } else {
                    updateSyncStatus('offline');
                }
            } catch (e) {
                console.warn('云端同步失败:', e.message);
                updateSyncStatus('offline');
            }
        } else {
            updateSyncStatus('local');
        }
    }

    function updateSyncStatus(status, count) {
        const el = document.getElementById('syncStatus');
        if (!el) return;
        const map = {
            'synced': { icon: '✓', text: '已同步', cls: 'sync-ok' },
            'syncing': { icon: '⟳', text: '同步中', cls: 'sync-busy' },
            'offline': { icon: '⚠', text: '离线', cls: 'sync-warn' },
            'local': { icon: '○', text: '本地', cls: 'sync-local' },
            'not_configured': { icon: '○', text: '本地', cls: 'sync-local' }
        };
        const s = map[status] || map['local'];
        el.className = 'sync-status ' + s.cls;
        el.innerHTML = `<span class="sync-icon">${s.icon}</span> ${s.text}` + (count != null ? ` (${count})` : '');
    }

    function todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function bindEvents() {
        // 月份导航（切换月份时清空搜索）
        document.getElementById('prevMonth').addEventListener('click', () => {
            clearSearch();
            currentDate.setMonth(currentDate.getMonth() - 1);
            render();
        });
        document.getElementById('nextMonth').addEventListener('click', () => {
            clearSearch();
            currentDate.setMonth(currentDate.getMonth() + 1);
            render();
        });

        // 全局搜索
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', () => render());
            const clearBtn = document.getElementById('clearSearch');
            if (clearBtn) clearBtn.addEventListener('click', () => { clearSearch(); render(); });
        }

        // 类型切换
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedType = btn.dataset.type;
                updateCategoryOptions();
            });
        });

        // 表单提交
        document.getElementById('entryForm').addEventListener('submit', handleSubmit);

        // 取消编辑
        document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);

        // 表格排序
        document.querySelectorAll('.data-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (sortBy === field) {
                    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    sortBy = field;
                    sortDir = 'desc';
                }
                updateSortIndicators();
                renderTable();
            });
        });

        // 筛选
        document.getElementById('filterType').addEventListener('change', renderTable);
        document.getElementById('filterCategory').addEventListener('change', render);
        document.getElementById('filterUser').addEventListener('change', () => render());

        // 导出
        document.getElementById('exportBtn').addEventListener('click', exportCSV);

        // 点击饼图 / 图例 → 大类层下钻到小类，小类层弹出 Top10
        const pie = document.getElementById('pieChart');
        if (pie) {
            pie.style.cursor = 'pointer';
            pie.addEventListener('click', ev => {
                const rect = pie.getBoundingClientRect();
                const cat = Charts.pieHitTest(pie, ev.clientX - rect.left, ev.clientY - rect.top);
                if (cat) onPieSelect(cat);
            });
        }
        const legend = document.getElementById('pieLegend');
        if (legend) {
            legend.style.cursor = 'pointer';
            legend.addEventListener('click', ev => {
                if (ev.target.closest('.legend-back')) { exitPieDrill(); return; }
                const item = ev.target.closest('.legend-item');
                if (item && item.dataset.cat) onPieSelect(item.dataset.cat);
            });
        }
    }

    // 大类 -> 其下所有小类（含数据里出现过的历史分类）
    function catsOfGroup(group) {
        const tree = Storage.CATEGORY_TREE.expense || [];
        const grp = tree.find(x => x.name === group);
        const subs = grp ? grp.subs.slice() : [group];
        Storage.getAll().forEach(e => {
            if (Storage.getGroup(e.category) === group && subs.indexOf(e.category) < 0) subs.push(e.category);
        });
        return subs;
    }

    // 饼图/图例点击：大类层下钻，小类层弹 Top10
    function onPieSelect(label) {
        if (pieLevel === 'sub') {
            showCategoryTop(label, false);
            return;
        }
        const subs = catsOfGroup(label).filter(c => {
            const g = Storage.getGroup(c);
            return g === label;
        });
        if (subs.length > 1) {
            pieActiveGroup = label;
            pieLevel = 'sub';
            renderPieChart(currentDate.getFullYear(), currentDate.getMonth());
        } else {
            showCategoryTop(label, true);
        }
    }

    function exitPieDrill() {
        pieLevel = 'group';
        pieActiveGroup = null;
        renderPieChart(currentDate.getFullYear(), currentDate.getMonth());
    }

    // 当前月的某分类（或某大类）支出 Top10
    function showCategoryTop(cat, isGroup) {
        if (typeof Extras === 'undefined' || !Extras.showCategoryTop) return;
        const y = currentDate.getFullYear(), m = currentDate.getMonth();
        const entries = Storage.getEntriesByMonth(y, m);
        let cats = cat;
        if (isGroup) cats = catsOfGroup(cat);
        else if (cat === '其他') cats = mainOtherCats.length ? mainOtherCats : ['其他'];
        Extras.showCategoryTop(cats, entries, y + '年' + (m + 1) + '月', isGroup ? cat : null);
    }

    // ===== 搜索 =====
    function rawKeyword() {
        const el = document.getElementById('searchInput');
        return el ? (el.value || '').trim() : '';
    }

    function searchKeyword() {
        return rawKeyword().toLowerCase();
    }

    function clearSearch() {
        const el = document.getElementById('searchInput');
        if (el) el.value = '';
    }

    // 表格里的分类：小类为主，前面带淡色大类
    function categoryCell(cat) {
        const g = Storage.getGroup(cat);
        if (!g || g === cat) return escapeHtml(cat || '');
        return '<span class="cat-group">' + escapeHtml(g) + '</span>' + escapeHtml(cat);
    }

    function matchEntry(e, kw) {
        const hay = [e.date, e.category, Storage.getGroup(e.category), e.user, e.note,
            String(e.amount), e.type === 'income' ? '收入' : '支出']
            .join(' ').toLowerCase();
        return hay.indexOf(kw) >= 0;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // 当前应展示的记录集：搜索态 = 全部记录中匹配项，否则 = 当月
    function currentEntries() {
        const kw = searchKeyword();
        let entries = kw
            ? Storage.getAll().filter(e => matchEntry(e, kw))
            : Storage.getEntriesByMonth(currentDate.getFullYear(), currentDate.getMonth());

        const ft = document.getElementById('filterType').value;
        const fc = document.getElementById('filterCategory').value;
        const fu = document.getElementById('filterUser').value;
        if (ft !== 'all') entries = entries.filter(e => e.type === ft);
        if (fc !== 'all') {
            if (fc.indexOf('g:') === 0) {
                const g = fc.slice(2);
                entries = entries.filter(e => Storage.getGroup(e.category) === g);
            } else {
                entries = entries.filter(e => e.category === fc);
            }
        }
        if (fu !== 'all') entries = entries.filter(e => e.user === fu);
        return entries;
    }

    function renderSearchInfo(entries) {
        const info = document.getElementById('searchInfo');
        const clearBtn = document.getElementById('clearSearch');
        if (!info) return;
        const kw = rawKeyword();
        if (!kw) {
            info.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'none';
            return;
        }
        if (clearBtn) clearBtn.style.display = '';
        const expense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
        const income = entries.filter(e => e.type === 'income').reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
        info.style.display = '';
        info.innerHTML = '搜索「<strong>' + escapeHtml(kw) + '</strong>」· 全部记录中匹配 <strong>' + entries.length +
            '</strong> 笔 · 支出 ¥' + expense.toFixed(2) + ' · 收入 ¥' + income.toFixed(2);
    }

    function updateSummaryLabels(isSearch) {
        const labels = document.querySelectorAll('.summary-cards .card-label');
        const texts = isSearch
            ? ['搜索结果收入', '搜索结果支出', '搜索结果结余', '储蓄率']
            : ['本月收入', '本月支出', '本月结余', '储蓄率'];
        labels.forEach((el, i) => { if (texts[i]) el.textContent = texts[i]; });
    }

    // 分类下拉按大类分组（optgroup）；收入只有一个组时不分组展示
    function updateCategoryOptions() {
        const sel = document.getElementById('entryCategory');
        sel.innerHTML = '';
        const groups = Storage.CATEGORY_TREE[selectedType] || [];
        const onlyOne = groups.length === 1;
        groups.forEach(g => {
            let parent = sel;
            if (!onlyOne) {
                const og = document.createElement('optgroup');
                og.label = g.name;
                sel.appendChild(og);
                parent = og;
            }
            g.subs.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = onlyOne ? cat : cat;
                parent.appendChild(opt);
            });
        });
        // 兜底：数据里存在但不在分类表里的旧分类，补在最后避免编辑时丢失
        const known = {};
        groups.forEach(g => g.subs.forEach(s => { known[s] = 1; }));
        const extra = [...new Set(Storage.getAll().map(e => e.category).filter(c => c && !known[c]))];
        if (extra.length) {
            const og = document.createElement('optgroup');
            og.label = '历史分类';
            sel.appendChild(og);
            extra.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat; opt.textContent = cat;
                og.appendChild(opt);
            });
        }
    }

    function handleSubmit(e) {
        e.preventDefault();
        const editId = document.getElementById('editId').value;
        const entry = {
            date: document.getElementById('entryDate').value,
            type: selectedType,
            category: document.getElementById('entryCategory').value,
            user: document.getElementById('entryUser').value,
            amount: parseFloat(document.getElementById('entryAmount').value),
            note: document.getElementById('entryNote').value
        };

        if (!entry.date || !entry.category || isNaN(entry.amount) || entry.amount <= 0) {
            alert('请填写完整信息');
            return;
        }

        if (editId) {
            Storage.update(editId, entry);
            cancelEdit();
        } else {
            Storage.add(entry);
            // 清空表单（保留用户默认值）
            document.getElementById('entryAmount').value = '';
            document.getElementById('entryNote').value = '';
        }

        render();
    }

    function startEdit(id) {
        const entry = Storage.getAll().find(e => e.id === id);
        if (!entry) return;

        document.getElementById('editId').value = entry.id;
        document.getElementById('entryDate').value = entry.date;
        document.getElementById('entryAmount').value = entry.amount;
        document.getElementById('entryNote').value = entry.note || '';
        document.getElementById('entryUser').value = entry.user || '小羊';
        if (entry.user === '小陈') document.getElementById('entryUser').value = '南瓜';

        // 切换类型
        selectedType = entry.type;
        document.querySelectorAll('.type-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.type === entry.type);
        });
        updateCategoryOptions();
        document.getElementById('entryCategory').value = entry.category;

        // 切换按钮
        document.getElementById('submitBtn').textContent = '保存修改';
        document.getElementById('cancelEditBtn').style.display = '';
        document.querySelector('.form-panel').scrollIntoView({ behavior: 'smooth' });
    }

    function cancelEdit() {
        document.getElementById('editId').value = '';
        document.getElementById('submitBtn').textContent = '添加记录';
        document.getElementById('cancelEditBtn').style.display = 'none';
        document.getElementById('entryAmount').value = '';
        document.getElementById('entryNote').value = '';
        document.getElementById('entryUser').value = '小羊';
    }

    function deleteEntry(id) {
        if (confirm('删除这条记录？')) {
            Storage.remove(id);
            render();
        }
    }

    // ===== 渲染 =====
    function render() {
        const y = currentDate.getFullYear();
        const m = currentDate.getMonth();

        // 月份显示
        document.getElementById('currentMonth').textContent = `${y}年${String(m + 1).padStart(2, '0')}月`;

        renderSummary();
        renderTable();
        renderFilterCategories(y, m);
        renderCharts(y, m);
        renderAnalysis(y, m);
        // 固定支出待记账提示（仅非搜索态）
        try {
            if (typeof Extras !== 'undefined' && !searchKeyword()) Extras.renderTodoBar(y, m);
        } catch (e) { console.warn('固定支出提示渲染失败:', e); }
    }

    function renderSummary() {
        const isSearch = !!searchKeyword();
        updateSummaryLabels(isSearch);
        const entries = currentEntries();
        const income = entries.filter(e => e.type === 'income').reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
        const expense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
        const balance = income - expense;
        document.getElementById('totalIncome').textContent = '¥' + income.toFixed(2);
        document.getElementById('totalExpense').textContent = '¥' + expense.toFixed(2);
        document.getElementById('totalBalance').textContent = '¥' + balance.toFixed(2);
        const rate = income > 0 ? ((balance / income) * 100).toFixed(0) : '0';
        document.getElementById('savingsRate').textContent = rate + '%';
    }

    function renderTable() {
        const entries = currentEntries();
        renderSearchInfo(entries);

        // 排序
        entries.sort((a, b) => {
            let av, bv;
            switch (sortBy) {
                case 'date': av = a.date; bv = b.date; break;
                case 'category': av = a.category; bv = b.category; break;
                case 'amount': av = parseFloat(a.amount); bv = parseFloat(b.amount); break;
                default: av = a.date; bv = b.date;
            }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        const tbody = document.getElementById('entryTableBody');
        const emptyState = document.getElementById('emptyState');
        tbody.innerHTML = '';

        if (entries.length === 0) {
            emptyState.style.display = '';
            return;
        }
        emptyState.style.display = 'none';

        entries.forEach(e => {
            const tr = document.createElement('tr');
            const typeTag = e.type === 'income'
                ? `<span class="tag tag-income">收入</span>`
                : `<span class="tag tag-expense">支出</span>`;
            const amountClass = e.type === 'income' ? 'amount-income' : 'amount-expense';
            const amountStr = (e.type === 'income' ? '+' : '-') + '¥' + parseFloat(e.amount).toFixed(2);
            const userClass = e.user === '共同' ? 'user-both' : (e.user === '南瓜' ? 'user-nangua' : 'user-xiaoyang');
            const userTag = `<span class="user-tag ${userClass}">${e.user || '小羊'}</span>`;
            tr.innerHTML = `
                <td>${e.date}</td>
                <td>${typeTag}</td>
                <td>${categoryCell(e.category)}</td>
                <td>${userTag}</td>
                <td class="${amountClass}">${amountStr}</td>
                <td style="color:#999;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.note || '-'}</td>
                <td class="row-actions">
                    <button onclick="App.startEdit('${e.id}')" title="编辑">✏️</button>
                    <button onclick="App.deleteEntry('${e.id}')" title="删除">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // 筛选下拉：按大类分组，只列出当前范围内实际用到的分类
    function renderFilterCategories(y, m) {
        const kw = rawKeyword();
        const scope = kw ? Storage.getAll() : Storage.getEntriesByMonth(y, m);
        const used = {};
        scope.forEach(e => { if (e.category) used[e.category] = (used[e.category] || 0) + 1; });

        const sel = document.getElementById('filterCategory');
        const current = sel.value;
        sel.innerHTML = '<option value="all">全部分类</option>';

        const tree = Storage.CATEGORY_TREE.expense || [];
        const known = {};
        tree.forEach(g => g.subs.forEach(s => { known[s] = 1; }));

        tree.forEach(g => {
            const subs = g.subs.filter(s => used[s]);
            if (!subs.length) return;
            const og = document.createElement('optgroup');
            og.label = g.name;
            if (subs.length > 1) {
                const allOpt = document.createElement('option');
                allOpt.value = 'g:' + g.name;
                allOpt.textContent = g.name + '（全部）';
                og.appendChild(allOpt);
            }
            subs.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                og.appendChild(opt);
            });
            sel.appendChild(og);
        });

        const extra = Object.keys(used).filter(c => c && !known[c]);
        if (extra.length) {
            const og = document.createElement('optgroup');
            og.label = '其他';
            extra.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                og.appendChild(opt);
            });
            sel.appendChild(og);
        }

        sel.value = current;
        if (sel.selectedIndex < 0) sel.value = 'all';
    }

    function updateSortIndicators() {
        document.querySelectorAll('.data-table th.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === sortBy) {
                th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    function renderCharts(y, m) {
        renderPieChart(y, m);
        renderLineChart(y, m);
        renderBarChart(y, m);
    }

    function renderPieChart(y, m) {
        const entries = Storage.getEntriesByMonth(y, m).filter(e => e.type === 'expense');
        const legend = document.getElementById('pieLegend');
        legend.innerHTML = '';
        let data = [];

        if (pieLevel === 'sub' && pieActiveGroup) {
            // 小类层：该大类下各小类，颜色取大类同色系深浅
            const sums = {};
            entries.forEach(e => {
                if (Storage.getGroup(e.category) !== pieActiveGroup) return;
                sums[e.category] = (sums[e.category] || 0) + (parseFloat(e.amount) || 0);
            });
            const rows = Object.entries(sums)
                .map(([cat, amt]) => ({ label: cat, value: amt }))
                .sort((a, b) => b.value - a.value);
            const base = Storage.getGroupColor(pieActiveGroup);
            data = rows.map((d, i) => ({ label: d.label, value: d.value, color: Storage.shadeColor(base, i, Math.max(rows.length, 2)) }));
        } else {
            // 大类层：按所属大类聚合
            const sums = {};
            entries.forEach(e => {
                const g = Storage.getGroup(e.category);
                sums[g] = (sums[g] || 0) + (parseFloat(e.amount) || 0);
            });
            data = Object.entries(sums)
                .map(([g, amt]) => ({ label: g, value: amt, color: Storage.getGroupColor(g) }))
                .sort((a, b) => b.value - a.value);
        }

        Charts.drawPie(document.getElementById('pieChart'), data);

        const total = data.reduce((s, x) => s + x.value, 0);
        if (pieLevel === 'sub' && pieActiveGroup) {
            const back = document.createElement('div');
            back.className = 'legend-back';
            back.textContent = '← 返回「' + pieActiveGroup + '」上级';
            legend.appendChild(back);
        }
        data.forEach(d => {
            const pct = total > 0 ? (d.value / total * 100).toFixed(1) : '0.0';
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.dataset.cat = d.label;
            item.innerHTML = `
                <span class="legend-color" style="background:${d.color}"></span>
                <span class="legend-label">${d.label}</span>
                <span class="legend-value">¥${d.value.toFixed(0)} (${pct}%)</span>
            `;
            legend.appendChild(item);
        });
    }

    function renderLineChart(y, m) {
        const s = Storage.getMonthlySummary(y, m);
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const data = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dayStr = String(d).padStart(2, '0');
            data.push({
                label: d % 5 === 0 || d === 1 ? dayStr : '',
                value: s.byDay[dayStr] || 0
            });
        }
        Charts.drawLine(document.getElementById('lineChart'), data, '每日支出');
    }

    function renderBarChart(y, m) {
        const data = [];
        for (let i = 5; i >= 0; i--) {
            const dt = new Date(y, m - i, 1);
            const yy = dt.getFullYear();
            const mm = dt.getMonth();
            const s = Storage.getMonthlySummary(yy, mm);
            data.push({
                label: `${String(mm + 1).padStart(2, '0')}月`,
                income: s.income,
                expense: s.expense
            });
        }
        Charts.drawBar(document.getElementById('barChart'), data);
    }

    function renderAnalysis(y, m) {
        const insights = Analysis.generate(y, m);
        const container = document.getElementById('analysisContent');

        if (insights.length === 0) {
            container.innerHTML = '<div class="analysis-placeholder">添加记录后，这里会自动生成消费洞察 📊</div>';
            return;
        }

        container.innerHTML = insights.map(insight => {
            const cls = insight.type && insight.type !== 'info' ? `insight-${insight.type}` : '';
            return `<div class="insight-card ${cls}">
                <div class="insight-title">${insight.title}</div>
                <div class="insight-detail">${insight.html}</div>
            </div>`;
        }).join('');
    }

    function jumpTo(y, m) {
        if (!y || !m) return;
        currentDate = new Date(y, m - 1, 1);
        render();
    }

    function exportCSV() {
        const entries = Storage.getAll();
        if (entries.length === 0) {
            alert('没有数据可导出');
            return;
        }
        // BOM for Excel UTF-8
        const BOM = '\uFEFF';
        const header = '日期,类型,分类,金额,备注\n';
        const rows = entries.map(e => {
            return `${e.date},${e.type === 'income' ? '收入' : '支出'},${e.category},${e.amount},${e.note || ''}`;
        }).join('\n');
        const csv = BOM + header + rows;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `小羊记账_${todayStr()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return {
        init,
        startEdit,
        deleteEntry,
        updateSyncStatus,
        jumpTo,
        refresh: render
    };
})();

// 确保 inline onclick 可访问
window.App = App;

// 启动
document.addEventListener('DOMContentLoaded', App.init);
