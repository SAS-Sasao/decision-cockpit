# Codex 導入手順(codex-ops v1 — 読取専用セカンドオピニオン)

正典 = docs/design/basic/codex-ops.md。運用ルール = .claude/rules/codex.md。
**有効化はすべてユーザー操作**(M5 / wbs-loop と同型)。

## 1. インストールと認証

1. Codex CLI をインストールする(`npm i -g @openai/codex` 等 — 公式手順に従う)。
2. 認証する。**API キー・認証情報はチャット・リポジトリ内ファイルに貼らない**(既存規範)。
3. **データ保持・学習利用の設定を確認して下表に記録する**(認証経路 — ChatGPT ログイン / API キー —
   により扱いが変わるため。送信対象は「git 追跡ファイル全文」であることを踏まえて判断する):

   | 確認項目 | 確認日 | 結果 |
   |---|---|---|
   | 学習利用(トレーニング)の off | (未実施) | (記入) |
   | データ**保持**期間のポリシー | (未実施) | (記入) |

## 2. 起動フラグの確定

- **起動は必ず `scripts/codex/review.sh` 経由**(クリーンコピー隔離 + サンドボックス + approval 固定)。
- `codex --help` で実フラグを確認し、review.sh 冒頭の `CODEX_ARGS`(読取専用サンドボックス +
  承認なしで昇格しない **approval** 設定)を実在のフラグ名に確定する。
  設計はフラグ名をピンしない(バージョンドリフトは review.sh 1ファイルに局所化)。

## 3. 初回受け入れ検査(ゲート)

**全 PASS まで運用開始しない。1つでも fail = 導入中止して本設計を改訂(3レンズ再通過)。**
結果は docs/setup/next-actions.md に記録する。

- (a) レビューを1回実行して、元 repo の `git status --porcelain` が**空**であること
  (review.sh が終了時に表示する)。
- (b) コピー先に **gitignore 資産全般が不在**であること — 代表確認 = `.env`・`e2e/.auth/`・
  `e2e/screenshots/` の3パス(review.sh 自身も起動前に毎回 assert する — 初回限りではない)。
- (c) サンドボックス内からの**ネットワーク到達試験**(例: コピー内で curl 実行を依頼して遮断される
  こと)。到達できてしまう場合も同じ扱い = 導入中止して本設計を改訂。
- (d) **approval 昇格の挙動確認** — サンドボックス外実行・書き込みの承認要求が出ても**承認しない**
  運用を確認する(承認プロンプトが出ない設定が望ましい)。
- (e) 出力に秘密の引用が無いこと(補助チェック — 「読んだだけの送信」は検出できない限界を理解して
  運用する。第一層はクリーンコピー隔離)。

## 4. 使い方の例(人間の端末から)

```bash
# 設計書のセカンドオピニオン
scripts/codex/review.sh "docs/design/basic/codex-ops.md をレビューして。指摘は ファイル:行/問題/根拠 で"

# マージ前のブランチレビュー(コミット済みの内容が対象 — 未コミット diff は対象外)
scripts/codex/review.sh "main と HEAD の差分をレビューして"
```

- プロンプトに未コミット diff・秘密・実データを**貼らない**(隔離の迂回になる)。
- 指摘は参考意見 — 採用は Claude Code の通常フロー(設計改訂 / fix ブランチ)に乗せる。

## 5. 漏えい時対応(失効・ローテーション一覧)

万一 `.env` の値の露出が疑われる場合は、**即座に**以下を失効・再発行する:

| 秘密 | 失効・ローテーション先 |
|---|---|
| `DATABASE_URL` | Neon コンソール → Reset password → .env / Vercel / GitHub Secrets 差し替え |
| `GITHUB_TOKEN` / 各 PAT | GitHub → Settings → Developer settings → 再発行(旧トークン revoke) |
| `EMBEDDING_API_KEY` / `SPAR_API_KEY` | 各プロバイダのコンソールでキー再発行(旧キー削除) |
| `NEON_AUTH_COOKIE_SECRET` | 新値を生成して差し替え(全セッション失効) |
| `CRON_SECRET` | 新値を生成して .env / Vercel に登録 |
