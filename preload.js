const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfo', {
  name: '日報入力',
  version: '0.1.0',
  targetUrl: 'https://rkanri.genech.co.jp/kanri/nippo'
});

// 再認証用: webview セッションを消去する（メインプロセスで実行）
contextBridge.exposeInMainWorld('appApi', {
  clearSession: () => ipcRenderer.invoke('clear-session')
});
