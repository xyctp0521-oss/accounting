/**
 * charts.js - Canvas 图表绘制
 * 纯手写 Canvas 绘图，无外部依赖
 */
const Charts = (function () {

    function setupCanvas(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const attrW = parseInt(canvas.getAttribute('width')) || 300;
        const attrH = parseInt(canvas.getAttribute('height')) || 200;
        const aspect = attrH / attrW;
        const parentW = (canvas.parentElement.clientWidth || attrW) - 40;
        const dispW = Math.min(attrW, Math.max(180, parentW));
        const dispH = Math.round(dispW * aspect);
        canvas.style.width = dispW + 'px';
        canvas.style.height = dispH + 'px';
        canvas.width = dispW * dpr;
        canvas.height = dispH * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        return { ctx, w: dispW, h: dispH };
    }

    // ===== 饼图 =====
    function drawPie(canvas, data) {
        const { ctx, w, h } = setupCanvas(canvas);
        ctx.clearRect(0, 0, w, h);

        if (!data || data.length === 0) {
            drawEmpty(ctx, w, h, '暂无支出数据');
            return;
        }

        const total = data.reduce((s, d) => s + d.value, 0);
        if (total === 0) { drawEmpty(ctx, w, h, '暂无支出数据'); return; }

        const cx = w / 2, cy = h / 2;
        const radius = Math.min(w, h) / 2 - 20;
        let angle = -Math.PI / 2;

        // 绘制扇形
        data.forEach(item => {
            const slice = (item.value / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, angle, angle + slice);
            ctx.closePath();
            ctx.fillStyle = item.color;
            ctx.fill();
            // 描边
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 标注百分比
            const pct = (item.value / total * 100);
            if (pct >= 5) {
                const labelAngle = angle + slice / 2;
                const lx = cx + Math.cos(labelAngle) * (radius * 0.65);
                const ly = cy + Math.sin(labelAngle) * (radius * 0.65);
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 13px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(pct.toFixed(0) + '%', lx, ly);
            }

            angle += slice;
        });

        // 中心镂空（甜甜圈效果）
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        // 中心文字
        ctx.fillStyle = '#333';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('¥' + total.toFixed(0), cx, cy - 8);
        ctx.fillStyle = '#999';
        ctx.font = '12px sans-serif';
        ctx.fillText('总支出', cx, cy + 12);
    }

    // ===== 折线图 =====
    function drawLine(canvas, data, label) {
        const { ctx, w, h } = setupCanvas(canvas);
        ctx.clearRect(0, 0, w, h);

        if (!data || data.length === 0) {
            drawEmpty(ctx, w, h, '暂无数据');
            return;
        }

        const pad = { top: 20, right: 20, bottom: 30, left: 50 };
        const cw = w - pad.left - pad.right;
        const ch = h - pad.top - pad.bottom;

        const values = data.map(d => d.value);
        const maxVal = Math.max(...values, 1);
        const niceMax = niceCeil(maxVal);

        // Y轴网格 + 标签
        ctx.strokeStyle = '#f0f0f0';
        ctx.fillStyle = '#999';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const ySteps = 4;
        for (let i = 0; i <= ySteps; i++) {
            const y = pad.top + (ch / ySteps) * i;
            const val = niceMax - (niceMax / ySteps) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();
            ctx.fillText('¥' + val.toFixed(0), pad.left - 6, y);
        }

        // X轴标签
        const step = Math.max(1, Math.floor(data.length / 8));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        data.forEach((d, i) => {
            if (i % step === 0 || i === data.length - 1) {
                const x = pad.left + (cw / Math.max(1, data.length - 1)) * i;
                ctx.fillText(d.label, x, h - pad.bottom + 6);
            }
        });

        // 折线区域填充
        const points = data.map((d, i) => ({
            x: pad.left + (cw / Math.max(1, data.length - 1)) * i,
            y: pad.top + ch - (d.value / niceMax) * ch,
            value: d.value
        }));

        const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
        gradient.addColorStop(0, 'rgba(74,144,217,0.25)');
        gradient.addColorStop(1, 'rgba(74,144,217,0.02)');
        ctx.beginPath();
        ctx.moveTo(points[0].x, pad.top + ch);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, pad.top + ch);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // 折线
        ctx.beginPath();
        ctx.strokeStyle = '#4A90D9';
        ctx.lineWidth = 2;
        points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();

        // 数据点
        points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#4A90D9';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });
    }

    // ===== 柱状图 =====
    function drawBar(canvas, data) {
        const { ctx, w, h } = setupCanvas(canvas);
        ctx.clearRect(0, 0, w, h);

        if (!data || data.length === 0) {
            drawEmpty(ctx, w, h, '暂无数据');
            return;
        }

        const pad = { top: 20, right: 20, bottom: 30, left: 50 };
        const cw = w - pad.left - pad.right;
        const ch = h - pad.top - pad.bottom;

        const allVals = data.flatMap(d => [d.income, d.expense]);
        const maxVal = Math.max(...allVals, 1);
        const niceMax = niceCeil(maxVal);

        // Y轴
        ctx.strokeStyle = '#f0f0f0';
        ctx.fillStyle = '#999';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const ySteps = 4;
        for (let i = 0; i <= ySteps; i++) {
            const y = pad.top + (ch / ySteps) * i;
            const val = niceMax - (niceMax / ySteps) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();
            ctx.fillText('¥' + val.toFixed(0), pad.left - 6, y);
        }

        // 柱子
        const groupWidth = cw / data.length;
        const barWidth = Math.min(groupWidth * 0.3, 20);
        const gap = 4;

        data.forEach((d, i) => {
            const cx = pad.left + groupWidth * i + groupWidth / 2;

            // 收入柱
            const incH = (d.income / niceMax) * ch;
            ctx.fillStyle = '#52c41a';
            ctx.fillRect(cx - barWidth - gap / 2, pad.top + ch - incH, barWidth, incH);

            // 支出柱
            const expH = (d.expense / niceMax) * ch;
            ctx.fillStyle = '#ff4d4f';
            ctx.fillRect(cx + gap / 2, pad.top + ch - expH, barWidth, expH);

            // 月份标签
            ctx.fillStyle = '#666';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.font = '11px sans-serif';
            ctx.fillText(d.label, cx, h - pad.bottom + 6);
        });

        // 图例
        ctx.fillStyle = '#52c41a';
        ctx.fillRect(pad.left, 4, 12, 12);
        ctx.fillStyle = '#333';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '12px sans-serif';
        ctx.fillText('收入', pad.left + 16, 10);
        ctx.fillStyle = '#ff4d4f';
        ctx.fillRect(pad.left + 60, 4, 12, 12);
        ctx.fillStyle = '#333';
        ctx.fillText('支出', pad.left + 76, 10);
    }

    function drawEmpty(ctx, w, h, msg) {
        ctx.fillStyle = '#ccc';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(msg, w / 2, h / 2);
    }

    function niceCeil(val) {
        if (val <= 0) return 100;
        const exp = Math.floor(Math.log10(val));
        const f = val / Math.pow(10, exp);
        let nf;
        if (f <= 1) nf = 1;
        else if (f <= 2) nf = 2;
        else if (f <= 5) nf = 5;
        else nf = 10;
        return nf * Math.pow(10, exp);
    }

    return { drawPie, drawLine, drawBar };
})();
