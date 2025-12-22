/**
 * FolderLM - Note Assign Button Component
 * 
 * ノートカードに挿入するフォルダ割り当てボタンコンポーネント。
 * ホバー時に表示され、クリックでフォルダ選択ポップアップを開く。
 * 
 * @module ui/noteAssignButton
 */

import { FOLDERLM_CLASSES } from '../utils/selectors.js';
import { storageManager } from '../../storage/storageManager.js';
import { createIconElement } from '../utils/icons.js';

/**
 * NoteAssignButton クラス
 * ノートカードごとの割り当てボタンを管理
 */
class NoteAssignButton {
  constructor() {
    /**
     * ノートIDからボタン要素へのマッピング
     * @type {Map<string, HTMLButtonElement>}
     */
    this.buttonMap = new Map();

    /**
     * クリック時のコールバック
     * @type {Function|null}
     */
    this._onClick = null;

    /**
     * バインドされたイベントハンドラ
     */
    this._boundHandleClick = this._handleClick.bind(this);
  }

  /**
   * ノートカードに割り当てボタンを追加
   * @param {Element} card - ノートカード要素
   * @param {string} noteId - ノートID
   * @returns {HTMLButtonElement|null} 作成されたボタン、または既存の場合 null
   */
  addToCard(card, noteId) {
    if (!card || !noteId) {
      return null;
    }

    // 既存のボタンがあれば更新のみ
    const existingButton = card.querySelector(`.${FOLDERLM_CLASSES.ASSIGN_BUTTON}`);
    if (existingButton) {
      const anchored = this._placeButton(existingButton, card);
      this._updateButtonState(existingButton, noteId);
      if (!anchored) {
        this._scheduleReposition(existingButton, card);
      }
      return null;
    }

    // ボタン要素を作成
    const button = this._createButton(noteId);

    // カードに position: relative が必要（CSS で設定されていることを前提）
    // 念のため確認して設定
    const cardStyle = window.getComputedStyle(card);
    if (cardStyle.position === 'static') {
      card.style.position = 'relative';
    }

    // カードに追加
    card.appendChild(button);
    const anchored = this._placeButton(button, card);
    this.buttonMap.set(noteId, button);

    // フォルダ割り当て状態を更新
    this._updateButtonState(button, noteId);

    if (!anchored) {
      this._scheduleReposition(button, card);
    }

    return button;
  }

  /**
   * ボタン要素を作成
   * @param {string} noteId - ノートID
   * @returns {HTMLButtonElement}
   * @private
   */
  _createButton(noteId) {
    const button = document.createElement('button');
    button.className = FOLDERLM_CLASSES.ASSIGN_BUTTON;
    button.setAttribute('type', 'button');
    button.setAttribute('role', 'button');
    button.setAttribute('data-note-id', noteId);
    button.setAttribute('aria-label', 'フォルダに割り当て');
    button.setAttribute('title', 'フォルダに割り当て');
    button.setAttribute('tabindex', '0');

    // アイコン
    const icon = createIconElement('folder', 16);
    icon.classList.add('folderlm-assign-button__icon');
    button.appendChild(icon);

    // クリックイベント
    button.addEventListener('click', this._boundHandleClick);

    // キーボードイベント
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this._boundHandleClick(e);
      }
    });

    // ホバーでポップアップ位置計算のためにイベント伝播を止める
    button.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
    });

    return button;
  }

  /**
   * ボタンの配置を調整
   * @param {HTMLButtonElement} button - ボタン要素
   * @param {Element} card - ノートカード要素
   * @returns {boolean} アンカーに配置できた場合 true
   * @private
   */
  _placeButton(button, card) {
    if (!button || !card) {
      return false;
    }

    const noteId = button.getAttribute('data-note-id');
    const iconElement = this._findAnchorIcon(card, noteId);
    const host = this._resolveHost(card);
    if (!host) {
      return false;
    }

    if (button.parentElement !== host) {
      host.appendChild(button);
    }

    host.classList.add('folderlm-assign-host');

    const hostStyle = window.getComputedStyle(host);
    if (hostStyle.position === 'static') {
      host.style.position = 'relative';
    }

    if (iconElement) {
      const hostRect = host.getBoundingClientRect();
      const iconRect = iconElement.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const top = iconRect.top - hostRect.top + (iconRect.height - buttonRect.height) / 2;
      const left = iconRect.right - hostRect.left + 6;

      button.style.top = `${Math.max(0, Math.round(top))}px`;
      button.style.left = `${Math.max(0, Math.round(left))}px`;
      button.style.right = 'auto';
      button.classList.add('folderlm-assign-button--overlay');
      return true;
    }

    button.style.removeProperty('top');
    button.style.removeProperty('left');
    button.style.removeProperty('right');
    button.classList.add('folderlm-assign-button--overlay');
    return false;
  }

  /**
   * アンカーとなるアイコン要素を探す
   * @param {Element} card - ノートカード要素
   * @returns {Element|null}
   * @private
   */
  _findAnchorIcon(card, noteId) {
    let icon = null;
    if (noteId) {
      icon = card.querySelector(`#project-${noteId}-emoji`);
    }

    if (!icon) {
      icon = card.querySelector('.project-button-box-icon') ||
        card.querySelector('[id*="-emoji"]');
    }
    if (!icon) {
      return null;
    }

    if (icon.closest(`.${FOLDERLM_CLASSES.ASSIGN_BUTTON}`)) {
      return null;
    }

    return icon;
  }

  /**
   * ボタンの配置先となるホスト要素を取得
   * @param {Element} card - ノートカード要素
   * @returns {Element|null}
   * @private
   */
  _resolveHost(card) {
    const listItem = card.closest('[role="listitem"]');
    if (listItem) {
      return listItem;
    }

    if (card.tagName === 'BUTTON' && card.parentElement) {
      return card.parentElement;
    }

    return card;
  }

  /**
   * アンカー描画待ちで再配置を試行
   * @param {HTMLButtonElement} button - ボタン要素
   * @param {Element} card - ノートカード要素
   * @private
   */
  _scheduleReposition(button, card) {
    requestAnimationFrame(() => this._placeButton(button, card));
    setTimeout(() => this._placeButton(button, card), 300);
  }

  /**
   * ボタンの状態を更新
   * @param {HTMLButtonElement} button - ボタン要素
   * @param {string} noteId - ノートID
   * @private
   */
  _updateButtonState(button, noteId) {
    const folderId = storageManager.getNoteFolder(noteId);
    const isAssigned = folderId && folderId !== storageManager.UNCATEGORIZED_ID;

    if (isAssigned) {
      button.classList.add('assigned');
      const folder = storageManager.getFolder(folderId);
      button.setAttribute('title', folder ? `フォルダ: ${folder.name}` : 'フォルダに割り当て済み');
      button.setAttribute('aria-label', folder ? `フォルダ「${folder.name}」に割り当て済み` : 'フォルダに割り当て済み');
    } else {
      button.classList.remove('assigned');
      button.setAttribute('title', 'フォルダに割り当て');
      button.setAttribute('aria-label', 'フォルダに割り当て');
    }
  }

  /**
   * ノートカードからボタンを削除
   * @param {string} noteId - ノートID
   */
  removeFromCard(noteId) {
    const button = this.buttonMap.get(noteId);
    if (button) {
      button.removeEventListener('click', this._boundHandleClick);
      button.remove();
      this.buttonMap.delete(noteId);
    }
  }

  /**
   * すべてのボタンを削除
   */
  removeAll() {
    for (const [noteId, button] of this.buttonMap) {
      button.removeEventListener('click', this._boundHandleClick);
      button.remove();
    }
    this.buttonMap.clear();
  }

  /**
   * 特定のノートの状態を更新
   * @param {string} noteId - ノートID
   */
  updateState(noteId) {
    const button = this.buttonMap.get(noteId);
    if (button) {
      this._updateButtonState(button, noteId);
    }
  }

  /**
   * すべてのボタンの状態を更新
   */
  updateAllStates() {
    for (const [noteId, button] of this.buttonMap) {
      this._updateButtonState(button, noteId);
    }
  }

  /**
   * クリックイベントのコールバックを設定
   * @param {Function} callback - (noteId: string, buttonElement: HTMLButtonElement) => void
   */
  onClick(callback) {
    this._onClick = callback;
  }

  /**
   * クリックイベントハンドラ
   * @param {MouseEvent} event
   * @private
   */
  _handleClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const noteId = button.getAttribute('data-note-id');

    if (noteId && this._onClick) {
      this._onClick(noteId, button);
    }
  }

  /**
   * ノートIDからボタン要素を取得
   * @param {string} noteId - ノートID
   * @returns {HTMLButtonElement|null}
   */
  getButton(noteId) {
    return this.buttonMap.get(noteId) || null;
  }

  /**
   * ボタン数を取得
   * @returns {number}
   */
  get count() {
    return this.buttonMap.size;
  }

  /**
   * 破棄
   */
  destroy() {
    this.removeAll();
    this._onClick = null;
  }
}

// シングルトンインスタンスをエクスポート
export const noteAssignButton = new NoteAssignButton();

// デフォルトエクスポート
export default noteAssignButton;
