// 投資デビュー診断 - メインロジック
'use strict';

// ------- 共通ユーティリティ -------
const yen = (n) => Math.round(n).toLocaleString('ja-JP') + '円';
const manEn = (n) => {
  if (n >= 10000) return Math.round(n / 10000).toLocaleString('ja-JP') + '万円';
  return Math.round(n).toLocaleString('ja-JP') + '円';
};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = (id) => document.getElementById(id);

// IME変換確定のEnterで誤って送信しないためのガード
function onEnterCommit(input, fn) {
  let composing = false;
  input.addEventListener('compositionstart', () => (composing = true));
  input.addEventListener('compositionend', () => (composing = false));
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (composing || e.isComposing) return;
    e.preventDefault();
    fn();
  });
}

// ------- STEP1: 無料診断 -------
let investable = 0;

function diagnose() {
  const income = Number($('income').value) || 0;
  const fixed = Number($('fixed').value) || 0;
  const other = Number($('other').value) || 0;

  investable = Math.max(0, income - fixed - other);

  $('bd-income').textContent = yen(income);
  $('bd-fixed').textContent = yen(fixed);
  $('bd-other').textContent = yen(other);
  $('result-amount').textContent = Math.round(investable).toLocaleString('ja-JP');
  $('result-comment').textContent = commentFor(investable, income, fixed, other);

  $('screen-input').hidden = true;
  $('screen-result').hidden = false;
  $('sim-monthly').value = Math.max(1000, Math.round(investable / 1000) * 1000);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function commentFor(x, income) {
  if (income === 0) {
    return 'まずは月収を入力してみましょう。';
  }
  if (x <= 0) {
    return '現時点では投資に回せる余裕がないようです。まずは固定費や支出の見直しから始めてみましょう。';
  }
  if (x < 5000) {
    return `${Math.round(x).toLocaleString('ja-JP')}円なら、月1,000円などの少額からNISA積立を始められます。まずは慣れることを目標に。`;
  }
  if (x < 15000) {
    return `${Math.round(x).toLocaleString('ja-JP')}円なら、無理のない範囲でコツコツ積み立てるのにちょうど良い金額です。`;
  }
  if (x < 30000) {
    return `${Math.round(x).toLocaleString('ja-JP')}円は、しっかり投資に回せる余裕額です。分散投資でリスクを抑えながら資産形成を目指せます。`;
  }
  return `${Math.round(x).toLocaleString('ja-JP')}円はかなり余裕があります。NISAの非課税枠を活用して積極的に資産形成できます。`;
}

$('btn-diagnose').addEventListener('click', diagnose);
['income', 'fixed', 'other'].forEach((id) => onEnterCommit($(id), diagnose));

$('btn-back-input').addEventListener('click', () => {
  $('screen-result').hidden = true;
  $('screen-input').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ------- 課金導線(ダミー) -------
const modal = $('paywall-modal');

$('btn-open-paywall').addEventListener('click', () => { modal.hidden = false; });
$('btn-close-modal').addEventListener('click', () => { modal.hidden = true; });
modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

$('btn-fake-pay').addEventListener('click', () => {
  modal.hidden = true;
  $('screen-result').hidden = true;
  $('screen-premium').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('btn-back-result').addEventListener('click', () => {
  $('screen-premium').hidden = true;
  $('screen-result').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ------- STEP3a: リスク許容度 → 資産配分 -------
const ALLOCATIONS = {
  stable: { stock: 30, bond: 70, label: '安定重視', comment: '値動きの小さい配分です。債券の比率を高め、下落局面でも資産が大きく減りにくいようにしています。まずは値動きに慣れたい方向けです。' },
  balance: { stock: 50, bond: 50, label: 'バランス', comment: '株式と債券を半分ずつ持つ標準的な配分です。リターンとリスクのバランスを取りたい方に向いています。' },
  active: { stock: 80, bond: 20, label: '積極的', comment: '株式の比率を高めた、リターン重視の配分です。値動きは大きくなりますが、長期で大きく増やしたい方向けです。' },
};

document.querySelectorAll('.risk-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.risk-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    renderAllocation(ALLOCATIONS[btn.dataset.risk]);
  });
});

function renderAllocation(a) {
  const bar = $('alloc-bar');
  const legend = $('alloc-legend');
  const comment = $('alloc-comment');

  bar.innerHTML = `
    <div class="seg" style="width:${a.stock}%; background:${cssVar('--alloc-stock')};">${a.stock}%</div>
    <div class="seg" style="width:${a.bond}%; background:${cssVar('--alloc-bond')};">${a.bond}%</div>
  `;
  legend.innerHTML = `
    <div class="item"><span class="swatch" style="background:${cssVar('--alloc-stock')}"></span>株式 ${a.stock}%</div>
    <div class="item"><span class="swatch" style="background:${cssVar('--alloc-bond')}"></span>債券 ${a.bond}%</div>
  `;
  comment.textContent = `【${a.label}タイプ】${a.comment}`;

  bar.hidden = false;
  legend.hidden = false;
  comment.hidden = false;
}

// ------- STEP3b: NISA積立シミュレーション -------
const RATES = [0.03, 0.05, 0.07];
const YEARS = 20;

function futureValueSeries(monthly, annualRate, years) {
  const i = annualRate / 12;
  const series = [];
  for (let y = 0; y <= years; y++) {
    const months = y * 12;
    const fv = i === 0 ? monthly * months : monthly * (((1 + i) ** months - 1) / i);
    series.push(fv);
  }
  return series;
}

function principalSeries(monthly, years) {
  const series = [];
  for (let y = 0; y <= years; y++) series.push(monthly * y * 12);
  return series;
}

let chart = null;

function buildChart(monthly) {
  const labels = Array.from({ length: YEARS + 1 }, (_, y) => `${y}年`);
  const series3 = futureValueSeries(monthly, RATES[0], YEARS);
  const series5 = futureValueSeries(monthly, RATES[1], YEARS);
  const series7 = futureValueSeries(monthly, RATES[2], YEARS);
  const principal = principalSeries(monthly, YEARS);

  const gridColor = cssVar('--grid');
  const mutedColor = cssVar('--text-muted');
  const cardColor = cssVar('--card');
  const borderColor = cssVar('--border');
  const textPrimary = cssVar('--text-primary');
  const textSecondary = cssVar('--text-secondary');

  const datasets = [
    { label: '元本', data: principal, borderColor: cssVar('--series-principal'), borderDash: [4, 3], borderWidth: 2, pointRadius: 0, tension: 0 },
    { label: '年3%', data: series3, borderColor: cssVar('--series-3'), borderWidth: 2, pointRadius: 0, tension: 0.15 },
    { label: '年5%', data: series5, borderColor: cssVar('--series-5'), borderWidth: 2, pointRadius: 0, tension: 0.15 },
    { label: '年7%', data: series7, borderColor: cssVar('--series-7'), borderWidth: 2, pointRadius: 0, tension: 0.15 },
  ];

  if (chart) chart.destroy();
  chart = new Chart($('sim-chart').getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cardColor,
          titleColor: textPrimary,
          bodyColor: textSecondary,
          borderColor: borderColor,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${yen(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor, display: false },
          ticks: { color: mutedColor, maxTicksLimit: 6, autoSkip: true, font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          border: { display: false },
          ticks: { color: mutedColor, font: { size: 11 }, callback: (v) => manEn(v) },
        },
      },
    },
  });

  // 凡例(直接ラベル: 20年後の資産額を併記)
  const legendHtml = [
    { key: '元本', color: cssVar('--series-principal'), dashed: true, val: principal[YEARS] },
    { key: '年3%', color: cssVar('--series-3'), val: series3[YEARS] },
    { key: '年5%', color: cssVar('--series-5'), val: series5[YEARS] },
    { key: '年7%', color: cssVar('--series-7'), val: series7[YEARS] },
  ].map((s) => `
    <div class="item">
      <span class="swatch${s.dashed ? ' dashed' : ''}" style="${s.dashed ? '' : `background:${s.color}`}"></span>
      ${s.key} <span class="val">${manEn(s.val)}</span>
    </div>
  `).join('');
  $('chart-legend').innerHTML = legendHtml;

  // サマリー数値
  $('fv-10').textContent = manEn(series5[10]);
  $('fv-20').textContent = manEn(series5[20]);
  $('fv-principal').textContent = manEn(principal[20]);

  renderTable(principal, series3, series5, series7);
}

function renderTable(principal, series3, series5, series7) {
  const rows = [0, 5, 10, 15, 20];
  const trs = rows.map((y) => `
    <tr>
      <td>${y}年後</td>
      <td>${manEn(principal[y])}</td>
      <td>${manEn(series3[y])}</td>
      <td>${manEn(series5[y])}</td>
      <td>${manEn(series7[y])}</td>
    </tr>
  `).join('');
  $('table-wrap').innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>経過</th><th>元本</th><th>年3%</th><th>年5%</th><th>年7%</th></tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>
  `;
}

const simMonthlyInput = $('sim-monthly');
const updateChartFromInput = () => buildChart(Math.max(0, Number(simMonthlyInput.value) || 0));
simMonthlyInput.addEventListener('change', updateChartFromInput);
onEnterCommit(simMonthlyInput, updateChartFromInput);

$('btn-toggle-table').addEventListener('click', () => {
  const wrap = $('table-wrap');
  wrap.hidden = !wrap.hidden;
  $('btn-toggle-table').textContent = wrap.hidden ? '表で見る ▾' : '表を閉じる ▴';
});

// premium画面を開いた初回にグラフを描画
document.getElementById('btn-fake-pay').addEventListener('click', () => {
  buildChart(Math.max(0, Number(simMonthlyInput.value) || 0));
});
