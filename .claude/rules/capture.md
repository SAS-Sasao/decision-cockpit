# capture(UI 入力)契約

- UI からの入力は `capture_inbox` テーブルに1行として記録する。
- **kind 語彙 = `status` / `issue` / `next_move` / `spar_conclusion`** のいずれか(他の値は不可)。
- 各行: `id, user_id(所有者), kind, topic, tags, body, source, created_at, processed_at(NULL=未処理), curated_ref(書き戻し先), status(手動トリアージ)`。
- **status 語彙 = CHECK (status IN ('open','in_progress','done'))**(0006・capture-triage)— **ユーザーの手動トリアージ状態**。UI は**本人行の status のみ UPDATE 可**(processed_at / curated_ref は M5 の整理ループ専用のまま)。未処理バッジ = `user_id スコープ AND processed_at IS NULL AND status = 'open' AND deleted_at IS NULL`。**status と自動整理の関係(消費対象を status='open' に絞るか等)は M5 設計で確定**(docs/design/basic/capture-triage.md §5 の申し送り参照)。
- **deleted_at(0007・capture-trash)= 論理削除**: NULL = 生存。UI は**本人行の deleted_at の付与/解除(ゴミ箱/復元)のみ可**・**物理 DELETE は禁止**(行は DB に残る)。一覧・バッジは `deleted_at IS NULL` のみ表示(ゴミ箱一覧は `IS NOT NULL`)。**削除行を M5 の消費対象から除外するか(推奨: `processed_at IS NULL AND deleted_at IS NULL`)は M5 設計で確定**(docs/design/basic/capture-trash.md §5 の申し送り参照)。
- **各行は user_id 所有(帰属)**。参照は所有者本人のみ(アプリ層で user_id スコープを強制)。
- Claude Action は **`processed_at IS NULL` の行のみ**処理し、完了時に `processed_at` と `curated_ref` を更新する(冪等)。
  消費は**全ユーザー一括(created_at 順)**で行い、生成物への帰属の扱いは M5 設計で確定する。
- 機微な入力は保存しない。書き戻しは ai-war-room への **PR** で行い、直接 push しない。
