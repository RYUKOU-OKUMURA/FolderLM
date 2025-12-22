/**
 * FolderLM - Content Script Entry Point
 * 
 * NotebookLM のノート一覧に仮想フォルダ機能を追加するメインエントリーポイント。
 * 初期化、依存関係の組み立て、イベント配線を担当。
 * 
 * @module content/index
 */

import { NOTE_SELECTORS, UI_INJECTION_SELECTORS, FOLDERLM_CLASSES, VIEW_MODES } from './utils/selectors.js';
import { extractNoteIdFromCard, analyzePageNotes } from './utils/idParser.js';
import { debounce, batchWithRAF, domBatchQueue } from './utils/debounce.js';
import { storageManager } from '../storage/storageManager.js';
import { noteDetector, DetectionStatus } from './core/noteDetector.js';
import { safetyManager, SafetyState, ErrorType } from './core/safetyManager.js';
import { filterManager } from './core/filterManager.js';
import { domRecoveryManager } from './core/domRecoveryManager.js';
import { folderButton } from './ui/folderButton.js';
import { folderDropdown } from './ui/folderDropdown.js';
import { noteAssignButton } from './ui/noteAssignButton.js';
import { folderSelectPopup } from './ui/folderSelectPopup.js';
import { viewModeSelector } from './ui/viewModeSelector.js';
import { createIconElement } from './utils/icons.js';

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
    this._currentUrl = window.location.href;
    this._routeCheckInterval = null;
    this._routeChangeInProgress = false;
    this._pendingRouteChange = false;
    this._pendingRouteUrl = null;
    this._pendingRoutePrevUrl = null;
    this._boundCheckUrl = null;

    // noteDetector と safetyManager への参照
    this.noteDetector = noteDetector;
    this.safetyManager = safetyManager;

    // UI コンポーネントへの参照
    this.folderButton = folderButton;
    this.folderDropdown = folderDropdown;
    this.noteAssignButton = noteAssignButton;
    this.folderSelectPopup = folderSelectPopup;
    this.viewModeSelector = viewModeSelector;

    // フィルタマネージャーへの参照
    this.filterManager = filterManager;

    // DOM復帰マネージャーへの参照
    this.domRecoveryManager = domRecoveryManager;

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
   * ルート変更の監視を開始
   */
  _setupRouteChangeWatcher() {
    if (this._routeCheckInterval) {
      return;
    }

    this._currentUrl = window.location.href;
    this._boundCheckUrl = () => this._checkForRouteChange();

    window.addEventListener('popstate', this._boundCheckUrl);
    window.addEventListener('hashchange', this._boundCheckUrl);

    this._routeCheckInterval = window.setInterval(this._boundCheckUrl, 500);
  }

  /**
   * ルート変更があれば処理を開始
   * @private
   */
  _checkForRouteChange() {
    const nextUrl = window.location.href;
    if (nextUrl === this._currentUrl) {
      return;
    }

    const prevUrl = this._currentUrl;
    this._currentUrl = nextUrl;
    this._handleRouteChange(prevUrl, nextUrl);
  }

  /**
   * ルート変更時の復帰処理
   * @param {string} prevUrl
   * @param {string} nextUrl
   * @private
   */
  async _handleRouteChange(prevUrl, nextUrl) {
    console.log(`[FolderLM] Route change detected: ${prevUrl} -> ${nextUrl}`);

    if (this._routeChangeInProgress) {
      this._pendingRouteChange = true;
      this._pendingRouteUrl = nextUrl;
      this._pendingRoutePrevUrl = prevUrl;
      return;
    }

    this._routeChangeInProgress = true;

    try {
      const ready = await this.waitForDOM();
      if (!ready) {
        console.log('[FolderLM] DOM not ready after route change, skipping recovery');
        return;
      }

      if (this.safetyManager.isStopped()) {
        this.safetyManager.recover();
      }

      await this.noteDetector.scanNotes();
      this.injectFolderButton();
      this.processNoteCards();
      this.filterManager.reapplyFilter();
      this.startObserver();
    } finally {
      this._routeChangeInProgress = false;
      if (this._pendingRouteChange) {
        this._pendingRouteChange = false;
        const queuedPrevUrl = this._pendingRoutePrevUrl || this._currentUrl;
        const queuedNextUrl = this._pendingRouteUrl || window.location.href;
        this._pendingRouteUrl = null;
        this._pendingRoutePrevUrl = null;
        this._handleRouteChange(queuedPrevUrl, queuedNextUrl);
      }
    }
  }

  /**
   * ルート変更監視を停止
   */
  _teardownRouteChangeWatcher() {
    if (this._routeCheckInterval) {
      clearInterval(this._routeCheckInterval);
      this._routeCheckInterval = null;
    }

    if (this._boundCheckUrl) {
      window.removeEventListener('popstate', this._boundCheckUrl);
      window.removeEventListener('hashchange', this._boundCheckUrl);
      this._boundCheckUrl = null;
    }
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
      this._setupRouteChangeWatcher();

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

      // 4. filterManager を初期化（storageManager から viewMode を復元）
      // 重要: storageManager.load() 完了後に復元する
      const savedViewMode = storageManager.getViewMode();
      this.filterManager.initialize({ viewMode: savedViewMode });

      // 5. domRecoveryManager を初期化
      this.domRecoveryManager.initialize();
      this._setupDOMRecoveryEvents();
      this._setupViewModeRecoveryIntegration();

      // 6. UI を初期化
      this.initUI();

      // 7. DOM 監視を開始
      this.startObserver();

      // 8. noteDetector の変更イベントを購読
      this._setupNoteDetectorEvents();

      // 9. filterManager の変更イベントを購読
      this._setupFilterManagerEvents();

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

        // フィルタを再適用（新規ノートにもフィルタを適用するため）
        this.filterManager.reapplyFilter();
      }
    });
  }

  /**
   * filterManager のイベントハンドラを設定
   */
  _setupFilterManagerEvents() {
    this.filterManager.onChange((event) => {
      if (event.type === 'folder_selected') {
        // フォルダボタンの状態を更新
        this.folderButton.setFilterActive(event.isFilterActive);
        
        // ドロップダウンの選択状態を同期
        this.folderDropdown.setSelectedFolder(event.selectedFolderId);

        console.log(`[FolderLM] Filter state: ${event.isFilterActive ? 'active' : 'inactive'}`);
      } else if (event.type === 'notebooklm_filter_changed') {
        // NotebookLM 標準フィルタが変更された場合のログ
        console.log(`[FolderLM] NotebookLM filter changed to: ${event.filter}`);
      } else if (event.type === 'viewmode_changed') {
        // viewMode が変更された場合
        console.log(`[FolderLM] ViewMode changed: ${event.previousViewMode} -> ${event.currentViewMode}`);
        // Phase 5: UI インジケーターを更新
        this.viewModeSelector.updateIndicator();
      } else if (event.type === 'viewmode_fallback') {
        // viewMode がフォールバックした場合
        console.log(`[FolderLM] ViewMode fallback: ${event.fromMode} -> ${event.toMode}`);
        this.viewModeSelector.updateIndicator();
        this.showWarning('グループモードを維持できないため、ソートモードに切り替えました');
      }
    });
  }

  /**
   * domRecoveryManager のイベントハンドラを設定
   */
  _setupDOMRecoveryEvents() {
    // 復帰処理を登録
    this.domRecoveryManager.onRecovery(() => {
      console.log('[FolderLM] DOM recovery triggered');
      
      // safetyManager が停止状態なら復帰しない
      if (this.safetyManager.isStopped()) {
        console.log('[FolderLM] Skipping recovery - safety stopped');
        return;
      }

      // UI を再初期化
      domBatchQueue.add(() => {
        // フォルダボタンを再注入
        this.injectFolderButton();
        
        // ノートカードを再処理
        this.processNoteCards();
        
        // フィルタを再適用
        this.filterManager.reapplyFilter();

        // viewMode を再適用（filter 以外の場合）
        if (this.filterManager.getViewMode() !== VIEW_MODES.FILTER) {
          this.filterManager.applyViewMode();
        }
        
        console.log('[FolderLM] DOM recovery completed');
      });
    });

    // 可視性変更を監視
    this.domRecoveryManager.onVisibilityChange((isVisible) => {
      if (isVisible) {
        console.log('[FolderLM] Tab visible - checking DOM state');
      } else {
        console.log('[FolderLM] Tab hidden - pausing some operations');
      }
    });
  }

  /**
   * viewMode 復帰の統合を設定
   * Phase 4: DOM 変化や仮想化後の並べ替え/ヘッダー再適用を担当
   * @private
   */
  _setupViewModeRecoveryIntegration() {
    // domRecoveryManager に viewMode の状態チェックコールバックを登録
    this.domRecoveryManager.setViewModeCheckCallback(() => {
      return this.filterManager.checkViewModeRecoveryNeeded();
    });

    // domRecoveryManager に viewMode 再適用コールバックを登録
    // DOM 変化（仮想化、ソート変更など）後に呼び出される
    this.domRecoveryManager.setViewModeReapplyCallback(() => {
      const currentMode = this.filterManager.getViewMode();
      
      // filter モードの場合は再適用不要
      if (currentMode === VIEW_MODES.FILTER) {
        return;
      }

      console.log('[FolderLM] Reapplying viewMode after DOM change');
      
      // 元のインデックスを再初期化（DOM が再構築された可能性があるため）
      this.filterManager.resetOriginalIndices();
      
      // ノートを再スキャン
      this.noteDetector.scanNotes().then(() => {
        // フィルタを再適用
        this.filterManager.reapplyFilter();
      });
    });

    // NotebookLM ソート変更時のコールバックを登録
    this.domRecoveryManager.setSortChangeCallback(() => {
      console.log('[FolderLM] NotebookLM sort changed, reapplying viewMode');
      
      // 元のインデックスを再初期化
      this.filterManager.resetOriginalIndices();
      
      // フィルタを再適用
      this.filterManager.reapplyFilter();
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
    this._setupFolderButton();

    // フォルダドロップダウンのイベントを設定
    this._setupFolderDropdown();

    // ノート割り当てボタンのイベントを設定
    this._setupNoteAssignButton();

    // フォルダ選択ポップアップのイベントを設定
    this._setupFolderSelectPopup();

    // 既存のノートカードに割り当てボタンを追加
    this.processNoteCards();

    // 初期化済みマーカーを追加
    document.body.classList.add(FOLDERLM_CLASSES.INITIALIZED);

    console.log('[FolderLM] UI initialized');
  }

  /**
   * フォルダボタンを設定
   * @private
   */
  _setupFolderButton() {
    // フォルダボタンを作成
    this.folderButton.create();

    // クリックイベントを設定
    this.folderButton.onClick(() => {
      this.toggleFolderDropdown();
    });

    // Phase 5: viewMode インジケーターをフォルダボタンの隣に追加
    this._injectViewModeIndicator();
  }

  /**
   * viewMode インジケーターをフォルダボタンの隣に挿入
   * @private
   */
  _injectViewModeIndicator() {
    const buttonElement = this.folderButton.getElement();
    if (!buttonElement) {
      return;
    }

    // 既存のインジケーターがあれば削除
    const existingIndicator = document.querySelector(`.${FOLDERLM_CLASSES.VIEW_MODE_INDICATOR}`);
    if (existingIndicator) {
      existingIndicator.remove();
    }

    // インジケーターを作成して挿入
    const indicator = this.viewModeSelector.createIndicatorElement();
    buttonElement.insertAdjacentElement('afterend', indicator);
  }

  /**
   * フォルダドロップダウンのイベントを設定
   * @private
   */
  _setupFolderDropdown() {
    // フォルダ選択時の処理
    this.folderDropdown.onFolderSelect((folderId) => {
      // filterManager を使用してフィルタを適用
      this.filterManager.selectFolder(folderId);
      console.log('[FolderLM] Folder selected:', folderId || 'all');
    });

    // フォルダ作成時の処理
    this.folderDropdown.onFolderCreate((folder) => {
      console.log('[FolderLM] Folder created:', folder.name);
      this.showInfo(`フォルダ「${folder.name}」を作成しました`, 2000);
    });

    // ドロップダウンが閉じた時の処理
    this.folderDropdown.onClose(() => {
      this.folderButton.setOpen(false);
    });
  }

  /**
   * ノート割り当てボタンのイベントを設定
   * @private
   */
  _setupNoteAssignButton() {
    // ボタンクリック時にフォルダ選択ポップアップを表示
    this.noteAssignButton.onClick((noteId, buttonElement) => {
      // フォルダドロップダウンが開いていたら閉じる
      if (this.folderDropdown.isOpen()) {
        this.folderDropdown.close();
      }
      
      this.folderSelectPopup.open(noteId, buttonElement);
    });
  }

  /**
   * フォルダ選択ポップアップのイベントを設定
   * @private
   */
  _setupFolderSelectPopup() {
    // フォルダ選択時の処理
    this.folderSelectPopup.onSelect((noteId, folderId) => {
      // 割り当てボタンの状態を更新
      this.noteAssignButton.updateState(noteId);
      
      // フォルダバッジを更新
      const card = this.noteDetector.getCardByNoteId(noteId);
      if (card) {
        this._updateFolderBadge(card, noteId);
      }

      // フィルタが適用されている場合、表示/非表示を更新
      this.filterManager.reapplyFilter();

      // フィードバック通知
      const folder = storageManager.getFolder(folderId);
      if (folder) {
        this.showInfo(`「${folder.name}」に割り当てました`, 2000);
      }
    });
  }

  /**
   * フォルダボタンをヘッダーに挿入（DOM 再描画後の復帰用）
   */
  injectFolderButton() {
    this.folderButton.reinject();
    // Phase 5: インジケーターも再注入
    this._injectViewModeIndicator();
  }

  /**
   * フォルダドロップダウンの表示/非表示を切り替え
   */
  toggleFolderDropdown() {
    const buttonElement = this.folderButton.getElement();
    if (!buttonElement) {
      console.warn('[FolderLM] Folder button not found');
      return;
    }

    if (this.folderDropdown.isOpen()) {
      this.folderDropdown.close();
      this.folderButton.setOpen(false);
    } else {
      // filterManager から現在の選択状態を取得
      this.folderDropdown.setSelectedFolder(this.filterManager.getSelectedFolderId());
      this.folderDropdown.open(buttonElement);
      this.folderButton.setOpen(true);
    }
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
    // 割り当てボタンを追加
    this.noteAssignButton.addToCard(card, noteId);

    // フォルダ割り当て状態を反映
    const folderId = storageManager.getNoteFolder(noteId);
    
    if (folderId) {
      const folder = storageManager.getFolder(folderId);
      if (folder) {
        card.setAttribute('data-folderlm-folder-id', folderId);
      }
    }

    // フォルダバッジを更新
    this._updateFolderBadge(card, noteId);
  }

  /**
   * ノートカードのフォルダバッジを更新
   * @param {Element} card - ノートカード要素
   * @param {string} noteId - ノートID
   * @private
   */
  _updateFolderBadge(card, noteId) {
    // 既存のバッジを削除
    const existingByNote = document.querySelectorAll(
      `.${FOLDERLM_CLASSES.FOLDER_BADGE_CONTAINER}[data-folderlm-badge-note-id="${noteId}"]`
    );
    if (existingByNote.length > 0) {
      existingByNote.forEach(el => el.remove());
    }

    const existingContainer = card.querySelector(`.${FOLDERLM_CLASSES.FOLDER_BADGE_CONTAINER}`);
    if (existingContainer) {
      existingContainer.remove();
    } else {
      const existingBadge = card.querySelector(`.${FOLDERLM_CLASSES.FOLDER_BADGE}`);
      if (existingBadge) {
        existingBadge.remove();
      }
    }

    const folderId = storageManager.getNoteFolder(noteId);
    
    // 未割り当てまたは未分類の場合はバッジを表示しない
    if (!folderId || folderId === storageManager.UNCATEGORIZED_ID) {
      card.removeAttribute('data-folderlm-folder-id');
      return;
    }

    const folder = storageManager.getFolder(folderId);
    if (!folder) {
      return;
    }

    // バッジを作成
    const badge = document.createElement('div');
    badge.className = FOLDERLM_CLASSES.FOLDER_BADGE;
    badge.setAttribute('title', `フォルダ: ${folder.name}`);

    const icon = createIconElement('folder', 10);
    icon.classList.add('folderlm-folder-badge-icon');
    badge.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'folderlm-folder-badge-name';
    name.textContent = folder.name;
    badge.appendChild(name);

    const badgeContainer = document.createElement('div');
    badgeContainer.className = FOLDERLM_CLASSES.FOLDER_BADGE_CONTAINER;
    badgeContainer.setAttribute('data-folderlm-badge-note-id', noteId);
    badgeContainer.appendChild(badge);

    const host = card.closest('[role="listitem"]') || card.parentElement || card;
    const emojiId = `project-${noteId}-emoji`;
    let iconElement = host.querySelector(`#${emojiId}`) ||
      document.getElementById(emojiId);

    if (!iconElement) {
      iconElement = host.querySelector('[id*="project-"][id*="-emoji"]') ||
        host.querySelector('.project-button-box-icon');
    }

    if (iconElement && iconElement.parentElement) {
      badgeContainer.classList.add(FOLDERLM_CLASSES.FOLDER_BADGE_CONTAINER_ICON);
      iconElement.insertAdjacentElement('afterend', badgeContainer);
    } else {
      // バッジを挿入（カード内の空いているスペースへ）
      const subtitleElement = host.querySelector(`#project-${noteId}-subtitle`) ||
        host.querySelector('[id*="project-"][id*="-subtitle"]');
      const descriptionElement = host.querySelector(NOTE_SELECTORS.CARD_DESCRIPTION);
      const titleElement = host.querySelector(NOTE_SELECTORS.CARD_TITLE);
      const anchorElement = subtitleElement || descriptionElement || titleElement;

      if (anchorElement && anchorElement.parentElement) {
        const anchorBlock = anchorElement.parentElement;
        const insertHost = anchorBlock.parentElement || host;
        insertHost.insertBefore(badgeContainer, anchorBlock.nextSibling);
      } else {
        // フォールバック: カード末尾に追加
        host.appendChild(badgeContainer);
      }
    }

    card.setAttribute('data-folderlm-folder-id', folderId);
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
      childList: true,      // 子ノードの追加・削除を監視
      subtree: true,        // 全ての子孫ノードを監視
      attributes: true,     // 属性の変更を監視
      attributeFilter: ['class', 'style', 'hidden'], // 特定の属性のみ監視
      characterData: false, // テキストノードの変更は監視しない
    };

    // デバウンスされた処理
    const handleMutations = debounce((mutations) => {
      // safetyManager が停止状態なら処理しない
      if (this.safetyManager.isStopped()) {
        return;
      }

      let hasRelevantChanges = false;
      let hasStructuralChanges = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // 新しいノートカードが追加されたか確認
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              if (node.matches?.(NOTE_SELECTORS.CARD) || node.querySelector?.(NOTE_SELECTORS.CARD)) {
                hasRelevantChanges = true;
                break;
              }
              // アクションバーや大きなコンテナの変更を検出
              if (node.matches?.(UI_INJECTION_SELECTORS.ACTION_BAR) || 
                  node.querySelector?.(UI_INJECTION_SELECTORS.ACTION_BAR)) {
                hasStructuralChanges = true;
              }
            }
          }

          // 削除されたノードもチェック
          for (const node of mutation.removedNodes) {
            if (node instanceof Element) {
              // フォルダボタンが削除されたか確認
              if (node.matches?.(`.${FOLDERLM_CLASSES.FOLDER_BUTTON}`) ||
                  node.querySelector?.(`.${FOLDERLM_CLASSES.FOLDER_BUTTON}`)) {
                hasStructuralChanges = true;
              }
            }
          }
        } else if (mutation.type === 'attributes') {
          // 属性変更で要素が非表示になった場合など
          const target = mutation.target;
          if (target instanceof Element) {
            // アクションバーが非表示になった場合
            if (target.matches?.(UI_INJECTION_SELECTORS.ACTION_BAR)) {
              if (target.hasAttribute('hidden') || target.style.display === 'none') {
                hasStructuralChanges = true;
              }
            }
          }
        }
      }

      // 構造的な変更があった場合は復帰チェック
      if (hasStructuralChanges) {
        domBatchQueue.add(() => {
          this.domRecoveryManager.requestRecovery();
        });
      }

      // ノートカードの変更があった場合
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
   * 現在選択中のフォルダIDを取得
   * @returns {string|null}
   */
  getSelectedFolder() {
    return this.filterManager.getSelectedFolderId();
  }

  /**
   * フォルダを選択（外部からの操作用）
   * @param {string|null} folderId - フォルダID（null で全表示）
   */
  selectFolder(folderId) {
    this.filterManager.selectFolder(folderId);
  }

  /**
   * アプリケーションを停止
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this._teardownRouteChangeWatcher();

    // UI コンポーネントをクリーンアップ
    this.folderButton.destroy();
    this.folderDropdown.destroy();
    this.noteAssignButton.destroy();
    this.folderSelectPopup.destroy();
    this.viewModeSelector.destroy();

    // noteDetector, safetyManager, filterManager, domRecoveryManager をクリーンアップ
    this.noteDetector.destroy();
    this.safetyManager.destroy();
    this.filterManager.destroy();
    this.domRecoveryManager.destroy();

    document.body.classList.remove(FOLDERLM_CLASSES.INITIALIZED);
    
    // 追加した要素を削除
    document.querySelectorAll(`.${FOLDERLM_CLASSES.FOLDER_BUTTON}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.FOLDER_DROPDOWN}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.ASSIGN_BUTTON}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.SELECT_POPUP}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.FOLDER_BADGE}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.FOLDER_BADGE_CONTAINER}`).forEach(el => el.remove());
    // Phase 5: viewMode 関連要素のクリーンアップ
    document.querySelectorAll(`.${FOLDERLM_CLASSES.VIEW_MODE_SELECTOR}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.VIEW_MODE_INDICATOR}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.GROUP_HEADER}`).forEach(el => el.remove());

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
      selectedFolderId: this.filterManager.getSelectedFolderId(),
      filterActive: this.filterManager.isFilterActive(),
      noteDetector: this.noteDetector.debug(),
      safetyManager: this.safetyManager.debug(),
      filterManager: this.filterManager.debug(),
      domRecoveryManager: this.domRecoveryManager.debug(),
      folders: storageManager.getFolders(),
      viewMode: this.filterManager.getViewMode(),
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
