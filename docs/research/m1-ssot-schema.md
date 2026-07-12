# M1 事前調査: SSoT 実ファイルスキーマ(2026-07-12・research-spike)

> M1 基本設計(docs/design/basic/ingestion-foundation.md)の根拠資料。public リポジトリを読み取り専用で調査。
> 要件定義 v1.1 §5.1 は repo 直下前提だが、実体は `.companies/<org>/` 配下に組織別再編済み。

## cc-sier-organization(`.companies/<org>/`)

| ソース | 実体 | フォーマット | 主要フィールド |
|---|---|---|---|
| `.task-log/`(dtc: 160件 / si: 4件) | `YYYYMMDD-HHMMSS-<slug>.md` | MD + YAML frontmatter | `task_id, org, operator, status, mode, started, completed, request, issue_number, pr_number` + 末尾 `## reward` YAML(`score` float / `signals:{completed, artifacts_exist, excessive_edits, retry_detected}` bool×4)+ **一部のみ** `## judge`(completeness/accuracy/clarity **1-5点**) |
| `.case-bank/` | **ファイル3つのみ**: `index.json`(cases 配列 **142件**)/ enrich-log / refiner-log | JSON | `cases[]: {id, state{request_keywords[], request_head, org_slug}, action{subagent, mode, artifact_count}, reward(0-1\|null), judge{completeness, accuracy, clarity, total(**0-1**), failure_reason, judge_comment}\|null, outcome{files_written[], started}}`。reward/judge は sparse(null 多数)。enrich/refiner はバッチログで索引対象外 |
| `.quality-gate-log/`(2件) | `YYYY-MM-DD.jsonl`(**1行=1レコード**) | JSONL | `status("pass"等), error_count, warning_count, errors[], warnings[], target(⚠️ローカル絶対パス), checklists[]` |
| `.session-summaries/`(25件) | `YYYYMMDD-HHMMSS-<sid>.json` | JSON | `session_id, org_slug, date, datetime, tool_count, by_type{write,read,bash,other}, files_written[], log_file(→対象外 .interaction-log への参照)` |
| `.conversation-log/`(4件) | `YYYY-MM-DD-<sid>.md` | MD + frontmatter | `session_id, date, datetime, operator, org, masked: true`(マスク明示。全文保証はサンプリングのみ) |
| `masters/` | departments / mcp-services / organization / projects / quality-gates/ / roles / workflows | MD | **タグ初期語彙の候補元**(departments/roles/workflows) |
| `docs/` | board.md = `docs/secretary/board.md` / WBS = `docs/secretary/storcon-preparation-wbs.md`(si は `docs/pm/projects/` 配下) | — | ⚠️ `docs/secretary/personality-profile-sasao.md` など**要件の除外リストに無い機微候補**が存在(内容未取得)。cc-sier 側にも `docs/decisions/` があり ai-war-room と名前衝突(source で区別) |

## ai-war-room

| ソース | 実体 | フォーマット |
|---|---|---|
| `docs/decisions/`(12件) | `YYYY-MM-DD-<slug>.md` | **frontmatter なし**。H1 = `# YYYY-MM-DD - {タイトル}`。tags 概念なし |
| `docs/logs/`(2件) | `YYYY-MM-DD.md` | frontmatter なし。H1 = `# 日報 — YYYY-MM-DD (曜日)` |
| `docs/templates/` | 4テンプレ | 素の MD(取り込み価値なし) |
| `docs/knowledge/`(1件) | infra-roadmap.md | **継続更新型**の生きたナレッジ(単発イベントでない)。日付は本文「最終更新」行のみ |
| `docs/manual/`(1件) | commands.md | ai-war-room 自体の運用マニュアル(自己参照) |
| `docs/sample/`(2件) | profile.sample.md / minefield.sample.md | 冒頭に「匿名化したサンプル・アプリ開発デモ用」と自己申告 → **索引対象でなく fixtures 転用候補** |

## 要件定義 §5.1 との主要差分(設計で対処)

1. データは repo 直下でなく **`.companies/<org>/` 配下**(org 列がそのまま対応)。
2. **ai-war-room に frontmatter が無い** → 日付=ファイル名、タイトル=H1、tags=自動付与が必要。
3. **tags の直接ソースがどこにも無い** → masters 由来語彙 + 決定的マッチで付与する設計が必要。
4. **case-bank はファイル単位でなく配列142件** → 冪等 upsert キー (source, file_path, commit) では个別 case の差分検知不可。**複数レコードファイル対応のキー拡張が必要**(ingestion.md ルールの追随更新)。
5. quality-gate は JSONL(1ファイル複数レコード)。`target` にローカル絶対パス → サニタイズ要。
6. task-log の `## judge` は一部ファイルのみ(optional 対応必須)。スケールは task-log judge=1-5 / case-bank judge=0-1 で**不一致**。
7. 除外リスト外の機微候補(`*personality*` 等)が存在 → allowlist 型の取得 + 機微 denylist の二層が必要。
8. jutaku-dev-team org は未調査(ログ類ディレクトリ自体が無い。docs/masters のみ)。

## 取り込み可否の推奨(ai-war-room 新ディレクトリ)

- `docs/sample/` → **除外**(自己申告のデモデータ。fixtures/ への転用は別途)
- `docs/manual/` → **除外**(運用マニュアル)
- `docs/knowledge/` → **条件付きで含める**(実ナレッジ。継続更新型のため occurred_at はコミット日時代替が必要)→ M1 では見送り M2 で対応(基本設計の判断)
