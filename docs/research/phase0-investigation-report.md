# Phase 0 調査報告書

## 概要

フォルダ分け計画の Phase 0（調査フェーズ）の実装完了報告書です。NotebookLM の DOM 構造、レイアウト特性、仮想化の有無などを調査するためのツールとセレクタを実装しました。

## 調査項目と実装内容

### 1. LIST_CONTAINER の display 調査 (`order` 使用可否の判定)

**実装場所**: `src/content/utils/phase0Investigation.js` - `investigateContainer()`

**調査内容**:
- `NOTE_SELECTORS.LIST_CONTAINER` の computed style を取得
- `display` プロパティが `flex`, `inline-flex`, `grid`, `inline-grid` のいずれかかを判定
- CSS `order` プロパティのサポート可否を判定

**結果の見方**:
```javascript
result.containerInfo.orderSupport.supported // true = CSS order 使用可能
result.containerInfo.computedStyle.display  // 'flex', 'grid' など
```

### 2. スクロール時の DOM 差し替え観測（仮想化の有無）

**実装場所**: `src/content/utils/phase0Investigation.js` - `startScrollObservation()`

**調査内容**:
- スクロールイベントでノートカード数の変化を監視
- `MutationObserver` で DOM の追加/削除を監視
- 一定時間後に仮想化の有無を判定

**結果の見方**:
```javascript
result.virtualization.hasVirtualization // true = 仮想化あり
result.virtualization.scrollLog         // スクロール時のカード数変化
result.virtualization.mutationLog       // DOM 変更頻度
```

### 3. aria-labelledby 由来の noteId 抽出の安定性

**実装場所**: `src/content/utils/phase0Investigation.js` - `investigateIdExtraction()`

**調査内容**:
- 全ノートカードから `aria-labelledby` で ID 抽出を試行
- 成功率を計算
- 抽出方法の内訳（aria-labelledby, aria-describedby, data属性）を記録

**結果の見方**:
```javascript
result.idExtraction.stabilityRate       // '100.0%' など
result.idExtraction.extractionMethods   // 各方法の成功数
```

### 4. ヘッダー挿入方式の A11y 影響比較

**実装場所**: `src/content/utils/phase0Investigation.js` - `analyzeA11yImpact()`

**調査内容**:
- DOM 挿入方式のメリット・デメリット
- CSS `::before` 方式のメリット・デメリット
- 推奨される方式の提案

**結果**:
| 方式 | 推奨度 | 理由 |
|------|--------|------|
| DOM 挿入 (`role="separator"`) | **推奨** | スクリーンリーダー対応、明確なセマンティクス |
| CSS `::before` | 非推奨 | スクリーンリーダーから見えない |

### 5. LIST_CONTAINER の computed style 記録

**実装場所**: `src/content/utils/phase0Investigation.js` - `investigateContainer()`

**記録内容**:
- `display`
- `flexDirection`
- `flexWrap`
- `gridTemplateColumns`
- `gridTemplateRows`
- `gap` / `rowGap` / `columnGap`
- `position`
- `overflow` / `overflowY`

### 6. スクロール時の DOM 数変化ログ

**実装場所**: `src/content/utils/phase0Investigation.js` - `_logScrollState()`, `_scrollLog`

**記録内容**:
- タイムスタンプ
- カード数
- スクロール位置

### 7. MutationObserver でのノートカード追加/削除頻度

**実装場所**: `src/content/utils/phase0Investigation.js` - `_startMutationObservation()`, `_mutationLog`

**記録内容**:
- タイムスタンプ
- 変更タイプ
- 追加ノード数
- 削除ノード数

### 8. ノートカードの親タグと子タグの種類

**実装場所**: `src/content/utils/phase0Investigation.js` - `investigateCardStructure()`

**記録内容**:
- カード要素のタグ名、role、aria 属性
- 親要素チェーン（最大5階層）
- リストセマンティクス（ul/ol/role="list"）

## 追加されたセレクタ・定数

### FOLDERLM_CLASSES に追加

```javascript
// グループヘッダー関連
GROUP_HEADER: 'folderlm-group-header',
GROUP_HEADER_LABEL: 'folderlm-group-header-label',
GROUP_HEADER_ICON: 'folderlm-group-header-icon',

// ソート/グループ状態
SORTED: 'folderlm-sorted',
GROUPED: 'folderlm-grouped',
HAS_ORIGINAL_INDEX: 'folderlm-has-original-index',
```

### DATA_ATTRIBUTES に追加

```javascript
// 並べ替え関連
ORIGINAL_INDEX: 'data-folderlm-original-index',
ORDER: 'data-folderlm-order',
GROUP_FOLDER_ID: 'data-folderlm-group-folder-id',
```

### VIEW_MODES（新規追加）

```javascript
export const VIEW_MODES = {
  FILTER: 'filter',  // 現行と同様（非該当ノートを非表示）
  SORT: 'sort',      // フォルダ順に並べ替え、ヘッダーなし（MVP）
  GROUP: 'group',    // フォルダ順 + グループヘッダー表示
};
```

## 使用方法

### DevTools から調査を実行

```javascript
// 全調査を実行
const result = window.FolderLMPhase0.runFullInvestigation();

// スクロール監視を開始（10秒間）
window.FolderLMPhase0.startScrollObservation(10000).then(result => {
  console.log('Virtualization:', result);
});

// JSON レポートを取得
const json = window.FolderLMPhase0.getJsonReport();
```

### モジュールからインポート

```javascript
import { phase0Investigator } from './utils/phase0Investigation.js';

const result = phase0Investigator.runFullInvestigation();
```

## 次のステップ（Phase 1 以降）

1. **Phase 1 - 設定/状態**: `viewMode` の保存/復元、`filterManager` への統合
2. **Phase 2 - sort (MVP)**: フォルダ順並べ替えの実装
3. **Phase 3 - group**: グループヘッダーの実装
4. **Phase 4 - Recovery**: DOM 変化への対応
5. **Phase 5 - UI/Styling**: 切替 UI とスタイリング
6. **Phase 6 - Validation**: 検証

## ファイル一覧

| ファイル | 変更内容 |
|----------|----------|
| `src/content/utils/phase0Investigation.js` | 新規作成 - 調査スクリプト |
| `src/content/utils/selectors.js` | 追加 - グループヘッダー/並べ替え用のセレクタ・定数 |
| `docs/research/phase0-investigation-report.md` | 新規作成 - この報告書 |

## 調査の推奨事項まとめ

調査スクリプトは実行時に以下の推奨事項を自動生成します：

| 項目 | 推奨 |
|------|------|
| 並べ替え方式 | `css_order`（flex/grid の場合）または `dom_reorder` |
| ヘッダー挿入方式 | `dom_insertion`（role="separator" 使用） |
| 仮想化対応 | `observer_based`（仮想化あり）または `standard` |

---

作成日: 2025-12-20
Phase: 0 - 調査
ステータス: 完了
