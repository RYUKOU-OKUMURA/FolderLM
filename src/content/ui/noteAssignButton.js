/**
 * FolderLM - Note Assign Button Component
 * 
 * ノートカードに挿入するフォルダ割り当てボタンコンポーネント。
 * ホバー時に表示され、クリックでフォルダ選択ポップアップを開く。
 * 
 * @module ui/noteAssignButton
 */

import { FOLDERLM_CLASSES, DATA_ATTRIBUTES } from '../utils/selectors.js';
import { storageManager } from '../../storage/storageManager.js';

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
      this._updateButtonState(existingButton, noteId);
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
    this.buttonMap.set(noteId, button);

    // フォルダ割り当て状態を更新
    this._updateButtonState(button, noteId);

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
    button.setAttribute('data-note-id', noteId);
    button.setAttribute('aria-label', 'フォルダに割り当て');
    button.setAttribute('title', 'フォルダに割り当て');

    // アイコン
    const icon = document.createElement('span');
    icon.className = 'folderlm-assign-button__icon';
    icon.textContent = '📁';
    icon.setAttribute('aria-hidden', 'true');
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
