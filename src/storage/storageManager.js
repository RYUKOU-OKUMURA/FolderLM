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
};

/**
 * Storage Manager クラス
 */
class StorageManager {
  constructor() {
    this.folders = [...DEFAULT_FOLDERS];
    this.noteAssignments = {};
    this.settings = {};
    this.loaded = false;

    // 保存処理をデバウンス（300ms）
    this.debouncedSave = debounce(() => this._save(), 300);
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
      this.settings = data[STORAGE_KEYS.SETTINGS] || {};

      this.loaded = true;
      console.log('[FolderLM Storage] Data loaded:', {
        folders: this.folders.length,
        assignments: Object.keys(this.noteAssignments).length,
      });

    } catch (error) {
      console.error('[FolderLM Storage] Load failed:', error);
      // エラー時は安全なデフォルト値を使用
      this._resetToDefaults();
      throw error;
    }
  }

  /**
   * ストレージにデータを保存（内部用）
   * @returns {Promise<void>}
   */
  async _save() {
    try {
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
      if (error.message?.includes('QUOTA_BYTES')) {
        this._handleQuotaExceeded();
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
    this.settings = {};
    this.loaded = true;
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
    console.error('[FolderLM Storage] Storage quota exceeded');
    // TODO: ユーザー通知とデータ削減の提案
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
}

// シングルトンインスタンス
export const storageManager = new StorageManager();

// デフォルトエクスポート
export default storageManager;
