'use strict';

// ---- 定数（現行仕様.md より） --------------------------------------------
const SAGYO_NAIYO = ['', '1.管理', '2.PJ会議', '2.PJレビュー', '3.調査・分析',
  '4.要件定義', '5..設計', '6.開発・構築', '7.テスト', '8.ドキュメント作成',
  '9.リリース対応', '※作業待ち', '※プレ・見積', '※不具合', '※問い合わせ',
  '※社内会議', '※レビュー支援', '※学習・教育', '※その他'];
const SAGYO_SHINCHOKU = ['', '順調', 'やや遅れ', '遅れ'];

// 登録・更新で送信する全11項目
const FORM_FIELDS = ['nippoCd', 'tanto', 'date', 'ankenCd', 'torihikisakiMei',
  'ankenMei', 'sagyoNaiyo', 'sagyozikan', 'sagyoShinchoku', 'okureHokoku', 'sonotaHokoku'];

// ---- 要素参照 -------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const rk = $('rk');               // <webview>
let webReady = false;

// ---- 初期化 ---------------------------------------------------------------
function initSelects() {
  const naiyo = $('sagyoNaiyo');
  SAGYO_NAIYO.forEach(v => naiyo.appendChild(new Option(v || '(空欄)', v)));
  const sinchoku = $('sagyoShinchoku');
  SAGYO_SHINCHOKU.forEach(v => sinchoku.appendChild(new Option(v || '(空欄)', v)));
  sinchoku.value = '順調'; // 既定値
}

function fmtDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// ---- webview 状態 ---------------------------------------------------------
rk.addEventListener('dom-ready', () => {
  webReady = true;
  setConn('ok', '接続OK（ページ読込済み）');
});
rk.addEventListener('did-fail-load', (e) => {
  if (e.errorCode === -3) return; // ABORTED（リダイレクト等）は無視
  webReady = false;
  setConn('ng', `読込失敗: ${e.errorDescription || e.errorCode}`);
});
rk.addEventListener('did-start-loading', () => setConn('warn', '読み込み中…'));

function setConn(state, text) {
  const dot = $('connDot');
  dot.className = 'dot' + (state === 'ok' ? ' ok' : state === 'ng' ? ' ng' : '');
  $('connText').textContent = text;
}

// ---- 中核: rkanri のページコンテキストで API を実行 -----------------------
// webview.executeJavaScript は「対象ページのオリジン」で実行されるため、
// same-origin fetch + Cookie(credentials) + XSRF トークンがそのまま効く。
function buildInjection(endpoint, body) {
  const url = '/kanri/nippo/' + endpoint;
  const bodyStr = JSON.stringify(body);
  return `(async () => {
    try {
      const m = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
      const xsrf = m ? decodeURIComponent(m[1]) : '';
      const res = await fetch(${JSON.stringify(url)}, {
        method: 'POST',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'content-type': 'application/json',
          'x-xsrf-token': xsrf
        },
        body: ${JSON.stringify(bodyStr)},
        credentials: 'include'
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch (e) { data = text; }
      return { ok: res.ok, status: res.status, url: res.url, hasToken: !!xsrf, data };
    } catch (e) {
      return { ok: false, status: 0, error: String(e && e.message || e) };
    }
  })()`;
}

async function callApi(endpoint, body, label) {
  if (!webReady) {
    toast('埋め込みブラウザの準備中です。ログイン後に再度お試しください。', 'ng');
    return null;
  }
  $('outStatus').textContent = `${endpoint} 実行中…`;
  try {
    const result = await rk.executeJavaScript(buildInjection(endpoint, body));
    showResult(endpoint, label, body, result);
    return result;
  } catch (e) {
    $('outStatus').textContent = `実行エラー: ${e.message}`;
    toast('実行エラー: ' + e.message, 'ng');
    return null;
  }
}

// ---- 結果表示 -------------------------------------------------------------
function showResult(endpoint, label, reqBody, result) {
  $('outLabel').textContent = label || endpoint;
  $('jsonOut').textContent = JSON.stringify(result, null, 2);

  if (!result) return;
  // ログイン切れ検出（HTML が返る / login へリダイレクト）
  if (typeof result.data === 'string' && /<html|<!doctype|login/i.test(result.data)) {
    $('outStatus').textContent = 'ログインが必要です（下の画面でログインしてください）';
    setConn('warn', '未ログインの可能性');
    $('tableWrap').innerHTML = '';
    toast('ログインが必要です。下の画面でログインしてください。', 'ng');
    return;
  }
  const status = result.ok ? `OK (${result.status})` : `NG (${result.status})`;
  $('outStatus').textContent = status + (result.hasToken ? '' : ' / XSRFトークン未取得');

  renderTable(endpoint, result.data);
  if (result.ok) toast(`${label || endpoint}: 成功`, 'ok');
  else toast(`${label || endpoint}: ${status}`, 'ng');
}

function renderTable(endpoint, data) {
  const wrap = $('tableWrap');
  wrap.innerHTML = '';
  if (!Array.isArray(data) || data.length === 0) {
    wrap.innerHTML = '<div class="muted" style="padding:8px;">（一覧データなし）</div>';
    return;
  }
  const cols = Object.keys(data[0]);
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  cols.forEach(c => { const th = document.createElement('th'); th.textContent = c; htr.appendChild(th); });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  data.forEach(rowObj => {
    const tr = document.createElement('tr');
    cols.forEach(c => {
      const td = document.createElement('td');
      const v = rowObj[c];
      td.textContent = v == null ? '' : String(v);
      if (typeof v === 'number' || /時間|作業時間/.test(c)) td.className = 'num';
      tr.appendChild(td);
    });
    tr.addEventListener('click', () => onRowClick(endpoint, rowObj));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

// 行クリック時の反映（現行仕様の setAnken / setTanto 相当）
function onRowClick(endpoint, row) {
  if (endpoint === 'getNippoList') {
    // 日報行 → 編集モードへ（setAnken(row, row.日報コード) 相当）
    setVal('ankenCd', row['案件コード']);
    setVal('torihikisakiMei', row['取引先名']);
    setVal('ankenMei', row['案件名']);
    setVal('nippoCd', row['日報コード']);
    setVal('date', row['日付']);
    setVal('sagyoNaiyo', row['作業内容']);
    setVal('sagyozikan', row['作業時間']);
    setVal('sagyoShinchoku', row['作業進捗']);
    setVal('okureHokoku', row['遅れ報告']);
    setVal('sonotaHokoku', row['その他報告事項']);
    updateMode();
    toast('日報を編集フォームに読み込みました', 'ok');
  } else if (endpoint === 'gethistory') {
    // 案件行 → 案件情報のみ反映（setAnken(sd) 相当）
    setVal('ankenCd', row['案件コード']);
    setVal('torihikisakiMei', row['取引先名']);
    setVal('ankenMei', row['案件名']);
    toast('案件を反映しました', 'ok');
  } else if (endpoint === 'getTantoList') {
    // 担当行 → 担当者切替（setTanto 相当。キー: key / 名称1）
    setVal('tanto', row['key']);
    setVal('tantoName', row['名称1']);
    toast('担当者を切り替えました', 'ok');
  }
}

// ---- フォーム操作 ---------------------------------------------------------
function setVal(id, v) { const el = $(id); if (el) el.value = v == null ? '' : v; }
function getVal(id) { return ($(id)?.value ?? '').toString(); }

function collectForm() {
  const o = {};
  FORM_FIELDS.forEach(f => { o[f] = getVal(f); });
  return o;
}

function clearForm(keepAnken = false) {
  setVal('nippoCd', '');
  setVal('date', '');
  if (!keepAnken) {
    setVal('ankenCd', ''); setVal('torihikisakiMei', ''); setVal('ankenMei', '');
  }
  setVal('sagyoNaiyo', '');
  setVal('sagyozikan', '');
  $('sagyoShinchoku').value = '順調';
  setVal('okureHokoku', '');
  setVal('sonotaHokoku', '');
  updateMode();
}

function updateMode() {
  const isEdit = getVal('nippoCd').trim() !== '';
  const badge = $('modeBadge');
  badge.textContent = isEdit ? '編集モード' : '新規モード';
  badge.className = 'badge ' + (isEdit ? 'edit' : 'new');
}

// 現行仕様の checkError() 相当
function checkError() {
  if (getVal('tanto').trim() === '') return '担当者が未入力です';
  if (getVal('date').trim() === '') return '日付が未入力です';
  if (isNaN(new Date(getVal('date')).getDate())) return '日付が不正です';
  if (getVal('sagyoNaiyo').trim() === '') return '作業内容が未入力です';
  if (getVal('sagyozikan').trim() === '') return '作業時間が未入力です';
  if (isNaN(Number(getVal('sagyozikan')))) return '作業時間が不正です';
  if (getVal('sagyoShinchoku').trim() === '') return '作業進捗が未入力です';
  return null;
}

// ---- toast ----------------------------------------------------------------
let toastTimer = null;
function toast(msg, kind) {
  let el = $('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'show ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

// ---- イベント配線 ---------------------------------------------------------
function wire() {
  // 日付ボタン
  document.querySelectorAll('.date-btn').forEach(btn => {
    btn.addEventListener('click', () => setVal('date', fmtDate(Number(btn.dataset.days))));
  });

  $('btnGetList').addEventListener('click', () =>
    callApi('getNippoList', { tanto: getVal('tanto') }, '日報一覧取得'));

  $('btnGetTotal').addEventListener('click', async () => {
    const r = await callApi('getTotal', { tanto: getVal('tanto'), date: getVal('date') }, '合計取得');
    if (r && r.ok) $('totalVal').textContent = (r.data ?? '-');
  });

  $('btnRegist').addEventListener('click', async () => {
    const err = checkError();
    if (err) { toast(err, 'ng'); return; }
    const body = collectForm();
    const isNew = body.nippoCd.trim() === '';
    const r = await callApi('registData', body, isNew ? '新規登録' : '更新');
    if (r && r.ok) {
      clearForm();
      callApi('getNippoList', { tanto: getVal('tanto') }, '日報一覧取得');
    }
  });

  $('btnDelete').addEventListener('click', async () => {
    if (getVal('nippoCd').trim() === '') { toast('日報コードが空です（削除対象なし）', 'ng'); return; }
    if (!confirm('削除します。元に戻せませんのでご注意を')) return;
    const r = await callApi('deleteData', { nippoCd: getVal('nippoCd') }, '削除');
    if (r && r.ok) {
      clearForm();
      callApi('getNippoList', { tanto: getVal('tanto') }, '日報一覧取得');
    }
  });

  $('btnCopy').addEventListener('click', () => { setVal('nippoCd', ''); updateMode(); toast('新規モードに切替（内容は保持）', 'ok'); });
  $('btnClear').addEventListener('click', () => clearForm());
  $('nippoCd').addEventListener('input', updateMode);

  $('btnAnkenSearch').addEventListener('click', () =>
    callApi('gethistory', { tanto: getVal('tanto'), svalue: getVal('svalue') }, '案件検索'));
  $('btnAnkenHistory').addEventListener('click', () =>
    callApi('gethistory', { tanto: getVal('tanto') }, '案件履歴'));
  $('btnTantoSearch').addEventListener('click', () =>
    callApi('getTantoList', { svalue: getVal('svalue2') }, '担当者検索'));

  $('btnReload').addEventListener('click', () => { webReady = false; rk.reload(); });
  $('btnToggleWeb').addEventListener('click', () => $('webPane').classList.toggle('hidden'));
}

// ---- start ----------------------------------------------------------------
initSelects();
wire();
updateMode();
setVal('date', fmtDate(0));
