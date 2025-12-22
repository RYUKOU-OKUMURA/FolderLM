/**
 * FolderLM - Note Detector
 * 
 * NotebookLM のノートカードを検出し、ノートIDとDOM要素のマッピングを管理する。
 * DOM変更の監視、新規ノートの検出、削除されたノートの追跡を担当。
 * 
 * @module content/core/noteDetector
 */

import { 
  NOTE_SELECTORS, 
  DATA_ATTRIBUTES,
  FOLDERLM_CLASSES,
  findAllMatches,
  findNoteListContainer
} from '../utils/selectors.js';
import { 
  extractNoteIdFromCard, 
  extractNoteIdFromUrl, 
  isValidUuid,
  analyzePageNotes 
} from '../utils/idParser.js';
import { debounce, batchWithRAF } from '../utils/debounce.js';

/**
 * ノート検出結果の状態
 */
const DetectionStatus = {
  SUCCESS: 'success',
  PARTIAL: 'partial',  // 一部のノートのID取得に失敗
  FAILED: 'failed',    // すべてのノートのID取得に失敗
  NO_NOTES: 'no_notes', // ノートが見つからない
};

/**
 * NoteDetector クラス
 * ノートカードの検出とIDマッピングを管理
 */
class NoteDetector {
  constructor() {
    /**
     * ノートIDから要素へのマッピング
     * @type {Map<string, Element>}
     */
    this.noteMap = new Map();

    /**
     * 要素からノートIDへの逆マッピング
     * @type {WeakMap<Element, string>}
     */
    this.elementMap = new WeakMap();

    /**
     * 検出失敗したカード要素のリスト
     * @type {Set<Element>}
     */
    this.failedCards = new Set();

    /**
     * 最後の検出結果
     * @type {{ status: string, total: number, identified: number, failed: number, timestamp: number }|null}
     */
    this.lastDetectionResult = null;

    /**
     * 変更リスナー
     * @type {Function[]}
     */
    this._changeListeners = [];

    /**
     * エラーリスナー
     * @type {Function[]}
     */
    this._errorListeners = [];

    /**
     * 初期化済みフラグ
     */
    this.initialized = false;

    /**
     * バッチ処理用のデバウンス関数
     */
    this._debouncedScan = debounce(() => this._performScan(), 100);

    /**
     * ノート一覧コンテナのキャッシュ（スキャンごとに更新）
     * @type {Element|null}
     */
    this._listContainerCache = null;
  }

  // ==========================================================================
  // 初期化と検出
  // ==========================================================================

  /**
   * ノート検出を初期化
   * @returns {Promise<{ status: string, total: number, identified: number, failed: number }>}
   */
  async initialize() {
    console.log('[FolderLM NoteDetector] Initializing...');
    
    const result = await this.scanNotes();
    this.initialized = true;
    
    console.log('[FolderLM NoteDetector] Initialized:', result);
    return result;
  }

  /**
   * ページ上のすべてのノートをスキャン
   * @returns {Promise<{ status: string, total: number, identified: number, failed: number }>}
   */
  async scanNotes() {
    return this._performScan();
  }

  /**
   * スキャン処理の実行（内部用）
   * @returns {{ status: string, total: number, identified: number, failed: number }}
   */
  _performScan() {
    // 既存のマッピングをクリア（失敗カードのみ保持）
    this.noteMap.clear();

    // ノート一覧コンテナをキャッシュ
    this._listContainerCache = findNoteListContainer();
    
    // ノートカードを取得
    const cards = this._findNoteCards();
    
    let identified = 0;
    let failed = 0;
    const newFailedCards = new Set();

    for (const card of cards) {
      const noteId = this._extractNoteId(card, { preferDom: true });
      
      if (noteId) {
        const resolvedCard = this._resolveCardElement(card);
        this._registerNote(noteId, resolvedCard);
        identified++;
      } else {
        newFailedCards.add(card);
        failed++;
      }
    }

    // 失敗カードを更新
    this.failedCards = newFailedCards;

    // 検出結果を生成
    const result = this._createDetectionResult(cards.length, identified, failed);
    this.lastDetectionResult = result;

    // 変更を通知
    this._notifyChange('scan', { result });

    // エラーチェック
    if (result.status === DetectionStatus.FAILED) {
      this._notifyError('detection_failed', 'すべてのノートのID取得に失敗しました', result);
    } else if (result.status === DetectionStatus.PARTIAL) {
      console.warn(`[FolderLM NoteDetector] ${failed}/${cards.length} notes could not be identified`);
    }

    return result;
  }

  /**
   * 検出結果オブジェクトを作成
   * @param {number} total - 総ノート数
   * @param {number} identified - 識別成功数
   * @param {number} failed - 識別失敗数
   * @returns {{ status: string, total: number, identified: number, failed: number, timestamp: number }}
   */
  _createDetectionResult(total, identified, failed) {
    let status;
    
    if (total === 0) {
      status = DetectionStatus.NO_NOTES;
    } else if (identified === 0) {
      status = DetectionStatus.FAILED;
    } else if (failed > 0) {
      status = DetectionStatus.PARTIAL;
    } else {
      status = DetectionStatus.SUCCESS;
    }

    return {
      status,
      total,
      identified,
      failed,
      timestamp: Date.now(),
    };
  }

  // ==========================================================================
  // ノートカード操作
  // ==========================================================================

  /**
   * ページ上のノートカード要素を取得
   * @returns {Element[]}
   */
  _findNoteCards() {
    // メインセレクタとフォールバックセレクタで検索
    const cards = findAllMatches(
      NOTE_SELECTORS.CARD,
      NOTE_SELECTORS.CARD_FALLBACK
    );
    
    return cards;
  }

  /**
   * ノートカードからIDを抽出
   * @param {Element} card - ノートカード要素
   * @returns {string|null}
   */
  _extractNoteId(card, options = {}) {
    const { preferDom = false } = options;

    // DOM 属性から抽出（aria-labelledby / aria-describedby など）
    const extractedId = extractNoteIdFromCard(card);
    const existingId = card.getAttribute(DATA_ATTRIBUTES.NOTE_ID);

    if (preferDom) {
      if (extractedId && isValidUuid(extractedId)) {
        return extractedId;
      }
      if (existingId && isValidUuid(existingId)) {
        return existingId;
      }
      return null;
    }

    if (existingId && isValidUuid(existingId)) {
      return existingId;
    }
    if (extractedId && isValidUuid(extractedId)) {
      return extractedId;
    }
    return null;
  }

  /**
   * ノートカード要素を正規化（クリック領域を含む親要素を優先）
   * @param {Element} card - ノートカード要素
   * @returns {Element}
   * @private
   */
  _resolveCardElement(card) {
    if (!card || !(card instanceof Element)) {
      return card;
    }

    const listItem = card.closest('[role="listitem"]');
    if (listItem) {
      return listItem;
    }

    const listContainer = this._listContainerCache || findNoteListContainer();
    if (listContainer) {
      let current = card;
      let depth = 0;
      while (current && current.parentElement && current.parentElement !== listContainer && depth < 10) {
        current = current.parentElement;
        depth++;
      }
      if (current && current.parentElement === listContainer) {
        return current;
      }
    }

    return card;
  }

  /**
   * ノートをマッピングに登録
   * @param {string} noteId - ノートID
   * @param {Element} card - ノートカード要素
   */
  _registerNote(noteId, card) {
    // 重複チェック
    if (this.noteMap.has(noteId)) {
      const existingCard = this.noteMap.get(noteId);
      if (existingCard === card) {
        return;
      }

      if (existingCard) {
        this.elementMap.delete(existingCard);
        existingCard.removeAttribute(DATA_ATTRIBUTES.NOTE_ID);
        existingCard.removeAttribute(DATA_ATTRIBUTES.INITIALIZED);
      }
    }

    // マッピングに追加
    this.noteMap.set(noteId, card);
    this.elementMap.set(card, noteId);

    // データ属性を設定
    card.setAttribute(DATA_ATTRIBUTES.NOTE_ID, noteId);
    card.setAttribute(DATA_ATTRIBUTES.INITIALIZED, 'true');

    // 失敗リストから削除
    this.failedCards.delete(card);
  }

  /**
   * ノートをマッピングから削除
   * @param {string} noteId - ノートID
   */
  _unregisterNote(noteId) {
    const card = this.noteMap.get(noteId);
    if (card) {
      this.elementMap.delete(card);
      card.removeAttribute(DATA_ATTRIBUTES.NOTE_ID);
      card.removeAttribute(DATA_ATTRIBUTES.INITIALIZED);
    }
    this.noteMap.delete(noteId);
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * ノートIDから要素を取得
   * @param {string} noteId - ノートID
   * @returns {Element|null}
   */
  getCardByNoteId(noteId) {
    return this.noteMap.get(noteId) || null;
  }

  /**
   * 要素からノートIDを取得
   * @param {Element} card - ノートカード要素
   * @returns {string|null}
   */
  getNoteIdByCard(card) {
    return this.elementMap.get(card) || card.getAttribute(DATA_ATTRIBUTES.NOTE_ID) || null;
  }

  /**
   * すべてのノートIDを取得
   * @returns {string[]}
   */
  getAllNoteIds() {
    return Array.from(this.noteMap.keys());
  }

  /**
   * すべてのノートカードを取得
   * @returns {Element[]}
   */
  getAllCards() {
    return Array.from(this.noteMap.values());
  }

  /**
   * ノートIDとカードのマッピングを取得
   * @returns {Map<string, Element>}
   */
  getNoteMap() {
    return new Map(this.noteMap);
  }

  /**
   * 登録されているノート数を取得
   * @returns {number}
   */
  get count() {
    return this.noteMap.size;
  }

  /**
   * 最後の検出状態を取得
   * @returns {{ status: string, total: number, identified: number, failed: number, timestamp: number }|null}
   */
  getLastResult() {
    return this.lastDetectionResult;
  }

  /**
   * 検出が成功しているかどうか
   * @returns {boolean}
   */
  isHealthy() {
    if (!this.lastDetectionResult) {
      return false;
    }
    
    return this.lastDetectionResult.status === DetectionStatus.SUCCESS ||
           this.lastDetectionResult.status === DetectionStatus.NO_NOTES;
  }

  /**
   * ID取得に失敗したカード数
   * @returns {number}
   */
  get failedCount() {
    return this.failedCards.size;
  }

  // ==========================================================================
  // 差分検出
  // ==========================================================================

  /**
   * 新しく追加されたノートを検出
   * @returns {{ added: string[], removed: string[] }}
   */
  detectChanges() {
    const currentCards = this._findNoteCards();
    const currentIds = new Set();
    const previousIds = new Set(this.noteMap.keys());
    
    const added = [];
    const removed = [];

    // 現在のカードを処理
    for (const card of currentCards) {
      const noteId = this._extractNoteId(card, { preferDom: true });
      if (noteId) {
        const resolvedCard = this._resolveCardElement(card);
        currentIds.add(noteId);
        
        // 新しく追加されたノート
        if (!previousIds.has(noteId)) {
          this._registerNote(noteId, resolvedCard);
          added.push(noteId);
        } else {
          // 既存ノートのカード参照を更新
          const existingCard = this.noteMap.get(noteId);
          if (existingCard !== resolvedCard) {
            this._registerNote(noteId, resolvedCard);
          }
        }
      }
    }

    // 削除されたノートを検出
    for (const noteId of previousIds) {
      if (!currentIds.has(noteId)) {
        this._unregisterNote(noteId);
        removed.push(noteId);
      }
    }

    if (added.length > 0 || removed.length > 0) {
      // 結果を更新
      const result = this._createDetectionResult(
        currentCards.length,
        this.noteMap.size,
        this.failedCards.size
      );
      this.lastDetectionResult = result;

      this._notifyChange('diff', { added, removed, result });
      console.log(`[FolderLM NoteDetector] Changes detected: +${added.length}, -${removed.length}`);
    }

    return { added, removed };
  }

  /**
   * 単一のカードを処理（新規追加時など）
   * @param {Element} card - ノートカード要素
   * @returns {{ success: boolean, noteId?: string }}
   */
  processCard(card) {
    const noteId = this._extractNoteId(card, { preferDom: true });
    
    if (noteId) {
      const resolvedCard = this._resolveCardElement(card);
      this._registerNote(noteId, resolvedCard);
      return { success: true, noteId };
    } else {
      this.failedCards.add(card);
      return { success: false };
    }
  }

  /**
   * 差分スキャンをリクエスト（デバウンス付き）
   */
  requestScan() {
    this._debouncedScan();
  }

  // ==========================================================================
  // URL フォールバック
  // ==========================================================================

  /**
   * 現在のURLからノートIDを取得（ノート詳細ページの場合）
   * @returns {string|null}
   */
  getCurrentNoteIdFromUrl() {
    return extractNoteIdFromUrl();
  }

  // ==========================================================================
  // イベントリスナー
  // ==========================================================================

  /**
   * 変更リスナーを追加
   * @param {Function} listener - (event: { type: string, data: object }) => void
   */
  onChange(listener) {
    if (typeof listener === 'function') {
      this._changeListeners.push(listener);
    }
  }

  /**
   * 変更リスナーを削除
   * @param {Function} listener
   */
  offChange(listener) {
    this._changeListeners = this._changeListeners.filter(l => l !== listener);
  }

  /**
   * 変更を通知
   * @param {string} type - イベントタイプ
   * @param {Object} data - イベントデータ
   */
  _notifyChange(type, data) {
    const event = { type, data, timestamp: Date.now() };
    for (const listener of this._changeListeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[FolderLM NoteDetector] Change listener error:', e);
      }
    }
  }

  /**
   * エラーリスナーを追加
   * @param {Function} listener - (error: { type: string, message: string, data: object }) => void
   */
  onError(listener) {
    if (typeof listener === 'function') {
      this._errorListeners.push(listener);
    }
  }

  /**
   * エラーリスナーを削除
   * @param {Function} listener
   */
  offError(listener) {
    this._errorListeners = this._errorListeners.filter(l => l !== listener);
  }

  /**
   * エラーを通知
   * @param {string} type - エラータイプ
   * @param {string} message - エラーメッセージ
   * @param {Object} data - 追加データ
   */
  _notifyError(type, message, data = {}) {
    const error = { type, message, data, timestamp: Date.now() };
    console.error(`[FolderLM NoteDetector] Error: ${type}`, message, data);
    
    for (const listener of this._errorListeners) {
      try {
        listener(error);
      } catch (e) {
        console.error('[FolderLM NoteDetector] Error listener failed:', e);
      }
    }
  }

  // ==========================================================================
  // クリーンアップ
  // ==========================================================================

  /**
   * 状態をクリア
   */
  clear() {
    this.noteMap.clear();
    this.failedCards.clear();
    this.lastDetectionResult = null;
    
    // DOM上のデータ属性をクリア
    const cards = document.querySelectorAll(`[${DATA_ATTRIBUTES.NOTE_ID}]`);
    for (const card of cards) {
      card.removeAttribute(DATA_ATTRIBUTES.NOTE_ID);
      card.removeAttribute(DATA_ATTRIBUTES.INITIALIZED);
    }
  }

  /**
   * 完全に破棄
   */
  destroy() {
    this.clear();
    this._changeListeners = [];
    this._errorListeners = [];
    this._debouncedScan.cancel();
    this.initialized = false;
  }

  // ==========================================================================
  // デバッグ
  // ==========================================================================

  /**
   * デバッグ情報をコンソールに出力
   */
  debug() {
    console.group('[FolderLM NoteDetector] Debug Info');
    console.log('Initialized:', this.initialized);
    console.log('Note count:', this.noteMap.size);
    console.log('Failed cards:', this.failedCards.size);
    console.log('Last result:', this.lastDetectionResult);
    console.log('All note IDs:', this.getAllNoteIds());
    console.groupEnd();
    
    return {
      initialized: this.initialized,
      noteCount: this.noteMap.size,
      failedCount: this.failedCards.size,
      lastResult: this.lastDetectionResult,
      noteIds: this.getAllNoteIds(),
    };
  }
}

/**
 * 検出ステータス定数
 */
export { DetectionStatus };

/**
 * シングルトンインスタンス
 */
export const noteDetector = new NoteDetector();

/**
 * デフォルトエクスポート
 */
export default noteDetector;
