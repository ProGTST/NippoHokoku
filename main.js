const { app, BrowserWindow, shell, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
// electron-updater は require 時に app へ触れるため、遅延取得（getUpdater）で扱う。
const electronUpdater = require('electron-updater');

const RK_PARTITION = 'persist:rkanri';

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

app.whenReady().then(() => {
  setupSsoEmailCapture(); // webview の Microsoft ログインからメールを捕捉（本人特定用）
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
