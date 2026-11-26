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

// 一括変更（変更ページ）で変更できる項目。案件は案件コード＋取引先名＋案件名をまとめて扱う。
// key: 変更後コントロールの識別子 / col: 日報一覧行(DB)のキー / type: コントロール種別。
const BULK_CHANGE_FIELDS = [
  { key: 'date', label: '日付', col: '日付', type: 'date' },
  { key: 'anken', label: '案件', col: '案件コード', type: 'anken' },
  { key: 'sagyoNaiyo', label: '作業内容', col: '作業内容', type: 'select', options: SAGYO_NAIYO },
  { key: 'sagyozikan', label: '作業時間', col: '作業時間', type: 'text' },
  {
    key: 'sagyoShinchoku',
    label: '作業進捗',
    col: '作業進捗',
    type: 'select',
    options: SAGYO_SHINCHOKU
  },
  { key: 'okureHokoku', label: '遅れ報告', col: '遅れ報告', type: 'textarea' },
  { key: 'sonotaHokoku', label: 'その他報告', col: 'その他報告事項', type: 'textarea' }
];

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
  // 日付は列として出さず、日付ごとのヘッダー行（renderTableInto）で表示する
  getNippoList: [
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
// 実行環境: preload が注入する window.appApi の有無でデスクトップ版/ブラウザ表示版を判定する。
const IS_BROWSER = !window.appApi;
// ブラウザ表示版の同一オリジン API ヘルパー（ローカルサーバーの /api を叩く）。
// ローカルサーバーは起動ごとにトークン（httpOnly Cookie）を作り直すため、アプリの再起動
// （自動更新・PC 再起動後の自動起動）より前から開いていたタブは /api が 403 になる。
// その場合は再読み込み（index.html の再取得でトークンを受け取り直す）を促す例外にする。
const STALE_TAB_MSG =
  'アプリが再起動されたため接続が切れました。ページを再読み込み（F5）してください。';
/** @param {Response} r */
async function readLocalJson(r) {
  if (r.status === 403) throw new Error(STALE_TAB_MSG);
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`ローカルサーバーの応答が不正です（HTTP ${r.status}）`);
  }
}
async function apiGet(p) {
  return readLocalJson(await fetch(p, { headers: { accept: 'application/json' } }));
}
async function apiPost(p, body) {
  const r = await fetch(p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}'
  });
  return readLocalJson(r);
}
// ブラウザ表示版のローカルサーバー通信失敗を利用者とログに示す（認証画面ではエラー欄にも残す）。
function reportBrowserApiError(e) {
  const msg = String((e && e.message) || e);
  console.error('[nippo] ローカルサーバー通信失敗:', msg);
  setConn('ng', '通信エラー');
  setStatus(msg);
  toast(msg, 'ng');
  if (document.body.classList.contains('auth')) showLoginErrorText(msg);
}
let webReady = false;
let formSnapshot = null; // 登録モーダルを開いた時点の値（リセット用）
let copyMode = false; // コピー登録中（編集モードでコピー押下→新規化した状態）
let viewOnly = false; // 参照のみモード（他担当者を参照許可のみで閲覧。編集系 UI を隠す）
let pendingTantoRow = null; // 担当変更で選択中の担当者行（許可確認モーダルで確定/中断する）
let loginTanto = null; // ログイン担当者（本人自動セットの結果。再読込でここへ戻す）
let pendingLoginEmail = ''; // 手動入力時、永続化に添える今回ログインのメール（無ければ空）
let authMethod = 'sso'; // 認証方式の選択（'sso'=SSO自動照合 / 'manual'=ユーザーID手動入力）
let pendingListReload = false; // webview 再読込の完了後、アプリ画面で一覧を取り直すフラグ
let currentNippoList = []; // 現在表示中（フィルタ適用後）の日報一覧（一括操作用）
let currentEditIndex = -1; // 修正モードで開いている日報の currentNippoList 上の位置（新規/コピー時は -1）
let allNippoRows = []; // API から取得した全件（フィルタ前。並べ替え済み）
let listFilterMode = 'month'; // 一覧の表示モード（'month'=指定月のみ / 'all'=全件）
let filterYear = 0; // 月表示モードで絞り込む年（初期化時に当月をセット）
let filterMonth = 0; // 月表示モードで絞り込む月（1-12）
const selectedNippo = new Set(); // 選択中の日報コード（一括操作用）
let ankenTarget = 'regist'; // 案件マスタ検索の反映先（'regist'=登録モーダル / 'bulk'=一括変更 / 'indiv'=個別変更の行）
let bulkRows = []; // 一括変更の対象行（モーダルを開いた時点の選択スナップショット）
let bulkAfterEls = {}; // 一括変更（変更ページ）の変更後コントロール参照（key → 要素）
let bulkChecks = {}; // 一括変更（変更ページ）の変更対象チェックボックス参照（key → checkbox）
let indivEls = []; // 個別変更ページの行ごとのコントロール参照（[{orig, date, ...}]）
let indivAnkenTarget = null; // 個別変更で案件検索の反映先となる行エントリ

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

// ---- 日付・祝日ユーティリティ（日付ヘッダー行／入力チェック用） ----------
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const STD_HOURS = 8; // 1日の標準作業時間

// yyyymmdd 数値 → Date（ローカル時刻 0:00）。
function numToDate(n) {
  return new Date(Math.floor(n / 10000), (Math.floor(n / 100) % 100) - 1, n % 100);
}
// Date → yyyymmdd 数値。
function dateToNum(d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
// yyyymmdd 数値 → 「yyyy/mm/dd(曜)」表記。
function fmtDateWithDow(n) {
  const d = numToDate(n);
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}/${mo}/${da}(${WEEKDAYS[d.getDay()]})`;
}

// 指定年の日本の祝日（振替休日・国民の休日を含む）を yyyymmdd の Set で返す（年ごとにキャッシュ）。
// 対応範囲は 2003〜2099 年（ハッピーマンデー完全施行後）。春分・秋分の日は近似式で算出する。
// 年により異なる祝日（天皇誕生日の日付、2019年の即位関連、山の日の施行、2020・2021年の五輪特例）も反映する。
const holidayCache = {};
function jpHolidays(y) {
  if (holidayCache[y]) return holidayCache[y];
  const base = new Set();
  const add = (m, d) => base.add(y * 10000 + m * 100 + d);
  // 第 n 月曜日
  const nthMonday = (m, n) => {
    const first = new Date(y, m - 1, 1).getDay();
    return 1 + ((8 - first) % 7) + (n - 1) * 7;
  };
  const k = Math.floor((y - 1980) / 4);
  add(1, 1); // 元日
  add(1, nthMonday(1, 2)); // 成人の日
  add(2, 11); // 建国記念の日
  if (y >= 2020) add(2, 23); // 天皇誕生日（2020年〜）
  if (y <= 2018) add(12, 23); // 天皇誕生日（〜2018年）
  if (y === 2019) {
    add(5, 1); // 天皇の即位の日（前後の 4/30・5/2 は国民の休日として下で付与）
    add(10, 22); // 即位礼正殿の儀の行われる日
  }
  add(3, Math.floor(20.8431 + 0.242194 * (y - 1980) - k)); // 春分の日
  add(4, 29); // 昭和の日
  add(5, 3); // 憲法記念日
  add(5, 4); // みどりの日
  add(5, 5); // こどもの日
  // 海の日・スポーツの日・山の日（東京五輪の特例年あり）
  if (y === 2020) {
    add(7, 23);
    add(7, 24);
    add(8, 10);
  } else if (y === 2021) {
    add(7, 22);
    add(7, 23);
    add(8, 8);
  } else {
    add(7, nthMonday(7, 3)); // 海の日
    add(10, nthMonday(10, 2)); // スポーツの日（〜2019年は体育の日）
    if (y >= 2016) add(8, 11); // 山の日（2016年〜）
  }
  add(9, nthMonday(9, 3)); // 敬老の日
  add(9, Math.floor(23.2488 + 0.242194 * (y - 1980) - k)); // 秋分の日
  add(11, 3); // 文化の日
  add(11, 23); // 勤労感謝の日

  const result = new Set(base);
  // 振替休日: 日曜の祝日の後の最初の平日（祝日でない日）
  base.forEach((n) => {
    const d = numToDate(n);
    if (d.getDay() !== 0) return;
    do d.setDate(d.getDate() + 1);
    while (base.has(dateToNum(d)));
    result.add(dateToNum(d));
  });
  // 国民の休日: 前後を祝日に挟まれた平日
  base.forEach((n) => {
    const mid = numToDate(n);
    mid.setDate(mid.getDate() + 1);
    const next = new Date(mid);
    next.setDate(next.getDate() + 1);
    if (!base.has(dateToNum(mid)) && base.has(dateToNum(next)) && mid.getDay() !== 0)
      result.add(dateToNum(mid));
  });
  holidayCache[y] = result;
  return result;
}
// 土日祝なら true。
function isHoliday(n) {
  const d = numToDate(n);
  return d.getDay() === 0 || d.getDay() === 6 || jpHolidays(d.getFullYear()).has(n);
}
// 日付表示の色分け用クラス（土=青、日祝=赤）。
function dowClass(n) {
  const d = numToDate(n);
  if (d.getDay() === 0 || jpHolidays(d.getFullYear()).has(n)) return 'dow-hol';
  if (d.getDay() === 6) return 'dow-sat';
  return '';
}
// 作業時間の数値化（不正値は 0）。
function hoursOf(r) {
  const v = Number(r['作業時間']);
  return Number.isFinite(v) ? v : 0;
}
// 小数誤差を丸めて表示用文字列にする（例: 7.5 / 8）。
function fmtHours(h) {
  return String(Math.round(h * 100) / 100);
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
// ※ ブラウザ表示版には <webview> が無いため、これらの配線はデスクトップ版のみ行う。
if (!IS_BROWSER) {
  rk.addEventListener('did-navigate', (e) => {
    if (!document.body.classList.contains('auth')) return;
    if (isTargetUrl(e.url)) showMask();
    else hideMask();
  });
  rk.addEventListener('dom-ready', () => {
    webReady = true;
    // 対象ページに戻ってきた（＝ログイン完了想定）ら、SSO方式時のみ自動でアプリ表示を試行。
    // 手動入力方式では自動照合せず、ユーザーIDの入力を待つ。
    if (document.body.classList.contains('auth') && isTargetUrl() && authMethod === 'sso')
      tryEnter(true);
  });
  // 読み込みが本当に止まった時に緑化（SSO は複数回リダイレクトするため did-stop-loading で判定）
  rk.addEventListener('did-stop-loading', () => {
    webReady = true;
    setConn('ok', isTargetUrl() ? '接続OK' : '読込完了');
    if (document.body.classList.contains('auth') && isTargetUrl() && authMethod === 'sso')
      tryEnter(true);
    // アプリ画面での再読込完了時は、戻したログイン担当者で一覧を取り直す
    else if (pendingListReload && isTargetUrl()) {
      pendingListReload = false;
      loadList();
    }
  });
  rk.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return; // ABORTED（リダイレクト等）は無視
    webReady = false;
    console.error('[nippo] webview 読込失敗:', e.errorDescription || e.errorCode);
    setConn('ng', '読込失敗');
  });
  rk.addEventListener('did-start-loading', () => setConn('warn', '読み込み中…'));
}

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
  setConn('warn', '認証待ち');
  hideMask();
  clearLoginError();
  applyAuthMethod(); // 選択中の認証方式（SSO/手動）に応じてタブ・入力欄の表示を復元
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

// ログイン確認 → 本人特定 → アプリ表示。silent=true のときは失敗時トーストを抑制（自動試行用）。
let enterInFlight = false; // tryEnter の多重起動防止（did-stop-loading が複数回発火するため）
let forcedReauthTried = false; // サイレントSSO＋永続情報なし時の強制再認証は一度だけ

async function tryEnter(silent) {
  if (!webReady) {
    if (!silent) toast('埋め込みブラウザの準備中です。少し待って再度お試しください。', 'ng');
    return;
  }
  if (!isTargetUrl()) {
    if (!silent) toast('先に対象システムにログインしてください。', 'ng');
    return;
  }
  if (enterInFlight) return;
  enterInFlight = true;
  showMask(); // 取得〜切替の間、既存システム画面を隠す
  try {
    // 第1フェーズ: 本人特定（Microsoft ログインメール → 名称4 照合）。
    const id = await resolveLoginTanto();
    if (id.error) {
      hideMask();
      if (id.error === 'reauth') {
        // サイレントSSO＋永続情報なし: 対話ログインでメールを捕捉し直す
        reauth();
        return;
      }
      if (id.error === 'api') {
        // 担当者マスタの取得失敗（通信・HTTP・業務エラー）。照合不可ではないので手動入力へ回さない
        // （ログイン切れの場合は callApi 内で認証画面へ戻し済み）。
        showLoginError(API_FAIL_MSG);
        return;
      }
      // 第1フェーズ失敗 → 第2フェーズ（ユーザーID手動入力）へ誘導。
      // id.email は捕捉できていれば手動入力欄の初期候補＆永続化に使う。
      showManualAuth(id.email || '');
      return;
    }

    // 本人確定 → 担当者を設定して一覧取得
    const ok = await enterWithTanto(id.code, id.name);
    // 入れない（ログイン切れ等。callApi 内で showAuth 済みの場合あり）→ マスクを外す
    if (!ok) hideMask();
  } finally {
    enterInFlight = false;
  }
}

// 本人確定後の共通処理: 担当者をセットし、日報一覧を取得してアプリ画面へ入る。
// 成功（一覧取得できてアプリ表示）で true、入れなかったら false。
// デスクトップ版・ブラウザ版・第2フェーズ手動認証の3経路から共用する。
async function enterWithTanto(code, name) {
  setVal('tanto', code);
  setVal('tantoName', name);
  loginTanto = { code, name };
  syncRegTanto();
  const seq = ++listSeq; // 取得中の loadList の応答を無効にする（loadList と同じ連番）
  const r = await callApi('getNippoList', { tanto: code }, '日報一覧取得', true);
  if (seq !== listSeq || getVal('tanto') !== code) return false; // 後から別の取得・担当変更があった
  if (r && Array.isArray(r.data)) {
    clearLoginError();
    hideManualAuth();
    if (IS_BROWSER) setConn('ok', '接続OK');
    enterApp();
    showNippoList(r.data);
    return true;
  }
  return false;
}

// ログイン中ユーザー本人の担当者を確定する。
// 手順: ①今回ログインのメール（@より前）で名称4 照合（SSO自動照合）→ ヒットで確定。
//       ②失敗時は永続化済みのユーザーID（前回確定値）で名称4 を再照合 → ヒットで確定
//         （前回SSO/手動で確定した本人が、名称4 変更後も自動認証されるようにするため）。
//       ③どちらも不可なら手動入力へ誘導（{ error: 'manual', email }）。
//       ・メールも永続情報も無い純初回のみ、一度だけ強制再認証（{ error: 'reauth' }）。
async function resolveLoginTanto() {
  // 今回ログインのメール（対話ログイン時に main が捕捉。サイレントSSOでは null）
  let email = '';
  try {
    email = (await window.appApi?.getCapturedEmail?.()) || '';
  } catch (e) {
    email = '';
  }

  // ① SSO自動照合: メールのローカル部（@ より前）＝名称4 で照合
  if (email) {
    const local = String(email).split('@')[0];
    const hit = await lookupTantoByLocal(local);
    if (hit && hit.error) return hit; // マスタ取得失敗は照合不可と区別して呼び出し側へ
    if (hit) {
      await persistIdentity(email, hit, local);
      return hit;
    }
  }

  // ② 永続化済みのユーザーID（前回SSO/手動で確定した値）で現在のマスタを再照合。
  //    これにより手動確定分も次回から自動認証される。名称4 が変わって一致しなく
  //    なった場合はここも外れ、③の手動入力へ誘導される。
  const saved = await getSavedIdentity();
  if (saved && saved.userId) {
    const hit = await lookupTantoByLocal(saved.userId);
    if (hit && hit.error) return hit;
    if (hit) {
      await persistIdentity(email || saved.email || '', hit, saved.userId);
      return hit;
    }
  }

  // メールも取れず、過去の確定情報も無い純初回だけ、一度だけ強制再認証で
  // 対話ログイン（メール捕捉）を促す。永続情報がある場合は破棄せず手動入力へ回す。
  if (!email && !saved && !forcedReauthTried) {
    forcedReauthTried = true;
    return { error: 'reauth' };
  }

  // ③ 自動照合できず → 手動入力へ。email は成功時の永続化に添える（無ければ空）。
  return { error: 'manual', email };
}

// 本人確定情報を永続化する（次回の自動照合に userId を使う）。
async function persistIdentity(email, hit, userId) {
  try {
    await window.appApi?.setIdentity?.({
      email: email || '',
      code: hit.code,
      name: hit.name,
      userId: userId || ''
    });
  } catch (e) {
    /* 永続化失敗は致命ではない（今回のログインは続行） */
  }
}

// 永続化した本人情報 { email, code, name, userId } を安全に読む（無ければ null）。
async function getSavedIdentity() {
  try {
    return (await window.appApi?.getIdentity?.()) || null;
  } catch (e) {
    return null;
  }
}

// getTantoList 全件から、指定ローカル値（メールの @ より前 or 手動入力ユーザーID）＝名称4 の行を探す。
// 返り値: { code, name }（該当あり）/ null（該当なし）/ { error: 'api' }（マスタ取得失敗）。
// 取得失敗を「該当なし」と区別し、通信エラーで「担当者情報が存在しない」と誤表示しないようにする。
async function lookupTantoByLocal(local) {
  local = String(local || '')
    .trim()
    .toLowerCase();
  if (!local) return null;
  const r = await callApi('getTantoList', { svalue: '' }, '本人特定', true);
  if (!r || !Array.isArray(r.data)) return { error: 'api' };
  const hits = r.data.filter(
    (x) =>
      String(x['名称4'] || '')
        .trim()
        .toLowerCase() === local
  );
  if (!hits.length) return null;
  return { code: hits[0].key, name: hits[0]['名称1'] || '' };
}

// 認証画面のエラー表示（メッセージに <br> を含むため innerHTML で描画）。
function showLoginError(html) {
  const el = $('authError');
  if (!el) return;
  el.innerHTML = html;
  el.classList.remove('hidden');
}
// 認証画面のエラー表示（例外メッセージ等の可変文字列用。textContent で描画）。
function showLoginErrorText(text) {
  const el = $('authError');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
}
function clearLoginError() {
  const el = $('authError');
  if (!el) return;
  el.innerHTML = '';
  el.classList.add('hidden');
}

// 手動入力したユーザーIDも名称4 に該当しなかった時の最終エラー文言。
const NO_TANTO_MSG =
  '担当者情報が存在しないため、ログインできません。<br>上長か、管理者にお問い合わせください。';
// 担当者マスタの取得自体に失敗した時の文言（該当なしとは区別する）。
const API_FAIL_MSG =
  '担当者情報の取得に失敗しました。<br>通信状態を確認して、しばらくしてから再度お試しください。';
// 手動入力ブロックの説明文（SSO自動照合に失敗した時に表示）。
const MANUAL_MSG = '自動認証できませんでした。ユーザーIDを入力して認証してください。';

// ---- 手動入力パネルの表示制御 --------------------------------------------
// authMethod（'sso'/'manual'）を画面へ反映する。manual のときだけ手動入力パネルを
// 表示する（CSS 側で webview をオフスクリーンに退避し、白背景の中央パネルにする）。
function applyAuthMethod() {
  const manual = authMethod === 'manual';
  document.documentElement.classList.toggle('authmethod-manual', manual);
  const box = $('manualAuth');
  if (box) box.classList.toggle('hidden', !manual);
}

// SSO自動照合に失敗した時、手動入力パネルへ切り替える。
// email: 捕捉できていれば入力欄の初期候補＆認証成功時の永続化に使う。
function setAuthMethod(method, opts) {
  const o = opts || {};
  const prevManual = authMethod === 'manual';
  authMethod = method === 'manual' ? 'manual' : 'sso';
  if (authMethod === 'manual') {
    if (o.email) pendingLoginEmail = o.email;
    const msg = $('manualAuthMsg');
    if (msg) msg.textContent = MANUAL_MSG;
  }
  clearLoginError();
  applyAuthMethod();
  if (authMethod === 'manual') {
    const inp = $('manualUserId');
    if (inp) {
      // 捕捉メールがあればローカル部を初期値に（誤りデータ時の手直し候補）。
      if (o.email && !inp.value) inp.value = String(o.email).split('@')[0];
      // 既に手動表示中（自動再試行の重複呼び出し等）なら入力途中を乱さない。
      if (!prevManual) {
        inp.focus();
        inp.select?.();
      }
    }
  }
}

// SSO照合失敗時に手動入力へ誘導する。
function showManualAuth(email) {
  setAuthMethod('manual', { email: email || '' });
}
// アプリ画面へ入る時など、手動入力欄を確実に隠す。
function hideManualAuth() {
  const box = $('manualAuth');
  if (box) box.classList.add('hidden');
}

// 手動入力したユーザーIDで認証を確定する（第2フェーズの実行）。
// 成功: 手動入力値を永続化し（次回から自動認証）、アプリ画面へ。
// 失敗: 「担当者情報が存在しない」エラーを表示（入力欄は残して再入力可能）。
async function submitManualId() {
  const uid = getVal('manualUserId').trim();
  if (!uid) {
    toast('ユーザーIDを入力してください', 'ng');
    return;
  }
  if (IS_BROWSER) {
    // ブラウザ版: 永続化はサーバー側で行うため /api/manual-login に委譲する。
    let who;
    try {
      who = await apiPost('/api/manual-login', { userId: uid });
    } catch (e) {
      reportBrowserApiError(e);
      return;
    }
    if (who && who.code) {
      await enterWithTanto(who.code, who.name || '');
      return;
    }
    if (who && who.error === 'login') {
      toast('ログインが必要です。「SSO認証」からログインしてください。', 'ng');
      return;
    }
    showLoginError(NO_TANTO_MSG);
    return;
  }
  // デスクトップ版: 名称4 照合 → 成功なら手動ユーザーIDを含めて永続化。
  const hit = await lookupTantoByLocal(uid);
  if (hit && hit.error) {
    showLoginError(API_FAIL_MSG);
    return;
  }
  if (!hit) {
    showLoginError(NO_TANTO_MSG);
    return;
  }
  // 永続化に添えるメール。SSO失敗のフォールバックでは pendingLoginEmail に入っている。
  // 念のため空なら捕捉メールを取り直して補完する（次回の自動照合は userId で行う）。
  let email = pendingLoginEmail;
  if (!email) {
    try {
      email = (await window.appApi?.getCapturedEmail?.()) || '';
    } catch (e) {
      email = '';
    }
  }
  // 手動入力したユーザーIDを永続化 → 次回は resolveLoginTanto の②で自動照合される。
  await persistIdentity(email, hit, uid);
  const ok = await enterWithTanto(hit.code, hit.name);
  if (!ok) hideMask();
}

// ---- ブラウザ表示版の認証フロー -------------------------------------------
// 起動時: /api/whoami で本人を確認 → 確定していれば一覧へ、未ログインならログインボタン表示。
async function browserBoot() {
  showAuth();
  let who;
  try {
    who = await apiGet('/api/whoami');
  } catch (e) {
    reportBrowserApiError(e); // 未ログイン扱いにせず、原因（再読み込みが必要等）を示す
    return;
  }
  await browserHandleWhoami(who);
}

// 「ログイン」押下: main が SSO ウィンドウを開き、完了後に本人を返す。
async function browserLogin() {
  setConn('warn', 'ログイン処理中…');
  clearLoginError();
  let who;
  try {
    who = await apiPost('/api/login');
  } catch (e) {
    reportBrowserApiError(e); // 押しても何も起きない状態にしない
    return;
  }
  await browserHandleWhoami(who);
}

// whoami/login の結果を処理: 確定→一覧、manual→手動入力、login→ログイン待ち。
async function browserHandleWhoami(who) {
  if (who && who.code) {
    await enterWithTanto(who.code, who.name || '');
    return;
  }
  // 第1フェーズ失敗（メール→名称4 照合不可）→ 第2フェーズ（ユーザーID手動入力）へ。
  if (who && who.error === 'manual') {
    setConn('warn', '自動認証失敗');
    showManualAuth('');
    return;
  }
  // 'login'（rkanri 未ログイン）: 認証画面のままログインボタンを表示（CSS）
  setConn('warn', '認証待ち');
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

// API 実行の実体。デスクトップ版は webview 経由、ブラウザ版はローカルサーバー /api 経由。
// いずれも { ok, status, data } 形の結果を返す。
async function execApi(endpoint, body) {
  if (IS_BROWSER) {
    // ローカルサーバーが { ok, status, data } を返す（403＝古いタブ等は例外 → callApi が表示）
    return await apiPost('/api/' + endpoint, body);
  }
  return await rk.executeJavaScript(buildInjection(endpoint, body));
}

// API 実行。結果(result)を返す（テーブル描画は呼び出し側の責務）。
// ログイン切れ/HTML 応答時は認証画面に戻し null を返す。
// silent=true のとき成功トーストを抑制（自動処理用。エラー系は抑制しない）。
async function callApi(endpoint, body, label, silent) {
  if (!IS_BROWSER && !webReady) {
    toast('埋め込みブラウザの準備中です。ログイン後に再度お試しください。', 'ng');
    return null;
  }
  let result;
  try {
    result = await execApi(endpoint, body);
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
    setConn('warn', 'セッション切れ');
    setStatus('ログインが必要です');
    toast(
      IS_BROWSER
        ? 'ログインが必要です。「SSO認証」からログインしてください。'
        : 'ログインが必要です。認証画面でログインしてください。',
      'ng'
    );
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

// ---- 日報一覧の日付ヘッダー行 --------------------------------------------
// 行配列を日付（yyyymmdd）ごとに振り分けた Map を返す。
function groupRowsByDate(rows) {
  const m = new Map();
  rows.forEach((r) => {
    const dn = dateNum(r['日付']);
    if (!m.has(dn)) m.set(dn, []);
    m.get(dn).push(r);
  });
  return m;
}

// 日付ごとに「日付(曜) / 作業件数 / 作業合計時間ゲージ / 作業進捗（最多の割合）ゲージ」を表示する。
// 集計は絞り込み条件に関係なくその日の全日報（allNippoRows）で行う（1日の合計時間を正しく見せるため）。
// 絞り込みで一部だけ表示されている場合は件数を「表示/全体」で示す。
// dayAll: その日の全日報 / dayShown: その日の表示中（絞り込み後）の日報。
function buildDateHeaderRow(dn, dayAll, dayShown, colCount, selectable, dateGroups, onSelChange) {
  const total = dayAll.reduce((s, r) => s + hoursOf(r), 0);

  const tr = document.createElement('tr');
  tr.className = 'date-row';
  if (selectable) {
    // 日付単位の選択（配下の表示行をまとめて選択／解除）
    const td = document.createElement('td');
    td.className = 'gchk';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.title = 'この日付の日報を全選択';
    const keys = dayShown.map((r) => r['日報コード']);
    cb.checked = keys.length > 0 && keys.every((k) => selectedNippo.has(k));
    cb.addEventListener('change', () => {
      keys.forEach((k) => (cb.checked ? selectedNippo.add(k) : selectedNippo.delete(k)));
      onSelChange();
    });
    td.appendChild(cb);
    tr.appendChild(td);
    dateGroups.push({ cb, keys });
    // 日付ヘッダー行のどこをクリックしても、チェックボックスと同じく日付単位で選択／解除する
    // （一部選択中はクリックで全選択）。参照のみモードではチェック列ごと非表示のため反応しない。
    tr.addEventListener('click', (e) => {
      if (e.target === cb || viewOnly) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).length) return; // 文字の範囲選択中は無視
      cb.click();
    });
  }
  const td = document.createElement('td');
  td.colSpan = colCount;
  const box = document.createElement('div');
  box.className = 'date-head';

  const dateEl = document.createElement('span');
  dateEl.className = 'dh-date ' + dowClass(dn);
  dateEl.textContent = fmtDateWithDow(dn);
  box.appendChild(dateEl);

  const cnt = document.createElement('span');
  cnt.className = 'dh-count';
  cnt.textContent =
    dayShown.length === dayAll.length
      ? `作業件数 ${dayAll.length}件`
      : `作業件数 ${dayShown.length}/${dayAll.length}件`;
  box.appendChild(cnt);

  // 作業合計時間ゲージ（8h 未満=黄 / 8h ちょうど=緑 / 8h 超=赤。8h で満杯）
  const timeCls = total < STD_HOURS ? 'g-under' : total > STD_HOURS ? 'g-over' : 'g-just';
  box.appendChild(
    buildGauge(
      `作業時間 ${fmtHours(total)}h`,
      Math.min(total / STD_HOURS, 1),
      timeCls,
      `合計 ${fmtHours(total)}h / 標準 ${STD_HOURS}h`
    )
  );

  // 作業進捗：件数ベースの割合で最も多いものだけ表示（同率は遅れ側を優先）
  const counts = {};
  dayAll.forEach((r) => {
    const s = String(r['作業進捗'] || '');
    if (s) counts[s] = (counts[s] || 0) + 1;
  });
  const order = ['遅れ', 'やや遅れ', '順調'];
  let top = '';
  Object.keys(counts).forEach((s) => {
    if (
      !top ||
      counts[s] > counts[top] ||
      (counts[s] === counts[top] && order.indexOf(s) >= 0 && order.indexOf(s) < order.indexOf(top))
    )
      top = s;
  });
  if (top) {
    const ratio = counts[top] / dayAll.length;
    const shCls = top === '順調' ? 'g-good' : top === 'やや遅れ' ? 'g-warn' : 'g-late';
    const detail = Object.keys(counts)
      .map((s) => `${s} ${Math.round((counts[s] / dayAll.length) * 100)}%`)
      .join(' / ');
    box.appendChild(buildGauge(`${top} ${Math.round(ratio * 100)}%`, ratio, shCls, detail));
  }

  td.appendChild(box);
  tr.appendChild(td);
  return tr;
}

// ラベル + 横棒ゲージ（ratio: 0〜1）を作る。
function buildGauge(label, ratio, cls, title) {
  const wrap = document.createElement('span');
  wrap.className = 'dh-gauge ' + cls;
  if (title) wrap.title = title;
  const lb = document.createElement('span');
  lb.className = 'dh-label';
  lb.textContent = label;
  const bar = document.createElement('span');
  bar.className = 'gauge';
  const fill = document.createElement('span');
  fill.className = 'gauge-fill';
  fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  bar.appendChild(fill);
  wrap.appendChild(lb);
  wrap.appendChild(bar);
  return wrap;
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
  let allCb = null; // 見出しの全選択チェック（行・日付単位の選択と連動させる）
  if (selectable) {
    const th = document.createElement('th');
    th.className = 'chk';
    const all = document.createElement('input');
    allCb = all;
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
        cb.indeterminate = false;
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
  // 範囲選択（Shift+クリック）の起点。チェック／Ctrl+クリックした行を起点にする。
  let anchorIndex = null;
  // 日付ヘッダー行（日報一覧のみ）。日付ごとの選択チェックを持つ。
  const groupByDate = endpoint === 'getNippoList';
  const dateGroups = []; // [{ cb, keys }]
  // 日付ヘッダーのチェック状態を、配下の行の選択状態に合わせる（全選択=ON / 一部=中間）
  // あわせて見出しの全選択も、表示行の選択状態（全件=ON / 一部=中間）に合わせる。
  const syncGroupChecks = () => {
    dateGroups.forEach((g) => {
      const n = g.keys.filter((k) => selectedNippo.has(k)).length;
      g.cb.checked = n > 0 && n === g.keys.length;
      g.cb.indeterminate = n > 0 && n < g.keys.length;
    });
    if (allCb) {
      const n = data.filter((r) => selectedNippo.has(r['日報コード'])).length;
      allCb.checked = n > 0 && n === data.length;
      allCb.indeterminate = n > 0 && n < data.length;
    }
  };
  // 全行のチェックボックスの見た目を selectedNippo と同期する（範囲選択後の反映用）。
  const syncChecks = () => {
    container.querySelectorAll('tbody td.chk input[type=checkbox]').forEach((c, i) => {
      c.checked = selectedNippo.has(data[i]['日報コード']);
    });
    syncGroupChecks();
  };
  // 日付ごとの行を1回だけ振り分けておく（日付行ごとに全件を走査しないため）
  const shownByDate = groupByDate ? groupRowsByDate(data) : null;
  const allByDate = groupByDate ? groupRowsByDate(allNippoRows) : null;
  let prevDate = null;
  data.forEach((rowObj, index) => {
    if (groupByDate) {
      const dn = dateNum(rowObj['日付']);
      if (dn !== prevDate) {
        prevDate = dn;
        tbody.appendChild(
          buildDateHeaderRow(
            dn,
            allByDate.get(dn) || [],
            shownByDate.get(dn) || [],
            cols.length,
            selectable,
            dateGroups,
            syncChecks
          )
        );
      }
    }
    const tr = document.createElement('tr');
    const key = rowObj['日報コード'];
    // 作業進捗の遅れ具合に応じて行全体を赤系で強調（濃度は 遅れ > やや遅れ）
    const shinchoku = String(rowObj['作業進捗'] || '');
    if (shinchoku === 'やや遅れ') tr.classList.add('delay-warn');
    else if (shinchoku === '遅れ') tr.classList.add('delay-late');
    // 案件名に「非稼働」を含む行（休暇等）は薄いグレー背景
    if (groupByDate && String(rowObj['案件名'] || '').includes('非稼働'))
      tr.classList.add('nonwork');
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
        anchorIndex = index; // チェックした行を範囲選択の起点にする
        syncGroupChecks();
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
    tr.addEventListener('mousedown', (e) => {
      // Shift+クリックのネイティブなテキスト選択拡張を抑止（一瞬の選択表示を防ぐ）。
      // click では mousedown 後に既に選択が描画されてしまい事後削除では間に合わないため、
      // 選択が始まる mousedown の時点で preventDefault する。
      if (selectable && e.shiftKey) e.preventDefault();
    });
    tr.addEventListener('click', (e) => {
      // Shift+クリック: 起点（最後にチェック／Ctrl+クリックした行）から当該行まで範囲選択
      if (selectable && e.shiftKey) {
        const from = anchorIndex == null ? index : anchorIndex;
        const [a, b] = from <= index ? [from, index] : [index, from];
        // 範囲内を反転: 未チェックはON、チェック済みはOFFにする（起点行は変えない）
        for (let i = a; i <= b; i++) {
          if (i === from) continue;
          const k = data[i]['日報コード'];
          if (selectedNippo.has(k)) selectedNippo.delete(k);
          else selectedNippo.add(k);
        }
        anchorIndex = index; // 起点を今回の行に更新（続けて範囲を伸ばせる）
        syncChecks();
        // Shift+クリックで生じるテキスト選択を消す（編集は開かない）
        const s = window.getSelection && window.getSelection();
        if (s) s.removeAllRanges();
        return;
      }
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
        anchorIndex = index; // Ctrl+クリックした行を範囲選択の起点にする
        syncGroupChecks();
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
// 日報一覧の取得要求の連番。担当変更・再取得を続けて行った時に、古い要求の応答
// （前の担当者の一覧）が後から届いて今の担当者・権限で表示されるのを防ぐため、
// 最新の要求の応答だけを反映する（参照のみで見た他人の日報を全権で操作できてしまうのを防ぐ）。
let listSeq = 0;
async function loadList() {
  const seq = ++listSeq;
  const tanto = getVal('tanto');
  const r = await callApi('getNippoList', { tanto }, '日報一覧取得');
  if (seq !== listSeq || getVal('tanto') !== tanto) return; // 古い応答は捨てる
  if (r && Array.isArray(r.data)) showNippoList(r.data);
}
// ---- 入力チェック ---------------------------------------------------------
// 対象期間: 月表示モード＝表示中の月 / 全件表示モード＝当月。いずれも今日までの日付が対象。
// 絞り込み条件（案件名等）は無視し、取得済みの全日報（allNippoRows）で判定する。
// 返り値: [{ date(yyyymmdd), kind, item, msg }]（日付昇順）
function runInputCheck() {
  const today = new Date();
  const y = listFilterMode === 'all' ? today.getFullYear() : filterYear;
  const m = listFilterMode === 'all' ? today.getMonth() + 1 : filterMonth;
  const todayNum = dateToNum(today);
  const hoursByDate = {};
  allNippoRows.forEach((r) => {
    const n = dateNum(r['日付']);
    if (!n) return;
    hoursByDate[n] = (hoursByDate[n] || 0) + hoursOf(r);
  });
  const results = [];
  const days = new Date(y, m, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const n = y * 10000 + m * 100 + d;
    if (n > todayNum) break; // 未来日はチェックしない
    const label = fmtDateWithDow(n);
    const has = Object.prototype.hasOwnProperty.call(hoursByDate, n);
    if (!has) {
      // 土日祝以外の平日で入力なし
      if (!isHoliday(n))
        results.push({
          date: n,
          kind: 'W',
          item: '非稼働日',
          msg: `${label} 営業日ですが、入力がありません。よろしいでしょうか？`
        });
    } else if (!isHoliday(n) && hoursByDate[n] < STD_HOURS) {
      // 入力はあるが 1日の作業時間が 8時間未満（休日出勤分は対象外）
      results.push({
        date: n,
        kind: 'W',
        item: '稼働時間未満',
        msg: `${label} 作業時間が8時間を満たしていません。よろしいでしょうか？`
      });
    }
  }
  return { y, m, results };
}

// 入力チェックを実行し、結果をポップアップで一覧表示する。
function showInputCheck() {
  const { y, m, results } = runInputCheck();
  $('checkSummary').textContent = `対象: ${y}年${m}月 / ${results.length}件`;
  const wrap = $('checkTable');
  wrap.innerHTML = '';
  if (!results.length) {
    wrap.innerHTML = '<div class="empty-list check-ok">チェック対象の問題はありません。</div>';
  } else {
    const table = document.createElement('table');
    table.className = 'tbl-check';
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    ['日付', '種別', 'チェック', 'メッセージ'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    results.forEach((r) => {
      const tr = document.createElement('tr');
      [
        { t: fmtDateWithDow(r.date), c: 'c-date ' + dowClass(r.date) },
        { t: r.kind, c: 'c-kind kind-' + r.kind },
        { t: r.item, c: 'c-item' },
        { t: r.msg, c: 'c-msg' }
      ].forEach((x) => {
        const td = document.createElement('td');
        td.className = x.c;
        td.textContent = x.t;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }
  openModal('checkModal');
  $('btnCheckOk').focus();
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

// 登録モーダルの◀▶（前後の日報へ移動）の表示／活性状態を更新する。
// 修正モード（既存日報を編集中・参照のみ／コピー中ではない）のときだけ表示し、
// 一覧（並び順・絞り込み結果）の先頭／末尾では該当ボタンを非活性にする。
function updateEditNav() {
  const prev = $('btnPrevNippo');
  const next = $('btnNextNippo');
  const isEditMode = getVal('nippoCd').trim() !== '' && !viewOnly && !isCopyMode();
  prev.style.display = isEditMode ? '' : 'none';
  next.style.display = isEditMode ? '' : 'none';
  if (!isEditMode) return;
  const i = currentEditIndex;
  prev.disabled = !(i > 0);
  next.disabled = !(i >= 0 && i < currentNippoList.length - 1);
}

// 現在開いている日報から delta 件だけ移動した日報を、日報一覧と同じ並び順・
// 絞り込み結果（currentNippoList）に従って開く。範囲外なら何もしない。
function navigateEdit(delta) {
  if (currentEditIndex < 0) return;
  const target = currentEditIndex + delta;
  if (target < 0 || target >= currentNippoList.length) return;
  openEditModal(currentNippoList[target]);
}

// ③ 行クリック → 修正モードで登録モーダル
function openEditModal(row) {
  // 一覧（並び順・絞り込み結果）上の位置を記録し、◀▶ の前後移動の基準にする。
  currentEditIndex = currentNippoList.findIndex((r) => r['日報コード'] === row['日報コード']);
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
  currentEditIndex = -1; // 新規は一覧に紐づかないため前後移動なし
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
  if (changed) {
    // 他担当者の一覧と選択は破棄する（再取得に失敗しても全権で他人の日報を操作できないように）
    allNippoRows = [];
    applyListFilter();
  }
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
  // コピー登録中の案内パネル（日付の上）
  $('copyNotice').style.display = isCopyMode() ? '' : 'none';
  // ◀▶（前後の日報へ移動）は修正モードのときだけ表示する
  updateEditNav();
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

// ---- 更新系処理の排他（二重送信防止） ------------------------------------
// 登録・削除・一括処理の実行中は他の更新系処理を受け付けない（ダブルクリックや
// 待ちきれずの再押下による重複登録を防ぐ）。実行中は更新系ボタンを無効化する。
const MUTATION_BTNS = [
  'btnRegist',
  'btnDelete',
  'btnBulkCopyExec',
  'btnBulkDelete',
  'btnBulkChangeExec',
  'btnBulkIndivExec',
  'btnBulkReplaceExec'
];
let mutationBusy = false;
/**
 * fn を排他実行する。実行中に呼ばれた場合は何もしない。
 * @param {() => Promise<void>} fn
 */
async function runExclusive(fn) {
  if (mutationBusy) return;
  mutationBusy = true;
  MUTATION_BTNS.forEach((id) => ($(id).disabled = true));
  try {
    await fn();
  } finally {
    mutationBusy = false;
    MUTATION_BTNS.forEach((id) => ($(id).disabled = false));
  }
}

/**
 * 一括処理のループ実行。items を順に task(item) で API 実行し、結果を集計する。
 * - 進捗をステータス欄に「label中… n/N」で表示する。
 * - callApi が null を返した（ログイン切れ・実行エラー・準備中）ら、以降は送らず中断する。
 * - 失敗した項目は keyOf(item) で識別子を集め、利用者が分かるように返す。
 * task は callApi の結果を返し、null 以外で「対象なし」とする場合は 'skip' を返す。
 * @template T
 * @param {string} label
 * @param {T[]} items
 * @param {(item: T) => Promise<any>} task
 * @param {(item: T) => string} keyOf
 */
async function runBulk(label, items, task, keyOf) {
  const res = { ok: 0, ng: 0, skip: 0, failed: /** @type {string[]} */ ([]), aborted: 0 };
  for (let i = 0; i < items.length; i++) {
    setStatus(`${label}中… ${i + 1} / ${items.length}`);
    const r = await task(items[i]);
    if (r === 'skip') res.skip++;
    else if (r === null || r === undefined) {
      // 認証切れ等。残りは送らずに中断（この項目も未処理として数える）
      res.aborted = items.length - i;
      break;
    } else if (isBizOk(r)) res.ok++;
    else {
      res.ng++;
      res.failed.push(keyOf(items[i]));
    }
  }
  return res;
}

// runBulk の結果をトーストとステータス欄に出す（失敗した日報コード・中断件数も示す）。
function reportBulk(label, res, skipLabel) {
  const parts = [`成功 ${res.ok} 件`];
  if (res.ng) parts.push(`失敗 ${res.ng} 件`);
  if (res.skip) parts.push(`${skipLabel || '対象なし'} ${res.skip} 件`);
  if (res.aborted) parts.push(`未処理 ${res.aborted} 件（ログイン切れ等で中断）`);
  const bad = res.ng > 0 || res.aborted > 0;
  toast(`${label}: ${parts.join(' / ')}`, bad ? 'ng' : 'ok');
  const detail = res.failed.length ? ` / 失敗: ${res.failed.join(', ')}` : '';
  setStatus(bad ? `${label}: ${parts.join(' / ')}${detail}` : '');
}

// ---- 登録 / 更新 / 削除 ---------------------------------------------------
function doRegist() {
  return runExclusive(doRegistInner);
}
async function doRegistInner() {
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

function doDelete() {
  return runExclusive(doDeleteInner);
}
async function doDeleteInner() {
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
// 日付を続けて変えた時に古い要求の応答で上書きしないよう、最新の要求の応答だけ反映する。
let totalSeq = 0;
async function doTotal() {
  const seq = ++totalSeq;
  $('totalVal').textContent = '-';
  const d = toApiDate(getVal('date'));
  const t = getVal('regTanto') || getVal('tanto');
  if (!d || !t) return;
  const r = await callApi('getTotal', { tanto: t, date: d }, '合計取得', true);
  if (seq !== totalSeq) return; // 後から出した要求がある（古い応答は捨てる）
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

function doBulkCopy() {
  return runExclusive(doBulkCopyInner);
}
async function doBulkCopyInner() {
  if (viewOnly) {
    toast('参照のみモードでは一括コピーできません', 'ng');
    return;
  }
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

  // 実行中はモーダルを閉じ、進捗はステータス欄に出す（再実行は runExclusive で防止）
  closeModal('bulkCopyModal');
  const jobs = [];
  rows.forEach((r) => dates.forEach((d) => jobs.push({ r, d })));
  const res = await runBulk(
    '一括コピー',
    jobs,
    ({ r, d }) =>
      callApi(
        'registData',
        {
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
        },
        '一括コピー',
        true
      ),
    ({ r, d }) => `${r['日報コード']}→${d}`
  );
  if (!res.aborted) await loadList(); // 中断（ログイン切れ等）時は取り直さない
  reportBulk('一括コピー', res);
}

function doBulkDelete() {
  return runExclusive(doBulkDeleteInner);
}
async function doBulkDeleteInner() {
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
  const res = await runBulk(
    '一括削除',
    rows,
    (r) => callApi('deleteData', { nippoCd: r['日報コード'] }, '一括削除', true),
    (r) => String(r['日報コード'])
  );
  if (!res.aborted) await loadList(); // 中断（ログイン切れ等）時は取り直さない
  reportBulk('一括削除', res);
}

// ---- 一括変更（一括変更 / 個別変更 / 一括置換） ---------------------------
// 選択日報を DB 値そのままの registData 送信ボディへ（更新時は日報コードをキーにする）。
function rowToBody(r) {
  return {
    nippoCd: r['日報コード'] || '',
    tanto: r['担当者コード'] || getVal('tanto'),
    date: toApiDate(r['日付']) || '',
    ankenCd: r['案件コード'] || '',
    torihikisakiMei: r['取引先名'] || '',
    ankenMei: r['案件名'] || '',
    sagyoNaiyo: r['作業内容'] || '',
    sagyozikan: r['作業時間'] || '',
    sagyoShinchoku: r['作業進捗'] || '順調',
    okureHokoku: r['遅れ報告'] || '',
    sonotaHokoku: r['その他報告事項'] || ''
  };
}

// 対象項目について、選択日報の中に現れる相異なる値を出現順で返す（案件は案件コードで判定）。
function distinctFieldValues(f) {
  const key = f.type === 'anken' ? '案件コード' : f.col;
  const out = [];
  const seen = new Set();
  bulkRows.forEach((r) => {
    const raw = r[key] ?? '';
    const s = String(raw);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(raw);
    }
  });
  return out;
}

// 「複数あり」ポップアップや変更前表示に使う、1 行分の項目表示文字列。
function bulkFieldDisplay(f, r) {
  if (f.type === 'anken') return `${r['案件コード'] || ''} ${r['案件名'] || ''}`.trim();
  return String((f.type === 'date' ? r['日付'] : r[f.col]) ?? '');
}

function cellDiv(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
}
function roInput() {
  const el = document.createElement('input');
  el.type = 'text';
  el.readOnly = true;
  return el;
}

// 変更前セルのコンポーネントを作る。変更後と同じ種類・同じサイズで、readonly/disabled にする。
// 先頭選択行（bulkRows[0]）の値を表示する（全件同一の項目でのみ呼ばれる）。
function buildBeforeControl(f, container) {
  const first = bulkRows[0];
  if (f.type === 'date') {
    const el = document.createElement('input');
    el.type = 'date';
    el.value = toInputDate(first['日付']);
    el.disabled = true;
    container.appendChild(el);
  } else if (f.type === 'anken') {
    // 変更前は参照用のため検索ボタンは出さない（案件コードは readonly 表示のみ）
    const cd = roInput();
    cd.value = first['案件コード'] || '';
    const tori = roInput();
    tori.value = first['取引先名'] || '';
    const anken = roInput();
    anken.value = first['案件名'] || '';
    container.appendChild(cd);
    container.appendChild(tori);
    container.appendChild(anken);
  } else if (f.type === 'select') {
    const el = document.createElement('select');
    f.options.forEach((o) => el.appendChild(new Option(o, o)));
    el.value = first[f.col] || f.options[0];
    el.disabled = true;
    container.appendChild(el);
  } else if (f.type === 'text') {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = first[f.col] || '';
    el.readOnly = true;
    container.appendChild(el);
  } else if (f.type === 'textarea') {
    const el = document.createElement('textarea');
    el.rows = 3;
    el.value = first[f.col] || '';
    el.readOnly = true;
    container.appendChild(el);
  }
}

// 変更後セル（編集可）を作り、ユーザーが編集した項目は変更対象チェック（bulkChecks）を自動で ON にする。
// 初期値は先頭選択行（bulkRows[0]）の値を流し込む（値が相違ありの場合も先頭行を表示）。
// 変更対象チェックが OFF の項目は適用しない。
function buildAfterControl(f, container) {
  const first = bulkRows[0];
  // 編集したら「変更対象」チェックを自動でON（チェックが変更対象の正）
  const markDirty = () => {
    if (bulkChecks[f.key]) bulkChecks[f.key].checked = true;
  };
  if (f.type === 'date') {
    const el = document.createElement('input');
    el.type = 'date';
    el.value = toInputDate(first['日付']);
    // 日付はカレンダー入力のみ（登録モーダルと同様）
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') e.preventDefault();
    });
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
    container.appendChild(el);
    bulkAfterEls.date = el;
  } else if (f.type === 'anken') {
    const cd = roInput();
    const search = document.createElement('button');
    search.type = 'button';
    search.textContent = '検索';
    search.addEventListener('click', () => openAnkenModal('bulk'));
    const tori = roInput();
    const anken = roInput();
    cd.value = first['案件コード'] || '';
    tori.value = first['取引先名'] || '';
    anken.value = first['案件名'] || '';
    const row1 = document.createElement('div');
    row1.className = 'bc-anken-row';
    row1.appendChild(cd);
    row1.appendChild(search);
    container.appendChild(row1);
    container.appendChild(tori);
    container.appendChild(anken);
    bulkAfterEls.anken = { cd, tori, anken };
  } else if (f.type === 'select') {
    const el = document.createElement('select');
    f.options.forEach((o) => el.appendChild(new Option(o, o)));
    el.value = first[f.col] || f.options[0];
    el.addEventListener('change', markDirty);
    container.appendChild(el);
    bulkAfterEls[f.key] = el;
  } else if (f.type === 'text') {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = first[f.col] || '';
    el.addEventListener('input', markDirty);
    container.appendChild(el);
    bulkAfterEls[f.key] = el;
  } else if (f.type === 'textarea') {
    const el = document.createElement('textarea');
    el.rows = 3;
    el.value = first[f.col] || '';
    el.addEventListener('input', markDirty);
    container.appendChild(el);
    bulkAfterEls[f.key] = el;
  }
}

// 変更ページのグリッドを選択内容から組み立てる。
// 項目ラベルの下に「変更前 | 変更後」を左右等幅（境目＝モーダル中央）で並べる。
function buildBulkChangeGrid() {
  const grid = $('bcGrid');
  grid.innerHTML = '';
  bulkAfterEls = {};
  bulkChecks = {};
  // 見出し（変更前 / 変更後）
  const header = document.createElement('div');
  header.className = 'bc-header';
  header.appendChild(cellDiv('', '変更前'));
  header.appendChild(cellDiv('', '変更後'));
  grid.appendChild(header);
  BULK_CHANGE_FIELDS.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'bc-row';
    // 変更前（左にラベル、右にコンポーネント。ラベルはコンポーネントと同じ高さ）
    const before = document.createElement('div');
    before.className = 'bc-cell bc-before';
    before.appendChild(cellDiv('bc-label', f.label));
    const beforeCtl = document.createElement('div');
    beforeCtl.className = 'bc-ctl';
    const vals = distinctFieldValues(f);
    if (vals.length > 1) {
      // 値が複数ある項目はコンポーネントを出さず「複数あり」ボタンのみ
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'multi-btn';
      btn.textContent = '複数あり';
      btn.addEventListener('click', () => showBulkMulti(f));
      beforeCtl.appendChild(btn);
    } else {
      buildBeforeControl(f, beforeCtl);
    }
    before.appendChild(beforeCtl);
    // 変更後（左に変更対象チェックボックス＋コンポーネント。デフォルトOFF）
    const after = document.createElement('div');
    after.className = 'bc-cell bc-after';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'bc-check';
    chk.title = 'この項目を変更対象にする';
    bulkChecks[f.key] = chk;
    after.appendChild(chk);
    const afterCtl = document.createElement('div');
    afterCtl.className = 'bc-ctl';
    buildAfterControl(f, afterCtl);
    after.appendChild(afterCtl);
    row.appendChild(before);
    row.appendChild(after);
    grid.appendChild(row);
  });
}

// 「複数あり」ポップアップ: 選択日報ごとの当該項目値を一覧表示する。
function showBulkMulti(f) {
  $('bulkMultiTitle').textContent = `${f.label}：選択した日報の内容`;
  const cont = $('bulkMultiTable');
  cont.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'bulk-multi-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  ['日付', '日報コード', f.label].forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  bulkRows.forEach((r) => {
    const tr = document.createElement('tr');
    [r['日付'] || '', r['日報コード'] || '', bulkFieldDisplay(f, r)].forEach((v) => {
      const td = document.createElement('td');
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.textContent = v;
      td.appendChild(cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  cont.appendChild(table);
  openModal('bulkMultiModal');
}

// タブ切替（一括変更 / 個別変更 / 一括置換）。ページとフッターの実行ボタンを連動させる。
function switchBulkTab(tab) {
  const map = {
    change: { tab: 'btnTabChange', page: 'bulkChangePage', exec: 'btnBulkChangeExec' },
    indiv: { tab: 'btnTabIndiv', page: 'bulkIndivPage', exec: 'btnBulkIndivExec' },
    replace: { tab: 'btnTabReplace', page: 'bulkReplacePage', exec: 'btnBulkReplaceExec' }
  };
  Object.keys(map).forEach((k) => {
    const on = k === tab;
    $(map[k].tab).classList.toggle('active', on);
    $(map[k].page).classList.toggle('hidden', !on);
    $(map[k].exec).classList.toggle('hidden', !on);
  });
}

// 一括変更モーダルを開く（変更タブを既定表示）。
function openBulkEdit() {
  if (viewOnly) {
    toast('参照のみモードでは一括変更できません', 'ng');
    return;
  }
  const rows = selectedRows();
  if (!rows.length) {
    toast('対象の日報を選択してください', 'ng');
    return;
  }
  bulkRows = rows;
  $('bulkEditCount').textContent = String(rows.length);
  switchBulkTab('change');
  buildBulkChangeGrid();
  buildBulkIndivGrid();
  ['brSonotaFrom', 'brSonotaTo', 'brOkureFrom', 'brOkureTo'].forEach((id) => setVal(id, ''));
  openModal('bulkEditModal');
}

// 一括変更（変更ページ）の入力チェック。日報登録の checkError と同じ観点で、
// 変更対象（チェックON）の項目のみを検証する。エラー文言を返す（正常なら null）。
// 作業進捗↔遅れ報告の相関は、変更後の値を各日報へ当てた結果で判定する。
function bulkChangeError(after, isTarget, rows) {
  if (isTarget('date')) {
    if (!after.date) return '日付が未入力です';
    if (isNaN(new Date(bulkAfterEls.date.value).getDate())) return '日付が不正です';
  }
  if (isTarget('anken') && after.ankenCd.trim() === '') return '案件が未入力です';
  if (isTarget('sagyoNaiyo') && after.sagyoNaiyo.trim() === '') return '作業内容が未入力です';
  if (isTarget('sagyozikan')) {
    if (after.sagyozikan.trim() === '') return '作業時間が未入力です';
    if (isNaN(Number(after.sagyozikan))) return '作業時間が不正です';
  }
  if (isTarget('sagyoShinchoku') && after.sagyoShinchoku.trim() === '')
    return '作業進捗が未入力です';
  if (isTarget('sonotaHokoku') && after.sonotaHokoku.trim() === '')
    return 'その他報告事項が未入力です';
  // 作業進捗か遅れ報告を変更する場合のみ、各日報の変更後の値で相関チェック
  if (isTarget('sagyoShinchoku') || isTarget('okureHokoku')) {
    for (const r of rows) {
      const shin = isTarget('sagyoShinchoku') ? after.sagyoShinchoku : r['作業進捗'] || '順調';
      const okure = isTarget('okureHokoku') ? after.okureHokoku : r['遅れ報告'] || '';
      if (shin !== '順調' && String(okure).trim() === '') {
        return `作業進捗が順調以外の場合は遅れ報告を入力してください（日報コード: ${r['日報コード']}）`;
      }
    }
  }
  return null;
}

// 変更ページの実行: 編集した項目のみを選択日報へ適用する。
// 各日報について、変更後の値が変更前(その日報のDB値)と異なる場合のみ登録する。
function doBulkChange() {
  return runExclusive(doBulkChangeInner);
}
async function doBulkChangeInner() {
  if (viewOnly) {
    toast('参照のみモードでは変更できません', 'ng');
    return;
  }
  const rows = bulkRows;
  if (!rows.length) {
    toast('対象の日報を選択してください', 'ng');
    return;
  }
  // チェックONの項目のみを変更対象にする（全OFFはエラー）
  const isTarget = (k) => !!(bulkChecks[k] && bulkChecks[k].checked);
  if (!BULK_CHANGE_FIELDS.some((f) => isTarget(f.key))) {
    toast('変更対象にチェックを入れてください', 'ng');
    return;
  }
  // 変更対象の項目の変更後の値を集める
  const after = {};
  if (isTarget('date')) after.date = toApiDate(bulkAfterEls.date.value);
  if (isTarget('anken')) {
    after.ankenCd = bulkAfterEls.anken.cd.value;
    after.torihikisakiMei = bulkAfterEls.anken.tori.value;
    after.ankenMei = bulkAfterEls.anken.anken.value;
  }
  ['sagyoNaiyo', 'sagyozikan', 'sagyoShinchoku', 'okureHokoku', 'sonotaHokoku'].forEach((k) => {
    if (isTarget(k)) after[k] = bulkAfterEls[k].value;
  });
  // 変更対象（チェックON）の項目を日報登録（checkError）と同じ観点で検証する
  const err = bulkChangeError(after, isTarget, rows);
  if (err) {
    toast(err, 'ng');
    return;
  }
  if (!(await uiConfirm(`選択した ${rows.length} 件に変更を適用します。よろしいですか？`))) return;

  // 変更後の値を各日報に適用し、変更前と異なる日報だけを送信対象にする
  const jobs = [];
  let unchanged = 0;
  for (const r of rows) {
    const body = rowToBody(r);
    let changed = false;
    if ('date' in after) {
      if (after.date !== body.date) changed = true;
      body.date = after.date;
    }
    if ('ankenCd' in after) {
      if (after.ankenCd !== body.ankenCd) changed = true;
      body.ankenCd = after.ankenCd;
      body.torihikisakiMei = after.torihikisakiMei;
      body.ankenMei = after.ankenMei;
    }
    ['sagyoNaiyo', 'sagyozikan', 'sagyoShinchoku', 'okureHokoku', 'sonotaHokoku'].forEach((k) => {
      if (k in after) {
        if (String(after[k]) !== String(body[k])) changed = true;
        body[k] = after[k];
      }
    });
    if (changed) jobs.push(body);
    else unchanged++;
  }
  closeModal('bulkEditModal');
  const res = await runBulk(
    '一括変更',
    jobs,
    (body) => callApi('registData', body, '一括変更', true),
    (body) => String(body.nippoCd)
  );
  res.skip = unchanged;
  if (!res.aborted) await loadList();
  reportBulk('一括変更', res, '変更なし');
}

// 置換ページの実行: 各日報のその他報告／遅れ報告から、置換前に一致する文字列を置換後へ置き換える。
function doBulkReplace() {
  return runExclusive(doBulkReplaceInner);
}
async function doBulkReplaceInner() {
  if (viewOnly) {
    toast('参照のみモードでは置換できません', 'ng');
    return;
  }
  const rows = bulkRows;
  if (!rows.length) {
    toast('対象の日報を選択してください', 'ng');
    return;
  }
  const sFrom = getVal('brSonotaFrom');
  const sTo = getVal('brSonotaTo');
  const oFrom = getVal('brOkureFrom');
  const oTo = getVal('brOkureTo');
  // 入力チェック: 置換前は必須（空欄では実行不可）。置換後は空欄可（一致部分を削除できる）。
  // 置換後だけ入力して置換前が空欄のグループは不可。どちらのグループも置換前が空なら実行不可。
  const okureUsed = oFrom !== '' || oTo !== '';
  const sonotaUsed = sFrom !== '' || sTo !== '';
  if (!okureUsed && !sonotaUsed) {
    toast('置換前を入力してください', 'ng');
    return;
  }
  if (okureUsed && oFrom === '') {
    toast('遅れ報告の置換前を入力してください', 'ng');
    return;
  }
  if (sonotaUsed && sFrom === '') {
    toast('その他報告の置換前を入力してください', 'ng');
    return;
  }
  // 置換後の内容を先に作り、日報登録（checkError）と同じ観点で検証する
  // （その他報告の必須、作業進捗が順調以外なら遅れ報告必須）。違反があれば実行しない。
  const jobs = [];
  let unchanged = 0;
  const invalid = [];
  for (const r of rows) {
    const body = rowToBody(r);
    let changed = false;
    if (sFrom) {
      const nv = body.sonotaHokoku.split(sFrom).join(sTo);
      if (nv !== body.sonotaHokoku) {
        body.sonotaHokoku = nv;
        changed = true;
      }
    }
    if (oFrom) {
      const nv = body.okureHokoku.split(oFrom).join(oTo);
      if (nv !== body.okureHokoku) {
        body.okureHokoku = nv;
        changed = true;
      }
    }
    if (!changed) {
      unchanged++;
      continue;
    }
    if (String(body.sonotaHokoku).trim() === '') invalid.push(`${body.nippoCd}（その他報告が空）`);
    else if (body.sagyoShinchoku !== '順調' && String(body.okureHokoku).trim() === '')
      invalid.push(`${body.nippoCd}（作業進捗が順調以外で遅れ報告が空）`);
    else jobs.push(body);
  }
  if (invalid.length) {
    toast(`置換後の内容が入力ルールに違反するため実行できません: ${invalid.join(', ')}`, 'ng');
    return;
  }
  if (!jobs.length) {
    toast('置換前に一致する日報がありません', 'ng');
    return;
  }
  if (
    !(await uiConfirm(
      `選択した ${rows.length} 件のうち ${jobs.length} 件のテキストを置換します。よろしいですか？`
    ))
  )
    return;

  closeModal('bulkEditModal');
  const res = await runBulk(
    '一括置換',
    jobs,
    (body) => callApi('registData', body, '一括置換', true),
    (body) => String(body.nippoCd)
  );
  res.skip = unchanged;
  if (!res.aborted) await loadList();
  reportBulk('一括置換', res);
}

// ---- 個別変更（選択日報を1画面のリストで個別編集） -----------------------
// 選択日報を「多段明細」で並べ、1段目に日付/案件/作業内容/時間/進捗、2・3段目に
// 遅れ報告/その他報告（全幅テキストエリア）を表示して、日報ごとに個別編集する。
function buildBulkIndivGrid() {
  const wrap = $('biGrid');
  wrap.innerHTML = '';
  indivEls = [];
  const table = document.createElement('table');
  table.className = 'bi-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  [
    ['日付', 'c-date'],
    ['案件', 'c-anken'],
    ['作業内容', 'c-naiyo'],
    ['時間', 'c-jikan'],
    ['進捗', 'c-shinchoku']
  ].forEach(([label, cls]) => {
    const th = document.createElement('th');
    th.className = cls;
    th.textContent = label;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  bulkRows.forEach((r) => {
    const e = {
      orig: r,
      nippoCd: r['日報コード'] || '',
      tanto: r['担当者コード'] || getVal('tanto'),
      tori: r['取引先名'] || '',
      anken: r['案件名'] || ''
    };

    // --- 1段目: 日付 / 案件 / 作業内容 / 時間 / 進捗 ---
    const r1 = document.createElement('tr');
    r1.className = 'bi-r1';

    const dateTd = document.createElement('td');
    dateTd.className = 'c-date';
    e.date = document.createElement('input');
    e.date.type = 'date';
    e.date.value = toInputDate(r['日付']);
    e.date.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Tab') ev.preventDefault();
    });
    wireIndivChange(e.date);
    dateTd.appendChild(e.date);
    r1.appendChild(dateTd);

    const ankenTd = document.createElement('td');
    ankenTd.className = 'c-anken';
    const top = document.createElement('div');
    top.className = 'bi-anken-top';
    e.ankenCd = roInput();
    e.ankenCd.classList.add('bi-anken-cd');
    e.ankenCd.value = r['案件コード'] || '';
    e.ankenInitial = e.ankenCd.value; // 案件は検索で変わるため初期値を保持して比較
    const search = document.createElement('button');
    search.type = 'button';
    search.textContent = '検索';
    search.addEventListener('click', () => openAnkenModal('indiv', e));
    // 検索ボタンの右に案件名を表示（見切れる分はドラッグで横スクロールして確認）
    e.nameEl = document.createElement('div');
    e.nameEl.className = 'bi-anken-name';
    e.nameEl.textContent = e.anken;
    e.nameEl.title = e.anken;
    top.appendChild(e.ankenCd);
    top.appendChild(search);
    top.appendChild(e.nameEl);
    ankenTd.appendChild(top);
    r1.appendChild(ankenTd);

    const naiyoTd = document.createElement('td');
    naiyoTd.className = 'c-naiyo';
    e.sagyoNaiyo = document.createElement('select');
    SAGYO_NAIYO.forEach((o) => e.sagyoNaiyo.appendChild(new Option(o, o)));
    e.sagyoNaiyo.value = r['作業内容'] || SAGYO_NAIYO[0];
    wireIndivChange(e.sagyoNaiyo);
    naiyoTd.appendChild(e.sagyoNaiyo);
    r1.appendChild(naiyoTd);

    const jikanTd = document.createElement('td');
    jikanTd.className = 'c-jikan';
    e.sagyozikan = document.createElement('input');
    e.sagyozikan.type = 'text';
    e.sagyozikan.value = r['作業時間'] || '';
    wireIndivChange(e.sagyozikan);
    jikanTd.appendChild(e.sagyozikan);
    r1.appendChild(jikanTd);

    const shinTd = document.createElement('td');
    shinTd.className = 'c-shinchoku';
    e.sagyoShinchoku = document.createElement('select');
    SAGYO_SHINCHOKU.forEach((o) => e.sagyoShinchoku.appendChild(new Option(o, o)));
    e.sagyoShinchoku.value = r['作業進捗'] || '順調';
    wireIndivChange(e.sagyoShinchoku);
    shinTd.appendChild(e.sagyoShinchoku);
    r1.appendChild(shinTd);

    tbody.appendChild(r1);

    // --- 2段目: 遅れ報告（全幅・5行） ---
    e.okure = document.createElement('textarea');
    e.okure.rows = 5;
    e.okure.value = r['遅れ報告'] || '';
    wireIndivChange(e.okure);
    tbody.appendChild(indivTextRow('遅れ報告', e.okure));

    // --- 3段目: その他報告（全幅・5行） ---
    e.sonota = document.createElement('textarea');
    e.sonota.rows = 5;
    e.sonota.value = r['その他報告事項'] || '';
    wireIndivChange(e.sonota);
    tbody.appendChild(indivTextRow('その他報告', e.sonota));

    indivEls.push(e);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

// 個別変更のコントロールに変更検知を付ける。初期値と異なる間だけ薄赤（bi-changed）にする。
/** @param {any} el */
function wireIndivChange(el) {
  const initial = el.value;
  const update = () => el.classList.toggle('bi-changed', el.value !== initial);
  el.addEventListener('input', update);
  el.addEventListener('change', update);
}

// 個別変更の全幅テキスト段（ラベル + テキストエリアを colspan で1行に）。
/** @param {string} label @param {any} textarea */
function indivTextRow(label, textarea) {
  const tr = document.createElement('tr');
  tr.className = 'bi-r-text';
  const td = document.createElement('td');
  td.colSpan = 5;
  const wrap = document.createElement('div');
  wrap.className = 'bi-textrow';
  const lb = document.createElement('label');
  lb.textContent = label;
  wrap.appendChild(lb);
  wrap.appendChild(textarea);
  td.appendChild(wrap);
  tr.appendChild(td);
  return tr;
}

// 個別変更の1行を registData 送信ボディへ。
function buildIndivBody(e) {
  return {
    nippoCd: e.nippoCd,
    tanto: e.tanto,
    date: toApiDate(e.date.value),
    ankenCd: e.ankenCd.value,
    torihikisakiMei: e.tori,
    ankenMei: e.anken,
    sagyoNaiyo: e.sagyoNaiyo.value,
    sagyozikan: e.sagyozikan.value,
    sagyoShinchoku: e.sagyoShinchoku.value,
    okureHokoku: e.okure.value,
    sonotaHokoku: e.sonota.value
  };
}

// 個別変更の1行が元の日報から変わっているか（更新対象の判定）。
// 一部失敗でモーダルを開いたままにした場合、送信済みの行は送信した内容（sentBody）と比較する。
function isIndivChanged(e, body) {
  const o = e.sentBody || rowToBody(e.orig);
  return [
    'date',
    'ankenCd',
    'torihikisakiMei',
    'ankenMei',
    'sagyoNaiyo',
    'sagyozikan',
    'sagyoShinchoku',
    'okureHokoku',
    'sonotaHokoku'
  ].some((k) => String(body[k]) !== String(o[k]));
}

// 個別変更の1行を日報登録（checkError）と同じ観点で検証する。
function indivRowError(e) {
  const b = buildIndivBody(e);
  if (b.ankenCd.trim() === '') return '案件が未入力です';
  if (b.date.trim() === '') return '日付が未入力です';
  if (isNaN(new Date(e.date.value).getDate())) return '日付が不正です';
  if (b.sagyoNaiyo.trim() === '') return '作業内容が未入力です';
  if (b.sagyozikan.trim() === '') return '作業時間が未入力です';
  if (isNaN(Number(b.sagyozikan))) return '作業時間が不正です';
  if (b.sagyoShinchoku.trim() === '') return '作業進捗が未入力です';
  if (b.sonotaHokoku.trim() === '') return 'その他報告事項が未入力です';
  if (b.sagyoShinchoku !== '順調' && b.okureHokoku.trim() === '')
    return '作業進捗が順調以外の場合は遅れ報告を入力してください';
  return null;
}

// 個別変更の実行: 変更した日報のみを更新する。全行を日報登録と同じ観点で検証してから送信。
function doBulkIndiv() {
  return runExclusive(doBulkIndivInner);
}
async function doBulkIndivInner() {
  if (viewOnly) {
    toast('参照のみモードでは変更できません', 'ng');
    return;
  }
  if (!indivEls.length) {
    toast('対象の日報がありません', 'ng');
    return;
  }
  for (const e of indivEls) {
    const err = indivRowError(e);
    if (err) {
      toast(`${err}（日報コード: ${e.nippoCd}）`, 'ng');
      return;
    }
  }
  const jobs = indivEls
    .map((e) => ({ e, body: buildIndivBody(e) }))
    .filter((j) => isIndivChanged(j.e, j.body));
  if (!jobs.length) {
    toast('変更された日報がありません', 'ng');
    return;
  }
  if (!(await uiConfirm(`変更した ${jobs.length} 件を更新します。よろしいですか？`))) return;

  const res = await runBulk(
    '個別変更',
    jobs,
    async (j) => {
      const r = await callApi('registData', j.body, '個別変更', true);
      if (isBizOk(r)) j.e.sentBody = j.body; // 成功した行は以後「変更なし」扱い
      return r;
    },
    (j) => String(j.e.nippoCd)
  );
  // 全件成功時のみ閉じる。失敗・中断がある場合は編集内容を残し、失敗行だけ再実行できるようにする
  if (!res.ng && !res.aborted) closeModal('bulkEditModal');
  if (!res.aborted) await loadList();
  reportBulk('個別変更', res);
}

// ---- ⑤ 案件マスタ検索モーダル --------------------------------------------
// target='bulk' で一括変更（変更後）へ、'indiv' で個別変更の対象行へ、既定は登録モーダルへ反映する。
function openAnkenModal(target, entry) {
  ankenTarget = target || 'regist';
  indivAnkenTarget = ankenTarget === 'indiv' ? entry : null;
  setVal('svalue', '');
  openModal('ankenModal');
  $('svalue').focus();
  searchAnken(false); // 初期表示は履歴を実行して表示（検索ボタンは再検索用）
}
// 案件・担当者検索の要求連番。開いた直後の初期表示（履歴／全件）の応答が、続けて押した
// 検索の結果を後から上書きしないよう、最新の要求の応答だけを描画する。
let ankenSeq = 0;
let tantoSeq = 0;
async function searchAnken(withSvalue) {
  const seq = ++ankenSeq;
  // 案件は登録対象の担当者の履歴／検索を出す（一括変更・個別変更は日報一覧の担当者）
  const t = ankenTarget === 'regist' ? getVal('regTanto') || getVal('tanto') : getVal('tanto');
  const body = withSvalue ? { tanto: t, svalue: getVal('svalue') } : { tanto: t };
  const r = await callApi('gethistory', body, withSvalue ? '案件検索' : '案件履歴');
  if (seq !== ankenSeq) return; // 後から出した要求がある（古い応答は捨てる）
  if (r && Array.isArray(r.data)) renderTableInto($('ankenTable'), 'gethistory', r.data, pickAnken);
}
function pickAnken(row) {
  // 一括変更（変更後）の案件へ反映（案件コード＋取引先名＋案件名をまとめて更新）
  if (ankenTarget === 'bulk' && bulkAfterEls.anken) {
    bulkAfterEls.anken.cd.value = row['案件コード'] || '';
    bulkAfterEls.anken.tori.value = row['取引先名'] || '';
    bulkAfterEls.anken.anken.value = row['案件名'] || '';
    if (bulkChecks.anken) bulkChecks.anken.checked = true; // 案件選択で変更対象ON
    closeModal('ankenModal');
    toast('案件を反映しました', 'ok');
    return;
  }
  // 個別変更の対象行の案件へ反映（取引先名・案件名は画面表示せず値のみ保持）
  if (ankenTarget === 'indiv' && indivAnkenTarget) {
    const e = indivAnkenTarget;
    e.ankenCd.value = row['案件コード'] || '';
    e.tori = row['取引先名'] || '';
    e.anken = row['案件名'] || '';
    // 初期の案件コードと異なれば薄赤（変更対象）にする
    e.ankenCd.classList.toggle('bi-changed', e.ankenCd.value !== e.ankenInitial);
    if (e.nameEl) {
      e.nameEl.textContent = e.anken;
      e.nameEl.title = e.anken;
    }
    closeModal('ankenModal');
    toast('案件を反映しました', 'ok');
    return;
  }
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
  const seq = ++tantoSeq;
  const r = await callApi('getTantoList', { svalue: getVal('svalue2') }, '担当者検索');
  if (seq !== tantoSeq) return; // 後から出した要求がある（古い応答は捨てる）
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
  // 前の担当者の一覧と選択を先に破棄する。一覧の取得に失敗した場合に、前の担当者の行が
  // 新しい権限（全権）のまま残り、一括削除・変更できてしまうのを防ぐ。
  allNippoRows = [];
  applyListFilter(); // 選択（selectedNippo）もクリアされる
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
  // （uiConfirm は textContent＋pre-wrap で表示するため改行は \n。HTML タグは使えない）
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
      // 起動時の自動チェック失敗（GitHub の一時的な 5xx 等）はユーザーへ出さない。
      // electron-updater は checkForUpdates 失敗でも error イベントを発火するため、
      // ここで抑止しないと GitHub 障害のたびに巨大な赤エラーが表示されてしまう。
      // ユーザーが「⬆ 更新」を押してダウンロード進行中(updateBusy)のときだけ通知する。
      if (updateBusy) {
        const msg = String(s.message || '');
        // GitHub の HTML エラーページ等で極端に長いことがあるため丸める。
        toast('更新エラー: ' + (msg.length > 200 ? msg.slice(0, 200) + '…' : msg), 'ng');
        resetUpdateBtn();
      }
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
  const btnBrowserLogin = $('btnBrowserLogin');
  if (btnBrowserLogin) btnBrowserLogin.addEventListener('click', () => browserLogin());
  // ユーザーID手動入力（ボタン／Enter どちらでも認証実行）
  $('btnManualAuth').addEventListener('click', () => submitManualId());
  $('manualUserId').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitManualId();
    }
  });
  $('btnReload').addEventListener('click', () => {
    // ブラウザ表示版は webview を持たないため一覧のみ取り直す
    if (IS_BROWSER) {
      if (document.body.classList.contains('app')) loadList();
      return;
    }
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
  $('btnInputCheck').addEventListener('click', () => showInputCheck());
  $('btnCloseCheck').addEventListener('click', () => closeModal('checkModal'));
  $('btnCheckOk').addEventListener('click', () => closeModal('checkModal'));
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
  // 案件コード設定基準（インフォメーション。ログイン画面・日報一覧の両フッターから開ける）
  $('btnInfo').addEventListener('click', () => openModal('infoModal'));
  $('btnInfoLogin').addEventListener('click', () => openModal('infoModal'));
  $('btnCloseInfo').addEventListener('click', () => closeModal('infoModal'));
  $('btnNew').addEventListener('click', () => openNewModal());
  $('btnBulkCopy').addEventListener('click', () => openBulkCopy());
  $('btnBulkDelete').addEventListener('click', () => doBulkDelete());
  $('btnBulkEdit').addEventListener('click', () => openBulkEdit());

  // 一括変更 モーダル（一括変更 / 個別変更 / 一括置換）
  $('btnCloseBulkEdit').addEventListener('click', () => closeModal('bulkEditModal'));
  $('btnTabChange').addEventListener('click', () => switchBulkTab('change'));
  $('btnTabIndiv').addEventListener('click', () => switchBulkTab('indiv'));
  $('btnTabReplace').addEventListener('click', () => switchBulkTab('replace'));
  $('btnBulkChangeExec').addEventListener('click', () => doBulkChange());
  $('btnBulkIndivExec').addEventListener('click', () => doBulkIndiv());
  $('btnBulkReplaceExec').addEventListener('click', () => doBulkReplace());
  $('btnCloseBulkMulti').addEventListener('click', () => closeModal('bulkMultiModal'));

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
  $('btnPrevNippo').addEventListener('click', () => navigateEdit(-1));
  $('btnNextNippo').addEventListener('click', () => navigateEdit(1));
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
  // カレンダーで日付が変わったら合計を取り直す（キー入力は禁止のため change だけで拾える。
  // input と二重に登録すると1回の変更で2回通信してしまう）
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

  // モーダルは背景（外側）クリックでは閉じない。閉じるのは各モーダルの✕ボタン
  // （確認モーダルは OK／キャンセル）のみ。誤操作による意図しないクローズを防ぐ。

  // 自動更新の状態通知を購読
  wireUpdateStatus();
}

// ⑥ 再認証: セッションを消去し、Microsoft SSO のログイン画面から入り直す。
async function reauth() {
  // 再認証は SSO 方式から入り直す（手動入力モードの残りを解除）
  authMethod = 'sso';
  // ブラウザ表示版: ローカルサーバー経由でログアウトし、認証画面（ログインボタン）へ戻す
  if (IS_BROWSER) {
    try {
      await apiPost('/api/logout');
    } catch (e) {
      // ログアウトできていない（サーバー側のセッション・本人情報が残る）ため画面は切り替えない
      reportBrowserApiError(e);
      return;
    }
    loginTanto = null;
    showAuth();
    setConn('warn', '認証待ち');
    return;
  }
  try {
    if (window.appApi && window.appApi.clearSession) await window.appApi.clearSession();
  } catch (e) {
    toast('セッション消去に失敗しました: ' + ((e && e.message) || e), 'ng');
  }
  loginTanto = null; // 次回ログインで本人を取り直す（メール→名称4 照合）
  showAuth();
  webReady = false;
  // 再読込でログイン画面（対象外URL）へ遷移するまで、直前まで表示していた
  // 日報画面（webview の旧コンテンツ）が一瞬見えないようマスクで覆う。
  // showAuth() が hideMask() を呼ぶため、その後にマスクを出す必要がある。
  // ログイン画面へ遷移すると did-navigate が hideMask() でマスクを外す。
  showMask();
  rk.reload();
}

// ---- start ----------------------------------------------------------------
initSelects();
initListFilter();
wire();
// ログイン担当者は本人特定（メール→名称4 照合）で確定するまで未確定。
loginTanto = null;

if (IS_BROWSER) {
  // ブラウザ表示版: <webview> や自動更新は使わず、ローカルサーバー経由で動作する。
  document.documentElement.classList.add('browser-mode');
  browserBoot();
} else {
  // デスクトップ版: 従来どおり webview で認証し、更新チェックも行う。
  showAuth();
  // フッターの現在バージョン初期表示（main の app.getVersion()＝package.json の version）。
  // 版数を preload 等に二重に持たない（更新漏れで古い版数が出るのを防ぐ）。
  window.appApi
    .getVersion()
    .then(setVersionLabel)
    .catch((e) => console.error('[nippo] バージョン取得失敗:', (e && e.message) || e));
  // ログイン画面でも更新有無をチェックし、更新があればフッター右端に更新ボタンを表示する。
  checkForUpdate();
}
