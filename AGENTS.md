# FolderLM

NotebookLM のノート一覧に仮想フォルダ整理と絞り込みを追加する Chrome 拡張機能。
DOM 表示のみを操作し、NotebookLM の内部データには干渉しない。

## Tech Stack
- Chrome Extension (Manifest V3)
- JavaScript (ES6+)
- CSS
- chrome.storage.sync
- Chrome / Edge (Chromium)

## Project Structure
- 配布対象の拡張機能ファイルは `extension/` 配下（`manifest.json` / `src/` / `assets/`）
- ドキュメントは `docs/` 配下（`plans/` / `reviews/` / `research/` / `guides/`）
- UI 差し込みやノート検出の詳細はアーキテクチャ文書を参照

## Commands
- 現在は実装前のためコマンドなし

## Important Notes
- ノートIDは `aria-labelledby` の `project-<UUID>-title` から抽出する
- FolderLM のフィルタは NotebookLM 標準フィルタと AND で併用する
- 保存対象はフォルダ名と割り当てのみ、外部送信は行わない
- UI は軽量・非侵襲で、DOM 再描画は監視して復帰する

## Documentation
- `docs/要件定義書_清書.md`
- `docs/アーキテクチャ清書.md`
- `docs/plans/MVP実装計画.md`
