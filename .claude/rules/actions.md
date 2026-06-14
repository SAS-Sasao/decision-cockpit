# Claude Action(CI ハーネス)制約

- 書き込みは**許可パス配下のみ**(ai-war-room の docs/logs, docs/decisions)。それ以外は禁止。
- **PR ゲート**: 生成物は必ず PR 経由。`main` への直接 push 禁止・ファイル削除禁止。
- トークンは**最小スコープ**(WARROOM_PAT 等)を env から注入。コードに直書きしない。
- **機微ファイル(profile.md / minefield.md)へのアクセス禁止。**
- 受け入れ条件(機械判定): 変更は許可パス配下のみ / 各 MD に必須 frontmatter / 消費した capture 行数 = 更新行数。
