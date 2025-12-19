/**
 * FolderLM - Content Script Entry Point
 * 
 * NotebookLM のノート一覧に仮想フォルダ機能を追加するメインエントリーポイント。
 * 初期化、依存関係の組み立て、イベント配線を担当。
 * 
 * @module content/index
 */

import { NOTE_SELECTORS, UI_INJECTION_SELECTORS, FOLDERLM_CLASSES } from './utils/selectors.js';
import { extractNoteIdFromCard, analyzePageNotes } from './utils/idParser.js';
import { debounce, batchWithRAF, domBatchQueue } from './utils/debounce.js';
import { storageManager } from '../storage/storageManager.js';
import { noteDetector, DetectionStatus } from './core/noteDetector.js';
import { safetyManager, SafetyState, ErrorType } from './core/safetyManager.js';

/**
 * FolderLM アプリケーションクラス
 */
class FolderLM {
  constructor() {
    this.initialized = false;
    this.observer = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.retryDelay = 1000;

    // noteDetector と safetyManager への参照
    this.noteDetector = noteDetector;
    this.safetyManager = safetyManager;

    // エラーリスナーを設定
    this._setupErrorListeners();
  }

  /**
   * エラーリスナーを設定
   */
  _setupErrorListeners() {
    // noteDetector のエラーを safetyManager に伝播
    this.noteDetector.onError((error) => {
      if (error.type === 'detection_failed') {
        this.safetyManager.triggerSafeStop(
          ErrorType.DETECTION_FAILED,
          'ノートの検出に失敗しました。ページを再読み込みしてください。'
        );
      }
    });

    // storageManager のエラーを処理
    storageManager.onError((error) => {
      if (error.type === storageManager.ERROR_TYPES.QUOTA_EXCEEDED) {
        this.safetyManager.triggerWarning(error.message);
      } else if (error.type === storageManager.ERROR_TYPES.LOAD_FAILED) {
        // ストレージ読み込み失敗は警告のみ（デフォルト値で動作継続）
        this.safetyManager.showNotification(error.message, 'warning', 5000);
      }
    });

    // safetyManager の状態変更を監視
    this.safetyManager.onStateChange((oldState, newState, reason) => {
      console.log(`[FolderLM] Safety state changed: ${oldState} -> ${newState}`);
      if (newState === SafetyState.STOPPED) {
        this._handleSafetyStop();
      } else if (newState === SafetyState.ACTIVE && oldState === SafetyState.STOPPED) {
        this._handleSafetyRecovery();
      }
    });
  }

  /**
   * 安全停止時の処理
   */
  _handleSafetyStop() {
    // DOM 監視を停止
    if (this.observer) {
      this.observer.disconnect();
    }
    console.log('[FolderLM] Application stopped due to safety concerns');
  }

  /**
   * 安全停止からの復帰処理
   */
  async _handleSafetyRecovery() {
    console.log('[FolderLM] Attempting recovery...');
    
    // ノート検出を再試行
    const result = await this.noteDetector.scanNotes();
    
    if (result.status === DetectionStatus.SUCCESS || result.status === DetectionStatus.NO_NOTES) {
      // DOM 監視を再開
      this.startObserver();
      // UI を再初期化
      this.initUI();
      console.log('[FolderLM] Recovery successful');
    }
  }

  /**
   * アプリケーションを初期化
   */
  async init() {
    if (this.initialized) {
      console.log('[FolderLM] Already initialized');
      return;
    }

    console.log('[FolderLM] Initializing...');

    try {
      // 1. ストレージからデータを読み込み
      try {
        await storageManager.load();
        console.log('[FolderLM] Storage loaded');
      } catch (storageError) {
        // ストレージエラーは警告のみで続行（デフォルト値で動作）
        console.warn('[FolderLM] Storage load failed, using defaults:', storageError);
      }

      // 2. DOM の準備を待つ
      const ready = await this.waitForDOM();
      if (!ready) {
        console.error('[FolderLM] DOM not ready after retries, stopping initialization');
        this.safetyManager.triggerSafeStop(
          ErrorType.DOM_NOT_FOUND,
          'NotebookLM のページ構造を検出できませんでした。'
        );
        return;
      }

      // 3. noteDetector を使用してノートを検出
      const detectionResult = await this.noteDetector.initialize();
      console.log(`[FolderLM] Note detection result:`, detectionResult);

      // 検出結果に応じた処理
      if (detectionResult.status === DetectionStatus.FAILED) {
        // すべてのノートの ID 取得に失敗した場合は安全停止
        this.safetyManager.triggerSafeStop(
          ErrorType.DETECTION_FAILED,
          'ノートの識別に失敗しました。FolderLM は正常に動作できません。'
        );
        return;
      }

      if (detectionResult.status === DetectionStatus.PARTIAL) {
        // 一部失敗の場合は警告を表示して続行
        this.safetyManager.triggerWarning(
          `${detectionResult.failed}件のノートを識別できませんでした。一部の機能が制限される可能性があります。`
        );
      }

      // 4. UI を初期化
      this.initUI();

      // 5. DOM 監視を開始
      this.startObserver();

      // 6. noteDetector の変更イベントを購読
      this._setupNoteDetectorEvents();

      this.initialized = true;
      console.log('[FolderLM] Initialization complete');

    } catch (error) {
      console.error('[FolderLM] Initialization failed:', error);
      this.safetyManager.triggerSafeStop(
        ErrorType.UNKNOWN,
        '初期化に失敗しました。ページを再読み込みしてください。'
      );
    }
  }

  /**
   * noteDetector のイベントハンドラを設定
   */
  _setupNoteDetectorEvents() {
    this.noteDetector.onChange((event) => {
      if (event.type === 'diff') {
        const { added, removed } = event.data;
        
        // 新規ノートにフォルダ状態を適用
        for (const noteId of added) {
          const card = this.noteDetector.getCardByNoteId(noteId);
          if (card) {
            this.applyFolderState(card, noteId);
          }
        }

        // 削除されたノートのクリーンアップ（必要に応じて）
        if (removed.length > 0) {
          console.log(`[FolderLM] ${removed.length} notes removed from view`);
        }
      }
    });
  }

  /**
   * DOM の準備ができるまで待機
   * @returns {Promise<boolean>} 準備完了で true
   */
  async waitForDOM() {
    for (let i = 0; i < this.maxRetries; i++) {
      // ノートカードまたはアクションバーが存在するか確認
      const noteCards = document.querySelectorAll(NOTE_SELECTORS.CARD);
      const actionBar = document.querySelector(UI_INJECTION_SELECTORS.ACTION_BAR) ||
                       document.querySelector(UI_INJECTION_SELECTORS.ACTION_BAR_FALLBACK);

      if (noteCards.length > 0 || actionBar) {
        console.log(`[FolderLM] DOM ready: ${noteCards.length} note cards found`);
        return true;
      }

      console.log(`[FolderLM] Waiting for DOM... (attempt ${i + 1}/${this.maxRetries})`);
      await this.sleep(this.retryDelay);
    }

    return false;
  }

  /**
   * UI コンポーネントを初期化
   */
  initUI() {
    // フォルダボタンをヘッダーに挿入
    this.injectFolderButton();

    // 既存のノートカードに割り当てボタンを追加
    this.processNoteCards();

    // 初期化済みマーカーを追加
    document.body.classList.add(FOLDERLM_CLASSES.INITIALIZED);

    console.log('[FolderLM] UI initialized');
  }

  /**
   * フォルダボタンをヘッダーに挿入
   */
  injectFolderButton() {
    const actionBar = document.querySelector(UI_INJECTION_SELECTORS.ACTION_BAR) ||
                     document.querySelector(UI_INJECTION_SELECTORS.ACTION_BAR_FALLBACK);

    if (!actionBar) {
      console.warn('[FolderLM] Action bar not found, skipping folder button injection');
      return;
    }

    // 既存のボタンがあれば何もしない
    if (actionBar.querySelector(`.${FOLDERLM_CLASSES.FOLDER_BUTTON}`)) {
      return;
    }

    // フォルダボタンを作成（将来的に folderButton.js に移動）
    const button = document.createElement('button');
    button.className = FOLDERLM_CLASSES.FOLDER_BUTTON;
    button.setAttribute('aria-label', 'フォルダ');
    button.setAttribute('type', 'button');
    button.textContent = '📁';
    button.title = 'FolderLM - フォルダ管理';

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFolderDropdown();
    });

    actionBar.appendChild(button);
    console.log('[FolderLM] Folder button injected');
  }

  /**
   * フォルダドロップダウンの表示/非表示を切り替え
   */
  toggleFolderDropdown() {
    // TODO: 将来的に folderDropdown.js で実装
    console.log('[FolderLM] Toggle folder dropdown');
  }

  /**
   * すべてのノートカードを処理
   */
  processNoteCards() {
    // safetyManager が停止状態なら処理しない
    if (this.safetyManager.isStopped()) {
      console.log('[FolderLM] Skipping processNoteCards - safety stopped');
      return;
    }

    // noteDetector を使用して差分検出
    const { added, removed } = this.noteDetector.detectChanges();
    
    // すべてのノートにフォルダ状態を適用
    for (const noteId of this.noteDetector.getAllNoteIds()) {
      const card = this.noteDetector.getCardByNoteId(noteId);
      if (card) {
        this.applyFolderState(card, noteId);
      }
    }

    console.log(`[FolderLM] Processed ${this.noteDetector.count} note cards`);
  }

  /**
   * 個別のノートカードを処理
   * @param {Element} card - ノートカード要素
   */
  processNoteCard(card) {
    // safetyManager が停止状態なら処理しない
    if (this.safetyManager.isStopped()) {
      return;
    }

    // noteDetector を使用してカードを処理
    const result = this.noteDetector.processCard(card);
    
    if (!result.success) {
      console.warn('[FolderLM] Could not extract note ID from card');
      return;
    }

    // フォルダ割り当て状態を反映
    this.applyFolderState(card, result.noteId);
  }

  /**
   * ノートカードにフォルダ割り当て状態を反映
   * @param {Element} card - ノートカード要素
   * @param {string} noteId - ノートID
   */
  applyFolderState(card, noteId) {
    const folderId = storageManager.getNoteFolder(noteId);
    
    if (folderId) {
      const folder = storageManager.getFolder(folderId);
      if (folder) {
        card.setAttribute('data-folderlm-folder-id', folderId);
        // TODO: フォルダバッジを表示
      }
    }
  }

  /**
   * DOM 監視を開始
   */
  startObserver() {
    // safetyManager が停止状態なら開始しない
    if (this.safetyManager.isStopped()) {
      console.log('[FolderLM] Skipping observer start - safety stopped');
      return;
    }

    if (this.observer) {
      this.observer.disconnect();
    }

    const targetNode = document.body;
    const config = {
      childList: true,
      subtree: true,
      attributes: false,
    };

    // デバウンスされた処理
    const handleMutations = debounce((mutations) => {
      // safetyManager が停止状態なら処理しない
      if (this.safetyManager.isStopped()) {
        return;
      }

      let hasRelevantChanges = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // 新しいノートカードが追加されたか確認
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              if (node.matches?.(NOTE_SELECTORS.CARD) || node.querySelector?.(NOTE_SELECTORS.CARD)) {
                hasRelevantChanges = true;
                break;
              }
            }
          }
        }
      }

      if (hasRelevantChanges) {
        domBatchQueue.add(() => {
          // noteDetector にスキャンをリクエスト
          this.noteDetector.requestScan();
          this.injectFolderButton();
        });
      }
    }, 100);

    this.observer = new MutationObserver(handleMutations);
    this.observer.observe(targetNode, config);

    console.log('[FolderLM] DOM observer started');
  }

  /**
   * エラーメッセージを表示
   * @param {string} message - エラーメッセージ
   */
  showError(message) {
    console.error(`[FolderLM] Error: ${message}`);
    this.safetyManager.showNotification(message, 'error');
  }

  /**
   * 警告メッセージを表示
   * @param {string} message - 警告メッセージ
   */
  showWarning(message) {
    console.warn(`[FolderLM] Warning: ${message}`);
    this.safetyManager.showNotification(message, 'warning', 5000);
  }

  /**
   * 情報メッセージを表示
   * @param {string} message - 情報メッセージ
   * @param {number} [duration=3000] - 表示時間（ミリ秒）
   */
  showInfo(message, duration = 3000) {
    console.log(`[FolderLM] Info: ${message}`);
    this.safetyManager.showNotification(message, 'info', duration);
  }

  /**
   * 手動で復帰を試みる
   */
  async tryRecover() {
    if (this.safetyManager.isStopped()) {
      this.safetyManager.recover();
    }
  }

  /**
   * 指定時間待機
   * @param {number} ms - 待機時間（ミリ秒）
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * アプリケーションを停止
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // noteDetector と safetyManager をクリーンアップ
    this.noteDetector.destroy();
    this.safetyManager.destroy();

    document.body.classList.remove(FOLDERLM_CLASSES.INITIALIZED);
    
    // 追加した要素を削除
    document.querySelectorAll(`.${FOLDERLM_CLASSES.FOLDER_BUTTON}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.FOLDER_DROPDOWN}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.ASSIGN_BUTTON}`).forEach(el => el.remove());

    this.initialized = false;
    console.log('[FolderLM] Destroyed');
  }

  /**
   * デバッグ情報を出力
   */
  debug() {
    console.group('[FolderLM] Debug Info');
    console.log('Initialized:', this.initialized);
    console.log('Safety state:', this.safetyManager.getState());
    this.noteDetector.debug();
    this.safetyManager.debug();
    console.groupEnd();

    return {
      initialized: this.initialized,
      safetyState: this.safetyManager.getState(),
      noteDetector: this.noteDetector.debug(),
      safetyManager: this.safetyManager.debug(),
    };
  }
}

// アプリケーションインスタンス
const app = new FolderLM();

// DOM 読み込み完了後に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}

// デバッグ用にグローバルに公開
window.FolderLM = app;

export default app;
