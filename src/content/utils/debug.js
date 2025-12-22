/**
 * FolderLM - Debug Flags
 *
 * リリース時にデバッグ用のグローバル公開を抑制するためのフラグ。
 */

/**
 * グローバルにデバッグオブジェクトを公開するかどうか
 * @type {boolean}
 */
export const DEBUG_EXPOSE_GLOBALS = false;

/**
 * 拡張機能のコンテキストかどうか
 * @type {boolean}
 */
export const IS_EXTENSION_CONTEXT = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
