const { contextBridge } = require('electron');

// 現時点では最小限。将来ネイティブ機能（ファイル出力・通知等）が必要になれば
// ここで contextBridge 経由の API を公開する。
contextBridge.exposeInMainWorld('appInfo', {
  name: '日報登録',
  version: '0.1.0',
  targetUrl: 'https://rkanri.genech.co.jp/kanri/nippo'
});
