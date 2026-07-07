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
