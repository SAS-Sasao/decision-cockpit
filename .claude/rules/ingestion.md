# Ingestion(取り込み)

- 取得は **GitHub API 経由の読み取りのみ**。元 repo を clone して書き込むことは禁止。
- パーサ契約: 入力 = MD(frontmatter + 本文)、出力 = 正規化レコード(source, file_path, commit, date, tags, title, body, …)。
- **冪等 upsert キー = (source, file_path, commit)**。同一キーは更新、無ければ挿入。再実行で重複を作らない。
- gitignore 対象データ(profile.md / minefield.md 等の機微情報)は**取り込まない・索引しない**。
- パース失敗は握り潰さずレコード化(status=error)してスキップし、件数を要約に出す。
