/**
 * app.js - 主控制器
 * 负责渲染、事件绑定、协调各模块
 */
const App = (function () {
    let currentDate = new Date();
    let selectedType = 'expense';
    let sortBy = 'date';
    let sortDir = 'desc';

    async function init() {
        // 默认日期设为今天
        document.getElementById('entryDate').value = todayStr();
        // 初始化分类下拉
        updateCategoryOptions();
        // 绑定事件
        bindEvents();
        // 先用本地数据渲染（快速显示）
        render();
        // 如果配置了云端，从云端同步
        if (Storage.CloudSync.isConfigured()) {
            updateSyncStatus('syncing');
            try {
                const result = await Storage.syncFromCloud();
                if (result.ok) {
                    updateSyncStatus('synced', result.count);
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
        // 月份导航
        document.getElementById('prevMonth').addEventListener('click', () => {
            currentDate.setMonth(currentDate.getMonth() - 1);
            render();
        });
        document.getElementById('nextMonth').addEventListener('click', () => {
            currentDate.setMonth(currentDate.getMonth() + 1);
            render();
        });

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
        document.getElementById('filterCategory').addEventListener('change', renderTable);
        document.getElementById('filterUser').addEventListener('change', () => render());

        // 导出
        document.getElementById('exportBtn').addEventListener('click', exportCSV);
    }

    function updateCategoryOptions() {
        const sel = document.getElementById('entryCategory');
        sel.innerHTML = '';
        Storage.CATEGORIES[selectedType].forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            sel.appendChild(opt);
        });
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

        renderSummary(y, m);
        renderTable();
        renderFilterCategories(y, m);
        renderCharts(y, m);
        renderAnalysis(y, m);
    }

    function renderSummary(y, m) {
        const userFilter = document.getElementById('filterUser').value;
        let entries = Storage.getEntriesByMonth(y, m);
        if (userFilter !== 'all') {
            entries = entries.filter(e => e.user === userFilter);
        }
        const income = entries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
        const expense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
        const balance = income - expense;
        document.getElementById('totalIncome').textContent = '¥' + income.toFixed(2);
        document.getElementById('totalExpense').textContent = '¥' + expense.toFixed(2);
        document.getElementById('totalBalance').textContent = '¥' + balance.toFixed(2);
        const rate = income > 0 ? ((balance / income) * 100).toFixed(0) : '0';
        document.getElementById('savingsRate').textContent = rate + '%';
    }

    function renderTable() {
        const y = currentDate.getFullYear();
        const m = currentDate.getMonth();
        let entries = Storage.getEntriesByMonth(y, m);

        // 筛选
        const ft = document.getElementById('filterType').value;
        const fc = document.getElementById('filterCategory').value;
        const fu = document.getElementById('filterUser').value;
        if (ft !== 'all') entries = entries.filter(e => e.type === ft);
        if (fc !== 'all') entries = entries.filter(e => e.category === fc);
        if (fu !== 'all') entries = entries.filter(e => e.user === fu);

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
                <td>${e.category}</td>
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

    function renderFilterCategories(y, m) {
        const entries = Storage.getEntriesByMonth(y, m);
        const cats = [...new Set(entries.map(e => e.category))];
        const sel = document.getElementById('filterCategory');
        const current = sel.value;
        sel.innerHTML = '<option value="all">全部分类</option>';
        cats.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            sel.appendChild(opt);
        });
        sel.value = current;
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
        const s = Storage.getMonthlySummary(y, m);
        const data = s.expense > 0 ? Object.entries(s.byCategory)
            .map(([cat, amt]) => ({ label: cat, value: amt, color: Storage.getCategoryColor(cat) }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8) : [];

        Charts.drawPie(document.getElementById('pieChart'), data);

        // 图例
        const legend = document.getElementById('pieLegend');
        legend.innerHTML = '';
        data.forEach(d => {
            const total = data.reduce((s, x) => s + x.value, 0);
            const pct = (d.value / total * 100).toFixed(1);
            const item = document.createElement('div');
            item.className = 'legend-item';
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
        refresh: render
    };
})();

// 确保 inline onclick 可访问
window.App = App;

// 启动
document.addEventListener('DOMContentLoaded', App.init);
