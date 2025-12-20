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

    /**
     * グループモード失敗カウント（フォールバック判定用）
     * @type {number}
     */
    this._groupModeFailureCount = 0;

    /**
     * グループモード失敗しきい値
     * @type {number}
     */
    this._groupModeFailureThreshold = 3;
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
   * viewMode の復帰が必要かどうかをチェック
   * domRecoveryManager から呼び出される
   * @returns {boolean} 復帰が必要な場合 true
   */
  checkViewModeRecoveryNeeded() {
    // filter モードの場合は復帰不要
    if (this._viewMode === VIEW_MODES.FILTER) {
      return false;
    }

    const container = document.querySelector(NOTE_SELECTORS.LIST_CONTAINER);
    if (!container) {
      return false;
    }

    // sort モードのチェック
    if (this._viewMode === VIEW_MODES.SORT) {
      return this._checkSortRecoveryNeeded(container);
    }

    // group モードのチェック
    if (this._viewMode === VIEW_MODES.GROUP) {
      return this._checkGroupRecoveryNeeded(container);
    }

    return false;
  }

  /**
   * sort モードの復帰が必要かチェック
   * @param {Element} container
   * @returns {boolean}
   * @private
   */
  _checkSortRecoveryNeeded(container) {
    // ソート済みカードの数を確認
    const sortedCards = container.querySelectorAll(`.${FOLDERLM_CLASSES.SORTED}`);
    const allCards = container.querySelectorAll(NOTE_SELECTORS.CARD);

    // カードが存在するのにソート済みカードがない場合は復帰が必要
    if (allCards.length > 0 && sortedCards.length === 0) {
      console.log('[FolderLM FilterManager] Sort recovery needed: no sorted cards found');
      return true;
    }

    // ソート済みカードの order 属性が消えている場合
    const orderSupported = this._isOrderSupported(container);
    if (orderSupported) {
      const cardWithoutOrder = Array.from(sortedCards).find(
        card => !card.style.order && !card.getAttribute(DATA_ATTRIBUTES.ORDER)
      );
      if (cardWithoutOrder) {
        console.log('[FolderLM FilterManager] Sort recovery needed: order attribute missing');
        return true;
      }
    }

    return false;
  }

  /**
   * group モードの復帰が必要かチェック
   * @param {Element} container
   * @returns {boolean}
   * @private
   */
  _checkGroupRecoveryNeeded(container) {
    // 「すべて」選択時のみグループヘッダーをチェック
    if (!this.isFilterActive()) {
      const groupHeaders = container.querySelectorAll(`.${FOLDERLM_CLASSES.GROUP_HEADER}`);
      const groupedCards = container.querySelectorAll(`.${FOLDERLM_CLASSES.GROUPED}`);
      const allCards = container.querySelectorAll(NOTE_SELECTORS.CARD);

      // カードが存在するのにグループヘッダーがない場合は復帰が必要
      if (allCards.length > 0 && groupHeaders.length === 0) {
        console.log('[FolderLM FilterManager] Group recovery needed: no group headers found');
        return true;
      }

      // グループ化済みカードがない場合
      if (allCards.length > 0 && groupedCards.length === 0) {
        console.log('[FolderLM FilterManager] Group recovery needed: no grouped cards found');
        return true;
      }
    }

    // フィルタ適用時は sort モードと同様のチェック
    return this._checkSortRecoveryNeeded(container);
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
        this._sortByFolder();
        break;

      case VIEW_MODES.GROUP:
        // group モード: フォルダ順に並び替え + グループヘッダー
        // 「すべて」選択時のみ有効
        // フォールバック付きで実行
        this._groupByFolderWithFallback();
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
    // グループ状態をクリア（グループヘッダー削除 + グループ化クラス削除）
    // _clearSortState より先に実行（DOM 順序復元前にヘッダーを削除）
    this._clearGroupHeaders();

    // ソート状態をクリア（CSS order リセット + DOM 順序復元）
    this._clearSortState();

    console.log('[FolderLM FilterManager] viewMode state cleared');
  }

  /**
   * グループモードを適用（フォールバック付き）
   * グループ維持が困難な場合は sort モードにフォールバック
   * @private
   */
  _groupByFolderWithFallback() {
    try {
      this._groupByFolder();

      // グループヘッダーが正しく挿入されたか確認
      const container = document.querySelector(NOTE_SELECTORS.LIST_CONTAINER);
      if (container && !this.isFilterActive()) {
        const groupHeaders = container.querySelectorAll(`.${FOLDERLM_CLASSES.GROUP_HEADER}`);
        const groupedCards = container.querySelectorAll(`.${FOLDERLM_CLASSES.GROUPED}`);

        // グループ化済みカードがあるのにヘッダーがない場合は失敗
        if (groupedCards.length > 0 && groupHeaders.length === 0) {
          throw new Error('Group headers not inserted properly');
        }
      }

      // 成功したら失敗カウントをリセット
      this._groupModeFailureCount = 0;

    } catch (error) {
      console.error('[FolderLM FilterManager] Group mode failed:', error);
      this._groupModeFailureCount++;

      // 失敗が続く場合は sort モードにフォールバック
      if (this._groupModeFailureCount >= this._groupModeFailureThreshold) {
        console.warn('[FolderLM FilterManager] Group mode failed repeatedly, falling back to sort mode');
        this._clearGroupHeaders();
        this._sortByFolder();

        // 通知
        this._notifyChange({
          type: 'viewmode_fallback',
          fromMode: VIEW_MODES.GROUP,
          toMode: VIEW_MODES.SORT,
          reason: 'repeated_failure',
        });
      } else {
        // 失敗回数がしきい値未満なら sort で代替
        this._clearGroupHeaders();
        this._sortByFolder();
      }
    }
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
  // Phase 2: ソートモード実装
  // ==========================================================================

  /**
   * フォルダ順でノートを並べ替え
   * CSS order を優先し、不可能な場合は DOM 並べ替えにフォールバック
   * @private
   */
  _sortByFolder() {
    const container = document.querySelector(NOTE_SELECTORS.LIST_CONTAINER);
    if (!container) {
      console.warn('[FolderLM FilterManager] List container not found for sorting');
      return;
    }

    // NotebookLM フィルタ通過後の可視ノートのみを対象にする
    const visibleNotes = this._getVisibleNotes();
    if (visibleNotes.length === 0) {
      console.log('[FolderLM FilterManager] No visible notes to sort');
      return;
    }

    // フォルダ順 + 元インデックスで安定並べ替えを計算
    const sortedNotes = this._calculateSortOrder(visibleNotes);

    // CSS order をサポートしているか確認
    const orderSupported = this._isOrderSupported(container);

    if (orderSupported) {
      // CSS order を適用
      this._applyCssOrder(sortedNotes);
      console.log(`[FolderLM FilterManager] Sort applied via CSS order (${sortedNotes.length} notes)`);
    } else {
      // DOM 並べ替えにフォールバック
      this._applyDomReorder(container, sortedNotes);
      console.log(`[FolderLM FilterManager] Sort applied via DOM reorder (${sortedNotes.length} notes)`);
    }
  }

  /**
   * NotebookLM フィルタ通過後の可視ノートを取得
   * @returns {Array<{noteId: string, card: Element}>}
   * @private
   */
  _getVisibleNotes() {
    const noteIds = noteDetector.getAllNoteIds();
    const visibleNotes = [];

    for (const noteId of noteIds) {
      const card = noteDetector.getCardByNoteId(noteId);
      if (!card) continue;

      // FolderLM で非表示にされていないことを確認
      if (card.classList.contains(FOLDERLM_CLASSES.HIDDEN)) {
        continue;
      }

      // NotebookLM 標準フィルタで非表示にされていないことを確認
      if (this._isHiddenByNotebookLM(card)) {
        continue;
      }

      visibleNotes.push({ noteId, card });
    }

    return visibleNotes;
  }

  /**
   * フォルダ順 + 元インデックスでソート順序を計算（安定ソート）
   * @param {Array<{noteId: string, card: Element}>} notes - ノートリスト
   * @returns {Array<{noteId: string, card: Element, folderId: string, folderOrder: number, originalIndex: number}>}
   * @private
   */
  _calculateSortOrder(notes) {
    const folders = storageManager.getFolders();
    const folderOrderMap = new Map();
    
    // フォルダIDから順序へのマッピングを作成
    folders.forEach((folder, index) => {
      folderOrderMap.set(folder.id, index);
    });

    // 「未分類」フォルダの順序（デフォルトは最大値）
    const uncategorizedOrder = folderOrderMap.get(storageManager.UNCATEGORIZED_ID) ?? Infinity;

    // ノートにソート情報を付加
    const notesWithSortInfo = notes.map(({ noteId, card }) => {
      const folderId = storageManager.getNoteFolder(noteId) || storageManager.UNCATEGORIZED_ID;
      const folderOrder = folderOrderMap.get(folderId) ?? uncategorizedOrder;
      const originalIndex = this.getOriginalIndex(card);

      return {
        noteId,
        card,
        folderId,
        folderOrder,
        originalIndex,
      };
    });

    // 安定ソート: フォルダ順 -> 元のインデックス順
    notesWithSortInfo.sort((a, b) => {
      // まずフォルダ順で比較
      if (a.folderOrder !== b.folderOrder) {
        return a.folderOrder - b.folderOrder;
      }
      // 同じフォルダ内では元のインデックスで比較（安定ソート）
      return a.originalIndex - b.originalIndex;
    });

    return notesWithSortInfo;
  }

  /**
   * コンテナが CSS order をサポートしているか確認
   * @param {Element} container - リストコンテナ
   * @returns {boolean}
   * @private
   */
  _isOrderSupported(container) {
    const computedStyle = window.getComputedStyle(container);
    const display = computedStyle.display;

    // flex または grid レイアウトの場合は order をサポート
    const supportsOrder = [
      'flex',
      'inline-flex',
      'grid',
      'inline-grid',
    ].includes(display);

    return supportsOrder;
  }

  /**
   * CSS order を適用
   * @param {Array<{card: Element}>} sortedNotes - ソート済みノートリスト
   * @private
   */
  _applyCssOrder(sortedNotes) {
    sortedNotes.forEach((note, index) => {
      const { card } = note;
      const orderValue = index + 1; // 1から開始

      // CSS order を設定
      card.style.order = String(orderValue);
      card.setAttribute(DATA_ATTRIBUTES.ORDER, String(orderValue));
      card.classList.add(FOLDERLM_CLASSES.SORTED);
    });
  }

  /**
   * DOM 並べ替えを適用（フォールバック）
   * @param {Element} container - リストコンテナ
   * @param {Array<{card: Element}>} sortedNotes - ソート済みノートリスト
   * @private
   */
  _applyDomReorder(container, sortedNotes) {
    // DocumentFragment を使用してバッチ処理
    const fragment = document.createDocumentFragment();

    // ソート順にカードを fragment に追加
    sortedNotes.forEach((note, index) => {
      const { card } = note;
      card.classList.add(FOLDERLM_CLASSES.SORTED);
      card.setAttribute(DATA_ATTRIBUTES.ORDER, String(index + 1));
      fragment.appendChild(card);
    });

    // 一括で DOM に挿入（リフローを最小化）
    container.appendChild(fragment);
  }

  /**
   * ソート状態をクリア（filter モードに戻す時）
   * CSS order のリセットと DOM 順序の復元を行う
   * @private
   */
  _clearSortState() {
    const container = document.querySelector(NOTE_SELECTORS.LIST_CONTAINER);
    if (!container) return;

    // ソート済みカードを取得
    const sortedCards = container.querySelectorAll(`.${FOLDERLM_CLASSES.SORTED}`);
    if (sortedCards.length === 0) return;

    // CSS order をリセット
    sortedCards.forEach(card => {
      card.style.order = '';
      card.removeAttribute(DATA_ATTRIBUTES.ORDER);
      card.classList.remove(FOLDERLM_CLASSES.SORTED);
    });

    // DOM 並べ替えが行われていた場合、元の順序に復元
    // 元のインデックスでソートして復元
    const cardsWithIndex = Array.from(sortedCards).map(card => ({
      card,
      originalIndex: this.getOriginalIndex(card),
    }));

    // 元のインデックスが設定されている場合のみ復元
    const hasOriginalIndices = cardsWithIndex.some(item => item.originalIndex !== Infinity);
    
    if (hasOriginalIndices) {
      cardsWithIndex.sort((a, b) => a.originalIndex - b.originalIndex);

      const fragment = document.createDocumentFragment();
      cardsWithIndex.forEach(({ card }) => {
        fragment.appendChild(card);
      });
      container.appendChild(fragment);
    }

    console.log('[FolderLM FilterManager] Sort state cleared');
  }

  // ==========================================================================
  // Phase 3: グループモード実装
  // ==========================================================================

  /**
   * フォルダ順でノートを並べ替え、グループヘッダーを挿入
   * 「すべて」選択時のみグループヘッダーを表示
   * @private
   */
  _groupByFolder() {
    const container = document.querySelector(NOTE_SELECTORS.LIST_CONTAINER);
    if (!container) {
      console.warn('[FolderLM FilterManager] List container not found for grouping');
      return;
    }

    // 既存のグループヘッダーを削除
    this._clearGroupHeaders();

    // NotebookLM フィルタ通過後の可視ノートのみを対象にする
    const visibleNotes = this._getVisibleNotes();
    if (visibleNotes.length === 0) {
      console.log('[FolderLM FilterManager] No visible notes to group');
      return;
    }

    // フォルダ順 + 元インデックスで安定並べ替えを計算
    const sortedNotes = this._calculateSortOrder(visibleNotes);

    // フォルダIDでグループ化
    const groupedNotes = this._groupNotesByFolder(sortedNotes);

    // DOM 並べ替え + グループヘッダー挿入
    // グループモードは常に DOM 並べ替えを使用（ヘッダー挿入のため）
    this._applyGroupedDomReorder(container, groupedNotes);

    console.log(`[FolderLM FilterManager] Group applied (${sortedNotes.length} notes, ${groupedNotes.length} groups)`);
  }

  /**
   * ノートをフォルダIDでグループ化
   * @param {Array<{noteId: string, card: Element, folderId: string}>} sortedNotes - ソート済みノートリスト
   * @returns {Array<{folderId: string, folder: Object|null, notes: Array}>}
   * @private
   */
  _groupNotesByFolder(sortedNotes) {
    const groupMap = new Map();
    const folders = storageManager.getFolders();
    const folderMap = new Map(folders.map(f => [f.id, f]));

    // ソート済みノートをグループに分類
    for (const note of sortedNotes) {
      const { folderId } = note;
      
      if (!groupMap.has(folderId)) {
        groupMap.set(folderId, {
          folderId,
          folder: folderMap.get(folderId) || null,
          notes: [],
        });
      }
      
      groupMap.get(folderId).notes.push(note);
    }

    // フォルダ順序で結果を返す
    const orderedGroups = [];
    for (const folder of folders) {
      if (groupMap.has(folder.id)) {
        orderedGroups.push(groupMap.get(folder.id));
      }
    }

    // フォルダ一覧にない（削除された）フォルダに属するノートも追加
    for (const [folderId, group] of groupMap) {
      if (!folderMap.has(folderId)) {
        orderedGroups.push(group);
      }
    }

    return orderedGroups;
  }

  /**
   * グループ化された DOM 並べ替えを適用
   * グループヘッダーを挿入しながらノートを並べ替え
   * @param {Element} container - リストコンテナ
   * @param {Array<{folderId: string, folder: Object|null, notes: Array}>} groupedNotes - グループ化されたノートリスト
   * @private
   */
  _applyGroupedDomReorder(container, groupedNotes) {
    // 「すべて」選択時のみグループヘッダーを表示
    const showHeaders = !this.isFilterActive();

    const fragment = document.createDocumentFragment();
    let orderIndex = 1;

    for (const group of groupedNotes) {
      const { folderId, folder, notes } = group;

      // グループヘッダーを挿入（「すべて」選択時のみ）
      if (showHeaders && notes.length > 0) {
        const header = this._createGroupHeader(folderId, folder, notes.length);
        fragment.appendChild(header);
      }

      // ノートを追加
      for (const { card } of notes) {
        card.classList.add(FOLDERLM_CLASSES.SORTED);
        card.classList.add(FOLDERLM_CLASSES.GROUPED);
        card.setAttribute(DATA_ATTRIBUTES.ORDER, String(orderIndex));
        fragment.appendChild(card);
        orderIndex++;
      }
    }

    // 一括で DOM に挿入（リフローを最小化）
    container.appendChild(fragment);
  }

  /**
   * グループヘッダー要素を生成
   * リストセマンティクスを壊さず、非操作・非フォーカスにする
   * @param {string} folderId - フォルダID
   * @param {Object|null} folder - フォルダオブジェクト
   * @param {number} noteCount - グループ内のノート数
   * @returns {HTMLElement}
   * @private
   */
  _createGroupHeader(folderId, folder, noteCount) {
    // リストセマンティクスを壊さないように div ではなく span ベースの要素を使用
    // role="presentation" で支援技術に対してセマンティック上の意味を持たないことを示す
    const header = document.createElement('div');
    header.className = FOLDERLM_CLASSES.GROUP_HEADER;
    header.setAttribute(DATA_ATTRIBUTES.GROUP_FOLDER_ID, folderId);
    
    // アクセシビリティ属性：非操作・非フォーカス
    header.setAttribute('role', 'presentation');
    header.setAttribute('aria-hidden', 'true');
    header.setAttribute('tabindex', '-1');
    header.setAttribute('inert', '');

    // フォルダ名を取得（削除済みフォルダの場合はフォールバック）
    let folderName = '不明なフォルダ';
    let folderIcon = '📁';

    if (folder) {
      folderName = folder.name;
      // 「未分類」フォルダの場合は特別なアイコン
      if (folder.isDefault) {
        folderIcon = '📄';
      }
    } else if (folderId === storageManager.UNCATEGORIZED_ID) {
      folderName = '未分類';
      folderIcon = '📄';
    }

    // ヘッダーの内容を構築
    header.innerHTML = `
      <span class="${FOLDERLM_CLASSES.GROUP_HEADER_ICON}">${folderIcon}</span>
      <span class="${FOLDERLM_CLASSES.GROUP_HEADER_LABEL}">${this._escapeHtml(folderName)}</span>
      <span class="folderlm-group-header-count">(${noteCount})</span>
    `;

    return header;
  }

  /**
   * HTML エスケープ
   * @param {string} str - エスケープする文字列
   * @returns {string}
   * @private
   */
  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * グループヘッダーをすべて削除
   * @private
   */
  _clearGroupHeaders() {
    const headers = document.querySelectorAll(`.${FOLDERLM_CLASSES.GROUP_HEADER}`);
    headers.forEach(header => header.remove());

    // グループ化済みクラスを削除
    const groupedCards = document.querySelectorAll(`.${FOLDERLM_CLASSES.GROUPED}`);
    groupedCards.forEach(card => {
      card.classList.remove(FOLDERLM_CLASSES.GROUPED);
    });
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
      groupModeFailureCount: this._groupModeFailureCount,
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
    console.log('Group mode failure count:', info.groupModeFailureCount);
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
