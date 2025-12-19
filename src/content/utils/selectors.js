/**
 * FolderLM - DOM Selectors
 * 
 * NotebookLM の DOM 要素を特定するためのセレクタ定義。
 * 安定したセレクタのみを使用し、動的に生成される属性（_ngcontent-*, mat-button-toggle-N など）は避ける。
 * 
 * @module selectors
 */

/**
 * ノートカード関連のセレクタ
 */
export const NOTE_SELECTORS = {
  /**
   * ノート一覧のコンテナ要素
   * NotebookLM のノート一覧を包含する要素
   */
  LIST_CONTAINER: '.projects-list, [role="list"]',

  /**
   * 個別のノートカード要素
   * aria-labelledby 属性で project-<UUID>-title を持つ要素を対象とする
   */
  CARD: '[aria-labelledby*="project-"][aria-labelledby*="-title"]',

  /**
   * ノートカードの代替セレクタ（フォールバック用）
   * aria-describedby でも UUID を持つ場合がある
   */
  CARD_FALLBACK: '[aria-describedby*="project-"][aria-describedby*="-description"]',

  /**
   * ノートカード内のタイトル要素
   */
  CARD_TITLE: '[id*="project-"][id*="-title"]',

  /**
   * ノートカード内の説明要素
   */
  CARD_DESCRIPTION: '[id*="project-"][id*="-description"]',
};

/**
 * UI 差し込み位置関連のセレクタ
 */
export const UI_INJECTION_SELECTORS = {
  /**
   * ヘッダーのアクションバー（フォルダボタン挿入位置）
   */
  ACTION_BAR: '.project-actions-container',

  /**
   * アクションバーの代替セレクタ（フォールバック用）
   */
  ACTION_BAR_FALLBACK: '[class*="actions-container"], [class*="toolbar"]',

  /**
   * フィルターボタン群の親要素
   */
  FILTER_GROUP: '.filter-group, [role="tablist"]',

  /**
   * ヘッダー要素
   */
  HEADER: 'header, [role="banner"]',
};

/**
 * NotebookLM 標準フィルタ関連のセレクタ
 */
export const FILTER_SELECTORS = {
  /**
   * 「すべて」タブ
   */
  ALL_TAB: '[data-tab="all"], [aria-label*="すべて"], [aria-label*="All"]',

  /**
   * 「マイノートブック」タブ
   */
  MY_TAB: '[data-tab="owned"], [aria-label*="マイ"], [aria-label*="My"]',

  /**
   * 「共有」タブ
   */
  SHARED_TAB: '[data-tab="shared"], [aria-label*="共有"], [aria-label*="Shared"]',

  /**
   * 現在アクティブなフィルタ
   */
  ACTIVE_FILTER: '[aria-selected="true"], .active, .mat-button-toggle-checked',
};

/**
 * UUID 抽出用の正規表現パターン
 */
export const ID_PATTERNS = {
  /**
   * aria-labelledby から UUID を抽出するパターン
   * 形式: project-<UUID>-title
   */
  ARIA_LABEL: /project-([a-f0-9-]{36})-title/i,

  /**
   * aria-describedby から UUID を抽出するパターン
   * 形式: project-<UUID>-description
   */
  ARIA_DESCRIBE: /project-([a-f0-9-]{36})-description/i,

  /**
   * URL から UUID を抽出するパターン
   * 形式: /notebook/<UUID>
   */
  URL: /\/notebook\/([a-f0-9-]{36})/i,

  /**
   * 汎用 UUID パターン
   */
  UUID: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
};

/**
 * FolderLM が追加する要素のクラス名・ID
 * 既存の NotebookLM 要素と競合しないプレフィックスを使用
 */
export const FOLDERLM_CLASSES = {
  /**
   * FolderLM 共通プレフィックス
   */
  PREFIX: 'folderlm',

  /**
   * フォルダボタン
   */
  FOLDER_BUTTON: 'folderlm-folder-button',

  /**
   * フォルダドロップダウン
   */
  FOLDER_DROPDOWN: 'folderlm-folder-dropdown',

  /**
   * ノート割り当てボタン
   */
  ASSIGN_BUTTON: 'folderlm-assign-button',

  /**
   * フォルダ選択ポップアップ
   */
  SELECT_POPUP: 'folderlm-select-popup',

  /**
   * フォルダバッジ（ノートカードに表示）
   */
  FOLDER_BADGE: 'folderlm-folder-badge',

  /**
   * 非表示状態（フィルタで除外されたノート）
   */
  HIDDEN: 'folderlm-hidden',

  /**
   * 初期化済みマーカー
   */
  INITIALIZED: 'folderlm-initialized',
};

/**
 * データ属性名
 */
export const DATA_ATTRIBUTES = {
  /**
   * ノートID を格納するデータ属性
   */
  NOTE_ID: 'data-folderlm-note-id',

  /**
   * フォルダID を格納するデータ属性
   */
  FOLDER_ID: 'data-folderlm-folder-id',

  /**
   * 初期化状態を示すデータ属性
   */
  INITIALIZED: 'data-folderlm-initialized',
};

/**
 * セレクタが有効かどうかを検証するヘルパー関数
 * @param {string} selector - 検証するセレクタ
 * @returns {boolean} セレクタが有効で要素が存在する場合 true
 */
export function validateSelector(selector) {
  try {
    const element = document.querySelector(selector);
    return element !== null;
  } catch (e) {
    console.warn(`[FolderLM] Invalid selector: ${selector}`, e);
    return false;
  }
}

/**
 * 複数のセレクタから最初に見つかった要素を返す
 * @param {...string} selectors - 試行するセレクタのリスト
 * @returns {Element|null} 見つかった要素、または null
 */
export function findFirstMatch(...selectors) {
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    } catch (e) {
      // セレクタが無効な場合は次を試す
    }
  }
  return null;
}

/**
 * 複数のセレクタからすべての一致要素を返す
 * @param {...string} selectors - 試行するセレクタのリスト
 * @returns {Element[]} 見つかったすべての要素
 */
export function findAllMatches(...selectors) {
  const results = new Set();
  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => results.add(el));
    } catch (e) {
      // セレクタが無効な場合は次を試す
    }
  }
  return Array.from(results);
}
