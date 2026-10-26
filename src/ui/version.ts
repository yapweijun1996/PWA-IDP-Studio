declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__;
export const BUILD_ID = typeof __BUILD_ID__ === 'undefined' ? 'dev' : __BUILD_ID__;
