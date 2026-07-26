-- 復旧用の定型 down(運用では人間承認なしに実行しない — docs/design/detail/wbs-loop.md §1)。
DROP TABLE IF EXISTS board_overrides;
