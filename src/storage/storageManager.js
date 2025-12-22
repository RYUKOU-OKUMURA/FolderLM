/**
 * FolderLM - Storage Manager
 * 
 * chrome.storage.sync を使用してフォルダ情報とノート割り当てを永続化するマネージャー。
 * データのバリデーション、デバウンス保存、エラーハンドリングを担当。
 * 
 * @module storage/storageManager
 */

import { debounce } from '../content/utils/debounce.js';

/**
 * ストレージのキー名
 */
const STORAGE_KEYS = {
  FOLDERS: 'folders',
  NOTE_ASSIGNMENTS: 'noteAssignments',
  SETTINGS: 'settings',
  VERSION: 'version',
};

/**
 * 現在のデータスキーマバージョン
 */
const CURRENT_VERSION = 1;

/**
 * 「未分類」フォルダのID（固定）
 */
const UNCATEGORIZED_FOLDER_ID = '__uncategorized__';

/**
 * デフォルトのフォルダデータ
 */
const DEFAULT_FOLDERS = [
  {
    id: UNCATEGORIZED_FOLDER_ID,
    name: '未分類',
    order: 0,
    isDefault: true,
  },
];

/**
 * 制限値
 */
const LIMITS = {
  MAX_FOLDER_NAME_LENGTH: 30,
  MAX_FOLDERS: 200,
  MAX_NOTES: 1000,
  /** chrome.storage.sync の容量上限（バイト） */
  STORAGE_QUOTA_BYTES: 102400, // 100KB
  /** 警告を出す容量閾値（80%） */
  STORAGE_WARNING_THRESHOLD: 0.8,
};

/**
 * エラータイプ
 */
const ERROR_TYPES = {
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  LOAD_FAILED: 'LOAD_FAILED',
  SAVE_FAILED: 'SAVE_FAILED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
};

/**
 * デフォルト設定
 */
const DEFAULT_SETTINGS = {};

/**
 * Storage Manager クラス
 */
class StorageManager {
  constructor() {
    this.folders = [...DEFAULT_FOLDERS];
    this.noteAssignments = {};
    this.settings = { ...DEFAULT_SETTINGS };
    this.loaded = false;

    // 保存処理をデバウンス（300ms）
    this.debouncedSave = debounce(() => this._save(), 300);

    // エラーリスナー
    this._errorListeners = [];

    // 容量警告が表示されたかどうか
    this._quotaWarningShown = false;
  }

  /**
   * エラーリスナーを追加
   * @param {Function} listener - エラーハンドラ (error: { type, message, data }) => void
   */
  onError(listener) {
    if (typeof listener === 'function') {
      this._errorListeners.push(listener);
    }
  }

  /**
   * エラーリスナーを削除
   * @param {Function} listener - 削除するリスナー
   */
  offError(listener) {
    this._errorListeners = this._errorListeners.filter(l => l !== listener);
  }

  /**
   * エラーを発火
   * @param {string} type - エラータイプ
   * @param {string} message - エラーメッセージ
   * @param {Object} [data] - 追加データ
   */
  _emitError(type, message, data = {}) {
    const error = { type, message, data, timestamp: Date.now() };
    console.error(`[FolderLM Storage] ${type}:`, message, data);

    for (const listener of this._errorListeners) {
      try {
        listener(error);
      } catch (e) {
        console.error('[FolderLM Storage] Error listener failed:', e);
      }
    }
  }

  /**
   * ストレージからデータを読み込む
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const data = await this._getStorage([
        STORAGE_KEYS.FOLDERS,
        STORAGE_KEYS.NOTE_ASSIGNMENTS,
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.VERSION,
      ]);

      // バージョンチェックとマイグレーション
      const version = data[STORAGE_KEYS.VERSION] || 0;
      if (version < CURRENT_VERSION) {
        await this._migrate(version, data);
      }

      // データの読み込みとバリデーション
      this.folders = this._validateFolders(data[STORAGE_KEYS.FOLDERS]);
      this.noteAssignments = this._validateNoteAssignments(data[STORAGE_KEYS.NOTE_ASSIGNMENTS]);
      this.settings = this._validateSettings(data[STORAGE_KEYS.SETTINGS]);

      this.loaded = true;
      console.log('[FolderLM Storage] Data loaded:', {
        folders: this.folders.length,
        assignments: Object.keys(this.noteAssignments).length,
      });

    } catch (error) {
      console.error('[FolderLM Storage] Load failed:', error);
      // エラー時は安全なデフォルト値を使用
      this._resetToDefaults();

      this._emitError(
        ERROR_TYPES.LOAD_FAILED,
        'データの読み込みに失敗しました。初期状態で開始します。',
        { originalError: error }
      );

      throw error;
    }
  }

  /**
   * ストレージにデータを保存（内部用）
   * @returns {Promise<void>}
   */
  async _save() {
    try {
      // 保存前に容量チェック
      this._checkStorageUsage();

      await this._setStorage({
        [STORAGE_KEYS.FOLDERS]: this.folders,
        [STORAGE_KEYS.NOTE_ASSIGNMENTS]: this.noteAssignments,
        [STORAGE_KEYS.SETTINGS]: this.settings,
        [STORAGE_KEYS.VERSION]: CURRENT_VERSION,
      });

      console.log('[FolderLM Storage] Data saved');

    } catch (error) {
      console.error('[FolderLM Storage] Save failed:', error);
      
      // 容量超過エラーの場合
      if (error.message?.includes('QUOTA_BYTES') || error.message?.includes('quota')) {
        this._handleQuotaExceeded();
      } else {
        this._emitError(
          ERROR_TYPES.SAVE_FAILED,
          '保存に失敗しました: ' + error.message,
          { originalError: error }
        );
      }
      
      throw error;
    }
  }

  /**
   * データを保存（デバウンス付き）
   */
  save() {
    this.debouncedSave();
  }

  /**
   * データを即座に保存
   * @returns {Promise<void>}
   */
  async saveImmediate() {
    this.debouncedSave.cancel();
    await this._save();
  }

  // ==========================================================================
  // フォルダ操作
  // ==========================================================================

  /**
   * すべてのフォルダを取得
   * @returns {Array} フォルダ配列
   */
  getFolders() {
    return [...this.folders];
  }

  /**
   * フォルダを取得
   * @param {string} folderId - フォルダID
   * @returns {Object|null} フォルダオブジェクト
   */
  getFolder(folderId) {
    return this.folders.find(f => f.id === folderId) || null;
  }

  /**
   * フォルダを作成
   * @param {string} name - フォルダ名
   * @returns {{ success: boolean, folder?: Object, error?: string }}
   */
  createFolder(name) {
    // バリデーション
    const validation = this._validateFolderName(name);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // 上限チェック
    if (this.folders.length >= LIMITS.MAX_FOLDERS) {
      return { success: false, error: `フォルダ数の上限（${LIMITS.MAX_FOLDERS}）に達しています` };
    }

    // 新しいフォルダを作成
    const folder = {
      id: this._generateId(),
      name: validation.normalizedName,
      order: this.folders.length,
      isDefault: false,
      createdAt: Date.now(),
    };

    this.folders.push(folder);
    this.save();

    console.log('[FolderLM Storage] Folder created:', folder.name);
    return { success: true, folder };
  }

  /**
   * フォルダ名を変更
   * @param {string} folderId - フォルダID
   * @param {string} newName - 新しいフォルダ名
   * @returns {{ success: boolean, error?: string }}
   */
  renameFolder(folderId, newName) {
    const folder = this.getFolder(folderId);
    if (!folder) {
      return { success: false, error: 'フォルダが見つかりません' };
    }

    // 「未分類」は名称変更不可
    if (folder.isDefault) {
      return { success: false, error: 'デフォルトフォルダの名前は変更できません' };
    }

    // バリデーション
    const validation = this._validateFolderName(newName, folderId);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    folder.name = validation.normalizedName;
    this.save();

    console.log('[FolderLM Storage] Folder renamed:', folder.name);
    return { success: true };
  }

  /**
   * フォルダを削除
   * @param {string} folderId - フォルダID
   * @returns {{ success: boolean, error?: string }}
   */
  deleteFolder(folderId) {
    const folder = this.getFolder(folderId);
    if (!folder) {
      return { success: false, error: 'フォルダが見つかりません' };
    }

    // 「未分類」は削除不可
    if (folder.isDefault) {
      return { success: false, error: 'デフォルトフォルダは削除できません' };
    }

    // フォルダに割り当てられたノートを「未分類」に移動
    for (const [noteId, assignedFolderId] of Object.entries(this.noteAssignments)) {
      if (assignedFolderId === folderId) {
        this.noteAssignments[noteId] = UNCATEGORIZED_FOLDER_ID;
      }
    }

    // フォルダを削除
    this.folders = this.folders.filter(f => f.id !== folderId);
    this.save();

    console.log('[FolderLM Storage] Folder deleted:', folder.name);
    return { success: true };
  }

  /**
   * フォルダの順序を変更
   * @param {string[]} folderIds - 新しい順序でのフォルダID配列
   * @returns {{ success: boolean, error?: string }}
   */
  reorderFolders(folderIds) {
    // 「未分類」が先頭にあることを確認
    if (folderIds[0] !== UNCATEGORIZED_FOLDER_ID) {
      return { success: false, error: 'デフォルトフォルダは先頭に配置する必要があります' };
    }

    const newFolders = [];
    for (let i = 0; i < folderIds.length; i++) {
      const folder = this.getFolder(folderIds[i]);
      if (folder) {
        folder.order = i;
        newFolders.push(folder);
      }
    }

    if (newFolders.length !== this.folders.length) {
      return { success: false, error: 'フォルダIDが一致しません' };
    }

    this.folders = newFolders;
    this.save();

    return { success: true };
  }

  // ==========================================================================
  // ノート割り当て操作
  // ==========================================================================

  /**
   * ノートにフォルダを割り当て
   * @param {string} noteId - ノートID
   * @param {string} folderId - フォルダID
   * @returns {{ success: boolean, error?: string }}
   */
  assignNote(noteId, folderId) {
    if (!noteId) {
      return { success: false, error: 'ノートIDが無効です' };
    }

    const folder = this.getFolder(folderId);
    if (!folder) {
      return { success: false, error: 'フォルダが見つかりません' };
    }

    // 上限チェック
    if (Object.keys(this.noteAssignments).length >= LIMITS.MAX_NOTES && !this.noteAssignments[noteId]) {
      return { success: false, error: `ノート数の上限（${LIMITS.MAX_NOTES}）に達しています` };
    }

    this.noteAssignments[noteId] = folderId;
    this.save();

    console.log('[FolderLM Storage] Note assigned:', noteId, '->', folder.name);
    return { success: true };
  }

  /**
   * ノートの割り当てを解除（未分類に移動）
   * @param {string} noteId - ノートID
   * @returns {{ success: boolean }}
   */
  unassignNote(noteId) {
    if (this.noteAssignments[noteId]) {
      this.noteAssignments[noteId] = UNCATEGORIZED_FOLDER_ID;
      this.save();
    }
    return { success: true };
  }

  /**
   * ノートが割り当てられているフォルダIDを取得
   * @param {string} noteId - ノートID
   * @returns {string|null} フォルダID
   */
  getNoteFolder(noteId) {
    return this.noteAssignments[noteId] || null;
  }

  /**
   * 指定フォルダに割り当てられたノートIDを取得
   * @param {string} folderId - フォルダID
   * @returns {string[]} ノートID配列
   */
  getNotesByFolder(folderId) {
    return Object.entries(this.noteAssignments)
      .filter(([, assignedFolderId]) => assignedFolderId === folderId)
      .map(([noteId]) => noteId);
  }

  /**
   * フォルダごとのノート数を取得
   * @returns {Map<string, number>}
   */
  getFolderNoteCounts() {
    const counts = new Map();
    
    // 全フォルダを0で初期化
    for (const folder of this.folders) {
      counts.set(folder.id, 0);
    }

    // 割り当てをカウント
    for (const folderId of Object.values(this.noteAssignments)) {
      if (counts.has(folderId)) {
        counts.set(folderId, counts.get(folderId) + 1);
      }
    }

    return counts;
  }

  // ==========================================================================
  // プライベートメソッド
  // ==========================================================================

  /**
   * chrome.storage.sync からデータを取得
   * @param {string[]} keys - 取得するキー
   * @returns {Promise<Object>}
   */
  _getStorage(keys) {
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        chrome.storage.sync.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      } else {
        // 開発環境用フォールバック（localStorage）
        console.warn('[FolderLM Storage] Using localStorage fallback');
        const result = {};
        for (const key of keys) {
          const value = localStorage.getItem(`folderlm_${key}`);
          if (value) {
            try {
              result[key] = JSON.parse(value);
            } catch (e) {
              result[key] = null;
            }
          }
        }
        resolve(result);
      }
    });
  }

  /**
   * chrome.storage.sync にデータを保存
   * @param {Object} data - 保存するデータ
   * @returns {Promise<void>}
   */
  _setStorage(data) {
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        chrome.storage.sync.set(data, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      } else {
        // 開発環境用フォールバック（localStorage）
        console.warn('[FolderLM Storage] Using localStorage fallback');
        for (const [key, value] of Object.entries(data)) {
          localStorage.setItem(`folderlm_${key}`, JSON.stringify(value));
        }
        resolve();
      }
    });
  }

  /**
   * フォルダ名のバリデーション
   * @param {string} name - フォルダ名
   * @param {string} [excludeId] - 除外するフォルダID（リネーム時）
   * @returns {{ valid: boolean, normalizedName?: string, error?: string }}
   */
  _validateFolderName(name, excludeId = null) {
    if (!name || typeof name !== 'string') {
      return { valid: false, error: 'フォルダ名を入力してください' };
    }

    // 前後の空白を除去
    const normalizedName = name.trim();

    if (normalizedName.length === 0) {
      return { valid: false, error: 'フォルダ名を入力してください' };
    }

    if (normalizedName.length > LIMITS.MAX_FOLDER_NAME_LENGTH) {
      return { valid: false, error: `フォルダ名は${LIMITS.MAX_FOLDER_NAME_LENGTH}文字以内にしてください` };
    }

    // 重複チェック（大文字小文字無視）
    const lowerName = normalizedName.toLowerCase();
    const duplicate = this.folders.find(f => 
      f.id !== excludeId && f.name.toLowerCase() === lowerName
    );

    if (duplicate) {
      return { valid: false, error: '同名のフォルダが既に存在します' };
    }

    return { valid: true, normalizedName };
  }

  /**
   * フォルダ配列のバリデーション
   * @param {Array} folders - フォルダ配列
   * @returns {Array} バリデーション済みフォルダ配列
   */
  _validateFolders(folders) {
    if (!Array.isArray(folders) || folders.length === 0) {
      return [...DEFAULT_FOLDERS];
    }

    // 「未分類」フォルダが存在することを確認
    const hasUncategorized = folders.some(f => f.id === UNCATEGORIZED_FOLDER_ID);
    if (!hasUncategorized) {
      folders.unshift({ ...DEFAULT_FOLDERS[0] });
    }

    // 無効なフォルダを除去
    return folders.filter(f => 
      f && typeof f.id === 'string' && typeof f.name === 'string'
    );
  }

  /**
   * ノート割り当てのバリデーション
   * @param {Object} assignments - 割り当てオブジェクト
   * @returns {Object} バリデーション済み割り当てオブジェクト
   */
  _validateNoteAssignments(assignments) {
    if (!assignments || typeof assignments !== 'object') {
      return {};
    }

    const validAssignments = {};
    const folderIds = new Set(this.folders.map(f => f.id));

    for (const [noteId, folderId] of Object.entries(assignments)) {
      if (typeof noteId === 'string' && folderIds.has(folderId)) {
        validAssignments[noteId] = folderId;
      }
    }

    return validAssignments;
  }

  /**
   * データをデフォルト値にリセット
   */
  _resetToDefaults() {
    this.folders = [...DEFAULT_FOLDERS];
    this.noteAssignments = {};
    this.settings = { ...DEFAULT_SETTINGS };
    this.loaded = true;
  }

  /**
   * 設定のバリデーション
   * @param {Object} settings - 設定オブジェクト
   * @returns {Object} バリデーション済み設定オブジェクト
   */
  _validateSettings(settings) {
    if (!settings || typeof settings !== 'object') {
      return { ...DEFAULT_SETTINGS };
    }

    return { ...DEFAULT_SETTINGS };
  }

  /**
   * データマイグレーション
   * @param {number} fromVersion - 現在のバージョン
   * @param {Object} data - 現在のデータ
   */
  async _migrate(fromVersion, data) {
    console.log(`[FolderLM Storage] Migrating from version ${fromVersion} to ${CURRENT_VERSION}`);
    
    // 将来のバージョンアップ時にここにマイグレーションロジックを追加
    // if (fromVersion < 2) { ... }
  }

  /**
   * 容量超過時の処理
   */
  _handleQuotaExceeded() {
    const suggestions = this._getDataReductionSuggestions();

    this._emitError(
      ERROR_TYPES.QUOTA_EXCEEDED,
      'ストレージ容量が上限に達しました。データを削減してください。',
      {
        suggestions,
        currentUsage: this._estimateStorageUsage(),
        limit: LIMITS.STORAGE_QUOTA_BYTES,
      }
    );
  }

  /**
   * データ削減の提案を生成
   * @returns {Array<{ action: string, description: string, savings: number }>}
   */
  _getDataReductionSuggestions() {
    const suggestions = [];

    // 空のフォルダを削除する提案
    const emptyFolders = this.folders.filter(f => {
      if (f.isDefault) return false;
      const noteCount = Object.values(this.noteAssignments)
        .filter(folderId => folderId === f.id).length;
      return noteCount === 0;
    });

    if (emptyFolders.length > 0) {
      suggestions.push({
        action: 'DELETE_EMPTY_FOLDERS',
        description: `空のフォルダが ${emptyFolders.length} 個あります。削除を検討してください。`,
        savings: emptyFolders.length * 50, // 推定削減バイト数
        folderIds: emptyFolders.map(f => f.id),
      });
    }

    // 古い割り当て（存在しないノートへの参照）を削除する提案
    // ※ 実際のノート存在確認は Content Script 側で行う必要がある
    const orphanedAssignments = Object.keys(this.noteAssignments).length;
    if (orphanedAssignments > 100) {
      suggestions.push({
        action: 'CLEANUP_ORPHANED',
        description: `ノート割り当てが ${orphanedAssignments} 件あります。不要な割り当てを整理してください。`,
        savings: Math.floor(orphanedAssignments * 0.1) * 50,
      });
    }

    return suggestions;
  }

  /**
   * 現在のストレージ使用量を推定（バイト）
   * @returns {number}
   */
  _estimateStorageUsage() {
    const data = {
      [STORAGE_KEYS.FOLDERS]: this.folders,
      [STORAGE_KEYS.NOTE_ASSIGNMENTS]: this.noteAssignments,
      [STORAGE_KEYS.SETTINGS]: this.settings,
      [STORAGE_KEYS.VERSION]: CURRENT_VERSION,
    };

    // JSON文字列の長さ×2（UTF-16）で概算
    return JSON.stringify(data).length * 2;
  }

  /**
   * ストレージ使用状況を取得
   * @returns {{ used: number, total: number, percentage: number }}
   */
  getStorageUsage() {
    const used = this._estimateStorageUsage();
    const total = LIMITS.STORAGE_QUOTA_BYTES;
    const percentage = Math.round((used / total) * 100);

    return { used, total, percentage };
  }

  /**
   * ストレージ使用量をチェックし、警告を出す
   */
  _checkStorageUsage() {
    const { used, total, percentage } = this.getStorageUsage();
    const threshold = LIMITS.STORAGE_WARNING_THRESHOLD * 100;

    if (percentage >= threshold && !this._quotaWarningShown) {
      this._quotaWarningShown = true;
      console.warn(`[FolderLM Storage] Storage usage is at ${percentage}% (${used}/${total} bytes)`);

      this._emitError(
        ERROR_TYPES.QUOTA_EXCEEDED,
        `ストレージ使用量が ${percentage}% に達しています。データを整理してください。`,
        {
          used,
          total,
          percentage,
          isWarning: true,
          suggestions: this._getDataReductionSuggestions(),
        }
      );
    } else if (percentage < threshold) {
      this._quotaWarningShown = false;
    }
  }

  /**
   * 空のフォルダを一括削除
   * @returns {{ success: boolean, deletedCount: number }}
   */
  deleteEmptyFolders() {
    const emptyFolders = this.folders.filter(f => {
      if (f.isDefault) return false;
      const noteCount = Object.values(this.noteAssignments)
        .filter(folderId => folderId === f.id).length;
      return noteCount === 0;
    });

    if (emptyFolders.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    const emptyFolderIds = new Set(emptyFolders.map(f => f.id));
    this.folders = this.folders.filter(f => !emptyFolderIds.has(f.id));
    this.save();

    console.log(`[FolderLM Storage] Deleted ${emptyFolders.length} empty folders`);
    return { success: true, deletedCount: emptyFolders.length };
  }

  /**
   * 孤立したノート割り当てを削除
   * @param {string[]} validNoteIds - 有効なノートIDの配列
   * @returns {{ success: boolean, deletedCount: number }}
   */
  cleanupOrphanedAssignments(validNoteIds) {
    if (!Array.isArray(validNoteIds)) {
      return { success: false, deletedCount: 0 };
    }

    const validIds = new Set(validNoteIds);
    const originalCount = Object.keys(this.noteAssignments).length;

    const cleanedAssignments = {};
    for (const [noteId, folderId] of Object.entries(this.noteAssignments)) {
      if (validIds.has(noteId)) {
        cleanedAssignments[noteId] = folderId;
      }
    }

    const deletedCount = originalCount - Object.keys(cleanedAssignments).length;

    if (deletedCount > 0) {
      this.noteAssignments = cleanedAssignments;
      this.save();
      console.log(`[FolderLM Storage] Cleaned up ${deletedCount} orphaned assignments`);
    }

    return { success: true, deletedCount };
  }

  /**
   * 一意のIDを生成
   * @returns {string}
   */
  _generateId() {
    return `folder_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // ==========================================================================
  // 定数のエクスポート
  // ==========================================================================

  /**
   * 「未分類」フォルダのIDを取得
   */
  get UNCATEGORIZED_ID() {
    return UNCATEGORIZED_FOLDER_ID;
  }

  /**
   * 制限値を取得
   */
  get LIMITS() {
    return { ...LIMITS };
  }

  /**
   * エラータイプを取得
   */
  get ERROR_TYPES() {
    return { ...ERROR_TYPES };
  }

  /**
   * デフォルト設定を取得
   */
  get DEFAULT_SETTINGS() {
    return { ...DEFAULT_SETTINGS };
  }
}

// シングルトンインスタンス
export const storageManager = new StorageManager();

// デフォルトエクスポート
export default storageManager;
