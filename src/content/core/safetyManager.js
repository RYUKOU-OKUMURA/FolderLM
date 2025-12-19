/**
 * FolderLM - Safety Manager
 * 
 * ID取得失敗時の安全停止とユーザー通知を管理する。
 * FolderLM の UI を安全に非表示にし、エラー状態をユーザーに通知する。
 * 
 * @module content/core/safetyManager
 */

import { FOLDERLM_CLASSES } from '../utils/selectors.js';

/**
 * 安全停止の状態
 */
const SafetyState = {
  ACTIVE: 'active',      // 正常動作中
  WARNING: 'warning',    // 警告状態（一部失敗）
  STOPPED: 'stopped',    // 安全停止中
};

/**
 * エラータイプ
 */
const ErrorType = {
  DETECTION_FAILED: 'detection_failed',
  DOM_NOT_FOUND: 'dom_not_found',
  STORAGE_ERROR: 'storage_error',
  UNKNOWN: 'unknown',
};

/**
 * SafetyManager クラス
 * 安全停止とユーザー通知を管理
 */
class SafetyManager {
  constructor() {
    /**
     * 現在の状態
     * @type {string}
     */
    this.state = SafetyState.ACTIVE;

    /**
     * エラー履歴
     * @type {Array<{ type: string, message: string, timestamp: number }>}
     */
    this.errorHistory = [];

    /**
     * 通知要素
     * @type {HTMLElement|null}
     */
    this._notificationElement = null;

    /**
     * 通知の自動非表示タイマー
     * @type {number|null}
     */
    this._hideTimer = null;

    /**
     * 状態変更リスナー
     * @type {Function[]}
     */
    this._stateListeners = [];
  }

  // ==========================================================================
  // 状態管理
  // ==========================================================================

  /**
   * 現在の状態を取得
   * @returns {string}
   */
  getState() {
    return this.state;
  }

  /**
   * 状態が正常かどうか
   * @returns {boolean}
   */
  isActive() {
    return this.state === SafetyState.ACTIVE;
  }

  /**
   * 安全停止中かどうか
   * @returns {boolean}
   */
  isStopped() {
    return this.state === SafetyState.STOPPED;
  }

  /**
   * 状態を変更
   * @param {string} newState - 新しい状態
   * @param {string} [reason] - 変更理由
   */
  _setState(newState, reason = '') {
    const oldState = this.state;
    this.state = newState;

    if (oldState !== newState) {
      console.log(`[FolderLM Safety] State changed: ${oldState} -> ${newState}`, reason);
      this._notifyStateChange(oldState, newState, reason);
    }
  }

  /**
   * 状態変更リスナーを追加
   * @param {Function} listener - (oldState, newState, reason) => void
   */
  onStateChange(listener) {
    if (typeof listener === 'function') {
      this._stateListeners.push(listener);
    }
  }

  /**
   * 状態変更リスナーを削除
   * @param {Function} listener
   */
  offStateChange(listener) {
    this._stateListeners = this._stateListeners.filter(l => l !== listener);
  }

  /**
   * 状態変更を通知
   */
  _notifyStateChange(oldState, newState, reason) {
    for (const listener of this._stateListeners) {
      try {
        listener(oldState, newState, reason);
      } catch (e) {
        console.error('[FolderLM Safety] State listener error:', e);
      }
    }
  }

  // ==========================================================================
  // エラー処理
  // ==========================================================================

  /**
   * エラーを記録
   * @param {string} type - エラータイプ
   * @param {string} message - エラーメッセージ
   * @param {Object} [data] - 追加データ
   */
  recordError(type, message, data = {}) {
    const error = {
      type,
      message,
      data,
      timestamp: Date.now(),
    };

    this.errorHistory.push(error);

    // 履歴は最大50件まで保持
    if (this.errorHistory.length > 50) {
      this.errorHistory = this.errorHistory.slice(-50);
    }

    console.error(`[FolderLM Safety] Error recorded: ${type}`, message, data);
  }

  /**
   * エラー履歴を取得
   * @returns {Array}
   */
  getErrorHistory() {
    return [...this.errorHistory];
  }

  /**
   * エラー履歴をクリア
   */
  clearErrorHistory() {
    this.errorHistory = [];
  }

  // ==========================================================================
  // 安全停止
  // ==========================================================================

  /**
   * 安全停止を実行
   * @param {string} type - エラータイプ
   * @param {string} message - ユーザー向けメッセージ
   * @param {Object} [options] - オプション
   * @param {boolean} [options.showNotification=true] - 通知を表示するか
   * @param {boolean} [options.hideUI=true] - UIを非表示にするか
   */
  triggerSafeStop(type, message, options = {}) {
    const { showNotification = true, hideUI = true } = options;

    this.recordError(type, message);
    this._setState(SafetyState.STOPPED, message);

    if (hideUI) {
      this.hideAllUI();
    }

    if (showNotification) {
      this.showNotification(message, 'error');
    }

    console.warn('[FolderLM Safety] Safe stop triggered:', message);
  }

  /**
   * 警告状態に移行
   * @param {string} message - 警告メッセージ
   */
  triggerWarning(message) {
    this.recordError(ErrorType.UNKNOWN, message);
    this._setState(SafetyState.WARNING, message);
    this.showNotification(message, 'warning', 5000);
  }

  /**
   * 正常状態に復帰
   */
  recover() {
    if (this.state !== SafetyState.ACTIVE) {
      this._setState(SafetyState.ACTIVE, 'Recovered');
      this.hideNotification();
      this.showAllUI();
      console.log('[FolderLM Safety] Recovered to active state');
    }
  }

  // ==========================================================================
  // UI 制御
  // ==========================================================================

  /**
   * FolderLM の UI をすべて非表示にする
   */
  hideAllUI() {
    // FolderLM が追加した要素を非表示に
    const elements = document.querySelectorAll(
      `.${FOLDERLM_CLASSES.FOLDER_BUTTON}, ` +
      `.${FOLDERLM_CLASSES.FOLDER_DROPDOWN}, ` +
      `.${FOLDERLM_CLASSES.ASSIGN_BUTTON}, ` +
      `.${FOLDERLM_CLASSES.SELECT_POPUP}, ` +
      `.${FOLDERLM_CLASSES.FOLDER_BADGE}`
    );

    for (const el of elements) {
      el.style.display = 'none';
      el.setAttribute('data-folderlm-hidden-by-safety', 'true');
    }

    console.log(`[FolderLM Safety] Hidden ${elements.length} UI elements`);
  }

  /**
   * 非表示にした UI を再表示
   */
  showAllUI() {
    const elements = document.querySelectorAll('[data-folderlm-hidden-by-safety="true"]');

    for (const el of elements) {
      el.style.display = '';
      el.removeAttribute('data-folderlm-hidden-by-safety');
    }

    console.log(`[FolderLM Safety] Restored ${elements.length} UI elements`);
  }

  // ==========================================================================
  // 通知 UI
  // ==========================================================================

  /**
   * 通知を表示
   * @param {string} message - 表示するメッセージ
   * @param {string} [type='info'] - 通知タイプ ('info', 'warning', 'error')
   * @param {number} [duration=0] - 自動非表示までの時間（ミリ秒）、0で手動閉じ
   */
  showNotification(message, type = 'info', duration = 0) {
    // 既存の通知を削除
    this.hideNotification();

    // 通知要素を作成
    const notification = document.createElement('div');
    notification.className = 'folderlm-notification';
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', 'polite');

    // タイプに応じたスタイルクラス
    notification.classList.add(`folderlm-notification--${type}`);

    // アイコン
    const icon = this._getNotificationIcon(type);

    // コンテンツ
    notification.innerHTML = `
      <span class="folderlm-notification__icon">${icon}</span>
      <span class="folderlm-notification__message">${this._escapeHtml(message)}</span>
      <button class="folderlm-notification__close" aria-label="閉じる" type="button">×</button>
    `;

    // 閉じるボタンのイベント
    const closeButton = notification.querySelector('.folderlm-notification__close');
    closeButton.addEventListener('click', () => this.hideNotification());

    // スタイルを適用
    this._applyNotificationStyles(notification);

    // DOMに追加
    document.body.appendChild(notification);
    this._notificationElement = notification;

    // フェードイン
    requestAnimationFrame(() => {
      notification.classList.add('folderlm-notification--visible');
    });

    // 自動非表示
    if (duration > 0) {
      this._hideTimer = window.setTimeout(() => {
        this.hideNotification();
      }, duration);
    }

    console.log(`[FolderLM Safety] Notification shown: ${message}`);
  }

  /**
   * 通知を非表示
   */
  hideNotification() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }

    if (this._notificationElement) {
      this._notificationElement.classList.remove('folderlm-notification--visible');
      
      // フェードアウト後に削除
      setTimeout(() => {
        if (this._notificationElement) {
          this._notificationElement.remove();
          this._notificationElement = null;
        }
      }, 300);
    }
  }

  /**
   * 通知タイプに応じたアイコンを取得
   * @param {string} type - 通知タイプ
   * @returns {string}
   */
  _getNotificationIcon(type) {
    switch (type) {
      case 'error':
        return '⚠️';
      case 'warning':
        return '⚡';
      case 'success':
        return '✓';
      default:
        return 'ℹ️';
    }
  }

  /**
   * HTML エスケープ
   * @param {string} text
   * @returns {string}
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 通知要素にスタイルを適用
   * @param {HTMLElement} notification
   */
  _applyNotificationStyles(notification) {
    // インラインスタイルで基本スタイルを設定
    // content.css でも定義するが、CSS読み込み前でも動作するようにインラインでも設定
    Object.assign(notification.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      maxWidth: '400px',
      padding: '12px 16px',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      zIndex: '10000',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontFamily: '"Google Sans", Roboto, Arial, sans-serif',
      fontSize: '14px',
      lineHeight: '1.4',
      opacity: '0',
      transform: 'translateY(20px)',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
    });

    // タイプに応じた背景色
    if (notification.classList.contains('folderlm-notification--error')) {
      notification.style.backgroundColor = '#fdeded';
      notification.style.color = '#5f2120';
      notification.style.border = '1px solid #f5c6cb';
    } else if (notification.classList.contains('folderlm-notification--warning')) {
      notification.style.backgroundColor = '#fff8e1';
      notification.style.color = '#663c00';
      notification.style.border = '1px solid #ffecb5';
    } else {
      notification.style.backgroundColor = '#e3f2fd';
      notification.style.color = '#0d47a1';
      notification.style.border = '1px solid #bbdefb';
    }

    // 閉じるボタンのスタイル
    const closeButton = notification.querySelector('.folderlm-notification__close');
    if (closeButton) {
      Object.assign(closeButton.style, {
        background: 'none',
        border: 'none',
        padding: '4px 8px',
        marginLeft: 'auto',
        cursor: 'pointer',
        fontSize: '18px',
        opacity: '0.7',
        transition: 'opacity 0.2s',
      });
      closeButton.addEventListener('mouseenter', () => {
        closeButton.style.opacity = '1';
      });
      closeButton.addEventListener('mouseleave', () => {
        closeButton.style.opacity = '0.7';
      });
    }
  }

  // ==========================================================================
  // クリーンアップ
  // ==========================================================================

  /**
   * 破棄
   */
  destroy() {
    this.hideNotification();
    this.showAllUI();
    this.state = SafetyState.ACTIVE;
    this.errorHistory = [];
    this._stateListeners = [];
  }

  // ==========================================================================
  // デバッグ
  // ==========================================================================

  /**
   * デバッグ情報を出力
   */
  debug() {
    console.group('[FolderLM Safety] Debug Info');
    console.log('State:', this.state);
    console.log('Error count:', this.errorHistory.length);
    console.log('Recent errors:', this.errorHistory.slice(-5));
    console.groupEnd();

    return {
      state: this.state,
      errorCount: this.errorHistory.length,
      recentErrors: this.errorHistory.slice(-5),
    };
  }
}

// 定数をエクスポート
export { SafetyState, ErrorType };

// シングルトンインスタンス
export const safetyManager = new SafetyManager();

// デフォルトエクスポート
export default safetyManager;
