// レンダラで preload から公開されるグローバル（preload.js の contextBridge と対応）。
export {};

declare global {
  interface Window {
    // 更新内容のお知らせ（src/release-notes.js。新しいバージョンが先頭）
    RELEASE_NOTES: { version: string; date: string; items: string[] }[];
    appInfo: {
      name: string;
      targetUrl: string;
    };
    appApi: {
      // 現在のバージョン（main の app.getVersion()）
      getVersion: () => Promise<string>;
      clearSession: () => Promise<boolean>;
      // 本人特定（Microsoft ログインメール捕捉 → 名称4 照合）
      getCapturedEmail: () => Promise<string | null>;
      getIdentity: () => Promise<{
        email?: string;
        code?: string;
        name?: string;
        userId?: string;
      } | null>;
      // userId は第2フェーズ（手動入力）で確定したユーザーID（自動照合時は無し）。
      setIdentity: (obj: {
        email: string;
        code: string;
        name: string;
        userId?: string;
      }) => Promise<boolean>;
      clearIdentity: () => Promise<boolean>;
      checkUpdate: () => Promise<{
        available: boolean;
        current: string;
        version?: string;
        dev?: boolean;
        error?: string;
      }>;
      // 例外は投げない。失敗時は ok=false と error（メッセージ）を返す。
      startUpdate: () => Promise<{ ok: boolean; error?: string }>;
      quitAndInstall: () => Promise<void>;
      onUpdateStatus: (
        cb: (data: {
          state: 'available' | 'none' | 'downloading' | 'downloaded' | 'error';
          // state='error' のときだけ付く: 更新確認中（'check'）かダウンロード中（'download'）か
          phase?: 'check' | 'download';
          version?: string;
          percent?: number;
          message?: string;
        }) => void
      ) => () => void;
    };
  }
}
