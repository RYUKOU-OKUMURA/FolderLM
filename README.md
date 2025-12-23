# FolderLM

NotebookLM のノート一覧に仮想フォルダ整理と絞り込みを追加する Chrome 拡張機能。
DOM 表示のみを操作し、NotebookLM の内部データには干渉しません。

## 構成
- 拡張機能本体: `extension/`
- ドキュメント: `docs/`
  - 設計/要件: `docs/要件定義書_清書.md`, `docs/アーキテクチャ清書.md`
  - 計画: `docs/plans/`
  - 調査: `docs/research/`
  - レビュー: `docs/reviews/`

## 使い方（ローカル読み込み）
1. Chrome / Edge の「拡張機能」ページを開く
2. 「デベロッパーモード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」から `extension/` を選択

## 配布用パッケージ（zip）
- 例: `extension/` 配下を zip 化して配布

```sh
cd extension
zip -r ../FolderLM.zip .
```

## セキュリティ / プライバシー
### セキュリティスタック
- Manifest V3
- Content Script のみ（NotebookLM DOM への表示操作）
- `chrome.storage.sync` のみ使用
- `host_permissions` は `https://notebooklm.google.com/*` のみ

### セキュリティ強度（設計方針）
- 保存対象は「フォルダ名」と「ノートIDの割り当て」のみ
- ノート本文・タイトル・メタ情報は保存しない
- 外部送信なし
- `innerHTML` を避け、`textContent`/DOM API を使用

## 開発メモ
- コマンドは現時点で未定（ドキュメント中心のリポジトリ）

## ライセンス
- 未設定
