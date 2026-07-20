# Ingestion(取り込み)

- 取得は **GitHub API 経由の読み取りのみ**。元 repo を clone して書き込むことは禁止。
  **※ この規約は「索引の取得経路」に対するもの**(organize-loop)。**CI の書き戻し経路**(Claude Action が PR を作るための
  checkout → 許可パスへの追加 → PR)は CLAUDE.md 黄金ルール1 の例外として扱う — 手元(開発セッション・executor)からの
  clone・書き込みは引き続き完全禁止。
- パーサ契約: 入力 = MD(frontmatter + 本文)、出力 = 正規化レコード(source, file_path, commit, date, tags, title, body, …)。
- **冪等 upsert キー = (source, file_path, item_key)**。item_key = 複数レコードファイル(1ファイル N レコード。例: JSON 配列・JSONL)内の識別子で、単一レコードファイルは空文字 `''`。`commit` は「最後に処理したコミット」の属性列(キーに含めない — 再同期で重複を作らないため)。同一キーは更新、無ければ挿入。
- gitignore 対象データ(profile.md / minefield.md 等の機微情報)は**取り込まない・索引しない**。
- パース失敗は握り潰さずレコード化(status=error)してスキップし、件数を要約に出す。
