/**
 * FolderLM - Folder Select Popup Component
 * 
 * ノートカードの割り当てボタンをクリックした時に表示されるフォルダ選択ポップアップ。
 * フォルダを選択するとノートの割り当てが更新される。
 * 
 * @module ui/folderSelectPopup
 */

import { FOLDERLM_CLASSES } from '../utils/selectors.js';
import { storageManager } from '../../storage/storageManager.js';
import { createFocusTrap } from '../utils/focusTrap.js';
import { createIconElement } from '../utils/icons.js';

/**
 * FolderSelectPopup クラス
 * フォルダ選択ポップアップを管理
 */
class FolderSelectPopup {
  constructor() {
    /**
     * ポップアップ要素
     * @type {HTMLElement|null}
     */
    this.element = null;

    /**
     * 現在のノートID
     * @type {string|null}
     */
    this._noteId = null;

    /**
     * 基準となる要素（割り当てボタン）
     * @type {HTMLElement|null}
     */
    this._anchorElement = null;

    /**
     * フォルダ選択時のコールバック
     * @type {Function|null}
     */
    this._onSelect = null;

    /**
     * ポップアップが閉じた時のコールバック
     * @type {Function|null}
     */
    this._onClose = null;

    /**
     * 現在フォーカスしているアイテムのインデックス
     * @type {number}
     */
    this._focusedIndex = -1;

    /**
     * フォーカストラップインスタンス
     * @type {FocusTrap|null}
     */
    this._focusTrap = null;

    // バインドされたイベントハンドラ
    this._boundHandleOutsideClick = this._handleOutsideClick.bind(this);
    this._boundHandleKeydown = this._handleKeydown.bind(this);
    this._boundHandleEscape = this._handleEscape.bind(this);
    this._boundHandleViewportChange = this._positionPopup.bind(this);
    this._addListenersRafId = null;
  }

  /**
   * ポップアップを開く
   * @param {string} noteId - 対象のノートID
   * @param {HTMLElement} anchorElement - 基準となる要素（割り当てボタン）
   */
  open(noteId, anchorElement) {
    if (!noteId || !anchorElement) {
      console.warn('[FolderLM] Cannot open popup: missing noteId or anchorElement');
      return;
    }

    // 既に開いている場合は一旦閉じる
    if (this.element) {
      this.close();
    }

    this._noteId = noteId;
    this._anchorElement = anchorElement;
    this._focusedIndex = -1;

    this._render();
    this._positionPopup();
    this._addGlobalListeners();

    // フォーカストラップを有効化
    if (this.element) {
      this._focusTrap = createFocusTrap(this.element);
      this._focusTrap.activate(false);
    }

    // 現在割り当てられているフォルダがあればそこにフォーカス
    const currentFolderId = storageManager.getNoteFolder(noteId);
    const folders = storageManager.getFolders();
    const currentIndex = folders.findIndex(f => f.id === currentFolderId);
    
    requestAnimationFrame(() => {
      this._focusItem(currentIndex >= 0 ? currentIndex : 0);
    });

    console.log('[FolderLM] Folder select popup opened for note:', noteId);
  }

  /**
   * ポップアップを閉じる
   */
  close() {
    // フォーカストラップを無効化
    if (this._focusTrap) {
      this._focusTrap.deactivate(true);
      this._focusTrap = null;
    }

    this._removeGlobalListeners();

    if (this.element) {
      this.element.remove();
      this.element = null;
    }

    this._noteId = null;
    this._anchorElement = null;
    this._focusedIndex = -1;

    if (this._onClose) {
      this._onClose();
    }
  }

  /**
   * ポップアップが開いているか
   * @returns {boolean}
   */
  isOpen() {
    return this.element !== null;
  }

  /**
   * フォルダ選択時のコールバックを設定
   * @param {Function} callback - (noteId: string, folderId: string) => void
   */
  onSelect(callback) {
    this._onSelect = callback;
  }

  /**
   * 閉じた時のコールバックを設定
   * @param {Function} callback - () => void
   */
  onClose(callback) {
    this._onClose = callback;
  }

  /**
   * 破棄
   */
  destroy() {
    this.close();
    this._onSelect = null;
    this._onClose = null;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * ポップアップをレンダリング
   * @private
   */
  _render() {
    const popup = document.createElement('div');
    popup.className = FOLDERLM_CLASSES.SELECT_POPUP;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'フォルダ選択');
    popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('tabindex', '-1');

    // ヘッダー
    const header = this._createHeader();
    popup.appendChild(header);

    // フォルダリスト
    const list = this._createFolderList();
    popup.appendChild(list);

    // キーボードイベント
    popup.addEventListener('keydown', this._boundHandleKeydown);

    document.body.appendChild(popup);
    this.element = popup;
  }

  /**
   * ヘッダーを作成
   * @returns {HTMLElement}
   * @private
   */
  _createHeader() {
    const header = document.createElement('div');
    header.className = 'folderlm-select-popup__header';
    header.style.cssText = `
      padding: 8px 16px;
      border-bottom: 1px solid #e0e0e0;
      font-size: 12px;
      color: #5f6368;
      font-weight: 500;
    `;
    header.textContent = 'フォルダに割り当て';
    return header;
  }

  /**
   * フォルダリストを作成
   * @returns {HTMLElement}
   * @private
   */
  _createFolderList() {
    const list = document.createElement('ul');
    list.className = 'folderlm-select-popup__list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'フォルダリスト');
    list.style.cssText = `
      list-style: none;
      margin: 0;
      padding: 4px 0;
      max-height: 300px;
      overflow-y: auto;
    `;

    const folders = storageManager.getFolders();
    const currentFolderId = storageManager.getNoteFolder(this._noteId);

    folders.forEach((folder, index) => {
      const item = this._createFolderItem(folder, index, currentFolderId === folder.id);
      list.appendChild(item);
    });

    return list;
  }

  /**
   * フォルダアイテムを作成
   * @param {Object} folder - フォルダオブジェクト
   * @param {number} index - インデックス
   * @param {boolean} isSelected - 選択中かどうか
   * @returns {HTMLElement}
   * @private
   */
  _createFolderItem(folder, index, isSelected) {
    const item = document.createElement('li');
    item.className = 'folderlm-select-popup-item';
    item.setAttribute('role', 'option');
    item.setAttribute('data-folder-id', folder.id);
    item.setAttribute('data-index', index.toString());
    item.setAttribute('tabindex', '-1');
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');

    if (isSelected) {
      item.classList.add('selected');
    }

    // チェックマーク
    const check = document.createElement('span');
    check.className = 'folderlm-select-popup-item-check';
    check.textContent = isSelected ? '✓' : '';
    check.setAttribute('aria-hidden', 'true');
    item.appendChild(check);

    // アイコン
    const iconType = folder.isDefault ? 'inbox' : 'folder';
    const icon = createIconElement(iconType, 14);
    icon.classList.add('folderlm-select-popup-item-icon');
    item.appendChild(icon);

    // フォルダ名
    const name = document.createElement('span');
    name.className = 'folderlm-select-popup-item-name';
    name.textContent = folder.name;
    name.style.cssText = `
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    item.appendChild(name);

    // クリックイベント
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._handleFolderSelect(folder.id);
    });

    return item;
  }

  /**
   * フォルダ選択を処理
   * @param {string} folderId - 選択されたフォルダID
   * @private
   */
  _handleFolderSelect(folderId) {
    if (!this._noteId) {
      return;
    }

    // ストレージに保存
    const result = storageManager.assignNote(this._noteId, folderId);

    if (result.success) {
      console.log('[FolderLM] Note assigned:', this._noteId, '->', folderId);

      if (this._onSelect) {
        this._onSelect(this._noteId, folderId);
      }
    } else {
      console.error('[FolderLM] Failed to assign note:', result.error);
    }

    this.close();
  }

  /**
   * ポップアップの位置を調整
   * @private
   */
  _positionPopup() {
    if (!this.element || !this._anchorElement) {
      return;
    }

    const anchorRect = this._anchorElement.getBoundingClientRect();
    const popupRect = this.element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // デフォルト: ボタンの下に表示
    let top = anchorRect.bottom + 4;
    let left = anchorRect.left;

    // 右端からはみ出す場合は左に寄せる
    if (left + popupRect.width > viewportWidth - 8) {
      left = viewportWidth - popupRect.width - 8;
    }

    // 左端からはみ出す場合
    if (left < 8) {
      left = 8;
    }

    // 下端からはみ出す場合は上に表示
    if (top + popupRect.height > viewportHeight - 8) {
      top = anchorRect.top - popupRect.height - 4;
    }

    // 上端からもはみ出す場合は下に表示して高さを制限
    if (top < 8) {
      top = 8;
      const maxHeight = viewportHeight - 16;
      this.element.style.maxHeight = `${maxHeight}px`;
    }

    this.element.style.position = 'fixed';
    this.element.style.top = `${top}px`;
    this.element.style.left = `${left}px`;
  }

  /**
   * グローバルイベントリスナーを追加
   * @private
   */
  _addGlobalListeners() {
    // 次のイベントループで追加（即座のクリックで閉じないように）
    this._addListenersRafId = requestAnimationFrame(() => {
      document.addEventListener('click', this._boundHandleOutsideClick, true);
      document.addEventListener('keydown', this._boundHandleEscape, true);
      this._addListenersRafId = null;
    });

    // スクロールや画面リサイズで位置を調整
    window.addEventListener('resize', this._boundHandleViewportChange);
    window.addEventListener('scroll', this._boundHandleViewportChange, true);
  }

  /**
   * グローバルイベントリスナーを削除
   * @private
   */
  _removeGlobalListeners() {
    if (this._addListenersRafId) {
      cancelAnimationFrame(this._addListenersRafId);
      this._addListenersRafId = null;
    }
    document.removeEventListener('click', this._boundHandleOutsideClick, true);
    document.removeEventListener('keydown', this._boundHandleEscape, true);
    window.removeEventListener('resize', this._boundHandleViewportChange);
    window.removeEventListener('scroll', this._boundHandleViewportChange, true);
  }

  /**
   * 外部クリックを処理
   * @param {MouseEvent} event
   * @private
   */
  _handleOutsideClick(event) {
    if (!this.element) {
      return;
    }

    // ポップアップ内のクリックは無視
    if (this.element.contains(event.target)) {
      return;
    }

    // アンカー要素（割り当てボタン）のクリックは無視
    if (this._anchorElement && this._anchorElement.contains(event.target)) {
      return;
    }

    this.close();
  }

  /**
   * キーダウンを処理（ポップアップ内）
   * @param {KeyboardEvent} event
   * @private
   */
  _handleKeydown(event) {
    const items = this.element?.querySelectorAll('.folderlm-select-popup-item');
    if (!items || items.length === 0) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this._focusItem(Math.min(this._focusedIndex + 1, items.length - 1));
        break;

      case 'ArrowUp':
        event.preventDefault();
        this._focusItem(Math.max(this._focusedIndex - 1, 0));
        break;

      case 'Home':
        event.preventDefault();
        this._focusItem(0);
        break;

      case 'End':
        event.preventDefault();
        this._focusItem(items.length - 1);
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        if (this._focusedIndex >= 0 && this._focusedIndex < items.length) {
          const item = items[this._focusedIndex];
          const folderId = item.getAttribute('data-folder-id');
          this._handleFolderSelect(folderId);
        }
        break;

      case 'Tab':
        // Tab で閉じる
        this.close();
        break;
    }
  }

  /**
   * Escape キーを処理（グローバル）
   * @param {KeyboardEvent} event
   * @private
   */
  _handleEscape(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  /**
   * 指定インデックスのアイテムにフォーカス
   * @param {number} index
   * @private
   */
  _focusItem(index) {
    const items = this.element?.querySelectorAll('.folderlm-select-popup-item');
    if (!items || items.length === 0) {
      return;
    }

    // 範囲外のインデックスは補正
    index = Math.max(0, Math.min(index, items.length - 1));

    // 現在のフォーカスを解除
    if (this._focusedIndex >= 0 && this._focusedIndex < items.length) {
      items[this._focusedIndex].setAttribute('tabindex', '-1');
    }

    // 新しいアイテムにフォーカス
    items[index].setAttribute('tabindex', '0');
    items[index].focus();
    this._focusedIndex = index;
  }
}

// シングルトンインスタンスをエクスポート
export const folderSelectPopup = new FolderSelectPopup();

// デフォルトエクスポート
export default folderSelectPopup;
