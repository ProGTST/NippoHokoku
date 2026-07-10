'use strict';

// ---- 定数（現行仕様.md より。空欄は設けず必ずいずれかを選択させる） --------
const SAGYO_NAIYO = [
  '1.管理',
  '2.PJ会議',
  '2.PJレビュー',
  '3.調査・分析',
  '4.要件定義',
  '5..設計',
  '6.開発・構築',
  '7.テスト',
  '8.ドキュメント作成',
  '9.リリース対応',
  '※作業待ち',
  '※プレ・見積',
  '※不具合',
  '※問い合わせ',
  '※社内会議',
  '※レビュー支援',
  '※学習・教育',
  '※その他'
];
const SAGYO_SHINCHOKU = ['順調', 'やや遅れ', '遅れ'];

// 登録・更新で送信する全11項目（tanto はメイン画面の状態、それ以外は登録モーダル）
const REG_FIELDS = [
  'nippoCd',
  'date',
  'ankenCd',
  'torihikisakiMei',
  'ankenMei',
  'sagyoNaiyo',
  'sagyozikan',
  'sagyoShinchoku',
  'okureHokoku',
  'sonotaHokoku'
];

// リセット（初期表示状態への復元）でスナップショットする項目
// 担当者は登録モーダル側（regTanto/regTantoName）を対象にする（メインはログイン担当者で固定）
const SNAPSHOT_FIELDS = REG_FIELDS.concat(['regTanto', 'regTantoName']);

// エンドポイント別の表示列ホワイトリスト（現行仕様.md §7.1 / §7.4）。
// 行データは全フィールド保持し、表示のみ絞る。未定義/非該当は全列にフォールバック。
const DISPLAY_COLS = {
  getNippoList: [
    '日付',
    '案件コード',
    '取引先名',
    '案件名',
    '作業時間',
    '作業内容',
    '作業進捗',
    'その他報告事項'
  ],
  gethistory: ['案件コード', '取引先名', '案件名'],
  getTantoList: ['key', '名称1']
};

// 表示列の見出しラベル（生キーが英字等の場合の日本語化。現行仕様.md §6.2）。
const HEADER_LABELS = {
  getTantoList: { key: '担当者コード', 名称1: '担当者名' }
};

// ---- 要素参照 -------------------------------------------------------------
// 返り値は any（webview 要素や input 固有プロパティに緩く触れるため）。
/** @param {string} id @returns {any} */
const $ = (id) => document.getElementById(id);
/** @param {string} sel @param {Document|Element} [root] @returns {any} */
const qs = (sel, root) => (root || document).querySelector(sel);
/** @param {string} sel @param {Document|Element} [root] @returns {any} */
const qsa = (sel, root) => (root || document).querySelectorAll(sel);
const rk = $('rk'); // <webview>
let webReady = false;
let tantoAutoDone = false; // 本人自動セット（初回のみ）
let formSnapshot = null; // 登録モーダルを開いた時点の値（リセット用）
let copyMode = false; // コピー登録中（編集モードでコピー押下→新規化した状態）
let viewOnly = false; // 参照のみモード（他担当者を参照許可のみで閲覧。編集系 UI を隠す）
let pendingTantoRow = null; // 担当変更で選択中の担当者行（許可確認モーダルで確定/中断する）
let loginTanto = null; // ログイン担当者（本人自動セットの結果。再読込でここへ戻す）
let pendingListReload = false; // webview 再読込の完了後、アプリ画面で一覧を取り直すフラグ
let currentNippoList = []; // 現在表示中（フィルタ適用後）の日報一覧（一括操作用）
let allNippoRows = []; // API から取得した全件（フィルタ前。並べ替え済み）
let listFilterMode = 'month'; // 一覧の表示モード（'month'=指定月のみ / 'all'=全件）
let filterYear = 0; // 月表示モードで絞り込む年（初期化時に当月をセット）
let filterMonth = 0; // 月表示モードで絞り込む月（1-12）
const selectedNippo = new Set(); // 選択中の日報コード（一括操作用）

// rkanri ページ内から、ログイン中ユーザーの担当者コード（P-XXXXXX）を拾う。
// 対象ページは担当者コードを input に保持しているため、その値を読む。
const AUTO_TANTO_PROBE = `(() => {
  const inputs = Array.from(document.querySelectorAll('input'));
  for (const el of inputs) {
    const v = (el.value || '').trim();
    if (/^P-\\d{6}$/.test(v)) return { code: v };
  }
  return null;
})()`;

// ---- 初期化 ---------------------------------------------------------------
function initSelects() {
  const naiyo = $('sagyoNaiyo');
  SAGYO_NAIYO.forEach((v) => naiyo.appendChild(new Option(v, v)));
  naiyo.selectedIndex = 0; // 空欄なし。既定は先頭
  const sinchoku = $('sagyoShinchoku');
  SAGYO_SHINCHOKU.forEach((v) => sinchoku.appendChild(new Option(v, v)));
  sinchoku.value = '順調'; // 既定値
}

// <input type="date"> 用に yyyy-mm-dd を返す（当日 +offset）。
function fmtDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mo}-${da}`;
}

// 任意の日付表記（yyyy/m/d または yyyy-mm-dd）を input[type=date] 用 yyyy-mm-dd に変換。
function toInputDate(s) {
  const m = String(s || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

// input[type=date] の値（yyyy-mm-dd）を API 送信用 yyyy/m/d（ゼロ埋めなし）に変換。
function toApiDate(s) {
  const m = String(s || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
}

// 日付文字列を比較用の数値（yyyymmdd）に変換。
function dateNum(s) {
  const m = String(s || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}

// 日報一覧を「日付 降順 → 作業時間 降順 → 案件コード 降順」で並べ替える。
function sortNippoList(rows) {
  return rows.slice().sort((a, b) => {
    const dd = dateNum(b['日付']) - dateNum(a['日付']);
    if (dd) return dd;
    const td = (Number(b['作業時間']) || 0) - (Number(a['作業時間']) || 0);
    if (td) return td;
    return String(b['案件コード'] || '').localeCompare(String(a['案件コード'] || ''));
  });
}

// ---- webview 状態 ---------------------------------------------------------
// 対象ページへ遷移が確定した瞬間（描画前）にマスクで覆い、既存システム画面を見せない。
// ログイン画面（対象外URL）ではマスクを外してログインを表示する。
rk.addEventListener('did-navigate', (e) => {
  if (!document.body.classList.contains('auth')) return;
  if (isTargetUrl(e.url)) showMask();
  else hideMask();
});
rk.addEventListener('dom-ready', () => {
  webReady = true;
  // 対象ページに戻ってきた（＝ログイン完了想定）ら、認証中なら自動でアプリ表示を試行
  if (document.body.classList.contains('auth') && isTargetUrl()) tryEnter(true);
});
// 読み込みが本当に止まった時に緑化（SSO は複数回リダイレクトするため did-stop-loading で判定）
rk.addEventListener('did-stop-loading', () => {
  webReady = true;
  setConn('ok', isTargetUrl() ? '接続OK' : '読込完了');
  if (document.body.classList.contains('auth') && isTargetUrl()) tryEnter(true);
  // アプリ画面での再読込完了時は、戻したログイン担当者で一覧を取り直す
  else if (pendingListReload && isTargetUrl()) {
    pendingListReload = false;
    loadList();
  }
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
function setStatus(text) {
  $('outStatus').textContent = text;
}

function isTargetUrl(u) {
  u = u || (rk.getURL && rk.getURL()) || '';
  return /rkanri\.genech\.co\.jp\/kanri\/nippo/.test(u);
}

// ---- 遷移マスク（既存システム画面を隠す） --------------------------------
function showMask() {
  $('enterMask').classList.remove('hidden');
}
function hideMask() {
  $('enterMask').classList.add('hidden');
}

// ---- 画面切替（認証 ⇄ アプリ） -------------------------------------------
function showAuth() {
  document.body.className = 'auth';
  updatePromptShown = false; // 再ログイン時は更新確認を再度出せるように
  setConn('warn', '認証待ち（ログインしてください）');
  hideMask();
  updateHeaderTitle();
}
function enterApp() {
  document.body.className = 'app';
  applyViewOnly(false); // ログイン直後は全権（参照のみ解除）
  hideMask();
  updateHeaderTitle();
  alignFilterColumns(); // メイン画面表示後にレイアウトが確定してから列幅を合わせる
  checkForUpdate(); // 日報一覧の初期表示時に更新有無をチェック
}

// 案件コード入力の幅を作業内容プルダウンの実幅に合わせ、
// 取引先名（2段目）と作業進捗（3段目）の列位置を縦に揃える。
// プルダウン自体の幅は変更しない（内容に合わせた自動幅のまま）。
function alignFilterColumns() {
  const naiyo = $('fNaiyo');
  const code = $('fCode');
  if (naiyo && code && naiyo.offsetWidth) code.style.width = `${naiyo.offsetWidth}px`;
}

// ヘッダーのタイトルは「ログイン」か「日報一覧」の2パターンのみ。
// モーダル（日報登録・ZOOM）表示時もヘッダーは変更しない。
function updateHeaderTitle() {
  $('pageTitle').textContent = document.body.classList.contains('app') ? '日報一覧' : 'ログイン';
}

// ログイン確認 → アプリ表示。silent=true のときは失敗時トーストを抑制（自動試行用）。
async function tryEnter(silent) {
  if (!webReady) {
    if (!silent) toast('埋め込みブラウザの準備中です。少し待って再度お試しください。', 'ng');
    return;
  }
  if (!isTargetUrl()) {
    if (!silent) toast('先に対象システムにログインしてください。', 'ng');
    return;
  }
  showMask(); // 取得〜切替の間、既存システム画面を隠す
  const r = await callApi('getNippoList', { tanto: getVal('tanto') }, '日報一覧取得', true);
  if (r && Array.isArray(r.data)) {
    enterApp();
    showNippoList(r.data);
    // ログイン中の本人を自動セット（初回のみ）。担当者が変わったら一覧を取り直す。
    const changed = await autoSetTantoOnce();
    if (changed) await loadList();
  } else {
    // 入れない（ログイン切れ等。callApi 内で showAuth 済みの場合あり）→ マスクを外す
    hideMask();
  }
}

// ログイン中ユーザーの担当者を自動判定してセット（初回のみ）。
// 戻り値: 担当者コードが既定から変わったら true（呼び出し側で一覧を再取得）。
async function autoSetTantoOnce() {
  if (tantoAutoDone) return false;
  tantoAutoDone = true;
  let found = null;
  try {
    found = await rk.executeJavaScript(AUTO_TANTO_PROBE);
  } catch (e) {
    return false; // 取得失敗時は既定値のまま（各自が検索で選択）
  }
  if (!found || !found.code) return false;

  const original = getVal('tanto');
  setVal('tanto', found.code);
  // 担当者名を getTantoList から解決（トーストは抑制）
  let name = '';
  const r = await callApi('getTantoList', { svalue: found.code }, '担当者自動判定', true);
  if (r && Array.isArray(r.data)) {
    const hit = r.data.find((x) => x.key === found.code);
    if (hit) name = hit['名称1'] || '';
  }
  // 名前が解決できた場合のみ更新（できない場合、コードが変わったなら旧名を消す）
  if (name) setVal('tantoName', name);
  else if (found.code !== original) setVal('tantoName', '');
  // 再読込で戻すためのログイン担当者を確定
  loginTanto = { code: getVal('tanto'), name: getVal('tantoName') };
  syncRegTanto();
  return found.code !== original;
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
// silent=true のとき成功トーストを抑制（自動処理用。エラー系は抑制しない）。
async function callApi(endpoint, body, label, silent) {
  if (!webReady) {
    toast('埋め込みブラウザの準備中です。ログイン後に再度お試しください。', 'ng');
    return null;
  }
  let result;
  try {
    result = await rk.executeJavaScript(buildInjection(endpoint, body));
  } catch (e) {
    setStatus('実行エラー: ' + e.message);
    toast('実行エラー: ' + e.message, 'ng');
    return null;
  }
  $('jsonOut').textContent = JSON.stringify(result, null, 2);

  if (!result) {
    setStatus('応答なし');
    return null;
  }

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

  // エラー時はサーバー応答をそのまま「ポップアップ（toast）」で表示（canned メッセージに変換しない）
  if (!result.ok) {
    setStatus(raw ? status + ' / ' + raw : status);
    toast(`${label || endpoint}: ${status}${raw ? ' / ' + raw : ''}`, 'ng');
    return result;
  }
  // HTTP は 200 でも {status:"success"} 以外はビジネスエラー扱い → 応答をそのまま出す
  if (biz !== null && biz !== 'success') {
    setStatus(status + ' / ' + (raw || `status: ${biz}`));
    toast(`${label || endpoint}: ${raw || `status: ${biz}`}`, 'ng');
    return result;
  }
  // 成功時はステータス（OK 200 等）を表示しない
  setStatus('');
  if (!silent) toast(`${label || endpoint}: 成功`, 'ok');
  return result;
}

// ---- テーブル描画（任意コンテナ + 行クリックコールバック） ----------------
// selectable=true で先頭にチェックボックス列（選択列）を追加（日報一覧用）。
function renderTableInto(container, endpoint, data, onRowClick, selectable) {
  // 非配列応答（スカラー/オブジェクト）は一覧ではないため既存表示を維持
  if (!Array.isArray(data)) return;
  container.innerHTML = '';
  const wl = DISPLAY_COLS[endpoint];
  const allKeys = data.length ? Object.keys(data[0]) : [];
  // 空データ時はホワイトリストの列でヘッダーを構成する（ヘッダーを維持するため）。
  const picked = wl ? wl.filter((c) => !data.length || allKeys.includes(c)) : [];
  const cols = picked.length ? picked : allKeys;
  const labels = HEADER_LABELS[endpoint] || {};
  // 列が特定できない空データ（ホワイトリスト未定義）のみ、ヘッダーなしで中央にメッセージ表示
  if (data.length === 0 && cols.length === 0) {
    container.innerHTML = '<div class="empty-list muted">該当データがありません</div>';
    return;
  }

  const table = document.createElement('table');
  table.classList.add('tbl-' + endpoint); // エンドポイント別に列幅などを CSS で指定するため
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  if (selectable) {
    const th = document.createElement('th');
    th.className = 'chk';
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.title = '全選択';
    all.addEventListener('change', () => {
      data.forEach((r) => {
        const k = r['日報コード'];
        if (all.checked) selectedNippo.add(k);
        else selectedNippo.delete(k);
      });
      container.querySelectorAll('tbody input[type=checkbox]').forEach((cb) => {
        cb.checked = all.checked;
      });
    });
    th.appendChild(all);
    htr.appendChild(th);
  }
  cols.forEach((c) => {
    const th = document.createElement('th');
    th.dataset.col = c; // 列名で列幅を CSS 指定できるように
    th.textContent = labels[c] || c;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (data.length === 0) {
    // データ0件でもヘッダーは残し、ボディ全体の中央に「該当データがありません」を表示する
    table.classList.add('is-empty'); // 高さをコンテナいっぱいに広げて縦中央寄せする
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = cols.length + (selectable ? 1 : 0);
    td.className = 'empty-cell muted';
    td.textContent = '該当データがありません';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  data.forEach((rowObj) => {
    const tr = document.createElement('tr');
    const key = rowObj['日報コード'];
    // 作業進捗の遅れ具合に応じて行全体を赤系で強調（濃度は 遅れ > やや遅れ）
    const shinchoku = String(rowObj['作業進捗'] || '');
    if (shinchoku === 'やや遅れ') tr.classList.add('delay-warn');
    else if (shinchoku === '遅れ') tr.classList.add('delay-late');
    let cb = null;
    if (selectable) {
      const td = document.createElement('td');
      td.className = 'chk';
      cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedNippo.has(key);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedNippo.add(key);
        else selectedNippo.delete(key);
      });
      // チェック操作で行クリック（編集）を発火させない
      td.addEventListener('click', (e) => e.stopPropagation());
      td.appendChild(cb);
      tr.appendChild(td);
    }
    cols.forEach((c) => {
      const td = document.createElement('td');
      td.dataset.col = c; // 列名で列幅を CSS 指定できるように
      const v = rowObj[c];
      // 列幅を超える文字を範囲選択で辿れるよう、内容は横スクロール可能な内箱に入れる
      // （スクロールバーは CSS で非表示。td 自体は table-cell でスクロールできないため）
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.textContent = v == null ? '' : String(v);
      td.appendChild(cell);
      if (typeof v === 'number' || /時間|作業時間/.test(c)) td.className = 'num';
      tr.appendChild(td);
    });
    tr.addEventListener('click', (e) => {
      // セル内テキストを範囲選択した直後のクリックでは編集を開かない
      // （見切れた文字をドラッグ選択してコピーする操作を妨げないため）
      const sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).length) return;
      // Ctrl（Mac は Cmd）+クリックは、編集を開かず選択トグル
      if (selectable && (e.ctrlKey || e.metaKey)) {
        const now = !selectedNippo.has(key);
        if (now) selectedNippo.add(key);
        else selectedNippo.delete(key);
        if (cb) cb.checked = now;
        return;
      }
      if (onRowClick) onRowClick(rowObj);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

// ---- 日報一覧（メイン画面） ----------------------------------------------
function showNippoList(rows) {
  allNippoRows = sortNippoList(rows);
  applyListFilter();
}

// 指定月（月表示モード時）に一致するか。
function matchesMonth(r) {
  if (listFilterMode === 'all') return true;
  const m = String(r['日付'] || '').match(/(\d{4})\D(\d{1,2})/);
  return !!m && Number(m[1]) === filterYear && Number(m[2]) === filterMonth;
}

// 絞り込みツールバーの各条件に一致するか（テキスト＝部分一致 / プルダウン＝完全一致。空欄は無条件）。
function matchesFieldFilters(r) {
  const partial = (field, id) => {
    const q = getVal(id).trim();
    return q === '' || String(r[field] ?? '').includes(q);
  };
  const exact = (field, id) => {
    const q = getVal(id);
    return q === '' || String(r[field] ?? '') === q;
  };
  return (
    partial('案件コード', 'fCode') &&
    partial('取引先名', 'fTorihiki') &&
    partial('案件名', 'fAnken') &&
    exact('作業内容', 'fNaiyo') &&
    exact('作業進捗', 'fShinchoku') &&
    partial('その他報告事項', 'fSonota')
  );
}

// 表示モード（全件 / 指定月）と絞り込み条件で allNippoRows を絞り込み、テーブルを再描画する。
function applyListFilter() {
  selectedNippo.clear(); // 表示対象が変わるため選択をリセット
  currentNippoList = allNippoRows.filter((r) => matchesMonth(r) && matchesFieldFilters(r));
  renderTableInto($('listTable'), 'getNippoList', currentNippoList, openEditModal, true);
}

// 絞り込みツールバーの条件をすべてクリアして再フィルタする。
function clearFieldFilters() {
  ['fCode', 'fTorihiki', 'fAnken', 'fNaiyo', 'fShinchoku', 'fSonota'].forEach((id) =>
    setVal(id, '')
  );
  applyListFilter();
}

// 表示モードを切り替える（'month' / 'all'）。ボタン名と月ナビの表示も更新する。
function setListFilterMode(mode) {
  listFilterMode = mode;
  const allMode = mode === 'all';
  $('btnToggleAll').title = allMode ? '月表示へ切替' : '全件表示へ切替';
  $('modeLabel').textContent = allMode ? '全件表示モード' : '月表示モード';
  $('monthNav').classList.toggle('hidden', allMode);
  applyListFilter();
}

// 月表示の年月を delta か月ずらして再フィルタする。
function shiftFilterMonth(delta) {
  let y = filterYear;
  let m = filterMonth + delta;
  if (m < 1) {
    m = 12;
    y -= 1;
  } else if (m > 12) {
    m = 1;
    y += 1;
  }
  filterYear = y;
  filterMonth = m;
  syncMonthInput();
  applyListFilter();
}

// filterYear/filterMonth を <input type="month"> に反映する。
function syncMonthInput() {
  $('filterMonth').value = `${filterYear}-${String(filterMonth).padStart(2, '0')}`;
}

// 一覧フィルタの初期化：当月を対象にし、月表示モードで開始する。
// 絞り込み用プルダウンには「（すべて）」の空欄＋各選択肢を並べる。
function initListFilter() {
  const d = new Date();
  filterYear = d.getFullYear();
  filterMonth = d.getMonth() + 1;
  listFilterMode = 'month';
  $('btnToggleAll').title = '全件表示へ切替';
  $('modeLabel').textContent = '月表示モード';
  $('monthNav').classList.remove('hidden');
  syncMonthInput();
  const fillFilterSelect = (id, values) => {
    const sel = $(id);
    sel.appendChild(new Option('全て', ''));
    values.forEach((v) => sel.appendChild(new Option(v, v)));
    sel.value = '';
  };
  fillFilterSelect('fNaiyo', SAGYO_NAIYO);
  fillFilterSelect('fShinchoku', SAGYO_SHINCHOKU);
}
async function loadList() {
  const r = await callApi('getNippoList', { tanto: getVal('tanto') }, '日報一覧取得');
  if (r && Array.isArray(r.data)) showNippoList(r.data);
}
// 選択中の日報（行データ）を返す。
function selectedRows() {
  return currentNippoList.filter((r) => selectedNippo.has(r['日報コード']));
}

// ---- モーダル制御 ---------------------------------------------------------
function openModal(id) {
  $(id).classList.remove('hidden');
  updateHeaderTitle();
}
function closeModal(id) {
  $(id).classList.add('hidden');
  updateHeaderTitle();
}
function isOpen(id) {
  return !$(id).classList.contains('hidden');
}

// ---- アプリ内確認ダイアログ（native confirm の代替） ----------------------
// native confirm/alert は <webview> 併用時、ダイアログを閉じた後もキーボード
// フォーカスがホストへ戻らず（オフスクリーンの webview 側へ流れる）、一括処理直後に
// 入力欄へフォーカスできなくなる不具合があった。同一 webContents 内の DOM モーダルで
// 代替することで OS レベルのフォーカス移動を起こさない。Promise<boolean> を返す。
let confirmResolver = null;
function uiConfirm(message, title) {
  return new Promise((resolve) => {
    if (confirmResolver) confirmResolver(false); // 未解決が残っていれば false で畳む
    confirmResolver = resolve;
    $('confirmMsg').textContent = message;
    $('confirmTitle').textContent = title || '確認';
    openModal('confirmModal');
    $('btnConfirmOk').focus();
  });
}
function closeConfirm(result) {
  const r = confirmResolver;
  confirmResolver = null;
  closeModal('confirmModal');
  if (r) r(result);
}

// ③ 行クリック → 修正モードで登録モーダル
function openEditModal(row) {
  setVal('nippoCd', row['日報コード']);
  setVal('date', toInputDate(row['日付']));
  setVal('ankenCd', row['案件コード']);
  setVal('torihikisakiMei', row['取引先名']);
  setVal('ankenMei', row['案件名']);
  setVal('sagyoNaiyo', row['作業内容']);
  setVal('sagyozikan', row['作業時間']);
  setVal('sagyoShinchoku', row['作業進捗'] || '順調');
  setVal('okureHokoku', row['遅れ報告']);
  setVal('sonotaHokoku', row['その他報告事項']);
  // 登録モーダルの担当者は行の担当者（メインのログイン担当者は変更しない）
  setVal('regTanto', row['担当者コード'] || getVal('tanto'));
  setVal('regTantoName', row['担当者名'] || getVal('tantoName'));
  exitCopyMode(); // コピー登録モードは毎回リセット
  updateMode();
  takeSnapshot(); // 選択された未編集の状態（リセットの復元先）
  openModal('registModal');
  doTotal(); // 開いた日付の合計を自動取得
}

// ④ 登録ボタン → 新規モードで登録モーダル
function openNewModal() {
  if (viewOnly) {
    toast('参照のみモードでは新規登録できません', 'ng');
    return;
  }
  clearForm();
  setVal('date', fmtDate(0));
  syncRegTanto();
  exitCopyMode(); // コピー登録モードは毎回リセット
  updateMode();
  takeSnapshot(); // 新規のデフォルト表示（リセットの復元先）
  openModal('registModal');
  doTotal(); // 当日の合計を自動取得
}

// リセット: 登録モーダルを開いた時点の状態を記録／復元する。
function takeSnapshot() {
  formSnapshot = {};
  SNAPSHOT_FIELDS.forEach((f) => {
    formSnapshot[f] = getVal(f);
  });
}
function resetForm() {
  if (!formSnapshot) return;
  // コピー登録中は「コピー元の値に戻す」：新規モード（日報コード空）のまま入力欄を
  // コピー元＝スナップショットの値へ戻す。コピー登録モードは維持する。
  if (isCopyMode()) {
    SNAPSHOT_FIELDS.forEach((f) => {
      if (f !== 'nippoCd') setVal(f, formSnapshot[f]);
    });
    updateMode();
    doTotal();
    toast('コピー元の値に戻しました', 'ok');
    return;
  }
  // 通常（新規／修正モード）：開いた時点の状態へ復元
  // regTanto/regTantoName もスナップショットから復元するため syncRegTanto は呼ばない
  SNAPSHOT_FIELDS.forEach((f) => setVal(f, formSnapshot[f]));
  exitCopyMode();
  updateMode();
  doTotal(); // 復元した日付に応じた合計を再表示
  toast('入力をリセットしました', 'ok');
}

// コピー押下前の修正モードの初期表示状態へ戻す（日報コードも復元して修正モードに戻る）。
function backToEdit() {
  if (!formSnapshot) return;
  SNAPSHOT_FIELDS.forEach((f) => setVal(f, formSnapshot[f]));
  exitCopyMode();
  updateMode();
  doTotal();
  toast('修正モードに戻りました', 'ok');
}

// 日報一覧の担当者をログイン担当者（本人自動セットの結果）へ戻す。
// 未確定（自動セット前）なら HTML の初期値のまま。戻り値: 実際に変わったら true。
function restoreLoginTanto() {
  applyViewOnly(false); // ログイン担当者に戻る＝全権（参照のみを解除）
  if (!loginTanto) return false;
  const changed = getVal('tanto') !== loginTanto.code;
  setVal('tanto', loginTanto.code);
  setVal('tantoName', loginTanto.name);
  syncRegTanto();
  return changed;
}

// 新規登録の既定担当者＝メインのログイン担当者を登録モーダルへコピーする。
function syncRegTanto() {
  setVal('regTanto', getVal('tanto'));
  setVal('regTantoName', getVal('tantoName'));
}

// ---- フォーム操作 ---------------------------------------------------------
function setVal(id, v) {
  const el = $(id);
  if (el) el.value = v == null ? '' : v;
}
function getVal(id) {
  return ($(id)?.value ?? '').toString();
}

function collectForm() {
  // 送信する担当者は登録モーダルの担当者（メインのログイン担当者ではない）
  const o = { tanto: getVal('regTanto') };
  REG_FIELDS.forEach((f) => {
    o[f] = getVal(f);
  });
  o.date = toApiDate(getVal('date')); // yyyy-mm-dd → yyyy/m/d
  return o;
}

function clearForm() {
  setVal('nippoCd', '');
  setVal('date', '');
  setVal('ankenCd', '');
  setVal('torihikisakiMei', '');
  setVal('ankenMei', '');
  $('sagyoNaiyo').selectedIndex = 0; // 空欄なし。既定は先頭
  setVal('sagyozikan', '');
  $('sagyoShinchoku').value = '順調';
  setVal('okureHokoku', '');
  setVal('sonotaHokoku', '');
  updateMode();
}

function updateMode() {
  const isEdit = getVal('nippoCd').trim() !== '';
  const badge = $('modeBadge');
  // 参照のみモードで既存日報を開いた場合は「参照モード」（編集不可）
  if (viewOnly && isEdit) {
    badge.textContent = '参照モード';
    badge.className = 'badge view';
  } else if (isCopyMode()) {
    // コピー登録中（緑基調）。未登録の別日報として登録する状態
    badge.textContent = 'コピーモード';
    badge.className = 'badge copy';
  } else {
    badge.textContent = isEdit ? '修正モード' : '新規モード';
    badge.className = 'badge ' + (isEdit ? 'edit' : 'new');
  }
  $('nippoCdView').textContent = isEdit ? getVal('nippoCd') : '新規登録';
  // 登録ボタン名は新規＝「登録」／編集＝「更新」
  const btnRegist = $('btnRegist');
  btnRegist.textContent = isEdit ? '更新' : '登録';
  // コピーモード中は登録ボタンをコピーモードボタンと同じ緑にする
  btnRegist.classList.toggle('ok', isCopyMode());
  btnRegist.classList.toggle('primary', !isCopyMode());
  // コピーは編集モードのみ表示（参照のみモードでは CSS で非表示）
  $('btnCopy').style.display = isEdit ? '' : 'none';
  // コピー登録中の案内パネル（その他報告の下）
  $('copyNotice').style.display = isCopyMode() ? '' : 'none';
}

// ---- コピー登録モード ------------------------------------------------------
// 編集モードでコピー押下→日報コードを空にして新規化した状態。コピー元パネルは
// 廃止し、日報登録モーダルだけを表示したまま入力を引き継いで別日報として登録する。
function enterCopyMode() {
  copyMode = true;
  // コピー登録中は「戻る」を表示。リセットは「コピー元の値に戻す」動作になる。
  $('btnBack').style.display = '';
  $('btnReset').title = 'コピー元の値に戻す';
}
function exitCopyMode() {
  copyMode = false;
  $('btnBack').style.display = 'none';
  $('btnReset').title = '開いた時の状態に戻す';
}
// コピー登録中か
function isCopyMode() {
  return copyMode;
}
// 修正モードからコピーモードへ切り替える際、モーダルを少し浮き上げて元へ戻して見せる。
// アニメーション完了（＝元の位置に戻ったタイミング）で onReturn を実行し、そこで
// コピーモードへ切り替える（切替はアニメーションの後にする）。
function playCopyHop(onReturn) {
  const modalEl = $('registModal').querySelector('.modal');
  if (!modalEl) {
    if (onReturn) onReturn();
    return;
  }
  modalEl.classList.remove('copy-hop');
  void modalEl.offsetWidth; // リフローでアニメーションを確実に再生し直す
  modalEl.classList.add('copy-hop');
  modalEl.addEventListener(
    'animationend',
    () => {
      modalEl.classList.remove('copy-hop');
      if (onReturn) onReturn(); // 元の位置に戻った瞬間にコピーモードへ切替
    },
    { once: true }
  );
}

// 現行仕様の checkError() 相当
function checkError() {
  if (getVal('regTanto').trim() === '') return '担当者が未入力です';
  if (getVal('ankenCd').trim() === '') return '案件が未入力です';
  if (getVal('date').trim() === '') return '日付が未入力です';
  if (isNaN(new Date(getVal('date')).getDate())) return '日付が不正です';
  if (getVal('sagyoNaiyo').trim() === '') return '作業内容が未入力です';
  if (getVal('sagyozikan').trim() === '') return '作業時間が未入力です';
  if (isNaN(Number(getVal('sagyozikan')))) return '作業時間が不正です';
  if (getVal('sagyoShinchoku').trim() === '') return '作業進捗が未入力です';
  if (getVal('sonotaHokoku').trim() === '') return 'その他報告事項が未入力です';
  if (getVal('sagyoShinchoku') !== '順調' && getVal('okureHokoku').trim() === '')
    return '作業進捗が順調以外の場合は遅れ報告を入力してください';
  return null;
}

// ---- 登録 / 更新 / 削除 ---------------------------------------------------
async function doRegist() {
  if (viewOnly) {
    toast('参照のみモードでは登録・更新できません', 'ng');
    return;
  }
  const err = checkError();
  if (err) {
    toast(err, 'ng');
    return;
  }
  const body = collectForm();
  const isNew = (body.nippoCd || '').trim() === '';
  // 確認メッセージ: コピーモード＝コピー元の日報コードを添えて／修正モード＝更新確認
  if (isCopyMode()) {
    const srcCd = (formSnapshot && formSnapshot.nippoCd ? formSnapshot.nippoCd : '').trim();
    if (!(await uiConfirm(`日報コード ${srcCd} をもとにコピー登録します。よろしいですか。`)))
      return;
  } else if (!isNew) {
    if (!(await uiConfirm('修正します。よろしいですか。'))) return;
  }
  const r = await callApi('registData', body, isNew ? '新規登録' : '更新');
  if (isBizOk(r)) {
    closeModal('registModal');
    clearForm();
    loadList();
  }
}

async function doDelete() {
  if (viewOnly) {
    toast('参照のみモードでは削除できません', 'ng');
    return;
  }
  if (getVal('nippoCd').trim() === '') {
    toast('日報コードが空です（削除対象なし）', 'ng');
    return;
  }
  if (!(await uiConfirm('削除します。元に戻せませんのでご注意を'))) return;
  const r = await callApi('deleteData', { nippoCd: getVal('nippoCd') }, '削除');
  if (isBizOk(r)) {
    closeModal('registModal');
    clearForm();
    loadList();
  }
}

// 合計作業時間を取得して表示（登録モーダルを開くと自動実行。トーストは抑制）。
async function doTotal() {
  $('totalVal').textContent = '-';
  const d = toApiDate(getVal('date'));
  const t = getVal('regTanto') || getVal('tanto');
  if (!d || !t) return;
  const r = await callApi('getTotal', { tanto: t, date: d }, '合計取得', true);
  if (r && r.ok) $('totalVal').textContent = r.data ?? '-';
}

// ---- 一括コピー / 一括削除 -----------------------------------------------
// yyyy-mm-dd の開始〜終了（両端含む）を API 形式 yyyy/m/d の配列で返す。
function dateRange(fromIso, toIso) {
  const out = [];
  const s = new Date(fromIso + 'T00:00:00');
  const e = new Date(toIso + 'T00:00:00');
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return out;
  const d = new Date(s);
  while (d <= e) {
    out.push(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
    d.setDate(d.getDate() + 1);
    if (out.length > 400) break; // 安全弁
  }
  return out;
}

function openBulkCopy() {
  if (viewOnly) {
    toast('参照のみモードでは一括コピーできません', 'ng');
    return;
  }
  if (!selectedRows().length) {
    toast('対象の日報を選択してください', 'ng');
    return;
  }
  $('bulkCount').textContent = String(selectedRows().length);
  qs('input[name=bulkDateMode][value=single]').checked = true;
  $('bulkDateToWrap').classList.add('hidden');
  setVal('bulkDateFrom', fmtDate(0));
  setVal('bulkDateTo', fmtDate(0));
  openModal('bulkCopyModal');
}

async function doBulkCopy() {
  const rows = selectedRows();
  if (!rows.length) {
    toast('対象の日報を選択してください', 'ng');
    return;
  }
  const mode = qs('input[name=bulkDateMode]:checked').value;
  const fromIso = getVal('bulkDateFrom');
  if (!fromIso) {
    toast('日付を指定してください', 'ng');
    return;
  }
  let dates;
  if (mode === 'range') {
    const toIso = getVal('bulkDateTo');
    if (!toIso) {
      toast('終了日を指定してください', 'ng');
      return;
    }
    dates = dateRange(fromIso, toIso);
    if (!dates.length) {
      toast('日付範囲が不正です（開始≦終了）', 'ng');
      return;
    }
    if (dates.length > 366) {
      toast('範囲が広すぎます（最大366日）', 'ng');
      return;
    }
  } else {
    dates = [toApiDate(fromIso)];
  }
  const total = rows.length * dates.length;
  if (
    !(await uiConfirm(
      `選択 ${rows.length} 件 × ${dates.length} 日 = ${total} 件 を新規登録します。よろしいですか？`
    ))
  )
    return;

  let ok = 0,
    ng = 0;
  for (const r of rows) {
    for (const d of dates) {
      const body = {
        nippoCd: '',
        tanto: r['担当者コード'] || getVal('tanto'),
        date: d,
        ankenCd: r['案件コード'] || '',
        torihikisakiMei: r['取引先名'] || '',
        ankenMei: r['案件名'] || '',
        sagyoNaiyo: r['作業内容'] || '',
        sagyozikan: r['作業時間'] || '',
        sagyoShinchoku: r['作業進捗'] || '順調',
        okureHokoku: r['遅れ報告'] || '',
        sonotaHokoku: r['その他報告事項'] || ''
      };
      const res = await callApi('registData', body, '一括コピー', true);
      if (isBizOk(res)) ok++;
      else ng++;
    }
  }
  closeModal('bulkCopyModal');
  toast(`一括コピー: 成功 ${ok} 件${ng ? ` / 失敗 ${ng} 件` : ''}`, ng ? 'ng' : 'ok');
  await loadList();
}

async function doBulkDelete() {
  if (viewOnly) {
    toast('参照のみモードでは一括削除できません', 'ng');
    return;
  }
  const rows = selectedRows();
  if (!rows.length) {
    toast('対象の日報を選択してください', 'ng');
    return;
  }
  if (!(await uiConfirm(`選択した ${rows.length} 件 を削除します。元に戻せませんのでご注意を`)))
    return;
  let ok = 0,
    ng = 0;
  for (const r of rows) {
    const res = await callApi('deleteData', { nippoCd: r['日報コード'] }, '一括削除', true);
    if (isBizOk(res)) ok++;
    else ng++;
  }
  toast(`一括削除: 成功 ${ok} 件${ng ? ` / 失敗 ${ng} 件` : ''}`, ng ? 'ng' : 'ok');
  await loadList();
}

// ---- ⑤ 案件マスタ検索モーダル --------------------------------------------
function openAnkenModal() {
  setVal('svalue', '');
  openModal('ankenModal');
  $('svalue').focus();
  searchAnken(false); // 初期表示は履歴を実行して表示（検索ボタンは再検索用）
}
async function searchAnken(withSvalue) {
  // 案件は登録対象の担当者（登録モーダルの担当者）の履歴／検索を出す
  const t = getVal('regTanto') || getVal('tanto');
  const body = withSvalue ? { tanto: t, svalue: getVal('svalue') } : { tanto: t };
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

// ---- ⑥ 担当者マスタ検索モーダル（日報一覧の担当変更用） -------------------
// 登録モーダルからの担当者変更は廃止（①）。担当者マスタ一覧は「担当変更」からのみ開く。
function openTantoModal() {
  setVal('svalue2', '');
  openModal('tantoModal');
  $('svalue2').focus();
  searchTantoList(); // 初期表示は全件（svalue 空）を実行して表示（検索ボタンは再検索用）
}
async function searchTantoList() {
  const r = await callApi('getTantoList', { svalue: getVal('svalue2') }, '担当者検索');
  if (r && Array.isArray(r.data))
    renderTableInto($('tantoTable'), 'getTantoList', r.data, pickTanto);
}
function pickTanto(row) {
  closeModal('tantoModal');
  // ログイン担当者と同じなら確認不要で、そのまま全権で変更
  if (loginTanto && row['key'] === loginTanto.code) {
    applyTantoChange(row, false);
    return;
  }
  // 他担当者は参照許可の確認（全権/参照のみ/キャンセル）を経て確定する
  pendingTantoRow = row;
  openPermModal();
}

// ---- 担当変更（担当者マスタ一覧 → 参照許可の確認） ------------------------
// 日報一覧の担当者を変更し、権限モード（view=参照のみ）を反映して一覧を取り直す。
function applyTantoChange(row, view) {
  setVal('tanto', row['key']);
  setVal('tantoName', row['名称1']);
  applyViewOnly(view);
  toast(view ? '参照のみで担当者を変更しました' : '担当者を変更しました', 'ok');
  loadList();
}
function openPermModal() {
  // 選択した担当者名を確認メッセージへ差し込む（「[担当者名]さんから、…」）
  const name = (pendingTantoRow && pendingTantoRow['名称1']) || '';
  $('permMsg').textContent = `${name}さんから、事前に参照の許可を得ていますか？`;
  openModal('permModal');
}
// 許可確認モーダルで [全権許可]/[参照のみ] を選んだ → 担当者変更を確定。
function confirmPerm(view) {
  const row = pendingTantoRow;
  pendingTantoRow = null;
  closeModal('permModal');
  if (row) applyTantoChange(row, view);
}
// キャンセル/✕/背景クリック → 担当変更を中断（担当者は変更しない）。
function cancelPerm() {
  pendingTantoRow = null;
  closeModal('permModal');
}
// 参照のみモードの ON/OFF を UI（body クラス）へ反映する。
function applyViewOnly(on) {
  viewOnly = !!on;
  document.body.classList.toggle('view-only', viewOnly);
}

// ---- 自動更新（GitHub Releases / electron-updater） -----------------------
let updateBusy = false; // ダウンロード〜再起動の進行中フラグ
let updatePromptShown = false; // このログインセッションで更新確認ダイアログを表示したか（多重表示防止）

// 更新ボタンはログイン画面（btnUpdateLogin）と日報一覧（btnUpdate）の両方にある。
// 存在するものだけまとめて扱う。
function updateBtns() {
  return ['btnUpdate', 'btnUpdateLogin'].map((id) => $(id)).filter(Boolean);
}

// フッターに現在のバージョンを表示する（更新ボタンの右／ログイン・日報一覧の両方）。
function setVersionLabel(v) {
  if (!v) return;
  ['verLabel', 'verLabelLogin'].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = 'v' + v;
  });
}

// 日報一覧の初期表示時に更新有無をチェックし、更新ボタンの表示を切り替える。
// 最新と一致（または開発時・チェック失敗）ならボタンは非表示。
// 更新ありなら確認メッセージを表示し、OK で即更新／キャンセルでボタンを残してそのまま利用可能。
async function checkForUpdate() {
  if (updateBusy) return; // ダウンロード中は再チェックしない
  if (!window.appApi || !window.appApi.checkUpdate) return;
  const btns = updateBtns();
  let r;
  try {
    r = await window.appApi.checkUpdate();
  } catch (e) {
    btns.forEach((b) => b.classList.add('hidden')); // 失敗時はボタンを出さない
    return;
  }
  if (r && r.current) setVersionLabel(r.current); // 実バージョンで確定表示
  if (!r || !r.available) {
    btns.forEach((b) => b.classList.add('hidden'));
    return;
  }
  // 更新あり: ボタンを常設（任意のタイミングで更新可能）
  btns.forEach((b) => {
    b.title = `新しいバージョン ${r.version || ''} が利用可能です（現在 ${r.current}）`;
    b.classList.remove('hidden');
  });
  // 初期表示時に更新を促す。キャンセルならボタンを残してそのまま利用継続。
  // enterApp は webview の dom-ready / did-stop-loading で複数回呼ばれ得るため、
  // 確認ダイアログはこのログインセッションで一度だけに制限する（多重表示防止）。
  // （confirm はネイティブダイアログのため改行は \n。HTML タグ </br> は使えない）
  if (updatePromptShown) return;
  updatePromptShown = true;
  if (
    await uiConfirm(
      `最新のバージョン ${r.version || ''} がアップロードされています。\n最新のバージョンにアップデートしますか？`
    )
  ) {
    startUpdateFlow();
  }
}

// 更新ボタン押下 → 確認後に更新（任意のタイミング）。
async function doUpdate() {
  if (updateBusy) return;
  if (
    !(await uiConfirm(
      '最新バージョンに更新します。ダウンロード後にアプリを再起動します。よろしいですか？'
    ))
  )
    return;
  startUpdateFlow();
}

// 最新版のダウンロードを開始する（完了後は update-downloaded で再起動して適用）。
async function startUpdateFlow() {
  if (updateBusy || !window.appApi || !window.appApi.startUpdate) return;
  updateBusy = true;
  updateBtns().forEach((b) => {
    b.classList.remove('hidden');
    b.disabled = true;
    b.textContent = '⬆ 更新中…';
  });
  toast('更新をダウンロードしています…', 'ok');
  try {
    await window.appApi.startUpdate();
  } catch (e) {
    toast('更新の開始に失敗しました: ' + ((e && e.message) || e), 'ng');
    resetUpdateBtn();
  }
}

function resetUpdateBtn() {
  updateBusy = false;
  updateBtns().forEach((b) => {
    b.disabled = false;
    b.textContent = '⬆ 更新';
  });
}

// メインプロセスからの更新状態通知を購読して UI へ反映する（起動時に一度だけ配線）。
function wireUpdateStatus() {
  if (!window.appApi || !window.appApi.onUpdateStatus) return;
  window.appApi.onUpdateStatus((s) => {
    if (!s) return;
    if (s.state === 'downloading') {
      const t = `⬆ ${Math.round(s.percent || 0)}%`;
      updateBtns().forEach((b) => (b.textContent = t));
    } else if (s.state === 'downloaded') {
      toast('ダウンロード完了。再起動して更新します。', 'ok');
      window.appApi.quitAndInstall();
    } else if (s.state === 'error') {
      toast('更新エラー: ' + (s.message || ''), 'ng');
      resetUpdateBtn();
    }
  });
}

// ---- toast ----------------------------------------------------------------
let toastTimer = null;
function toast(msg, kind) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'show ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = '';
  }, 2600);
}

// ---- イベント配線 ---------------------------------------------------------
function wire() {
  // 認証画面
  $('btnEnterApp').addEventListener('click', () => tryEnter(false));
  $('btnReload').addEventListener('click', () => {
    webReady = false;
    // 再読込では日報一覧の担当者をログイン担当者に戻す
    restoreLoginTanto();
    if (document.body.classList.contains('app')) pendingListReload = true;
    rk.reload();
  });

  // メイン画面
  $('btnReauth').addEventListener('click', () => reauth());
  $('btnTantoChange').addEventListener('click', () => openTantoModal());
  $('btnGetList').addEventListener('click', () => loadList());
  $('btnToggleAll').addEventListener('click', () =>
    setListFilterMode(listFilterMode === 'all' ? 'month' : 'all')
  );
  $('btnPrevMonth').addEventListener('click', () => shiftFilterMonth(-1));
  $('btnNextMonth').addEventListener('click', () => shiftFilterMonth(1));
  $('filterMonth').addEventListener('change', () => {
    const m = String(getVal('filterMonth')).match(/(\d{4})-(\d{2})/);
    if (!m) return;
    filterYear = Number(m[1]);
    filterMonth = Number(m[2]);
    applyListFilter();
  });
  // 年月は直接入力不可（カレンダー選択のみ）。Tab のみ許可してフォーカス移動は残す
  $('filterMonth').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') e.preventDefault();
  });
  // 絞り込みツールバー：入力・選択のたびに再フィルタ
  ['fCode', 'fTorihiki', 'fAnken', 'fSonota'].forEach((id) =>
    $(id).addEventListener('input', () => applyListFilter())
  );
  ['fNaiyo', 'fShinchoku'].forEach((id) =>
    $(id).addEventListener('change', () => applyListFilter())
  );
  $('btnClearFilter').addEventListener('click', () => clearFieldFilters());
  $('btnUpdate').addEventListener('click', () => doUpdate());
  $('btnUpdateLogin').addEventListener('click', () => doUpdate());
  $('btnNew').addEventListener('click', () => openNewModal());
  $('btnBulkCopy').addEventListener('click', () => openBulkCopy());
  $('btnBulkDelete').addEventListener('click', () => doBulkDelete());

  // 一括コピー モーダル
  $('btnCloseBulkCopy').addEventListener('click', () => closeModal('bulkCopyModal'));
  $('btnBulkCopyExec').addEventListener('click', () => doBulkCopy());
  qsa('input[name=bulkDateMode]').forEach((rb) => {
    rb.addEventListener('change', () => {
      const range = qs('input[name=bulkDateMode]:checked').value === 'range';
      $('bulkDateToWrap').classList.toggle('hidden', !range);
    });
  });
  // 一括コピーの日付もカレンダー入力のみ
  ['bulkDateFrom', 'bulkDateTo'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') e.preventDefault();
    });
  });
  // 範囲指定で 開始日 > 終了日 になったら 終了日＝開始日 に補正（yyyy-mm-dd は文字列比較で可）
  const fixBulkRange = () => {
    const f = getVal('bulkDateFrom'),
      t = getVal('bulkDateTo');
    if (f && t && f > t) setVal('bulkDateTo', f);
  };
  ['input', 'change'].forEach((ev) => {
    $('bulkDateFrom').addEventListener(ev, fixBulkRange);
    $('bulkDateTo').addEventListener(ev, fixBulkRange);
  });

  // 登録モーダル
  $('btnCloseRegist').addEventListener('click', () => closeModal('registModal'));
  $('btnRegist').addEventListener('click', () => doRegist());
  $('btnDelete').addEventListener('click', () => doDelete());
  $('btnCopy').addEventListener('click', () => {
    // 先に浮き上げアニメを再生し、元の位置に戻ったタイミングでコピーモードへ切替
    playCopyHop(() => {
      enterCopyMode(); // コピー登録モードへ（日報登録モーダルはそのまま表示）
      setVal('nippoCd', '');
      updateMode();
      toast('新規モードに切替（コピー登録）', 'ok');
    });
  });
  $('btnReset').addEventListener('click', () => resetForm());
  $('btnBack').addEventListener('click', () => backToEdit());
  // 日付ボタン: 日付を設定して合計を取り直す
  qsa('.date-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setVal('date', fmtDate(Number(btn.dataset.days)));
      doTotal();
    });
  });
  // 日付はカレンダー入力のみ（キーボードでの直接入力は不可。Tab 等は許可）
  $('date').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') e.preventDefault();
  });
  // カレンダーで日付が変わったら合計を取り直す（input/change 両方で確実に拾う）
  $('date').addEventListener('input', () => doTotal());
  $('date').addEventListener('change', () => doTotal());
  $('btnAnkenSearch').addEventListener('click', () => openAnkenModal());

  // 案件モーダル
  $('btnAnkenDoSearch').addEventListener('click', () => searchAnken(true));
  $('btnAnkenHistory').addEventListener('click', () => searchAnken(false));
  $('btnCloseAnken').addEventListener('click', () => closeModal('ankenModal'));

  // 担当者モーダル
  $('btnTantoDoSearch').addEventListener('click', () => searchTantoList());
  $('btnCloseTanto').addEventListener('click', () => closeModal('tantoModal'));

  // 担当変更の参照許可確認モーダル（担当者選択後に表示）
  $('btnClosePerm').addEventListener('click', () => cancelPerm()); // ✕ で中断
  $('btnPermFull').addEventListener('click', () => confirmPerm(false)); // 全権許可
  $('btnPermView').addEventListener('click', () => confirmPerm(true)); // 参照のみ

  // 共通確認モーダル（native confirm の代替）
  $('btnConfirmOk').addEventListener('click', () => closeConfirm(true));
  $('btnConfirmCancel').addEventListener('click', () => closeConfirm(false));
  $('confirmModal').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      closeConfirm(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeConfirm(false);
    }
  });

  // オーバーレイ背景クリックで閉じる（モーダル本体クリックは無視）
  qsa('.modal-overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target !== ov) return;
      // 確認モーダルは背景クリックをキャンセル扱いにして Promise を解決する
      if (ov.id === 'confirmModal') closeConfirm(false);
      else closeModal(ov.id);
    });
  });

  // 自動更新の状態通知を購読
  wireUpdateStatus();
}

// ⑥ 再認証: webview セッションを消去し、Microsoft SSO のログイン画面から入り直す。
async function reauth() {
  try {
    if (window.appApi && window.appApi.clearSession) await window.appApi.clearSession();
  } catch (e) {
    toast('セッション消去に失敗しました: ' + ((e && e.message) || e), 'ng');
  }
  tantoAutoDone = false; // 次回ログイン時に本人を再判定
  showAuth();
  webReady = false;
  rk.reload();
}

// ---- start ----------------------------------------------------------------
initSelects();
initListFilter();
wire();
showAuth();
// フッターの現在バージョン初期表示（確定値は checkForUpdate の r.current で上書き）
if (window.appInfo) setVersionLabel(window.appInfo.version);
// ログイン画面でも更新有無をチェックし、更新があればフッター右端に更新ボタンを表示する。
// （GitHub Releases への照会で webview のログイン状態に依存しない）
checkForUpdate();
// ログイン担当者の初期値（本人自動セット前の既定。autoSetTantoOnce が確定次第上書き）
loginTanto = { code: getVal('tanto'), name: getVal('tantoName') };
