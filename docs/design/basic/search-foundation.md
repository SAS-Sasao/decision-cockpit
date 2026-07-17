# 基本設計: search-foundation(M2 ナレッジ検索 — pgvector 近傍検索 + SC-04)

> ステータス: **PASS**(design-review 全レンズ PASS — arch/sec は Round 3・data は Round 4。reviews/search-foundation.md 参照。R4 の Low/Info は rev.4 に吸収済み)
> 根拠資料: docs/research/m2-embedding-model.md(モデル選定・決定記録・gemini 正規化の注記)/ docs/design/ui/screen-design.md §5 SC-04・§7.2・§7.4 / docs/design/ui/moc/decision-cockpit.dc.html(isKnowledge ブロック)
> 準拠ルール: .claude/rules/search.md(モデル固定・出典付与)/ db.md(ブランチ検証・破壊 SQL 禁止)/ architecture.md(重い処理のバッチ分離)/ testing.md(実ネットワーク禁止)
> 作成: 2026-07-17(主セッション執筆)。Round 1/2 の決着一覧は docs/design/reviews/search-foundation.md 参照

## 1. 目的 / スコープ

### 目的
索引済み `timeline_records` に対する **pgvector 意味検索**と、**SC-04 ナレッジ再利用画面**(/knowledge)を実装する。
過去の判断(type=decision)を類似検索し、判断後の組織実績(報酬スコア推移)を時間軸で紐づけて提示する。

### やる(search-foundation)
1. **埋め込みモデルの確定とプロバイダ切替構造**(決定記録 = research §決定記録 + ユーザー決定 2026-07-17):
   - 初期値: `EMBEDDING_MODEL=text-embedding-3-small` / `EMBEDDING_DIM=1536`(OpenAI・ネイティブ次元)/ `EMBEDDING_API_KEY`。
   - **切替要件(ユーザー決定)**: OpenAI で開始し、不調時は **Google `gemini-embedding-001`(AI Studio キー・1536 次元)へ切替**できること。切替 = **EMBEDDING_MODEL と EMBEDDING_API_KEY の2変数同時変更**(コード変更なし。同時交換の確認は §5 手動チェックリスト)。ApiEmbedder は **EMBEDDING_MODEL 名で provider を判別**(`text-embedding-` 前方一致 → OpenAI `/v1/embeddings` / `gemini-` 前方一致 → Gemini API `embedContent`)し、**両経路を本トピックで実装**する。
   - **dispatch は fail-closed**: どちらの前方一致にも該当しないモデル名(`models/gemini-…` のような修飾表記を含む — 正は**ベア名**)は **throw**(既定フォールバック禁止 — 誤設定時にキーを誤った送信先へ送るクロス provider 露出の防止)。**契約テストを §5-2 に含める**。
   - **併用は不可**(混在禁止 — rules/search.md)。切替 = モデル名変更 → 行の `embedding_model` 不一致で全行が自動再埋め込み対象(§1-3)+ **検索は `embedding_model = 現行モデル` の行のみ対象**(§1-4 — 過渡期の混在比較を構造的に封鎖)。次元は 1536 固定で DDL 不変。
   - **有効モデル識別子(effective model id)**: 行の `embedding_model` に記録し、再埋め込みトリガ(§1-3)と検索ガード(§1-4)の比較に使う識別子は、**`EMBEDDING_SOURCE=fixture` のとき `fixture:<EMBEDDING_MODEL>`・通常時 `<EMBEDDING_MODEL>`** とする(embedding.ts の `currentEmbeddingModel()` がこの有効識別子を返す — 唯一の取得経路として embed-index.ts / knowledge.ts の両方が経由)。これにより **fixture 由来ベクトルが実モデル名を名乗ることはなく**、(a) 実 API モードの検索から fixture 行は構造的に除外され、(b) fixture → 実 API 切替時は識別子不一致で全行が自動再埋め込みされる(自己回復 — 手動手順不要)。混在封鎖は「モデル名軸」と「生成器(fixture/実 API)軸」の両方を覆う。
     **単一述語の要件**: embedder の選択(Fixture / Api)と識別子プレフィクスの付与は**同一の判定述語**(例: `isFixtureMode()` を factory と `currentEmbeddingModel()` が共用)から導出する — 書き分けによる「fixture ベクトルがベア名で記録される」再来経路の防止。**選択された embedder 種別 ↔ 識別子プレフィクスの一致のペアリングテスト**を §5-2 に含める。**EMBEDDING_MODEL は fixture モードでも必須**(未設定・空文字は Fixture / Api どちらの経路でも throw — 対称の fail-closed)。
   - **ベクトル契約**: EmbeddingClient は**常に EMBEDDING_DIM 次元・単位ノルム(L2 正規化済み)のベクトルを返す**。OpenAI は `dimensions=EMBEDDING_DIM` を常時明示送信(3-large 切替も env のみで成立)。Google は `outputDimensionality=EMBEDDING_DIM` + **アダプタ内で再正規化**(3072 以外は非正規化で返る — research §2 注記。再正規化は冪等で正規化済み入力にも無害)。FixtureEmbedder も正規化して返す。→ cosine 距離 `<=>` の値域が [0,2] に保証される(§1-4 の similarity 契約の前提)。
   - クエリ埋め込みと索引埋め込みは**同一モデル**(EmbeddingClient 一元化 + §1-4 の embedding_model ガードで構造保証)。REST 直叩き(Bearer / x-goog-api-key)で **SDK 依存を追加しない**(package* 凍結 — §5-8)。
2. **マイグレーション 0003**: `timeline_records` に `embedding vector(1536)` / `embedding_model text` / `embedded_at timestamptz` の3列を追加 + **HNSW インデックス**(`vector_cosine_ops`・m=16 / ef_construction=64 の既定)。
   検証は Neon **ブランチ**上(db.md)→ 本番適用は人間承認(ask)。up は列追加のみで破壊操作なし。down(列・インデックスの削除)は 0001/0002 と同方式で**設計に明示し人間承認**の対象とする。vector 拡張は 0001 で有効化済み(前提成立)。
3. **埋め込みバッチ(lib/search/ 新設)**: architecture.md「重い処理はバッチに分離」に従い、埋め込み生成は同期後のバッチフェーズとする。
   - **EmbeddingClient アダプタ**(SourceAdapter と同型): `ApiEmbedder`(§1-1 の2 provider・fail-closed dispatch)/ `FixtureEmbedder`(**決定的**なハッシュ由来ベクトル・正規化済み — テスト・ローカル検証用)。切替 env `EMBEDDING_SOURCE=fixture`(**production では指定するとエラー** — SYNC_SOURCE と同契約・**契約テストを §5-2 に含める**)。
   - **対象行(冪等)**: `status='ok' AND (embedding IS NULL OR embedding_model <> $current OR synced_at > embedded_at)`。**$current = 有効モデル識別子(§1-1)**。全 type を索引する(検索対象の完全性。UI の既定フィルタは decision — §1-5)。
   - **embedded_at のセマンティクス(競合窓の封鎖)**: 対象行は**コンテンツと synced_at を同一 SELECT(同一行スナップショット)で読み**、UPDATE 時に `embedded_at = その読取時の synced_at 値`を書く(**now() を使わない**)。埋め込み処理中に同期が synced_at を進めても `synced_at > embedded_at` が維持され、次回バッチで再埋め込みされる(cron GET / 手動 POST / embed-local の併走でも取り零しなし。重複埋め込みは冪等な上書きで無害)。
   - **1回の上限** = env `EMBED_MAX_ROWS`(Vercel 実行時間対策)。試行順 = synced_at 古い順。**既知の制限**: 行単位の失敗状態は持たないため、恒常失敗行が EMBED_MAX_ROWS 以上溜まると前進が止まり得る(summary の failed 件数で可視化。後回し戦略は詳細設計の問い — §6-6。恒常失敗行は embedding_model が旧値のままになるが、§1-4 のガードにより**検索には現れない**)。force 再同期は全行の synced_at を更新するため**全行が再埋め込み対象化**される(コスト実質ゼロで許容 — §4)。
   - **埋め込み入力テキスト** = title + tags + body の連結。**切詰め長は両プロバイダで安全な値**を詳細設計で確定する(OpenAI 8,191 tokens は確認済み・**gemini-embedding-001 の入力上限は公式ドキュメントでの確認を詳細設計の必須タスク**とし、両者の min に対して安全な文字数近似を採る — 「コード変更なしで切替可」の前提)。**入力は timeline_records のみ**(capture_inbox 非参照 — §5-7 の否定 grep で機械判定)。
   - **呼び出し経路**: (a) `/api/sync`(GET cron / POST 手動)の **runSync 完了後**に後続フェーズとして呼ぶ(**lib/ingestion は不変** — route 側で接続。認可判定の内側)。(b) `scripts/embed-local.ts`(バックフィル・ローカル/本番向け手動 — sync-local.ts と同型)。
   - 埋め込みフェーズの失敗は**同期本体の成功を妨げない**: route の embed 呼び出しは try/catch で**全例外を吸収**(DATABASE_URL 未設定時の pool 初期化 throw を含む — 凍結 tests/api-sync.test.ts が env なしで 2xx を検証するため必須)し、応答 summary に `embed` キーを追加するのみ(既存キー・型は不変。api-sync.test.ts は body 非検査を現物確認済み)。
4. **検索クエリ(lib/data/knowledge.ts 新設)**: cosine 近傍(`embedding <=> $qvec`)+ メタフィルタ(**source** / type / org / occurred_at 範囲 / tags — rules/search.md の列挙 + 拡張)+ **`status='ok' AND embedding IS NOT NULL AND embedding_model = $current`**。
   - **同一モデルガード(混在の構造的封鎖)**: `embedding_model = $current`(**$current = 有効モデル識別子 §1-1**)により、クエリ(現行モデル)と索引(旧モデル・fixture 由来)の比較は**構造的に発生しない**。**過渡状態の明示**: モデル切替直後は再埋め込み済みの行のみが検索対象になり、全行再埋め込みの完了まで結果件数が減る(自己回復 — バッチ前進に伴い拡大。HNSW の post-filter で候補がさらに痩せ得る点は詳細設計で ef_search / iterative scan の要否を判断 — §6-8)。$current は embedding.ts の公開関数 `currentEmbeddingModel()` 経由で取得(env 直参照は embedding.ts のみ — §5-5 と両立)。
   - **similarity 契約**: `similarity = max(0, 1 − distance)`(**クランプで 0〜1 を保証**)。下限は距離 ≥ 0(単位ノルム契約)、上限は pgvector が cosine 類似度を内部で [−1,1] にクランプすることに依拠(詳細設計でピン)。並び順は距離昇順のまま(クランプは表示契約のみ — 同値 0 が並ぶため降順 assert は**非厳密比較**で書く)。結果には**必ず出典**(source / file_path / occurred_at)と similarity を付与。類似度降順・上限 N 件。
   - **SQL 安全性**: 全メタフィルタ(tag / sel / type / date 範囲)・qvec・**embedding_model($current)** は lib/db.ts `query(text, params)` の **$n プレースホルダ束縛のみ**(文字列連結禁止)。qvec は number[] からの直列化文字列を**パラメータとして**渡す(`$1::vector`)。詳細設計で SQL 全文をピン化(§5-4)。
   - **クエリ埋め込みの呼び出し位置**: EmbeddingClient を呼ぶのは **lib/data/knowledge.ts(searchKnowledge 内)のみ**。page.tsx は knowledge.ts 経由でのみデータを得る(DB・EmbeddingClient の直 import 禁止 — §5-7)。
   - **既知の制限**: (a) SSoT 側で削除されたファイルの行は status='ok' のまま残るため(M1 の deleted は計数のみ・生 DELETE 禁止)、検索結果に出典リンク切れが現れ得る。M2 では許容し、stale 判定は将来トピック(§6-7)。(b) `?q=` の GET パラメータはアクセスログ・ブラウザ履歴に残る(認証内・個人利用で許容)。
5. **SC-04 画面(/knowledge・Server Component・GET フォーム)**: MoC の isKnowledge ブロックを意匠規範とする(§7.4 恒久規範)。
   - 検索バー(`?q=`)+ タグチップ(実データの上位タグ。クリックでフィルタ)。
   - 左: 類似判断リスト(日付・org・**類似度 pill**・要約・タグ pill)。既定 type=decision。
   - 右: 選択判断(`?sel=` = レコード id)の詳細 + **判断後6週の報酬スコア推移** + **実績統計3カード**(系列定義は詳細設計)。
   - **判断後6週の窓 = occurred_at 起点の7日窓 ×6(UTC)**。review.ts の月曜起点暦週とは**別物**であることを明示 — 新設の**同型純関数**(lib/data/knowledge.ts 内・テスト対象)で実装し、**lib/data/review.ts は変更しない**(凍結)。
   - **チャートは既存 components/charts のみで実装**(sparkline / line-chart の寸法 props で MoC の decisionOutcomeChart を再現 — **部品の新規追加はしない**と本設計で確定。凍結と規範の優先関係: 本 goal は charts 凍結が優先。実装中に不足が判明した場合は設計改訂で凍結解除を明示してから追加する)。
   - クエリ埋め込みはサーバ側でリクエスト時に1件生成(§1-4 の呼び出し位置固定)。q 空なら検索せず最近の判断を表示。
   - **認可モデル(明示)**: 索引データは**認証済み全ユーザーに可視**(M0/M1 からの既存姿勢の継承 — 意図的判断。self-signup が開いている現状で閲覧制限を強めるかは SC-07 / M4 の課題)。/knowledge は proxy + requireUser の二層(matcher 変更なし・新規公開 URL なし)。検索1回 = 埋め込み API 1コール(認証必須)。レート制限は設けない(個人利用・単価極小 — 既知の制限)。
6. **秘密パターン追随**: `EMBEDDING_API_KEY` の実値形式を scripts/check-no-secrets.sh の PATTERN に追加 — 追加パターンは **`sk-proj-[A-Za-z0-9_-]+|sk-svcacct-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]{35}`** に確定(rev.3):
   - OpenAI は **project key(`sk-proj-`)/ service account key(`sk-svcacct-`)のみ対象**。レガシー裸 `sk-` は既存 `sk-ant-` の正規表現形式言及(docs 内に多数)への偽陽性を ERE(否定先読み不可)で回避できないため**意図的に対象外** — 運用前提「OpenAI キーは project key を使用」を §5 手動チェックリストに含める。
   - `AIza` は Google API キーの固定長形式({35})。lockfile 等の base64 文字列との理論衝突は許容(検出時は一覧表示されるため可視・その時点で対処)。
   - **env 確定と同一コミット**(check-no-secrets.sh 冒頭の一般則。この「同一コミット」制約は**人間レビュー判定** — 機械判定原則の意図的例外)。
7. **テスト**: FixtureEmbedder による決定的テスト(実ネットワークなし)・検索/窓関数の純関数ユニット・契約テスト(production 拒否・dispatch fail-closed・SQL ピン)。**新テストは新ファイル**・前 goal 新設の tests/chart.test.ts を凍結列挙に**編入**(テスト世代管理 — screen-design §7.4-3)。
8. **被変更側注記(主セッション担当)**: `/api/sync` への embed フェーズ接続と応答キー追加 → **ingestion-foundation 詳細 §2.4 に注記** / knowledge プレースホルダの実装化 → **ui-shell 詳細 §2.5 に注記**(前例どおり grep ゲート — §5-9)。

### やらない(search-foundation では対象外)
- **conversation-log 等の新ソース取り込み**(マスク検証方針の先行設計が前提 — 従来からの申し送り)。パーサ・allowlist・denylist の変更なし。
- capture_inbox の埋め込み・検索(M4/M5)。metric_aggregates の利用(現状未使用のまま)。
- ハイブリッド検索(tsvector / BM25)・リランキング・**チャンク分割**(1レコード=1ベクトル。レコードは短〜中程度で切詰めで足りる — 不足したら別トピック)。
- SC-04 の拡張(判断詳細モーダル・関連 decision グラフ遷移)/ 壁打ち(M4)/ SC-03(M3)。
- 埋め込みモデルの**併用・自動フォールバック**(混在禁止 — rules/search.md。Google への切替は env 2変数の変更 + 全行再埋め込みによる一方向の移行。過渡期の検索は §1-4 のガードで現行モデルの行に限定)。
- components/charts への部品追加(§1-5 で確定 — 既存5部品で実装)。
- 削除済み SSoT ファイル行の stale 判定・除外(§1-4 既知の制限 — 将来トピック)。
- 新規依存の追加(SDK 含む — REST 直叩き。package* は凍結 §5-8)。
- Neon 本番のバックフィル実行(本番 timeline_records は空 — 実データ同期後に人間承認で実施。§6-3)。

## 2. アーキテクチャ上の位置づけ

- **Index / Search 層の本丸** + App 層(SC-04)。3層の責務は不変:
  - Ingestion: **変更なし**(lib/ingestion 不変)。埋め込みフェーズは `/api/sync` route が runSync **後**に呼ぶ後続処理で、**SSoT には一切アクセスしない**(入力は Neon 上の索引済みレコードのみ)。
  - Index/Search: 0003 で embedding 列 + HNSW。埋め込み生成はバッチ(cron 便乗 + 手動スクリプト)、UI は索引済みデータを読むだけ + クエリ1件の埋め込みのみリクエスト時生成(明示的な例外 — EmbeddingClient 経由で構造化)。
  - App: /knowledge(Server Component・新 API route なし・proxy matcher 不変)。
- **外部送信の新規発生(明示)**: 索引レコードの title / tags / body とユーザーの検索クエリを**埋め込みプロバイダ(OpenAI または切替後の Google)に送信**する。送信対象は ingestion の denylist を通過した非機微データのみ(profile.md / minefield.md は元々索引されない — rules/ingestion.md。denylist は lib/ingestion/normalize.ts に実在・凍結)。capture_inbox(個人メモ)は**送信しない**(§5-7 で機械判定)。**Google 切替時の注意**: AI Studio の無償枠 API は入力を製品改善に利用し得る規約(OpenAI API の既定「学習不使用」と非対称)— 切替時は有償枠 / データ利用設定の確認を必須とする(§5 手動チェックリスト)。
- 結合キーは従来どおり時間軸(occurred_at)とタグ。判断後6週は occurred_at 起点の7日窓(§1-5 — review.ts の暦週規約とは独立の新純関数)。

## 3. データ / インターフェース概要

| 対象 | 概要 |
|---|---|
| 0003 up | `ALTER TABLE timeline_records ADD COLUMN`(embedding vector(1536) / embedding_model text / embedded_at timestamptz)+ `CREATE INDEX … USING hnsw (embedding vector_cosine_ops)`。すべて冪等形 |
| 0003 down | 上記3列とインデックスの削除(0001/0002 の down と同方式・人間承認対象)。**データ行は消さない** |
| `lib/search/embedding.ts` | `import "server-only"`。`EmbeddingClient` IF: `embed(texts: string[]): Promise<number[][]>`(**EMBEDDING_DIM 次元・単位ノルム保証** — §1-1)。`ApiEmbedder`(EMBEDDING_MODEL 名で OpenAI / Google を dispatch・**不明名・未設定・空文字は throw**)/ `FixtureEmbedder`(決定的・正規化済み)。`currentEmbeddingModel()` = **有効モデル識別子(§1-1)を返す唯一の取得経路**(embed-index.ts の記録・比較と knowledge.ts の検索ガードの両方が経由)。**モデル名リテラル・EMBEDDING_MODEL / EMBEDDING_DIM の env 参照はこのモジュールに限定**(§5-5) |
| `lib/search/embed-index.ts` | `import "server-only"`。対象行の走査(synced_at 古い順・EMBED_MAX_ROWS 上限・コンテンツと synced_at を同一 SELECT)→ embed → `embedding / embedding_model / embedded_at(=読取時 synced_at)` の冪等 UPDATE。戻り値 `{ embedded, failed, remaining }` |
| `lib/data/knowledge.ts` | `import "server-only"`。`searchKnowledge(params)`(近傍 + メタフィルタ + **embedding_model = 現行モデルガード** + 出典 + similarity クランプ)/ `decisionOutcome(id)`(occurred_at 起点7日窓×6の集計)/ `topTags(n)`。SQL は全て $n 束縛(§1-4)。**EmbeddingClient を呼ぶ唯一のデータ層** |
| `app/(shell)/knowledge/page.tsx` | GET パラメータ契約: `q` / `sel` / `tag`。requireUser 存置。データ取得は knowledge.ts 経由のみ(lib/db・EmbeddingClient の直 import 禁止)。charts 既存部品のみ |
| `scripts/embed-local.ts` | sync-local.ts と同型のバックフィルスクリプト(DATABASE_URL 差し替えで Neon 本番にも使用可・本番実行は人間承認) |
| env | `EMBEDDING_MODEL`(**実モデル名を記載** — モデル名は非秘密)/ `EMBEDDING_DIM`(**1024 → 1536 に更新**)/ `EMBEDDING_API_KEY`(プレースホルダのみ)+ 新規 `EMBED_MAX_ROWS` / `EMBEDDING_SOURCE`(fixture・production 拒否)。`.env.example` に実値形式の秘密は書かない(check-no-secrets は接頭辞型実値の非存在を担保 — プレースホルダ性一般の担保ではない) |
| `/api/sync` 応答 | 既存 summary に `embed: { embedded, failed, remaining }` を**キー追加のみ**(既存キー・型は不変。embed 例外は全吸収 — §1-3) |
| 被変更側注記 | docs/design/detail/ingestion-foundation.md §2.4 / docs/design/detail/ui-shell.md §2.5(主セッション担当 — §5-9) |

## 4. リスク・トレードオフ

| リスク | 対処 |
|---|---|
| **モデル選定**: research 推奨は 3-large(JMTEB 74.48)だったが、**ユーザー決定(2026-07-17)で 3-small(66.39・$0.02/1M)を採用**(コスト優先)。さらに**不調時は Google gemini-embedding-001 へ切替したい**(ユーザー要望・AI Studio キー保有) | 品質不足 → 3-large(dimensions=1536)/ 動作不調 → gemini-embedding-001(outputDimensionality=1536 + 再正規化)。いずれも **env 2変数(モデル名 + キー)の変更のみ・DDL 不変・全行自動再埋め込み**(§1-1)。過渡期は §1-4 のガードで検索対象が再埋め込み済み行に限定(自己回復)。Google は日本語第三者ベンチ未確認(research)のため切替時はサンプル比較を推奨 |
| 切替時の誤設定(モデル名とキーの不一致・キー交換忘れ) | dispatch は fail-closed(不明名 throw — §1-1)。モデル名とキーの同時交換・有償枠/データ利用設定の確認を手動チェックリスト化(§5 末尾) |
| 外部送信(埋め込みプロバイダ)による情報露出 | 送信は denylist 通過済みの非機微索引データ + 検索クエリのみ。capture_inbox・機微ファイルは対象外(§2・§5-7)。API キーは server-only・env のみ(直書き禁止 + check-no-secrets 追随 §1-6)。**キーは embeddings 限定の restricted key を推奨**(OpenAI: project restricted key / Google: API 制限 — 発行はユーザー操作・手順は導入時に案内)。Google 無償枠のデータ利用規約差は §2 に明示(切替時チェック) |
| 埋め込み API 障害 | 検索: クエリ埋め込み失敗 → エラー表示(索引閲覧・他画面は無影響)。同期: embed フェーズ失敗でも同期本体は成功(§1-3)— 次回実行で自動リトライ(対象条件が残るため) |
| Vercel 実行時間(cron 内で埋め込み) | `EMBED_MAX_ROWS` で1回の上限を制限。残は次回 cron / 手動スクリプトで前進。恒常失敗行の滞留は summary で可視化(既知の制限 — §1-3。旧 embedding は §1-4 ガードで検索から除外) |
| gemini の入力上限が未確認(research) | 詳細設計の必須タスクとして公式ドキュメントで確認し、切詰め長を**両プロバイダの min に対して安全な値**に確定(§1-3)— 切替時の恒常失敗を予防 |
| HNSW と次元 | vector(1536) は HNSW 上限 2,000 内(halfvec 不要)。既定 m=16 / ef_construction=64 で件数規模に十分(research §2) |
| コスト | 331件 × 短文 → 初回バックフィル・増分とも実質ゼロ。force 再同期時の全行再埋め込みも同様に許容。クエリも個人利用量で無視可能。検索レート制限は設けない(§1-5 既知の制限) |
| /api/sync 応答へのキー追加が凍結テストと衝突する可能性 | tests/api-sync.test.ts の assert は status と runSync 呼び出し回数のみ(**現物確認済み** — body 非検査)。embed フェーズは全例外吸収(pool 初期化 throw 含む)で 2xx を維持(§1-3)。詳細設計で契約テスト化 |
| 削除済み SSoT ファイルの死リンク | M2 の既知の制限として許容(§1-4)。stale 設計は将来トピック(§6-7) |

## 5. 受け入れ条件(機械判定)

すべて exit code / 件数 / grep。詳細設計で実行形を確定し、/goal に転記する。
**可変範囲(完全列挙)**: 新規 = db/migrations/0003 / lib/search/ / lib/data/knowledge.ts / scripts/embed-local.ts / tests 新ファイル / app/(shell)/knowledge/page.tsx(実装化)。既存変更 = app/api/sync/route.ts(embed フェーズ呼び出し + 応答キー追加のみ)/ scripts/check-no-secrets.sh(PATTERN 追加のみ)/ .env.example(EMBEDDING_* の更新と EMBED_MAX_ROWS / EMBEDDING_SOURCE の追加のみ)/ docs 注記2件(§1-8)。**これ以外は不変**。

1. **マイグレーション**: `test -f db/migrations/0003_*.up.sql` + down 実在 / up に `vector(1536)`・`USING hnsw`・`vector_cosine_ops` の grep 各1本 / up に破壊操作が**現れない**(否定 grep — 実行形は guard hook と干渉しない上位互換 regex(`DROP[[:space:]]+` 等)を詳細設計で確定)。Neon **ブランチ**検証 exit 0 → 本番適用は人間承認(ask)。
2. **埋め込み契約**: FixtureEmbedder が決定的(同一入力2回 → 同一ベクトル)・次元 = EMBEDDING_DIM・**単位ノルム(|v| ≈ 1 の assert)** / Google 経路の**再正規化の数理テスト**(非正規化入力 → 正規化出力・決定的)/ **dispatch fail-closed の契約テスト**(**不明モデル名・未設定・空文字の3ケースとも → throw** — env デフォルト値による迂回の防止)/ **有効モデル識別子の契約テスト**(EMBEDDING_SOURCE=fixture 時 `fixture:` プレフィクス付き・通常時ベア名・**embedder 種別 ↔ プレフィクスのペアリング一致** — §1-1。未設定・空文字は fixture モードでも throw)/ `EMBEDDING_SOURCE=fixture` の **production 拒否の契約テスト**(SYNC_SOURCE 前例と同型)/ `npm test` exit 0(実ネットワークなし — fixture のみ)。
3. **冪等バッチ**: fixture で embed-index を2回実行 → **2回目の対象 0 件**(件数 assert)/ embedding_model を変えて再実行 → **全 ok 行が再対象化**(件数 assert)/ **SQL ピン**: 対象条件 WHERE 句の固定表記(`embedding IS NULL OR embedding_model <>` … `synced_at > embedded_at`)がテストまたは grep で SQL 文字列に一致(TS 述語と SQL の乖離防止 — 実行形は詳細設計)。
4. **検索契約**: fixture 埋め込み済みデータで検索 → 結果が類似度降順(**非厳密比較** — クランプ同値 0 を許容)・各行に **source / file_path / occurred_at / similarity** を含む・**全 similarity ∈ [0, 1] の範囲 assert**(クランプ検証 — FixtureEmbedder は負の生類似度を高頻度に生むため実効的)/ source・type・tags・date 範囲フィルタで件数が絞れる(assert)/ **SQL ピン**: `$n::vector` と **`embedding_model = $n`(束縛形)の同一モデルガード**を含む固定表記(実行形は詳細設計 — **モック側の述語再実装の検証にならないよう、実 SQL 文字列への grep/assert と二重化**)/ **モデル切替シミュレーション**: embedding_model 混在データ(旧モデル名・fixture プレフィクス付きを含む)で検索 → 現行の有効識別子の行のみ返る(件数 assert)。
5. **モデル固定**: モデル名リテラル(`text-embedding` / `gemini-embedding`)の出現ファイルが **`app` `components` `lib` `scripts` 走査で {lib/search/embedding.ts} の部分集合**(**⊆ 判定・空集合可** — dispatch は `gemini-` 前方一致のため `gemini-embedding` リテラルが embedding.ts に現れない実装も適法)/ `EMBEDDING_MODEL`・`EMBEDDING_DIM` の process.env 参照は同ファイルのみ(knowledge.ts / embed-index.ts は `currentEmbeddingModel()` 経由)。※この判定の帰結として、**scripts/embed-local.ts の usage コメント等にも実モデル名リテラルを書かない**(/goal 禁止事項に含める — 偽 FAIL 防止)。
6. **秘密・env**: `.env.example` に `EMBEDDING_DIM=1536` の grep / check-no-secrets.sh の PATTERN に §1-6 の確定パターン(`sk-proj-` / `sk-svcacct-` / `AIza` 系)が追加され `bash scripts/check-no-secrets.sh` exit 0(パターン追加は env 確定と同一コミット — **人間レビュー判定・機械判定の意図的例外**)。
7. **境界・非送信**: `grep -RIn "capture_inbox" lib/search lib/data/knowledge.ts "app/(shell)/knowledge"` が **exit 1**(embed 入力・検索の timeline_records 限定 — /goal 禁止事項に「このリテラルをコメントにも書かない」を含める)/ **page 層の直 import 禁止**: `grep -RIn -E "lib/db|lib/search" "app/(shell)/knowledge"` が **exit 1**(データ取得は lib/data/knowledge.ts 経由のみ — §1-4 の呼び出し位置固定の判定器)/ server-only 検査対象に **lib/search/ と lib/data/knowledge.ts を追加**して exit 0 / 実機(**手順 = ui-shell 詳細 §4 の条件2**・fixture・ダミー env)で未認証 `/knowledge` → **307** / knowledge/page.tsx に `components/charts` の import grep(§7.4 規範)+ `requireUser` grep / **proxy.ts は main と無差分**(matcher 不変)。
8. **凍結・退行**: `npm test` exit 0 / FROZEN(lib/ingestion / db/migrations の 0001・0002 / lib/auth / lib/db.ts / app/login / app/auth / app/logout / next.config.mjs / lib/data/review.ts / lib/data/overview.ts / lib/ui / **components/charts** / proxy.ts / tsconfig.json / **package.json / package-lock.json**(新規依存なし — SDK 非導入の機械判定))diff exit 0 / **FROZEN_TESTS = 既存18テストファイル(tests/chart.test.ts を編入)+ tests/helpers + vitest.config.ts** diff exit 0 / build exit 0。
9. **被変更側注記**: `grep -q "search-foundation" docs/design/detail/ingestion-foundation.md` exit 0 / `grep -q "search-foundation" docs/design/detail/ui-shell.md` exit 0(担い手 = 主セッション — §1-8)。

**/goal 分割の方向性**(詳細設計で確定): **M2-A「埋め込み基盤」**(0003 + lib/search + /api/sync 接続 + embed-local + 秘密パターン + テスト)→ **M2-B「検索と SC-04」**(lib/data/knowledge.ts + 画面 + 注記2件)。

**手動確認チェックリスト**(機械判定外):
- MoC isKnowledge ブロックとの目視比較(検索バー / 類似度 pill / 右ペイン統計3カード)。
- 実 API キーでの初回バックフィルと日本語クエリの体感品質(不足なら 3-large / gemini への切替を判断)。
- OpenAI キーは **project key(sk-proj-)で発行**(§1-6 のパターン前提)+ **embeddings 限定の restricted key** で発行。
- **プロバイダ切替時**: EMBEDDING_MODEL と EMBEDDING_API_KEY の**同時交換**を確認 / Google は**有償枠 or データ利用設定の確認**(無償枠は入力を製品改善に利用し得る — §2)/ 切替後に全行再埋め込みの完了(remaining=0)を確認。

## 6. 未解決の問い

1. **判断後6週チャートと実績統計3カードの系列定義**(週次平均 reward のみか、QG 合格率を重ねるか / 統計3値の中身)— 窓のアンカーは決着済み(occurred_at 起点7日窓×6 — §1-5)。詳細設計で実データから確定。
2. **埋め込み入力の切詰め長** — gemini-embedding-001 の入力上限の公式確認(詳細設計の必須タスク)を経て、両プロバイダの min に安全な文字数近似で確定(§1-3)。
3. **Neon 本番のバックフィル時期** — 本番 timeline_records が空のまま(実データ同期が先)。0003 本番適用と合わせて人間承認で実施。
4. **タグチップの選定規則**(上位 N の N・tag_synonyms canonical の扱い)— 詳細設計。
5. **類似度の表示足切りしきい値**の要否(クランプで 0 になった結果を出すか)— 詳細設計 or 実利用後の調整。
6. **恒常失敗行の後回し戦略**(EMBED_MAX_ROWS 滞留の解消 — 試行順の工夫 or 行状態の導入)— 詳細設計で要否判断(§1-3 既知の制限)。
7. **削除済みファイル行の stale 設計**(commit 属性による鮮度判定・表示上の注記)— 将来トピック(M2 では死リンク許容 — §1-4)。
8. **過渡期の HNSW 候補痩せ対策**(embedding_model ガードの post-filter で ef_search 候補が減る局面での ef_search 引き上げ / iterative scan の要否)— 詳細設計で判断(§1-4)。

## 次の手順

`/design-review search-foundation`(再レビュー)→ 全レンズ PASS → `/detailed-design search-foundation` → 再レビュー → `/goal M2-A` → `/goal M2-B`。
