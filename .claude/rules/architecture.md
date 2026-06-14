# アーキテクチャ

3層構成を守る:
1. **Ingestion** — GitHub API で SSoT(cc-sier-organization / ai-war-room)の MD を読み取り、パースして Neon に upsert。
2. **Index / Search** — Neon(Postgres + pgvector)。埋め込み + メタデータで索引・検索する。
3. **App** — Next.js App Router。「今日 / ナレッジ検索 / 振り返り」の3画面 + 入力(capture)。

原則:
- SSoT(元 repo)は**読み取り専用**。書き戻しは Claude Action の PR のみ(直接書き込み禁止)。
- 横断結合は**時間軸(日付)とタグ**をキーにする。
- 重い処理(取得・解析・埋め込み)はサブエージェント/バッチに分離し、UI は索引済みデータを読む。
- 拡張は **Hooks > Skills > MCP** の順で軽く積む。
