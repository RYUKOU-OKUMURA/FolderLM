/**
 * FolderLM - Icon Utility Module
 *
 * インラインSVGアイコンを生成するユーティリティ。
 * シルバー/グレーの塗りと青い縁取りのモダンなデザイン。
 * ライトモード・ダークモード両対応。
 *
 * @module utils/icons
 */

/**
 * デフォルトのアイコンカラー設定
 */
const ICON_COLORS = {
  fill: '#9E9E9E',
  stroke: '#1a73e8',
  strokeDark: '#8ab4f8',
};

/**
 * フォルダSVGアイコンを生成
 * @param {number} size - アイコンサイズ（ピクセル）
 * @param {Object} options - オプション設定
 * @param {string} [options.fill] - 塗りの色
 * @param {string} [options.stroke] - 縁の色
 * @param {number} [options.strokeWidth] - 縁の太さ
 * @returns {string} SVG文字列
 */
export function createFolderIcon(size = 16, options = {}) {
  const fill = options.fill || ICON_COLORS.fill;
  const stroke = options.stroke || 'currentColor';
  const strokeWidth = options.strokeWidth || 1.5;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="folderlm-svg-icon">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>`;
}

/**
 * 受信箱（未分類フォルダ用）SVGアイコンを生成
 * @param {number} size - アイコンサイズ（ピクセル）
 * @param {Object} options - オプション設定
 * @param {string} [options.fill] - 塗りの色
 * @param {string} [options.stroke] - 縁の色
 * @param {number} [options.strokeWidth] - 縁の太さ
 * @returns {string} SVG文字列
 */
export function createInboxIcon(size = 16, options = {}) {
  const fill = options.fill || ICON_COLORS.fill;
  const stroke = options.stroke || 'currentColor';
  const strokeWidth = options.strokeWidth || 1.5;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="folderlm-svg-icon">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" fill="none"/>
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
  </svg>`;
}

/**
 * 編集（ペン）SVGアイコンを生成
 * @param {number} size - アイコンサイズ（ピクセル）
 * @param {Object} options - オプション設定
 * @param {string} [options.stroke] - 縁の色
 * @param {number} [options.strokeWidth] - 縁の太さ
 * @returns {string} SVG文字列
 */
export function createEditIcon(size = 16, options = {}) {
  const stroke = options.stroke || 'currentColor';
  const strokeWidth = options.strokeWidth || 1.5;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="folderlm-svg-icon">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>`;
}

/**
 * 削除（ゴミ箱）SVGアイコンを生成
 * @param {number} size - アイコンサイズ（ピクセル）
 * @param {Object} options - オプション設定
 * @param {string} [options.stroke] - 縁の色
 * @param {number} [options.strokeWidth] - 縁の太さ
 * @returns {string} SVG文字列
 */
export function createDeleteIcon(size = 16, options = {}) {
  const stroke = options.stroke || 'currentColor';
  const strokeWidth = options.strokeWidth || 1.5;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="folderlm-svg-icon">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    <line x1="10" y1="11" x2="10" y2="17"/>
    <line x1="14" y1="11" x2="14" y2="17"/>
  </svg>`;
}

/**
 * ドラッグハンドルSVGアイコンを生成
 * @param {number} size - アイコンサイズ（ピクセル）
 * @param {Object} options - オプション設定
 * @param {string} [options.fill] - 塗りの色
 * @returns {string} SVG文字列
 */
export function createDragHandleIcon(size = 16, options = {}) {
  const fill = options.fill || 'currentColor';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" class="folderlm-svg-icon">
    <circle cx="9" cy="6" r="1.5"/>
    <circle cx="15" cy="6" r="1.5"/>
    <circle cx="9" cy="12" r="1.5"/>
    <circle cx="15" cy="12" r="1.5"/>
    <circle cx="9" cy="18" r="1.5"/>
    <circle cx="15" cy="18" r="1.5"/>
  </svg>`;
}

/**
 * アイコンタイプからSVG文字列を取得
 * @param {string} type - アイコンタイプ: 'folder', 'inbox', 'edit', 'delete', 'drag'
 * @param {number} size - アイコンサイズ（ピクセル）
 * @param {Object} options - オプション設定
 * @returns {string} SVG文字列
 */
export function getIconSvg(type, size = 16, options = {}) {
  switch (type) {
    case 'folder':
      return createFolderIcon(size, options);
    case 'inbox':
      return createInboxIcon(size, options);
    case 'edit':
      return createEditIcon(size, options);
    case 'delete':
      return createDeleteIcon(size, options);
    case 'drag':
      return createDragHandleIcon(size, options);
    default:
      return createFolderIcon(size, options);
  }
}

/**
 * アイコン要素（span + インラインSVG）を生成
 * @param {string} type - アイコンタイプ: 'folder', 'inbox', 'edit', 'delete', 'drag'
 * @param {number} size - アイコンサイズ（ピクセル）
 * @param {Object} options - オプション設定
 * @returns {HTMLSpanElement} アイコン要素
 */
export function createIconElement(type, size = 16, options = {}) {
  const span = document.createElement('span');
  span.className = 'folderlm-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = getIconSvg(type, size, options);
  return span;
}

/**
 * アイコンカラー定数をエクスポート
 */
export { ICON_COLORS };
