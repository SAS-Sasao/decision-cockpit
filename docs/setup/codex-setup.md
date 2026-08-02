# Codex 導入手順(codex-ops v1 — 読取専用セカンドオピニオン)

正典 = docs/design/basic/codex-ops.md(端末レビュー)+ docs/design/basic/codex-spar.md
(壁打ち Codex モード — §6 参照)。運用ルール = .claude/rules/codex.md。
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

## 6. 壁打ち Codex モード(codex-spar — dev ランナー)

UI(壁打ちパネル)から Codex に repo・設計書のレビューを依頼できるローカル開発限定モード。
正典 = docs/design/basic/codex-spar.md。

1. **有効化フラグ**: `.env` に `NEXT_PUBLIC_CODEX_SPAR=1` を追記(あなたの操作)して
   `docker compose up` を再起動。**本番(Vercel)には設定しない**(未設定 = チップ非表示)。
2. **ランナー起動(人間の端末から)**: `npm run codex:serve` — 127.0.0.1:8788 で待ち受け
   (LAN 非公開・Origin/Content-Type/Host の受理3検証・直列1件・10分上限)。停止は Ctrl-C。
   **アプリは必ず `http://localhost:3000` で開く**(127.0.0.1:3000 は Origin 検証で拒否される)。
3. **初回受け入れ検査(ゲート — 正 = codex-spar 設計 §5 の (a)〜(h))**: 全 PASS まで運用開始しない。
   1つでも fail = 導入中止して設計を改訂(3レンズ再通過)。結果は next-actions に記録:
   (a) 1問実行 → 応答表示 + 元 repo の `git status --porcelain` が空(ランナー警告なし)
   (b) ランナー停止中はエラー文言のみ(アプリは正常)
   (c) フラグ未設定でチップ非表示(本番相当)
   (d) LAN の別端末から 8788 に到達できない
   (e) 出力に秘密の引用が無い(補助)
   (f) 質問で curl 実行を依頼 → サンドボックスに遮断される(ネットワーク到達試験)
   (g) 昇格・承認要求が出ない(approvalPolicy=never をコードで固定済み — 挙動確認)
   (h) 認証経路のデータ**保持**・学習設定 + 従量キーなら上限設定 + `~/.codex` のセッション記録の
       有無を確認してここに記録
4. **注意**: レビュー対象は**コミット済み(HEAD)のみ**。質問文に秘密・未コミット diff を**貼らない**。
   Codex 応答は「結論として保存」に乗せない(パネルが構造的に除外済み)。
