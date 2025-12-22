/**
 * FolderLM - Filter Manager
 *
 * フォルダフィルタの状態管理とノート一覧へのフィルタ適用を担当。
 * NotebookLM の標準フィルタと AND 条件で併用する。
 *
 * @module content/core/filterManager
 */

import { FOLDERLM_CLASSES, FILTER_SELECTORS, NOTE_SELECTORS } from '../utils/selectors.js';
import { storageManager } from '../../storage/storageManager.js';
import { noteDetector } from './noteDetector.js';
import { batchWithRAF } from '../utils/debounce.js';

/**
 * フィルタ状態の型定義
 * @typedef {Object} FilterState
 * @property {string|null} selectedFolderId - 選択中のフォルダID（null = すべて表示）
 * @property {boolean} isActive - FolderLM フィルタが有効かどうか
 */

/**
 * FilterManager クラス
 * フォルダによるノートフィルタリングを管理
 */
class FilterManager {
  constructor() {
    /**
     * 現在選択中のフォルダID
     * null の場合は「すべて」（FolderLM フィルタ無効）
     * @type {string|null}
     */
    this._selectedFolderId = null;

    /**
     * フィルタ変更リスナー
     * @type {Function[]}
     */
    this._changeListeners = [];

    /**
     * NotebookLM 標準フィルタの監視用 Observer
     * @type {MutationObserver|null}
     */
    this._filterObserver = null;

    /**
     * 最後に検出した NotebookLM 標準フィルタの状態
     * @type {string|null}
     */
    this._lastNotebookLMFilter = null;

    /**
     * フィルタ適用のバッチ処理
     */
    this._batchedApply = batchWithRAF(() => this._performFilter());

    /**
     * 検索クエリ
     * @type {string}
     */
    this._searchQuery = '';
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * フィルタマネージャーを初期化
   */
  initialize() {
    // NotebookLM 標準フィルタの監視を開始
    this._startObservingNotebookLMFilter();

    console.log('[FolderLM FilterManager] Initialized');
  }

  /**
   * 現在選択中のフォルダIDを取得
   * @returns {string|null}
   */
  getSelectedFolderId() {
    return this._selectedFolderId;
  }

  /**
   * フォルダを選択してフィルタを適用
   * @param {string|null} folderId - フォルダID（null で「すべて」= フィルタ解除）
   */
  selectFolder(folderId) {
    const previousId = this._selectedFolderId;

    // 同じフォルダの場合は何もしない
    if (previousId === folderId) {
      return;
    }

    this._selectedFolderId = folderId;

    // フィルタを適用
    this._batchedApply();

    // 変更を通知
    this._notifyChange({
      type: 'folder_selected',
      previousFolderId: previousId,
      currentFolderId: folderId,
    });

    console.log(`[FolderLM FilterManager] Folder selected: ${folderId || 'all'}`);
  }

  /**
   * FolderLM フィルタを解除（「すべて」を選択）
   */
  clearFilter() {
    this.selectFolder(null);
  }

  /**
   * FolderLM フィルタが有効かどうか
   * @returns {boolean}
   */
  isFilterActive() {
    return this._selectedFolderId !== null;
  }

  /**
   * 検索フィルタが有効かどうか
   * @returns {boolean}
   */
  isSearchActive() {
    return this._searchQuery.trim().length > 0;
  }

  /**
   * フィルタを再適用（DOM 変更後など）
   */
  reapplyFilter() {
    if (this.isFilterActive() || this.isSearchActive()) {
      this._batchedApply();
    }
  }

  /**
   * 特定のノートがフィルタ条件に一致するか確認
   * @param {string} noteId - ノートID
   * @returns {boolean} フィルタ条件に一致する場合 true
   */
  matchesFilter(noteId) {
    // FolderLM フィルタが無効な場合は常に true
    if (!this.isFilterActive()) {
      return true;
    }

    const assignedFolderId = storageManager.getNoteFolder(noteId);
    const isUncategorized = !assignedFolderId || assignedFolderId === storageManager.UNCATEGORIZED_ID;

    if (this._selectedFolderId === storageManager.UNCATEGORIZED_ID) {
      // 未分類フィルタ: 未割り当てまたは未分類に割り当てられたノート
      return isUncategorized;
    }

    // 特定フォルダフィルタ: そのフォルダに割り当てられたノートのみ
    return assignedFolderId === this._selectedFolderId;
  }

  /**
   * 検索クエリを設定してフィルタを適用
   * @param {string} query
   */
  setSearchQuery(query) {
    const nextQuery = typeof query === 'string' ? query : '';
    if (this._searchQuery === nextQuery) {
      return;
    }

    this._searchQuery = nextQuery;
    this._batchedApply();

    this._notifyChange({
      type: 'search_changed',
      searchQuery: this._searchQuery,
    });
  }

  /**
   * 現在の検索クエリを取得
   * @returns {string}
   */
  getSearchQuery() {
    return this._searchQuery;
  }

  /**
   * 検索クエリをクリア
   */
  clearSearch() {
    this.setSearchQuery('');
  }

  /**
   * フィルタ変更リスナーを追加
   * @param {Function} listener - (event: { type: string, ... }) => void
   */
  onChange(listener) {
    if (typeof listener === 'function') {
      this._changeListeners.push(listener);
    }
  }

  /**
   * フィルタ変更リスナーを削除
   * @param {Function} listener
   */
  offChange(listener) {
    this._changeListeners = this._changeListeners.filter(l => l !== listener);
  }

  /**
   * フィルタマネージャーを破棄
   */
  destroy() {
    this._stopObservingNotebookLMFilter();
    this._changeListeners = [];
    this._selectedFolderId = null;
    this._searchQuery = '';
    this._batchedApply.cancel();
  }

  // ==========================================================================
  // 検索フィルタ
  // ==========================================================================

  /**
   * 検索条件に一致するか確認
   * @param {Element} card - ノートカード要素
   * @param {string} noteId - ノートID
   * @param {string} searchQuery - 小文字化済み検索クエリ
   * @returns {boolean}
   * @private
   */
  _matchesSearchFilter(card, noteId, searchQuery) {
    if (!searchQuery) {
      return true;
    }

    const title = this._extractNoteTitle(card, noteId);
    if (!title) {
      return false;
    }

    return title.toLowerCase().includes(searchQuery);
  }

  /**
   * ノートタイトルを抽出
   * @param {Element} card - ノートカード要素
   * @param {string} noteId - ノートID
   * @returns {string}
   * @private
   */
  _extractNoteTitle(card, noteId) {
    if (!card) {
      return '';
    }

    let titleElement = null;

    if (noteId) {
      const titleId = `project-${noteId}-title`;
      if (window.CSS && CSS.escape) {
        const escaped = CSS.escape(titleId);
        titleElement = card.querySelector(`#${escaped}`) || document.getElementById(titleId);
      } else {
        titleElement = document.getElementById(titleId);
      }
    }

    if (!titleElement) {
      titleElement = card.querySelector(NOTE_SELECTORS.CARD_TITLE);
    }

    if (!titleElement) {
      const labelledBy = card.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelId = labelledBy
          .split(/\s+/)
          .find(id => id.includes('project-') && id.endsWith('-title'));
        if (labelId) {
          titleElement = document.getElementById(labelId);
        }
      }
    }

    return titleElement?.textContent?.trim() || '';
  }

  // ==========================================================================
  // フィルタ適用
  // ==========================================================================

  /**
   * フィルタを実行（内部用）
   * @private
   */
  _performFilter() {
    const noteIds = noteDetector.getAllNoteIds();
    const searchQuery = this._searchQuery.trim().toLowerCase();

    let visibleCount = 0;
    let hiddenCount = 0;

    for (const noteId of noteIds) {
      const card = noteDetector.getCardByNoteId(noteId);
      if (!card) continue;

      // FolderLM のフィルタ条件を判定
      const matchesFolderFilter = this.matchesFilter(noteId);

      // 検索フィルタ（ノートタイトルのみ）
      const matchesSearchFilter = this._matchesSearchFilter(card, noteId, searchQuery);

      // NotebookLM 標準フィルタの状態を確認
      // NotebookLM が非表示にしている場合は、FolderLM でも非表示を維持
      const isHiddenByNotebookLM = this._isHiddenByNotebookLM(card);

      // AND 条件: すべてのフィルタを通過した場合のみ表示
      const shouldShow = matchesFolderFilter && matchesSearchFilter && !isHiddenByNotebookLM;

      if (shouldShow) {
        card.classList.remove(FOLDERLM_CLASSES.HIDDEN);
        visibleCount++;
      } else {
        card.classList.add(FOLDERLM_CLASSES.HIDDEN);
        hiddenCount++;
      }
    }

    console.log(`[FolderLM FilterManager] Filter applied: ${visibleCount} visible, ${hiddenCount} hidden`);
  }

  /**
   * NotebookLM 標準フィルタで非表示になっているか確認
   * @param {Element} card - ノートカード要素
   * @returns {boolean}
   * @private
   */
  _isHiddenByNotebookLM(card) {
    // NotebookLM が独自に追加する非表示クラスやスタイルを確認
    // NotebookLM の実装によって異なる可能性があるため、複数のパターンをチェック

    // 1. display: none がインラインスタイルで設定されている場合
    if (card.style.display === 'none') {
      return true;
    }

    // 2. NotebookLM が使用する可能性のある非表示クラス
    // （FolderLM のクラスは除外）
    const hiddenClasses = ['hidden', 'ng-hide', 'mat-hidden'];
    for (const cls of hiddenClasses) {
      if (card.classList.contains(cls)) {
        return true;
      }
    }

    // 3. visibility: hidden の場合
    const computedStyle = window.getComputedStyle(card);
    if (computedStyle.visibility === 'hidden') {
      return true;
    }

    return false;
  }

  // ==========================================================================
  // NotebookLM 標準フィルタの監視
  // ==========================================================================

  /**
   * NotebookLM 標準フィルタの監視を開始
   * @private
   */
  _startObservingNotebookLMFilter() {
    // フィルタボタンを見つける
    const filterContainer = document.querySelector(FILTER_SELECTORS.ACTIVE_FILTER)?.parentElement;

    if (!filterContainer) {
      console.log('[FolderLM FilterManager] NotebookLM filter container not found, skipping observation');
      return;
    }

    this._filterObserver = new MutationObserver((mutations) => {
      // フィルタ状態の変更を検出
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'aria-selected' ||
            mutation.attributeName === 'class')
        ) {
          this._onNotebookLMFilterChange();
          break;
        }
      }
    });

    this._filterObserver.observe(filterContainer, {
      attributes: true,
      subtree: true,
      attributeFilter: ['aria-selected', 'class'],
    });

    console.log('[FolderLM FilterManager] Started observing NotebookLM filter');
  }

  /**
   * NotebookLM 標準フィルタの監視を停止
   * @private
   */
  _stopObservingNotebookLMFilter() {
    if (this._filterObserver) {
      this._filterObserver.disconnect();
      this._filterObserver = null;
    }
  }

  /**
   * NotebookLM 標準フィルタが変更された時の処理
   * @private
   */
  _onNotebookLMFilterChange() {
    // 現在のフィルタ状態を取得
    const currentFilter = this._detectNotebookLMFilter();

    // 前回と同じなら何もしない
    if (currentFilter === this._lastNotebookLMFilter) {
      return;
    }

    this._lastNotebookLMFilter = currentFilter;

    console.log(`[FolderLM FilterManager] NotebookLM filter changed to: ${currentFilter}`);

    // FolderLM フィルタまたは検索が有効な場合は再適用
    // NotebookLM のフィルタ変更後に DOM が更新されるのを待つ
    if (this.isFilterActive() || this.isSearchActive()) {
      setTimeout(() => {
        this._batchedApply();
      }, 100);
    }

    // 変更を通知
    this._notifyChange({
      type: 'notebooklm_filter_changed',
      filter: currentFilter,
    });
  }

  /**
   * 現在の NotebookLM 標準フィルタを検出
   * @returns {string|null} 'all' | 'owned' | 'shared' | null
   * @private
   */
  _detectNotebookLMFilter() {
    // アクティブなフィルタタブを検索
    const activeFilter = document.querySelector(FILTER_SELECTORS.ACTIVE_FILTER);

    if (!activeFilter) {
      return null;
    }

    // aria-label や data-tab 属性から判断
    const ariaLabel = activeFilter.getAttribute('aria-label') || '';
    const dataTab = activeFilter.getAttribute('data-tab');

    if (dataTab) {
      return dataTab;
    }

    // aria-label から推測
    if (ariaLabel.includes('すべて') || ariaLabel.toLowerCase().includes('all')) {
      return 'all';
    }
    if (ariaLabel.includes('マイ') || ariaLabel.toLowerCase().includes('my') || ariaLabel.toLowerCase().includes('owned')) {
      return 'owned';
    }
    if (ariaLabel.includes('共有') || ariaLabel.toLowerCase().includes('shared')) {
      return 'shared';
    }

    return null;
  }

  // ==========================================================================
  // イベント通知
  // ==========================================================================

  /**
   * 変更を通知
   * @param {Object} event - イベントオブジェクト
   * @private
   */
  _notifyChange(event) {
    const fullEvent = {
      ...event,
      timestamp: Date.now(),
      selectedFolderId: this._selectedFolderId,
      isFilterActive: this.isFilterActive(),
      searchQuery: this._searchQuery,
    };

    for (const listener of this._changeListeners) {
      try {
        listener(fullEvent);
      } catch (e) {
        console.error('[FolderLM FilterManager] Change listener error:', e);
      }
    }
  }

  // ==========================================================================
  // デバッグ
  // ==========================================================================

  /**
   * デバッグ情報を出力
   * @returns {Object}
   */
  debug() {
    const info = {
      selectedFolderId: this._selectedFolderId,
      isFilterActive: this.isFilterActive(),
      searchQuery: this._searchQuery,
      notebookLMFilter: this._detectNotebookLMFilter(),
      visibleNotes: 0,
      hiddenNotes: 0,
    };

    // 表示/非表示のノート数をカウント
    const noteIds = noteDetector.getAllNoteIds();
    for (const noteId of noteIds) {
      const card = noteDetector.getCardByNoteId(noteId);
      if (card) {
        if (card.classList.contains(FOLDERLM_CLASSES.HIDDEN)) {
          info.hiddenNotes++;
        } else {
          info.visibleNotes++;
        }
      }
    }

    console.group('[FolderLM FilterManager] Debug Info');
    console.log('Selected folder:', info.selectedFolderId || 'all');
    console.log('Filter active:', info.isFilterActive);
    console.log('Search query:', info.searchQuery);
    console.log('NotebookLM filter:', info.notebookLMFilter);
    console.log('Visible notes:', info.visibleNotes);
    console.log('Hidden notes:', info.hiddenNotes);
    console.groupEnd();

    return info;
  }
}

/**
 * シングルトンインスタンス
 */
export const filterManager = new FilterManager();

/**
 * デフォルトエクスポート
 */
export default filterManager;
