# 基本設計: search-foundation(M2 ナレッジ検索 — pgvector 近傍検索 + SC-04)

> ステータス: draft(design-review 待ち)
> 根拠資料: docs/research/m2-embedding-model.md(モデル選定・決定記録)/ docs/design/ui/screen-design.md §5 SC-04・§7.2・§7.4 / docs/design/ui/moc/decision-cockpit.dc.html(isKnowledge ブロック)
> 準拠ルール: .claude/rules/search.md(モデル固定・出典付与)/ db.md(ブランチ検証・破壊 SQL 禁止)/ architecture.md(重い処理のバッチ分離)/ testing.md(実ネットワーク禁止)
> 作成: 2026-07-17(主セッション執筆)

## 1. 目的 / スコープ

### 目的
索引済み `timeline_records` に対する **pgvector 意味検索**と、**SC-04 ナレッジ再利用画面**(/knowledge)を実装する。
過去の判断(type=decision)を類似検索し、判断後の組織実績(報酬スコア推移)を時間軸で紐づけて提示する。

### やる(search-foundation)
1. **埋め込みモデルの確定**(決定記録 = research §決定記録・2026-07-17 ユーザー決定):
   `EMBEDDING_MODEL=text-embedding-3-small` / `EMBEDDING_DIM=1536`(OpenAI・ネイティブ次元)/ `EMBEDDING_API_KEY`。
   クエリ埋め込みと索引埋め込みは**同一モデル**(rules/search.md)。REST 直叩き(`POST /v1/embeddings`・Bearer)で **SDK 依存を追加しない**。
   **移行路**: 3-large(dimensions=1536)へは env 変更のみで切替可(同一次元 → DDL 変更不要。行ごとの `embedding_model` 不一致で全行が自動再埋め込み対象 — §1-3)。
2. **マイグレーション 0003**: `timeline_records` に `embedding vector(1536)` / `embedding_model text` / `embedded_at timestamptz` の3列を追加 + **HNSW インデックス**(`vector_cosine_ops`・m=16 / ef_construction=64 の既定)。
   検証は Neon **ブランチ**上(db.md)→ 本番適用は人間承認(ask)。up は列追加のみで破壊操作なし。down(列・インデックスの削除)は 0001/0002 と同方式で**設計に明示し人間承認**の対象とする。
3. **埋め込みバッチ(lib/search/ 新設)**: architecture.md「重い処理はバッチに分離」に従い、埋め込み生成は同期後のバッチフェーズとする。
   - **EmbeddingClient アダプタ**(SourceAdapter と同型): `ApiEmbedder`(OpenAI REST)/ `FixtureEmbedder`(**決定的**なハッシュ由来ベクトル — テスト・ローカル検証用)。切替 env `EMBEDDING_SOURCE=fixture`(**production では指定するとエラー** — SYNC_SOURCE と同契約)。
   - **対象行(冪等)**: `status='ok' AND (embedding IS NULL OR embedding_model <> $current OR synced_at > embedded_at)`。全 type を索引する(検索対象の完全性。UI の既定フィルタは decision — §1-5)。
   - **1回の上限** = env `EMBED_MAX_ROWS`(Vercel 実行時間対策)。残があっても次回実行で前進(livelock なし — 対象条件自体がカーソル)。
   - **埋め込み入力テキスト** = title + tags + body の連結(切詰め長は詳細設計で確定)。
   - **呼び出し経路**: (a) `/api/sync`(GET cron / POST 手動)の **runSync 完了後**に後続フェーズとして呼ぶ(**lib/ingestion は不変** — route 側で接続)。(b) `scripts/embed-local.ts`(バックフィル・ローカル/本番向け手動)。
   - 埋め込みフェーズの失敗は**同期本体の成功を妨げない**(応答 summary に embed 集計を追加 — キー追加のみで既存契約を壊さない形。詳細設計で凍結テストとの両立を確認)。
4. **検索クエリ(lib/data/knowledge.ts 新設)**: cosine 近傍(`embedding <=> $qvec`)+ メタフィルタ(type / org / occurred_at 範囲 / tags)+ `status='ok' AND embedding IS NOT NULL`。
   結果には**必ず出典**(source / file_path / occurred_at)と **similarity(= 1 − cosine距離・0〜1)**を付与(rules/search.md・screen-design §7.2 の 0-1 読み替えと一貫)。類似度降順・上限 N 件。
5. **SC-04 画面(/knowledge・Server Component・GET フォーム)**: MoC の isKnowledge ブロックを意匠規範とする(§7.4 恒久規範)。
   - 検索バー(`?q=`)+ タグチップ(実データの上位タグ。クリックでフィルタ)。
   - 左: 類似判断リスト(日付・org・**類似度 pill**・要約・タグ pill)。既定 type=decision。
   - 右: 選択判断(`?sel=` = レコード id)の詳細 + **判断後6週の報酬スコア推移**(components/charts を再利用 — 部品選定と寸法は詳細設計。不足があれば charts へ追加が規範)+ **実績統計3カード**(系列定義は詳細設計)。
   - クエリ埋め込みはサーバ側でリクエスト時に1件生成(EmbeddingClient 経由 — モデル同一性を構造で保証)。q 空なら検索せず最近の判断を表示。
   - 認証は既存どおり requireUser(/knowledge は proxy 保護済み — **matcher 変更なし・新規公開 URL なし**)。
6. **秘密パターン追随**: `EMBEDDING_API_KEY` の実値形式(OpenAI `sk-` 系)を scripts/check-no-secrets.sh の PATTERN に追加 — **env 確定と同一コミット**(check-no-secrets.sh 冒頭の一般則そのまま)。既存 `sk-ant-` パターンと干渉しない正規表現にする(詳細設計で確定)。
7. **テスト**: FixtureEmbedder による決定的テスト(実ネットワークなし)・検索 SQL/集計の純関数ユニット・契約テスト。**新テストは新ファイル**・前 goal 新設の tests/chart.test.ts を凍結列挙に**編入**(テスト世代管理 — screen-design §7.4-3)。

### やらない(search-foundation では対象外)
- **conversation-log 等の新ソース取り込み**(マスク検証方針の先行設計が前提 — 従来からの申し送り)。パーサ・allowlist・denylist の変更なし。
- capture_inbox の埋め込み・検索(M4/M5)。metric_aggregates の利用(現状未使用のまま)。
- ハイブリッド検索(tsvector / BM25)・リランキング・**チャンク分割**(1レコード=1ベクトル。レコードは短〜中程度で切詰めで足りる — 不足したら別トピック)。
- SC-04 の拡張(判断詳細モーダル・関連 decision グラフ遷移)/ 壁打ち(M4)/ SC-03(M3)。
- 埋め込みモデルの複数併用・自動フォールバック(**混在禁止** — rules/search.md)。
- Neon 本番のバックフィル実行(本番 timeline_records は空 — 実データ同期後に人間承認で実施。問い#3)。

## 2. アーキテクチャ上の位置づけ

- **Index / Search 層の本丸** + App 層(SC-04)。3層の責務は不変:
  - Ingestion: **変更なし**(lib/ingestion 不変)。埋め込みフェーズは `/api/sync` route が runSync **後**に呼ぶ後続処理で、**SSoT には一切アクセスしない**(入力は Neon 上の索引済みレコードのみ)。
  - Index/Search: 0003 で embedding 列 + HNSW。埋め込み生成はバッチ(cron 便乗 + 手動スクリプト)、UI は索引済みデータを読むだけ + クエリ1件の埋め込みのみリクエスト時生成。
  - App: /knowledge(Server Component・新 API route なし・proxy matcher 不変)。
- **外部送信の新規発生(明示)**: 索引レコードの title / tags / body とユーザーの検索クエリを **OpenAI API に送信**する。送信対象は ingestion の denylist を通過した非機微データのみ(profile.md / minefield.md は元々索引されない — rules/ingestion.md)。capture_inbox(個人メモ)は**送信しない**(スコープ外)。
- 結合キーは従来どおり時間軸(occurred_at)とタグ。判断後6週の紐づけは occurred_at 起点の週バケット(lib/data/review.ts の週境界と同一規約 — 実装は流用 or 同型純関数。review.ts は凍結のため**変更しない**)。

## 3. データ / インターフェース概要

| 対象 | 概要 |
|---|---|
| 0003 up | `ALTER TABLE timeline_records ADD COLUMN`(embedding vector(1536) / embedding_model text / embedded_at timestamptz)+ `CREATE INDEX … USING hnsw (embedding vector_cosine_ops)`。すべて IF NOT EXISTS 相当の冪等形 |
| 0003 down | 上記3列とインデックスの削除(0001/0002 の down と同方式・人間承認対象)。**データ行は消さない** |
| `lib/search/embedding.ts` | `EmbeddingClient` IF: `embed(texts: string[]): Promise<number[][]>`。`ApiEmbedder`(env: EMBEDDING_MODEL / EMBEDDING_DIM / EMBEDDING_API_KEY)/ `FixtureEmbedder`(決定的・次元 = EMBEDDING_DIM)。**モデル名・次元の参照はこのモジュールに限定**(リテラル散在禁止 — 機械判定 §5-5) |
| `lib/search/embed-index.ts` | 対象行の走査 → embed → `embedding / embedding_model / embedded_at` の冪等 UPDATE。戻り値 `{ embedded, failed, remaining }` |
| `lib/data/knowledge.ts` | `searchKnowledge(params)`(近傍 + メタフィルタ + 出典付与)/ `decisionOutcome(decisionId)`(判断後6週集計)/ `topTags(n)`。server-only |
| `app/(shell)/knowledge/page.tsx` | GET パラメータ契約: `q`(クエリ)/ `sel`(選択レコード id)/ `tag`(フィルタ)。requireUser 存置 |
| `scripts/embed-local.ts` | sync-local.ts と同型のバックフィルスクリプト(DATABASE_URL 差し替えで Neon 本番にも使用可) |
| env | 既存 `EMBEDDING_MODEL` / `EMBEDDING_DIM`(**1024 → 1536 に更新**)/ `EMBEDDING_API_KEY` + 新規 `EMBED_MAX_ROWS` / `EMBEDDING_SOURCE`(fixture・production 拒否)。`.env.example` はプレースホルダのみ |
| `/api/sync` 応答 | 既存 summary に `embed: { embedded, failed, remaining }` を**キー追加のみ**(既存キー・型は不変) |

## 4. リスク・トレードオフ

| リスク | 対処 |
|---|---|
| **モデル選定**: research 推奨は 3-large(JMTEB 74.48)だったが、**ユーザー決定(2026-07-17)で 3-small(66.39・$0.02/1M)を採用**(コスト優先) | 検索品質が不足したら 3-large(dimensions=1536)へ **env 変更のみで移行**(同一次元 → DDL 不変・embedding_model 不一致で全行自動再埋め込み — §1-1/§1-3)。移行判断は実利用の体感で |
| 外部送信(OpenAI)による情報露出 | 送信は denylist 通過済みの非機微索引データ + 検索クエリのみ。capture_inbox・機微ファイルは対象外(§2)。API キーは server-only・env のみ(直書き禁止 + check-no-secrets 追随 §1-6) |
| 埋め込み API 障害 | 検索: クエリ埋め込み失敗 → エラー表示(索引閲覧・他画面は無影響)。同期: embed フェーズ失敗でも同期本体は成功(§1-3)— 次回実行で自動リトライ(対象条件が残るため) |
| Vercel 実行時間(cron 内で埋め込み) | `EMBED_MAX_ROWS` で1回の上限を制限。残は次回 cron / 手動スクリプトで前進 |
| HNSW と次元 | vector(1536) は HNSW 上限 2,000 内(halfvec 不要)。331件〜数千件規模では既定 m=16 / ef_construction=64 で十分(research §2) |
| コスト | 331件 × 短文 → 初回バックフィル・増分とも実質ゼロ($0.02/1M tokens)。クエリも個人利用量で無視可能 |
| /api/sync 応答へのキー追加が凍結テストと衝突する可能性 | 詳細設計で tests/api-sync.test.ts の assert 形を確認し、**キー追加のみで壊れない**ことを機械判定に含める(壊れる形なら接続方式を再設計 — 凍結テストは変更しない) |

## 5. 受け入れ条件(機械判定)

すべて exit code / 件数 / grep。詳細設計で実行形を確定し、/goal に転記する。

1. **マイグレーション**: `test -f db/migrations/0003_*.up.sql` + down 実在 / up に `vector(1536)`・`USING hnsw`・`vector_cosine_ops` の grep 各1本 / up に破壊操作(生 DROP/TRUNCATE/DELETE)が**現れない**(上位互換 regex の否定 grep)。Neon **ブランチ**検証 exit 0 → 本番適用は人間承認(ask)。
2. **埋め込み契約**: FixtureEmbedder が決定的(同一入力2回 → 同一ベクトル)かつ次元 = EMBEDDING_DIM のテスト + `npm test` exit 0(実ネットワークなし — fixture のみ)。
3. **冪等バッチ**: fixture で embed-index を2回実行 → **2回目の対象 0 件**(件数 assert)/ embedding_model を変えて再実行 → **全 ok 行が再対象化**(件数 assert)。
4. **検索契約**: fixture 埋め込み済みデータで検索 → 結果が類似度降順・各行に **source / file_path / occurred_at / similarity** を含む / type・tags・date 範囲フィルタで件数が絞れる(assert)。
5. **モデル固定**: モデル名リテラル(`text-embedding`)の出現ファイルが **lib/search/embedding.ts のみ**(grep -RIl の一覧比較)/ `EMBEDDING_MODEL`・`EMBEDDING_DIM` の process.env 参照も同ファイルのみ。
6. **秘密・env**: `.env.example` の EMBEDDING_* がプレースホルダのみ(check-no-secrets が担保)+ `EMBEDDING_DIM=1536` の grep / check-no-secrets.sh の PATTERN に OpenAI 実値形式が追加され `bash scripts/check-no-secrets.sh` exit 0(追加は env 確定と同一コミット — レビューで確認)。
7. **画面**: 実機(fixture・ダミー env)で未認証 `/knowledge` → **307** / knowledge/page.tsx に `components/charts` の import grep(§7.4 規範)+ `requireUser` grep / **proxy.ts は main と無差分**(matcher 不変 — 新規公開 URL なし)。
8. **凍結・退行**: `npm test` exit 0 / FROZEN(lib/ingestion / db/migrations の 0001・0002 / lib/auth / lib/db.ts / app/login / app/auth / app/logout / next.config.mjs / lib/data/review.ts / lib/data/overview.ts / lib/ui / components/charts / tsconfig.json)diff exit 0 / **FROZEN_TESTS = 既存18ファイル(tests/chart.test.ts を編入)** diff exit 0 / build exit 0。可変範囲 = app/api/sync/route.ts(embed フェーズ呼び出しの追加のみ — 詳細設計でピン)と app/(shell)/knowledge/page.tsx。

**手動確認チェックリスト**(機械判定外): MoC isKnowledge ブロックとの目視比較(検索バー / 類似度 pill / 右ペイン統計3カード)・実 API キーでの初回バックフィルと日本語クエリの体感品質(不足なら 3-large 移行を判断)。

## 6. 未解決の問い

1. **判断後6週チャートと実績統計3カードの系列定義**(週次平均 reward のみか、QG 合格率を重ねるか / 統計3値の中身)— 詳細設計で実データから確定。
2. **埋め込み入力の切詰め長**(8,191 token 上限に対する文字数近似・title/tags/body の連結順)— 詳細設計。
3. **Neon 本番のバックフィル時期** — 本番 timeline_records が空のまま(実データ同期が先)。0003 本番適用と合わせて人間承認で実施。
4. **タグチップの選定規則**(上位 N の N・tag_synonyms canonical の扱い)— 詳細設計。
5. **類似度の足切りしきい値**の要否(低類似の結果を出すか)— 詳細設計 or 実利用後の調整。
6. **sk- 系秘密パターンの正規表現**(既存 `sk-ant-` と重複ヒットしない形・偽陽性の回避)— 詳細設計で確定。

## 次の手順

`/design-review search-foundation` → 全レンズ PASS → `/detailed-design search-foundation` → 再レビュー → `/goal`。
