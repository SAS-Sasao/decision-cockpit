---
name: scaffold-cockpit
description: Decision Cockpit の最小スキャフォールド(Next.js App Router + Neon 前提の骨格・ディレクトリ・設定)を作成/補修する。新規セットアップや骨格の欠損を埋めたいときに使う。
---

# scaffold-cockpit

Next.js(App Router, TS)+ Neon(pgvector)前提の最小骨格を整える。

## 手順
1. 既存ファイルを確認し、**不足のみ補う**(破壊的に上書きしない)。
2. app/(layout + 今日/検索/振り返りの3画面)、lib/、db/migrations/、tests/、fixtures/、
   docs/design/{basic,detail,reviews}/、docs/research/ を用意する。
3. package.json の scripts(dev/build/lint/typecheck)と tsconfig を確認する。
4. `npm run build` が exit 0 になることを確認する(env 不要の静的骨格)。

## 禁止
- 秘密情報の直書き。元 repo への書き込み。.env への書き込み(.env.example のみ)。
