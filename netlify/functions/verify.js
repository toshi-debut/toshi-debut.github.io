// ============================================================
// 支払いが本物かどうかを確認するプログラム
//
// 【何のためにあるか】
//   本体(index.html + app.js)は GitHub Pages に置いてあり、サーバーが無い。
//   そのため「お金を払った人かどうか」をブラウザの中でしか判断できず、
//   URL に手で ?paid=1 と付けるだけで有料機能が開いてしまっていた。
//
//   このプログラムだけを Netlify に置き、支払い後にアプリから
//   「この支払い番号は本当に決済されたものですか?」と問い合わせる。
//   Stripe に直接聞いて確かめるので、偽の ?paid=1 は通らなくなる。
//
// 【シークレットキーの扱い】
//   Stripe に問い合わせるには sk_ で始まるシークレットキーが必要になる。
//   これは絶対にコードに書かない。Netlify の管理画面で環境変数として登録し、
//   このプログラムの中からだけ読み出す。ブラウザには一切送られない。
//
//     Netlify の管理画面 → Site configuration → Environment variables
//       STRIPE_SECRET_KEY_TEST … テスト用 (sk_test_ で始まる)
//       STRIPE_SECRET_KEY_LIVE … 本番用   (sk_live_ で始まる)
//
//   支払い番号が cs_test_ で始まればテスト用、cs_live_ なら本番用を使う。
//   両方登録しておけば、本番に切り替えるときにこのファイルを直す必要はない。
//
// 【返す内容】
//   { paid: true / false } だけ。
//   Stripe から返ってくる購入者のメールアドレスなどは一切外に出さない。
// ============================================================

// このプログラムを呼び出してよいのは本体サイトだけに限定する
const ALLOWED_ORIGIN = 'https://toshi-debut.github.io';

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  // ブラウザが本番のリクエストの前に投げてくる事前確認
  if (event.httpMethod === 'OPTIONS') return reply(204, {});
  if (event.httpMethod !== 'GET') return reply(405, { paid: false, error: 'method' });

  // ------------------------------------------------------------
  // 設定の切り分け用  ?debug=1
  //
  // 環境変数が届いているかどうかだけを返す。
  //
  // 【絶対にやってはいけないこと】
  //   環境変数の「名前の一覧」を返さないこと。
  //   キーを名前の欄に貼ってしまう設定ミスがあると、名前の一覧に
  //   キーそのものが載り、この応答から誰でも読めてしまう。
  //   実際に一度それが起きたので、名前は返さない作りに直した。
  // ------------------------------------------------------------
  if ((event.queryStringParameters || {}).debug === '1') {
    return reply(200, {
      hasTestKey: !!process.env.STRIPE_SECRET_KEY_TEST,
      hasLiveKey: !!process.env.STRIPE_SECRET_KEY_LIVE,
    });
  }

  const id = ((event.queryStringParameters || {}).session_id || '').trim();

  // Stripe の支払い番号の形になっていないものは、問い合わせる前に弾く
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) {
    return reply(400, { paid: false, error: 'bad_session_id' });
  }

  const key = id.startsWith('cs_test_')
    ? process.env.STRIPE_SECRET_KEY_TEST
    : process.env.STRIPE_SECRET_KEY_LIVE;

  if (!key) return reply(500, { paid: false, error: 'key_not_set' });

  try {
    const res = await fetch(
      'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(id),
      { headers: { Authorization: 'Bearer ' + key } }
    );

    // 存在しない支払い番号を指定された場合など
    if (!res.ok) return reply(200, { paid: false, error: 'not_found' });

    const session = await res.json();

    // paid = 支払い済み / no_payment_required = 金額0円のときなど
    const paid = session.payment_status === 'paid'
      || session.payment_status === 'no_payment_required';

    // 購入者の情報は返さない。必要なのは「払われたかどうか」だけ
    return reply(200, { paid, mode: session.livemode ? 'live' : 'test' });
  } catch (e) {
    return reply(200, { paid: false, error: 'network' });
  }
};
