# 基本設計: tag-cold-start(コールドスタート時のタグ空問題の恒久修正)

- 起点: 2026-07-20 の DB 全消失事故の復旧作業で判明した既存バグ(docs/setup/next-actions.md「事故と再発防止」)。
- 性質: **軽量1枚設計**(基本設計のみで /goal に直結。詳細設計は起こさない — 変更が run-sync.ts 内の2点に閉じるため)。

## 1. 目的 / スコープ

### 問題

`lib/ingestion/run-sync.ts` はタグ語彙(`tag_synonyms` 全件)を **`runSync()` 冒頭に一度だけ**ロードし、
そのスナップショットをラン全体で使い回す(run-sync.ts:140・現行コメントに明文化された契約)。
語彙の供給源である masters ファイル(`.companies/<org>/masters/*.md`)は**同じランの中で**
`upsertTagSynonyms` により DB へ投入されるが、**ラン内のスナップショットには反映されない**。

結果: **`tag_synonyms` が空の状態(コールドスタート)からの初回同期では、そのランで取り込んだ
全レコードの `tags` が空になる**。ローカルでは 2026-07-20 の復旧時に実際に発生(8,013行が全行 tags 空)。
**Vercel 本番の初回同期でも必ず起きる**(現在の回避策 = 同期を2回走らせる / db-recovery.md 手順3 対処B)。

### やる

1. **masters 優先順序**: `syncRepo` の処理対象(`pending`)を「masters → それ以外」の**安定パーティション**に
   並べ替えてから `maxFiles` スライスする(元の相対順は各グループ内で維持 = 決定的)。
2. **ラン内語彙マージ**: masters 処理時、`upsertTagSynonyms` に加えて**ラン内の vocab 配列へ in-memory マージ**する
   (DB upsert と同じ置換セマンティクス: 同 synonym は canonical を置換・新規は末尾追加)。
   マージヘルパ `mergeTagVocab(vocab, entries): void` を `lib/ingestion/tag-vocab.ts` に新設(決定的・ユニットテスト対象)。
3. run-sync.ts:138-139 の**コメント契約を更新**(「同ランの他ファイルには反映しない」→「同ランの後続ファイルに反映する」)。
4. **凍結例外(1ケース)**: 現行挙動をピン留めしている `tests/ingestion/run-sync.test.ts:348`
   「語彙はラン冒頭のスナップショットを使う(…反映されない)」の**期待を反転**し、タイトルも新契約に改題する。
   既存テストの変更は**このケース1件のみ**。
5. 開発体験の小修正2点(同じ goal に同梱・タグ問題とは独立):
   - `scripts/sync-local.ts` に `export {};` を追加(embed-local.ts と同じモジュールスコープ化。
     グローバルスコープの一時スクリプトとの TS2393 衝突を構造的に防ぐ)。
   - `.gitignore` に `tsconfig.tsbuildinfo` を追加(incremental キャッシュ。**古いキャッシュが削除済みファイルを
     参照し続けて幻の TS2393 を報告する**ことを 2026-07-25 に確認済み。コミット混入も防ぐ)。

### やらない

- 類義語統合(synonym ≠ canonical の語彙)— 従来どおり将来トピック。
- 生成 MD の frontmatter tags の索引反映 — organize-loop 詳細 R2 H-2 で M6 送りと決定済み(申し送りを維持)。
- 既存レコードのタグ再計算(バックフィル)— 運用手順(db-recovery.md 手順3 対処B)の領分。本修正は**今後の同期**を直す。
- `synced_at` / 埋め込みパイプラインへの変更 — 一切触れない(再埋め込みを誘発しない)。
- allowlist / パーサ / store の変更。

## 2. アーキテクチャ上の位置づけ

- 3層のうち **Ingestion 層**のみ。`runSync` / `syncRepo` のランオーケストレーション内部の順序と
  ラン内キャッシュの一貫性の修正であり、SSoT との関係・読み取り専用の原則・冪等 upsert キーは**不変**。
- vocab 配列は `runSync` で1回生成し **adapters 間で参照共有**される(現行実装のまま)。
  マージは in-place mutation のため、**先頭 adapter(cc-sier-organization = 語彙の供給源)で取り込んだ語彙が
  後続 adapter(ai-war-room)にも効く**。この **repo 横断の語彙適用は意図どおり**(ai-war-room の判断ログにも
  組織語彙でタグを付けるのが結合キー設計の狙い。単一ユーザー前提)。
- `buildAdapters()`(app/api/sync/route.ts:30 / scripts/sync-local.ts:54)はすでに cc-sier-organization を
  先頭に固定しており、**この順序が前提**であることを本設計で明文化する(コード変更不要)。順序自体の機械ピンは
  置かない(**文書化のみで受容**)が、横断伝播のメカニズムは §5 の**クロス adapter 契約テスト**で担保する
  (順序が壊れた場合の劣化は「ai-war-room の初回ランのみタグ薄・次ランで回復」に限定される)。
- `store.ts:56` の doc コメント(「ラン冒頭に一度だけロードして使う語彙スナップショット」)は**据え置き(意図的)**。
  ロードが1回である事実は新契約でも真のまま(ラン内で成長するのは配列の中身)。store.ts は不変更。
- **tags 配列の順序は契約外**(集合セマンティクス)。`getAllTagSynonyms` は元々 ORDER BY なしで順序非保証であり、
  ラン内マージ後と次ラン DB ロードで配列順が異なりうるが、applyTags は canonical 重複排除の集合として使うため実害なし。
  順序を検証するテストは書かない(既存にも無い)。

## 3. データ / インターフェース概要

### 変更IF(新設1・変更0)

```ts
// lib/ingestion/tag-vocab.ts に追加
/** DB の upsertTagSynonyms と同じ置換セマンティクスで vocab 配列を in-place 更新する。
 *  同 synonym は canonical を置換・新規は末尾追加。戻り値なし・決定的。 */
export function mergeTagVocab(vocab: TagVocabEntry[], entries: TagVocabEntry[]): void
```

### run-sync.ts の変更(2箇所)

```ts
// (1) syncRepo: pending の安定パーティション(slice の前)
const ordered = [
  ...pending.filter((f) => f.match.kind === "masters"),
  ...pending.filter((f) => f.match.kind !== "masters"),
];
const toProcess = maxFiles === 0 ? ordered : ordered.slice(0, maxFiles);

// (2) masters 処理ブロック: 既存の entries.length > 0 ガードの内側で upsert 後にマージ
if (entries.length > 0) {
  await upsertTagSynonyms(entries);
  mergeTagVocab(vocab, entries);
}
```

### 多ラン整合(進行カーソルとの整合)

- `maxFiles` が小さくても (1) により masters が最初のバッチで `done` に入る。
  以降のランは冒頭の `getAllTagSynonyms()` で DB から拾うため、**どのラン分割でもレコード処理時に語彙が揃う**。
- `done` は path の Set であり順序に依存しない。並べ替えは進行カーソル(`progress.done` / `hasMore` / 据え置き
  `last_commit`)の意味論を変えない。

## 4. リスク・トレードオフ

| リスク | 評価 / 手当て |
|---|---|
| masters の fetch が一時失敗(fetch_failed)したコールドスタート run では、同 run のレコードが依然タグ薄になる | 許容。次 run で masters が再試行され(done に入っていない)、以降のレコードは正しくタグ付く。**タグ薄になった既取り込みレコードの回復は、当該レコード自身が changedPaths に再登場した時か、運用の対処B(force)のみ**(自然回復は保証しない — 発生条件が「コールドスタート × masters の一時失敗」の重なりで極めて稀なため受容) |
| **部分復元状態**(sync_state は残存・tag_synonyms のみ空)では masters が changedPaths に現れず本修正は効かない | 受容(本修正の対象は「完全コールドスタート = sync_state も空 → full 列挙」)。半端な状態からの回復は対処B(force)の領分と割り切る(db-recovery.md 手順3 に明記済み) |
| 並べ替えにより「listPaths の列挙順で処理される」暗黙仮定が壊れる | 依存箇所を確認済み: done は Set・upsert は冪等・summary は件数のみで順序非依存。ピン留めテストの反転は §1-4 の1件のみ |
| in-memory マージと DB upsert の意味差 | mergeTagVocab を DB と同じ「synonym キーで置換」に固定しユニットテストで機械判定 |
| adapters の順序に意味が生まれる(cc-sier が先頭前提) | 既に両呼び出し元で固定済み。本設計 §2 に前提として明文化(コード変更なし) |

## 5. 受け入れ条件(機械判定)

```bash
# 1. 全テスト緑(新ケース含む)— ホスト実行(既往 goal 条件の正。app コンテナには git が無く
#    check-no-secrets.test.ts が動かないため、コンテナ内実行は不可 — TCS-1 実装中に確認)
env -u GITHUB_TOKEN -u DATABASE_URL -u OPENAI_API_KEY -u SPAR_PROVIDER -u SPAR_MODEL -u SPAR_API_KEY npm test   # exit 0

# 2. 新テストケースの存在(ケース名 grep・すべて hit)
grep -q "コールドスタート" tests/ingestion/run-sync.test.ts
grep -q "mergeTagVocab" tests/ingestion/tag-vocab.test.ts
grep -q "反映される" tests/ingestion/run-sync.test.ts          # 反転後の新契約タイトル
! grep -q "反映されない" tests/ingestion/run-sync.test.ts      # 旧契約タイトルの残置なし

# 3. 実装ピン
grep -q "mergeTagVocab" lib/ingestion/run-sync.ts
grep -q "export function mergeTagVocab" lib/ingestion/tag-vocab.ts
! grep -q "同ランの他ファイルには反映しない" lib/ingestion/run-sync.ts   # 旧コメント契約の残置なし

# 4. 型健全(incremental キャッシュ非依存)
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit                 # exit 0

# 5. 小修正2点
grep -q "export {}" scripts/sync-local.ts
grep -q "tsconfig.tsbuildinfo" .gitignore

# 6. ビルド(.env 非接触・ダミー env)
docker compose run --rm -T -e DATABASE_URL=postgres://dummy:dummy@db:5432/dummy app npm run build   # exit 0

# 7. 変更の閉包(実行形): git diff main --name-only の全行が allowlist に含まれること
git diff main --name-only | grep -vxF -e 'lib/ingestion/run-sync.ts' -e 'lib/ingestion/tag-vocab.ts' \
  -e 'tests/ingestion/run-sync.test.ts' -e 'tests/ingestion/tag-vocab.test.ts' \
  -e 'scripts/sync-local.ts' -e '.gitignore' \
  -e 'docs/design/basic/tag-cold-start.md' -e 'docs/design/reviews/tag-cold-start.md' \
  -e 'docs/setup/next-actions.md' -e 'docs/setup/db-recovery.md' | wc -l   # = 0
```

テスト観点(§5-1 の中身):
- **mergeTagVocab ユニット**(tests/ingestion/tag-vocab.test.ts): 置換(同 synonym で canonical 更新)/
  追加(新規 synonym)/ 空 entries で不変 — の3点。
- **コールドスタート契約**(tests/ingestion/run-sync.test.ts 新規): `tag_synonyms` 空 + listPaths が
  **[record, masters] の順**(= レコードが先に列挙されても)で、同一ラン内に record へ masters 由来タグが付く。
- **クロス adapter 契約**(tests/ingestion/run-sync.test.ts 新規): adapter 2つ(cc-sier-organization に masters・
  ai-war-room に decision レコード)を1回の runSync に渡し、**後続 repo のレコードにも先頭 repo の語彙が効く**こと。
- **反転ケース**(§1-4): 既存ケースの期待を `record.tags` **toContain** に反転。
- fixture / FakeAdapter のみ(実ネットワーク禁止・既存のテスト基盤を流用)。

## 6. 実装の分割と禁止事項

- **/goal TCS-1**(1本のみ・主セッション実施・判定 = acceptance-judge・ターン上限 8):
  実装 → §5 全条件 → 節目 commit(実装+テストで1・docs 更新で1)→ judge → merge --no-ff。
- 禁止: `.env` 非接触(退避も禁止)/ 実ネットワークをテストへ持ち込まない / `synced_at`・埋め込み関連コードに触れない /
  破壊的 SQL・タグ再計算 SQL を書かない / §5-7 の allowlist 外のファイルに触れない。

## 7. 未解決の問い

- なし(fm.tags の索引反映は M6 の別トピックとして申し送り済み — organize-loop 詳細 R2 H-2)。
