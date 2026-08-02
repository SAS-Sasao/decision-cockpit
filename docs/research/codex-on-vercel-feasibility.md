# 調査: Vercel 本番で Codex(エージェント)をサーバ側実行できるか

- 実施: 2026-08-02(research-spike・Web 一次情報ベース)
- 背景: codex-spar(CS-1)のローカル「ホスト側ランナー」を本番でも使いたいという要望の可否判定。

## 判定: **Vercel 単体では実質不可**

根拠(優先度順):

1. **サンドボックスが起動できない(根本ブロッカー)**: codex の Linux サンドボックスは
   bubblewrap(bwrap)+ Landlock/seccomp で、**unprivileged user namespace が必須**。
   Vercel Functions の実行基盤(AWS Lambda 系 Firecracker)は unprivileged userns 作成を
   **明示的に禁止**しており(aws/containers-roadmap#2102)、テナント側にカーネル設定の変更権限が
   無い。フォールバックは `--sandbox danger-full-access` のみ = read-only サンドボックスという
   codex-ops/codex-spar の安全前提が崩れるため不採用。
2. **実行時間**: Hobby は **300秒が絶対上限**(Fluid compute 込み)。Codex 実行 1〜5分に余裕なし。
   Pro 800秒 / 1800秒(beta)でも 1 は解消しない。
3. **サイズ**: 関数デプロイ 250MB(標準)vs codex バイナリ ~100〜240MB — Large Functions(beta)
   opt-in がほぼ必須。
4. git 非同梱・/tmp 500MB は GitHub tarball 取得で回避可能(致命的ではない)。

## 代替アーキテクチャ(Vercel = UI・実行は外部)

| 案 | 概要 | 工数 | 月額感 | 主論点 |
|---|---|---|---|---|
| **1. GitHub Actions(推奨)** | 公式 `openai/codex-action` で `codex exec`(read-only sandbox **動作実績あり** — action が userns を有効化)。アプリからは workflow_dispatch → 結果を DB/PR 経由で還流 | 小〜中 | ほぼ無料 + API 従量 | 既存 CI 統治(organize-loop の 3-job 分離・secrets 非露出)を codex 版でも踏襲。非同期(分単位)UI |
| 2. Cloud Run ランナー | serve.ts をコンテナ化・scale-to-zero・タイムアウト最大60分 | 中 | ほぼ無料〜数百円 | **bwrap が gVisor 上で動くか PoC 必須**。Vercel↔Cloud Run の認証設計 |
| 3. Fly.io マシン | 現行 serve.ts の最短移植(VM・sysctl 変更余地あり) | 小〜中 | 数ドル〜$32 | インフラ運用(監視・障害対応)が増える。要 userns 実測 |

- OpenAI Codex cloud(ホスト版): GitHub 連携はあるが**プログラム的トリガーの公開 API が見当たらない**
  (2026-08 時点)— API 駆動要件には現状不適。
- 認証: サーバ側自動実行は **`CODEX_API_KEY`(従量課金)一択**(ChatGPT ログインはヘッドレス不可)。
  コスト上限設計が必須になる。

## 未解決(設計前に要 PoC)

- Vercel Functions 上での bwrap 失敗の実測(本判定は Lambda 一般制約 + Replit/Docker 実例からの類推)。
- Cloud Run(gVisor)での bwrap 可否。
- Codex cloud の API 公開動向。

主要出典: vercel.com/docs/functions/{configuring-functions/duration,limitations} /
github.com/openai/codex issues #16018 #16211 / aws/containers-roadmap#2102 /
github.com/openai/codex-action / developers.openai.com/codex/{auth,github-action} /
docs.cloud.google.com/run(詳細 URL は調査ログ参照)。
