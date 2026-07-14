// レンダラで preload から公開されるグローバル（preload.js の contextBridge と対応）。
export {};

declare global {
  interface Window {
    appInfo: {
      name: string;
      version: string;
      targetUrl: string;
    };
    appApi: {
      clearSession: () => Promise<boolean>;
      // 本人特定（Microsoft ログインメール捕捉 → 名称4 照合）
      getCapturedEmail: () => Promise<string | null>;
      getIdentity: () => Promise<{ email?: string; code?: string; name?: string } | null>;
      setIdentity: (obj: { email: string; code: string; name: string }) => Promise<boolean>;
      clearIdentity: () => Promise<boolean>;
      checkUpdate: () => Promise<{
        available: boolean;
        current: string;
        version?: string;
        dev?: boolean;
        error?: string;
      }>;
      startUpdate: () => Promise<boolean>;
      quitAndInstall: () => Promise<void>;
      onUpdateStatus: (
        cb: (data: {
          state: 'available' | 'none' | 'downloading' | 'downloaded' | 'error';
          version?: string;
          percent?: number;
          message?: string;
        }) => void
      ) => () => void;
    };
  }
}
