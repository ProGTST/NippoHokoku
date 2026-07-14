// ============================================================================
// 日報アプリ 実機診断プローブ（メール取得元 & 名称4照合の成立性を確認する）
// ----------------------------------------------------------------------------
// 使い方:
//   1) Microsoft SSO でログイン済みの状態で
//      https://rkanri.genech.co.jp/kanri/nippo を開く（Edge/Chrome 推奨）
//   2) F12 → Console タブを開く
//   3) このファイルの中身を全部貼り付けて Enter
//   4) 出力された JSON を丸ごとコピーして共有してください
//
//   ※ 自分のログインID(英字)が分かっている場合は、下の MY_LOGIN_ID に
//      設定すると照合テストが確実になります（例: 'tsuchidas'）。空でも可。
// ============================================================================
(async () => {
  const MY_LOGIN_ID = 'tsuchidas'; // 例: 'tsuchidas'（分かれば設定。空なら DOM から自動推測）

  const report = { ranAt: new Date().toISOString(), url: location.href, origin: location.origin };

  const emailReG = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g; // 抽出用（/g）
  const hasEmail = (s) => /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(String(s)); // 判定用（非/g）
  const idKeyRe =
    /(email|e-mail|mail|upn|userprincipalname|preferred_username|username|user_name|loginid|login_id|account)/i;

  // --- 1) 現行方式の確認: P-XXXXXX を持つ input を列挙 ---------------------
  const pCodeInputs = [];
  document.querySelectorAll('input').forEach((el) => {
    const v = (el.value || '').trim();
    if (/^P-\d{6}$/.test(v)) pCodeInputs.push({ value: v, name: el.name || '', id: el.id || '' });
  });
  report.pCodeInputs = pCodeInputs;

  // --- 2) メール/UPN/ログインID の露出調査 --------------------------------
  const emailsInDom = new Set();
  (String(document.body && document.body.innerText).match(emailReG) || []).forEach((m) =>
    emailsInDom.add(m)
  );
  document.querySelectorAll('*').forEach((el) => {
    for (const a of el.attributes || [])
      (String(a.value).match(emailReG) || []).forEach((m) => emailsInDom.add(m));
    if (el.value) (String(el.value).match(emailReG) || []).forEach((m) => emailsInDom.add(m));
  });
  report.emailsInDom = [...emailsInDom];

  // window グローバルを浅く走査（ユーザー情報っぽいオブジェクト）
  const globalHits = {};
  try {
    for (const k of Object.keys(window)) {
      let v;
      try {
        v = window[k];
      } catch (e) {
        continue;
      }
      if (v && typeof v === 'object') {
        let s;
        try {
          s = JSON.stringify(v);
        } catch (e) {
          continue;
        }
        if (s && (hasEmail(s) || idKeyRe.test(s)))
          globalHits[k] = s.length > 800 ? s.slice(0, 800) + '…' : s;
      }
    }
  } catch (e) {}
  report.globalObjectsWithIdentity = globalHits;

  // localStorage / sessionStorage（MSAL キャッシュ等）
  const scanStore = (store) => {
    const out = {};
    try {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        const val = store.getItem(key) || '';
        if (idKeyRe.test(key) || hasEmail(val))
          out[key] = val.length > 400 ? val.slice(0, 400) + '…' : val;
      }
    } catch (e) {}
    return out;
  };
  report.localStorageHits = scanStore(localStorage);
  report.sessionStorageHits = scanStore(sessionStorage);

  // meta タグ（<meta name="user-email"> 等でサーバーが埋め込む場合がある）
  const metaHits = {};
  document.querySelectorAll('meta[name], meta[property]').forEach((m) => {
    const key = m.getAttribute('name') || m.getAttribute('property') || '';
    const val = m.getAttribute('content') || '';
    if (idKeyRe.test(key) || hasEmail(val)) metaHits[key] = val;
  });
  report.metaTagHits = metaHits;

  // --- 3) getTantoList 全件取得 + 名称4 の充足状況 -------------------------
  try {
    const m = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
    const xsrf = m ? decodeURIComponent(m[1]) : '';
    const res = await fetch('/kanri/nippo/getTantoList', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'x-xsrf-token': xsrf
      },
      body: JSON.stringify({ svalue: '' }),
      credentials: 'include'
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = text;
    }
    const rows = Array.isArray(data) ? data : (data && data.data) || [];
    const isArr = Array.isArray(rows);
    report.tantoList = {
      httpOk: res.ok,
      status: res.status,
      returnedType: isArr ? 'array' : typeof data,
      count: isArr ? rows.length : 'N/A',
      keys: isArr && rows[0] ? Object.keys(rows[0]) : [],
      has名称4: isArr ? rows.filter((r) => r && r['名称4']).length : 0,
      名称4サンプル: isArr
        ? rows.slice(0, 5).map((r) => ({ key: r.key, 名称1: r['名称1'], 名称4: r['名称4'] }))
        : data
    };

    // --- 4) 自分のログインID vs 名称4 の照合テスト ------------------------
    let local = MY_LOGIN_ID.trim().toLowerCase();
    let source = 'MY_LOGIN_ID（手入力）';
    if (!local && emailsInDom.size) {
      local = [...emailsInDom][0].split('@')[0].toLowerCase();
      source = 'DOMから検出したメールのローカル部';
    }
    if (local && isArr) {
      const hits = rows.filter((r) => r && String(r['名称4'] || '').toLowerCase() === local);
      report.matchTest = {
        source,
        使用したlocal: local,
        hitCount: hits.length,
        hits: hits.map((r) => ({ key: r.key, 名称1: r['名称1'], 名称4: r['名称4'] }))
      };
    } else {
      report.matchTest = {
        source,
        使用したlocal: local || '(不明)',
        note: 'ログインIDが特定できず照合スキップ。MY_LOGIN_ID を設定して再実行してください。'
      };
    }
  } catch (e) {
    report.tantoListError = String((e && e.message) || e);
  }

  console.log('=== 日報アプリ 実機診断レポート（この JSON を丸ごと共有してください）===');
  console.log(JSON.stringify(report, null, 2));
  return report;
})();
