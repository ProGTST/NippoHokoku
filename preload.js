const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfo', {
  name: '日報入力',
  version: '0.1.0',
  targetUrl: 'https://rkanri.genech.co.jp/kanri/nippo'
});

// 再認証・自動更新用の IPC（メインプロセスで実行）
contextBridge.exposeInMainWorld('appApi', {
  clearSession: () => ipcRenderer.invoke('clear-session'),
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
