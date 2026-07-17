# design-review: search-foundation(M2 ナレッジ検索 — pgvector + SC-04)

対象: docs/design/basic/search-foundation.md(根拠: docs/research/m2-embedding-model.md)

---

## Round 1 — 2026-07-17

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **PASS(条件付き)** | 3層責務・SSoT 非接触・route 側接続の実現可能性は現物照合で成立。Med 5: **可変範囲宣言の自己矛盾**(check-no-secrets.sh / .env.example の変更が列挙外)/ **charts 凍結 vs 部品追加規範の衝突** / **§5-5 grep のスコープ未指定(偽 FAIL)** / **被変更側注記の欠落(前例逸脱)** / **判断後6週の週境界規約の二義性**(月曜暦週 vs occurred_at 起点)。Low 6(DB レス判定戦略・/goal 分割・FROZEN_TESTS 基盤・実機手順参照・source フィルタ・embed 例外の pool 初期化経路) |
| data | **FAIL** | **H1: similarity「= 1 − cosine距離・0〜1」が数学的に不成立**(<=> の値域 0〜2 → 1−d ∈ [−1,1]。FixtureEmbedder で負値が高頻度・§5-4 に範囲 assert なし = 偽 PASS の穴)。Med 4: §5-5 の恒常偽 FAIL / **削除済み SSoT ファイルの行が検索に出続ける(死リンク)** / **併走時の stale embedding 競合窓**(synced_at > embedded_at の厳密比較)/ 冪等バッチ判定の偽 PASS 経路(SQL を通らない)。再埋め込みトリガの前提(store.ts の synced_at=now() 更新)は現物で成立を確認 |
| sec | **PASS(条件付き)** | High なし。Med 2: **capture_inbox 非送信・embed 入力の timeline_records 限定に機械判定なし** / **ユーザー由来 SQL パラメータの束縛・qvec 直列化の安全性が未言及**。Low 5(embedding.ts の server-only / 同一コミットの人間判定 / 索引の全認証ユーザー可視(認可モデル未明示)/ 検索レート制限なし / production 拒否の契約テスト不在)。Info 3(restricted key / embed-local 誤実行ガード / 上位互換 regex の初出) |

**総合: FAIL(data H1 がブロッカー)** → rev.2 で決着:

1. **similarity 契約の再定義(H1)**: `similarity = max(0, 1 − distance)`(クランプ・0〜1 保証)+ EmbeddingClient は**単位ノルムのベクトルを返す契約**(距離 ∈ [0,2] を保証)+ §5-4 に範囲 assert を追加。並び順は距離昇順のまま(クランプは表示契約のみ)。
2. **プロバイダ切替の要件昇格(ユーザー決定 2026-07-17)**: OpenAI で開始し、不調時は Google gemini-embedding-001(1536・MRL + 再正規化)へ **env 変更のみで切替**。両アダプタを実装・EMBEDDING_MODEL 名で dispatch・併用不可(混在禁止は不変)。check-no-secrets へは **sk- 系 + AIza 系の両パターン**を追加。
3. **embedded_at のセマンティクス確定(M3)**: `embedded_at = 読取時点の行の synced_at 値`(now() 不使用)→ 埋め込み中に同期が走っても `synced_at > embedded_at` が維持され競合窓が消滅。
4. **可変範囲の完全列挙(arch Med-1)** + **charts は本 goal 凍結**(6週チャートは既存部品の寸法 props で実現と確定 — 不足が判明したら設計改訂で明示的に凍結解除)+ **§5-5 スコープ = app components lib scripts に固定**。
5. **被変更側注記を条件化(arch Med-4)**: ingestion-foundation 詳細 §2.4 / ui-shell 詳細 §2.5 への注記 + grep ゲート(前例どおり主セッション担当)。
6. **判断後6週 = occurred_at 起点の7日窓 ×6**(新純関数・review.ts 不変)と一意化(arch Med-5 / data L4)。
7. **SQL ピンによる判定(data M4 / arch Low-6)**: 冪等条件 WHERE 句・検索 SQL の固定表記を機械判定に追加(store モック流儀は維持しつつ SQL 文字列の乖離を防ぐ)。
8. **sec Med 2件の決着**: capture_inbox の否定 grep(lib/search / lib/data/knowledge.ts)を条件化 / 全メタフィルタ・qvec の $n 束縛を明記し詳細設計でピン化。
9. その他: 死リンク(削除済みファイルの行)は既知の制限として明記(stale 設計は将来トピック)/ embed 例外吸収は pool 初期化 throw を含む全経路と明記 / server-only を lib/search 全体に適用 + 検査対象追加 / production 拒否の契約テスト追加 / 実機手順 = ui-shell 詳細 §4-2 を明示 / source をメタフィルタに追加 / FROZEN_TESTS に tests/helpers・vitest.config.ts を明記 / /goal 分割方向性(M2-A 基盤 → M2-B 画面)を明記 / restricted key 推奨・レート制限なし(既知)・force 再同期の全行再対象を明記 / 「同一コミット」は人間レビュー判定(機械判定の意図的例外)と明記。

## Round 2 — 2026-07-17(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | Round 1 の Med 5 / Low 6 全解消を現物照合(可変範囲列挙・charts 5部品一致・grep スコープの現況 0 件確認・注記先セクション実在・18テスト件数一致・lib/db 遅延初期化による例外吸収の実現可能性)。新規 Low 2(package* 凍結ゲート欠落 / .env.example 括弧書きの字義ズレ)+ Info 2 |
| data | **FAIL** | H1 決着は数学的成立を確認(単位ノルム → 距離 [0,2]・クランプの単調性)・M1〜M4 / L1〜L4 全解消(store.ts の無条件 synced_at=now() 現物確認・embedded_at セマンティクスの併走安全性検証済み)。**新 High-1: モデル切替過渡期の索引混在** — 検索 WHERE に embedding_model ガードがなく、新モデルのクエリと旧モデルの行ベクトルが同一 SQL で比較され無意味な結果が無音で返る(恒常失敗行では無期限)。Med-1: gemini 入力上限未確認のまま「env 変更のみで切替」を要件化。Low 2(gemini 正規化の research 根拠断絶 / sk- パターンの ERE 実現可能性) |
| sec | **PASS(条件付き)** | G-1/G-8(Round 1 Med)決着を確認。新規 **Med R2-1: dispatch の不明モデル名時の挙動未規定**(既定フォールバックだとクロス provider のキー露出経路)。Low 4(単一キー env の切替2変数結合 / 否定 grep の対象外経路(page.tsx)/ Google 無償枠のデータ利用規約差 / AIza の lockfile 衝突)+ Info 2 |

**総合: FAIL(data High-1)** → rev.3 で決着:

1. **同一モデルガード(High-1)**: 検索 WHERE に **`embedding_model = $current`** を追加 — 混在比較を構造的に封鎖。過渡状態(切替直後は再埋め込み済み行のみが検索対象・自己回復)を明示。§5-4 に SQL ピン + **モデル切替シミュレーションの件数 assert** を追加。$current は embedding.ts の公開関数経由(§5-5 の env 一元化と両立)。
2. **dispatch fail-closed(sec R2-1)**: 不明モデル名(`models/` 修飾含む)は throw・既定フォールバック禁止。§5-2 に契約テスト追加。
3. **切詰め長の安全値化(data Med-1)**: gemini 入力上限の公式確認を詳細設計の必須タスクとし、両プロバイダの min に安全な値で確定。切替要件の文言を「env 2変数の同時変更」に精緻化(キー交換忘れは手動チェックリストでカバー — sec R2-2)。
4. **秘密パターンの確定(data Low-2 / sec R2-5)**: `sk-proj-…|sk-svcacct-…|AIza…{35}` に確定(レガシー裸 sk- は sk-ant- 偽陽性回避のため意図的対象外 — project key 運用を手動チェックリスト化。AIza の lockfile 理論衝突は許容と明記)。
5. その他: research に gemini 正規化の注記を追記(data Low-1 — 一般論との矛盾解消)/ package.json・package-lock.json を凍結 diff に追加(arch Low-1)/ .env.example の可変範囲表記を実変更に一致(arch Low-2 / sec R2-7)/ capture_inbox 否定 grep の対象に knowledge/page.tsx を追加 + クエリ埋め込みの呼び出し位置を knowledge.ts に固定(sec R2-3)/ Google 無償枠のデータ利用規約差を §2 に明示 + 切替チェックリスト化(sec R2-4)/ 降順 assert の非厳密比較・similarity 上限の pgvector クランプ依拠・同一 SELECT スナップショットを明記(data Info 1-3)/ ?q= の GET ログ露出を既知の制限に(sec R2-6)/ 実機手順表記を「ui-shell 詳細 §4 の条件2」に精緻化(arch Info-2)/ capture_inbox リテラルのコメント記載禁止を /goal 禁止事項へ(arch Info-1)。

## Round 3 — 2026-07-17(rev.3 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | Round 2 Low/Info 4件の決着を現物照合(package* 凍結・.env.example 表記・注記先実在・実機手順参照の正確性)。currentEmbeddingModel() と §5-5 の両立・同一モデルガードと SQL ピンの一対一対応を確認。新規 Info 3(embed-index の取得経路明記 / §5-5 の ⊆ 判定明記 / 関数名確定度) |
| data | **FAIL** | High-1 の「モデル名軸」封鎖は成立を確認(ガードの NULL 安全・embedding 非依存クエリへの無影響・$current 経路整合)。**新 Med-1: fixture 由来ベクトルの embedding_model 帰属が未規定** — fixture 実行時に実モデル名を記録すると、実 API 切替後もトリガ・ガードとも発火せず fixture ベクトルが索引に永続(生成器軸の混在)。Low 1(件数 assert のモック再実装偽 PASS)+ Info(HNSW 候補痩せ) |
| sec | **PASS** | R2-1 決着(fail-closed 明示 + 契約テスト)を確認。確定パターンの現物合成・自己トリガー非発生・sk-ant- 非干渉を最終確認。Low 1(未設定/空文字が契約テスト列挙外)+ Info 3(embedding_model の束縛列挙外 / レガシー sk- 前提崩れ / page 直 import 判定器の参照空振り) |

**総合: FAIL(data Med-1)** → rev.4 で決着:

1. **有効モデル識別子(effective model id)の新設(data Med-1)**: `EMBEDDING_SOURCE=fixture` のとき `fixture:<EMBEDDING_MODEL>`・通常時ベア名。記録・トリガ比較・検索ガードのすべてが `currentEmbeddingModel()`(唯一の経路)でこれを使う — 生成器軸の混在を封鎖(fixture → 実 API は自動再埋め込み・自己回復)。§5-2 に識別子契約テスト・§5-4 に fixture プレフィクス混在シミュレーション追加。
2. sec Low(未設定・空文字 → throw を契約テストに明示)/ sec Info(embedding_model を $n 束縛列挙に追加・page 層直 import 禁止の否定 grep を §5-7 に新設)/ arch Info(§5-5 を ⊆ 判定・空集合可に精緻化・currentEmbeddingModel() の embed-index 経由明記・関数名確定)/ data Low(SQL ピンは実 SQL 文字列への grep/assert と二重化と明記)/ data Info(HNSW 候補痩せ → §6-8 新設)。

## Round 4 — 2026-07-17(rev.4 を data レンズで再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| data | **PASS** | Med-1 決着を検証: `fixture:` プレフィクスは正規モデル名(前方一致2種)と衝突不能・`EMBEDDING_MODEL=fixture:…` の誤設定は dispatch throw で行が生まれない・EMBEDDING_SOURCE 誤値は SYNC_SOURCE 前例(厳密等値)でベア名側に落ち混在なし・§5-3 テストとの整合(fixture:A → fixture:B でも成立)。条件 2/3/4/5 の相互矛盾なし。新規 Low 1(embedder 選択と識別子付与の単一述語ピン)+ Info 3 |

**総合: PASS(全レンズ)** — arch(R3)/ sec(R3)/ data(R4)。R4 の Low/Info は rev.4 に即時吸収:
単一述語(isFixtureMode() 共用)+ embedder 種別 ↔ プレフィクスのペアリングテスト(§1-1/§5-2)/ fixture モードでも EMBEDDING_MODEL 必須(未設定 throw の対称化)/ embed-local の usage コメントにモデル名リテラル禁止(§5-5 注記・/goal 禁止事項へ)。

### detailed-design への申し送り(非ブロッキング)

1. **[data] §5-3/§5-4 の件数 assert の実行形**: モック側の述語再実装の検証にならないよう、実 SQL 文字列への grep/assert との二重化方式を確定(基本設計 §5-4 に要件記載済み)。
2. **[data] gemini-embedding-001 の入力上限の公式確認**(必須タスク)→ 切詰め長を両プロバイダ min の安全値で確定(§1-3/§6-2)。
3. **[arch] §5-5 の ⊆ 判定・process.env 参照判定の実行形**(grep -RIl の一覧比較の具体コマンド)。
4. **[sec] SQL 全文ピンに embedding_model = $n の束縛形まで含める**(§5-4)。similarity 上限の pgvector クランプ依拠のピン。
5. **[arch] currentEmbeddingModel() / isFixtureMode() の関数 IF ピン**(embed-index / knowledge の取得経路を IF で固定)。
6. **[data] 過渡期の HNSW 候補痩せ**(ef_search / iterative scan)の要否判断(§6-8)。
