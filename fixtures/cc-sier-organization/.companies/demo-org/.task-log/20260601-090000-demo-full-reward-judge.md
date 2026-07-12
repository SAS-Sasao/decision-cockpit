---
task_id: "20260601-090000-demo-full-reward-judge"
org: "demo-org"
operator: "demo-operator"
status: completed
mode: "subagent"
started: "2026-06-01T09:00:00+09:00"
completed: "2026-06-01T09:20:00+09:00"
request: "デモ用の依頼内容のテキストです。これはタイトル先頭120字への切り詰めを確認するために十分に長い文章になるよう意図的に書いています。ここまでで120字を超える想定です。さらに文章を続けて確実に120字を超えるようにするため、もう少しだけ追記しておきます。"
issue_number: null
pr_number: null
---

## 実行計画
- 実行モード: subagent
- 判断理由: デモ用の固定シナリオ

## エージェント作業ログ
### demo-agent
- 作業: デモ成果物を作成
- 成果物: docs/example-output.md

## reward
```yaml
score: 0.9
signals:
    completed: true
    artifacts_exist: true
    excessive_edits: false
    retry_detected: false
evaluated_at: "2026-06-01T09:20:00+09:00"
```

## judge
```yaml
completeness: 4
accuracy: 5
clarity: 3
total: 0.83
failure_reason: ""
judge_comment: "デモ用コメント"
judged_at: "2026-06-01T09:20:00+09:00"
```
