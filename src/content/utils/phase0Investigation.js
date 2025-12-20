/**
 * FolderLM - Phase 0 Investigation
 * 
 * フォルダ分け機能実装のための DOM 調査スクリプト。
 * NotebookLM のノート一覧の構造、レイアウト、仮想化の有無などを調査する。
 * 
 * @module content/utils/phase0Investigation
 */

import { NOTE_SELECTORS, ID_PATTERNS, FOLDERLM_CLASSES } from './selectors.js';
import { noteDetector } from '../core/noteDetector.js';

/**
 * 調査結果の型定義
 * @typedef {Object} InvestigationResult
 * @property {Object} containerInfo - LIST_CONTAINER の情報
 * @property {Object} cardStructure - ノートカードの構造情報
 * @property {Object} idExtraction - ID 抽出の安定性
 * @property {Object} virtualization - 仮想化の有無
 * @property {Object} a11yAnalysis - アクセシビリティ分析
 * @property {Object} recommendations - 推奨事項
 */

/**
 * Phase0Investigator クラス
 * DOM 調査を実行し、結果をレポートする
 */
class Phase0Investigator {
  constructor() {
    /**
     * 調査結果
     * @type {InvestigationResult|null}
     */
    this.result = null;

    /**
     * MutationObserver インスタンス
     * @type {MutationObserver|null}
     */
    this._observer = null;

    /**
     * DOM 変更ログ
     * @type {Array<{timestamp: number, type: string, count: number}>}
     */
    this._mutationLog = [];

    /**
     * スクロール監視用
     * @type {number|null}
     */
    this._scrollObservationId = null;

    /**
     * スクロール時の DOM 数記録
     * @type {Array<{timestamp: number, cardCount: number, scrollY: number}>}
     */
    this._scrollLog = [];
  }

  // ==========================================================================
  // メイン調査メソッド
  // ==========================================================================

  /**
   * 全調査を実行
   * @returns {InvestigationResult}
   */
  runFullInvestigation() {
    console.group('[FolderLM Phase0] Starting full investigation...');
    
    const result = {
      timestamp: new Date().toISOString(),
      containerInfo: this.investigateContainer(),
      cardStructure: this.investigateCardStructure(),
      idExtraction: this.investigateIdExtraction(),
      a11yAnalysis: this.analyzeA11yImpact(),
      recommendations: {},
    };

    // 推奨事項を生成
    result.recommendations = this.generateRecommendations(result);
    
    this.result = result;
    
    console.groupEnd();
    this.printReport(result);
    
    return result;
  }

  // ==========================================================================
  // 1. LIST_CONTAINER の調査
  // ==========================================================================

  /**
   * LIST_CONTAINER の display タイプと computed style を調査
   * @returns {Object}
   */
  investigateContainer() {
    console.log('[FolderLM Phase0] Investigating LIST_CONTAINER...');
    
    const container = this._findListContainer();
    
    if (!container) {
      return {
        found: false,
        selector: NOTE_SELECTORS.LIST_CONTAINER,
        error: 'LIST_CONTAINER not found',
      };
    }

    const computedStyle = window.getComputedStyle(container);
    
    const info = {
      found: true,
      selector: NOTE_SELECTORS.LIST_CONTAINER,
      element: {
        tagName: container.tagName.toLowerCase(),
        id: container.id || null,
        className: container.className,
        role: container.getAttribute('role'),
        ariaLabel: container.getAttribute('aria-label'),
      },
      computedStyle: {
        display: computedStyle.display,
        flexDirection: computedStyle.flexDirection,
        flexWrap: computedStyle.flexWrap,
        gridTemplateColumns: computedStyle.gridTemplateColumns,
        gridTemplateRows: computedStyle.gridTemplateRows,
        gap: computedStyle.gap,
        rowGap: computedStyle.rowGap,
        columnGap: computedStyle.columnGap,
        position: computedStyle.position,
        overflow: computedStyle.overflow,
        overflowY: computedStyle.overflowY,
      },
      dimensions: {
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
        scrollWidth: container.scrollWidth,
        scrollHeight: container.scrollHeight,
      },
      orderSupport: this._checkOrderSupport(computedStyle),
    };

    console.log('[FolderLM Phase0] Container info:', info);
    return info;
  }

  /**
   * CSS order プロパティのサポートを確認
   * @param {CSSStyleDeclaration} computedStyle
   * @returns {Object}
   */
  _checkOrderSupport(computedStyle) {
    const display = computedStyle.display;
    
    // flex または grid の場合、order プロパティが有効
    const isFlexOrGrid = display === 'flex' || 
                         display === 'inline-flex' || 
                         display === 'grid' || 
                         display === 'inline-grid';
    
    return {
      supported: isFlexOrGrid,
      displayType: display,
      reason: isFlexOrGrid 
        ? `${display} layout supports CSS order property`
        : `${display} layout does not support CSS order property - DOM reordering needed`,
    };
  }

  /**
   * LIST_CONTAINER を見つける
   * @returns {Element|null}
   */
  _findListContainer() {
    // 複数のセレクタを試行
    const selectors = NOTE_SELECTORS.LIST_CONTAINER.split(',').map(s => s.trim());
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }
    
    // フォールバック: ノートカードの親要素を探す
    const card = document.querySelector(NOTE_SELECTORS.CARD);
    if (card) {
      // role="list" を持つ親、または closest で見つける
      const listParent = card.closest('[role="list"]') || card.parentElement;
      return listParent;
    }
    
    return null;
  }

  // ==========================================================================
  // 2. ノートカード構造の調査
  // ==========================================================================

  /**
   * ノートカードの DOM 構造を調査
   * @returns {Object}
   */
  investigateCardStructure() {
    console.log('[FolderLM Phase0] Investigating card structure...');
    
    const cards = document.querySelectorAll(NOTE_SELECTORS.CARD);
    
    if (cards.length === 0) {
      return {
        found: false,
        selector: NOTE_SELECTORS.CARD,
        error: 'No note cards found',
      };
    }

    // 最初のカードを詳細分析
    const sampleCard = cards[0];
    const parentAnalysis = this._analyzeParentChain(sampleCard);
    
    const structure = {
      found: true,
      selector: NOTE_SELECTORS.CARD,
      totalCards: cards.length,
      sampleCard: {
        tagName: sampleCard.tagName.toLowerCase(),
        role: sampleCard.getAttribute('role'),
        ariaLabelledby: sampleCard.getAttribute('aria-labelledby'),
        ariaDescribedby: sampleCard.getAttribute('aria-describedby'),
        className: sampleCard.className,
        childElements: this._getChildElementSummary(sampleCard),
      },
      parentChain: parentAnalysis,
      listSemantics: this._analyzeListSemantics(sampleCard),
    };

    console.log('[FolderLM Phase0] Card structure:', structure);
    return structure;
  }

  /**
   * 親要素チェーンを分析
   * @param {Element} element
   * @returns {Array}
   */
  _analyzeParentChain(element) {
    const chain = [];
    let current = element.parentElement;
    let depth = 0;
    const maxDepth = 5;

    while (current && depth < maxDepth) {
      chain.push({
        depth,
        tagName: current.tagName.toLowerCase(),
        role: current.getAttribute('role'),
        className: current.className ? current.className.split(' ').slice(0, 3).join(' ') : '',
        childCount: current.children.length,
      });
      current = current.parentElement;
      depth++;
    }

    return chain;
  }

  /**
   * 子要素のサマリーを取得
   * @param {Element} element
   * @returns {Array}
   */
  _getChildElementSummary(element) {
    const summary = [];
    for (const child of element.children) {
      summary.push({
        tagName: child.tagName.toLowerCase(),
        role: child.getAttribute('role'),
        id: child.id || null,
        hasTextContent: child.textContent.trim().length > 0,
      });
    }
    return summary.slice(0, 5); // 最初の5つのみ
  }

  /**
   * リストセマンティクスを分析
   * @param {Element} card
   * @returns {Object}
   */
  _analyzeListSemantics(card) {
    const listParent = card.closest('[role="list"]');
    const listitem = card.closest('[role="listitem"]');
    const ulParent = card.closest('ul');
    const olParent = card.closest('ol');

    return {
      hasRoleList: !!listParent,
      hasRoleListitem: !!listitem,
      hasSemanticList: !!(ulParent || olParent),
      listType: ulParent ? 'ul' : olParent ? 'ol' : listParent ? 'role="list"' : 'none',
      cardIsListitem: card.getAttribute('role') === 'listitem',
    };
  }

  // ==========================================================================
  // 3. ID 抽出の安定性調査
  // ==========================================================================

  /**
   * aria-labelledby からの noteId 抽出の安定性を確認
   * @returns {Object}
   */
  investigateIdExtraction() {
    console.log('[FolderLM Phase0] Investigating ID extraction stability...');
    
    const cards = document.querySelectorAll(NOTE_SELECTORS.CARD);
    const results = {
      totalCards: cards.length,
      successfulExtractions: 0,
      failedExtractions: 0,
      extractionMethods: {
        ariaLabelledby: 0,
        ariaDescribedby: 0,
        dataAttribute: 0,
        failed: 0,
      },
      samples: [],
      idPattern: ID_PATTERNS.ARIA_LABEL.toString(),
    };

    for (const card of cards) {
      const extraction = this._extractAndAnalyzeId(card);
      
      if (extraction.success) {
        results.successfulExtractions++;
        results.extractionMethods[extraction.method]++;
      } else {
        results.failedExtractions++;
        results.extractionMethods.failed++;
      }

      // 最初の5件をサンプルとして記録
      if (results.samples.length < 5) {
        results.samples.push(extraction);
      }
    }

    results.stabilityRate = results.totalCards > 0 
      ? (results.successfulExtractions / results.totalCards * 100).toFixed(1) + '%'
      : 'N/A';

    console.log('[FolderLM Phase0] ID extraction results:', results);
    return results;
  }

  /**
   * 単一カードからIDを抽出して分析
   * @param {Element} card
   * @returns {Object}
   */
  _extractAndAnalyzeId(card) {
    const result = {
      success: false,
      method: null,
      noteId: null,
      rawAttribute: null,
    };

    // 1. aria-labelledby から抽出
    const ariaLabelledby = card.getAttribute('aria-labelledby');
    if (ariaLabelledby) {
      result.rawAttribute = ariaLabelledby;
      const match = ariaLabelledby.match(ID_PATTERNS.ARIA_LABEL);
      if (match) {
        result.success = true;
        result.method = 'ariaLabelledby';
        result.noteId = match[1];
        return result;
      }
    }

    // 2. aria-describedby から抽出（フォールバック）
    const ariaDescribedby = card.getAttribute('aria-describedby');
    if (ariaDescribedby) {
      result.rawAttribute = ariaDescribedby;
      const match = ariaDescribedby.match(ID_PATTERNS.ARIA_DESCRIBE);
      if (match) {
        result.success = true;
        result.method = 'ariaDescribedby';
        result.noteId = match[1];
        return result;
      }
    }

    // 3. data 属性から抽出（既に処理済みの場合）
    const dataId = card.getAttribute('data-folderlm-note-id');
    if (dataId && ID_PATTERNS.UUID.test(dataId)) {
      result.success = true;
      result.method = 'dataAttribute';
      result.noteId = dataId;
      return result;
    }

    return result;
  }

  // ==========================================================================
  // 4. 仮想化・スクロール監視
  // ==========================================================================

  /**
   * スクロール時の DOM 変化を監視開始
   * @param {number} durationMs - 監視時間（ミリ秒）
   * @returns {Promise<Object>}
   */
  startScrollObservation(durationMs = 10000) {
    console.log(`[FolderLM Phase0] Starting scroll observation for ${durationMs}ms...`);
    
    this._scrollLog = [];
    const container = this._findListContainer();
    
    if (!container) {
      return Promise.resolve({
        error: 'LIST_CONTAINER not found',
        virtualization: 'unknown',
      });
    }

    // 初期状態を記録
    this._logScrollState(container);

    // スクロールイベントをリッスン
    const scrollHandler = () => {
      this._logScrollState(container);
    };

    // スクロール可能な要素を特定
    const scrollableElement = this._findScrollableParent(container) || window;
    scrollableElement.addEventListener('scroll', scrollHandler, { passive: true });

    // MutationObserver で DOM 変更を監視
    this._startMutationObservation(container);

    return new Promise((resolve) => {
      setTimeout(() => {
        scrollableElement.removeEventListener('scroll', scrollHandler);
        this._stopMutationObservation();
        
        const result = this._analyzeVirtualization();
        console.log('[FolderLM Phase0] Scroll observation complete:', result);
        resolve(result);
      }, durationMs);
    });
  }

  /**
   * スクロール状態をログに記録
   * @param {Element} container
   */
  _logScrollState(container) {
    const cards = container.querySelectorAll(NOTE_SELECTORS.CARD);
    this._scrollLog.push({
      timestamp: Date.now(),
      cardCount: cards.length,
      scrollY: window.scrollY,
    });
  }

  /**
   * スクロール可能な親要素を見つける
   * @param {Element} element
   * @returns {Element|null}
   */
  _findScrollableParent(element) {
    let current = element;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.overflowY === 'scroll' || style.overflowY === 'auto') {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  /**
   * MutationObserver を開始
   * @param {Element} container
   */
  _startMutationObservation(container) {
    this._mutationLog = [];
    
    this._observer = new MutationObserver((mutations) => {
      let addedCount = 0;
      let removedCount = 0;
      
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          addedCount += mutation.addedNodes.length;
          removedCount += mutation.removedNodes.length;
        }
      }

      if (addedCount > 0 || removedCount > 0) {
        this._mutationLog.push({
          timestamp: Date.now(),
          type: 'childList',
          added: addedCount,
          removed: removedCount,
        });
      }
    });

    this._observer.observe(container, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * MutationObserver を停止
   */
  _stopMutationObservation() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }

  /**
   * 仮想化の有無を分析
   * @returns {Object}
   */
  _analyzeVirtualization() {
    const scrollLogAnalysis = {
      totalEntries: this._scrollLog.length,
      cardCountVariation: new Set(this._scrollLog.map(l => l.cardCount)).size > 1,
      minCardCount: Math.min(...this._scrollLog.map(l => l.cardCount)),
      maxCardCount: Math.max(...this._scrollLog.map(l => l.cardCount)),
    };

    const mutationLogAnalysis = {
      totalMutations: this._mutationLog.length,
      totalAdded: this._mutationLog.reduce((sum, m) => sum + m.added, 0),
      totalRemoved: this._mutationLog.reduce((sum, m) => sum + m.removed, 0),
    };

    // 仮想化の判定
    const hasVirtualization = 
      scrollLogAnalysis.cardCountVariation ||
      mutationLogAnalysis.totalMutations > 10;

    return {
      hasVirtualization,
      confidence: hasVirtualization ? 'high' : 'low',
      scrollLog: scrollLogAnalysis,
      mutationLog: mutationLogAnalysis,
      rawScrollLog: this._scrollLog.slice(0, 10), // 最初の10件
      rawMutationLog: this._mutationLog.slice(0, 10), // 最初の10件
      recommendation: hasVirtualization
        ? 'Virtualization detected - need to handle DOM recycling'
        : 'No virtualization detected - standard DOM manipulation should work',
    };
  }

  // ==========================================================================
  // 5. A11y 影響分析
  // ==========================================================================

  /**
   * ヘッダー挿入方式のアクセシビリティ影響を分析
   * @returns {Object}
   */
  analyzeA11yImpact() {
    console.log('[FolderLM Phase0] Analyzing A11y impact...');
    
    const container = this._findListContainer();
    const cards = document.querySelectorAll(NOTE_SELECTORS.CARD);
    
    const analysis = {
      currentStructure: {
        hasRoleList: container?.getAttribute('role') === 'list',
        hasAriaLabel: !!container?.getAttribute('aria-label'),
        cardCount: cards.length,
        cardsWithAriaLabelledby: 0,
        cardsWithRole: 0,
      },
      headerInsertionOptions: {
        domInsertion: {
          description: 'Insert <div role="separator"> or heading element',
          pros: [
            'Clear visual and semantic separation',
            'Screen reader announces group names',
            'Standard HTML approach',
          ],
          cons: [
            'May break list item counting for screen readers',
            'Requires careful role management',
            'More DOM manipulation needed',
          ],
          recommendation: 'Use role="separator" with aria-label for group names',
        },
        cssBeforeAfter: {
          description: 'Use ::before pseudo-element with content',
          pros: [
            'No DOM structure changes',
            'Easier to remove/modify',
            'Better for performance',
          ],
          cons: [
            'Not accessible to screen readers',
            'Limited styling options',
            'Content not selectable',
          ],
          recommendation: 'Not recommended for accessibility',
        },
      },
      recommendedApproach: 'domInsertion',
      recommendedElement: '<div role="separator" aria-label="[フォルダ名]" class="folderlm-group-header">',
    };

    // 現在のカード構造を分析
    for (const card of cards) {
      if (card.getAttribute('aria-labelledby')) {
        analysis.currentStructure.cardsWithAriaLabelledby++;
      }
      if (card.getAttribute('role')) {
        analysis.currentStructure.cardsWithRole++;
      }
    }

    console.log('[FolderLM Phase0] A11y analysis:', analysis);
    return analysis;
  }

  // ==========================================================================
  // 6. 推奨事項の生成
  // ==========================================================================

  /**
   * 調査結果から推奨事項を生成
   * @param {InvestigationResult} result
   * @returns {Object}
   */
  generateRecommendations(result) {
    const recommendations = {
      orderStrategy: 'unknown',
      headerStrategy: 'unknown',
      virtualizationHandling: 'unknown',
      priority: [],
    };

    // CSS order サポートの推奨
    if (result.containerInfo.orderSupport?.supported) {
      recommendations.orderStrategy = 'css_order';
      recommendations.priority.push('Use CSS order property for sorting (no DOM reorder needed)');
    } else {
      recommendations.orderStrategy = 'dom_reorder';
      recommendations.priority.push('Use DOM reordering for sorting (CSS order not supported)');
    }

    // ヘッダー挿入の推奨
    recommendations.headerStrategy = 'dom_insertion';
    recommendations.priority.push('Use DOM insertion with role="separator" for group headers');

    // 仮想化対応の推奨
    if (result.virtualization?.hasVirtualization) {
      recommendations.virtualizationHandling = 'observer_based';
      recommendations.priority.push('Implement MutationObserver to handle DOM recycling');
    } else {
      recommendations.virtualizationHandling = 'standard';
      recommendations.priority.push('Standard DOM manipulation should work');
    }

    // ID 抽出の推奨
    if (result.idExtraction?.stabilityRate !== '100.0%') {
      recommendations.priority.push('Implement fallback ID extraction methods');
    }

    return recommendations;
  }

  // ==========================================================================
  // レポート出力
  // ==========================================================================

  /**
   * 調査結果をコンソールにレポート
   * @param {InvestigationResult} result
   */
  printReport(result) {
    console.log('\n');
    console.log('='.repeat(60));
    console.log('[FolderLM Phase 0] Investigation Report');
    console.log('='.repeat(60));
    console.log(`Timestamp: ${result.timestamp}`);
    console.log('');

    // 1. コンテナ情報
    console.log('1. LIST_CONTAINER');
    console.log('-'.repeat(40));
    if (result.containerInfo.found) {
      console.log(`   Element: <${result.containerInfo.element.tagName}>`);
      console.log(`   Display: ${result.containerInfo.computedStyle.display}`);
      console.log(`   Flex Direction: ${result.containerInfo.computedStyle.flexDirection}`);
      console.log(`   Gap: ${result.containerInfo.computedStyle.gap}`);
      console.log(`   CSS order support: ${result.containerInfo.orderSupport.supported ? 'YES' : 'NO'}`);
      console.log(`   Reason: ${result.containerInfo.orderSupport.reason}`);
    } else {
      console.log(`   ERROR: ${result.containerInfo.error}`);
    }
    console.log('');

    // 2. カード構造
    console.log('2. Card Structure');
    console.log('-'.repeat(40));
    if (result.cardStructure.found) {
      console.log(`   Total cards: ${result.cardStructure.totalCards}`);
      console.log(`   Card element: <${result.cardStructure.sampleCard.tagName}>`);
      console.log(`   Card role: ${result.cardStructure.sampleCard.role || 'none'}`);
      console.log(`   List semantics: ${result.cardStructure.listSemantics.listType}`);
      console.log(`   Parent chain:`);
      result.cardStructure.parentChain.forEach(p => {
        console.log(`     ${' '.repeat(p.depth * 2)}<${p.tagName}> role="${p.role || 'none'}" children=${p.childCount}`);
      });
    } else {
      console.log(`   ERROR: ${result.cardStructure.error}`);
    }
    console.log('');

    // 3. ID 抽出
    console.log('3. ID Extraction Stability');
    console.log('-'.repeat(40));
    console.log(`   Total cards: ${result.idExtraction.totalCards}`);
    console.log(`   Successful: ${result.idExtraction.successfulExtractions}`);
    console.log(`   Failed: ${result.idExtraction.failedExtractions}`);
    console.log(`   Stability rate: ${result.idExtraction.stabilityRate}`);
    console.log(`   Methods used:`);
    console.log(`     - aria-labelledby: ${result.idExtraction.extractionMethods.ariaLabelledby}`);
    console.log(`     - aria-describedby: ${result.idExtraction.extractionMethods.ariaDescribedby}`);
    console.log(`     - data attribute: ${result.idExtraction.extractionMethods.dataAttribute}`);
    console.log('');

    // 4. A11y 分析
    console.log('4. Accessibility Analysis');
    console.log('-'.repeat(40));
    console.log(`   Recommended header approach: ${result.a11yAnalysis.recommendedApproach}`);
    console.log(`   Recommended element: ${result.a11yAnalysis.recommendedElement}`);
    console.log('');

    // 5. 推奨事項
    console.log('5. Recommendations');
    console.log('-'.repeat(40));
    console.log(`   Order strategy: ${result.recommendations.orderStrategy}`);
    console.log(`   Header strategy: ${result.recommendations.headerStrategy}`);
    console.log(`   Virtualization handling: ${result.recommendations.virtualizationHandling}`);
    console.log(`   Priority actions:`);
    result.recommendations.priority.forEach((p, i) => {
      console.log(`     ${i + 1}. ${p}`);
    });
    
    console.log('');
    console.log('='.repeat(60));
    console.log('[FolderLM Phase 0] End of Report');
    console.log('='.repeat(60));
  }

  /**
   * JSON 形式でレポートを取得
   * @returns {string}
   */
  getJsonReport() {
    return JSON.stringify(this.result, null, 2);
  }
}

/**
 * シングルトンインスタンス
 */
export const phase0Investigator = new Phase0Investigator();

/**
 * デフォルトエクスポート
 */
export default phase0Investigator;

/**
 * グローバルに公開（DevTools からアクセス可能にする）
 */
if (typeof window !== 'undefined') {
  window.FolderLMPhase0 = phase0Investigator;
}
