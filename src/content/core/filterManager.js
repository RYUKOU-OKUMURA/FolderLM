/**
 * FolderLM - Filter Manager
 * 
 * フォルダフィルタの状態管理とノート一覧へのフィルタ適用を担当。
 * NotebookLM の標準フィルタと AND 条件で併用する。
 * 
 * @module content/core/filterManager
 */

import { FOLDERLM_CLASSES, FILTER_SELECTORS, VIEW_MODES, DATA_ATTRIBUTES, NOTE_SELECTORS } from '../utils/selectors.js';
import { storageManager } from '../../storage/storageManager.js';
import { noteDetector } from './noteDetector.js';
import { batchWithRAF } from '../utils/debounce.js';

/**
 * フィルタ状態の型定義
 * @typedef {Object} FilterState
 * @property {string|null} selectedFolderId - 選択中のフォルダID（null = すべて表示）
 * @property {boolean} isActive - FolderLM フィルタが有効かどうか
 * @property {string} viewMode - 表示モード（'filter' | 'sort' | 'group'）
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
     * 現在の表示モード
     * storageManager から復元されるまではデフォルト値を使用
     * @type {string}
     */
    this._viewMode = VIEW_MODES.FILTER;

    /**
     * 元の DOM 順序インデックスが初期化済みかどうか
     * @type {boolean}
     */
    this._originalIndexInitialized = false;

    /**
     * viewMode 適用のバッチ処理
     */
    this._batchedApplyViewMode = batchWithRAF(() => this._performApplyViewMode());
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * フィルタマネージャーを初期化
   * @param {Object} [options] - 初期化オプション
   * @param {string} [options.viewMode] - 初期表示モード（storageManager から復元された値）
   */
  initialize(options = {}) {
    // NotebookLM 標準フィルタの監視を開始
    this._startObservingNotebookLMFilter();

    // viewMode を復元（storageManager.load() 完了後に呼び出される想定）
    if (options.viewMode && Object.values(VIEW_MODES).includes(options.viewMode)) {
      this._viewMode = options.viewMode;
      console.log(`[FolderLM FilterManager] viewMode restored from settings: ${this._viewMode}`);
    }
    
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

    // viewMode を適用（filter 以外の場合）
    if (this._viewMode !== VIEW_MODES.FILTER) {
      this._batchedApplyViewMode();
    }

    // 変更を通知
    this._notifyChange({
      type: 'folder_selected',
      previousFolderId: previousId,
      currentFolderId: folderId,
      viewMode: this._viewMode,
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
   * フィルタを再適用（DOM 変更後など）
   */
  reapplyFilter() {
    if (this.isFilterActive()) {
      this._batchedApply();
    }
    // viewMode も再適用
    if (this._viewMode !== VIEW_MODES.FILTER) {
      this._batchedApplyViewMode();
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
    this._viewMode = VIEW_MODES.FILTER;
    this._originalIndexInitialized = false;
    this._clearViewModeState();
  }

  // ==========================================================================
  // viewMode 管理
  // ==========================================================================

  /**
   * 現在の表示モードを取得
   * @returns {string} 'filter' | 'sort' | 'group'
   */
  getViewMode() {
    return this._viewMode;
  }

  /**
   * 表示モードを変更して適用
   * @param {string} mode - 'filter' | 'sort' | 'group'
   * @returns {boolean} 成功した場合 true
   */
  setViewMode(mode) {
    if (!Object.values(VIEW_MODES).includes(mode)) {
      console.warn(`[FolderLM FilterManager] Invalid viewMode: ${mode}`);
      return false;
    }

    const previousMode = this._viewMode;
    if (previousMode === mode) {
      return true;
    }

    this._viewMode = mode;

    // storageManager に保存
    storageManager.setViewMode(mode);

    // viewMode を適用
    this._batchedApplyViewMode();

    // 変更を通知
    this._notifyChange({
      type: 'viewmode_changed',
      previousViewMode: previousMode,
      currentViewMode: mode,
    });

    console.log(`[FolderLM FilterManager] viewMode changed: ${previousMode} -> ${mode}`);
    return true;
  }

  /**
   * 表示モードを適用（外部からの呼び出し用）
   * domRecoveryManager からの復帰時に使用
   */
  applyViewMode() {
    this._batchedApplyViewMode();
  }

  /**
   * viewMode の実際の適用処理
   * @private
   */
  _performApplyViewMode() {
    // 元の DOM 順序インデックスを初期化（必要な場合）
    this._initializeOriginalIndices();

    switch (this._viewMode) {
      case VIEW_MODES.FILTER:
        // filter モード: 並び替えなし、フィルタのみ
        this._clearViewModeState();
        break;

      case VIEW_MODES.SORT:
        // sort モード: フォルダ順に並び替え、ヘッダーなし
        // Phase 2 で実装予定
        console.log('[FolderLM FilterManager] sort mode - will be implemented in Phase 2');
        break;

      case VIEW_MODES.GROUP:
        // group モード: フォルダ順に並び替え + グループヘッダー
        // 「すべて」選択時のみ有効
        // Phase 3 で実装予定
        console.log('[FolderLM FilterManager] group mode - will be implemented in Phase 3');
        break;

      default:
        console.warn(`[FolderLM FilterManager] Unknown viewMode: ${this._viewMode}`);
    }
  }

  /**
   * viewMode の状態をクリア（filter モードに戻す時）
   * @private
   */
  _clearViewModeState() {
    // CSS order をリセット
    const container = document.querySelector(NOTE_SELECTORS.LIST_CONTAINER);
    if (container) {
      const cards = container.querySelectorAll(`[${DATA_ATTRIBUTES.ORDER}]`);
      cards.forEach(card => {
        card.style.order = '';
        card.removeAttribute(DATA_ATTRIBUTES.ORDER);
        card.classList.remove(FOLDERLM_CLASSES.SORTED);
        card.classList.remove(FOLDERLM_CLASSES.GROUPED);
      });
    }

    // グループヘッダーを削除
    const headers = document.querySelectorAll(`.${FOLDERLM_CLASSES.GROUP_HEADER}`);
    headers.forEach(header => header.remove());

    console.log('[FolderLM FilterManager] viewMode state cleared');
  }

  // ==========================================================================
  // 元の DOM 順序インデックス管理
  // ==========================================================================

  /**
   * 元の DOM 順序インデックスを初期化
   * スキャン時の元の位置を記録し、安定ソートに使用
   * @private
   */
  _initializeOriginalIndices() {
    const container = document.querySelector(NOTE_SELECTORS.LIST_CONTAINER);
    if (!container) {
      console.warn('[FolderLM FilterManager] List container not found');
      return;
    }

    const noteIds = noteDetector.getAllNoteIds();
    let index = 0;

    for (const noteId of noteIds) {
      const card = noteDetector.getCardByNoteId(noteId);
      if (card) {
        // 既にインデックスがある場合はスキップ（再スキャン時に保持）
        if (!this._originalIndexInitialized || !card.hasAttribute(DATA_ATTRIBUTES.ORIGINAL_INDEX)) {
          card.setAttribute(DATA_ATTRIBUTES.ORIGINAL_INDEX, String(index));
          card.classList.add(FOLDERLM_CLASSES.HAS_ORIGINAL_INDEX);
        }
        index++;
      }
    }

    this._originalIndexInitialized = true;
    console.log(`[FolderLM FilterManager] Original indices initialized for ${index} cards`);
  }

  /**
   * 元の DOM 順序インデックスをリセット
   * DOM が大きく変更された時（仲間化リレンダリングなど）に呼び出す
   */
  resetOriginalIndices() {
    const cards = document.querySelectorAll(`[${DATA_ATTRIBUTES.ORIGINAL_INDEX}]`);
    cards.forEach(card => {
      card.removeAttribute(DATA_ATTRIBUTES.ORIGINAL_INDEX);
      card.classList.remove(FOLDERLM_CLASSES.HAS_ORIGINAL_INDEX);
    });

    this._originalIndexInitialized = false;
    console.log('[FolderLM FilterManager] Original indices reset');
  }

  /**
   * カードの元のインデックスを取得
   * @param {Element} card - ノートカード要素
   * @returns {number} インデックス（取得できない場合は Infinity）
   */
  getOriginalIndex(card) {
    const indexStr = card.getAttribute(DATA_ATTRIBUTES.ORIGINAL_INDEX);
    if (indexStr !== null) {
      const index = parseInt(indexStr, 10);
      return isNaN(index) ? Infinity : index;
    }
    return Infinity;
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
    const folderId = this._selectedFolderId;

    let visibleCount = 0;
    let hiddenCount = 0;

    for (const noteId of noteIds) {
      const card = noteDetector.getCardByNoteId(noteId);
      if (!card) continue;

      // FolderLM のフィルタ条件を判定
      const matchesFolderFilter = this.matchesFilter(noteId);

      // NotebookLM 標準フィルタの状態を確認
      // NotebookLM が非表示にしている場合は、FolderLM でも非表示を維持
      const isHiddenByNotebookLM = this._isHiddenByNotebookLM(card);

      // AND 条件: 両方のフィルタを通過した場合のみ表示
      const shouldShow = matchesFolderFilter && !isHiddenByNotebookLM;

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

    // 4. 親要素が非表示の場合（ただし FolderLM の非表示は除外）
    // これは重い処理なので、必要な場合のみ有効化
    // const parent = card.parentElement;
    // if (parent && parent.style.display === 'none') {
    //   return true;
    // }

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
        if (mutation.type === 'attributes' && 
            (mutation.attributeName === 'aria-selected' || 
             mutation.attributeName === 'class')) {
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

    // FolderLM フィルタが有効な場合は再適用
    // NotebookLM のフィルタ変更後に DOM が更新されるのを待つ
    if (this.isFilterActive()) {
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
      viewMode: this._viewMode,
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
      viewMode: this._viewMode,
      originalIndexInitialized: this._originalIndexInitialized,
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
    console.log('View mode:', info.viewMode);
    console.log('Original index initialized:', info.originalIndexInitialized);
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
