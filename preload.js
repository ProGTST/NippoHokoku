const { contextBridge, ipcRenderer } = require('electron');

// 版数は package.json の version を正とし、ここには持たない（appApi.getVersion で main から取得）。
contextBridge.exposeInMainWorld('appInfo', {
  name: '日報入力',
  targetUrl: 'https://rkanri.genech.co.jp/kanri/nippo'
});

// 再認証・自動更新用の IPC（メインプロセスで実行）
contextBridge.exposeInMainWorld('appApi', {
  // 現在のバージョン（app.getVersion()＝package.json の version）
  getVersion: () => ipcRenderer.invoke('get-version'),
  clearSession: () => ipcRenderer.invoke('clear-session'),
  // 本人特定（Microsoft ログインメール捕捉 → 名称4 照合）
  getCapturedEmail: () => ipcRenderer.invoke('get-captured-email'),
  getIdentity: () => ipcRenderer.invoke('get-identity'),
  setIdentity: (obj) => ipcRenderer.invoke('set-identity', obj),
  clearIdentity: () => ipcRenderer.invoke('clear-identity'),
  // 自動更新（GitHub Releases）
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  startUpdate: () => ipcRenderer.invoke('start-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  // 更新状態の通知購読。返り値の関数で解除できる。
  onUpdateStatus: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  }
});
