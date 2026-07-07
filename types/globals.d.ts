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
    };
  }
}
