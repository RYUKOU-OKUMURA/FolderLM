/**
 * FolderLM - Folder Dropdown Component
 * 
 * フォルダ一覧と新規フォルダ作成 UI を提供するドロップダウンコンポーネント。
 * フォルダ選択（フィルタリング用）と新規作成機能を含む。
 * 
 * @module ui/folderDropdown
 */

import { FOLDERLM_CLASSES } from '../utils/selectors.js';
import { storageManager } from '../../storage/storageManager.js';
import { createFocusTrap } from '../utils/focusTrap.js';

/**
 * ドロップダウンの状態
 */
const DropdownState = {
  CLOSED: 'closed',
  LIST: 'list',
  CREATING: 'creating',
};

/**
 * フォルダドロップダウンコンポーネント
 */
class FolderDropdown {
  constructor() {
    /** @type {HTMLElement|null} */
    this.element = null;
    
    /** @type {HTMLElement|null} */
    this._anchorElement = null;
    
    /** @type {string} */
    this._state = DropdownState.CLOSED;
    
    /** @type {string|null} 現在選択中のフォルダID（フィルタ用） */
    this._selectedFolderId = null;
    
    /** @type {Function|null} フォルダ選択時のコールバック */
    this._onFolderSelect = null;
    
    /** @type {Function|null} フォルダ作成時のコールバック */
    this._onFolderCreate = null;
    
    /** @type {Function|null} ドロップダウン閉じた時のコールバック */
    this._onClose = null;

    /** @type {number} 現在フォーカスしているアイテムのインデックス */
    this._focusedIndex = -1;

    /** @type {FocusTrap|null} フォーカストラップインスタンス */
    this._focusTrap = null;

    // バインドされたイベントハンドラ
    this._boundHandleOutsideClick = this._handleOutsideClick.bind(this);
    this._boundHandleKeydown = this._handleKeydown.bind(this);
    this._boundHandleEscape = this._handleEscape.bind(this);
  }

  /**
   * ドロップダウンを表示
   * @param {HTMLElement} anchorElement - 基準となる要素（フォルダボタン）
   */
  open(anchorElement) {
    if (this._state !== DropdownState.CLOSED) {
      return;
    }

    this._anchorElement = anchorElement;
    this._state = DropdownState.LIST;
    this._focusedIndex = -1;
    
    this._render();
    this._positionDropdown();
    this._addGlobalListeners();
    
    // フォーカストラップを有効化
    if (this.element) {
      this._focusTrap = createFocusTrap(this.element);
      this._focusTrap.activate(false);
    }
    
    // 最初のアイテムにフォーカス
    requestAnimationFrame(() => {
      this._focusItem(0);
    });

    console.log('[FolderLM] Dropdown opened');
  }

  /**
   * ドロップダウンを閉じる
   */
  close() {
    if (this._state === DropdownState.CLOSED) {
      return;
    }

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

    this._state = DropdownState.CLOSED;
    this._anchorElement = null;
    this._focusedIndex = -1;

    if (this._onClose) {
      this._onClose();
    }

    console.log('[FolderLM] Dropdown closed');
  }

  /**
   * ドロップダウンの開閉をトグル
   * @param {HTMLElement} anchorElement - 基準となる要素
   */
  toggle(anchorElement) {
    if (this._state !== DropdownState.CLOSED) {
      this.close();
    } else {
      this.open(anchorElement);
    }
  }

  /**
   * ドロップダウンが開いているか
   * @returns {boolean}
   */
  isOpen() {
    return this._state !== DropdownState.CLOSED;
  }

  /**
   * 現在選択中のフォルダIDを設定
   * @param {string|null} folderId
   */
  setSelectedFolder(folderId) {
    this._selectedFolderId = folderId;
    if (this._state !== DropdownState.CLOSED) {
      this._render();
    }
  }

  /**
   * 現在選択中のフォルダIDを取得
   * @returns {string|null}
   */
  getSelectedFolder() {
    return this._selectedFolderId;
  }

  /**
   * フォルダ選択時のコールバックを設定
   * @param {Function} callback - (folderId: string) => void
   */
  onFolderSelect(callback) {
    this._onFolderSelect = callback;
  }

  /**
   * フォルダ作成時のコールバックを設定
   * @param {Function} callback - (folder: Object) => void
   */
  onFolderCreate(callback) {
    this._onFolderCreate = callback;
  }

  /**
   * 閉じた時のコールバックを設定
   * @param {Function} callback - () => void
   */
  onClose(callback) {
    this._onClose = callback;
  }

  /**
   * ドロップダウンを破棄
   */
  destroy() {
    this.close();
    this._onFolderSelect = null;
    this._onFolderCreate = null;
    this._onClose = null;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * ドロップダウンをレンダリング
   * @private
   */
  _render() {
    // 既存の要素があれば削除
    if (this.element) {
      this.element.remove();
    }

    const dropdown = document.createElement('div');
    dropdown.className = FOLDERLM_CLASSES.FOLDER_DROPDOWN;
    dropdown.setAttribute('role', 'menu');
    dropdown.setAttribute('aria-label', 'フォルダ管理メニュー');
    dropdown.setAttribute('aria-orientation', 'vertical');
    dropdown.setAttribute('tabindex', '-1');

    // ヘッダー
    const header = this._createHeader();
    dropdown.appendChild(header);

    // フォルダリスト
    const list = this._createFolderList();
    dropdown.appendChild(list);

    // 新規作成セクション
    const createSection = this._createNewFolderSection();
    dropdown.appendChild(createSection);

    // キーボードイベント
    dropdown.addEventListener('keydown', this._boundHandleKeydown);

    document.body.appendChild(dropdown);
    this.element = dropdown;
  }

  /**
   * ヘッダーを作成
   * @returns {HTMLElement}
   * @private
   */
  _createHeader() {
    const header = document.createElement('div');
    header.className = 'folderlm-folder-dropdown-header';

    const title = document.createElement('span');
    title.textContent = 'フォルダ';
    header.appendChild(title);

    // 「すべて表示」ボタン
    const showAllBtn = document.createElement('button');
    showAllBtn.type = 'button';
    showAllBtn.className = 'folderlm-show-all-btn';
    showAllBtn.textContent = 'すべて';
    showAllBtn.title = 'フィルタを解除';
    showAllBtn.setAttribute('role', 'menuitem');
    showAllBtn.setAttribute('aria-label', 'すべてのノートを表示（フィルタ解除）');
    showAllBtn.setAttribute('tabindex', '-1');
    showAllBtn.style.cssText = `
      padding: 4px 8px;
      border: none;
      border-radius: 4px;
      background-color: ${this._selectedFolderId === null ? 'rgba(26, 115, 232, 0.1)' : 'transparent'};
      color: ${this._selectedFolderId === null ? '#1a73e8' : 'inherit'};
      cursor: pointer;
      font-size: 12px;
    `;
    showAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handleFolderClick(null);
    });
    header.appendChild(showAllBtn);

    return header;
  }

  /**
   * フォルダリストを作成
   * @returns {HTMLElement}
   * @private
   */
  _createFolderList() {
    const list = document.createElement('ul');
    list.className = 'folderlm-folder-list';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'フォルダ一覧');

    const folders = storageManager.getFolders();
    const noteCounts = storageManager.getFolderNoteCounts();

    folders.forEach((folder, index) => {
      const item = this._createFolderItem(folder, noteCounts.get(folder.id) || 0, index);
      list.appendChild(item);
    });

    return list;
  }

  /**
   * フォルダアイテムを作成
   * @param {Object} folder - フォルダオブジェクト
   * @param {number} noteCount - ノート数
   * @param {number} index - インデックス
   * @returns {HTMLElement}
   * @private
   */
  _createFolderItem(folder, noteCount, index) {
    const item = document.createElement('li');
    item.className = 'folderlm-folder-item';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('data-folder-id', folder.id);
    item.setAttribute('data-index', index.toString());
    item.setAttribute('tabindex', '-1');
    item.setAttribute('aria-label', `${folder.name}（${noteCount}件のノート）`);

    if (this._selectedFolderId === folder.id) {
      item.classList.add('active');
      item.setAttribute('aria-current', 'true');
    }

    // アイコン
    const icon = document.createElement('span');
    icon.className = 'folderlm-folder-item-icon';
    icon.textContent = folder.isDefault ? '📥' : '📂';
    icon.setAttribute('aria-hidden', 'true');
    item.appendChild(icon);

    // フォルダ名
    const name = document.createElement('span');
    name.className = 'folderlm-folder-item-name';
    name.textContent = folder.name;
    item.appendChild(name);

    // ノート数
    const count = document.createElement('span');
    count.className = 'folderlm-folder-item-count';
    count.textContent = `(${noteCount})`;
    count.setAttribute('aria-label', `${noteCount}件のノート`);
    item.appendChild(count);

    // クリックイベント
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handleFolderClick(folder.id);
    });

    return item;
  }

  /**
   * 新規フォルダ作成セクションを作成
   * @returns {HTMLElement}
   * @private
   */
  _createNewFolderSection() {
    const section = document.createElement('div');
    section.className = 'folderlm-folder-create';

    if (this._state === DropdownState.CREATING) {
      // 入力フォーム表示
      const form = this._createNewFolderForm();
      section.appendChild(form);
    } else {
      // 「新規作成」ボタン表示
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'folderlm-folder-create-btn';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('aria-label', '新規フォルダを作成');
      btn.setAttribute('tabindex', '-1');
      btn.style.cssText = `
        display: flex;
        align-items: center;
        width: 100%;
        padding: 0;
        border: none;
        background: none;
        cursor: pointer;
        font-size: 14px;
        color: #1a73e8;
      `;

      const icon = document.createElement('span');
      icon.textContent = '➕';
      icon.style.marginRight = '12px';
      icon.setAttribute('aria-hidden', 'true');
      btn.appendChild(icon);

      const text = document.createElement('span');
      text.textContent = '新規フォルダを作成';
      btn.appendChild(text);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._startCreating();
      });

      section.appendChild(btn);
    }

    return section;
  }

  /**
   * 新規フォルダ作成フォームを作成
   * @returns {HTMLElement}
   * @private
   */
  _createNewFolderForm() {
    const form = document.createElement('form');
    form.style.cssText = 'display: flex; width: 100%; gap: 8px;';

    // 入力フィールド
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folderlm-folder-create-input';
    input.placeholder = 'フォルダ名';
    input.maxLength = storageManager.LIMITS.MAX_FOLDER_NAME_LENGTH;
    input.setAttribute('aria-label', 'フォルダ名を入力');
    input.setAttribute('autocomplete', 'off');
    form.appendChild(input);

    // 作成ボタン
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = '作成';
    submitBtn.setAttribute('aria-label', 'フォルダを作成');
    submitBtn.style.cssText = `
      padding: 8px 12px;
      border: none;
      border-radius: 4px;
      background-color: #1a73e8;
      color: white;
      cursor: pointer;
      font-size: 14px;
    `;
    form.appendChild(submitBtn);

    // キャンセルボタン
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = '✕';
    cancelBtn.title = 'キャンセル';
    cancelBtn.setAttribute('aria-label', 'フォルダ作成をキャンセル');
    cancelBtn.style.cssText = `
      padding: 8px;
      border: none;
      border-radius: 4px;
      background-color: transparent;
      cursor: pointer;
      font-size: 14px;
    `;
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._cancelCreating();
    });
    form.appendChild(cancelBtn);

    // エラーメッセージ用の要素
    const errorDiv = document.createElement('div');
    errorDiv.className = 'folderlm-folder-create-error';
    errorDiv.style.cssText = `
      display: none;
      width: 100%;
      padding: 4px 0;
      color: #d93025;
      font-size: 12px;
    `;
    errorDiv.setAttribute('role', 'alert');

    // フォーム送信
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._handleCreateFolder(input.value, errorDiv);
    });

    // 入力時のリアルタイムバリデーション
    input.addEventListener('input', () => {
      errorDiv.style.display = 'none';
    });

    // ESC でキャンセル（IME変換中は無視）
    input.addEventListener('keydown', (e) => {
      // IME変換中は無視
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this._cancelCreating();
      }
    });

    // フォーカスを設定
    requestAnimationFrame(() => {
      input.focus();
    });

    // コンテナでラップしてエラーメッセージを追加
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-direction: column; width: 100%;';
    container.appendChild(form);
    container.appendChild(errorDiv);

    return container;
  }

  /**
   * 新規フォルダ作成モードを開始
   * @private
   */
  _startCreating() {
    this._state = DropdownState.CREATING;
    this._render();
    this._positionDropdown();
  }

  /**
   * 新規フォルダ作成をキャンセル
   * @private
   */
  _cancelCreating() {
    this._state = DropdownState.LIST;
    this._render();
    this._positionDropdown();
  }

  /**
   * フォルダ作成を処理
   * @param {string} name - フォルダ名
   * @param {HTMLElement} errorDiv - エラー表示用要素
   * @private
   */
  _handleCreateFolder(name, errorDiv) {
    const result = storageManager.createFolder(name);

    if (!result.success) {
      // エラー表示
      errorDiv.textContent = result.error;
      errorDiv.style.display = 'block';
      return;
    }

    // 成功
    console.log('[FolderLM] Folder created:', result.folder);

    if (this._onFolderCreate) {
      this._onFolderCreate(result.folder);
    }

    // リスト表示に戻る
    this._state = DropdownState.LIST;
    this._render();
    this._positionDropdown();
  }

  /**
   * フォルダクリックを処理
   * @param {string|null} folderId - フォルダID（null で「すべて」）
   * @private
   */
  _handleFolderClick(folderId) {
    this._selectedFolderId = folderId;

    if (this._onFolderSelect) {
      this._onFolderSelect(folderId);
    }

    this.close();
  }

  /**
   * ドロップダウンの位置を調整
   * @private
   */
  _positionDropdown() {
    if (!this.element || !this._anchorElement) {
      return;
    }

    const anchorRect = this._anchorElement.getBoundingClientRect();
    const dropdownRect = this.element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = anchorRect.bottom + 4;
    let left = anchorRect.right - dropdownRect.width;

    // 画面右端からはみ出す場合
    if (left < 8) {
      left = 8;
    }
    if (left + dropdownRect.width > viewportWidth - 8) {
      left = viewportWidth - dropdownRect.width - 8;
    }

    // 画面下端からはみ出す場合は上に表示
    if (top + dropdownRect.height > viewportHeight - 8) {
      top = anchorRect.top - dropdownRect.height - 4;
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
    // クリック外で閉じる（次のイベントループで追加）
    requestAnimationFrame(() => {
      document.addEventListener('click', this._boundHandleOutsideClick, true);
      document.addEventListener('keydown', this._boundHandleEscape, true);
    });

    // ウィンドウリサイズ時に位置を調整
    window.addEventListener('resize', () => this._positionDropdown());
    window.addEventListener('scroll', () => this._positionDropdown(), true);
  }

  /**
   * グローバルイベントリスナーを削除
   * @private
   */
  _removeGlobalListeners() {
    document.removeEventListener('click', this._boundHandleOutsideClick, true);
    document.removeEventListener('keydown', this._boundHandleEscape, true);
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

    // ドロップダウン内のクリックは無視
    if (this.element.contains(event.target)) {
      return;
    }

    // アンカー要素（フォルダボタン）のクリックは無視（トグルで処理）
    if (this._anchorElement && this._anchorElement.contains(event.target)) {
      return;
    }

    // 入力モード（CREATING状態）では、入力フィールドがアクティブな場合は閉じない
    if (this._state === DropdownState.CREATING) {
      const activeElement = document.activeElement;
      const input = this.element.querySelector('.folderlm-folder-create-input');
      if (input && (activeElement === input || input.contains(activeElement))) {
        return;
      }
    }

    this.close();
  }

  /**
   * キーダウンを処理（ドロップダウン内）
   * @param {KeyboardEvent} event
   * @private
   */
  _handleKeydown(event) {
    if (this._state === DropdownState.CREATING) {
      const target = event.target;
      if (target instanceof Element && target.closest('.folderlm-folder-create')) {
        return;
      }
    }

    const items = this.element?.querySelectorAll('.folderlm-folder-item');
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
          this._handleFolderClick(folderId);
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
    // IME変換中は無視
    if (event.isComposing || event.keyCode === 229) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();

      if (this._state === DropdownState.CREATING) {
        this._cancelCreating();
      } else {
        this.close();
      }
    }
  }

  /**
   * 指定インデックスのアイテムにフォーカス
   * @param {number} index
   * @private
   */
  _focusItem(index) {
    const items = this.element?.querySelectorAll('.folderlm-folder-item');
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
export const folderDropdown = new FolderDropdown();

// デフォルトエクスポート
export default folderDropdown;
