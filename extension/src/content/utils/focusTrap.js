/**
 * FolderLM - Focus Trap Utility
 * 
 * モーダルやドロップダウンでフォーカスをトラップし、
 * キーボード操作を改善するユーティリティ。
 * 
 * @module utils/focusTrap
 */

/**
 * フォーカス可能な要素のセレクタ
 */
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * FocusTrap クラス
 * 特定の要素内でフォーカスをトラップする
 */
export class FocusTrap {
  /**
   * @param {HTMLElement} element - フォーカスをトラップする要素
   */
  constructor(element) {
    this.element = element;
    this.firstFocusableElement = null;
    this.lastFocusableElement = null;
    this.previousActiveElement = null;
    
    this._boundHandleKeydown = this._handleKeydown.bind(this);
    this._isActive = false;
  }

  /**
   * フォーカストラップを有効化
   * @param {boolean} [focusFirst=true] - 最初の要素にフォーカスするか
   */
  activate(focusFirst = true) {
    if (this._isActive) {
      return;
    }

    // 現在のアクティブ要素を保存
    this.previousActiveElement = document.activeElement;

    // フォーカス可能な要素を取得
    this._updateFocusableElements();

    // キーボードイベントリスナーを追加
    this.element.addEventListener('keydown', this._boundHandleKeydown, true);

    // 最初の要素にフォーカス
    if (focusFirst && this.firstFocusableElement) {
      requestAnimationFrame(() => {
        this.firstFocusableElement.focus();
      });
    }

    this._isActive = true;
  }

  /**
   * フォーカストラップを無効化
   * @param {boolean} [restoreFocus=true] - 元の要素にフォーカスを戻すか
   */
  deactivate(restoreFocus = true) {
    if (!this._isActive) {
      return;
    }

    // イベントリスナーを削除
    this.element.removeEventListener('keydown', this._boundHandleKeydown, true);

    // 元の要素にフォーカスを戻す
    if (restoreFocus && this.previousActiveElement && this.previousActiveElement.focus) {
      requestAnimationFrame(() => {
        this.previousActiveElement.focus();
      });
    }

    this._isActive = false;
  }

  /**
   * フォーカス可能な要素を更新
   * @private
   */
  _updateFocusableElements() {
    const focusableElements = Array.from(
      this.element.querySelectorAll(FOCUSABLE_SELECTORS)
    ).filter(el => {
      // 非表示の要素を除外
      return el.offsetParent !== null;
    });

    this.firstFocusableElement = focusableElements[0] || null;
    this.lastFocusableElement = focusableElements[focusableElements.length - 1] || null;
  }

  /**
   * キーボードイベントを処理
   * @param {KeyboardEvent} event
   * @private
   */
  _handleKeydown(event) {
    if (event.key !== 'Tab') {
      return;
    }

    // フォーカス可能な要素を更新（動的に変わる可能性があるため）
    this._updateFocusableElements();

    if (!this.firstFocusableElement || !this.lastFocusableElement) {
      return;
    }

    // Shift + Tab（逆方向）
    if (event.shiftKey) {
      if (document.activeElement === this.firstFocusableElement) {
        event.preventDefault();
        this.lastFocusableElement.focus();
      }
    } 
    // Tab（順方向）
    else {
      if (document.activeElement === this.lastFocusableElement) {
        event.preventDefault();
        this.firstFocusableElement.focus();
      }
    }
  }

  /**
   * アクティブかどうか
   * @returns {boolean}
   */
  isActive() {
    return this._isActive;
  }
}

/**
 * フォーカストラップを作成して返す（ファクトリー関数）
 * @param {HTMLElement} element - フォーカスをトラップする要素
 * @returns {FocusTrap}
 */
export function createFocusTrap(element) {
  return new FocusTrap(element);
}

export default FocusTrap;
