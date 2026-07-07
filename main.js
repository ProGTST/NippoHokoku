const { app, BrowserWindow, shell, ipcMain, session } = require('electron');
const path = require('path');

const RK_PARTITION = 'persist:rkanri';

function createWindow() {
  const win = new BrowserWindow({
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

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // webview 内から window.open された場合は既定ブラウザで開く（アプリ内遷移を防ぐ）
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// 再認証: webview パーティションのセッション（Cookie 等）を消去し、
// 再読込で Microsoft SSO のログイン画面から入り直せるようにする。
ipcMain.handle('clear-session', async () => {
  await session.fromPartition(RK_PARTITION).clearStorageData();
  return true;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
