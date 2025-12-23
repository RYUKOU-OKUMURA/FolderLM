/**
 * FolderLM - Note ID Parser
 * 
 * NotebookLM のノートカードから一意の UUID を抽出するユーティリティ。
 * aria-labelledby 属性からの抽出を第一候補とし、フォールバックとして URL からの抽出をサポート。
 * 
 * @module idParser
 */

import { ID_PATTERNS, NOTE_SELECTORS } from './selectors.js';

/**
 * ノートカード要素から UUID を抽出する
 * 
 * 抽出戦略:
 * 1. aria-labelledby 属性から project-<UUID>-title 形式で抽出
 * 2. aria-describedby 属性から project-<UUID>-description 形式で抽出
 * 3. 子要素の id 属性から UUID を検索
 * 
 * @param {Element} cardElement - ノートカード要素
 * @returns {string|null} 抽出した UUID、または取得失敗時は null
 */
export function extractNoteIdFromCard(cardElement) {
  if (!cardElement || !(cardElement instanceof Element)) {
    console.warn('[FolderLM] Invalid card element provided');
    return null;
  }

  // 戦略1: aria-labelledby から抽出
  const ariaLabelledby = cardElement.getAttribute('aria-labelledby');
  if (ariaLabelledby) {
    const match = ariaLabelledby.match(ID_PATTERNS.ARIA_LABEL);
    if (match && match[1]) {
      return match[1];
    }
  }

  // 戦略2: aria-describedby から抽出
  const ariaDescribedby = cardElement.getAttribute('aria-describedby');
  if (ariaDescribedby) {
    const match = ariaDescribedby.match(ID_PATTERNS.ARIA_DESCRIBE);
    if (match && match[1]) {
      return match[1];
    }
  }

  // 戦略3: 子要素の id 属性から検索
  const titleElement = cardElement.querySelector(NOTE_SELECTORS.CARD_TITLE);
  if (titleElement) {
    const id = titleElement.getAttribute('id');
    if (id) {
      const match = id.match(ID_PATTERNS.UUID);
      if (match) {
        return match[0];
      }
    }
  }

  // 戦略4: 要素内の任意の id 属性から UUID を検索
  const allElements = cardElement.querySelectorAll('[id]');
  for (const el of allElements) {
    const id = el.getAttribute('id');
    const match = id.match(ID_PATTERNS.UUID);
    if (match) {
      return match[0];
    }
  }

  console.warn('[FolderLM] Could not extract note ID from card element', cardElement);
  return null;
}

/**
 * 現在の URL からノート UUID を抽出する（フォールバック用）
 * 
 * @param {string} [url=window.location.href] - 解析する URL
 * @returns {string|null} 抽出した UUID、または取得失敗時は null
 */
export function extractNoteIdFromUrl(url = window.location.href) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const match = url.match(ID_PATTERNS.URL);
  if (match && match[1]) {
    return match[1];
  }

  return null;
}

/**
 * UUID の形式が正しいかを検証する
 * 
 * @param {string} id - 検証する ID
 * @returns {boolean} 有効な UUID 形式の場合 true
 */
export function isValidUuid(id) {
  if (!id || typeof id !== 'string') {
    return false;
  }

  return ID_PATTERNS.UUID.test(id);
}

/**
 * 複数のノートカード要素から ID マッピングを作成する
 * 
 * @param {Element[]} cardElements - ノートカード要素の配列
 * @returns {Map<string, Element>} UUID から要素へのマッピング
 */
export function createNoteIdMapping(cardElements) {
  const mapping = new Map();
  const duplicates = [];

  for (const card of cardElements) {
    const id = extractNoteIdFromCard(card);
    if (id) {
      if (mapping.has(id)) {
        duplicates.push(id);
        console.warn(`[FolderLM] Duplicate note ID detected: ${id}`);
      } else {
        mapping.set(id, card);
      }
    }
  }

  if (duplicates.length > 0) {
    console.warn(`[FolderLM] ${duplicates.length} duplicate IDs found`);
  }

  return mapping;
}

/**
 * ページ上のすべてのノートカードから ID を抽出し、統計情報を返す
 * 
 * @returns {{ total: number, identified: number, failed: number, ids: string[] }}
 */
export function analyzePageNotes() {
  const cards = document.querySelectorAll(NOTE_SELECTORS.CARD);
  const fallbackCards = document.querySelectorAll(NOTE_SELECTORS.CARD_FALLBACK);
  
  // 重複を除去して結合
  const allCards = new Set([...cards, ...fallbackCards]);
  
  const ids = [];
  let failed = 0;

  for (const card of allCards) {
    const id = extractNoteIdFromCard(card);
    if (id) {
      ids.push(id);
    } else {
      failed++;
    }
  }

  // 重複ID をチェック
  const uniqueIds = [...new Set(ids)];

  return {
    total: allCards.size,
    identified: ids.length,
    failed,
    uniqueCount: uniqueIds.length,
    hasDuplicates: ids.length !== uniqueIds.length,
    ids: uniqueIds,
  };
}

/**
 * デバッグ用: ID 抽出結果をコンソールに出力
 */
export function debugNoteIds() {
  const analysis = analyzePageNotes();
  console.group('[FolderLM] Note ID Analysis');
  console.log(`Total cards: ${analysis.total}`);
  console.log(`Identified: ${analysis.identified}`);
  console.log(`Failed: ${analysis.failed}`);
  console.log(`Unique IDs: ${analysis.uniqueCount}`);
  console.log(`Has duplicates: ${analysis.hasDuplicates}`);
  if (analysis.ids.length <= 10) {
    console.log('IDs:', analysis.ids);
  } else {
    console.log('First 10 IDs:', analysis.ids.slice(0, 10));
  }
  console.groupEnd();
  return analysis;
}
