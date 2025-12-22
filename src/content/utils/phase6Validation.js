/**
 * FolderLM - Phase 6 Validation Utilities
 * 
 * フォルダ分け機能の検証・テストユーティリティ。
 * 以下の項目を検証:
 * - 「すべて / マイ / 共有」タブで FolderLM フィルタとの AND ロジック
 * - filter / sort / group 切替の安定性と復元
 * - NotebookLM のソート変更後にフォルダ並び替えが再適用されること
 * - 多数ノート/連続切替のパフォーマンス（100ノート 16ms 目標）
 * - キーボード操作/スクリーンリーダーのアクセシビリティ
 * 
 * @module content/utils/phase6Validation
 */

import { NOTE_SELECTORS, FOLDERLM_CLASSES, VIEW_MODES, DATA_ATTRIBUTES, FILTER_SELECTORS } from './selectors.js';
import { filterManager } from '../core/filterManager.js';
import { noteDetector } from '../core/noteDetector.js';
import { storageManager } from '../../storage/storageManager.js';
import { DEBUG_EXPOSE_GLOBALS, IS_EXTENSION_CONTEXT } from './debug.js';

/**
 * 検証結果の型
 * @typedef {Object} ValidationResult
 * @property {boolean} passed - 検証に合格したか
 * @property {string} testName - テスト名
 * @property {string} description - 説明
 * @property {number} duration - 実行時間（ミリ秒）
 * @property {Object} details - 詳細情報
 * @property {string[]} errors - エラーメッセージ一覧
 * @property {string[]} warnings - 警告メッセージ一覧
 */

/**
 * Phase6 検証クラス
 */
class Phase6Validator {
  constructor() {
    /** @type {ValidationResult[]} */
    this.results = [];
    
    /** @type {boolean} */
    this.verbose = true;
  }

  /**
   * ログ出力
   * @param {string} message
   * @param {string} [level='log']
   */
  _log(message, level = 'log') {
    if (!this.verbose) return;
    
    const prefix = '[FolderLM Phase6 Validation]';
    switch (level) {
      case 'error':
        console.error(`${prefix} ❌ ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ⚠️ ${message}`);
        break;
      case 'success':
        console.log(`${prefix} ✅ ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }

  /**
   * テスト結果を記録
   * @param {ValidationResult} result
   */
  _recordResult(result) {
    this.results.push(result);
    
    if (result.passed) {
      this._log(`${result.testName}: PASSED (${result.duration.toFixed(2)}ms)`, 'success');
    } else {
      this._log(`${result.testName}: FAILED`, 'error');
      result.errors.forEach(err => this._log(`  - ${err}`, 'error'));
    }
    
    if (result.warnings.length > 0) {
      result.warnings.forEach(warn => this._log(`  - ${warn}`, 'warn'));
    }
  }

  // ==========================================================================
  // 1. AND ロジック検証
  // ==========================================================================

  /**
   * 「すべて / マイ / 共有」タブで FolderLM フィルタとの AND ロジックを検証
   * @returns {Promise<ValidationResult>}
   */
  async validateAndLogic() {
    const startTime = performance.now();
    const errors = [];
    const warnings = [];
    const details = {
      testedCombinations: [],
      visibleCounts: {},
    };

    try {
      // 現在の状態を保存
      const originalFolderId = filterManager.getSelectedFolderId();
      const originalViewMode = filterManager.getViewMode();

      // フォルダを取得
      const folders = storageManager.getFolders();
      const testFolder = folders.find(f => !f.isDefault) || folders[0];

      if (!testFolder) {
        warnings.push('テスト用フォルダが見つかりません');
      }

      // NotebookLM のフィルタタブを取得
      const allTab = document.querySelector(FILTER_SELECTORS.ALL_TAB);
      const myTab = document.querySelector(FILTER_SELECTORS.MY_TAB);
      const sharedTab = document.querySelector(FILTER_SELECTORS.SHARED_TAB);

      const tabs = [
        { name: 'all', element: allTab },
        { name: 'my', element: myTab },
        { name: 'shared', element: sharedTab },
      ].filter(t => t.element);

      // 各タブとフォルダフィルタの組み合わせをテスト
      for (const tab of tabs) {
        // NotebookLM タブをクリック
        if (tab.element && typeof tab.element.click === 'function') {
          tab.element.click();
          await this._wait(200);
        }

        // フォルダなし（すべて表示）
        filterManager.selectFolder(null);
        await this._wait(100);
        const countNoFilter = this._countVisibleNotes();

        // フォルダフィルタ適用
        if (testFolder) {
          filterManager.selectFolder(testFolder.id);
          await this._wait(100);
          const countWithFilter = this._countVisibleNotes();

          details.testedCombinations.push({
            notebookLMTab: tab.name,
            folderId: testFolder.id,
            visibleWithoutFilter: countNoFilter,
            visibleWithFilter: countWithFilter,
          });

          // AND ロジック確認: フィルタ適用後は元以下の数になるべき
          if (countWithFilter > countNoFilter) {
            errors.push(`AND ロジック違反: ${tab.name} タブでフィルタ後のノート数(${countWithFilter})がフィルタ前(${countNoFilter})より多い`);
          }
        }

        // フォルダフィルタを解除
        filterManager.selectFolder(null);
        await this._wait(100);
      }

      // 元の状態に復元
      filterManager.selectFolder(originalFolderId);
      filterManager.setViewMode(originalViewMode);

    } catch (error) {
      errors.push(`テスト中にエラー発生: ${error.message}`);
    }

    const duration = performance.now() - startTime;
    const result = {
      passed: errors.length === 0,
      testName: 'AND ロジック検証',
      description: '「すべて / マイ / 共有」タブで FolderLM フィルタとの AND 条件を検証',
      duration,
      details,
      errors,
      warnings,
    };

    this._recordResult(result);
    return result;
  }

  // ==========================================================================
  // 2. viewMode 切替の安定性検証
  // ==========================================================================

  /**
   * filter / sort / group 切替の安定性と復元を検証
   * @returns {Promise<ValidationResult>}
   */
  async validateViewModeSwitching() {
    const startTime = performance.now();
    const errors = [];
    const warnings = [];
    const details = {
      switchResults: [],
      restorationTest: null,
    };

    try {
      // 現在の状態を保存
      const originalViewMode = filterManager.getViewMode();
      const originalFolderId = filterManager.getSelectedFolderId();

      // すべてのモードを順番に切り替え
      const modes = [VIEW_MODES.FILTER, VIEW_MODES.SORT, VIEW_MODES.GROUP];
      
      for (const mode of modes) {
        const switchStart = performance.now();
        const success = filterManager.setViewMode(mode);
        await this._wait(150);
        const switchDuration = performance.now() - switchStart;

        const currentMode = filterManager.getViewMode();
        const passed = success && currentMode === mode;

        details.switchResults.push({
          fromMode: originalViewMode,
          toMode: mode,
          success,
          currentMode,
          passed,
          duration: switchDuration,
        });

        if (!passed) {
          errors.push(`モード切替失敗: ${mode} への切替で currentMode=${currentMode}`);
        }

        // DOM 状態を確認
        const domState = this._checkViewModeDomState(mode);
        if (!domState.valid) {
          errors.push(`DOM 状態異常: ${mode} モードで ${domState.reason}`);
        }
      }

      // 連続切替テスト（10回）
      const rapidSwitchStart = performance.now();
      for (let i = 0; i < 10; i++) {
        const mode = modes[i % modes.length];
        filterManager.setViewMode(mode);
        await this._wait(50);
      }
      const rapidSwitchDuration = performance.now() - rapidSwitchStart;

      details.rapidSwitchTest = {
        iterations: 10,
        totalDuration: rapidSwitchDuration,
        averagePerSwitch: rapidSwitchDuration / 10,
      };

      if (rapidSwitchDuration / 10 > 100) {
        warnings.push(`連続切替のパフォーマンスが低下: 平均 ${(rapidSwitchDuration / 10).toFixed(2)}ms/切替`);
      }

      // 復元テスト: storageManager から復元できるか
      filterManager.setViewMode(VIEW_MODES.SORT);
      await this._wait(100);
      
      const savedMode = storageManager.getViewMode();
      details.restorationTest = {
        expectedMode: VIEW_MODES.SORT,
        savedMode,
        match: savedMode === VIEW_MODES.SORT,
      };

      if (savedMode !== VIEW_MODES.SORT) {
        errors.push(`復元テスト失敗: 保存されたモード(${savedMode})が期待値(${VIEW_MODES.SORT})と異なる`);
      }

      // 元の状態に復元
      filterManager.setViewMode(originalViewMode);
      filterManager.selectFolder(originalFolderId);

    } catch (error) {
      errors.push(`テスト中にエラー発生: ${error.message}`);
    }

    const duration = performance.now() - startTime;
    const result = {
      passed: errors.length === 0,
      testName: 'viewMode 切替安定性検証',
      description: 'filter / sort / group 切替の安定性と復元を検証',
      duration,
      details,
      errors,
      warnings,
    };

    this._recordResult(result);
    return result;
  }

  // ==========================================================================
  // 3. NotebookLM ソート変更後の再適用検証
  // ==========================================================================

  /**
   * NotebookLM のソート変更後にフォルダ並び替えが再適用されることを検証
   * @returns {Promise<ValidationResult>}
   */
  async validateSortChangeReapply() {
    const startTime = performance.now();
    const errors = [];
    const warnings = [];
    const details = {
      initialState: null,
      afterSimulatedChange: null,
      reapplyTriggered: false,
    };

    try {
      // 現在の状態を保存
      const originalViewMode = filterManager.getViewMode();
      
      // sort モードに切り替え
      filterManager.setViewMode(VIEW_MODES.SORT);
      await this._wait(200);

      // 初期状態を記録
      const container = document.querySelector(NOTE_SELECTORS.LIST_CONTAINER);
      const initialSortedCount = container?.querySelectorAll(`.${FOLDERLM_CLASSES.SORTED}`).length || 0;
      const initialOrderAttrs = this._collectOrderAttributes();

      details.initialState = {
        viewMode: VIEW_MODES.SORT,
        sortedCardCount: initialSortedCount,
        orderAttributes: initialOrderAttrs.length,
      };

      // ソート変更をシミュレート（DOM 変更を検知するため）
      // 注: 実際の NotebookLM ソート変更は手動テストが必要
      if (container) {
        // filterManager.reapplyFilter() を呼び出して再適用をトリガー
        filterManager.resetOriginalIndices();
        await noteDetector.scanNotes();
        filterManager.reapplyFilter();
        await this._wait(200);

        details.reapplyTriggered = true;
      }

      // 再適用後の状態を確認
      const afterSortedCount = container?.querySelectorAll(`.${FOLDERLM_CLASSES.SORTED}`).length || 0;
      const afterOrderAttrs = this._collectOrderAttributes();

      details.afterSimulatedChange = {
        sortedCardCount: afterSortedCount,
        orderAttributes: afterOrderAttrs.length,
        hasOrderAttributes: afterOrderAttrs.length > 0,
      };

      // 検証: sort モードでは order 属性が設定されているべき
      if (afterSortedCount === 0 && initialSortedCount > 0) {
        errors.push('再適用後にソート済みカードが消失');
      }

      // 元の状態に復元
      filterManager.setViewMode(originalViewMode);

    } catch (error) {
      errors.push(`テスト中にエラー発生: ${error.message}`);
    }

    const duration = performance.now() - startTime;
    const result = {
      passed: errors.length === 0,
      testName: 'ソート変更後の再適用検証',
      description: 'NotebookLM のソート変更後にフォルダ並び替えが再適用されることを検証',
      duration,
      details,
      errors,
      warnings,
    };

    this._recordResult(result);
    return result;
  }

  // ==========================================================================
  // 4. パフォーマンス検証
  // ==========================================================================

  /**
   * 多数ノート/連続切替のパフォーマンスを検証（100ノート 16ms 目標）
   * @returns {Promise<ValidationResult>}
   */
  async validatePerformance() {
    const startTime = performance.now();
    const errors = [];
    const warnings = [];
    const details = {
      noteCount: 0,
      singleOperationTimes: {},
      batchOperationTime: null,
      target: '16ms per 100 notes',
    };

    try {
      const noteCount = noteDetector.getAllNoteIds().length;
      details.noteCount = noteCount;

      // 各モードへの切替時間を計測
      const modes = [VIEW_MODES.FILTER, VIEW_MODES.SORT, VIEW_MODES.GROUP];

      for (const mode of modes) {
        const iterations = 5;
        const times = [];

        for (let i = 0; i < iterations; i++) {
          // filter モードにリセット
          filterManager.setViewMode(VIEW_MODES.FILTER);
          await this._wait(50);

          // 対象モードへの切替時間を計測
          const switchStart = performance.now();
          filterManager.setViewMode(mode);
          // 同期的な処理時間のみを計測（DOM 更新を待つ）
          await this._waitForDomUpdate();
          const switchEnd = performance.now();

          times.push(switchEnd - switchStart);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const maxTime = Math.max(...times);
        const minTime = Math.min(...times);

        details.singleOperationTimes[mode] = {
          iterations,
          averageMs: avgTime,
          maxMs: maxTime,
          minMs: minTime,
          timesPerNote: noteCount > 0 ? avgTime / noteCount : 0,
        };

        // 100ノートあたり 16ms を超えているか確認
        const estimatedPer100 = noteCount > 0 ? (avgTime / noteCount) * 100 : avgTime;
        if (estimatedPer100 > 16) {
          warnings.push(`${mode} モード: 100ノートあたり ${estimatedPer100.toFixed(2)}ms（目標: 16ms）`);
        }
      }

      // バッチ操作テスト（連続 20 回切替）
      const batchStart = performance.now();
      for (let i = 0; i < 20; i++) {
        const mode = modes[i % modes.length];
        filterManager.setViewMode(mode);
      }
      await this._waitForDomUpdate();
      const batchEnd = performance.now();

      details.batchOperationTime = {
        totalIterations: 20,
        totalMs: batchEnd - batchStart,
        averagePerSwitch: (batchEnd - batchStart) / 20,
      };

      // filter モードに戻す
      filterManager.setViewMode(VIEW_MODES.FILTER);

    } catch (error) {
      errors.push(`テスト中にエラー発生: ${error.message}`);
    }

    const duration = performance.now() - startTime;
    const result = {
      passed: errors.length === 0,
      testName: 'パフォーマンス検証',
      description: '多数ノート/連続切替のパフォーマンス（100ノート 16ms 目標）',
      duration,
      details,
      errors,
      warnings,
    };

    this._recordResult(result);
    return result;
  }

  // ==========================================================================
  // 5. アクセシビリティ検証
  // ==========================================================================

  /**
   * キーボード操作/スクリーンリーダーのアクセシビリティを検証
   * @returns {Promise<ValidationResult>}
   */
  async validateAccessibility() {
    const startTime = performance.now();
    const errors = [];
    const warnings = [];
    const details = {
      viewModeSelector: {},
      groupHeaders: {},
      folderButton: {},
      overallA11yScore: 0,
    };

    try {
      // 1. viewMode セレクタの A11y チェック
      const viewModeSelectorEl = document.querySelector(`.${FOLDERLM_CLASSES.VIEW_MODE_SELECTOR}`);
      if (viewModeSelectorEl) {
        details.viewModeSelector = {
          hasAriaLabel: viewModeSelectorEl.hasAttribute('aria-label'),
          role: viewModeSelectorEl.getAttribute('role'),
          buttons: [],
        };

        const buttons = viewModeSelectorEl.querySelectorAll('button');
        buttons.forEach((btn, idx) => {
          const btnInfo = {
            index: idx,
            hasRole: btn.getAttribute('role') === 'radio',
            hasAriaChecked: btn.hasAttribute('aria-checked'),
            hasAriaLabel: btn.hasAttribute('aria-label'),
            hasTabindex: btn.hasAttribute('tabindex'),
          };
          details.viewModeSelector.buttons.push(btnInfo);

          if (!btnInfo.hasRole) {
            warnings.push(`viewMode ボタン ${idx}: role="radio" がありません`);
          }
          if (!btnInfo.hasAriaChecked) {
            warnings.push(`viewMode ボタン ${idx}: aria-checked がありません`);
          }
        });
      } else {
        warnings.push('viewMode セレクタが見つかりません（ドロップダウン未展開の可能性）');
      }

      // 2. グループヘッダーの A11y チェック
      const groupHeaders = document.querySelectorAll(`.${FOLDERLM_CLASSES.GROUP_HEADER}`);
      details.groupHeaders = {
        count: groupHeaders.length,
        allHaveAriaHidden: true,
        allHaveRole: true,
        allHaveInert: true,
        allNonFocusable: true,
      };

      groupHeaders.forEach((header, idx) => {
        if (header.getAttribute('aria-hidden') !== 'true') {
          details.groupHeaders.allHaveAriaHidden = false;
          errors.push(`グループヘッダー ${idx}: aria-hidden="true" がありません`);
        }
        if (header.getAttribute('role') !== 'presentation') {
          details.groupHeaders.allHaveRole = false;
          warnings.push(`グループヘッダー ${idx}: role="presentation" がありません`);
        }
        if (!header.hasAttribute('inert')) {
          details.groupHeaders.allHaveInert = false;
          warnings.push(`グループヘッダー ${idx}: inert 属性がありません`);
        }
        if (header.getAttribute('tabindex') !== '-1') {
          details.groupHeaders.allNonFocusable = false;
          errors.push(`グループヘッダー ${idx}: tabindex="-1" がありません`);
        }
      });

      // 3. フォルダボタンの A11y チェック
      const folderButton = document.querySelector(`.${FOLDERLM_CLASSES.FOLDER_BUTTON}`);
      if (folderButton) {
        details.folderButton = {
          hasAriaLabel: folderButton.hasAttribute('aria-label'),
          hasAriaExpanded: folderButton.hasAttribute('aria-expanded'),
          hasTitle: folderButton.hasAttribute('title'),
          isFocusable: folderButton.tabIndex >= 0,
        };

        if (!details.folderButton.hasAriaLabel) {
          errors.push('フォルダボタン: aria-label がありません');
        }
        if (!details.folderButton.isFocusable) {
          errors.push('フォルダボタン: キーボードフォーカスできません');
        }
      } else {
        warnings.push('フォルダボタンが見つかりません');
      }

      // 4. 全体スコア計算
      let score = 100;
      score -= errors.length * 10;
      score -= warnings.length * 3;
      details.overallA11yScore = Math.max(0, score);

    } catch (error) {
      errors.push(`テスト中にエラー発生: ${error.message}`);
    }

    const duration = performance.now() - startTime;
    const result = {
      passed: errors.length === 0,
      testName: 'アクセシビリティ検証',
      description: 'キーボード操作/スクリーンリーダーの退行を検証',
      duration,
      details,
      errors,
      warnings,
    };

    this._recordResult(result);
    return result;
  }

  // ==========================================================================
  // ユーティリティメソッド
  // ==========================================================================

  /**
   * 指定時間待機
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * DOM 更新を待機（requestAnimationFrame 2 回分）
   * @returns {Promise<void>}
   */
  _waitForDomUpdate() {
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }

  /**
   * 可視ノート数をカウント
   * @returns {number}
   */
  _countVisibleNotes() {
    const container = document.querySelector(NOTE_SELECTORS.LIST_CONTAINER);
    if (!container) return 0;

    const cards = container.querySelectorAll(NOTE_SELECTORS.CARD);
    let visibleCount = 0;

    cards.forEach(card => {
      const isHidden = card.classList.contains(FOLDERLM_CLASSES.HIDDEN);
      const isDisplayNone = window.getComputedStyle(card).display === 'none';
      
      if (!isHidden && !isDisplayNone) {
        visibleCount++;
      }
    });

    return visibleCount;
  }

  /**
   * viewMode に応じた DOM 状態を確認
   * @param {string} mode
   * @returns {{valid: boolean, reason: string}}
   */
  _checkViewModeDomState(mode) {
    const container = document.querySelector(NOTE_SELECTORS.LIST_CONTAINER);
    if (!container) {
      return { valid: false, reason: 'コンテナが見つからない' };
    }

    const sortedCards = container.querySelectorAll(`.${FOLDERLM_CLASSES.SORTED}`);
    const groupedCards = container.querySelectorAll(`.${FOLDERLM_CLASSES.GROUPED}`);
    const groupHeaders = container.querySelectorAll(`.${FOLDERLM_CLASSES.GROUP_HEADER}`);

    switch (mode) {
      case VIEW_MODES.FILTER:
        // filter モード: sorted/grouped クラスやグループヘッダーがないこと
        if (sortedCards.length > 0) {
          return { valid: false, reason: 'filter モードで sorted クラスが残っている' };
        }
        if (groupHeaders.length > 0) {
          return { valid: false, reason: 'filter モードでグループヘッダーが残っている' };
        }
        break;

      case VIEW_MODES.SORT:
        // sort モード: ノートがあれば sorted クラスがあること
        const noteCount = container.querySelectorAll(NOTE_SELECTORS.CARD).length;
        if (noteCount > 0 && sortedCards.length === 0) {
          return { valid: false, reason: 'sort モードで sorted クラスがない' };
        }
        // グループヘッダーがないこと
        if (groupHeaders.length > 0) {
          return { valid: false, reason: 'sort モードでグループヘッダーがある' };
        }
        break;

      case VIEW_MODES.GROUP:
        // group モード: 「すべて」選択時のみグループヘッダーがある
        if (!filterManager.isFilterActive() && groupHeaders.length === 0) {
          // ノートが存在するかチェック
          const cards = container.querySelectorAll(NOTE_SELECTORS.CARD);
          if (cards.length > 0) {
            return { valid: false, reason: 'group モード（すべて）でグループヘッダーがない' };
          }
        }
        break;
    }

    return { valid: true, reason: '' };
  }

  /**
   * order 属性を収集
   * @returns {Array<{noteId: string, order: string}>}
   */
  _collectOrderAttributes() {
    const result = [];
    const cards = document.querySelectorAll(`[${DATA_ATTRIBUTES.ORDER}]`);
    
    cards.forEach(card => {
      const noteId = card.getAttribute(DATA_ATTRIBUTES.NOTE_ID) || card.getAttribute('aria-labelledby') || 'unknown';
      const order = card.getAttribute(DATA_ATTRIBUTES.ORDER);
      result.push({ noteId, order });
    });

    return result;
  }

  // ==========================================================================
  // テスト実行
  // ==========================================================================

  /**
   * 全検証を実行
   * @returns {Promise<{passed: boolean, results: ValidationResult[]}>}
   */
  async runAllValidations() {
    this.results = [];
    
    console.group('[FolderLM Phase6 Validation] 全検証開始');
    
    await this.validateAndLogic();
    await this.validateViewModeSwitching();
    await this.validateSortChangeReapply();
    await this.validatePerformance();
    await this.validateAccessibility();

    const allPassed = this.results.every(r => r.passed);
    const passedCount = this.results.filter(r => r.passed).length;
    const totalCount = this.results.length;

    console.log('');
    console.log('========================================');
    console.log(`検証結果: ${passedCount}/${totalCount} 合格`);
    console.log(`全体結果: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log('========================================');
    console.groupEnd();

    return {
      passed: allPassed,
      passedCount,
      totalCount,
      results: this.results,
    };
  }

  /**
   * 検証結果のサマリーを取得
   * @returns {Object}
   */
  getSummary() {
    return {
      total: this.results.length,
      passed: this.results.filter(r => r.passed).length,
      failed: this.results.filter(r => !r.passed).length,
      totalWarnings: this.results.reduce((sum, r) => sum + r.warnings.length, 0),
      totalErrors: this.results.reduce((sum, r) => sum + r.errors.length, 0),
      totalDuration: this.results.reduce((sum, r) => sum + r.duration, 0),
      results: this.results.map(r => ({
        name: r.testName,
        passed: r.passed,
        duration: r.duration,
        errors: r.errors.length,
        warnings: r.warnings.length,
      })),
    };
  }

  /**
   * 詳細レポートを出力
   */
  printDetailedReport() {
    console.group('[FolderLM Phase6] 詳細レポート');
    
    for (const result of this.results) {
      console.group(`${result.passed ? '✅' : '❌'} ${result.testName}`);
      console.log('説明:', result.description);
      console.log('実行時間:', `${result.duration.toFixed(2)}ms`);
      console.log('詳細:', result.details);
      
      if (result.errors.length > 0) {
        console.log('エラー:', result.errors);
      }
      if (result.warnings.length > 0) {
        console.log('警告:', result.warnings);
      }
      
      console.groupEnd();
    }
    
    console.groupEnd();
  }
}

// シングルトンインスタンス
export const phase6Validator = new Phase6Validator();

// グローバル公開（デバッグ用）
if (DEBUG_EXPOSE_GLOBALS && IS_EXTENSION_CONTEXT && typeof window !== 'undefined') {
  window.FolderLMPhase6Validator = phase6Validator;
}

export default phase6Validator;
