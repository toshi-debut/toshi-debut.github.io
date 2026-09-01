// 投資デビュー診断 - メインロジック
'use strict';

// ============================================================
// 共通ユーティリティ
// ============================================================
const $ = (id) => document.getElementById(id);
const yen = (n) => Math.round(n).toLocaleString('ja-JP') + '円';
const num = (n) => Math.round(n).toLocaleString('ja-JP');
const manEn = (n) => {
  const v = Math.round(n);
  if (Math.abs(v) >= 10000) return (Math.round(v / 1000) / 10).toLocaleString('ja-JP') + '万円';
  return v.toLocaleString('ja-JP') + '円';
};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 数字が伸びていく演出(診断されている感を出す)
function countUp(el, to, ms) {
  if (reduceMotion() || !window.requestAnimationFrame) { el.textContent = num(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);   // 最後にゆっくり止まる
    el.textContent = num(to * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// 画面切り替えのたびに登場アニメーションをやり直す
function replayReveal(root) {
  root.querySelectorAll('.reveal').forEach((el) => {
    el.style.animation = 'none';
    void el.offsetWidth;          // 再描画を挟んでアニメーションを巻き戻す
    el.style.animation = '';
  });
}

// ============================================================
// 金額入力欄(3桁カンマ区切り)
// 表示は "100,000"、計算に使う値は数値の 100000 に分けて扱う
// ============================================================
const digitsOnly = (s) => String(s == null ? '' : s).replace(/[^\d]/g, '').slice(0, 9);
const commas = (n) => Number(n).toLocaleString('ja-JP');

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

// ============================================================
// 入力項目の定義
// living: 'alone'(一人暮らし) / 'home'(実家暮らし) / 'both'
// avg は住まいで変わる場合 { alone, home } の形で持つ
// ============================================================
const INCOME_ITEMS = [
  { id: 'inc-work',  label: '働いて得た収入',   ph: '例: 60,000', note: 'アルバイト・インターン・業務委託などの手取り' },
  { id: 'inc-allow', label: 'その他の収入',     ph: '例: 40,000', note: '仕送り・お小遣い・奨学金など' },
];

const EXPENSE_ITEMS = [
  { id: 'rent',    group: 'fixed', living: 'alone', label: '家賃',                    avg: 53000, ph: '例: 60,000', note: '管理費・共益費も含めた金額' },
  { id: 'utility', group: 'fixed', living: 'alone', label: '光熱費(電気・ガス・水道)', avg: 9000,  ph: '例: 9,000' },
  { id: 'home',    group: 'fixed', living: 'home',  label: '家に入れているお金',       avg: 10000, ph: '例: 10,000', note: '実家に渡している生活費。渡していなければ 0 のままでOK' },
  { id: 'phone',   group: 'fixed', living: 'both',  label: '通信費(スマホ)',           avg: 6500,  ph: '例: 7,000' },
  { id: 'subs',    group: 'fixed', living: 'both',  label: 'サブスク',                 avg: 1800,  ph: '例: 2,500',  note: 'Netflix・Spotify・Amazonプライム・ジムなどの合計' },

  { id: 'food',    group: 'var',   living: 'both',  label: '食費',                     avg: { alone: 26000, home: 13000 }, ph: '例: 25,000',
    note: { alone: '自炊・学食・外食の合計', home: '自分で払っている分だけ(学食・外食・買い食いなど)' } },
  { id: 'party',   group: 'var',   living: 'both',  label: '交遊費・飲み会',            avg: 12000, ph: '例: 15,000', note: '飲み会・カラオケ・旅行の積立など' },
  { id: 'cafe',    group: 'var',   living: 'both',  label: 'カフェ・コンビニ',          avg: 8000,  ph: '例: 10,000', note: '1回500円でも週5回で月1万円になります' },
  { id: 'transit', group: 'var',   living: 'both',  label: '交通費',                   avg: { alone: 4500, home: 8000 }, ph: '例: 5,000',
    note: { alone: '定期券・電車代など', home: '通学定期は自宅生のほうが高くなりがちです' } },
  { id: 'daily',   group: 'var',   living: 'alone', label: '日用品・雑費',              avg: 4000,  ph: '例: 4,000',  note: '洗剤・ティッシュ・消耗品など' },
  { id: 'hobby',   group: 'var',   living: 'both',  label: '趣味・娯楽',                avg: 9000,  ph: '例: 8,000',  note: '服・美容・ゲーム・推し活など' },
];

// 「使っている自覚が薄い」3項目
const LEAK_IDS = ['subs', 'cafe', 'party'];
const itemById = (id) => EXPENSE_ITEMS.find((it) => it.id === id);

const forLiving = (v, l) => (v && typeof v === 'object' ? v[l] : v);
const avgOf = (it) => forLiving(it.avg, living) || 0;
const noteOf = (it) => forLiving(it.note, living) || '';
const activeItems = () => EXPENSE_ITEMS.filter((it) => it.living === 'both' || it.living === living);

// ============================================================
// 用語ツールチップ
// ============================================================
const GLOSSARY = {
  nisa: ['NISA(ニーサ)',
    '投資で出た利益に税金がかからなくなる国の制度。ふつうは利益の約20%が税金で引かれるが、NISA口座の中で買えばそれが0円になる。18歳以上なら1人1口座つくれる。'],
  tsumitate: ['つみたて投資枠',
    'NISAの中の枠のひとつで、年間120万円まで積み立てられる。長期の積立に向くと国が認めた投資信託しか買えない仕組みなので、初心者ほど選びやすい。'],
  toushin: ['投資信託(ファンド)',
    'たくさんの人からお金を集めて、まとめて何百〜何千社の株に投資してくれる商品。1本買うだけで自動的に分散投資になるので、個別の会社を選ぶ必要がない。'],
  index: ['インデックスファンド',
    '「日経平均」「S&P500」のような指数と同じ値動きを目指す投資信託。運用にかかる手数料(信託報酬)が非常に安いのが特徴で、長期の積立ではここが効いてくる。'],
  zensekai: ['全世界株式インデックス',
    '世界中の約3,000社の株にまとめて投資するインデックスファンド。1本で日本・米国・欧州・新興国すべてに分散できるため、最初の1本として定番。'],
  bunsan: ['分散投資',
    '1社や1つの国に集中せず、いろいろな対象に分けて投資すること。どれかが下がっても他が支えるので、資産全体の値動きがおだやかになる。'],
  fukuri: ['複利',
    '増えた利益がさらに次の利益を生むこと。100万円が5%増えて105万円になると、翌年は105万円に対して5%がつく。期間が長いほど雪だるま式に効いてくる。'],
  rimawari: ['利回り',
    '投じた資金が1年でどれくらい増えるかの割合。このアプリの3%/5%/7%は「将来こうなると仮定した数字」であって、保証された数字ではない。'],
  kureka: ['クレカ積立',
    'クレジットカードで毎月の積立を自動決済する設定。カードのポイントが貯まるうえ、口座残高を気にせず自動で買い付けられるので「続ける」のが一番ラク。'],
  drip: ['ドルコスト平均法',
    '毎月同じ金額を買い続ける方法。価格が高いときは少なく、安いときは多く買うことになるので、買うタイミングで悩まなくて済む。'],
  ganpon: ['元本',
    '自分が積み立てたお金そのものの合計。グラフの点線が元本で、そこから上に離れた分が運用で増えた利益にあたる。'],
};

const term = (key, text) => `<button class="term" data-term="${key}">${text}</button>`;

const tip = document.createElement('div');
tip.id = 'tip';
tip.hidden = true;
document.body.appendChild(tip);

function showTip(btn) {
  const [title, body] = GLOSSARY[btn.dataset.term];
  tip.innerHTML = `<span class="tip-t">${title}</span>${body}<button class="tip-close">閉じる</button>`;
  tip.hidden = false;

  const r = btn.getBoundingClientRect();
  const w = tip.offsetWidth;
  let left = r.left + window.scrollX + r.width / 2 - w / 2;
  left = Math.max(12, Math.min(left, document.documentElement.clientWidth - w - 12));
  tip.style.left = left + 'px';
  tip.style.top = (r.bottom + window.scrollY + 8) + 'px';
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.term');
  if (btn) { showTip(btn); return; }
  if (!e.target.closest('#tip') || e.target.closest('.tip-close')) tip.hidden = true;
});
window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

// すでに書かれている文章の中の専門用語にも、あとからツールチップを付ける
// (長い語を先に並べる。「全世界株式インデックス」が「インデックス〜」に食われないように)
const AUTO_TERMS = [
  ['全世界株式インデックス', 'zensekai'],
  ['インデックスファンド', 'index'],
  ['ドルコスト平均法', 'drip'],
  ['つみたて投資枠', 'tsumitate'],
  ['投資信託', 'toushin'],
  ['分散投資', 'bunsan'],
  ['NISA', 'nisa'],
  ['複利', 'fukuri'],
  ['利回り', 'rimawari'],
  ['元本', 'ganpon'],
];
const AUTO_RE = new RegExp(AUTO_TERMS.map(([w]) => w).join('|'), 'g');
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function linkifyTerms(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeValue.trim() && !n.parentElement.closest('button')) nodes.push(n);
  }
  nodes.forEach((n) => {
    AUTO_RE.lastIndex = 0;
    if (!AUTO_RE.test(n.nodeValue)) return;
    AUTO_RE.lastIndex = 0;
    const html = escapeHtml(n.nodeValue).replace(AUTO_RE, (m) => {
      const hit = AUTO_TERMS.find(([w]) => w === m);
      return `<button class="term" data-term="${hit[1]}">${m}</button>`;
    });
    const span = document.createElement('span');
    span.innerHTML = html;
    n.replaceWith(span);
  });
}

// ============================================================
// 画面遷移
// ============================================================
const SCREENS = ['screen-intro', 'screen-input', 'screen-result', 'screen-premium'];
const HEADINGS = {
  'screen-input': ['毎月いくら<em>投資</em>に回せる?', '支出を項目ごとに入れると「意外と使っていた金額」が見えます'],
  'screen-result': ['あなたの<em>診断結果</em>', ''],
  'screen-premium': ['あなたの<em>投資プラン</em>', 'タブを切り替えて、必要なところから見てください'],
};

let currentScreen = 'screen-intro';
let currentStep = 0;

window.addEventListener('popstate', (e) => {
  const s = e.state;
  if (s && s.screen) goScreen(s.screen, s.step, { push: false });
  else goScreen('screen-intro', 0, { push: false });
});

function goScreen(id, stepNo, opts) {
  const push = (!opts || opts.push !== false) && id !== currentScreen;
  SCREENS.forEach((s) => { $(s).hidden = s !== id; });
  currentScreen = id;
  currentStep = stepNo;

  // スマホの「戻る」でアプリごと離脱せず、1つ前の画面に戻れるようにする
  if (push) {
    try { history.pushState({ screen: id, step: stepNo }, ''); } catch (e) { /* file:// では使えない */ }
  }

  // 導入画面は専用のビジュアルを使うので、共通ヘッダーは出さない
  const isIntro = id === 'screen-intro';
  $('app-header').hidden = isIntro;

  if (!isIntro) {
    const [title, sub] = HEADINGS[id];
    $('head-title').innerHTML = title;
    $('head-sub').textContent = sub || (living ? `${LIVING_LABEL[living]}の場合の結果です` : '');
    document.querySelectorAll('#steps .s').forEach((s) => {
      const n = Number(s.dataset.step);
      s.classList.toggle('on', n === stepNo);
      s.classList.toggle('done', n < stepNo);
    });
  }

  renderProgress();
  replayReveal($(id));
  window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

$('btn-start').addEventListener('click', () => goScreen('screen-input', 1));

// ============================================================
// フォームの生成
// ============================================================
const LIVING_LABEL = { alone: '一人暮らし', home: '実家暮らし' };
let living = null;
const values = {};
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
  bindMoney(el, (n) => { values[it.id] = n; updateSums(); saveProgress(); });
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
  renderProgress();
  saveProgress();
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

function updateSums() {
  const d = readForm();
  $('sum-income').textContent = '¥' + num(d.income);
  $('sum-fixed').textContent = '¥' + num(d.fixed);
  $('sum-var').textContent = '¥' + num(d.variable);
}

// ============================================================
// STEP2: 無料の診断結果
// ============================================================
let state = null;

// 収入が空のまま診断すると、余裕額も比較も全部0になって意味がなくなる。
// 支出が未入力なのは「まだ把握していない」だけなので通すが、収入だけは必ず聞く。
function validateForm() {
  const d = readForm();
  if (d.income <= 0) {
    return '収入を入力してください。<strong>収入がわからないと、投資に回せる金額が計算できません。</strong>アルバイト・仕送り・奨学金など、毎月入ってくるお金の合計で構いません。';
  }
  return null;
}

function showFormAlert(msg) {
  const box = $('form-alert');
  if (!msg) { box.hidden = true; return; }
  box.innerHTML = `<span class="ai">⚠️</span><span>${msg}</span>`;
  box.hidden = false;
  $('inc-work')?.focus();
  box.scrollIntoView?.({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
}

function diagnose() {
  const err = validateForm();
  if (err) { showFormAlert(err); return; }
  showFormAlert(null);

  const d = readForm();
  state = d;

  $('bd-income').textContent = yen(d.income);
  $('bd-fixed').textContent = yen(d.fixed);
  $('bd-var').textContent = yen(d.variable);
  $('result-rate').textContent = d.income > 0
    ? `収入 ${num(d.income)}円のうち ${Math.round((d.surplus / d.income) * 100)}% を投資に回せる計算です`
    : '収入を入力すると、投資に回せる割合も出ます';

  $('result-comment').textContent = commentFor(d);
  renderBuffer(d);
  renderLeakInsight(d);
  renderTopOverInsight(d);
  renderComparison(d);
  linkifyTerms($('result-comment'));
  linkifyTerms($('insight-leak'));

  setMonthly(Math.max(1000, Math.round(d.surplus / 1000) * 1000));

  // 積立額が決まってから、早く始めることの効果を出す
  renderEarly();
  renderDelay();
  renderInflation();

  // すでに5問答え終わっている状態で金額を直した場合、
  // 余裕額が変わればタイプも変わりうるので判定し直す
  if (selectedRisk && quizAnswers.every((a) => a !== null)) {
    const total = quizAnswers.reduce((s, a, i) => s + QUIZ[i].opts[a].s, 0);
    renderTypeCard(selectedRisk, total, { scroll: false });
    if (paid) renderPortfolio(selectedRisk);
  }

  stage = 'result';
  saveProgress();
  goScreen('screen-result', 2);
  countUp($('result-amount'), d.surplus, 900);
}

// ============================================================
// 投資に回す前に確保しておくお金(生活防衛資金)
// 余裕額を全部つぎ込むと、急な出費で売る羽目になる。そこだけは先に伝える
// ============================================================
function renderBuffer(d) {
  const monthCost = d.total;                       // 1ヶ月の生活費 = 支出合計
  const target = monthCost * 2;                    // まず2ヶ月分を目安にする
  // 余裕額の8割までを投資、残りは手元に。1,000円単位に丸める
  const invest = Math.max(0, Math.floor((d.surplus * 0.8) / 1000) * 1000);
  const keep = Math.max(0, d.surplus - invest);

  if (monthCost === 0 && d.surplus === 0) { $('buffer-card').hidden = true; return; }
  $('buffer-card').hidden = false;

  $('buffer-card').innerHTML = `
    <h2 class="section-title"><span class="ic">🏦</span>投資に回す前に</h2>
    <p class="section-sub">余裕額の全部を投資に回すのはおすすめしません</p>
    <div class="buffer-split">
      <div class="now">
        <div class="k">まず投資に回す</div>
        <div class="v">${num(invest)}<small>円</small></div>
        <div class="s">余裕額の約8割</div>
      </div>
      <div class="goal">
        <div class="k">手元に残す</div>
        <div class="v">${num(keep)}<small>円</small></div>
        <div class="s">急な出費に備える分</div>
      </div>
    </div>
    <p class="buffer-note">
      投資したお金は、値下がりしている時に限って必要になりがちです。
      ${monthCost > 0 ? `あなたの生活費は月 ${num(monthCost)}円 なので、まず <strong>${manEn(target)}(2ヶ月分)</strong> を
      普通預金に置いておくと、相場が下がっても売らずに済みます。` : ''}
      この金額が貯まるまでは、投資の金額を無理に増やさないほうが結果的にうまくいきます。
    </p>`;
  linkifyTerms($('buffer-card'));
}

function commentFor(d) {
  const x = d.surplus;
  if (d.income === 0) return 'まずは収入(アルバイト・仕送り・奨学金など)を入力してみましょう。';
  if (x <= 0) return '今のままだと投資に回せる分が残りません。まずは下の「見落としがちな支出」から削れそうな項目を探してみましょう。';
  if (x < 5000) return `${num(x)}円あれば、月1,000円からのNISA積立を始められます。金額よりも「毎月続ける習慣」を作るのが最初の目標です。`;
  if (x < 15000) return `${num(x)}円は、学生が無理なく積み立てられる現実的な金額です。この額を20年続けるだけで、結果はかなり変わります。`;
  if (x < 30000) return `${num(x)}円はしっかり投資に回せる余裕額です。全額を投資に回さず、一部は突発的な出費用に現金で残しておくと安心です。`;
  return `${num(x)}円はかなり余裕があります。NISAのつみたて投資枠を十分に活かせる水準です。`;
}

// ============================================================
// 早く始めることの効果(無料)
//
// 煽らず、「同じ条件で年数だけ変えるとこうなる」という事実だけを見せる。
// 金額はユーザー自身の余裕額(monthly)を使う。
// ============================================================
const EARLY = {
  young: 22,        // 大学を出てすぐ
  older: 32,        // その10年後
  until: 65,        // 定年をイメージした年齢
  rate: 0.05,       // 年5%(想定)
  inflation: 0.02,  // 年2%(物価上昇の想定)
  sample: 1000000,  // インフレの説明に使う金額
};

// 積立額は診断で出した余裕額。0円のときでも話が成立するよう最低1,000円で見せる
const planMonthly = () => Math.max(1000, monthly);

// ① 10年早く始めると、65歳時点でどれだけ違うか
function renderEarly() {
  const m = planMonthly();
  const yA = EARLY.until - EARLY.young;      // 43年
  const yB = EARLY.until - EARLY.older;      // 33年
  const fvA = futureValue(m, EARLY.rate, yA);
  const fvB = futureValue(m, EARLY.rate, yB);
  const ratio = (fvA / fvB).toFixed(1);
  const extraPrincipal = m * 12 * (yA - yB);
  const ratePct = Math.round(EARLY.rate * 100);

  $('early-card').innerHTML = `
    <h2 class="section-title"><span class="ic">🕰️</span>早く始めるほど有利、を数字で</h2>
    <p class="section-sub">毎月 ${num(m)}円 を年${ratePct}%で積み立て、${EARLY.until}歳まで続けた場合の比較です</p>
    <div class="age-rows">
      <div class="age-row">
        <div class="ah">
          <span class="who">${EARLY.young}歳から始める</span><span class="yrs">${yA}年間</span>
          <span class="av">${manEn(fvA)}</span>
        </div>
        <div class="atrack"><div class="afill" style="width:100%"></div></div>
      </div>
      <div class="age-row later">
        <div class="ah">
          <span class="who">${EARLY.older}歳から始める</span><span class="yrs">${yB}年間</span>
          <span class="av">${manEn(fvB)}</span>
        </div>
        <div class="atrack"><div class="afill" style="width:${(fvB / fvA) * 100}%"></div></div>
      </div>
    </div>
    <div class="fact-note">
      <span class="big">10年早く始めるだけで ${ratio}倍</span>
      追加で積み立てた元本は ${manEn(extraPrincipal)} ですが、${EARLY.until}歳時点の差は
      <strong>${manEn(fvA - fvB)}</strong> になります。
      増えた分のほとんどは、お金が働いていた時間の長さによるものです。
      毎月の金額を増やすより、始める時期を早めるほうが効く場面があります。
    </div>`;
  linkifyTerms($('early-card'));
}

// ② 1年先延ばしにすると、将来いくら差がつくか
function renderDelay() {
  const m = planMonthly();
  const ratePct = Math.round(EARLY.rate * 100);
  const marks = [10, 20];
  const rows = marks.map((y) => {
    const now = futureValue(m, EARLY.rate, y);
    const late = futureValue(m, EARLY.rate, y - 1);
    return `
      <tr>
        <td>${y}年後</td>
        <td class="now">${manEn(now)}</td>
        <td class="later">${manEn(late)}</td>
        <td class="gap">−${manEn(now - late)}</td>
      </tr>`;
  }).join('');
  const diff20 = futureValue(m, EARLY.rate, 20) - futureValue(m, EARLY.rate, 19);

  $('delay-card').innerHTML = `
    <h2 class="section-title"><span class="ic">⏳</span>1年先延ばしにすると</h2>
    <p class="section-sub">毎月 ${num(m)}円・年${ratePct}%で積み立てた場合。同じ時点で比べています</p>
    <table class="delay-table">
      <thead>
        <tr><th>経過</th><th>今から始める</th><th>1年後から始める</th><th>差</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="fact-note">
      <span class="big">1年待つと、20年後に ${manEn(diff20)} の差</span>
      1年ぶんの積立(${manEn(m * 12)})を見送っただけですが、
      そのお金が20年ではなく19年しか働けないぶん、差はこれだけ広がります。
      逆に言えば、<strong>金額が小さくても今月から始めることに意味があります</strong>。
    </div>
    <button class="btn-unlock-mini" data-open-paywall style="margin-top:16px;">
      金額・期間・利回りを変えて試算する →
    </button>
    <p style="font-size:11px; color:var(--ink-3); text-align:center; margin:8px 0 0;">
      自由に動かせるシミュレーションは有料(¥300)です
    </p>`;
  linkifyTerms($('delay-card'));
}

// ③ 貯金だけの場合の話(インフレ)。断定せず、判断材料として出す
function renderInflation() {
  const p = EARLY.sample;
  const r = EARLY.inflation;
  const v10 = p / (1 + r) ** 10;
  const v20 = p / (1 + r) ** 20;
  const pct = Math.round(r * 100);

  $('inflation-card').innerHTML = `
    <h2 class="section-title"><span class="ic">🧊</span>貯金だけにしておくと</h2>
    <p class="section-sub">投資をすすめるためではなく、判断の材料として知っておきたい話です</p>
    <div class="infl-steps">
      <div class="infl-step a"><div class="k">いま</div><div class="v">${manEn(p)}</div></div>
      <span class="infl-arrow">→</span>
      <div class="infl-step b"><div class="k">10年後の価値</div><div class="v">約${manEn(v10)}</div></div>
      <span class="infl-arrow">→</span>
      <div class="infl-step c"><div class="k">20年後の価値</div><div class="v">約${manEn(v20)}</div></div>
    </div>
    <div class="fact-note calm">
      物価が毎年${pct}%ずつ上がると、${manEn(p)}という金額そのものは減らなくても、
      それで買えるものは10年で <strong>約${manEn(v10)}分</strong> まで減ります。
      これがインフレで、日本銀行が目標として掲げているのも年${pct}%の物価上昇です。<br><br>
      ただしこれは「だから投資すべき」という話ではありません。
      投資には元本割れの可能性があり、貯金には<strong>額面が絶対に減らないという確実さ</strong>があります。
      どちらにもそれぞれのリスクがあることを知ったうえで、自分で決めるのがいちばん大事です。
    </div>`;
  linkifyTerms($('inflation-card'));
}

// 「試算する」ボタンから課金モーダルを開く
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-open-paywall]');
  if (btn) openModal(modal, 'btn-fake-pay');
});

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
  const fv20 = futureValue(half, 0.05, 20);
  const detail = LEAK_IDS.filter((id) => d.spend[id] > 0)
    .map((id) => `${itemById(id).label} ${num(d.spend[id])}円`).join(' / ');

  $('insight-leak').innerHTML = `
    <div class="insight">
      <div class="h">この3項目の合計は 月 ${num(leak)}円 = 年 ${num(leak * 12)}円</div>
      <div class="b" style="font-size:12px; color:var(--ink-3);">${detail}</div>
      <span class="big">半分に減らせば 年 ${num(half * 12)}円</span>
      <div class="b">浮いた月${num(half)}円を年5%で20年積み立てると <strong>${manEn(fv20)}</strong>。コーヒー1杯を我慢する話が、20年後にはこの差になります。</div>
    </div>`;
}

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
    const v = mine > 0 && avg > 0 ? verdict(mine, avg) : null;
    const pill = v ? `<span class="pill ${v.cls}"><span class="ic">${v.ic}</span>${v.text}</span>` : '';
    return `
      <div class="cmp-row">
        <div class="cmp-head"><span class="name">${it.label}</span>${pill}</div>
        <div class="cmp-track">
          <div class="cmp-fill" style="width:${Math.min(100, (mine / scale) * 100)}%"></div>
          <div class="cmp-avg" style="left:${Math.min(100, (avg / scale) * 100)}%"></div>
        </div>
        <div class="cmp-foot">
          <span class="mine">あなた ${num(mine)}円</span>
          <span>平均 ${num(avg)}円</span>
        </div>
      </div>`;
  }).join('');

  const avgTotal = d.items.reduce((s, it) => s + avgOf(it), 0);
  const v = verdict(d.total, avgTotal);
  $('cmp-list').innerHTML = rows + `
    <div class="cmp-row" style="border-top:1px solid var(--line); padding-top:15px;">
      <div class="cmp-head">
        <span class="name">支出の合計</span>
        <span class="pill ${v.cls}"><span class="ic">${v.ic}</span>${v.text}</span>
      </div>
      <div class="cmp-foot" style="margin-top:6px;">
        <span class="mine">あなた ${num(d.total)}円</span>
        <span>平均 ${num(avgTotal)}円</span>
      </div>
    </div>`;
  $('cmp-sub').textContent = `濃いバーがあなた、縦線が${LIVING_LABEL[d.living]}の大学生の平均的な金額(目安)です`;
}

$('btn-diagnose').addEventListener('click', diagnose);
$('btn-back-input').addEventListener('click', () => {
  stage = 'input';
  saveProgress();
  goScreen('screen-input', 1);
});

// ============================================================
// 診断タイプ(無料で見せるところ)とポートフォリオ(有料)
// ============================================================
const PORTFOLIOS = {
  stable: {
    label: '安定重視型', emoji: '🛡️', color: 'var(--t-stable)', catch: 'コツコツ堅実タイプ',
    tagline: '減らさないことを最優先に、世界へ広く分散するタイプ',
    freeDesc: '値動きの大きさが不安なあなたには、世界中に広く分散しつつ、値動きがおだやかな業種を厚めにした組み合わせが向いています。まずは「相場が下がっても売らずにいられること」がいちばん大事です。',
    risk: '小さめ', ret: '年3〜4%',
    lead: '同じ株式でも「値動きの荒さ」はテーマで大きく変わります。世界中に薄く広く分散しつつ、値動きが穏やかな業種を厚めにした配分です。',
    comment: 'まずは値動きに慣れることが目的の配分です。1本目は全世界株式インデックス(eMAXIS Slim 全世界株式など)だけで十分機能します。慣れてきたら高配当や生活必需品を足していくと、下落局面での精神的な支えになります。',
    items: [
      { name: '全世界株式インデックス', pct: 60, desc: '先進国から新興国まで数千社にまとめて分散。1本で世界中の株を持てる、迷ったらこれという中核。', ex: '例: eMAXIS Slim 全世界株式(オール・カントリー)' },
      { name: '高配当株(日本・米国)', pct: 25, desc: '配当を出し続ける成熟企業が中心。値上がりは控えめでも、配当が入るので長く持ちやすい。', ex: '例: SBI・V・米国高配当株式 / 日本高配当株ファンド' },
      { name: '生活必需品・ヘルスケア', pct: 15, desc: '食品・日用品・医薬品など、不況でも売れる業種。相場が崩れたときに下がりにくい。', ex: '例: 生活必需品セクターETF' },
    ],
  },
  balance: {
    label: 'バランス型', emoji: '⚖️', color: 'var(--t-balance)', catch: '王道ミックスタイプ',
    tagline: '世界全体を土台に、米国を少し厚めにする王道タイプ',
    freeDesc: '値動きを過度に怖がらないあなたには、世界全体を土台にしつつ実績のある米国株を少し厚めにした、最も再現しやすい組み合わせが向いています。長期の積立で迷ったときの標準形です。',
    risk: '標準', ret: '年4〜6%',
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
    label: '積極型', emoji: '🚀', color: 'var(--t-active)', catch: '攻めの成長タイプ',
    tagline: '時間を武器に、成長テーマへ攻めていくタイプ',
    freeDesc: '下がったら買い増したいと思えるあなたは、成長期待の高いテーマを厚めにできる数少ないタイプです。20〜30年という時間を持っている学生だからこそ選べる組み合わせがあります。',
    risk: '大きめ', ret: '年6〜8%',
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

// ============================================================
// 診断タイプの細分化(全9タイプ)
//
// 「5問のスコア(=リスク許容度)」だけでなく、
// 「投資に回せる余裕額」も掛け合わせて 3 × 3 = 9 タイプに分ける。
//   ・投資の中身(ポートフォリオ)は base の3種で決まる
//   ・タイプ名・性格の説明・色・アイコンは9種類それぞれに持つ
// さらに「支出のクセ」(spendHabit)をタグとして添え、同じタイプでも
// 自分の結果らしさが出るようにしている。
// ============================================================

// 余裕額の3段階。しきい値を変えたいときはここだけ触ればよい
const CAPACITY = [
  { key: 'low',  max: 5000,     label: '余裕額 少なめ', desc: '月5,000円未満' },
  { key: 'mid',  max: 20000,    label: '余裕額 標準',   desc: '月5,000〜20,000円' },
  { key: 'high', max: Infinity, label: '余裕額 多め',   desc: '月20,000円以上' },
];
const capacityKey = (surplus) => CAPACITY.find((c) => surplus < c.max).key;
const capacityOf = (key) => CAPACITY.find((c) => c.key === key);

const PERSONAS = {
  'stable-low': {
    name: 'コツコツ堅実タイプ', emoji: '🐢', color: '#34b58a',
    share: '少額でも毎月続ける習慣がいちばんの武器',
    desc: 'あなたは慎重派で、大きく増やすことよりも「減らさないこと」を大事にするタイプです。今は投資に回せる金額こそ多くありませんが、少額でも毎月続ける習慣そのものが、あなたにとって一番の武器になります。',
  },
  'stable-mid': {
    name: '安全運転ドライバータイプ', emoji: '🛡️', color: '#0f9d6f',
    share: '値動きの穏やかな組み合わせを淡々と続けるのが向いている',
    desc: 'リスクは避けたいけれど、毎月きちんと積み立てられるだけの余裕は持っている、守り上手なタイプです。派手さはなくても、値動きの穏やかな組み合わせを淡々と続けることで着実に資産が育っていきます。',
  },
  'stable-high': {
    name: '石橋を叩いて渡るタイプ', emoji: '🧱', color: '#0b7d51',
    share: '慎重さと投資余力を両方持っている珍しいタイプ',
    desc: '納得できるまで動かない慎重さと、しっかりした投資余力を両方持っている珍しいタイプです。焦って攻める必要はまったくありません。仕組みを理解してから始めれば、その分だけ長く続けられます。',
  },
  'balance-low': {
    name: 'マイペース貯蓄家タイプ', emoji: '🌱', color: '#4a8fd0',
    share: 'まずは相場に慣れる時間を先に手に入れるのが得策',
    desc: '値動きを過度に怖がらない一方で、今は投資に回せる金額が限られているタイプです。無理に金額を増やすより、まずは1,000円からでも始めて「相場に慣れる時間」を先に手に入れるのが得策です。',
  },
  'balance-mid': {
    name: 'バランス感覚の達人タイプ', emoji: '⚖️', color: '#2a6bab',
    share: '投資でいちばん失敗しにくいポジションにいる',
    desc: 'リスクの取り方も家計の使い方も、どちらも極端に振れていない安定感のあるタイプです。投資でいちばん失敗しにくいポジションにいるので、王道の組み合わせをそのまま長く続けるのが向いています。',
  },
  'balance-high': {
    name: '未来設計プランナータイプ', emoji: '📐', color: '#17456f',
    share: '目標から逆算して計画を立てる進め方が効くタイプ',
    desc: '冷静な判断力と、まとまった投資余力の両方を持っているタイプです。毎月の金額を出せるぶん、目標から逆算して計画を立てる進め方がいちばん効きます。20年後の姿から考えてみてください。',
  },
  'active-low': {
    name: '夢を追う挑戦者タイプ', emoji: '🔥', color: '#ef8f2a',
    share: '一発を狙うより「金額を増やす」ことを先に考えたい',
    desc: 'リターンを狙いにいく気持ちが強い一方で、今動かせる金額はまだ小さいタイプです。だからこそ、一発を狙うのではなく「金額を増やす」ことを先に考えると、あなたの積極性が正しく活きてきます。',
  },
  'active-mid': {
    name: '伸びしろハンタータイプ', emoji: '🎯', color: '#d97706',
    share: '成長テーマを厚めにできる条件がそろっている',
    desc: '値動きの大きさを受け入れられて、毎月それなりの金額も出せるタイプです。成長テーマを厚めにできる条件がそろっているので、時間を味方につけるほど結果の差が大きくなっていきます。',
  },
  'active-high': {
    name: '一攫千金チャレンジャータイプ', emoji: '🚀', color: '#b45309',
    share: '攻めの条件がそろった、下落に耐えられるかが勝負',
    desc: '大きく増やすことを狙いにいける、攻めの条件がすべてそろったタイプです。ただし上がる時が大きいぶん下がる時も大きくなります。下落しても売らずに積み立てを続けられるかが唯一の条件です。',
  },
};

// 支出のクセ(タイプ名には影響しないが、結果に「自分らしさ」を足すタグ)
function spendHabit(d) {
  if (!d || d.total === 0) return null;
  const leak = LEAK_IDS.reduce((s, id) => s + d.spend[id], 0);
  const avgTotal = d.items.reduce((s, it) => s + avgOf(it), 0);
  if (leak / d.total >= 0.3) return { key: 'leak', label: 'ゆるみ支出が多め', emoji: '🥤' };
  if (avgTotal > 0 && d.total <= avgTotal * 0.9) return { key: 'thrifty', label: '倹約家', emoji: '🪙' };
  return { key: 'standard', label: '支出は平均的', emoji: '📊' };
}

// リスク3種 × 余裕額3段階 から、9タイプのうち1つを決める
function personaKey(risk, surplus) { return `${risk}-${capacityKey(surplus)}`; }

let selectedRisk = null;
let selectedPersona = null;
let paid = false;
const CAT_VARS = ['--cat-1', '--cat-2', '--cat-3', '--cat-4'];

// --- 無料: タイプ結果カード + 有料の壁 ---
function renderTypeCard(key, score, opts) {
  const scroll = !opts || opts.scroll !== false;
  const p = PORTFOLIOS[key];
  const surplus = state ? state.surplus : 0;
  const capKey = capacityKey(surplus);
  const cap = capacityOf(capKey);
  const pk = `${key}-${capKey}`;
  selectedPersona = pk;
  const per = PERSONAS[pk];
  const habit = spendHabit(state);

  const tags = [
    `<span class="tg">${p.emoji} ${p.label}</span>`,
    `<span class="tg">💰 ${cap.label}(${cap.desc})</span>`,
    habit ? `<span class="tg">${habit.emoji} ${habit.label}</span>` : '',
  ].join('');

  $('type-card-wrap').innerHTML = `
    <div class="type-card" style="background:linear-gradient(150deg, ${per.color} 0%, color-mix(in srgb, ${per.color} 55%, #08243a) 100%)">
      <div class="kicker">YOUR TYPE</div>
      <span class="em">${per.emoji}</span>
      <div class="nm">${per.name}</div>
      <div class="tags">${tags}</div>
      <div class="ds">${per.desc}</div>
      <div class="ds sub">${p.freeDesc}</div>
      <div class="meters">
        <div><div class="k">値動きの大きさ</div><div class="v">${p.risk}</div></div>
        <div><div class="k">想定利回り</div><div class="v">${p.ret}</div></div>
      </div>
    </div>
    ${score != null ? `<div class="score-line">5問の合計スコア <strong>${score}</strong> / 15点(5〜8=安定重視 / 9〜11=バランス / 12〜15=積極)× 投資に回せる余裕額 <strong>${num(surplus)}</strong>円 → 全9タイプから判定</div>` : ''}`;
  linkifyTerms($('type-card-wrap'));

  renderAnswers();
  renderTypeAvg();              // 無料の締め: 同じタイプの人との比較
  renderSocial();               // タイプが決まってからでないと文面が作れない
  $('lock-type').textContent = per.name;
  renderPeek(p);
  renderReviews();              // 課金の直前に利用者の声を出す
  renderFaq();
  $('paywall-zone').hidden = false;
  if (scroll && !reduceMotion()) {
    $('paywall-zone').scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }
}

// 「なぜこのタイプになったのか」を自分で確かめられるようにする
function renderAnswers() {
  if (quizAnswers.some((a) => a === null)) { $('answers-wrap').innerHTML = ''; return; }
  const rows = QUIZ.map((item, i) => {
    const o = item.opts[quizAnswers[i]];
    return `
      <div class="answer-row">
        <span class="qn">Q${i + 1}</span>
        <span><span class="qt">${item.q}</span><span class="at">${o.t}</span></span>
        <span class="sc">${o.s}点</span>
      </div>`;
  }).join('');
  $('answers-wrap').innerHTML = `
    <details class="answers">
      <summary>あなたの回答を見る ▾</summary>
      ${rows}
    </details>`;
}

// ブラーの向こうに見える「中身のプレビュー」も、選んだタイプの実データで作る
function renderPeek(p) {
  const colors = p.items.map((_, i) => cssVar(CAT_VARS[i]));
  $('peek-bar').innerHTML = p.items.map((it, i) =>
    `<div style="width:${it.pct}%; background:${colors[i]}"></div>`).join('');
  $('peek-rows').innerHTML = p.items.map((it, i) => `
    <div class="peek-row">
      <span class="sw" style="background:${colors[i]}"></span>
      <span class="nm">${it.name}</span>
      <span class="pc">${it.pct}%</span>
    </div>`).join('');
}

// ============================================================
// 投資タイプ診断(5問)
// 各選択肢のスコア: 安定寄り=1 / 中間=2 / 積極寄り=3
// 合計5〜15点で最終タイプを判定する
// ============================================================
const QUIZ = [
  {
    q: '投資したお金が1年で20%下がったら、どうしますか?',
    opts: [
      { t: 'すぐ売る', d: 'これ以上減るのは耐えられない', s: 1 },
      { t: 'しばらく様子を見る', d: 'そのうち戻ると思うので放っておく', s: 2 },
      { t: 'むしろ買い増したい', d: '安く買えるチャンスだと考える', s: 3 },
    ],
  },
  {
    q: '今すぐ使う予定のないお金。何年くらい、使わずにおいておけそうですか?',
    opts: [
      { t: '1〜2年以内には使いたい', d: '近いうちに使う予定がある', s: 1 },
      { t: '5年くらいは大丈夫', d: '当面は手をつけないでいられる', s: 2 },
      { t: '10年以上は使う予定がない', d: '完全に余裕資金として置いておける', s: 3 },
    ],
  },
  {
    q: '投資に対するイメージ、いちばん近いのはどれですか?',
    opts: [
      { t: '減るのが怖い', d: 'とにかく元本を減らしたくない', s: 1 },
      { t: '多少の増減は仕方ない', d: '上下しながら増えればいい', s: 2 },
      { t: '大きく増えるなら大きく減ってもいい', d: 'リターンを優先したい', s: 3 },
    ],
  },
  {
    q: '収入が急に減ったら、生活はどれくらい苦しくなりそうですか?',
    opts: [
      { t: 'かなり苦しい', d: '毎月の収入がないと回らない', s: 1 },
      { t: '多少は苦しいが何とかなる', d: '節約すれば乗り切れる', s: 2 },
      { t: '貯金があるので余裕がある', d: '数ヶ月は問題なく生活できる', s: 3 },
    ],
  },
  {
    q: '友達が「株で大儲けした」と聞いたら、どう感じますか?',
    opts: [
      { t: '自分には関係ない', d: 'リスクは避けたい', s: 1 },
      { t: '羨ましいけど自分は慎重に', d: '真似はせず自分のペースでいく', s: 2 },
      { t: '自分もやってみたい', d: 'チャンスがあるなら乗りたい', s: 3 },
    ],
  },
];

// 合計スコアからタイプを決める(5〜8=安定 / 9〜11=バランス / 12〜15=積極)
function typeFromScore(total) {
  if (total <= 8) return 'stable';
  if (total <= 11) return 'balance';
  return 'active';
}

const MARKS = ['A', 'B', 'C'];
let quizIndex = 0;
const quizAnswers = new Array(QUIZ.length).fill(null);

function renderQuiz() {
  const done = quizAnswers.every((a) => a !== null);
  $('quiz-progress').hidden = done;
  $('quiz-hint').hidden = done;
  $('btn-quiz-back').hidden = done || quizIndex === 0;
  $('btn-quiz-retry').hidden = !done;

  if (done) {
    $('quiz-body').innerHTML = '';
    $('quiz-sub').textContent = '5問すべてに答えました。結果は下のとおりです';
    return;
  }

  const item = QUIZ[quizIndex];
  $('quiz-sub').textContent = '5つの質問に答えるだけ。1分ほどで終わります';
  $('quiz-fill').style.width = (quizIndex / QUIZ.length) * 100 + '%';
  $('quiz-num').textContent = `${quizIndex + 1} / ${QUIZ.length}`;

  $('quiz-body').innerHTML = `
    <div class="quiz-body-anim">
      <div class="quiz-q"><span class="qn">Q${quizIndex + 1}</span><br>${item.q}</div>
      <div class="quiz-opts">
        ${item.opts.map((o, i) => `
          <button class="quiz-opt${quizAnswers[quizIndex] === i ? ' picked' : ''}" data-opt="${i}">
            <span class="mk">${MARKS[i]}</span>
            <span><span class="ot">${o.t}</span><span class="od">${o.d}</span></span>
          </button>`).join('')}
      </div>
    </div>`;
}

function answerQuiz(optIndex) {
  quizAnswers[quizIndex] = optIndex;
  // 選んだことが分かるよう一瞬見せてから次へ進む
  const btn = $('quiz-body').querySelector(`[data-opt="${optIndex}"]`);
  if (btn) {
    $('quiz-body').querySelectorAll('.quiz-opt').forEach((b) => b.classList.remove('picked'));
    btn.classList.add('picked');
  }
  const wait = reduceMotion() ? 0 : 260;
  setTimeout(() => {
    if (quizIndex < QUIZ.length - 1) {
      quizIndex++;
      renderQuiz();
      renderProgress();
      saveProgress();       // 1問ごとに保存しておく
    } else {
      finishQuiz();
    }
  }, wait);
}

function finishQuiz() {
  const total = quizAnswers.reduce((s, a, i) => s + QUIZ[i].opts[a].s, 0);
  selectedRisk = typeFromScore(total);
  $('quiz-fill').style.width = '100%';
  renderQuiz();
  renderTypeCard(selectedRisk, total);
  if (paid) renderPortfolio(selectedRisk);   // 購入後に受け直したら有料側も作り直す
  renderProgress();
  clearProgress();          // 診断が完了したので、途中データはもう不要
}

$('quiz-body').addEventListener('click', (e) => {
  const btn = e.target.closest('.quiz-opt');
  if (btn) answerQuiz(Number(btn.dataset.opt));
});

// 1・2・3キーでも答えられるようにする(テンポよく5問こなせる)
document.addEventListener('keydown', (e) => {
  if (currentScreen !== 'screen-result') return;
  if (e.target.closest('input, textarea, select')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (quizAnswers.every((a) => a !== null)) return;
  const n = ['1', '2', '3'].indexOf(e.key);
  if (n === -1) return;
  const btn = $('quiz-body').querySelector(`[data-opt="${n}"]`);
  if (btn) { e.preventDefault(); answerQuiz(n); }
});

$('btn-quiz-back').addEventListener('click', () => {
  if (quizIndex > 0) { quizIndex--; renderQuiz(); renderProgress(); saveProgress(); }
});

$('btn-quiz-retry').addEventListener('click', () => {
  quizAnswers.fill(null);
  quizIndex = 0;
  selectedRisk = null;
  selectedPersona = null;
  $('type-card-wrap').innerHTML = '';
  $('answers-wrap').innerHTML = '';
  $('social-card').hidden = true;
  $('typeavg-card').hidden = true;
  $('social-note-free').hidden = true;
  $('social-note-paid').hidden = true;
  $('faq-card').hidden = true;
  $('reviews-card').hidden = true;
  $('paywall-zone').hidden = true;
  renderQuiz();
  renderProgress();
  saveProgress();           // 受け直しはやり直しなので、また途中データとして保存する
  $('quiz-card').scrollIntoView?.({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
});

// --- 有料: 具体的な投資信託の提案 ---
function renderPortfolio(key) {
  const p = PORTFOLIOS[key];
  const colors = p.items.map((_, i) => cssVar(CAT_VARS[i]));

  $('port-sub').textContent = `${p.label}のあなたへ。${p.tagline}`;
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

  $('port-comment').innerHTML = `<strong>${p.lead}</strong><br><br>${p.comment}`;

  linkifyTerms($('port-list'));
  linkifyTerms($('port-comment'));
  renderTodo();
}

// ============================================================
// 診断人数カウンター
// 実際の利用者数が取れるようになったら DIAGNOSED を書き換える
// ============================================================
const DIAGNOSED = {
  base: 12480,               // 起点となる人数(ここを実数に差し替える)
  since: '2026-09-01',       // base を数えた日
  perDay: 34,                // 1日あたりの増加ペース(見せかけ)
};

// 日が経つほど少しずつ増えて見えるようにした擬似的な人数
function diagnosedCount() {
  const days = Math.max(0, Math.floor((Date.now() - new Date(DIAGNOSED.since).getTime()) / 86400000));
  return DIAGNOSED.base + days * DIAGNOSED.perDay;
}

function renderCounter() {
  countUp($('counter-num'), diagnosedCount(), 1400);
}
function renderCounterInline() {
  countUp($('counter-num-2'), diagnosedCount(), 900);
}

// ============================================================
// よくある質問(FAQ)
// ============================================================
const FAQ_ITEMS = [
  {
    q: 'この診断は本当に当たっていますか?',
    a: '占いではなく、入力していただいた収支と5問の回答をもとに計算しています。' +
       '毎月の余裕額は「収入 − 入力された支出」、投資タイプは5問の合計スコア(5〜15点)で判定しています。' +
       'ただし将来の運用結果まで当てられるものではありません。利回り3%/5%/7%はあくまで仮定の数字で、' +
       '実際にその通りになる保証はない点だけは正直にお伝えしておきます。',
  },
  {
    q: '支払い方法は何がありますか?',
    a: 'クレジットカード(Visa / Mastercard / JCB / American Express)を予定しています。' +
       '¥300の買い切りで、月額課金や追加料金は一切ありません。' +
       'なお現在のバージョンは動作を試すためのもので、実際の決済は行われません(ボタンを押しても課金されません)。',
  },
  {
    q: '診断結果は保存できますか?',
    a: '「シェア」タブから、診断結果のカードを画像(PNG)として保存できます。' +
       'サイズは1080×1920pxで、Instagramのストーリーズにそのまま貼れます。' +
       'また、診断の途中でブラウザを閉じても、入力内容はこの端末の中に自動保存されているので、' +
       '次に開いたときに「続きから再開しますか?」と聞かれます(診断が終わると保存データは消えます)。' +
       'ただし別のスマホやPCには引き継がれないので、あとから見返したい場合は画像を保存しておいてください。',
  },
  {
    q: '投資の知識が全くなくても大丈夫ですか?',
    a: 'むしろ、これから始める人向けに作っています。専門用語には点線が引いてあり、' +
       'タップすると意味が出るようにしました。' +
       'また「今月からやることリスト」では、口座開設 → 商品選び → 積立設定の順に、' +
       '何をすればいいかを1ステップずつ案内します。知識ゼロから順番になぞれる形になっています。',
  },
];

function renderFaq() {
  $('faq-list').innerHTML = FAQ_ITEMS.map((f) => `
    <details class="faq-item">
      <summary><span class="qq">Q</span><span>${f.q}</span><span class="ch">▼</span></summary>
      <div class="faq-a">${f.a}</div>
    </details>`).join('');
  linkifyTerms($('faq-list'));
  $('faq-card').hidden = false;
}

// ============================================================
// 同じタイプの人の平均データ(無料の締め・有料への導線)
//
// 数値はすべてダミー。実データが取れたらここを差し替える。
// avg   : 平均して月いくら投資に回しているか
// mix   : 内訳(有料で見せる)
// plan  : このタイプがよく選ぶ投資プラン(有料で見せる)
// years : 続けている平均期間(有料で見せる)
// ============================================================
const TYPE_STATS = {
  'stable-low':   { avg: 3200,  mix: '積立 70% / 現金 30%', plan: '全世界株式インデックス1本', years: '1年2ヶ月' },
  'stable-mid':   { avg: 9800,  mix: '積立 75% / 現金 25%', plan: '全世界株式＋高配当株',       years: '1年8ヶ月' },
  'stable-high':  { avg: 24500, mix: '積立 70% / 現金 30%', plan: '全世界株式＋生活必需品',     years: '2年1ヶ月' },
  'balance-low':  { avg: 3800,  mix: '積立 80% / 現金 20%', plan: '全世界株式インデックス1本', years: '1年0ヶ月' },
  'balance-mid':  { avg: 11500, mix: '積立 80% / 現金 20%', plan: '全世界株式＋S&P500',        years: '1年7ヶ月' },
  'balance-high': { avg: 28000, mix: '積立 78% / 現金 22%', plan: '全世界株式＋S&P500＋新興国', years: '2年4ヶ月' },
  'active-low':   { avg: 4500,  mix: '積立 85% / 現金 15%', plan: 'S&P500インデックス1本',     years: '0年11ヶ月' },
  'active-mid':   { avg: 13200, mix: '積立 85% / 現金 15%', plan: 'S&P500＋米国ハイテク',       years: '1年5ヶ月' },
  'active-high':  { avg: 32000, mix: '積立 88% / 現金 12%', plan: 'S&P500＋米国ハイテク＋新興国', years: '2年0ヶ月' },
};

function renderTypeAvg() {
  const per = PERSONAS[selectedPersona];
  const st = TYPE_STATS[selectedPersona];
  if (!per || !st) { $('typeavg-card').hidden = true; return; }

  const mine = state ? state.surplus : 0;
  const diff = mine - st.avg;
  const near = Math.abs(diff) < 1000;      // 1,000円以内は「ほぼ同じ」とみなす

  let cls, icon, comment;
  if (near) {
    cls = 'same'; icon = '⚖️';
    comment = `あなたは同じタイプの平均と<strong>ほぼ同じ</strong>です。周りと同じペースで始められる位置にいます。`;
  } else if (diff > 0) {
    cls = 'over'; icon = '📈';
    comment = `あなたは平均より <strong>月${num(diff)}円 多い</strong>です。` +
      `そのぶん早く増やせる位置にいますが、金額を上げるより<strong>続けること</strong>のほうが結果に効きます。`;
  } else {
    cls = 'under'; icon = '🌱';
    comment = `あなたは平均より <strong>月${num(-diff)}円 少ない</strong>です。` +
      `ただし平均に合わせる必要はありません。無理な金額にすると途中でやめることになり、そのほうが損になります。`;
  }

  $('typeavg-card').innerHTML = `
    <h2 class="section-title"><span class="ic">📊</span>同じタイプの人は、どうしている?</h2>
    <p class="section-sub">あなたと同じ<strong>${per.name}</strong>の人のデータです</p>
    <div class="ta-hero">
      <div class="ta-box you">
        <div class="k">あなたが回せる額</div>
        <div class="v">${num(mine)}<small>円</small></div>
      </div>
      <span class="ta-vs">VS</span>
      <div class="ta-box avg">
        <div class="k">同じタイプの平均</div>
        <div class="v">${num(st.avg)}<small>円</small></div>
      </div>
    </div>
    <div class="ta-comment ${cls}"><span>${icon}</span><span>${comment}</span></div>

    <div class="locked mini">
      <div class="locked-peek" aria-hidden="true">
        <div class="peek-title">${per.name}の平均的な内訳</div>
        <div class="peek-line"><span class="lb">投資と現金の比率</span><span class="vl">${st.mix}</span></div>
        <div class="peek-line"><span class="lb">よく選ばれている投資プラン</span><span class="vl">${st.plan}</span></div>
        <div class="peek-line"><span class="lb">続けている平均期間</span><span class="vl">${st.years}</span></div>
        <div class="peek-chart" style="margin-top:14px;">
          <i style="height:38%"></i><i style="height:52%"></i><i style="height:61%"></i>
          <i style="height:74%"></i><i style="height:88%"></i><i style="height:100%"></i>
        </div>
      </div>
      <div class="locked-overlay">
        <div class="lockic">🔒</div>
        <h3>もっと詳しい内訳を見る</h3>
        <div class="sub">同じ<strong>${per.name}</strong>の人が実際にどう投資しているか</div>
        <ul class="unlock-list">
          <li>投資に回している金額の内訳(積立と現金の比率)</li>
          <li>このタイプがよく選んでいる投資プランと商品名</li>
          <li>あなたの金額に合わせた積立シミュレーション</li>
        </ul>
        <button class="btn-unlock-mini" data-open-paywall>¥300で全部見る →</button>
      </div>
    </div>
    <p style="font-size:11px; color:var(--ink-3); margin:12px 0 0;">
      ※平均値はサンプル用の参考値です。実際の利用者データではありません。
    </p>`;
  $('typeavg-card').hidden = false;
}

// ============================================================
// SNSシェア(LINE / Instagram / X)
//
// 公開したら SHARE_SITE.url に公開URLを入れる。空のままなら、
// http(s) で開いているときだけ今のURLを使う。
// file:// で開いている場合は端末のパス(ユーザー名を含む)が漏れるので使わない。
// ============================================================
const SHARE_SITE = {
  url: '',                       // 例: 'https://toshi-debut.vercel.app'
  hashtag: '投資デビュー診断',
};

function shareUrl() {
  if (SHARE_SITE.url) return SHARE_SITE.url;
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    return location.origin + location.pathname;
  }
  return '';                     // ローカルのファイルを直接開いているとき
}

// 受け取った人が「自分もやってみたい」と思える文面にする
function shareText() {
  const per = PERSONAS[selectedPersona];
  if (!per) return `大学生のための投資デビュー診断。3分で自分の投資タイプがわかります #${SHARE_SITE.hashtag}`;
  return `私の投資タイプは「${per.name}」でした${per.emoji}\n${per.share}\nあなたも3分で診断してみて #${SHARE_SITE.hashtag}`;
}

const SOCIAL_ICONS = {
  // LINE: 吹き出し / X: Xのロゴ / Instagram: カメラ
  line: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.62 2 11.07c0 3.98 3.57 7.31 8.39 7.94.33.07.77.22.88.5.1.25.07.64.03.89l-.14.86c-.04.25-.2.99.87.54 1.07-.45 5.75-3.39 7.85-5.8C21.28 14.4 22 12.83 22 11.07 22 6.62 17.5 3 12 3zM8.2 13.6H6.11a.4.4 0 0 1-.4-.4V9.02a.4.4 0 0 1 .81 0v3.78H8.2a.4.4 0 0 1 0 .8zm1.6-.4a.4.4 0 0 1-.81 0V9.02a.4.4 0 0 1 .81 0v4.18zm4.9 0a.4.4 0 0 1-.72.24l-2.14-2.92v2.68a.4.4 0 0 1-.81 0V9.02a.4.4 0 0 1 .72-.24l2.14 2.92V9.02a.4.4 0 0 1 .81 0v4.18zm3.2-2.49a.4.4 0 0 1 0 .8h-1.28v.89h1.28a.4.4 0 0 1 0 .8H16.2a.4.4 0 0 1-.4-.4V9.02a.4.4 0 0 1 .4-.4h1.7a.4.4 0 0 1 0 .8h-1.29v.89h1.29z"/></svg>',
  x:    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41z"/></svg>',
  ig:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.8 3.8 0 0 1-1.38-.9 3.8 3.8 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zm0 1.98c-3.15 0-3.5.01-4.74.07-1.14.05-1.76.24-2.18.4-.55.21-.94.47-1.35.88-.41.41-.67.8-.88 1.35-.16.42-.35 1.04-.4 2.18-.06 1.24-.07 1.59-.07 4.74s.01 3.5.07 4.74c.05 1.14.24 1.76.4 2.18.21.55.47.94.88 1.35.41.41.8.67 1.35.88.42.16 1.04.35 2.18.4 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c1.14-.05 1.76-.24 2.18-.4.55-.21.94-.47 1.35-.88.41-.41.67-.8.88-1.35.16-.42.35-1.04.4-2.18.06-1.24.07-1.59.07-4.74s-.01-3.5-.07-4.74c-.05-1.14-.24-1.76-.4-2.18a3.6 3.6 0 0 0-.88-1.35 3.6 3.6 0 0 0-1.35-.88c-.42-.16-1.04-.35-2.18-.4-1.24-.06-1.59-.07-4.74-.07zm0 3.37a5.49 5.49 0 1 1 0 10.98 5.49 5.49 0 0 1 0-10.98zm0 9.05a3.56 3.56 0 1 0 0-7.12 3.56 3.56 0 0 0 0 7.12zm6.99-9.27a1.28 1.28 0 1 1-2.57 0 1.28 1.28 0 0 1 2.57 0z"/></svg>',
};

function socialHtml() {
  const url = shareUrl();
  const text = shareText();
  // LINE: URLがあるときは公式の共有プラグイン、無いときはテキストだけ送るスキームに切り替える
  const lineHref = url
    ? `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
    : `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
  const xHref = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) +
    (url ? '&url=' + encodeURIComponent(url) : '');

  return `
    <a class="social-btn line" id="btn-share-line" href="${lineHref}" target="_blank" rel="noopener noreferrer">
      ${SOCIAL_ICONS.line}<span>LINE</span>
    </a>
    <a class="social-btn x" id="btn-share-x" href="${xHref}" target="_blank" rel="noopener noreferrer">
      ${SOCIAL_ICONS.x}<span>X</span>
    </a>
    <button class="social-btn ig" data-share="ig" type="button">
      ${SOCIAL_ICONS.ig}<span>Instagram</span>
    </button>`;
}

function renderSocial() {
  const html = socialHtml();
  ['social-free', 'social-paid'].forEach((id) => { if ($(id)) $(id).innerHTML = html; });
  $('social-card').hidden = false;
}

// Instagram は外から直接投稿できる共有URLが用意されていないので、
// 画像を保存してもらってストーリーズに貼る流れを案内する
function shareToInstagram(noteId) {
  const note = $(noteId);
  downloadShareCard(() => {
    note.innerHTML = '<span>📸</span><span><strong>診断結果の画像を保存しました。</strong>' +
      'Instagramのストーリーズに投稿してシェアしてください。' +
      '(スマホで保存できなかった場合は、下の「結果カードを作る」から画像を長押しして保存できます)</span>';
    note.hidden = false;
  });
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-share="ig"]');
  if (!btn) return;
  shareToInstagram(btn.closest('#social-paid') ? 'social-note-paid' : 'social-note-free');
});

// ============================================================
// 利用者の声
// 実際の声に差し替えるときは、この配列を書き換えるだけでよい
// ============================================================
const REVIEWS = [
  { name: 'K.S', attr: '大学2年・20歳', stars: 5,
    text: '自分の投資タイプが分かって面白かった。バランス型って言われて納得。何から買えばいいか迷わなくなりました。' },
  { name: 'M.T', attr: '大学3年・21歳', stars: 5,
    text: 'サブスクとコンビニだけで月1万円使ってたのが衝撃。300円でここまで分かるのはお得だと思う。' },
  { name: 'R.A', attr: '大学1年・19歳', stars: 4,
    text: '実家暮らしでも項目が合っていて入力しやすかった。やることリストの通りに口座開設まで進めました。' },
  { name: 'Y.N', attr: '大学4年・22歳', stars: 5,
    text: '「あと月1,000円で20年後に41万円変わる」が刺さった。金額を上げるモチベーションになります。' },
  { name: 'H.K', attr: '大学院1年・23歳', stars: 5,
    text: '留学資金の目標から毎月いくら必要か逆算できるのが良い。ぼんやりした目標が数字になりました。' },
];

function renderReviews() {
  $('reviews-list').innerHTML = REVIEWS.map((r) => `
    <div class="review">
      <div class="stars" aria-label="5段階中${r.stars}">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div>
      <div class="rt">${r.text}</div>
      <div class="who">
        <span class="av">${r.name.charAt(0)}</span>
        <span><span class="nm">${r.name}</span><br><span class="at">${r.attr}</span></span>
      </div>
    </div>`).join('');
  $('reviews-card').hidden = false;
  renderCounterInline();
}

// ============================================================
// 課金導線(ダミー)
// ============================================================
const modal = $('paywall-modal');

// ダイアログを開くときは、閉じたあとに元のボタンへフォーカスを戻せるよう覚えておく
let lastFocused = null;
function openModal(el, focusId) {
  lastFocused = document.activeElement;
  el.hidden = false;
  $(focusId)?.focus?.();
}
function closeModal(el) {
  el.hidden = true;
  lastFocused?.focus?.();
  lastFocused = null;
}

$('btn-open-paywall').addEventListener('click', () => openModal(modal, 'btn-fake-pay'));
$('btn-close-modal').addEventListener('click', () => closeModal(modal));
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal); });

// Escキーで閉じられるようにする(スマホの外付けキーボードやPCで詰まらないため)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('resume-modal').hidden) { $('resume-modal').hidden = true; return; }
  if (!modal.hidden) closeModal(modal);
  else if (!tip.hidden) tip.hidden = true;
});

$('btn-fake-pay').addEventListener('click', () => {
  modal.hidden = true;
  paid = true;
  renderSocial();               // 有料側のシェアボタンも用意する
  renderPortfolio(selectedRisk || 'balance');
  refreshSim();
  goScreen('screen-premium', 3);
  showTab('sim');
});

$('btn-back-result').addEventListener('click', () => goScreen('screen-result', 2));

// ============================================================
// 有料のタブ切り替え
// ============================================================
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('selected', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;          // タブ列全体を Tab キー1回で通り抜けられるようにする
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    const on = p.dataset.panel === name;
    p.hidden = !on;
    if (on) { p.style.animation = 'none'; void p.offsetWidth; p.style.animation = ''; }
  });
  if (name === 'sim' && chart) chart.resize();   // 隠れている間にサイズが取れないため
}

$('tabbar').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) showTab(tab.dataset.tab);
});

// 左右の矢印キーでタブを移動できるようにする
$('tabbar').addEventListener('keydown', (e) => {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const tabs = [...document.querySelectorAll('.tab')];
  const now = tabs.findIndex((t) => t.classList.contains('selected'));
  const next = tabs[(now + step + tabs.length) % tabs.length];
  showTab(next.dataset.tab);
  next.focus();
});

// ============================================================
// 積立シミュレーション
// ============================================================
const RATES = [0.03, 0.05, 0.07];

function futureValue(monthlyAmt, annualRate, yrs) {
  const i = annualRate / 12;
  const n = yrs * 12;
  return i === 0 ? monthlyAmt * n : monthlyAmt * (((1 + i) ** n - 1) / i);
}
function fvSeries(monthlyAmt, annualRate, yrs) {
  const out = [];
  for (let y = 0; y <= yrs; y++) out.push(futureValue(monthlyAmt, annualRate, y));
  return out;
}

let monthly = 10000;
let years = 20;
let baseRate = 0.05;
let compareMode = false;

// skipInput: 入力欄そのものを打っている最中は値を書き戻さない(カーソルが飛ぶため)
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
  renderTodo();
  renderGoal();
}

const monthlyRange = $('sim-monthly-range');
const monthlyInput = $('sim-monthly');
monthlyRange.addEventListener('input', () => { setMonthly(Number(monthlyRange.value)); refreshSim(); });
bindMoney(monthlyInput, (n) => { monthly = n; syncMonthlyUI(true); refreshSim(); });
onEnterCommit(monthlyInput, () => refreshSim());

$('sim-years-range').addEventListener('input', () => {
  years = Number($('sim-years-range').value);
  refreshSim();
});

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

// 棒グラフに出す年の区切り(5年後・10年後…のようにキリよく4本前後にする)
function milestones(y) {
  if (y <= 6) return Array.from({ length: y }, (_, i) => i + 1);
  const step = Math.max(1, Math.round(y / 4));
  const out = [];
  for (let k = step; k < y; k += step) out.push(k);
  out.push(y);
  return [...new Set(out)];
}

function buildChart() {
  const s = RATES.map((r) => fvSeries(monthly, r, years));
  const principal = Array.from({ length: years + 1 }, (_, y) => monthly * y * 12);
  const rateColors = [cssVar('--series-3'), cssVar('--series-5'), cssVar('--series-7')];
  const baseIdx = RATES.findIndex((r) => Math.abs(r - baseRate) < 1e-9);

  const marks = milestones(years);
  const labels = marks.map((y) => `${y}年後`);
  const colPrincipal = cssVar('--cat-1');   // 元本
  const colGain = cssVar('--cat-3');        // 運用益

  let datasets;
  let legendItems;

  if (compareMode) {
    // 比較モード:利回りごとの合計額を並べた棒グラフ
    datasets = RATES.map((r, i) => ({
      label: `年${Math.round(r * 100)}%`,
      data: marks.map((y) => Math.round(s[i][y])),
      backgroundColor: rateColors[i],
      borderRadius: 6,
      borderSkipped: false,
    }));
    legendItems = RATES.map((r, i) => ({
      key: `年${Math.round(r * 100)}%`, color: rateColors[i], val: s[i][years],
    }));
  } else {
    // 既定:元本と運用益を1本の棒の中で積み上げる
    datasets = [
      {
        label: '元本(積み立てた分)',
        data: marks.map((y) => Math.round(principal[y])),
        backgroundColor: colPrincipal,
        borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 },
        borderSkipped: false,
      },
      {
        label: '運用益(増えた分)',
        data: marks.map((y) => Math.round(s[baseIdx][y] - principal[y])),
        backgroundColor: colGain,
        borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
        borderSkipped: false,
      },
    ];
    legendItems = [
      { key: '元本', color: colPrincipal, val: principal[years], block: true },
      { key: '運用益', color: colGain, val: s[baseIdx][years] - principal[years], block: true },
    ];
  }

  // グラフの部品(Chart.js)はCDNから読み込んでいるので、
  // オフラインや通信の失敗で無いことがある。そのときは数字と表だけで成立させる
  if (typeof Chart === 'undefined') {
    $('chart-fallback').hidden = false;
    $('sim-chart').hidden = true;
    $('table-wrap').hidden = false;
    $('btn-toggle-table').textContent = '表を閉じる ▴';
    finishChart();
    return;
  }
  $('chart-fallback').hidden = true;
  $('sim-chart').hidden = false;

  if (chart) chart.destroy();
  chart = new Chart($('sim-chart').getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: reduceMotion() ? 0 : 320 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar('--navy-deep'),
          titleColor: '#fff',
          bodyColor: 'rgba(255,255,255,.9)',
          footerColor: '#7fe3b8',
          padding: 12,
          cornerRadius: 10,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${yen(ctx.parsed.y)}`,
            // 積み上げのときは合計も出す
            footer: (items) => (compareMode ? '' :
              '合計: ' + yen(items.reduce((sum, it) => sum + it.parsed.y, 0))),
          },
        },
      },
      scales: {
        x: {
          stacked: !compareMode,
          grid: { display: false },
          ticks: { color: cssVar('--ink-3'), font: { size: 11.5, weight: '700' } },
        },
        y: {
          stacked: !compareMode,
          beginAtZero: true,
          grid: { color: cssVar('--line') },
          border: { display: false },
          ticks: { color: cssVar('--ink-3'), font: { size: 11 }, maxTicksLimit: 5, callback: (v) => manEn(v) },
        },
      },
    },
  });

  finishChart();

  // 凡例・合計額・表は、グラフが描けたかどうかに関係なく必ず出す
  function finishChart() {
    // 凡例に終了時点の金額を直接表示(色だけに意味を持たせない)
    $('chart-legend').innerHTML = legendItems.map((x) => `
      <div class="item">
        <span class="swatch${x.block ? ' block' : ''}" style="background:${x.color}"></span>
        ${x.key} <span class="val">${manEn(x.val)}</span>
      </div>`).join('');

    const main = s[baseIdx][years];
    const prin = principal[years];
    $('fv-main').textContent = manEn(main);
    $('fv-gain').textContent = manEn(main - prin);
    $('fv-principal').textContent = manEn(prin);

    renderTable(principal, s, compareMode ? RATES.map((_, i) => i) : [baseIdx]);
  }
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

// 「あと◯円」比較
const BOOSTS = [1000, 3000, 5000];
function renderBoost() {
  $('boost-sub').textContent = `積立額を増やしたときの、${years}年後の差額です(年${Math.round(baseRate * 100)}%で試算)`;
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
  $('boost-note').textContent = `月1,000円は1日あたり約33円です。それでも${years}年で${manEn(futureValue(1000, baseRate, years))}の差になります。`;
}

// ============================================================
// 行動ガイド(チェックリスト)
// ============================================================
const TODO_KEY = 'toshi-debut-todo';
function loadTodo() { try { return JSON.parse(localStorage.getItem(TODO_KEY)) || {}; } catch (e) { return {}; } }
function saveTodo(d) { try { localStorage.setItem(TODO_KEY, JSON.stringify(d)); } catch (e) { /* 保存できなくても動作は続く */ } }
let todoDone = loadTodo();

function todoSteps() {
  const p = PORTFOLIOS[selectedRisk || 'balance'];
  const first = p.items[0];
  return [
    { id: 'account', title: `証券口座と${term('nisa', 'NISA')}口座を同時に申し込む`,
      body: 'SBI証券・楽天証券・マネックス証券などから1社選ぶ。スマホとマイナンバーカードがあれば申込は15〜20分、開設まで最短で翌営業日。口座の開設・維持はすべて無料。' },
    { id: 'fund', title: `1本目に「${first.name}」を候補にする`,
      body: `${first.ex}。${term('index', 'インデックスファンド')}なので、これ1本でも自動的に${term('bunsan', '分散投資')}になる。最初から${p.items.length}本そろえる必要はなく、まず1本で始めてOK。` },
    { id: 'auto', title: `毎月 ${num(monthly)}円 の自動積立を設定する`,
      body: `${term('tsumitate', 'つみたて投資枠')}を選び、毎月同じ日に自動で買う設定にする(${term('kureka', 'クレカ積立')}にするとポイントも貯まる)。金額はあとから何度でも変えられるので、迷ったら少なめから。` },
    { id: 'nowatch', title: '設定したら、アプリを閉じて放置する',
      body: `毎日値動きを見ると、下がったときに売りたくなる。${term('drip', 'ドルコスト平均法')}は「見ないで続ける」ほど効く。確認は月1回で十分。` },
    { id: 'review', title: '半年後に、金額を見直す',
      body: `半年続けて家計が苦しくなければ月+1,000〜3,000円だけ増やす。${term('fukuri', '複利')}は期間が命なので、早く始めて長く続けるほど結果が変わる。` },
  ];
}

function renderTodo() {
  const steps = todoSteps();
  const p = PORTFOLIOS[selectedRisk || 'balance'];
  const perName = (PERSONAS[selectedPersona] || {}).name || p.label;
  $('todo-sub').innerHTML = `<strong>${perName}</strong>のあなた向けの手順です。終わったらタップしてチェックを付けてください`;

  $('todo-list').innerHTML = steps.map((s, i) => `
    <div class="todo-item${todoDone[s.id] ? ' done' : ''}" data-todo="${s.id}" role="checkbox"
         tabindex="0" aria-checked="${todoDone[s.id] ? 'true' : 'false'}">
      <span class="todo-check">✓</span>
      <div>
        <div class="todo-no">STEP ${i + 1}</div>
        <div class="todo-title">${s.title}</div>
        <div class="todo-body">${s.body}</div>
      </div>
    </div>`).join('');
  linkifyTerms($('todo-list'));

  const n = steps.filter((s) => todoDone[s.id]).length;
  $('todo-fill').style.width = (n / steps.length) * 100 + '%';
  $('todo-label').textContent = `${n} / ${steps.length}`;
  $('todo-done').hidden = n < steps.length;
}

function toggleTodo(el) {
  todoDone[el.dataset.todo] = !todoDone[el.dataset.todo];
  saveTodo(todoDone);
  renderTodo();
}
$('todo-list').addEventListener('click', (e) => {
  if (e.target.closest('.term')) return;   // 用語の説明を開くときはチェックしない
  const item = e.target.closest('.todo-item');
  if (item) toggleTodo(item);
});
$('todo-list').addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  const item = e.target.closest('.todo-item');
  if (item) { e.preventDefault(); toggleTodo(item); }
});

// ============================================================
// 「なりたい将来」から逆算
// ============================================================
const GOALS = [
  { id: 'study',  label: '🌍 留学したい',       amount: 1500000,  years: 3 },
  { id: 'car',    label: '🚗 車を買いたい',     amount: 2500000,  years: 8 },
  { id: 'travel', label: '✈️ 世界一周したい',   amount: 3000000,  years: 6 },
  { id: 'wed',    label: '💍 結婚資金',         amount: 4000000,  years: 10 },
  { id: 'house',  label: '🏙️ タワマンの頭金',  amount: 15000000, years: 15 },
  { id: 'fire',   label: '🔥 早期リタイア',     amount: 30000000, years: 25 },
  { id: 'free',   label: '✏️ 自分で決める',     amount: null,     years: null },
];

let goalId = 'car';
let goalAmount = 2500000;
let goalYears = 8;

// 目標額に届くのに必要な毎月の積立額
function requiredMonthly(target, annualRate, yrs) {
  const i = annualRate / 12;
  const n = yrs * 12;
  if (n <= 0) return target;
  return i === 0 ? target / n : target / (((1 + i) ** n - 1) / i);
}

// 今の積立額のままだと何ヶ月かかるか(届かないなら null)
function monthsToReach(target, annualRate, perMonth) {
  if (perMonth <= 0) return null;
  const i = annualRate / 12;
  if (i === 0) return target / perMonth;
  const inner = 1 + (target * i) / perMonth;
  if (inner <= 1) return null;
  const m = Math.log(inner) / Math.log(1 + i);
  return m > 1200 ? null : m;   // 100年を超えるなら「届かない」扱い
}

const yearsMonths = (m) => {
  const t = Math.ceil(m);
  const y = Math.floor(t / 12), mo = t % 12;
  return mo === 0 ? `${y}年` : `${y}年${mo}ヶ月`;
};

$('goal-chips').innerHTML = GOALS.map((g) =>
  `<button class="chip${g.id === goalId ? ' selected' : ''}" data-goal="${g.id}">${g.label}</button>`).join('');

$('goal-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  goalId = chip.dataset.goal;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c.dataset.goal === goalId));
  const g = GOALS.find((x) => x.id === goalId);
  if (g.amount != null) {
    goalAmount = g.amount;
    goalYears = g.years;
    $('goal-amount').value = commas(goalAmount);
    $('goal-years').value = goalYears;
  }
  renderGoal();
});

bindMoney($('goal-amount'), (n) => { goalAmount = n; markCustomGoal(); renderGoal(); });
$('goal-years').addEventListener('input', () => {
  goalYears = Number($('goal-years').value);
  markCustomGoal();
  renderGoal();
});

// プリセットの数字から離れたら「自分で決める」に切り替える
function markCustomGoal() {
  const g = GOALS.find((x) => x.id === goalId);
  if (!g || g.amount == null) return;
  if (g.amount !== goalAmount || g.years !== goalYears) {
    goalId = 'free';
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c.dataset.goal === 'free'));
  }
}

function renderGoal() {
  $('goal-amount-label').textContent = '¥' + num(goalAmount);
  $('goal-years-label').textContent = goalYears + '年後';

  // 必要額は切り上げる(切り捨てると、その額を積み立てても目標にわずかに届かない)
  const need = Math.ceil(requiredMonthly(goalAmount, baseRate, goalYears));
  const savedOnly = Math.ceil(goalAmount / (goalYears * 12));
  const ratePct = Math.round(baseRate * 100);

  const head = `
    <div class="goal-need">
      <div class="lb">${goalYears}年後に ${manEn(goalAmount)} を用意するには</div>
      <div class="amt">毎月 ${num(need)}<small>円</small></div>
      <div class="sb">年${ratePct}%で運用できた場合 / 貯金だけなら毎月 ${num(savedOnly)}円 必要</div>
    </div>`;

  const diff = need - monthly;
  const reach = monthsToReach(goalAmount, baseRate, monthly);
  let gap;

  if (monthly <= 0) {
    gap = `
      <div class="gap-box short">
        <div class="gh">まだ積立額が0円です</div>
        <div class="gb">「積立試算」タブで毎月の積立額を設定すると、目標との差が出ます。</div>
      </div>`;
  } else if (diff <= 0) {
    const early = reach == null ? null : goalYears * 12 - reach;
    gap = `
      <div class="gap-box ok">
        <div class="gh">🎉 今のペースで達成できます</div>
        <span class="gbig">${reach == null ? '' : yearsMonths(reach)}で到達</span>
        <div class="gb">
          現在の積立額 ${num(monthly)}円は、必要額 ${num(need)}円を ${num(-diff)}円 上回っています。
          ${early != null && early > 0 ? `目標より <strong>${yearsMonths(early)}早く</strong>届く計算です。` : ''}
        </div>
      </div>`;
  } else {
    const delay = reach == null ? null : reach - goalYears * 12;
    gap = `
      <div class="gap-box short">
        <div class="gh">今のペースだと足りません</div>
        <span class="gbig">あと 毎月 ${num(diff)}円</span>
        <div class="gb">
          現在の積立額 ${num(monthly)}円のままだと、
          ${reach == null
            ? '現実的な期間では目標に届きません。目標額を下げるか、期間を延ばしてみてください。'
            : `到達は <strong>${yearsMonths(reach)}後</strong>。目標より <strong>${yearsMonths(delay)}遅れる</strong>計算です。`}
        </div>
        <button class="btn-apply" id="btn-apply-goal">毎月 ${num(need)}円 で試算してみる</button>
      </div>`;
  }

  const scale = Math.max(need, monthly, state ? state.surplus : 0) * 1.1 || 1;
  const bar = (label, val, color) => `
    <div class="goal-bar-row">
      <div class="gl">${label}<span class="gv">${num(val)}円/月</span></div>
      <div class="gt"><div class="gf" style="width:${Math.min(100, (val / scale) * 100)}%; background:${color}"></div></div>
    </div>`;

  $('goal-result').innerHTML = head + gap + `
    <div class="goal-bars">
      ${bar('目標に必要な積立額', need, 'var(--navy)')}
      ${bar('いまの積立設定', monthly, 'var(--mint)')}
      ${state ? bar('無料診断で出た余力', state.surplus, 'var(--series-3)') : ''}
    </div>`;

  const apply = $('btn-apply-goal');
  if (apply) {
    apply.addEventListener('click', () => {
      setMonthly(need);
      refreshSim();
    });
  }
}

// ============================================================
// SNSシェア用カード(Instagram ストーリーズ 1080×1920)
// 端末のダークモードに左右されないよう、配色は固定値で描く
// ============================================================
const FONT = '"Yu Gothic", "Hiragino Sans", Meiryo, system-ui, sans-serif';
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const CAT_HEX = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

// 長いタイプ名でもはみ出さないよう、幅に収まるまで文字サイズを下げる
function fitFont(ctx, text, maxW, startPx, minPx) {
  let size = startPx;
  ctx.font = `bold ${size}px ${FONT}`;
  while (size > minPx && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = `bold ${size}px ${FONT}`;
  }
  return size;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawShareCard() {
  const cv = $('share-canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, PAD = 88;
  const key = selectedRisk || 'balance';
  const p = PORTFOLIOS[key];
  const per = PERSONAS[selectedPersona] || PERSONAS[`${key}-mid`];
  const accent = per.color;

  // 背景
  const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, '#123a5e');
  g.addColorStop(1, '#071a2c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // タイプ色のにじみ
  const glow = ctx.createRadialGradient(W * 0.78, 260, 0, W * 0.78, 260, 520);
  glow.addColorStop(0, accent + '66');
  glow.addColorStop(1, accent + '00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 900);

  ctx.textAlign = 'left';

  // ロゴ
  ctx.fillStyle = '#0fa36b';
  ctx.beginPath(); ctx.arc(PAD + 11, 148, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.font = `bold 30px ${FONT}`;
  ctx.fillText('TOSHI  DEBUT  —  投資デビュー診断', PAD + 36, 158);

  // タイプ
  ctx.textAlign = 'center';
  ctx.font = `72px ${EMOJI_FONT}`;
  ctx.fillText(per.emoji, W / 2, 320);

  ctx.fillStyle = 'rgba(255,255,255,.62)';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillText('あなたの投資タイプは', W / 2, 392);

  // タイプ名は9種類あり長さがばらつくので、幅に合わせて自動で縮める
  ctx.fillStyle = '#ffffff';
  fitFont(ctx, per.name, W - PAD * 2, 88, 44);
  ctx.fillText(per.name, W / 2, 490);

  // ベースになるリスクタイプのバッジ
  const badge = `${p.emoji} ${p.label}`;
  ctx.font = `bold 30px ${FONT}`;
  const bw = ctx.measureText(badge).width + 64;
  ctx.fillStyle = accent;
  roundRect(ctx, W / 2 - bw / 2, 522, bw, 60, 30); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(badge, W / 2, 562);

  // 数字カード2枚
  const boxW = (W - PAD * 2 - 24) / 2;
  const boxY = 650, boxH = 210;
  const stat = (x, label, value, sub, color) => {
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    roundRect(ctx, x, boxY, boxW, boxH, 22); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.66)';
    ctx.font = `24px ${FONT}`;
    ctx.fillText(label, x + boxW / 2, boxY + 52);
    ctx.fillStyle = color;
    ctx.font = `bold 54px ${FONT}`;
    ctx.fillText(value, x + boxW / 2, boxY + 122);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = `22px ${FONT}`;
    ctx.fillText(sub, x + boxW / 2, boxY + 166);
  };
  const fv = futureValue(monthly, baseRate, years);
  stat(PAD, '毎月の積立額', num(monthly) + '円', '無理のない範囲で', '#ffffff');
  stat(PAD + boxW + 24, `${years}年後の資産`, manEn(fv), `年${Math.round(baseRate * 100)}%で試算`, '#5fd7a8');

  // グラフカード
  const cx = PAD, cy = 910, cw = W - PAD * 2, ch = 420;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cx, cy, cw, ch, 24); ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#47596b';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillText(`資産の推移(年${Math.round(baseRate * 100)}%で試算)`, cx + 40, cy + 48);
  drawMiniChart(ctx, cx + 40, cy + 86, cw - 80, ch - 176);

  // ポートフォリオ(有料の中身なので、購入前はここを出さない)
  if (!paid) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = `30px ${FONT}`;
    ctx.fillText('あなたに合う投資プランは', W / 2, 1470);
    ctx.fillText('アプリの中で確認できます', W / 2, 1520);
    ctx.font = `bold 26px ${FONT}`;
    ctx.fillStyle = accent;
    ctx.fillText('全9タイプ / 診断は無料', W / 2, 1600);
    ctx.textAlign = 'left';
    drawShareFooter(ctx, W, PAD);
    return;
  }

  ctx.fillStyle = 'rgba(255,255,255,.66)';
  ctx.font = `26px ${FONT}`;
  ctx.fillText('おすすめの組み合わせ', PAD, 1418);

  let bx = PAD;
  const pbw = W - PAD * 2, pbh = 52, pby = 1444;
  p.items.forEach((it, i) => {
    const w = (pbw * it.pct) / 100 - 5;
    ctx.fillStyle = CAT_HEX[i];
    roundRect(ctx, bx, pby, w, pbh, 10); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(it.pct + '%', bx + w / 2, pby + 35);
    ctx.textAlign = 'left';
    bx += w + 5;
  });

  p.items.forEach((it, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = PAD + col * (pbw / 2), ly = 1570 + row * 58;
    ctx.fillStyle = CAT_HEX[i];
    roundRect(ctx, lx, ly - 18, 22, 22, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = `25px ${FONT}`;
    ctx.fillText(`${it.name} ${it.pct}%`, lx + 34, ly);
  });

  drawShareFooter(ctx, W, PAD);
}

function drawShareFooter(ctx, W, PAD) {
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, 1728); ctx.lineTo(W - PAD, 1728); ctx.stroke();
  ctx.fillStyle = '#5fd7a8';
  ctx.font = `bold 34px ${FONT}`;
  ctx.fillText(`#${SHARE_SITE.hashtag}`, W / 2, 1794);
  ctx.fillStyle = 'rgba(255,255,255,.42)';
  ctx.font = `20px ${FONT}`;
  ctx.fillText('※簡易試算です。将来の運用成果を保証するものではありません。', W / 2, 1842);
  ctx.textAlign = 'left';
}

// カード内の積み上げ棒グラフ(Chart.jsは使わず自前で描く。画面のグラフと同じ見せ方)
function drawMiniChart(ctx, x, y, w, h) {
  const baseIdx = RATES.findIndex((r) => Math.abs(r - baseRate) < 1e-9);
  const total = fvSeries(monthly, RATES[baseIdx], years);
  const marks = milestones(years);
  const max = Math.max(1, total[years]);
  const py = (v) => y + h - (h * v) / max;

  ctx.strokeStyle = '#e3eaf1';
  ctx.lineWidth = 1.5;
  for (let g = 0; g <= 4; g++) {
    const gy = y + (h * g) / 4;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
  }

  const slot = w / marks.length;
  const bw = Math.min(78, slot * 0.56);
  marks.forEach((m, i) => {
    const cx = x + slot * (i + 0.5);
    const prin = monthly * m * 12;
    const yTop = py(total[m]);
    const yMid = py(prin);
    const yBase = py(0);

    ctx.fillStyle = '#1baf7a';                       // 運用益
    roundRect(ctx, cx - bw / 2, yTop, bw, Math.max(2, yMid - yTop), 8); ctx.fill();
    ctx.fillStyle = '#2a78d6';                       // 元本
    ctx.fillRect(cx - bw / 2, yMid, bw, Math.max(2, yBase - yMid));

    ctx.textAlign = 'center';
    ctx.fillStyle = '#0c1c2c';
    ctx.font = `bold 21px ${FONT}`;
    ctx.fillText(manEn(total[m]), cx, yTop - 12);
    ctx.fillStyle = '#7b8b9c';
    ctx.font = `20px ${FONT}`;
    ctx.fillText(`${m}年後`, cx, y + h + 32);
  });
  ctx.textAlign = 'left';

  // 凡例
  const lg = (lx, color, label) => {
    ctx.fillStyle = color;
    roundRect(ctx, lx, y + h + 52, 18, 18, 5); ctx.fill();
    ctx.fillStyle = '#47596b';
    ctx.font = `20px ${FONT}`;
    ctx.fillText(label, lx + 27, y + h + 68);
  };
  lg(x, '#2a78d6', '元本');
  lg(x + 150, '#1baf7a', '運用益');
}

$('btn-make-card').addEventListener('click', () => {
  drawShareCard();
  $('share-preview').src = $('share-canvas').toDataURL('image/png');
  $('share-frame').hidden = false;
  $('btn-download-card').hidden = false;
});

// 結果カードを描いて、PNGとして保存させる(Instagramシェアからも使う)
function downloadShareCard(onDone) {
  drawShareCard();
  $('share-canvas').toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '投資デビュー診断.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onDone?.();
  }, 'image/png');
}

$('btn-download-card').addEventListener('click', () => downloadShareCard());

// ============================================================
// 途中データの自動保存と再開(離脱防止)
//
// localStorage = ブラウザの中にある小さな保存領域。サーバーには送られず、
// この端末のこのブラウザにだけ残る(別のスマホやPCには引き継がれない)。
// 保存するのは「収支入力の内容」と「5問の回答」だけ。
// 診断が完了(タイプ確定)したら、その時点で保存データは消す。
// ============================================================
const SAVE_KEY = 'toshi-debut-progress';
const SAVE_VERSION = 1;
let saveEnabled = true;   // 復元中は保存を止める(途中の状態で上書きしないため)
let stage = 'input';      // 'input'(収支入力中) / 'result'(診断中)

function saveProgress() {
  if (!saveEnabled) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_VERSION,
      at: Date.now(),
      stage, living, values, quizIndex,
      quizAnswers: quizAnswers.slice(),
    }));
  } catch (e) { /* プライベートモード等で保存できない場合は何もしない */ }
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.v !== SAVE_VERSION || !s.living) return null;
    // すでに5問すべて答え終わっているデータは「完了済み」なので復元しない
    if (Array.isArray(s.quizAnswers) && s.quizAnswers.every((a) => a !== null)) return null;
    return s;
  } catch (e) { return null; }
}

function clearProgress() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
}

// 保存データから「どこまで進んだか」を組み立てる(再開ダイアログに出す)
function progressSummary(s) {
  const answered = (s.quizAnswers || []).filter((a) => a !== null).length;
  const filled = Object.keys(s.values || {}).filter((k) => s.values[k] > 0).length;
  const rows = [
    ['🏠', '住まい', LIVING_LABEL[s.living] || '—'],
    ['📝', '入力した項目', `${filled}件`],
    ['🧭', '診断の回答', answered === 0 ? 'まだ' : `${answered} / ${QUIZ.length}問`],
  ];
  return rows.map(([k, label, v]) =>
    `<div class="ri"><span class="k">${k}</span><span>${label}</span><strong style="margin-left:auto">${v}</strong></div>`).join('');
}

function whenText(at) {
  const min = Math.floor((Date.now() - at) / 60000);
  if (min < 1) return 'さきほどの入力内容が残っています';
  if (min < 60) return `${min}分前の入力内容が残っています`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前の入力内容が残っています`;
  return `${Math.floor(h / 24)}日前の入力内容が残っています`;
}

function restoreProgress(s) {
  saveEnabled = false;
  Object.keys(values).forEach((k) => { values[k] = 0; });
  Object.assign(values, s.values || {});
  (s.quizAnswers || []).forEach((a, i) => { quizAnswers[i] = a; });
  quizIndex = Math.min(s.quizIndex || 0, QUIZ.length - 1);
  setLiving(s.living);                 // 住まいに合った入力欄を金額つきで作り直す
  saveEnabled = true;

  if (s.stage === 'result') {
    diagnose();                        // 診断結果の画面を組み立ててそこへ移動する
    renderQuiz();                      // 途中まで答えた設問から再開する
  } else {
    goScreen('screen-input', 1);
  }
  saveProgress();
}

// --- 進捗の常時表示 ---
// 住まいの選択=10% / 収支の診断=40% / 5問の回答=各12% で 100%
function progressState() {
  const answered = quizAnswers.filter((a) => a !== null).length;
  if (currentScreen === 'screen-premium') return { pct: 100, label: '💎 詳細プラン' };
  if (currentScreen === 'screen-result') {
    if (answered >= QUIZ.length) return { pct: 100, label: '✅ 診断完了' };
    return { pct: 40 + answered * 12, label: `🧭 診断中(${answered + 1}/${QUIZ.length}問)` };
  }
  if (!living) return { pct: 0, label: '📝 住まいを選ぶ' };
  return { pct: 10, label: '📝 収支を入力中' };
}

function renderProgress() {
  const onIntro = currentScreen === 'screen-intro';
  $('progress-strip').hidden = onIntro;
  if (onIntro) return;
  const p = progressState();
  $('progress-label').textContent = p.label;
  $('progress-fill').style.width = p.pct + '%';
  $('progress-pct').textContent = p.pct + '%';
}

// --- 再開ダイアログ ---
function askResume() {
  const s = loadProgress();
  if (!s) return;
  $('resume-when').textContent = whenText(s.at);
  $('resume-info').innerHTML = progressSummary(s);
  openModal($('resume-modal'), 'btn-resume-yes');

  $('btn-resume-yes').addEventListener('click', () => {
    $('resume-modal').hidden = true;
    restoreProgress(s);
  }, { once: true });

  $('btn-resume-no').addEventListener('click', () => {
    $('resume-modal').hidden = true;
    clearProgress();               // 最初からやり直すので保存データは捨てる
  }, { once: true });
}

// ============================================================
// 初期表示
// ============================================================
setMonthly(10000);
renderTodo();
renderGoal();
renderQuiz();
renderCounter();
renderProgress();
try { history.replaceState({ screen: 'screen-intro', step: 0 }, ''); } catch (e) { }
askResume();
