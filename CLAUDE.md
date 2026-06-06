@AGENTS.md

## UI規約（メモリ）

- **アイコンは Google Material Symbols Outlined に統一**（`material-symbols-outlined`）。
  - フォントは `app/layout.tsx` で読込済み。新規追加は不要。
  - SVG アイコンの中央レジストリは `src/components/icons.tsx`（`Icons.<name>` を呼び出す）。新規アイコンはここに追加してから使う。
  - 旧 `material-icons-outlined`（Material Icons）は使用しない。混在するとフォント未読込でグリフが表示されない事故になる。
- ブランド表記：dx（企業/社内向け）は「ENGER business」（ロゴ＋business）。
- 企業に見せる人材情報は常に匿名（イニシャル＋スキル＋単価。氏名/連絡先は担当が仲介）。
