# capture(UI 入力)契約

- UI からの入力は `capture_inbox` テーブルに1行として記録する。
- **kind 語彙 = `status` / `issue` / `next_move` / `spar_conclusion`** のいずれか(他の値は不可)。
- 各行: `id, user_id(所有者), kind, topic, tags, body, source, created_at, processed_at(NULL=未処理), curated_ref(書き戻し先)`。
- **各行は user_id 所有(帰属)**。参照は所有者本人のみ(アプリ層で user_id スコープを強制)。
- Claude Action は **`processed_at IS NULL` の行のみ**処理し、完了時に `processed_at` と `curated_ref` を更新する(冪等)。
  消費は**全ユーザー一括(created_at 順)**で行い、生成物への帰属の扱いは M5 設計で確定する。
- 機微な入力は保存しない。書き戻しは ai-war-room への **PR** で行い、直接 push しない。
