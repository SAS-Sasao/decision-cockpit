# 調査: 埋め込みモデル選定(M2 ナレッジ検索)

> 調査: research-spike(2026-07-17・WebSearch/WebFetch による当時点の一次情報確認)
> 決定: **`EMBEDDING_MODEL=text-embedding-3-small` / `EMBEDDING_DIM=1536`(OpenAI)** — ユーザー決定 2026-07-17(末尾「決定記録」参照)

## 1. 候補モデル比較表

| モデル | 次元(既定/縮小オプション) | 最大入力トークン | 日本語品質の根拠 | 価格($/1M tokens) | API形式 | 提供元の安定性 |
|---|---|---|---|---|---|---|
| **OpenAI text-embedding-3-large** | 3072(dimensions パラメータで Matryoshka 的に 256/1024/1536 等へ縮小可) | 8,191 | **JMTEB retrieval 74.48**(第三者検証、secon.dev の Qwen3-Embedding 比較記事)。同ベンチで multilingual-e5-large(70.98)・Qwen3-Embedding-0.6B(72.81)・自社 small(66.39)を上回る | 標準 $0.13 / バッチ $0.065 | 単純 REST(`POST /v1/embeddings`、Bearer トークンのみ、SDK 不要) | 最も広く使われ実績十分。2024年公開以降モデル差し替えなし |
| **OpenAI text-embedding-3-small** | 1536(256/512/1024 へ縮小可) | 8,191 | JMTEB retrieval 66.39(同上、large より明確に劣る) | 標準 $0.02 / バッチ $0.01 | 同上 | 同上 |
| **Cohere embed-v4** | 256/512/1024/1536(Matryoshka、4値固定) | 128,000(本用途ではオーバースペック) | MTEB(汎用)65.2。日本語含む非ラテン文字言語で「15-20%改善」を謳うが **JMTEB での第三者検証は未確認** | $0.12 | 単純 REST(`POST /v2/embed`) | v3→v4 で世代交代済み。継続性は中程度 |
| **Voyage AI voyage-3系** | 256/512/1024(既定)/2048 | 32,000 | ベンダー自己申告ベンチのみ。**JMTEB 独立検証は未確認** | $0.06〜$0.18 | 単純 REST | **要注意**: 1〜2年で複数回世代交代。モデル廃止・移行リスク |
| **Google gemini-embedding-001** | 768/1536/3072(MRL) | **2,048**(2026-07-17 に公式 docs で確認 — ai.google.dev/gemini-api/docs/embeddings。3072 のみ自動正規化・縮小時は要手動正規化も同所で確認) | MTEB Multilingual 平均 68.32 で首位級だが**多言語平均**。JMTEB 個別スコア未確認 | 標準 $0.15 / バッチ $0.075 | 単純 REST(Gemini API) | 2026年 GA 直後で実績が浅い |
| (参考・除外)日本語特化 OSS(ruri-v3 等) | 可変(310m: JMTEB retrieval **81.89** で全候補中最高) | - | 圧倒的に高いが**自前ホスティング前提**(GPU レス制約に抵触) | ホスティング費用次第 | - | 「API 必須・GPU なし」制約により今回対象外。将来再検討の余地 |

**重要な留保**: JMTEB(日本語特化ベンチ)で第三者検証済みの具体的 retrieval スコアが確認できたのは OpenAI 系 + OSS 混在の1記事のみ。Cohere / Voyage / Gemini は JMTEB 個別スコアの独立検証を発見できず「未確認」扱い。

## 2. pgvector 側の制約(出典付き)

- pgvector 公式 README(v0.8.5 時点): `vector` 型は最大 16,000 次元格納可だが、**HNSW インデックスは `vector` 型で最大 2,000 次元まで**。`halfvec` 型なら最大 4,000 次元まで HNSW 対応。
  出典: https://github.com/pgvector/pgvector
- Neon の pgvector: **PG14〜17 で 0.8.0、PG18 で 0.8.1**。halfvec(0.7.0〜)・HNSW(0.5.0〜)ともサポート範囲内。
  出典: https://neon.com/docs/extensions/pg-extensions / https://neon.com/docs/extensions/pgvector
- HNSW 既定パラメータ: `m = 16`、`ef_construction = 64`(pgvector 既定)。数百〜数千件規模なら既定で十分。recall を上げたければ ef_construction 100〜128 でもビルドコストは無視できる。
- 距離関数は cosine(`vector_cosine_ops`)推奨。OpenAI / Cohere / Voyage は正規化済みベクトルを返すため cosine と内積は等価だが、cosine が明示的で事故が少ない。
  **注(2026-07-17 追記)**: **gemini-embedding-001 は例外** — 3072 次元出力のみ正規化済みで、**MRL 縮小(outputDimensionality=768/1536)時は非正規化で返る**ため利用側での再正規化が必要(出典: Google Gemini API embeddings ドキュメントの明記)。設計側はアダプタ内の再正規化(冪等 — 正規化済み入力に適用しても無害)で吸収する。

## 3. research-spike の推奨(参考)

**第1候補**: `text-embedding-3-large` / dim 1536(dimensions で縮小)— JMTEB 第三者検証済みの唯一の API 候補(74.48)。
**第2候補**: Cohere `embed-v4.0` / dim 1024 — 日本語検証未確認のため採用前にサンプル比較検証を推奨。

## 4. リスク・未解決点(調査時点)

- Cohere / Voyage / Gemini の JMTEB 個別スコアが未確認 — 今後 OpenAI を明確に上回る検証が出れば再評価の余地。
- OpenAI dimensions 縮小(3072→1536)の日本語での劣化幅は未計測(公式グラフは英語中心)。
- Voyage はモデル世代交代が速く長期運用リスク。
- ruri-v3 等の日本語特化 OSS は最高スコアだが API 制約で対象外(サーバーレス GPU 推論のコストが許容できるなら別調査で再検討)。

## 5. 参照 URL

- OpenAI: https://developers.openai.com/api/docs/models/text-embedding-3-small / https://openai.com/index/new-embedding-models-and-api-updates/
- pgvector: https://github.com/pgvector/pgvector
- Neon: https://neon.com/docs/extensions/pgvector / https://neon.com/docs/extensions/pg-extensions
- Cohere: https://docs.cohere.com/docs/cohere-embed
- Voyage: https://docs.voyageai.com/docs/pricing
- Gemini: https://developers.googleblog.com/gemini-embedding-available-gemini-api/
- JMTEB 第三者比較: https://secon.dev/entry/2025/06/11/100000-qwen3-embedding-jmteb/ / https://github.com/sbintuitions/JMTEB

---

## 決定記録(2026-07-17 → 2026-07-18 更新)

**2026-07-18 追記: `text-embedding-3-large`(dimensions=1536)へ移行済み**(ユーザー決定)。全 7,782 行を再埋め込み(remaining 0・失敗 0・費用 ≒ $0.4)。切替は設計どおり env 変更のみ・DDL 不変・同一モデルガードの過渡挙動(旧モデル行の検索除外 → 0件)も設計どおり動作した。以下の初期決定は経緯の記録として残す。

## 初期決定(2026-07-17)

- **採用: `text-embedding-3-small` / `EMBEDDING_DIM=1536`(ネイティブ次元・縮小なし)** — ユーザー決定。推奨(3-large)ではなく small を選択(コスト優先: $0.02/1M vs $0.13/1M)。
- 移行路の確保(設計要件): 品質不足を感じたら **3-large(dimensions=1536)へ切替可能** — 同一次元のため **DDL 変更不要**。`EMBEDDING_MODEL` 変更 → 行ごとの `embedding_model` 不一致で全行が自動的に再埋め込み対象になる設計とする(docs/design/basic/search-foundation.md)。
- `vector(1536)` は HNSW 上限 2,000 次元に収まり halfvec 不要。cosine(`vector_cosine_ops`)・HNSW 既定(m=16 / ef_construction=64)。
