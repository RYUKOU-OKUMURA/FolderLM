/**
 * FolderLM - Folder Button Component
 * 
 * ヘッダーのアクションバーに挿入するフォルダボタンコンポーネント。
 * クリックでフォルダドロップダウンを表示/非表示する。
 * 
 * @module ui/folderButton
 */

import { UI_INJECTION_SELECTORS, FOLDERLM_CLASSES } from '../utils/selectors.js';
import { findFirstMatch } from '../utils/selectors.js';
import { createIconElement } from '../utils/icons.js';

/**
 * フォルダボタンコンポーネント
 */
class FolderButton {
  constructor() {
    /** @type {HTMLButtonElement|null} */
    this.element = null;
    
    /** @type {Function|null} クリック時のコールバック */
    this._onClick = null;
    
    /** @type {boolean} ドロップダウンが開いているか */
    this._isOpen = false;

    /** @type {boolean} フィルタがアクティブかどうか */
    this._isFilterActive = false;
  }

  /**
   * ボタンを作成して DOM に挿入
   * @returns {HTMLButtonElement|null} 作成されたボタン要素、または既存の場合 null
   */
  create() {
    // 既存のボタンがあれば何もしない
    if (this.element && document.contains(this.element)) {
      return null;
    }

    const existing = document.querySelector(`.${FOLDERLM_CLASSES.FOLDER_BUTTON}`);
    if (existing) {
      this.element = existing;
      return null;
    }

    // 挿入位置を探す
    const actionBar = findFirstMatch(
      UI_INJECTION_SELECTORS.ACTION_BAR,
      UI_INJECTION_SELECTORS.ACTION_BAR_FALLBACK
    );

    if (!actionBar) {
      console.warn('[FolderLM] Action bar not found, cannot inject folder button');
      return null;
    }

    // ボタン要素を作成
    const button = document.createElement('button');
    button.className = FOLDERLM_CLASSES.FOLDER_BUTTON;
    button.setAttribute('type', 'button');
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', 'フォルダ管理メニューを開く');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('tabindex', '0');
    button.title = 'FolderLM - フォルダ管理';

    // アイコンを設定
    const icon = createIconElement('folder', 20);
    button.appendChild(icon);

    // スクリーンリーダー用のテキスト
    const srText = document.createElement('span');
    srText.className = 'folderlm-sr-only';
    srText.textContent = 'フォルダ管理を開く';
    button.appendChild(srText);

    // イベントリスナーを設定
    button.addEventListener('click', this._handleClick.bind(this));
    button.addEventListener('keydown', this._handleKeydown.bind(this));

    // DOM に挿入（共有タブの右隣に挿入を試みる）
    // 「共有」を含むタブ要素を探す（mat-button-toggle要素）
    let sharedToggle = null;
    const allToggles = document.querySelectorAll('.mat-button-toggle');
    for (const toggle of allToggles) {
      if (toggle.textContent.includes('共有')) {
        sharedToggle = toggle;
        break;
      }
    }

    if (sharedToggle && sharedToggle.parentElement) {
      // 共有タブの次の兄弟要素として挿入
      sharedToggle.parentElement.insertBefore(button, sharedToggle.nextSibling);
    } else {
      // フォールバック: フィルタグループの後に挿入
      const filterGroup = findFirstMatch(UI_INJECTION_SELECTORS.FILTER_GROUP);
      if (filterGroup && filterGroup.parentElement) {
        filterGroup.parentElement.insertBefore(button, filterGroup.nextSibling);
      } else {
        // 最終フォールバック: アクションバーの先頭に挿入
        actionBar.insertBefore(button, actionBar.firstChild);
      }
    }

    this.element = button;

    console.log('[FolderLM] Folder button created');
    return button;
  }

  /**
   * ボタンを DOM から削除
   */
  destroy() {
    if (this.element) {
      this.element.removeEventListener('click', this._handleClick.bind(this));
      this.element.removeEventListener('keydown', this._handleKeydown.bind(this));
      this.element.remove();
      this.element = null;
    }
  }

  /**
   * クリックイベントのコールバックを設定
   * @param {Function} callback - クリック時に呼ばれる関数
   */
  onClick(callback) {
    this._onClick = callback;
  }

  /**
   * ドロップダウンの開閉状態を設定
   * @param {boolean} isOpen - 開いているか
   */
  setOpen(isOpen) {
    this._isOpen = isOpen;
    if (this.element) {
      this.element.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      this.element.setAttribute('aria-label', isOpen ? 'フォルダ管理メニューを閉じる' : 'フォルダ管理メニューを開く');
      
      // スクリーンリーダー用テキストを更新
      const srText = this.element.querySelector('.folderlm-sr-only');
      if (srText) {
        srText.textContent = isOpen ? 'フォルダ管理メニューを閉じる' : 'フォルダ管理メニューを開く';
      }
    }
  }

  /**
   * ドロップダウンの開閉状態を取得
   * @returns {boolean}
   */
  isOpen() {
    return this._isOpen;
  }

  /**
   * ボタン要素を取得
   * @returns {HTMLButtonElement|null}
   */
  getElement() {
    return this.element;
  }

  /**
   * ボタンにフォーカスを設定
   */
  focus() {
    if (this.element) {
      this.element.focus();
    }
  }

  /**
   * フィルタアクティブ状態を設定
   * @param {boolean} isActive - フィルタがアクティブかどうか
   */
  setFilterActive(isActive) {
    this._isFilterActive = isActive;
    if (this.element) {
      if (isActive) {
        this.element.classList.add('filter-active');
        this.element.setAttribute('data-filter-active', 'true');
      } else {
        this.element.classList.remove('filter-active');
        this.element.removeAttribute('data-filter-active');
      }
    }
  }

  /**
   * フィルタアクティブ状態を取得
   * @returns {boolean}
   */
  isFilterActive() {
    return this._isFilterActive;
  }

  /**
   * クリックイベントハンドラ
   * @param {MouseEvent} event
   * @private
   */
  _handleClick(event) {
    event.preventDefault();
    event.stopPropagation();

    if (this._onClick) {
      this._onClick(event);
    }
  }

  /**
   * キーダウンイベントハンドラ
   * @param {KeyboardEvent} event
   * @private
   */
  _handleKeydown(event) {
    // Enter または Space でクリックと同じ動作
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this._handleClick(event);
    }
    
    // Escape でドロップダウンを閉じる（開いている場合）
    if (event.key === 'Escape' && this._isOpen) {
      event.preventDefault();
      if (this._onClick) {
        this._onClick(event);
      }
    }
  }

  /**
   * ボタンが DOM に存在するか確認
   * @returns {boolean}
   */
  exists() {
    return this.element !== null && document.contains(this.element);
  }

  /**
   * ボタンを再挿入（DOM 再描画後の復帰用）
   * @returns {HTMLButtonElement|null}
   */
  reinject() {
    // 既存のボタンが DOM にあれば何もしない
    if (this.exists()) {
      return null;
    }

    // ボタンをリセットして再作成
    this.element = null;
    return this.create();
  }
}

// シングルトンインスタンスをエクスポート
export const folderButton = new FolderButton();

// デフォルトエクスポート
export default folderButton;
