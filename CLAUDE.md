# Decision Cockpit

組織メトリクス(GitHub: SAS-Sasao/cc-sier-organization)と判断ログ(SAS-Sasao/ai-war-room)の Markdown を
SSoT として GitHub から自動同期し、Neon(Postgres + pgvector)に索引化、Next.js(App Router/TS・Vercel)で
「今日 / ナレッジ検索 / 振り返り」の3画面を提供する個人用の統合意思決定コックピット。UI から作業メモ・課題・
次の一手・壁打ちを入力でき、朝昼夜深夜の Claude Action がそれを整理して **ai-war-room と cc-sier-organization の
両方**の MD に PR で書き戻す(振り分けは内容ベース・許可パス限定 — organize-loop)。

## スタック
- Next.js App Router / TypeScript / Vercel
- Neon(Postgres + pgvector)
- 同期: GitHub API(読み取り専用)→ パーサ → 冪等 upsert
- 自動整理: GitHub Actions × claude-code-action(朝/昼/夜/深夜)

## 黄金ルール
1. **元リポジトリ(cc-sier-organization / ai-war-room)へは、手元(開発セッション・executor)から書き込まない。**
   索引のための読み取りは GitHub API 経由のみ。**唯一の例外 = Claude Action(CI)の PR 経由の書き戻し**(organize-loop)—
   許可パスは ai-war-room の `docs/logs/`・`docs/decisions/` と cc-sier-organization の
   `.companies/<org>/docs/decisions/`・`.companies/<org>/docs/todos/` に限定し、**追加のみ・削除禁止・main 直 push 禁止**。
   さらに **WBS 限定編集**(wbs-loop・2026-07-26 承認)を第2の例外として許可: 対象 = cc-sier-organization の
   `.companies/<org>/docs/secretary/*-wbs.md` のみ・変更 = **既存行のステータストークン(`[ ]`/`[~]`/`[x]`)の
   置換のみ**(行の追加・削除・他セル変更は禁止)・生成主体 = **決定的スクリプト(LLM 不使用)**・
   機械 verify(行単位バイト diff)→ PR 経由・自動マージなし(正典 = docs/design/detail/wbs-loop.md)。
2. **秘密情報は直書きしない。** 接続文字列・APIキー・トークンは `.env.example` のプレースホルダのみ。
3. **設計 → design-review(全レンズ PASS) → 実装。** /goal の対象は docs/design/ に設計があり PASS 済みのもの。
4. **作業役と判定役を分離。** 設計は主セッション(human-in-loop)で執筆し critic には書かせない。実装は executor、
   検証は acceptance-judge / `/goal`。
5. **拡張は Hooks > Skills > MCP の順で軽く。** 重い実装/調査はサブエージェントに委譲し、要約で受け取る。
   Codex は**読取専用のセカンドオピニオン**(正典 = .claude/rules/codex.md・起動は人間の端末から
   scripts/codex/review.sh 経由のみ)。判定役・実装役の分離(ルール4)は不変。
6. **破壊的操作は禁止。** 生 DROP/TRUNCATE/DELETE・`git push --force`・本番ブランチ破壊はしない。
   **ローカル DB ボリューム(`cockpit-db-data`)の破棄も禁止** — `docker compose down -v` / `docker volume rm` /
   `docker volume prune` / `docker system prune` は使わない(コンテナを落とすなら `docker compose stop`)。
   **理由**: `capture_inbox`(UI 入力)は SSoT に無く**復元不能**。万一消してしまった場合は
   **docs/setup/db-recovery.md の復旧手順を最後まで完了させ、復元できなかったデータを必ず人間に報告する。**

## 進め方
新機能は `/basic-design <topic>` → `/design-review <topic>`(全レンズ PASS)→ `/goal` で実装する。
設計書には必ず「受け入れ条件(機械判定)」を書き、後続 `/goal` の合否判定に直結させる。

## ルール(詳細は各ファイル)
- @.claude/rules/architecture.md — 3層構成・SSoT 読み取り専用・結合キー(時間軸/タグ)
- @.claude/rules/db.md — Neon ブランチマイグレーション・pgvector・破壊的 SQL 禁止
- @.claude/rules/ingestion.md — パーサ契約・冪等 upsert キー・機微データの扱い
- @.claude/rules/search.md — 埋め込みモデル固定・pgvector + メタフィルタ
- @.claude/rules/testing.md — 機械判定・実ネットワーク禁止・匿名 fixture
- @.claude/rules/git.md — 1ゴール=1ブランチ・節目 commit・force 禁止
- @.claude/rules/goals.md — /goal テンプレ(達成状態/禁止事項/ターン上限/節目 commit)
- @.claude/rules/design.md — 設計 → review → 実装の順序・critic は書かない
- @.claude/rules/capture.md — capture_inbox 契約・kind 語彙・processed_at 冪等
- @.claude/rules/actions.md — Claude Action(CI)制約・許可パス・PR ゲート
- @.claude/rules/codex.md — Codex 並走(読取専用セカンドオピニオン・review.sh 経由・judge 代替禁止)
