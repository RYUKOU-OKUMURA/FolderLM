/**
 * FolderLM - View Mode Selector Component
 * 
 * 表示モード（filter/sort/group）を切り替えるUIコンポーネント。
 * フォルダドロップダウン内に配置され、現在モードのインジケーターを表示。
 * 
 * Phase 5: UI/Styling - filter/sort/group 切替 UI
 * 
 * @module ui/viewModeSelector
 */

import { FOLDERLM_CLASSES, VIEW_MODES } from '../utils/selectors.js';
import { filterManager } from '../core/filterManager.js';
import { storageManager } from '../../storage/storageManager.js';

/**
 * 表示モードの表示名とアイコン定義
 */
const VIEW_MODE_CONFIG = {
  [VIEW_MODES.FILTER]: {
    label: 'フィルタ',
    shortLabel: 'フィルタ',
    icon: '🔍',
    description: '選択したフォルダのノートのみ表示',
    ariaLabel: 'フィルタモード：選択したフォルダのノートのみ表示',
  },
  [VIEW_MODES.SORT]: {
    label: 'ソート',
    shortLabel: 'ソート',
    icon: '↕️',
    description: 'フォルダ順に並べ替え',
    ariaLabel: 'ソートモード：フォルダ順に並べ替え',
  },
  [VIEW_MODES.GROUP]: {
    label: 'グループ',
    shortLabel: 'グループ',
    icon: '📑',
    description: 'フォルダごとにグループ化',
    ariaLabel: 'グループモード：フォルダごとにグループ化して表示',
  },
};

/**
 * ViewModeSelector クラス
 */
class ViewModeSelector {
  constructor() {
    /** @type {HTMLElement|null} */
    this._element = null;

    /** @type {Function|null} */
    this._onModeChange = null;

    /** @type {HTMLElement|null} */
    this._indicatorElement = null;
  }

  /**
   * 現在の表示モードを取得
   * @returns {string}
   */
  getCurrentMode() {
    return filterManager.getViewMode();
  }

  /**
   * モード変更時のコールバックを設定
   * @param {Function} callback - (mode: string) => void
   */
  onModeChange(callback) {
    this._onModeChange = callback;
  }

  /**
   * セレクタ要素を作成して返す
   * ドロップダウンのヘッダー部分に挿入される想定
   * @returns {HTMLElement}
   */
  createSelectorElement() {
    const container = document.createElement('div');
    container.className = FOLDERLM_CLASSES.VIEW_MODE_SELECTOR;
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', '表示モード切替');

    // ラベル
    const label = document.createElement('span');
    label.className = `${FOLDERLM_CLASSES.VIEW_MODE_SELECTOR}-label`;
    label.textContent = '表示:';
    label.id = 'folderlm-viewmode-label';
    container.appendChild(label);

    // ボタングループ
    const buttonGroup = document.createElement('div');
    buttonGroup.className = `${FOLDERLM_CLASSES.VIEW_MODE_SELECTOR}-buttons`;
    buttonGroup.setAttribute('role', 'radiogroup');
    buttonGroup.setAttribute('aria-labelledby', 'folderlm-viewmode-label');

    const currentMode = this.getCurrentMode();

    Object.entries(VIEW_MODE_CONFIG).forEach(([mode, config]) => {
      const button = this._createModeButton(mode, config, mode === currentMode);
      buttonGroup.appendChild(button);
    });

    container.appendChild(buttonGroup);
    this._element = container;

    return container;
  }

  /**
   * モードボタンを作成
   * @param {string} mode - モード識別子
   * @param {Object} config - モード設定
   * @param {boolean} isActive - アクティブかどうか
   * @returns {HTMLElement}
   * @private
   */
  _createModeButton(mode, config, isActive) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${FOLDERLM_CLASSES.VIEW_MODE_SELECTOR}-button`;
    button.setAttribute('data-mode', mode);
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    button.setAttribute('aria-label', config.ariaLabel);
    button.setAttribute('title', config.description);
    button.setAttribute('tabindex', isActive ? '0' : '-1');

    if (isActive) {
      button.classList.add('active');
    }

    // アイコン
    const icon = document.createElement('span');
    icon.className = `${FOLDERLM_CLASSES.VIEW_MODE_SELECTOR}-icon`;
    icon.textContent = config.icon;
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);

    // ラベル
    const labelSpan = document.createElement('span');
    labelSpan.className = `${FOLDERLM_CLASSES.VIEW_MODE_SELECTOR}-text`;
    labelSpan.textContent = config.shortLabel;
    button.appendChild(labelSpan);

    // クリックイベント
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._handleModeClick(mode);
    });

    // キーボードナビゲーション
    button.addEventListener('keydown', (e) => {
      this._handleKeydown(e, mode);
    });

    return button;
  }

  /**
   * モードボタンクリック処理
   * @param {string} mode
   * @private
   */
  _handleModeClick(mode) {
    const currentMode = this.getCurrentMode();
    if (mode === currentMode) {
      return;
    }

    // filterManager を通じてモードを変更
    const success = filterManager.setViewMode(mode);

    if (success) {
      // UI を更新
      this._updateButtonStates(mode);

      // インジケーターを更新
      this.updateIndicator();

      // コールバックを呼び出し
      if (this._onModeChange) {
        this._onModeChange(mode);
      }

      console.log(`[FolderLM ViewModeSelector] Mode changed to: ${mode}`);
    }
  }

  /**
   * ボタンの状態を更新
   * @param {string} activeMode
   * @private
   */
  _updateButtonStates(activeMode) {
    if (!this._element) return;

    const buttons = this._element.querySelectorAll(`.${FOLDERLM_CLASSES.VIEW_MODE_SELECTOR}-button`);
    buttons.forEach(button => {
      const mode = button.getAttribute('data-mode');
      const isActive = mode === activeMode;

      button.classList.toggle('active', isActive);
      button.setAttribute('aria-checked', isActive ? 'true' : 'false');
      button.setAttribute('tabindex', isActive ? '0' : '-1');
    });
  }

  /**
   * キーボードナビゲーション処理
   * @param {KeyboardEvent} event
   * @param {string} currentMode
   * @private
   */
  _handleKeydown(event, currentMode) {
    const modes = Object.keys(VIEW_MODE_CONFIG);
    const currentIndex = modes.indexOf(currentMode);
    let nextIndex = currentIndex;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        nextIndex = (currentIndex + 1) % modes.length;
        break;

      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        nextIndex = (currentIndex - 1 + modes.length) % modes.length;
        break;

      case 'Home':
        event.preventDefault();
        nextIndex = 0;
        break;

      case 'End':
        event.preventDefault();
        nextIndex = modes.length - 1;
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        this._handleModeClick(currentMode);
        return;

      default:
        return;
    }

    if (nextIndex !== currentIndex) {
      const nextMode = modes[nextIndex];
      this._handleModeClick(nextMode);

      // 新しいボタンにフォーカス
      if (this._element) {
        const nextButton = this._element.querySelector(`[data-mode="${nextMode}"]`);
        if (nextButton) {
          nextButton.focus();
        }
      }
    }
  }

  /**
   * インジケーター要素を作成（フォルダボタン付近に表示用）
   * @returns {HTMLElement}
   */
  createIndicatorElement() {
    const indicator = document.createElement('span');
    indicator.className = FOLDERLM_CLASSES.VIEW_MODE_INDICATOR;
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('role', 'status');

    this._indicatorElement = indicator;
    this.updateIndicator();

    return indicator;
  }

  /**
   * インジケーターを更新
   */
  updateIndicator() {
    if (!this._indicatorElement) return;

    const currentMode = this.getCurrentMode();
    const config = VIEW_MODE_CONFIG[currentMode];

    if (config) {
      this._indicatorElement.textContent = config.icon;
      this._indicatorElement.setAttribute('title', `${config.label}モード: ${config.description}`);
      this._indicatorElement.setAttribute('aria-label', config.ariaLabel);
    }

    // filter モードの場合は非表示（デフォルト動作なので表示不要）
    if (currentMode === VIEW_MODES.FILTER) {
      this._indicatorElement.classList.add('hidden');
    } else {
      this._indicatorElement.classList.remove('hidden');
    }
  }

  /**
   * コンポーネントを破棄
   */
  destroy() {
    if (this._element) {
      this._element.remove();
      this._element = null;
    }

    if (this._indicatorElement) {
      this._indicatorElement.remove();
      this._indicatorElement = null;
    }

    this._onModeChange = null;
  }

  /**
   * 要素を取得
   * @returns {HTMLElement|null}
   */
  getElement() {
    return this._element;
  }

  /**
   * インジケーター要素を取得
   * @returns {HTMLElement|null}
   */
  getIndicatorElement() {
    return this._indicatorElement;
  }
}

// シングルトンインスタンス
export const viewModeSelector = new ViewModeSelector();

// デフォルトエクスポート
export default viewModeSelector;
