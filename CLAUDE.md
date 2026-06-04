@AGENTS.md

## UI規約（メモリ）

- **アイコンはデフォルトで Google Material Icons を使う**（`material-icons-outlined`）。
  - 新規UIのアイコンは Material Icons を基本とする。アイコン名は Material Icons の名称に合わせる。
  - 注意：dx は従来 `material-symbols-outlined`（Material Symbols）を一部利用しており、`layout.tsx` で読み込んでいる。Material Icons を使う場合は対応するフォント（`Material Icons Outlined`）の読み込みが必要なので、未読み込みなら `layout.tsx` の `<head>` に追加すること。
- ブランド表記：dx（企業/社内向け）は「ENGER business」（ロゴ＋business）。
- 企業に見せる人材情報は常に匿名（イニシャル＋スキル＋単価。氏名/連絡先は担当が仲介）。
