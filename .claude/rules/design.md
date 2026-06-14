# 設計の順序

- **実装(/goal)の前に、対象トピックの設計が docs/design/ に存在し design-review を PASS していること。**
- 基本設計: `/basic-design <topic>` → docs/design/basic/<topic>.md(必須セクションに「受け入れ条件(機械判定)」を含む)。
- 詳細設計: `/detailed-design <topic>` → docs/design/detail/<topic>.md(スキーマ DDL / 関数 IF / テスト観点 / 受け入れ条件)。
- レビュー: `/design-review <topic>` → arch / data / sec の3 critic に委譲。**全レンズ PASS で合格**(docs/design/reviews/ に出力)。
- **設計の執筆は主セッション(human-in-loop)で行う。critic(design-*-reviewer)には書かせない**(critic は読み取り専用)。
