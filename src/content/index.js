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
      await storageManager.load();
      console.log('[FolderLM] Storage loaded');

      // 2. DOM の準備を待つ
      const ready = await this.waitForDOM();
      if (!ready) {
        console.error('[FolderLM] DOM not ready after retries, stopping initialization');
        this.showError('NotebookLM のページ構造を検出できませんでした。');
        return;
      }

      // 3. ノートIDの取得を検証
      const analysis = analyzePageNotes();
      console.log(`[FolderLM] Found ${analysis.total} notes, ${analysis.identified} identified`);

      if (analysis.total > 0 && analysis.identified === 0) {
        console.error('[FolderLM] Could not identify any notes');
        this.showError('ノートの識別に失敗しました。');
        return;
      }

      // 4. UI を初期化（将来的にここで UI コンポーネントを挿入）
      this.initUI();

      // 5. DOM 監視を開始
      this.startObserver();

      this.initialized = true;
      console.log('[FolderLM] Initialization complete');

    } catch (error) {
      console.error('[FolderLM] Initialization failed:', error);
      this.showError('初期化に失敗しました。');
    }
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
    const cards = document.querySelectorAll(NOTE_SELECTORS.CARD);
    
    cards.forEach(card => {
      this.processNoteCard(card);
    });

    console.log(`[FolderLM] Processed ${cards.length} note cards`);
  }

  /**
   * 個別のノートカードを処理
   * @param {Element} card - ノートカード要素
   */
  processNoteCard(card) {
    // 処理済みの場合はスキップ
    if (card.hasAttribute('data-folderlm-initialized')) {
      return;
    }

    // ノートIDを取得
    const noteId = extractNoteIdFromCard(card);
    if (!noteId) {
      console.warn('[FolderLM] Could not extract note ID from card');
      return;
    }

    // データ属性にノートIDを設定
    card.setAttribute('data-folderlm-note-id', noteId);
    card.setAttribute('data-folderlm-initialized', 'true');

    // 割り当てボタンを追加（将来的に noteAssignButton.js で実装）
    // this.addAssignButton(card, noteId);

    // フォルダ割り当て状態を反映
    this.applyFolderState(card, noteId);
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
          this.processNoteCards();
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
    // TODO: ユーザー向け通知 UI を実装
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

    document.body.classList.remove(FOLDERLM_CLASSES.INITIALIZED);
    
    // 追加した要素を削除
    document.querySelectorAll(`.${FOLDERLM_CLASSES.FOLDER_BUTTON}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.FOLDER_DROPDOWN}`).forEach(el => el.remove());
    document.querySelectorAll(`.${FOLDERLM_CLASSES.ASSIGN_BUTTON}`).forEach(el => el.remove());

    this.initialized = false;
    console.log('[FolderLM] Destroyed');
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
