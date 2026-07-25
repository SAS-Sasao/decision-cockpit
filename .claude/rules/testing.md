# テスト

- すべて**機械判定可能**にする(exit code / 件数 / スナップショット)。曖昧な「目視 OK」は不可。
- **テスト中の実ネットワークアクセス禁止。** GitHub / Neon / 埋め込み API はモック or fixture で代替。
  **本規約の対象は `npm test`(vitest)の機械判定スイート。** Playwright E2E(`npm run e2e`)は
  ローカル専用の運用ツール(実ブラウザ・実アプリ対象)で、CI・`npm test` には組み込まない
  (正典 = docs/design/basic/front-check.md)。
- fixture は `fixtures/` の**匿名サンプル**のみ。実データ・機微情報を置かない。
- パーサ/検索ロジックはユニット、API / Action は契約テスト。受け入れ条件は `/goal` で検証する。
