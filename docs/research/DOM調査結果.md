# FolderLM DOM 調査結果

## 1. 概要

本ドキュメントは NotebookLM の DOM 構造を調査し、FolderLM で使用するセレクタを確定した結果をまとめたものです。

---

## 2. 調査対象ビュー

以下の主要ビューで DOM 構造を確認:

| ビュー | 説明 | セレクタ互換性 |
|--------|------|---------------|
| すべて | 全ノート一覧 | ✅ 同一セレクタ使用可能 |
| マイノートブック | 自分が作成したノート | ✅ 同一セレクタ使用可能 |
| 共有 | 共有されたノート | ✅ 同一セレクタ使用可能 |

---

## 3. 確定セレクタ

### 3.1 ノートカード

| 項目 | セレクタ | 備考 |
|------|----------|------|
| ノートカード（主） | `[aria-labelledby*="project-"][aria-labelledby*="-title"]` | 推奨 |
| ノートカード（代替） | `[aria-describedby*="project-"][aria-describedby*="-description"]` | フォールバック |
| タイトル要素 | `[id*="project-"][id*="-title"]` | タイトル取得用 |
| 説明要素 | `[id*="project-"][id*="-description"]` | 説明取得用 |

### 3.2 ノート一覧コンテナ

| 項目 | セレクタ | 備考 |
|------|----------|------|
| 一覧コンテナ | `.projects-list, [role="list"]` | スクロールコンテナ |

### 3.3 UI 差し込み位置

| 項目 | セレクタ | 備考 |
|------|----------|------|
| アクションバー | `.project-actions-container` | フォルダボタン挿入位置 |
| アクションバー（代替） | `[class*="actions-container"], [class*="toolbar"]` | フォールバック |
| フィルターグループ | `.filter-group, [role="tablist"]` | フィルタボタン群 |
| ヘッダー | `header, [role="banner"]` | ヘッダー全体 |

### 3.4 標準フィルタ

| 項目 | セレクタ | 備考 |
|------|----------|------|
| すべてタブ | `[data-tab="all"], [aria-label*="すべて"], [aria-label*="All"]` | |
| マイタブ | `[data-tab="owned"], [aria-label*="マイ"], [aria-label*="My"]` | |
| 共有タブ | `[data-tab="shared"], [aria-label*="共有"], [aria-label*="Shared"]` | |
| アクティブ | `[aria-selected="true"], .active, .mat-button-toggle-checked` | |

---

## 4. ノート ID 取得

### 4.1 取得戦略（優先順）

1. **aria-labelledby 属性から抽出**
   - 形式: `project-<UUID>-title`
   - 正規表現: `/project-([a-f0-9-]{36})-title/i`
   - 信頼性: 高

2. **aria-describedby 属性から抽出**
   - 形式: `project-<UUID>-description`
   - 正規表現: `/project-([a-f0-9-]{36})-description/i`
   - 信頼性: 高

3. **URL から抽出（フォールバック）**
   - 形式: `/notebook/<UUID>`
   - 正規表現: `/\/notebook\/([a-f0-9-]{36})/i`
   - 信頼性: 中（ノート詳細ページでのみ有効）

### 4.2 検証結果

- 検証ノート数: 77
- 取得成功数: 77
- ユニーク ID 数: 77
- **結論**: ノート数と ID が 1:1 で対応、信頼性が高い

---

## 5. 避けるべきセレクタ

以下のセレクタは動的に変化するため使用禁止:

| パターン | 理由 |
|----------|------|
| `_ngcontent-*` | Angular が自動生成、ビルドごとに変化 |
| `mat-button-toggle-*` | Material コンポーネントの自動採番 |
| 数値のみの ID | 動的に採番される |
| `ng-*` クラス | Angular 内部クラス |

---

## 6. スクロール・再描画の挙動

### 6.1 観測結果

- **仮想スクロール**: 現時点では未確認（全ノート DOM に存在）
- **DOM 再描画**: タブ切替時に発生
- **動的追加**: 新規ノート作成時に DOM が追加される

### 6.2 対応方針

- `MutationObserver` で DOM 変化を監視
- 再描画後に FolderLM の UI を再注入
- デバウンス/バッチ処理で過剰な更新を防止

---

## 7. 実装ファイル

調査結果に基づき、以下のファイルを作成:

```
src/content/utils/
├── selectors.js   # セレクタ定義
├── idParser.js    # ID 抽出ロジック
└── debounce.js    # デバウンス/バッチ処理ユーティリティ
```

---

## 8. 今後の課題

- [ ] 仮想スクロールの有無を大量ノート環境で再検証
- [ ] NotebookLM のアップデートによるセレクタ変化の監視
- [ ] フォールバックセレクタの有効性検証

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2025-12-19 | 初版作成、セレクタ確定 |
