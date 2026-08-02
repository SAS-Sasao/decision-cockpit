// 対象設計: docs/design/basic/codex-spar.md §1 やる-2(結論保存の除外・history 分離 — 純関数・テスト対象)
//
// Codex 応答(repo 追跡ファイル由来の派生テキスト)を capture_inbox → organize-loop → SSoT 書き戻しの
// 経路に乗せない(data R1 中核)。逆方向 = SPAR 側の外部 API へ codex ターンを history 送信しない(data R2)。

export type SparMode = "spar" | "codex";

export type TurnLike = {
  role: "user" | "assistant";
  content: string;
  mode: SparMode;
};

/** 結論保存の初期値: 最新の SPAR 応答(codex ターンはスキップ)。SPAR 応答が無ければ null(= 保存ボタン非表示)。 */
export function latestSparConclusion<T extends TurnLike>(turns: readonly T[]): T | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === "assistant" && turn.mode === "spar") return turn;
  }
  return null;
}

/** SPAR 送信用 history: SPAR ターンのみ(codex の質問・応答を含めない)。 */
export function sparHistory(
  turns: readonly TurnLike[]
): { role: "user" | "assistant"; content: string }[] {
  return turns
    .filter((turn) => turn.mode === "spar")
    .map((turn) => ({ role: turn.role, content: turn.content }));
}
