// 投資デビュー診断 - メインロジック
'use strict';

// ============ 共通ユーティリティ ============
const $ = (id) => document.getElementById(id);
const yen = (n) => Math.round(n).toLocaleString('ja-JP') + '円';
const num = (n) => Math.round(n).toLocaleString('ja-JP');
const manEn = (n) => {
  const v = Math.round(n);
  if (Math.abs(v) >= 10000) return (Math.round(v / 1000) / 10).toLocaleString('ja-JP') + '万円';
  return v.toLocaleString('ja-JP') + '円';
};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ============ 金額入力欄(3桁カンマ区切り) ============
// 表示は "100,000"、計算に使う値は数値の 100000 に分けて扱う
const digitsOnly = (s) => String(s == null ? '' : s).replace(/[^\d]/g, '').slice(0, 9);
const commas = (n) => Number(n).toLocaleString('ja-JP');

// 入力欄をカンマ区切りに整形し、数値を返す。カーソル位置も保つ
function formatMoneyInput(el) {
  const caret = el.selectionStart;
  const digitsBefore = caret == null ? null : digitsOnly(el.value.slice(0, caret)).length;

  const raw = digitsOnly(el.value);
  const formatted = raw === '' ? '' : commas(Number(raw));
  if (el.value !== formatted) el.value = formatted;

  if (digitsBefore != null) {
    // 「カーソルより前にある数字の個数」を手がかりに位置を戻す
    let pos = 0, seen = 0;
    while (pos < formatted.length && seen < digitsBefore) {
      if (/\d/.test(formatted[pos])) seen++;
      pos++;
    }
    try { el.setSelectionRange(pos, pos); } catch (e) { /* 一部ブラウザ対策 */ }
  }
  return raw === '' ? 0 : Number(raw);
}

// 金額入力欄に整形と変更通知を取り付ける
function bindMoney(el, onChange) {
  const handle = () => onChange(formatMoneyInput(el));
  el.addEventListener('input', handle);
  el.addEventListener('blur', handle);
  formatMoneyInput(el);   // 初期表示だけ整える(onChangeは呼ばない)
}

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

// ============ 入力項目の定義 ============
// living: 'alone'(一人暮らし) / 'home'(実家暮らし) / 'both'(どちらでも発生する)
// avg = 大学生の月間平均額の目安(サンプル用の参考値)。住まいで変わる項目は
//       { alone: ..., home: ... } の形で持つ
const INCOME_ITEMS = [
  { id: 'inc-work',  label: 'バイト代',         ph: '例: 60,000' },
  { id: 'inc-allow', label: '仕送り・お小遣い', ph: '例: 40,000' },
];

const EXPENSE_ITEMS = [
  // ---- 固定費 ----
  { id: 'rent',    group: 'fixed', living: 'alone', label: '家賃',                 avg: 53000, ph: '例: 60,000', note: '管理費・共益費も含めた金額' },
  { id: 'utility', group: 'fixed', living: 'alone', label: '光熱費(電気・ガス・水道)', avg: 9000, ph: '例: 9,000' },
  { id: 'home',    group: 'fixed', living: 'home',  label: '家に入れているお金',     avg: 10000, ph: '例: 10,000', note: '実家に渡している生活費。渡していなければ 0 のままでOK' },
  { id: 'phone',   group: 'fixed', living: 'both',  label: '通信費(スマホ)',        avg: 6500,  ph: '例: 7,000' },
  { id: 'subs',    group: 'fixed', living: 'both',  label: 'サブスク',              avg: 1800,  ph: '例: 2,500',  note: 'Netflix・Spotify・Amazonプライム・ジムなどの合計' },
  // ---- 変動費 ----
  { id: 'food',    group: 'var',   living: 'both',  label: '食費',                  avg: { alone: 26000, home: 13000 }, ph: '例: 25,000',
    note: { alone: '自炊・学食・外食の合計', home: '自分で払っている分だけ(学食・外食・買い食いなど)' } },
  { id: 'party',   group: 'var',   living: 'both',  label: '交遊費・飲み会',         avg: 12000, ph: '例: 15,000', note: '飲み会・カラオケ・旅行の積立など' },
  { id: 'cafe',    group: 'var',   living: 'both',  label: 'カフェ・コンビニ',       avg: 8000,  ph: '例: 10,000', note: '1回500円でも週5回で月1万円になります' },
  { id: 'transit', group: 'var',   living: 'both',  label: '交通費',                avg: { alone: 4500, home: 8000 }, ph: '例: 5,000',
    note: { alone: '定期券・電車代など', home: '通学定期は自宅生のほうが高くなりがちです' } },
  { id: 'daily',   group: 'var',   living: 'alone', label: '日用品・雑費',           avg: 4000,  ph: '例: 4,000',  note: '洗剤・ティッシュ・消耗品など' },
  { id: 'hobby',   group: 'var',   living: 'both',  label: '趣味・娯楽',             avg: 9000,  ph: '例: 8,000',  note: '服・美容・ゲーム・推し活など' },
];

// 「使っている自覚が薄い」3項目(住まいに関係なく共通)
const LEAK_IDS = ['subs', 'cafe', 'party'];

const itemById = (id) => EXPENSE_ITEMS.find((it) => it.id === id);

// 住まいによって値が変わるプロパティを取り出す
const forLiving = (v, living) => (v && typeof v === 'object' ? v[living] : v);
const avgOf = (it) => forLiving(it.avg, living) || 0;
const noteOf = (it) => forLiving(it.note, living) || '';

// その住まいで表示する支出項目
const activeItems = () => EXPENSE_ITEMS.filter((it) => it.living === 'both' || it.living === living);

// ============ フォームの生成 ============
const LIVING_LABEL = { alone: '一人暮らし', home: '実家暮らし' };
let living = null;          // 'alone' | 'home'
const values = {};          // 入力値(住まいを切り替えても消えないようここに保持する)
[...INCOME_ITEMS, ...EXPENSE_ITEMS].forEach((it) => { values[it.id] = 0; });

function fieldHtml(it) {
  const note = noteOf(it) ? `<span class="note">${noteOf(it)}</span>` : '';
  const v = values[it.id] ? commas(values[it.id]) : '';
  return `
    <div class="field">
      <label for="${it.id}">${it.label}${note}</label>
      <div class="input-yen">
        <input type="text" inputmode="numeric" autocomplete="off" id="${it.id}" placeholder="${it.ph}" value="${v}">
      </div>
    </div>`;
}

function bindField(it) {
  const el = $(it.id);
  bindMoney(el, (n) => { values[it.id] = n; updateSums(); });
  onEnterCommit(el, () => diagnose());
}

function renderFields() {
  const items = activeItems();
  $('fields-income').innerHTML = INCOME_ITEMS.map(fieldHtml).join('');
  $('fields-fixed').innerHTML = items.filter((i) => i.group === 'fixed').map(fieldHtml).join('');
  $('fields-var').innerHTML = items.filter((i) => i.group === 'var').map(fieldHtml).join('');
  [...INCOME_ITEMS, ...items].forEach(bindField);
  updateSums();
}

function setLiving(next) {
  living = next;
  document.querySelectorAll('.choice-btn').forEach((b) => b.classList.toggle('selected', b.dataset.living === next));
  $('form-lock').hidden = true;
  $('form-body').hidden = false;
  renderFields();
}

document.querySelectorAll('.choice-btn').forEach((btn) => {
  btn.addEventListener('click', () => setLiving(btn.dataset.living));
});

function readForm() {
  const income = INCOME_ITEMS.reduce((s, it) => s + values[it.id], 0);
  const items = activeItems();
  const spend = {};
  // 表示していない項目は 0 として扱い、計算ロジックはどちらの住まいでも共通にする
  EXPENSE_ITEMS.forEach((it) => { spend[it.id] = items.includes(it) ? values[it.id] : 0; });
  const fixed = items.filter((i) => i.group === 'fixed').reduce((s, it) => s + spend[it.id], 0);
  const variable = items.filter((i) => i.group === 'var').reduce((s, it) => s + spend[it.id], 0);
  return {
    living, items, income, spend, fixed, variable,
    total: fixed + variable,
    surplus: Math.max(0, income - fixed - variable),
  };
}

// 入力するそばから各セクションの合計を出す(入れながら気づけるように)
function updateSums() {
  const d = readForm();
  $('sum-income').textContent = '¥' + num(d.income);
  $('sum-fixed').textContent = '¥' + num(d.fixed);
  $('sum-var').textContent = '¥' + num(d.variable);
}

// ============ STEP 2: 無料診断 ============
let state = null; // 直近の診断結果

function diagnose() {
  const d = readForm();
  state = d;

  $('result-amount').textContent = num(d.surplus);
  $('bd-income').textContent = yen(d.income);
  $('bd-fixed').textContent = yen(d.fixed);
  $('bd-var').textContent = yen(d.variable);

  $('result-rate').textContent = d.income > 0
    ? `収入 ${num(d.income)}円のうち ${Math.round((d.surplus / d.income) * 100)}% を投資に回せる計算です`
    : '収入を入力すると、投資に回せる割合も出ます';

  $('result-comment').textContent = commentFor(d);
  renderLeakInsight(d);
  renderTopOverInsight(d);
  renderComparison(d);

  // 有料シミュレーションの初期値に反映
  setMonthly(Math.max(1000, Math.round(d.surplus / 1000) * 1000));

  $('screen-input').hidden = true;
  $('screen-result').hidden = false;
  $('screen-premium').hidden = true;
  $('head-title').textContent = '診断結果';
  $('head-sub').textContent = `${LIVING_LABEL[d.living]}の場合の結果です。`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function commentFor(d) {
  const x = d.surplus;
  if (d.income === 0) return 'まずは収入(バイト代・仕送り)を入力してみましょう。';
  if (x <= 0) return '今のままだと投資に回せる分が残りません。まずは下の「見落としがちな支出」から削れそうな項目を探してみましょう。';
  if (x < 5000) return `${num(x)}円あれば、月1,000円からのNISA積立を始められます。金額よりも「毎月続ける習慣」を作るのが最初の目標です。`;
  if (x < 15000) return `${num(x)}円は、学生が無理なく積み立てられる現実的な金額です。この額を20年続けるだけで、結果はかなり変わります。`;
  if (x < 30000) return `${num(x)}円はしっかり投資に回せる余裕額です。全額を投資に回さず、一部は突発的な出費用に現金で残しておくと安心です。`;
  return `${num(x)}円はかなり余裕があります。NISAの非課税枠(年間120万円のつみたて投資枠)を十分に活かせる水準です。`;
}

// 見落としがち3項目の削減インパクト
function renderLeakInsight(d) {
  const leak = LEAK_IDS.reduce((s, id) => s + d.spend[id], 0);
  if (leak === 0) {
    $('insight-leak').innerHTML = `
      <div class="insight">
        <div class="h">まだ入力されていません</div>
        <div class="b">サブスク・カフェ/コンビニ・交遊費は、金額を意識しにくい代表格です。ざっくりでいいので入れてみてください。</div>
      </div>`;
    return;
  }
  const half = Math.round(leak / 2);
  const yearly = half * 12;
  const fv20 = futureValue(half, 0.05, 20);
  const detail = LEAK_IDS
    .filter((id) => d.spend[id] > 0)
    .map((id) => `${itemById(id).label} ${num(d.spend[id])}円`)
    .join(' / ');

  $('insight-leak').innerHTML = `
    <div class="insight">
      <div class="h">この3項目の合計は 月 ${num(leak)}円 = 年 ${num(leak * 12)}円</div>
      <div class="b" style="font-size:12px; color:var(--text-muted);">${detail}</div>
      <span class="big">半分に減らせば 年 ${num(yearly)}円</span>
      <div class="b">浮いた月${num(half)}円を年5%で20年積み立てると <strong>${manEn(fv20)}</strong> になります。1杯のコーヒーを我慢する話が、20年後にはこの差になります。</div>
    </div>`;
}

// 平均より多い項目トップ2
function renderTopOverInsight(d) {
  const overs = d.items
    .filter((it) => d.spend[it.id] > 0 && d.spend[it.id] > avgOf(it))
    .map((it) => ({ it, diff: d.spend[it.id] - avgOf(it) }))
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 2);

  if (overs.length === 0) {
    const entered = d.items.some((it) => d.spend[it.id] > 0);
    $('insight-top').innerHTML = entered ? `
      <div class="insight">
        <div class="h">支出は同世代の平均以下です</div>
        <div class="b">かなり堅実な使い方です。削るより「今の余裕額を投資に回し始める」ほうが効果が大きい段階にいます。</div>
      </div>` : '';
    return;
  }
  const totalDiff = overs.reduce((s, o) => s + o.diff, 0);
  const list = overs.map((o) => `${o.it.label} <strong>+${num(o.diff)}円/月</strong>`).join('、');
  $('insight-top').innerHTML = `
    <div class="insight alert">
      <div class="h">平均より多く使っている項目</div>
      <div class="b">${list}</div>
      <span class="big">年間 ${num(totalDiff * 12)}円の差</span>
      <div class="b">この2項目を平均並みに戻すだけで、上の金額がそのまま投資に回せます。</div>
    </div>`;
}

// 同世代平均との比較バー
function verdict(mine, avg) {
  const r = mine / avg;
  if (r >= 1.3) return { cls: 'pill-over', ic: '▲', text: '使いすぎ' };
  if (r >= 1.0) return { cls: 'pill-mid', ic: '●', text: 'やや多め' };
  return { cls: 'pill-good', ic: '✓', text: '堅実' };
}

function renderComparison(d) {
  const rows = d.items.map((it) => {
    const mine = d.spend[it.id];
    const avg = avgOf(it);
    const scale = Math.max(mine, avg) * 1.25 || 1;
    const mineW = Math.min(100, (mine / scale) * 100);
    const avgL = Math.min(100, (avg / scale) * 100);
    const v = mine > 0 && avg > 0 ? verdict(mine, avg) : null;
    const pill = v ? `<span class="pill ${v.cls}"><span class="ic">${v.ic}</span>${v.text}</span>` : '';
    return `
      <div class="cmp-row">
        <div class="cmp-head"><span class="name">${it.label}</span>${pill}</div>
        <div class="cmp-track">
          <div class="cmp-fill" style="width:${mineW}%"></div>
          <div class="cmp-avg" style="left:${avgL}%"></div>
        </div>
        <div class="cmp-foot">
          <span class="mine">あなた ${num(mine)}円</span>
          <span>平均 ${num(avg)}円</span>
        </div>
      </div>`;
  }).join('');

  const avgTotal = d.items.reduce((s, it) => s + avgOf(it), 0);
  const v = verdict(d.total, avgTotal);
  const summary = `
    <div class="cmp-row" style="border-top:1px solid var(--grid); padding-top:14px;">
      <div class="cmp-head">
        <span class="name">支出の合計</span>
        <span class="pill ${v.cls}"><span class="ic">${v.ic}</span>${v.text}</span>
      </div>
      <div class="cmp-foot" style="margin-top:6px;">
        <span class="mine">あなた ${num(d.total)}円</span>
        <span>平均 ${num(avgTotal)}円</span>
      </div>
    </div>`;

  $('cmp-list').innerHTML = rows + summary;
  $('cmp-sub').textContent =
    `濃いバーがあなた、縦線が${LIVING_LABEL[d.living]}の大学生の平均的な金額(目安)です`;
}

$('btn-diagnose').addEventListener('click', diagnose);
$('btn-back-input').addEventListener('click', () => {
  $('screen-result').hidden = true;
  $('screen-input').hidden = false;
  $('head-title').textContent = '毎月いくら投資に回せる?';
  $('head-sub').textContent = '支出を項目ごとに入れると、「意外と使っていた金額」が見えます。';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ============ 課金導線(ダミー) ============
const modal = $('paywall-modal');
$('btn-open-paywall').addEventListener('click', () => { modal.hidden = false; });
$('btn-close-modal').addEventListener('click', () => { modal.hidden = true; });
modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

$('btn-fake-pay').addEventListener('click', () => {
  modal.hidden = true;
  $('screen-result').hidden = true;
  $('screen-premium').hidden = false;
  $('head-title').textContent = '詳細シミュレーション';
  $('head-sub').textContent = '金額と期間を動かして、将来の姿を確かめましょう。';
  refreshSim();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('btn-back-result').addEventListener('click', () => {
  $('screen-premium').hidden = true;
  $('screen-result').hidden = false;
  $('head-title').textContent = '診断結果';
  $('head-sub').textContent = `${LIVING_LABEL[living]}の場合の結果です。`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ============ STEP 3-1: 積立シミュレーション ============
const RATES = [0.03, 0.05, 0.07];

// 毎月積み立てたときの将来価値(月複利)
function futureValue(monthly, annualRate, years) {
  const i = annualRate / 12;
  const n = years * 12;
  return i === 0 ? monthly * n : monthly * (((1 + i) ** n - 1) / i);
}
function fvSeries(monthly, annualRate, years) {
  const out = [];
  for (let y = 0; y <= years; y++) out.push(futureValue(monthly, annualRate, y));
  return out;
}

let monthly = 10000;
let years = 20;
let baseRate = 0.05;
let compareMode = false;   // true のときだけ3%/5%/7%を並べて表示する

// skipInput: 入力欄そのものを打っている最中は、値を書き戻さない(カーソルが飛ぶため)
function syncMonthlyUI(skipInput) {
  $('sim-monthly-label').textContent = '¥' + num(monthly);
  $('sim-monthly-range').value = Math.min(monthly, Number($('sim-monthly-range').max));
  if (!skipInput) $('sim-monthly').value = monthly ? commas(monthly) : '';
}

function setMonthly(v) {
  monthly = Math.max(0, Math.round(v));
  syncMonthlyUI(false);
}

function refreshSim() {
  $('sim-monthly-label').textContent = '¥' + num(monthly);
  $('sim-years-label').textContent = years + '年';
  $('sim-rate-label').textContent = Math.round(baseRate * 100) + '%';
  $('lab-fv').textContent = years + '年後';
  buildChart();
  renderBoost();
}

const monthlyRange = $('sim-monthly-range');
const monthlyInput = $('sim-monthly');
monthlyRange.addEventListener('input', () => { setMonthly(Number(monthlyRange.value)); refreshSim(); });
bindMoney(monthlyInput, (n) => { monthly = n; syncMonthlyUI(true); refreshSim(); });
onEnterCommit(monthlyInput, () => refreshSim());

const yearsRange = $('sim-years-range');
yearsRange.addEventListener('input', () => { years = Number(yearsRange.value); refreshSim(); });

document.querySelectorAll('.rate-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.rate-tab').forEach((t) => t.classList.remove('selected'));
    tab.classList.add('selected');
    baseRate = Number(tab.dataset.rate) / 100;
    refreshSim();
  });
});

$('cmp-mode').addEventListener('change', () => {
  compareMode = $('cmp-mode').checked;
  refreshSim();
});

let chart = null;

function buildChart() {
  const labels = Array.from({ length: years + 1 }, (_, y) => `${y}年`);
  const s = RATES.map((r) => fvSeries(monthly, r, years));
  const principal = Array.from({ length: years + 1 }, (_, y) => monthly * y * 12);
  const colors = [cssVar('--series-3'), cssVar('--series-5'), cssVar('--series-7')];
  const baseIdx = RATES.findIndex((r) => Math.abs(r - baseRate) < 1e-9);

  // 既定は選択中の利回り1本だけ。比較モードのときだけ3本すべて描く
  const shownIdx = compareMode ? RATES.map((_, i) => i) : [baseIdx];

  const datasets = [
    { label: '元本', data: principal, borderColor: cssVar('--series-principal'), borderDash: [4, 3], borderWidth: 2, pointRadius: 0, tension: 0 },
    ...shownIdx.map((i) => ({
      label: `年${Math.round(RATES[i] * 100)}%`,
      data: s[i],
      borderColor: colors[i],
      borderWidth: i === baseIdx ? 3.5 : 2,
      pointRadius: 0,
      tension: 0.15,
    })),
  ];

  const gridColor = cssVar('--grid');
  const mutedColor = cssVar('--text-muted');

  if (chart) chart.destroy();
  chart = new Chart($('sim-chart').getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar('--card'),
          titleColor: cssVar('--text-primary'),
          bodyColor: cssVar('--text-secondary'),
          borderColor: cssVar('--border'),
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${yen(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: mutedColor, maxTicksLimit: 6, autoSkip: true, font: { size: 11 } } },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          border: { display: false },
          ticks: { color: mutedColor, font: { size: 11 }, maxTicksLimit: 5, callback: (v) => manEn(v) },
        },
      },
    },
  });

  // 凡例に終了時点の金額を直接表示(色だけに意味を持たせない)
  $('chart-legend').innerHTML = [
    { key: '元本', color: cssVar('--series-principal'), dashed: true, val: principal[years] },
    ...shownIdx.map((i) => ({ key: `年${Math.round(RATES[i] * 100)}%`, color: colors[i], val: s[i][years] })),
  ].map((x) => `
    <div class="item">
      <span class="swatch${x.dashed ? ' dashed' : ''}" style="${x.dashed ? '' : `background:${x.color}`}"></span>
      ${x.key} <span class="val">${manEn(x.val)}</span>
    </div>`).join('');

  const main = s[baseIdx][years];
  const prin = principal[years];
  $('fv-main').textContent = manEn(main);
  $('fv-gain').textContent = manEn(main - prin);
  $('fv-principal').textContent = manEn(prin);

  renderTable(principal, s, shownIdx);
}

function renderTable(principal, s, shownIdx) {
  const step = Math.max(1, Math.round(years / 5));
  const rows = [];
  for (let y = 0; y <= years; y += step) rows.push(y);
  if (rows[rows.length - 1] !== years) rows.push(years);

  const ths = shownIdx.map((i) => `<th>年${Math.round(RATES[i] * 100)}%</th>`).join('');
  const trs = rows.map((y) => `
    <tr>
      <td>${y}年後</td>
      <td>${manEn(principal[y])}</td>
      ${shownIdx.map((i) => `<td>${manEn(s[i][y])}</td>`).join('')}
    </tr>`).join('');

  $('table-wrap').innerHTML = `
    <table class="data-table">
      <thead><tr><th>経過</th><th>元本</th>${ths}</tr></thead>
      <tbody>${trs}</tbody>
    </table>`;
}

$('btn-toggle-table').addEventListener('click', () => {
  const wrap = $('table-wrap');
  wrap.hidden = !wrap.hidden;
  $('btn-toggle-table').textContent = wrap.hidden ? '表で見る ▾' : '表を閉じる ▴';
});

// ============ STEP 3-2: 「あと◯円」比較 ============
const BOOSTS = [1000, 3000, 5000];

function renderBoost() {
  $('boost-sub').textContent = `毎月の積立額を増やしたときの、${years}年後の差額です(年${Math.round(baseRate * 100)}%で試算)`;
  $('boost-list').innerHTML = BOOSTS.map((b) => {
    const gain = futureValue(b, baseRate, years);
    const added = b * years * 12;
    return `
      <div class="boost-row">
        <span class="plus">月 +${num(b)}円</span>
        <span class="arrow">→</span>
        <span class="gain">
          <span class="g">+${manEn(gain)}</span>
          <span class="s">追加した元本 ${manEn(added)} / 増えた分 ${manEn(gain - added)}</span>
        </span>
      </div>`;
  }).join('');

  const one = futureValue(1000, baseRate, years);
  $('boost-note').textContent = `月1,000円は1日あたり約33円です。それでも${years}年で${manEn(one)}の差になります。`;
}

// ============ STEP 3-3: リスク許容度 → ポートフォリオ ============
// 学生向けなので株式のみ。リスク度に応じてテーマを変えて分散する
const PORTFOLIOS = {
  stable: {
    label: '安定重視',
    lead: '同じ株式でも「値動きの荒さ」はテーマで大きく変わります。世界中に薄く広く分散しつつ、値動きが穏やかな業種を厚めにした配分です。',
    comment: 'まずは値動きに慣れることが目的の配分です。1本目は全世界株式インデックス(eMAXIS Slim 全世界株式など)だけで十分機能します。慣れてきたら高配当や生活必需品を足していくと、下落局面での精神的な支えになります。',
    items: [
      { name: '全世界株式インデックス', pct: 60, desc: '先進国から新興国まで数千社にまとめて分散。1本で世界中の株を持てる、迷ったらこれという中核。', ex: '例: eMAXIS Slim 全世界株式(オール・カントリー)' },
      { name: '高配当株(日本・米国)', pct: 25, desc: '配当を出し続ける成熟企業が中心。値上がりは控えめでも、配当が入るので長く持ちやすい。', ex: '例: SBI・V・米国高配当株式 / 日本高配当株ファンド' },
      { name: '生活必需品・ヘルスケア', pct: 15, desc: '食品・日用品・医薬品など、不況でも売れる業種。相場が崩れたときに下がりにくい。', ex: '例: 生活必需品セクターETF' },
    ],
  },
  balance: {
    label: 'バランス',
    lead: '世界全体を土台にしつつ、実績のある米国株を少し厚めに。将来の伸びしろとして新興国も少量入れた、いちばん標準的な配分です。',
    comment: '長期の積立で最も再現しやすい配分です。全世界株式を土台に、S&P500で米国を上乗せする形になります(全世界株式にも米国は6割ほど含まれるので、米国の比率が高くなりすぎない点に注意)。まずはこの2本から始めて、余裕が出たら残りを足すのが現実的です。',
    items: [
      { name: '全世界株式インデックス', pct: 50, desc: '土台となる部分。世界経済全体の成長をそのまま受け取る。', ex: '例: eMAXIS Slim 全世界株式(オール・カントリー)' },
      { name: 'S&P500(米国株)', pct: 25, desc: '米国の主要500社。過去の実績が最も語られる王道インデックス。', ex: '例: eMAXIS Slim 米国株式(S&P500)' },
      { name: '高配当株', pct: 15, desc: '配当が定期的に入るので、値下がり局面でも続けやすい。', ex: '例: SBI・V・米国高配当株式' },
      { name: '新興国株式', pct: 10, desc: 'インド・東南アジアなど。値動きは荒いが、長期の伸びしろを取りにいく枠。', ex: '例: eMAXIS Slim 新興国株式インデックス' },
    ],
  },
  active: {
    label: '積極的',
    lead: '成長期待の高いテーマを厚めにした配分です。上がるときは大きい代わりに、下がるときも大きい。若さ(=時間)を武器にできる人向けです。',
    comment: '20〜30年の時間を味方にできる学生だからこそ選べる配分です。ただし相場が3〜4割下がる年は必ず来ます。そのときに売らずに積立を続けられるかが唯一の条件で、それが不安ならバランス型に落としてください。ハイテク比率が高いぶん、値動きは全世界株式の1.5倍程度になると考えておくと心構えができます。',
    items: [
      { name: 'S&P500(米国株)', pct: 35, desc: '米国の主要500社。積極型でも中核はここに置く。', ex: '例: eMAXIS Slim 米国株式(S&P500)' },
      { name: '米国ハイテク(NASDAQ100)', pct: 30, desc: 'AI・半導体・プラットフォーム企業が中心。伸びも下げも最も大きい枠。', ex: '例: ニッセイ NASDAQ100インデックスファンド' },
      { name: '全世界株式インデックス', pct: 20, desc: '米国に偏りすぎないための保険。世界全体に分散する土台。', ex: '例: eMAXIS Slim 全世界株式(オール・カントリー)' },
      { name: '新興国株式', pct: 15, desc: 'インドなど人口が増える国の成長を取りにいく枠。', ex: '例: eMAXIS Slim 新興国株式インデックス' },
    ],
  },
};

let selectedRisk = 'balance';
const CAT_VARS = ['--cat-1', '--cat-2', '--cat-3', '--cat-4'];

function renderPortfolio(key) {
  const p = PORTFOLIOS[key];
  const colors = p.items.map((_, i) => cssVar(CAT_VARS[i]));

  $('port-bar').innerHTML = p.items.map((it, i) =>
    `<div class="seg" style="width:${it.pct}%; background:${colors[i]};">${it.pct}%</div>`).join('');

  $('port-list').innerHTML = p.items.map((it, i) => `
    <div class="port-item">
      <span class="sw" style="background:${colors[i]}"></span>
      <div style="flex:1">
        <div style="display:flex;"><span class="nm">${it.name}</span><span class="pc">${it.pct}%</span></div>
        <div class="ds">${it.desc}</div>
        <div class="ex">${it.ex}</div>
      </div>
    </div>`).join('');

  $('port-comment').innerHTML = `<strong>【${p.label}タイプ】</strong>${p.lead}<br><br>${p.comment}`;

  $('port-bar').hidden = false;
  $('port-list').hidden = false;
  $('port-comment').hidden = false;
}

document.querySelectorAll('.risk-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.risk-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedRisk = btn.dataset.risk;
    renderPortfolio(selectedRisk);
  });
});
document.querySelector('.risk-btn[data-risk="balance"]').classList.add('selected');
renderPortfolio('balance');

// ============ STEP 3-4: 結果カードの画像保存 ============
const FONT = '"Yu Gothic", "Hiragino Sans", Meiryo, system-ui, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// シェア用カードは配色を固定して描く(端末のダークモードに左右されないように)
function drawShareCard() {
  const cv = $('share-canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const PAD = 72;

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#123a5e');
  grad.addColorStop(1, '#0c2a45');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ヘッダー
  ctx.fillStyle = '#16a672';
  ctx.beginPath(); ctx.arc(PAD + 12, 96, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 34px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('投資デビュー診断', PAD + 38, 108);

  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, 146); ctx.lineTo(W - PAD, 146); ctx.stroke();

  // 毎月の投資額
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `28px ${FONT}`;
  ctx.fillText('毎月の積立額', PAD, 220);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 76px ${FONT}`;
  ctx.fillText(num(monthly) + '円', PAD, 300);

  // 将来の資産額
  const fv = futureValue(monthly, baseRate, years);
  const prin = monthly * years * 12;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `28px ${FONT}`;
  ctx.fillText(`${years}年後の予想資産額(年${Math.round(baseRate * 100)}%)`, PAD, 400);
  ctx.fillStyle = '#5fd7a8';
  ctx.font = `bold 104px ${FONT}`;
  ctx.fillText(manEn(fv), PAD, 500);

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `26px ${FONT}`;
  ctx.fillText(`累計投資額 ${manEn(prin)} / 運用益 ${manEn(fv - prin)}`, PAD, 548);

  // グラフカード
  const cx = PAD, cy = 590, cw = W - PAD * 2, ch = 400;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cx, cy, cw, ch, 24); ctx.fill();
  drawMiniChart(ctx, cx + 40, cy + 60, cw - 80, ch - 110);
  ctx.fillStyle = '#52514e';
  ctx.font = `bold 26px ${FONT}`;
  const chartTitle = compareMode
    ? '資産の推移(年3% / 5% / 7%)'
    : `資産の推移(年${Math.round(baseRate * 100)}%)`;
  ctx.fillText(chartTitle, cx + 40, cy + 42);

  // ポートフォリオ
  const p = PORTFOLIOS[selectedRisk];
  const FIXED_CATS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `28px ${FONT}`;
  ctx.fillText(`おすすめの投資タイプ: ${p.label}`, PAD, 1058);

  let bx = PAD;
  const bw = W - PAD * 2, bh = 46, by = 1082;
  p.items.forEach((it, i) => {
    const w = (bw * it.pct) / 100 - 4;
    ctx.fillStyle = FIXED_CATS[i];
    roundRect(ctx, bx, by, w, bh, 8); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(it.pct + '%', bx + w / 2, by + 31);
    ctx.textAlign = 'left';
    bx += w + 4;
  });

  // 凡例(2列)
  p.items.forEach((it, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = PAD + col * (bw / 2), ly = 1190 + row * 56;
    ctx.fillStyle = FIXED_CATS[i];
    roundRect(ctx, lx, ly - 16, 20, 20, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `24px ${FONT}`;
    ctx.fillText(`${it.name} ${it.pct}%`, lx + 32, ly);
  });

  // フッター
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `24px ${FONT}`;
  ctx.fillText('#投資デビュー診断', W / 2, 1360);
  ctx.font = `18px ${FONT}`;
  ctx.fillText('※簡易試算です。将来の運用成果を保証するものではありません。', W / 2, 1398);
  ctx.textAlign = 'left';
}

// カード内の小さな折れ線グラフ(Chart.jsは使わず自前で描く)
function drawMiniChart(ctx, x, y, w, h) {
  const allColors = ['#86b6ef', '#2a78d6', '#104281'];
  const baseIdx = RATES.findIndex((r) => Math.abs(r - baseRate) < 1e-9);
  const shownIdx = compareMode ? RATES.map((_, i) => i) : [baseIdx];
  const colors = shownIdx.map((i) => allColors[i]);
  const series = shownIdx.map((i) => fvSeries(monthly, RATES[i], years));
  const principal = Array.from({ length: years + 1 }, (_, i) => monthly * i * 12);
  const max = Math.max(1, ...series.map((s) => s[years]));
  const px = (i) => x + (w * i) / years;
  const py = (v) => y + h - (h * v) / max;

  // 横のガイド線
  ctx.strokeStyle = '#e1e0d9';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const gy = y + (h * g) / 4;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
  }

  // 元本(破線)
  ctx.strokeStyle = '#898781';
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  principal.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))));
  ctx.stroke();
  ctx.setLineDash([]);

  // 利回り3本
  series.forEach((s, si) => {
    ctx.strokeStyle = colors[si];
    ctx.lineWidth = 4;
    ctx.beginPath();
    s.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))));
    ctx.stroke();
  });

  // 軸ラベル
  ctx.fillStyle = '#898781';
  ctx.font = `20px ${FONT}`;
  ctx.fillText('0年', x, y + h + 28);
  ctx.textAlign = 'right';
  ctx.fillText(`${years}年 / 最大 ${manEn(max)}`, x + w, y + h + 28);
  ctx.textAlign = 'left';
}

$('btn-make-card').addEventListener('click', () => {
  drawShareCard();
  const img = $('share-preview');
  img.src = $('share-canvas').toDataURL('image/png');
  img.hidden = false;
  $('btn-download-card').hidden = false;
});

$('btn-download-card').addEventListener('click', () => {
  $('share-canvas').toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '投資デビュー診断.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});

// 初期表示
setMonthly(10000);
