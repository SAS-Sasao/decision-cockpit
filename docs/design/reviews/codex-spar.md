# design-review: codex-spar(基本)

- 対象: docs/design/basic/codex-spar.md
- 実施日: 2026-08-02
- 方式: 3レンズ並行 × 2ラウンド(R2 は data/sec — arch は R1 PASS・問い6件を反映)

## Round 1 — arch PASS(問い G1〜G6)/ data **FAIL** / sec **FAIL**

| # | レンズ | 指摘(中核) | 反映 |
|---|---|---|---|
| 1 | sec **FAIL** | **CORS は応答読取の制御であり送達を止めない** — cross-site simple POST(CSRF)と DNS rebinding が 127.0.0.1:8788 に到達し得る。破れると CO-1 の受容前提(注入源 = 自己管理のみ)が「ユーザーが訪問した任意の Web ページ」まで拡大し、注入・exfil・コストの3リスクが同時に前提を失う | **受理3検証を IF 契約に昇格**: (i) Origin 完全一致必須(欠落 = 403 — 素の curl も構造的に拒否)(ii) Content-Type application/json 必須(simple request 不成立・プリフライト強制)(iii) Host 完全一致(rebinding 遮断)。3検証は serve-lib 純関数 + テスト + ピン。トークン認証は検討の上不採用(根拠を §4 に記録) |
| 2 | data **FAIL** | **Codex 応答が既存の結論保存経路で capture_inbox → organize-loop → SSoT の PR 書き戻しに合流し得る**(spar-panel の lastAssistant → saveCapture 経路)— 設計が無言 | **構造で遮断**: 結論保存の対象 = SPAR 応答のみ。純関数 `latestSparConclusion`(codex スキップ)+ 実使用ピン + codex.md 規律 |
| 3 | data **FAIL** | 第2経路(UI・低摩擦)としての**外部送信範囲(質問文 + 追跡全文)の受容行が欠落**・手動ゲートが CO-1 (c)(d) から縮退 | §3 に送信範囲明示 + §4 に独立受容行(CO-1 明示継承・頻度が異なる別個の受容)+ UI 常時注記 + ゲートを (a)〜(h) に完全化((f) ネットワーク到達・(g) approval・(h) 保持/学習/従量上限/~/.codex) |
| 4 | arch | approval 不変条件の欠落(G1)/ git status 事後検知パリティ(G2)/ localhost:3000 前提と WSL2(G3)/ ピンとドリフト方針の緊張(G4)/ guard deny 実行形の抽象(G5)/ architecture.md 非改定の判断(G6) | 昇格ポリシー固定を導入時確定事項に + ゲート (g) / リクエスト毎の status 比較警告 + ピン / 前提明記 + エラー文言 + ゲート (a) / ピンはコード実体で満たす規律 / deny 実行形を列挙 / §2 に意図的判断を記録 |

## Round 2 — **data PASS / sec PASS**(中核解消を確認)→ 残問い8件を反映

| # | レンズ | 問い | 反映 |
|---|---|---|---|
| 1 | data | SPAR モード送信の history に codex ターンが混入する(逆方向のクロス送信) | **除外** — `sparHistory` 純関数で SPAR ターンのみ送る(テスト + 実使用ピン) |
| 2 | data | エラー語彙が 415/Host 不一致をカバーしない | 写像を完全化(403 `forbidden` / 415 `unsupported_media` / 400/429/502/504) |
| 3 | data | ピンのコメント充足禁止が条件0 限定に読める | **§5 全条件に適用**と明記 |
| 4 | data | codex 応答のみの会話での保存ボタン | SPAR 応答が無い会話では**非表示**(空エディタを出さない) |
| 5 | sec | OPTIONS に CT 検証を課すと正規プリフライトが死ぬ(実装時の緩和誘因) | OPTIONS = Origin/Host のみ・CORS 返却のみ・実 POST は3検証フル適用、を IF に明記 |
| 6 | sec | grep ピンが部分一致で空洞化し得る | ピン = 存在の下限・**実体担保 = 条件5 の新規テスト**(judge はテスト内容まで確認)と明記 |
| 7 | sec | env allowlist に機械ピンが無い(丸ごと継承への退行が検知不能) | `buildChildEnv` 純関数に切り出し + serve.ts/serve-lib 両ピン + テスト |
| 8 | sec | 一時 dir 破棄の安全形が CO-1 比で弱い | 破棄対象 = 一時 dir 生成が返したパス変数のみ・固定パス直書き禁止・force 系なし |

sec R2 は3検証の相互バックストップを攻撃経路マトリクスで確認済み(form POST = 415+403 二重 /
JSON fetch = プリフライト遮断 / CT 例外バグ = Origin がバックストップ / rebinding = Host が遮断 /
Origin null = 不一致扱い 403 / WebSocket = POST 限定 + upgrade 未登録で不成立)。

## 合格判定

**全レンズ PASS** — /goal CS-1 へ進む。

## /goal CS-1 への申し送り

- 成果物 = serve.ts / serve-lib.ts / spar-panel.tsx 改修 / spar-panel-lib.ts / tests/codex-spar.test.ts /
  package.json(+lock)/ .env.example / guard-bash.sh / codex.md / AGENTS.md / codex-setup.md
  (§5 条件2 の allowlist が正)。/api/spar・lib/spar は**非接触**。
- 純関数4本がテストの主対象: 受理3検証(Origin/CT/Host)・`latestSparConclusion`・`sparHistory`・
  `buildChildEnv`。**ピンはコード実体で満たす**(コメント・エラー文字列での充足禁止 — §5 全条件)。
- guard deny の実行形 = `npm run codex:serve` / `(npx )?tsx scripts/codex/serve.ts` / node 実行形。
  引数としての `codex:serve` に一致させない。パイプテストで deny/allow 両側を検証しログを judge に提示。
- SDK の実 API・認証・昇格ポリシー固定は導入時確定(serve.ts に局所化)— ただし "read-only" 等の
  ピン語は SDK 呼び出し実体で満たすこと。
- 有効化はユーザー操作: ゲート (a)〜(h)(§5 が正)。fail = 導入中止して本設計を改訂(3レンズ再通過)。
