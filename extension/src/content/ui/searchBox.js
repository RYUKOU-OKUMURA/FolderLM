/**
 * FolderLM - Search Box Component
 *
 * ヘッダーのアクションバーに挿入する検索ボックスコンポーネント。
 * ノートタイトルの検索に使用する。
 *
 * @module ui/searchBox
 */

import { FOLDERLM_CLASSES, UI_INJECTION_SELECTORS, findFirstMatch } from '../utils/selectors.js';
import { debounce } from '../utils/debounce.js';

/**
 * 検索ボックスコンポーネント
 */
class SearchBox {
  constructor() {
    /** @type {HTMLElement|null} */
    this._element = null;

    /** @type {HTMLInputElement|null} */
    this._inputElement = null;

    /** @type {HTMLButtonElement|null} */
    this._clearButton = null;

    /** @type {Function|null} */
    this._onQueryChange = null;

    this._debouncedEmit = debounce((value) => {
      if (this._onQueryChange) {
        this._onQueryChange(value);
      }
    }, 150);

    this._boundHandleInput = this._handleInput.bind(this);
    this._boundHandleKeydown = this._handleKeydown.bind(this);
    this._boundHandleClear = this._handleClear.bind(this);
  }

  /**
   * 検索ボックスを作成して DOM に挿入
   * @param {HTMLElement|null} [anchorElement] - 挿入基準となる要素（フォルダボタン）
   * @returns {HTMLElement|null}
   */
  create(anchorElement = null) {
    if (this._element && document.contains(this._element)) {
      return this._element;
    }

    const existing = document.querySelector(`.${FOLDERLM_CLASSES.SEARCH_BOX}`);
    if (existing) {
      this._element = existing;
      this._inputElement = existing.querySelector(`.${FOLDERLM_CLASSES.SEARCH_INPUT}`);
      this._clearButton = existing.querySelector(`.${FOLDERLM_CLASSES.SEARCH_CLEAR}`);
      this._attachEvents();
      this._updateClearButton();
      return this._element;
    }

    const actionBar = findFirstMatch(
      UI_INJECTION_SELECTORS.ACTION_BAR,
      UI_INJECTION_SELECTORS.ACTION_BAR_FALLBACK
    );

    if (!actionBar) {
      console.warn('[FolderLM] Action bar not found, cannot inject search box');
      return null;
    }

    const container = document.createElement('div');
    container.className = FOLDERLM_CLASSES.SEARCH_BOX;

    const input = document.createElement('input');
    input.className = FOLDERLM_CLASSES.SEARCH_INPUT;
    input.type = 'text';
    input.placeholder = 'ノートを検索...';
    input.setAttribute('aria-label', 'ノートを検索');
    input.setAttribute('autocomplete', 'off');
    container.appendChild(input);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = FOLDERLM_CLASSES.SEARCH_CLEAR;
    clearButton.textContent = '×';
    clearButton.setAttribute('aria-label', '検索をクリア');
    clearButton.hidden = true;
    container.appendChild(clearButton);

    if (anchorElement && anchorElement.parentElement) {
      anchorElement.insertAdjacentElement('afterend', container);
    } else {
      const filterGroup = findFirstMatch(UI_INJECTION_SELECTORS.FILTER_GROUP);
      if (filterGroup && filterGroup.parentElement) {
        filterGroup.parentElement.insertBefore(container, filterGroup.nextSibling);
      } else {
        actionBar.appendChild(container);
      }
    }

    this._element = container;
    this._inputElement = input;
    this._clearButton = clearButton;
    this._attachEvents();
    this._updateClearButton();

    console.log('[FolderLM] Search box created');
    return container;
  }

  /**
   * 検索ボックスを再挿入
   * @param {HTMLElement|null} [anchorElement]
   */
  reinject(anchorElement = null) {
    if (!this._element || !this._element.isConnected) {
      this.create(anchorElement);
      return;
    }

    if (anchorElement && this._element.previousElementSibling !== anchorElement) {
      anchorElement.insertAdjacentElement('afterend', this._element);
    }
  }

  /**
   * クエリ変更時のコールバックを設定
   * @param {Function} callback - (query: string) => void
   */
  onQueryChange(callback) {
    this._onQueryChange = callback;
  }

  /**
   * 検索クエリを設定
   * @param {string} query
   * @param {Object} [options]
   * @param {boolean} [options.emit=false]
   */
  setQuery(query, { emit = false } = {}) {
    if (!this._inputElement) {
      return;
    }

    const nextQuery = typeof query === 'string' ? query : '';
    this._inputElement.value = nextQuery;
    this._updateClearButton();

    if (emit) {
      this._emitChange(nextQuery, true);
    }
  }

  /**
   * クエリを取得
   * @returns {string}
   */
  getQuery() {
    return this._inputElement ? this._inputElement.value : '';
  }

  /**
   * 検索をクリア
   * @param {Object} [options]
   * @param {boolean} [options.focus=false]
   */
  clear({ focus = false } = {}) {
    if (!this._inputElement) {
      return;
    }

    this._inputElement.value = '';
    this._updateClearButton();
    this._emitChange('', true);

    if (focus) {
      this._inputElement.focus();
    }
  }

  /**
   * コンポーネントを破棄
   */
  destroy() {
    this._detachEvents();
    this._debouncedEmit.cancel();

    if (this._element) {
      this._element.remove();
    }

    this._element = null;
    this._inputElement = null;
    this._clearButton = null;
    this._onQueryChange = null;
  }

  /**
   * 要素を取得
   * @returns {HTMLElement|null}
   */
  getElement() {
    return this._element;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  _attachEvents() {
    if (!this._inputElement || !this._clearButton) {
      return;
    }

    this._inputElement.removeEventListener('input', this._boundHandleInput);
    this._inputElement.removeEventListener('keydown', this._boundHandleKeydown);
    this._clearButton.removeEventListener('click', this._boundHandleClear);

    this._inputElement.addEventListener('input', this._boundHandleInput);
    this._inputElement.addEventListener('keydown', this._boundHandleKeydown);
    this._clearButton.addEventListener('click', this._boundHandleClear);
  }

  _detachEvents() {
    if (!this._inputElement || !this._clearButton) {
      return;
    }

    this._inputElement.removeEventListener('input', this._boundHandleInput);
    this._inputElement.removeEventListener('keydown', this._boundHandleKeydown);
    this._clearButton.removeEventListener('click', this._boundHandleClear);
  }

  _handleInput() {
    this._updateClearButton();
    this._emitChange(this.getQuery(), false);
  }

  _handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.clear({ focus: true });
    }
  }

  _handleClear(event) {
    event.preventDefault();
    event.stopPropagation();
    this.clear({ focus: true });
  }

  _emitChange(query, immediate) {
    if (immediate) {
      this._debouncedEmit.cancel();
      if (this._onQueryChange) {
        this._onQueryChange(query);
      }
      return;
    }

    this._debouncedEmit(query);
  }

  _updateClearButton() {
    if (!this._clearButton || !this._inputElement) {
      return;
    }

    const hasValue = this._inputElement.value.length > 0;
    this._clearButton.hidden = !hasValue;
  }
}

// シングルトンインスタンス
export const searchBox = new SearchBox();

// デフォルトエクスポート
export default searchBox;
