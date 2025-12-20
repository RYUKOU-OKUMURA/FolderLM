/**
 * FolderLM - DOM Recovery Manager
 * 
 * タブ切替や DOM 再描画後の復帰処理を管理する。
 * ページの可視性変化やDOM構造の大規模変更を検出し、UIを再初期化する。
 * 
 * @module content/core/domRecoveryManager
 */

import { 
  NOTE_SELECTORS, 
  UI_INJECTION_SELECTORS,
  FOLDERLM_CLASSES,
  VIEW_MODES,
  DATA_ATTRIBUTES,
  FILTER_SELECTORS,
  findNoteListContainer
} from '../utils/selectors.js';
import { debounce } from '../utils/debounce.js';

/**
 * DOM復帰状態
 */
const RecoveryState = {
  ACTIVE: 'active',       // 正常に動作中
  RECOVERING: 'recovering', // 復帰処理中
  PAUSED: 'paused',       // 一時停止中（タブが非表示）
};

/**
 * DOMRecoveryManager クラス
 * タブ切替やDOM再描画後のUI復帰を管理
 */
class DOMRecoveryManager {
  constructor() {
    /**
     * 現在の状態
     * @type {string}
     */
    this.state = RecoveryState.ACTIVE;

    /**
     * ページが可視状態かどうか
     * @type {boolean}
     */
    this.isVisible = !document.hidden;

    /**
     * 最後の復帰タイムスタンプ
     * @type {number}
     */
    this.lastRecoveryTime = 0;

    /**
     * 復帰コールバック
     * @type {Function[]}
     */
    this._recoveryCallbacks = [];

    /**
     * 可視性変更リスナー
     * @type {Function[]}
     */
    this._visibilityListeners = [];

    /**
     * 初期化済みフラグ
     */
    this.initialized = false;

    /**
     * デバウンスされた復帰処理
     */
    this._debouncedRecover = debounce(() => this._performRecovery(), 500);

    /**
     * タブ表示検出のタイマーID
     */
    this._visibilityCheckTimer = null;

    /**
     * NotebookLM ソート変更の監視用 Observer
     * @type {MutationObserver|null}
     */
    this._sortObserver = null;

    /**
     * 最後に検出した NotebookLM ソート状態
     * @type {string|null}
     */
    this._lastSortState = null;

    /**
     * ソート変更コールバック
     * @type {Function|null}
     */
    this._sortChangeCallback = null;

    /**
     * viewMode 再適用コールバック
     * @type {Function|null}
     */
    this._viewModeReapplyCallback = null;
  }

  // ==========================================================================
  // 初期化
  // ==========================================================================

  /**
   * マネージャーを初期化
   */
  initialize() {
    if (this.initialized) {
      console.log('[FolderLM DOMRecoveryManager] Already initialized');
      return;
    }

    console.log('[FolderLM DOMRecoveryManager] Initializing...');

    // ページ可視性変更の監視
    this._setupVisibilityListener();

    // フォーカス/ブラー イベントの監視
    this._setupFocusListeners();

    this.initialized = true;
    // NotebookLM ソート変更の監視を開始
    this._startObservingSortChange();

    console.log('[FolderLM DOMRecoveryManager] Initialized');
  }

  /**
   * 可視性リスナーを設定
   * @private
   */
  _setupVisibilityListener() {
    const handleVisibilityChange = () => {
      const wasVisible = this.isVisible;
      this.isVisible = !document.hidden;

      console.log(`[FolderLM DOMRecoveryManager] Visibility changed: ${this.isVisible ? 'visible' : 'hidden'}`);

      if (!wasVisible && this.isVisible) {
        // タブが再び表示された
        this._onTabVisible();
      } else if (wasVisible && !this.isVisible) {
        // タブが非表示になった
        this._onTabHidden();
      }

      // リスナーに通知
      this._notifyVisibilityChange(this.isVisible);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  /**
   * フォーカス/ブラーリスナーを設定
   * @private
   */
  _setupFocusListeners() {
    window.addEventListener('focus', () => {
      console.log('[FolderLM DOMRecoveryManager] Window focused');
      // フォーカス取得時にも復帰チェックを行う
      this._checkAndRecover();
    });

    window.addEventListener('blur', () => {
      console.log('[FolderLM DOMRecoveryManager] Window blurred');
    });
  }

  // ==========================================================================
  // タブ表示/非表示の処理
  // ==========================================================================

  /**
   * タブが表示された時の処理
   * @private
   */
  _onTabVisible() {
    console.log('[FolderLM DOMRecoveryManager] Tab became visible');

    // 状態を ACTIVE に戻す
    if (this.state === RecoveryState.PAUSED) {
      this.state = RecoveryState.ACTIVE;
    }

    // DOM構造をチェックして必要に応じて復帰
    this._checkAndRecover();
  }

  /**
   * タブが非表示になった時の処理
   * @private
   */
  _onTabHidden() {
    console.log('[FolderLM DOMRecoveryManager] Tab became hidden');

    // 状態を PAUSED に変更
    this.state = RecoveryState.PAUSED;
  }

  // ==========================================================================
  // DOM復帰チェック
  // ==========================================================================

  /**
   * DOM構造をチェックして必要に応じて復帰処理を実行
   * @private
   */
  _checkAndRecover() {
    // タブが非表示の場合はスキップ
    if (!this.isVisible) {
      console.log('[FolderLM DOMRecoveryManager] Skipping check - tab not visible');
      return;
    }

    // 復帰が必要かどうかをチェック
    const needsRecovery = this._checkRecoveryNeeded();

    if (needsRecovery) {
      console.log('[FolderLM DOMRecoveryManager] Recovery needed, triggering recovery');
      this.requestRecovery();
    }
  }

  /**
   * 復帰が必要かどうかをチェック
   * @returns {boolean}
   * @private
   */
  _checkRecoveryNeeded() {
    // フォルダボタンが存在するかチェック
    const folderButton = document.querySelector(`.${FOLDERLM_CLASSES.FOLDER_BUTTON}`);
    if (!folderButton) {
      console.log('[FolderLM DOMRecoveryManager] Folder button missing');
      return true;
    }

    // フォルダボタンがDOMに接続されているかチェック
    if (!folderButton.isConnected) {
      console.log('[FolderLM DOMRecoveryManager] Folder button disconnected');
      return true;
    }

    // アクションバーが存在するかチェック
    const actionBar = document.querySelector(UI_INJECTION_SELECTORS.ACTION_BAR) ||
                     document.querySelector(UI_INJECTION_SELECTORS.ACTION_BAR_FALLBACK);
    if (!actionBar) {
      console.log('[FolderLM DOMRecoveryManager] Action bar missing');
      return true;
    }

    // フォルダボタンがアクションバーの子孫要素になっているかチェック
    if (!actionBar.contains(folderButton)) {
      console.log('[FolderLM DOMRecoveryManager] Folder button not in action bar');
      return true;
    }

    // ノートカードが存在する場合、割り当てボタンの状態をチェック
    const noteCards = document.querySelectorAll(NOTE_SELECTORS.CARD);
    if (noteCards.length > 0) {
      // 少なくとも1つのカードに初期化済みマークがあるかチェック
      const initializedCards = document.querySelectorAll(`[data-folderlm-initialized="true"]`);
      if (initializedCards.length === 0) {
        console.log('[FolderLM DOMRecoveryManager] Note cards not initialized');
        return true;
      }
    }

    // viewMode の状態チェック（sort/group モードの場合）
    if (this._checkViewModeRecoveryNeeded()) {
      console.log('[FolderLM DOMRecoveryManager] ViewMode state needs recovery');
      return true;
    }

    return false;
  }

  /**
   * viewMode の復帰が必要かどうかをチェック
   * @returns {boolean}
   * @private
   */
  _checkViewModeRecoveryNeeded() {
    // viewMode コールバックが登録されていれば、そちらに確認を委譲
    if (this._viewModeCheckCallback) {
      return this._viewModeCheckCallback();
    }
    return false;
  }

  /**
   * viewMode 復帰チェック用のコールバックを登録
   * filterManager から呼び出される
   * @param {Function} callback - () => boolean
   */
  setViewModeCheckCallback(callback) {
    if (typeof callback === 'function') {
      this._viewModeCheckCallback = callback;
    }
  }

  /**
   * viewMode 再適用コールバックを登録
   * filterManager から呼び出される
   * @param {Function} callback - () => void
   */
  setViewModeReapplyCallback(callback) {
    if (typeof callback === 'function') {
      this._viewModeReapplyCallback = callback;
    }
  }

  /**
   * ソート変更コールバックを登録
   * NotebookLM のソート変更時に呼び出される
   * @param {Function} callback - () => void
   */
  setSortChangeCallback(callback) {
    if (typeof callback === 'function') {
      this._sortChangeCallback = callback;
    }
  }

  // ==========================================================================
  // NotebookLM ソート変更監視 (Phase 4)
  // ==========================================================================

  /**
   * NotebookLM のソート変更を監視開始
   * @private
   */
  _startObservingSortChange() {
    // 既存の observer があれば解除
    if (this._sortObserver) {
      this._sortObserver.disconnect();
      this._sortObserver = null;
    }

    // ソートボタン/ドロップダウンを探す
    // NotebookLM はソートオプションを mat-button-toggle やドロップダウンで提供する可能性がある
    const sortContainer = document.querySelector(
      '[aria-label*="sort" i], [aria-label*="並べ替え"], ' +
      '[class*="sort"], [data-sort], .mat-sort-header'
    );

    // ノートリストコンテナも監視（DOM 再構築を検知）
    const listContainer = findNoteListContainer();

    if (!sortContainer && !listContainer) {
      console.log('[FolderLM DOMRecoveryManager] Sort container and list container not found, using body fallback');
    }

    // ノートカードの順序変更を検知するため、リストコンテナを監視
    const targetNode = listContainer || document.body;

    this._sortObserver = new MutationObserver((mutations) => {
      this._handleSortMutations(mutations);
    });

    this._sortObserver.observe(targetNode, {
      childList: true,    // 子ノードの追加・削除を監視
      subtree: false,     // 直接の子のみ（パフォーマンス考慮）
      attributes: false,  // 属性変更は不要
    });

    // 初期状態を記録
    this._lastSortState = this._detectCurrentSortState();

    console.log('[FolderLM DOMRecoveryManager] Started observing sort changes');
  }

  /**
   * ソート変更の MutationObserver コールバック
   * @param {MutationRecord[]} mutations
   * @private
   */
  _handleSortMutations(mutations) {
    // タブが非表示の場合はスキップ
    if (!this.isVisible) {
      return;
    }

    let hasSignificantChange = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        // 複数のノートカードが追加/削除された場合はソート変更の可能性
        const addedCards = Array.from(mutation.addedNodes).filter(
          node => node instanceof Element && 
            (node.matches?.(NOTE_SELECTORS.CARD) || node.querySelector?.(NOTE_SELECTORS.CARD))
        );
        const removedCards = Array.from(mutation.removedNodes).filter(
          node => node instanceof Element && 
            (node.matches?.(NOTE_SELECTORS.CARD) || node.querySelector?.(NOTE_SELECTORS.CARD))
        );

        // グループヘッダーの削除を検知（NotebookLM がリストを再構築した場合）
        const removedHeaders = Array.from(mutation.removedNodes).filter(
          node => node instanceof Element && 
            node.classList?.contains(FOLDERLM_CLASSES.GROUP_HEADER)
        );

        if (removedHeaders.length > 0) {
          console.log('[FolderLM DOMRecoveryManager] Group headers removed by DOM change');
          hasSignificantChange = true;
        }

        // 多数のカードが同時に移動された場合はソート変更と判定
        if (addedCards.length >= 2 || removedCards.length >= 2) {
          hasSignificantChange = true;
        }
      }
    }

    if (hasSignificantChange) {
      console.log('[FolderLM DOMRecoveryManager] Significant DOM change detected, triggering viewMode reapply');
      this._triggerViewModeReapply();
    }
  }

  /**
   * 現在のソート状態を検出
   * @returns {string|null}
   * @private
   */
  _detectCurrentSortState() {
    // ソートボタンの状態を確認
    const activeSort = document.querySelector(
      '[aria-sort="ascending"], [aria-sort="descending"], ' +
      '.mat-sort-header-sorted, [data-sorted="true"]'
    );

    if (activeSort) {
      const sortDirection = activeSort.getAttribute('aria-sort') || 'sorted';
      const sortLabel = activeSort.getAttribute('aria-label') || activeSort.textContent?.trim() || '';
      return `${sortLabel}:${sortDirection}`;
    }

    return null;
  }

  /**
   * viewMode の再適用をトリガー
   * @private
   */
  _triggerViewModeReapply() {
    if (this._viewModeReapplyCallback) {
      // デバウンスして呼び出し
      this._debouncedReapplyViewMode();
    }
  }

  /**
   * デバウンスされた viewMode 再適用
   * @private
   */
  _debouncedReapplyViewMode = debounce(() => {
    if (this._viewModeReapplyCallback) {
      console.log('[FolderLM DOMRecoveryManager] Reapplying viewMode after DOM change');
      try {
        this._viewModeReapplyCallback();
      } catch (error) {
        console.error('[FolderLM DOMRecoveryManager] viewMode reapply error:', error);
      }
    }
  }, 200);

  // ==========================================================================
  // 復帰処理
  // ==========================================================================

  /**
   * 復帰処理をリクエスト（デバウンス付き）
   */
  requestRecovery() {
    this._debouncedRecover();
  }

  /**
   * 復帰処理を実行
   * @private
   */
  _performRecovery() {
    // 復帰処理中の場合はスキップ
    if (this.state === RecoveryState.RECOVERING) {
      console.log('[FolderLM DOMRecoveryManager] Recovery already in progress');
      return;
    }

    // タブが非表示の場合はスキップ
    if (!this.isVisible) {
      console.log('[FolderLM DOMRecoveryManager] Skipping recovery - tab not visible');
      return;
    }

    console.log('[FolderLM DOMRecoveryManager] Performing recovery');

    // 状態を RECOVERING に変更
    const previousState = this.state;
    this.state = RecoveryState.RECOVERING;

    try {
      // 登録されたコールバックを実行
      for (const callback of this._recoveryCallbacks) {
        try {
          callback();
        } catch (error) {
          console.error('[FolderLM DOMRecoveryManager] Recovery callback error:', error);
        }
      }

      // 復帰完了
      this.lastRecoveryTime = Date.now();
      this.state = RecoveryState.ACTIVE;

      console.log('[FolderLM DOMRecoveryManager] Recovery completed');

    } catch (error) {
      console.error('[FolderLM DOMRecoveryManager] Recovery failed:', error);
      
      // 前の状態に戻す
      this.state = previousState;
    }
  }

  /**
   * 復帰処理を即座に実行
   */
  recoverNow() {
    this._debouncedRecover.cancel();
    this._performRecovery();
  }

  // ==========================================================================
  // コールバック管理
  // ==========================================================================

  /**
   * 復帰コールバックを登録
   * @param {Function} callback - 復帰時に実行するコールバック
   */
  onRecovery(callback) {
    if (typeof callback === 'function') {
      this._recoveryCallbacks.push(callback);
    }
  }

  /**
   * 復帰コールバックを削除
   * @param {Function} callback
   */
  offRecovery(callback) {
    this._recoveryCallbacks = this._recoveryCallbacks.filter(cb => cb !== callback);
  }

  /**
   * 可視性変更リスナーを登録
   * @param {Function} listener - (isVisible: boolean) => void
   */
  onVisibilityChange(listener) {
    if (typeof listener === 'function') {
      this._visibilityListeners.push(listener);
    }
  }

  /**
   * 可視性変更リスナーを削除
   * @param {Function} listener
   */
  offVisibilityChange(listener) {
    this._visibilityListeners = this._visibilityListeners.filter(l => l !== listener);
  }

  /**
   * 可視性変更を通知
   * @param {boolean} isVisible
   * @private
   */
  _notifyVisibilityChange(isVisible) {
    for (const listener of this._visibilityListeners) {
      try {
        listener(isVisible);
      } catch (error) {
        console.error('[FolderLM DOMRecoveryManager] Visibility listener error:', error);
      }
    }
  }

  // ==========================================================================
  // 状態取得
  // ==========================================================================

  /**
   * 現在の状態を取得
   * @returns {string}
   */
  getState() {
    return this.state;
  }

  /**
   * ページが可視状態かどうか
   * @returns {boolean}
   */
  isPageVisible() {
    return this.isVisible;
  }

  /**
   * 復帰処理中かどうか
   * @returns {boolean}
   */
  isRecovering() {
    return this.state === RecoveryState.RECOVERING;
  }

  /**
   * 最後の復帰時刻を取得
   * @returns {number}
   */
  getLastRecoveryTime() {
    return this.lastRecoveryTime;
  }

  // ==========================================================================
  // クリーンアップ
  // ==========================================================================

  /**
   * マネージャーを破棄
   */
  destroy() {
    if (this._visibilityCheckTimer) {
      clearInterval(this._visibilityCheckTimer);
      this._visibilityCheckTimer = null;
    }

    if (this._sortObserver) {
      this._sortObserver.disconnect();
      this._sortObserver = null;
    }

    this._debouncedRecover.cancel();
    if (this._debouncedReapplyViewMode?.cancel) {
      this._debouncedReapplyViewMode.cancel();
    }
    this._recoveryCallbacks = [];
    this._visibilityListeners = [];
    this._viewModeCheckCallback = null;
    this._viewModeReapplyCallback = null;
    this._sortChangeCallback = null;
    this.initialized = false;

    console.log('[FolderLM DOMRecoveryManager] Destroyed');
  }

  // ==========================================================================
  // デバッグ
  // ==========================================================================

  /**
   * デバッグ情報を出力
   */
  debug() {
    console.group('[FolderLM DOMRecoveryManager] Debug Info');
    console.log('Initialized:', this.initialized);
    console.log('State:', this.state);
    console.log('Is visible:', this.isVisible);
    console.log('Last recovery:', new Date(this.lastRecoveryTime).toISOString());
    console.log('Recovery callbacks:', this._recoveryCallbacks.length);
    console.log('Visibility listeners:', this._visibilityListeners.length);
    console.log('ViewMode check callback:', !!this._viewModeCheckCallback);
    console.log('ViewMode reapply callback:', !!this._viewModeReapplyCallback);
    console.log('Sort change callback:', !!this._sortChangeCallback);
    console.log('Sort observer active:', !!this._sortObserver);
    console.log('Last sort state:', this._lastSortState);
    console.groupEnd();

    return {
      initialized: this.initialized,
      state: this.state,
      isVisible: this.isVisible,
      lastRecoveryTime: this.lastRecoveryTime,
      callbackCount: this._recoveryCallbacks.length,
      listenerCount: this._visibilityListeners.length,
      hasViewModeCheckCallback: !!this._viewModeCheckCallback,
      hasViewModeReapplyCallback: !!this._viewModeReapplyCallback,
      hasSortChangeCallback: !!this._sortChangeCallback,
      sortObserverActive: !!this._sortObserver,
      lastSortState: this._lastSortState,
    };
  }
}

/**
 * 復帰状態定数
 */
export { RecoveryState };

/**
 * シングルトンインスタンス
 */
export const domRecoveryManager = new DOMRecoveryManager();

/**
 * デフォルトエクスポート
 */
export default domRecoveryManager;
