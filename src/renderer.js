'use strict';

// ---- 定数（現行仕様.md より） --------------------------------------------
const SAGYO_NAIYO = ['', '1.管理', '2.PJ会議', '2.PJレビュー', '3.調査・分析',
  '4.要件定義', '5..設計', '6.開発・構築', '7.テスト', '8.ドキュメント作成',
  '9.リリース対応', '※作業待ち', '※プレ・見積', '※不具合', '※問い合わせ',
  '※社内会議', '※レビュー支援', '※学習・教育', '※その他'];
const SAGYO_SHINCHOKU = ['', '順調', 'やや遅れ', '遅れ'];

// 登録・更新で送信する全11項目（tanto はメイン画面の状態、それ以外は登録モーダル）
const REG_FIELDS = ['nippoCd', 'date', 'ankenCd', 'torihikisakiMei', 'ankenMei',
  'sagyoNaiyo', 'sagyozikan', 'sagyoShinchoku', 'okureHokoku', 'sonotaHokoku'];

// エンドポイント別の表示列ホワイトリスト（現行仕様.md §7.1 / §7.4）。
// 行データは全フィールド保持し、表示のみ絞る。未定義/非該当は全列にフォールバック。
const DISPLAY_COLS = {
  getNippoList: ['日付', '案件コード', '取引先名', '案件名', '作業時間', '作業内容', '作業進捗', 'その他報告事項'],
  gethistory: ['案件コード', '取引先名', '案件名'],
  getTantoList: ['key', '名称1'],
};

// 表示列の見出しラベル（生キーが英字等の場合の日本語化。現行仕様.md §6.2）。
const HEADER_LABELS = {
  getTantoList: { key: '担当者コード', 名称1: '担当者名' },
};

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
  // 対象ページに戻ってきた（＝ログイン完了想定）ら、認証中なら自動でアプリ表示を試行
  if (document.body.classList.contains('auth') && isTargetUrl()) tryEnter(true);
});
// 読み込みが本当に止まった時に緑化（SSO は複数回リダイレクトするため did-stop-loading で判定）
rk.addEventListener('did-stop-loading', () => {
  webReady = true;
  setConn('ok', isTargetUrl() ? '接続OK（対象ページ）' : '読込完了（ログイン画面）');
  if (document.body.classList.contains('auth') && isTargetUrl()) tryEnter(true);
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
function setStatus(text) { $('outStatus').textContent = text; }

function isTargetUrl() {
  const u = (rk.getURL && rk.getURL()) || '';
  return /rkanri\.genech\.co\.jp\/kanri\/nippo/.test(u);
}

// ---- 画面切替（認証 ⇄ アプリ） -------------------------------------------
function showAuth() {
  document.body.className = 'auth';
  setConn('warn', '認証待ち（ログインしてください）');
}
function enterApp() {
  document.body.className = 'app';
}

// ログイン確認 → アプリ表示。silent=true のときは失敗時トーストを抑制（自動試行用）。
async function tryEnter(silent) {
  if (!webReady) { if (!silent) toast('埋め込みブラウザの準備中です。少し待って再度お試しください。', 'ng'); return; }
  if (!isTargetUrl()) { if (!silent) toast('先に対象システムにログインしてください。', 'ng'); return; }
  const r = await callApi('getNippoList', { tanto: getVal('tanto') }, '日報一覧取得');
  if (r && Array.isArray(r.data)) {
    enterApp();
    renderTableInto($('listTable'), 'getNippoList', r.data, openEditModal);
  }
  // ログイン切れ等（callApi 内で showAuth 済み）のときは何もしない
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

// registData / deleteData のビジネス成否は応答 {status:"success"} で判定（現行仕様.md §8.3/§8.4）。
function bizStatus(result) {
  const d = result && result.data;
  if (d && typeof d === 'object' && !Array.isArray(d) && 'status' in d) return String(d.status);
  return null;
}
function isBizOk(r) {
  if (!r || !r.ok) return false;
  const s = bizStatus(r);
  return s === null || s === 'success';
}
// エラー応答をそのまま出すための整形（オブジェクトは JSON 文字列化、文字列はそのまま）。
function rawText(result) {
  const d = result && result.data;
  if (d == null) return '';
  return typeof d === 'string' ? d : JSON.stringify(d);
}

// API 実行。結果(result)を返す（テーブル描画は呼び出し側の責務）。
// ログイン切れ/HTML 応答時は認証画面に戻し null を返す。
async function callApi(endpoint, body, label) {
  if (!webReady) {
    toast('埋め込みブラウザの準備中です。ログイン後に再度お試しください。', 'ng');
    return null;
  }
  setStatus(`${endpoint} 実行中…`);
  let result;
  try {
    result = await rk.executeJavaScript(buildInjection(endpoint, body));
  } catch (e) {
    setStatus('実行エラー: ' + e.message);
    toast('実行エラー: ' + e.message, 'ng');
    return null;
  }
  $('jsonOut').textContent = JSON.stringify(result, null, 2);

  if (!result) { setStatus('応答なし'); return null; }

  // ログイン切れ検出（HTML が返る / login へリダイレクト）→ 認証画面へ
  if (typeof result.data === 'string' && /<html|<!doctype|login/i.test(result.data)) {
    setConn('warn', '未ログインの可能性');
    setStatus('ログインが必要です');
    toast('ログインが必要です。認証画面でログインしてください。', 'ng');
    showAuth();
    return null;
  }

  const status = result.ok ? `OK (${result.status})` : `NG (${result.status})`;
  const biz = bizStatus(result);
  const raw = rawText(result);
  setStatus(status + (result.hasToken ? '' : ' / XSRFトークン未取得') + (biz ? ` / status: ${biz}` : ''));

  // エラー時はサーバー応答をそのまま表示（canned メッセージに変換しない）
  if (!result.ok) {
    if (raw) setStatus(status + ' / ' + raw);
    toast(`${label || endpoint}: ${status}${raw ? ' / ' + raw : ''}`, 'ng');
    return result;
  }
  // HTTP は 200 でも {status:"success"} 以外はビジネスエラー扱い → 応答をそのまま出す
  if (biz !== null && biz !== 'success') {
    setStatus(status + ' / ' + (raw || `status: ${biz}`));
    toast(`${label || endpoint}: ${raw || `status: ${biz}`}`, 'ng');
    return result;
  }
  toast(`${label || endpoint}: 成功`, 'ok');
  return result;
}

// ---- テーブル描画（任意コンテナ + 行クリックコールバック） ----------------
function renderTableInto(container, endpoint, data, onRowClick) {
  // 非配列応答（スカラー/オブジェクト）は一覧ではないため既存表示を維持
  if (!Array.isArray(data)) return;
  container.innerHTML = '';
  if (data.length === 0) {
    container.innerHTML = '<div class="muted" style="padding:8px;">（データなし）</div>';
    return;
  }
  const allKeys = Object.keys(data[0]);
  const wl = DISPLAY_COLS[endpoint];
  const picked = wl ? wl.filter(c => allKeys.includes(c)) : [];
  const cols = picked.length ? picked : allKeys;
  const labels = HEADER_LABELS[endpoint] || {};

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  cols.forEach(c => { const th = document.createElement('th'); th.textContent = labels[c] || c; htr.appendChild(th); });
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
    if (onRowClick) tr.addEventListener('click', () => onRowClick(rowObj));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

// ---- 日報一覧（メイン画面） ----------------------------------------------
async function loadList() {
  const r = await callApi('getNippoList', { tanto: getVal('tanto') }, '日報一覧取得');
  if (r && Array.isArray(r.data)) renderTableInto($('listTable'), 'getNippoList', r.data, openEditModal);
}

// ---- モーダル制御 ---------------------------------------------------------
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
function isOpen(id) { return !$(id).classList.contains('hidden'); }

// ③ 行クリック → 修正モードで登録モーダル
function openEditModal(row) {
  // 担当者は行データに合わせる（一覧は選択担当者のものだが念のため）
  if (row['担当者コード']) setVal('tanto', row['担当者コード']);
  if (row['担当者名']) setVal('tantoName', row['担当者名']);
  setVal('nippoCd', row['日報コード']);
  setVal('date', row['日付']);
  setVal('ankenCd', row['案件コード']);
  setVal('torihikisakiMei', row['取引先名']);
  setVal('ankenMei', row['案件名']);
  setVal('sagyoNaiyo', row['作業内容']);
  setVal('sagyozikan', row['作業時間']);
  setVal('sagyoShinchoku', row['作業進捗'] || '順調');
  setVal('okureHokoku', row['遅れ報告']);
  setVal('sonotaHokoku', row['その他報告事項']);
  syncRegTanto();
  updateMode();
  $('totalVal').textContent = '-';
  openModal('registModal');
}

// ④ 登録ボタン → 新規モードで登録モーダル
function openNewModal() {
  clearForm();
  setVal('date', fmtDate(0));
  syncRegTanto();
  updateMode();
  $('totalVal').textContent = '-';
  openModal('registModal');
}

function syncRegTanto() {
  setVal('regTanto', getVal('tanto'));
  setVal('regTantoName', getVal('tantoName'));
}

// ---- フォーム操作 ---------------------------------------------------------
function setVal(id, v) { const el = $(id); if (el) el.value = v == null ? '' : v; }
function getVal(id) { return ($(id)?.value ?? '').toString(); }

function collectForm() {
  const o = { tanto: getVal('tanto') };
  REG_FIELDS.forEach(f => { o[f] = getVal(f); });
  return o;
}

function clearForm() {
  setVal('nippoCd', '');
  setVal('date', '');
  setVal('ankenCd', ''); setVal('torihikisakiMei', ''); setVal('ankenMei', '');
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
  $('nippoCdView').textContent = isEdit ? getVal('nippoCd') : '新規登録';
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

// ---- 登録 / 更新 / 削除 ---------------------------------------------------
async function doRegist() {
  const err = checkError();
  if (err) { toast(err, 'ng'); return; }
  const body = collectForm();
  const isNew = (body.nippoCd || '').trim() === '';
  const r = await callApi('registData', body, isNew ? '新規登録' : '更新');
  if (isBizOk(r)) {
    closeModal('registModal');
    clearForm();
    loadList();
  }
}

async function doDelete() {
  if (getVal('nippoCd').trim() === '') { toast('日報コードが空です（削除対象なし）', 'ng'); return; }
  if (!confirm('削除します。元に戻せませんのでご注意を')) return;
  const r = await callApi('deleteData', { nippoCd: getVal('nippoCd') }, '削除');
  if (isBizOk(r)) {
    closeModal('registModal');
    clearForm();
    loadList();
  }
}

async function doTotal() {
  const r = await callApi('getTotal', { tanto: getVal('tanto'), date: getVal('date') }, '合計取得');
  if (r && r.ok) $('totalVal').textContent = (r.data ?? '-');
}

// ---- ⑤ 案件マスタ検索モーダル --------------------------------------------
function openAnkenModal() {
  openModal('ankenModal');
  $('svalue').focus();
}
async function searchAnken(withSvalue) {
  const body = withSvalue ? { tanto: getVal('tanto'), svalue: getVal('svalue') } : { tanto: getVal('tanto') };
  const r = await callApi('gethistory', body, withSvalue ? '案件検索' : '案件履歴');
  if (r && Array.isArray(r.data)) renderTableInto($('ankenTable'), 'gethistory', r.data, pickAnken);
}
function pickAnken(row) {
  setVal('ankenCd', row['案件コード']);
  setVal('torihikisakiMei', row['取引先名']);
  setVal('ankenMei', row['案件名']);
  closeModal('ankenModal');
  toast('案件を反映しました', 'ok');
}

// ---- ⑥ 担当者マスタ検索モーダル ------------------------------------------
function openTantoModal() {
  openModal('tantoModal');
  $('svalue2').focus();
}
async function searchTantoList() {
  const r = await callApi('getTantoList', { svalue: getVal('svalue2') }, '担当者検索');
  if (r && Array.isArray(r.data)) renderTableInto($('tantoTable'), 'getTantoList', r.data, pickTanto);
}
function pickTanto(row) {
  setVal('tanto', row['key']);
  setVal('tantoName', row['名称1']);
  syncRegTanto();
  closeModal('tantoModal');
  toast('担当者を切り替えました', 'ok');
  // 登録モーダルを開いていない（＝メインからの担当者切替）ときは一覧を更新
  if (!isOpen('registModal')) loadList();
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
  // 認証画面
  $('btnEnterApp').addEventListener('click', () => tryEnter(false));
  $('btnReload').addEventListener('click', () => { webReady = false; rk.reload(); });

  // メイン画面
  $('btnReauth').addEventListener('click', () => showAuth());
  $('btnGetList').addEventListener('click', () => loadList());
  $('btnNew').addEventListener('click', () => openNewModal());

  // 登録モーダル
  $('btnCloseRegist').addEventListener('click', () => closeModal('registModal'));
  $('btnCloseRegist2').addEventListener('click', () => closeModal('registModal'));
  $('btnRegist').addEventListener('click', () => doRegist());
  $('btnDelete').addEventListener('click', () => doDelete());
  $('btnCopy').addEventListener('click', () => { setVal('nippoCd', ''); updateMode(); toast('新規モードに切替（内容は保持）', 'ok'); });
  $('btnClear').addEventListener('click', () => clearForm());
  $('btnGetTotal').addEventListener('click', () => doTotal());
  document.querySelectorAll('.date-btn').forEach(btn => {
    btn.addEventListener('click', () => setVal('date', fmtDate(Number(btn.dataset.days))));
  });
  $('btnTantoSearch').addEventListener('click', () => openTantoModal());
  $('btnAnkenSearch').addEventListener('click', () => openAnkenModal());

  // 案件モーダル
  $('btnAnkenDoSearch').addEventListener('click', () => searchAnken(true));
  $('btnAnkenHistory').addEventListener('click', () => searchAnken(false));
  $('btnCloseAnken').addEventListener('click', () => closeModal('ankenModal'));

  // 担当者モーダル
  $('btnTantoDoSearch').addEventListener('click', () => searchTantoList());
  $('btnCloseTanto').addEventListener('click', () => closeModal('tantoModal'));

  // オーバーレイ背景クリックで閉じる（モーダル本体クリックは無視）
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); });
  });
}

// ---- start ----------------------------------------------------------------
initSelects();
wire();
showAuth();
