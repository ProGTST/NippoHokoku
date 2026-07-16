const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  session,
  net,
  Tray,
  Menu,
  nativeImage,
  Notification
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
// electron-updater は require 時に app へ触れるため、遅延取得（getUpdater）で扱う。
const electronUpdater = require('electron-updater');
// 自動更新トークン（ビルド時に scripts/gen-token.js が src/update-token.js を生成）。
// private リポジトリの Releases を GitHub API 経由で読むための読み取り専用トークン。
// 開発起動やトークン未設定ビルドではファイルが無いため、安全に空文字へフォールバックする。
let UPDATE_TOKEN = '';
try {
  UPDATE_TOKEN = require('./src/update-token').UPDATE_TOKEN || '';
} catch {
  // 未生成（dev 起動など）: トークン無しで続行（更新チェックは失敗するのみ）
}

const RK_PARTITION = 'persist:rkanri';
const RK_ORIGIN = 'https://rkanri.genech.co.jp';

// 自動更新の配信元（package.json の build.publish と一致させること）。
const UPDATE_OWNER = 'ProGTST';
const UPDATE_REPO = 'NippoHokoku';

// ---- ブラウザ表示モード（トレイ常駐＋ローカル proxy。新仕様.md §11） --------
const LOCAL_HOST = 'nippo.local';
// ブラウザ表示用ポート。先頭から順に試し、確保できたものを使う。
// 80 が Docker/WSL 等（Go 製 HTTP サーバー）に奪われている環境では 8090 にフォールバックする。
const LOCAL_PORTS = [80, 8090];
let activePort = null; // 実際に確保できたポート（全滅時は null＝ブラウザ表示は無効）
const ALLOWED_HOSTS = new Set(['nippo.local', '127.0.0.1', 'localhost']);
// ブラウザから中継してよい rkanri エンドポイントの許可リスト（任意 URL 転送は不可）
const API_WHITELIST = new Set([
  'getNippoList',
  'getTotal',
  'gethistory',
  'getTantoList',
  'registData',
  'deleteData'
]);
let httpServer = null;
let serverToken = ''; // 起動ごとのランダムトークン（配信 HTML に httpOnly Cookie で付与し /api で検証）
let tray = null;
let loginWin = null; // ブラウザ起点ログイン時に開く SSO ウィンドウ
let isQuitting = false; // トレイ常駐: ウィンドウを閉じても終了しない（終了はトレイメニュー）

let mainWindow = null;
let autoUpdater = null; // 遅延初期化（app 準備後に一度だけ生成）
// 直近ログインの Microsoft メール（GetCredentialType の username を捕捉。§本人特定）。
// サイレント SSO では捕捉されないため、確定後は identity.json に永続化して補完する。
let capturedEmail = null;

// ---- 本人特定: Microsoft ログインメールの捕捉 -----------------------------
// 認可コードフローのため id_token はクライアントに来ない。メール入力→「次へ」で飛ぶ
// GetCredentialType の POST body（JSON の username）＝ログインメールを捕捉する。
// username のみを持つ GetCredentialType だけを対象とし、パスワードを含む POST には触れない。
function setupSsoEmailCapture() {
  const ses = session.fromPartition(RK_PARTITION);
  ses.webRequest.onBeforeRequest(
    { urls: ['https://login.microsoftonline.com/common/GetCredentialType*'] },
    (details, callback) => {
      try {
        const up = details.uploadData;
        if (details.method === 'POST' && up && up[0] && up[0].bytes) {
          const json = JSON.parse(up[0].bytes.toString('utf8'));
          const u = json && json.username;
          if (typeof u === 'string' && u.includes('@')) capturedEmail = u.trim();
        }
      } catch (e) {
        // 解析失敗は無視（捕捉できないだけ。永続化 identity でフォールバック）
      }
      callback({ cancel: false });
    }
  );
}

// ---- 本人特定: 確定した担当者情報の永続化（userData/identity.json） --------
function identityPath() {
  return path.join(app.getPath('userData'), 'identity.json');
}
function readIdentity() {
  try {
    return JSON.parse(fs.readFileSync(identityPath(), 'utf8'));
  } catch (e) {
    return null;
  }
}
function writeIdentity(obj) {
  try {
    fs.writeFileSync(identityPath(), JSON.stringify(obj));
    return true;
  } catch (e) {
    return false;
  }
}
function clearIdentity() {
  try {
    fs.unlinkSync(identityPath());
  } catch (e) {
    // 無ければ何もしない
  }
}

// ---- ブラウザ表示モード: rkanri への proxy（persist:rkanri の Cookie/XSRF 付与）----
// ブラウザは同一オリジンの /api を叩き、main が persist:rkanri セッションで rkanri へ中継する。
// これによりデスクトップ版の webview.executeJavaScript と同じ認証状態で API を呼べる。
function proxyToRkanri(endpoint, bodyStr) {
  return new Promise((resolve) => {
    const ses = session.fromPartition(RK_PARTITION);
    ses.cookies
      .get({ url: RK_ORIGIN })
      .then((cookies) => {
        let xsrf = '';
        const c = cookies.find((x) => x.name === 'XSRF-TOKEN');
        if (c) {
          try {
            xsrf = decodeURIComponent(c.value);
          } catch (e) {
            xsrf = c.value;
          }
        }
        const req = net.request({
          method: 'POST',
          url: RK_ORIGIN + '/kanri/nippo/' + endpoint,
          session: ses,
          useSessionCookies: true
        });
        req.setHeader('accept', 'application/json, text/plain, */*');
        req.setHeader('content-type', 'application/json');
        if (xsrf) req.setHeader('x-xsrf-token', xsrf);
        let data = '';
        req.on('response', (resp) => {
          resp.on('data', (ch) => (data += ch));
          resp.on('end', () =>
            resolve({
              ok: resp.statusCode >= 200 && resp.statusCode < 300,
              status: resp.statusCode,
              body: data
            })
          );
        });
        req.on('error', (e) =>
          resolve({ ok: false, status: 0, body: '', error: String((e && e.message) || e) })
        );
        req.write(bodyStr);
        req.end();
      })
      .catch((e) =>
        resolve({ ok: false, status: 0, body: '', error: String((e && e.message) || e) })
      );
  });
}

// getTantoList 全件を配列で取得（未ログイン時は HTML が返るため null）。
async function proxyGetTantoListArray() {
  const r = await proxyToRkanri('getTantoList', JSON.stringify({ svalue: '' }));
  if (!r.ok) return null;
  let data;
  try {
    data = JSON.parse(r.body);
  } catch (e) {
    return null; // HTML/login 応答 → 未ログイン
  }
  return Array.isArray(data) ? data : null;
}

// getTantoList 全件から、指定ローカル値（メールの @ より前 or 手動ユーザーID）＝名称4 の行を探す。
function matchTantoByLocal(list, local) {
  local = String(local || '')
    .trim()
    .toLowerCase();
  if (!local) return null;
  return (
    list.find(
      (r) =>
        String(r['名称4'] || '')
          .trim()
          .toLowerCase() === local
    ) || null
  );
}

// ブラウザ表示モードの本人特定（renderer の resolveLoginTanto と同一ロジック）。
// ①メール→名称4 照合 → ②永続化 userId で名称4 再照合 → ③手動入力へ誘導。
// 返り値: 成功 { code, name }／未ログイン { error: 'login' }／照合不可 { error: 'manual' }。
async function resolveWhoami() {
  const list = await proxyGetTantoListArray();
  if (!list) return { error: 'login' }; // rkanri 未ログイン
  // ① SSO自動照合: 今回ログインのメール（@ より前）＝名称4
  if (capturedEmail) {
    const local = capturedEmail.split('@')[0];
    const hit = matchTantoByLocal(list, local);
    if (hit) {
      writeIdentity({
        email: capturedEmail,
        code: hit.key,
        name: hit['名称1'] || '',
        userId: local
      });
      return { code: hit.key, name: hit['名称1'] || '' };
    }
  }
  // ② 永続化 userId（前回SSO/手動の確定値）で現在のマスタを再照合
  const saved = readIdentity();
  if (saved && saved.userId) {
    const hit = matchTantoByLocal(list, saved.userId);
    if (hit) {
      writeIdentity({
        email: capturedEmail || saved.email || '',
        code: hit.key,
        name: hit['名称1'] || '',
        userId: saved.userId
      });
      return { code: hit.key, name: hit['名称1'] || '' };
    }
  }
  // ③ 自動照合できず → 手動入力へ（rkanri にはログイン済み）
  return { error: 'manual' };
}

// 第2フェーズ: 手動入力したユーザーIDで本人を確定する。
// 成功時は手動ユーザーIDを含めて永続化し（次回以降の自動認証）、{ code, name } を返す。
// 該当なしは { error: 'notfound' }、rkanri 未ログインは { error: 'login' }。
async function handleManualLogin(userId) {
  const list = await proxyGetTantoListArray();
  if (!list) return { error: 'login' };
  const hit = matchTantoByLocal(list, userId);
  if (!hit) return { error: 'notfound' };
  const id = {
    email: capturedEmail || '',
    code: hit.key,
    name: hit['名称1'] || '',
    userId: String(userId).trim()
  };
  writeIdentity(id);
  return { code: id.code, name: id.name };
}

// ブラウザ起点ログイン: SSO ログイン用ウィンドウ（persist:rkanri）を開き、ログイン完了を待つ。
function openLoginWindow() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      try {
        if (loginWin && !loginWin.isDestroyed()) loginWin.close();
      } catch (e) {
        /* noop */
      }
      loginWin = null;
      resolve(val);
    };
    loginWin = new BrowserWindow({
      width: 520,
      height: 540,
      title: '日報入力 ログイン',
      autoHideMenuBar: true,
      webPreferences: { partition: RK_PARTITION }
    });
    loginWin.setMenuBarVisibility(false);
    loginWin.loadURL(RK_ORIGIN + '/kanri/nippo');
    loginWin.webContents.on('did-stop-loading', async () => {
      const list = await proxyGetTantoListArray();
      if (list) finish(true); // rkanri にログイン成立
    });
    loginWin.on('closed', () => {
      if (!done) {
        done = true;
        loginWin = null;
        resolve(false); // ユーザーが閉じた＝ログイン中断
      }
    });
    setTimeout(() => finish(false), 180000); // 安全弁（3分）
  });
}

// POST /api/login: 対話ログインでメールを確実に捕捉するため一旦セッションを消してから開く。
async function handleBrowserLogin() {
  await session.fromPartition(RK_PARTITION).clearStorageData();
  capturedEmail = null;
  clearIdentity();
  const ok = await openLoginWindow();
  if (!ok) return { error: 'login' };
  return await resolveWhoami();
}

// POST /api/logout: セッションと本人情報を破棄。
async function handleBrowserLogout() {
  await session.fromPartition(RK_PARTITION).clearStorageData();
  capturedEmail = null;
  clearIdentity();
}

// ---- ブラウザ表示モード: ローカル HTTP サーバー（127.0.0.1 限定） -----------
function localContentType(name) {
  if (name.endsWith('.html')) return 'text/html; charset=utf-8';
  if (name.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (name.endsWith('.css')) return 'text/css; charset=utf-8';
  if (name.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}
function hostOf(req) {
  return String(req.headers.host || '')
    .split(':')[0]
    .toLowerCase();
}
function sendLocalJson(res, obj, status) {
  res.writeHead(status || 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}
function serveLocalFile(res, name) {
  try {
    const buf = fs.readFileSync(path.join(__dirname, 'src', name));
    const headers = { 'content-type': localContentType(name), 'cache-control': 'no-store' };
    // 画面配信時に httpOnly のセッショントークンを渡し、/api で検証する（他プロセス対策）
    if (name === 'index.html')
      headers['set-cookie'] = `nippo_token=${serverToken}; HttpOnly; SameSite=Strict; Path=/`;
    res.writeHead(200, headers);
    res.end(buf);
  } catch (e) {
    res.writeHead(404);
    res.end('not found');
  }
}
// /api 呼び出しの認可: トークン Cookie 一致＋Origin（あれば）許可ホストのみ。
function apiAuthorized(req) {
  const m = String(req.headers.cookie || '').match(/nippo_token=([^;]+)/);
  if (!m || m[1] !== serverToken) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!ALLOWED_HOSTS.has(new URL(origin).hostname)) return false;
    } catch (e) {
      return false;
    }
  }
  return true;
}
function readLocalBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
  });
}
function startLocalServer() {
  serverToken = crypto.randomBytes(24).toString('hex');
  httpServer = http.createServer(async (req, res) => {
    try {
      if (!ALLOWED_HOSTS.has(hostOf(req))) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      const pathname = new URL(req.url, 'http://nippo.local').pathname;

      // 静的配信（UI）
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html'))
        return serveLocalFile(res, 'index.html');
      if (req.method === 'GET' && pathname === '/renderer.js')
        return serveLocalFile(res, 'renderer.js');
      if (req.method === 'GET' && pathname === '/styles.css')
        return serveLocalFile(res, 'styles.css');
      if (req.method === 'GET' && pathname === '/icon.png') return serveLocalFile(res, 'icon.png');
      if (req.method === 'GET' && pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      // API（rkanri への proxy ＋ 本人特定/ログイン）
      if (pathname.startsWith('/api/')) {
        if (!apiAuthorized(req)) {
          res.writeHead(403);
          res.end('forbidden');
          return;
        }
        const action = pathname.slice('/api/'.length);
        if (req.method === 'GET' && action === 'whoami')
          return sendLocalJson(res, await resolveWhoami());
        if (req.method === 'POST' && action === 'login')
          return sendLocalJson(res, await handleBrowserLogin());
        if (req.method === 'POST' && action === 'manual-login') {
          const body = await readLocalBody(req);
          let uid = '';
          try {
            uid = (JSON.parse(body || '{}').userId || '').toString();
          } catch (e) {
            uid = '';
          }
          return sendLocalJson(res, await handleManualLogin(uid));
        }
        if (req.method === 'POST' && action === 'logout') {
          await handleBrowserLogout();
          return sendLocalJson(res, { ok: true });
        }
        if (req.method === 'POST' && API_WHITELIST.has(action)) {
          const body = await readLocalBody(req);
          const pr = await proxyToRkanri(action, body || '{}');
          let data;
          try {
            data = JSON.parse(pr.body);
          } catch (e) {
            data = pr.body; // HTML/login はそのまま渡し、renderer 側で未ログイン検出
          }
          return sendLocalJson(res, { ok: pr.ok, status: pr.status, data });
        }
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(404);
      res.end('not found');
    } catch (e) {
      try {
        res.writeHead(500);
        res.end('error');
      } catch (e2) {
        /* noop */
      }
    }
  });
  // 確保できたポートを記録する（browserUrl はこのポートで URL を生成する）。
  httpServer.on('listening', () => {
    const addr = httpServer.address();
    activePort = addr && typeof addr === 'object' ? addr.port : null;
    console.log('[nippo] local server listening on 127.0.0.1:' + activePort);
  });
  // ポート競合（EADDRINUSE）は次の候補へフォールバックし、全滅したらブラウザ表示を無効化して通知する。
  // listen 失敗は同期例外ではなく 'error' イベントで飛ぶため、ここで一元的に扱う。
  let portIndex = 0;
  httpServer.on('error', (e) => {
    const code = e && /** @type {any} */ (e).code;
    if (code === 'EADDRINUSE' && portIndex < LOCAL_PORTS.length - 1) {
      const busy = LOCAL_PORTS[portIndex];
      portIndex += 1;
      const next = LOCAL_PORTS[portIndex];
      console.error(`[nippo] port ${busy} in use, retrying on ${next}`);
      httpServer.listen(next, '127.0.0.1'); // 同一 server で次候補を再試行
      return;
    }
    // 全候補が使用中 → デスクトップ版は動くが、ブラウザ表示は利用不可。
    activePort = null;
    console.error('[nippo] local server error:', (e && e.message) || e);
    notifyBrowserUnavailable();
  });
  httpServer.listen(LOCAL_PORTS[0], '127.0.0.1');
}
// ①: ブラウザ表示が使えないことをユーザーへ通知する（無言失敗を避ける）。
function notifyBrowserUnavailable() {
  try {
    new Notification({
      title: '日報入力：ブラウザ表示は利用できません',
      body:
        `ポート ${LOCAL_PORTS.join(' / ')} が他アプリ（Docker/WSL 等）に使用されているため、` +
        'ブラウザ表示を無効化しました。デスクトップ画面はそのままご利用いただけます。'
    }).show();
  } catch (e) {
    console.error('[nippo] notify failed:', (e && e.message) || e);
  }
}

// ---- トレイ常駐 / 自動起動 / hosts 追記 -----------------------------------
function showDesktop() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}
// ブラウザ表示用 URL。hosts に nippo.local があれば nippo.local、無ければ 127.0.0.1。
// 実際に確保したポート（80 なら省略、8090 等なら :ポートを付与）を反映する。
// ②: 80 が奪われ 8090 で待ち受けている場合、nippo.local も :8090 を付けないと
//     暗黙の 80 番＝競合相手（Docker 等）に繋がってしまうため必ずポートを揃える。
function browserUrl() {
  const port = activePort || LOCAL_PORTS[0];
  const suffix = port === 80 ? '' : ':' + port;
  const host = hostsHasEntry() ? LOCAL_HOST : '127.0.0.1';
  return `http://${host}${suffix}/`;
}
function openInBrowser() {
  // サーバーが確保できていなければ開いても競合相手の 404 に繋がるだけなので通知に留める。
  if (!activePort) {
    notifyBrowserUnavailable();
    return;
  }
  shell.openExternal(browserUrl());
}
function setupTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.ico'));
    tray = new Tray(icon);
    tray.setToolTip('日報入力');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'ブラウザで開く', click: () => openInBrowser() },
        { label: 'デスクトップ画面を開く', click: () => showDesktop() },
        {
          label: 'ブラウザ表示を有効化（hosts に nippo.local を追記）',
          click: () => ensureHostsEntry()
        },
        { type: 'separator' },
        {
          label: '終了',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ])
    );
    tray.on('double-click', () => showDesktop());
  } catch (e) {
    console.error('[nippo] tray setup failed:', (e && e.message) || e);
  }
}
function setupAutostart() {
  try {
    // 開発時は自動起動を登録しない
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ['--tray'] });
  } catch (e) {
    /* noop */
  }
}
// hosts に「127.0.0.1 nippo.local」の“有効な”行があるかを厳密判定する。
// コメント（#）は無効とみなし、IP が 127.0.0.1 で nippo.local をホスト名トークンに
// 含む非コメント行のみ「存在」とする（コメントアウト行は存在扱いにしない）。
function hostsHasEntry() {
  try {
    const hostsPath = (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\drivers\\etc\\hosts';
    const content = fs.readFileSync(hostsPath, 'utf8');
    return content.split(/\r?\n/).some((line) => {
      const active = line.split('#')[0].trim(); // 行内コメントを除去
      if (!active) return false;
      const parts = active.split(/\s+/);
      return (
        parts[0] === '127.0.0.1' && parts.slice(1).some((h) => h.toLowerCase() === 'nippo.local')
      );
    });
  } catch (e) {
    return false;
  }
}
// hosts に「127.0.0.1 nippo.local」を追記（管理者権限で昇格）。拒否時はブラウザ表示が無効になるだけ。
function ensureHostsEntry() {
  if (hostsHasEntry()) return true;
  try {
    const ps1 = path.join(app.getPath('userData'), 'add-nippo-hosts.ps1');
    // 昇格側でも厳密判定（非コメントの 127.0.0.1 nippo.local 行のみ存在とみなす）。
    const script =
      '$h = "$env:SystemRoot\\System32\\drivers\\etc\\hosts"\r\n' +
      'if (-not (Select-String -Path $h -Pattern \'^\\s*127\\.0\\.0\\.1\\s+([^#]*\\s)?nippo\\.local(\\s|$|#)\' -Quiet)) { Add-Content -Path $h -Value "`r`n127.0.0.1 nippo.local  # nippo-desktop-app (browser view) - safe to remove" }\r\n';
    // 追記コメントは ASCII のみにする。.ps1 は BOM 無し UTF-8 で書き出すため、
    // 日本語を混ぜると PowerShell 5.1 が ANSI と誤解して文字化けする。
    // 由来が分かるよう nippo-desktop を明記し、不要時に削除してよい旨を添える。
    fs.writeFileSync(ps1, script, 'utf8');
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        // PowerShell のシングルクォート文字列に埋め込むため ' を '' でエスケープする。
        // userData パス（＝Windows ユーザー名）に ' が含まれても壊れず、注入もされない。
        `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${ps1.replace(/'/g, "''")}'`
      ],
      { windowsHide: true, detached: true }
    ).on('error', () => {
      /* 昇格拒否/失敗はブラウザ表示無効で許容 */
    });
    return true;
  } catch (e) {
    return false;
  }
}
// インストール／アップデート時に一度だけ hosts 追記を自動試行する。
// マーカーをバージョン単位にすることで「新バージョン起動時に一度」再試行する。
// 既に有効行があれば ensureHostsEntry 内でスキップ（UAC は出ない）。
// 開発（未パッケージ）時は自動昇格しない（トレイの手動メニューから実行可能）。
function ensureHostsEntryOnce() {
  if (!app.isPackaged) return;
  try {
    if (hostsHasEntry()) return; // 既に有効 → 何もしない（UAC も出さない）
    const marker = path.join(app.getPath('userData'), `.hosts-attempted-${app.getVersion()}`);
    if (fs.existsSync(marker)) return; // 同バージョンで試行済み
    fs.writeFileSync(marker, '1');
    ensureHostsEntry();
  } catch (e) {
    /* noop */
  }
}

// 更新状態をレンダラーへ通知する（日報一覧右下の更新ボタン制御用）。
function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', payload);
  }
}

// autoUpdater を初回アクセス時に生成し、イベントを配線して返す。
function getUpdater() {
  if (autoUpdater) return autoUpdater;
  autoUpdater = electronUpdater.autoUpdater;
  // ボタン押下で明示的にダウンロード＆インストールするため自動DLは無効化。
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // private リポジトリの Releases を読むため、埋め込みトークンを feed 設定の token として渡す。
  //
  // これが肝心: electron-updater は「token が渡っているときだけ」PrivateGitHubProvider
  // （api.github.com/repos/.../releases 経由）を選ぶ。token 無しだと public 用の
  // GitHubProvider にフォールバックし releases.atom フィードを取りに行くが、private では
  // これが 404 になり更新チェックが失敗する（本アプリで発生していた不具合）。
  // クライアント端末には GH_TOKEN 環境変数が無いため、ここで token を明示する必要がある。
  //
  // 注: addAuthHeader は使わない。あれは全リクエストに Authorization を足すだけで
  // プロバイダ選択を変えられず（＝atom フィードのまま）、さらにダウンロード時の
  // GitHub→S3 リダイレクト先にまで GitHub トークンを送ってしまい失敗し得る。
  // PrivateGitHubProvider は redirect を手動処理し、認証を正しく出し分ける。
  if (UPDATE_TOKEN) {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: UPDATE_OWNER,
      repo: UPDATE_REPO,
      private: true,
      token: UPDATE_TOKEN
    });
  }
  autoUpdater.on('update-available', (info) =>
    sendUpdateStatus({ state: 'available', version: info && info.version })
  );
  autoUpdater.on('update-not-available', (info) =>
    sendUpdateStatus({ state: 'none', version: info && info.version })
  );
  autoUpdater.on('download-progress', (p) =>
    sendUpdateStatus({ state: 'downloading', percent: p && p.percent })
  );
  autoUpdater.on('update-downloaded', (info) =>
    sendUpdateStatus({ state: 'downloaded', version: info && info.version })
  );
  autoUpdater.on('error', (err) =>
    sendUpdateStatus({ state: 'error', message: String((err && err.message) || err) })
  );
  return autoUpdater;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    title: '日報入力',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 自前UIの中に rkanri のページを <webview> で埋め込むため有効化する
      webviewTag: true,
      spellcheck: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // webview 内から window.open された場合は既定ブラウザで開く（アプリ内遷移を防ぐ）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 再認証: webview パーティションのセッション（Cookie 等）を消去し、
// 再読込で Microsoft SSO のログイン画面から入り直せるようにする。
// あわせて本人特定の捕捉メールと永続化 identity を破棄し、別アカウントへの切替に対応する。
ipcMain.handle('clear-session', async () => {
  await session.fromPartition(RK_PARTITION).clearStorageData();
  capturedEmail = null;
  clearIdentity();
  return true;
});

// ---- 本人特定 IPC（renderer から利用） ------------------------------------
// 今回ログインで捕捉したメール（サイレント SSO 時は null）。
ipcMain.handle('get-captured-email', () => capturedEmail);
// 永続化した本人情報 {email, code, name}（無ければ null）。
ipcMain.handle('get-identity', () => readIdentity());
// 本人確定時に永続化。
ipcMain.handle('set-identity', (_e, obj) => writeIdentity(obj));
// 本人情報を破棄。
ipcMain.handle('clear-identity', () => {
  clearIdentity();
  return true;
});

// ---- 自動更新（GitHub Releases / electron-updater） -----------------------
// 更新の有無を確認する。日報一覧の初期表示時に呼ばれ、結果で更新ボタンの表示を制御する。
// 開発（未パッケージ）時は更新チェックできないため available:false を返す。
ipcMain.handle('check-update', async () => {
  const current = app.getVersion();
  if (!app.isPackaged) return { available: false, current, dev: true };
  try {
    const r = await getUpdater().checkForUpdates();
    const version = r && r.updateInfo && r.updateInfo.version;
    // isUpdateAvailable（electron-updater v6）優先。無ければバージョン相違で判定。
    const available =
      r && typeof r.isUpdateAvailable === 'boolean'
        ? r.isUpdateAvailable
        : !!version && version !== current;
    return { available, version, current };
  } catch (e) {
    return { available: false, current, error: String((e && e.message) || e) };
  }
});

// 更新ボタン押下 → 最新版をダウンロード（完了は update-downloaded イベントで通知）。
ipcMain.handle('start-update', async () => {
  await getUpdater().downloadUpdate();
  return true;
});

// ダウンロード済みの更新を適用してアプリを再起動する。
ipcMain.handle('quit-and-install', () => {
  getUpdater().quitAndInstall();
});

// トレイ常駐＋ローカルサーバーは 1 プロセスに限定する。
// 二重起動（exe ダブルクリック等）時は、既存プロセスにデスクトップ画面を出させて終了する。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showDesktop());

  app.whenReady().then(() => {
    setupSsoEmailCapture(); // Microsoft ログインからメールを捕捉（本人特定用）
    startLocalServer(); // ブラウザ表示モード用ローカルサーバー（http://nippo.local）
    setupTray(); // トレイ常駐
    setupAutostart(); // ログイン時自動起動（--tray でバックグラウンド起動）
    ensureHostsEntryOnce(); // 初回のみ hosts に nippo.local を追記（昇格）

    // --tray（自動起動）ではウィンドウを出さずバックグラウンド常駐。
    // exe を直接起動した場合は従来どおりデスクトップ画面を表示。
    if (!process.argv.includes('--tray')) createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showDesktop();
    });
  });
}

// トレイ常駐のため、ウィンドウを全て閉じても終了しない（終了はトレイの「終了」から）。
app.on('window-all-closed', () => {
  // 常駐維持（何もしない）
});
