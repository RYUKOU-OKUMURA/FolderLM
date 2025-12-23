/**
 * FolderLM - Debounce Utility
 * 
 * 頻繁に呼び出される関数の実行を遅延・制御するためのユーティリティ。
 * ストレージ書き込みや DOM 更新の最適化に使用。
 * 
 * @module debounce
 */

/**
 * 関数の実行をデバウンスする
 * 連続した呼び出しの最後の呼び出しから指定時間経過後に実行
 * 
 * @param {Function} func - デバウンスする関数
 * @param {number} wait - 待機時間（ミリ秒）
 * @param {boolean} [immediate=false] - true の場合、最初の呼び出しで即座に実行
 * @returns {Function} デバウンスされた関数
 */
export function debounce(func, wait, immediate = false) {
  let timeout = null;
  let lastArgs = null;
  let lastThis = null;

  function debounced(...args) {
    lastArgs = args;
    lastThis = this;

    const callNow = immediate && !timeout;

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      timeout = null;
      if (!immediate && lastArgs) {
        func.apply(lastThis, lastArgs);
        lastArgs = null;
        lastThis = null;
      }
    }, wait);

    if (callNow) {
      func.apply(this, args);
    }
  }

  /**
   * 保留中のデバウンスをキャンセルする
   */
  debounced.cancel = function() {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    lastArgs = null;
    lastThis = null;
  };

  /**
   * 保留中のデバウンスを即座に実行する
   */
  debounced.flush = function() {
    if (timeout && lastArgs) {
      clearTimeout(timeout);
      timeout = null;
      func.apply(lastThis, lastArgs);
      lastArgs = null;
      lastThis = null;
    }
  };

  /**
   * 保留中のデバウンスがあるかどうかを返す
   * @returns {boolean}
   */
  debounced.pending = function() {
    return timeout !== null;
  };

  return debounced;
}

/**
 * 関数の実行をスロットルする
 * 指定時間内に最大1回だけ実行を許可
 * 
 * @param {Function} func - スロットルする関数
 * @param {number} limit - 制限時間（ミリ秒）
 * @param {Object} [options={}] - オプション
 * @param {boolean} [options.leading=true] - 最初の呼び出しで実行するか
 * @param {boolean} [options.trailing=true] - 最後の呼び出しを実行するか
 * @returns {Function} スロットルされた関数
 */
export function throttle(func, limit, options = {}) {
  const { leading = true, trailing = true } = options;
  
  let lastCall = 0;
  let timeout = null;
  let lastArgs = null;
  let lastThis = null;

  function throttled(...args) {
    const now = Date.now();
    const remaining = limit - (now - lastCall);

    lastArgs = args;
    lastThis = this;

    if (remaining <= 0 || remaining > limit) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      
      if (leading || lastCall !== 0) {
        lastCall = now;
        func.apply(this, args);
      } else if (!lastCall) {
        lastCall = now;
      }
    } else if (!timeout && trailing) {
      timeout = setTimeout(() => {
        lastCall = leading ? Date.now() : 0;
        timeout = null;
        func.apply(lastThis, lastArgs);
        lastArgs = null;
        lastThis = null;
      }, remaining);
    }
  }

  /**
   * スロットルをキャンセルする
   */
  throttled.cancel = function() {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    lastCall = 0;
    lastArgs = null;
    lastThis = null;
  };

  return throttled;
}

/**
 * requestAnimationFrame を使用してバッチ処理を行う
 * DOM 更新の最適化に使用
 * 
 * @param {Function} func - バッチ処理する関数
 * @returns {Function} バッチ処理された関数
 */
export function batchWithRAF(func) {
  let scheduled = false;
  let lastArgs = null;
  let lastThis = null;

  function batched(...args) {
    lastArgs = args;
    lastThis = this;

    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (lastArgs) {
          func.apply(lastThis, lastArgs);
          lastArgs = null;
          lastThis = null;
        }
      });
    }
  }

  /**
   * バッチをキャンセルする
   */
  batched.cancel = function() {
    scheduled = false;
    lastArgs = null;
    lastThis = null;
  };

  return batched;
}

/**
 * 複数の DOM 更新を1フレームにまとめて実行するためのキュー
 */
export class DOMBatchQueue {
  constructor() {
    this.queue = [];
    this.scheduled = false;
  }

  /**
   * DOM 更新タスクをキューに追加
   * @param {Function} task - 実行するタスク
   */
  add(task) {
    this.queue.push(task);
    this.schedule();
  }

  /**
   * キューの実行をスケジュール
   */
  schedule() {
    if (!this.scheduled && this.queue.length > 0) {
      this.scheduled = true;
      requestAnimationFrame(() => {
        this.flush();
      });
    }
  }

  /**
   * キュー内のすべてのタスクを実行
   */
  flush() {
    this.scheduled = false;
    const tasks = this.queue.slice();
    this.queue = [];

    for (const task of tasks) {
      try {
        task();
      } catch (error) {
        console.error('[FolderLM] DOM batch task error:', error);
      }
    }
  }

  /**
   * キューをクリア
   */
  clear() {
    this.queue = [];
    this.scheduled = false;
  }

  /**
   * キュー内のタスク数を返す
   * @returns {number}
   */
  get size() {
    return this.queue.length;
  }
}

// シングルトンインスタンス
export const domBatchQueue = new DOMBatchQueue();
