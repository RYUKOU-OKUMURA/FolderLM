# MVP実装計画

## 0. 事前確認（完了済み）
- [x] 要件定義書の清書（`docs/要件定義書_清書.md`）
- [x] アーキテクチャ清書（`docs/アーキテクチャ清書.md`）
- [x] ノートIDの安定取得を検証（`aria-labelledby` から UUID を抽出可能）

---

## 1. DOM 調査の確定
- [x] NotebookLM 主要ビュー（すべて/マイ/共有）で同一セレクタが使えるか確認
- [x] ノート一覧コンテナの安定セレクタを確定
- [x] ノートカードの安定セレクタを確定
- [x] UI 差し込み位置（アクションバー）の安定セレクタを確定
- [x] スクロール時の DOM 再描画/仮想スクロールの有無を確認

**実装成果物:**
- `src/content/utils/selectors.js` - セレクタ定義
- `src/content/utils/idParser.js` - ノートID抽出ロジック
- `src/content/utils/debounce.js` - デバウンス/バッチ処理ユーティリティ
- `docs/research/DOM調査結果.md` - 調査結果ドキュメント

---

## 2. プロジェクト初期構成
- [x] `extension/manifest.json` を作成（MV3、storage 権限、host 権限）
- [x] `src/content/index.js` と `content.css` を用意
- [x] `src/storage/storageManager.js` の骨組みを作成
- [x] `src/content/utils/` に `selectors.js`, `idParser.js`, `debounce.js` を作成
- [x] 拡張機能を Chrome に読み込める状態にする

---

## 3. データモデルとストレージ
- [x] データ初期値（folders / noteAssignments）を定義
- [x] 「未分類」固定フォルダの初期化ロジック
- [x] `storageManager.load()` の実装（バリデーション含む）
- [x] `storageManager.save()` の実装（デバウンス）
- [x] ストレージ容量超過時のエラーハンドリング

---

## 4. ノート検出と ID 取得
- [x] `selectors.js` に安定セレクタを定義
- [x] `idParser.js` に UUID 抽出ロジックを実装（`aria-labelledby`）
- [x] フォールバックとして URL からの UUID 抽出を実装
- [x] `noteDetector.js` でノートカードと ID のマッピングを作成
- [x] 取得失敗時の安全停止（UI 非表示 + 通知）

**実装成果物:**
- `src/content/core/noteDetector.js` - ノート検出とIDマッピング管理
- `src/content/core/safetyManager.js` - 安全停止とユーザー通知管理
- `src/content/index.js` - 統合と初期化フロー更新

---

## 5. フォルダ UI（ヘッダー）
- [x] ヘッダーアクションバーにフォルダボタンを挿入
- [x] フォルダドロップダウンの UI 実装
- [x] 新規フォルダ作成 UI（バリデーション含む）
- [x] 重複名/空文字/最大文字数の制御
- [x] クリック外で閉じる/キーボード操作対応

**実装成果物:**
- `src/content/ui/folderButton.js` - フォルダボタンコンポーネント
- `src/content/ui/folderDropdown.js` - フォルダドロップダウンコンポーネント
- `src/content/index.js` - UI統合と初期化フロー更新

---

## 6. ノート割り当て UI
- [x] ノートカードに📁割り当てボタンを表示（ホバー時）
- [x] フォルダ選択ポップアップの実装
- [x] 選択結果を `noteAssignments` に反映
- [x] 割り当て済み状態をカード上に表示

**実装成果物:**
- `src/content/ui/noteAssignButton.js` - 割り当てボタンコンポーネント
- `src/content/ui/folderSelectPopup.js` - フォルダ選択ポップアップコンポーネント
- `src/content/index.js` - UI統合と初期化フロー更新
- `src/content/content.css` - スタイル更新

---

## 7. フィルタリング
- [x] フォルダ選択状態の管理
- [x] FolderLM フィルタをノート一覧に適用
- [x] NotebookLM 標準フィルタと AND 条件で併用
- [x] 「すべて」で FolderLM 側のみ解除

**実装成果物:**
- `src/content/core/filterManager.js` - フィルタ状態管理とフィルタ適用ロジック
- `src/content/index.js` - filterManagerとの統合
- `src/content/ui/folderButton.js` - フィルタアクティブ状態表示
- `src/content/content.css` - フィルタアクティブ状態のスタイル

---

## 8. DOM 監視と再描画対応
- [x] `MutationObserver` の設定
- [x] 新規ノート追加/削除時の UI 再注入
- [x] タブ切替/再描画後の復帰処理
- [x] 更新処理のバッチ化（`requestAnimationFrame`）

**実装成果物:**
- `src/content/core/domRecoveryManager.js` - タブ切替・DOM再描画対応マネージャー
- `src/content/index.js` - MutationObserver強化とdomRecoveryManager統合

---

## 9. アクセシビリティ/UX
- [x] ARIA ラベル付与
- [x] キーボード操作（フォーカス移動/決定/閉じる）
- [x] NotebookLM の UI に合わせた余白/高さ調整

**実装成果物:**
- `src/content/utils/focusTrap.js` - フォーカストラップユーティリティ
- `src/content/ui/folderButton.js` - ARIAラベル改善、tabindex追加
- `src/content/ui/folderDropdown.js` - フォーカストラップ統合、ARIA改善
- `src/content/ui/noteAssignButton.js` - ARIAラベル改善
- `src/content/ui/folderSelectPopup.js` - フォーカストラップ統合、role改善
- `src/content/content.css` - 余白・高さ調整、focus-visible対応

---

## 10. 手動テスト（MVP）
- [ ] フォルダ作成 → リロード後も維持
- [ ] ノート割り当て → フィルタで絞り込み確認
- [ ] フォルダ削除 → 対象ノートが未分類に戻る
- [ ] DOM 再描画後も UI が復帰する
- [ ] ID 取得失敗時に UI が安全停止する

---

## 11. MVP リリース準備
- [ ] `extension/manifest.json` の最小権限確認
- [ ] 拡張機能の読み込み・動作確認
- [ ] MVP 機能の範囲を README などに簡潔に記載
