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

    // 検索ボックスが存在するかチェック
    const searchBox = document.querySelector(`.${FOLDERLM_CLASSES.SEARCH_BOX}`);
    if (!searchBox) {
      console.log('[FolderLM DOMRecoveryManager] Search box missing');
      return true;
    }

    if (!searchBox.isConnected || !actionBar.contains(searchBox)) {
      console.log('[FolderLM DOMRecoveryManager] Search box not in action bar');
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

    return false;
  }

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

    this._debouncedRecover.cancel();
    this._recoveryCallbacks = [];
    this._visibilityListeners = [];
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
    console.groupEnd();

    return {
      initialized: this.initialized,
      state: this.state,
      isVisible: this.isVisible,
      lastRecoveryTime: this.lastRecoveryTime,
      callbackCount: this._recoveryCallbacks.length,
      listenerCount: this._visibilityListeners.length,
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
