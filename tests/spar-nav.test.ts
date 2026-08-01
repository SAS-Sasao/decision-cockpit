// 対象設計: docs/design/basic/spar-navigate.md §1-2/§1-3/§4(tests/spar-nav.test.ts)
// applyNavExtraction(合成 — 本文契約の正)を対象にする(route の自前合成をテストしない)。
import { describe, expect, it } from "vitest";
import { applyNavExtraction, buildNavs, extractNavBlock } from "../lib/spar/nav";

const FENCE = (json: string) => "```nav\n" + json + "\n```";

describe("applyNavExtraction — 正常系", () => {
  it("knowledge 提案: 固定リテラル起点 href + encode(モデル文字列はクエリ値のみ)", () => {
    const reply = "類例があります。\n" + FENCE('[{"kind":"knowledge","q":"pgvector 精度","type":"decision"}]');
    const { body, navs } = applyNavExtraction(reply);
    expect(body.trim()).toBe("類例があります。");
    expect(navs).toEqual([
      { label: "🔍 decision で「pgvector 精度」を検索", href: "/knowledge?q=pgvector%20%E7%B2%BE%E5%BA%A6&type=decision" },
    ]);
  });

  it("retro 提案: g の enum のみ・ラベルはサーバテンプレート", () => {
    const reply = "月で見ましょう。\n" + FENCE('[{"kind":"retro","g":"month"}]');
    const { navs } = applyNavExtraction(reply);
    expect(navs).toEqual([{ label: "📅 振り返りを月粒度で表示", href: "/retro?g=month" }]);
  });

  it("protocol-relative や生 URL は構造的に生成されない(href は固定リテラル起点)", () => {
    const reply = "x\n" + FENCE('[{"kind":"knowledge","q":"//evil.com/steal"}]');
    const { navs } = applyNavExtraction(reply);
    expect(navs).toHaveLength(1);
    expect(navs[0]!.href.startsWith("/knowledge?q=")).toBe(true);
    expect(navs[0]!.href).toContain("%2F%2Fevil.com"); // クエリ値としてエンコードされるだけ
  });
});

describe("applyNavExtraction — 破棄系(fail-soft)", () => {
  it("語彙外 kind は破棄・全滅ならフェンスを除去しない(本文復元)", () => {
    const reply = "本文です。\n" + FENCE('[{"kind":"logout"},{"kind":"navigate","url":"https://evil"}]');
    const { body, navs } = applyNavExtraction(reply);
    expect(navs).toEqual([]);
    expect(body).toBe(reply); // フェンスごと本文に残る = 隠蔽不可能
  });

  it("4件目以降は破棄(最大3件)", () => {
    const items = Array.from({ length: 5 }, (_, i) => `{"kind":"knowledge","q":"q${i}"}`).join(",");
    const { navs } = applyNavExtraction("x\n" + FENCE(`[${items}]`));
    expect(navs).toHaveLength(3);
  });

  it("文字種違反(制御文字・bidi・改行入り q)は破棄", () => {
    const reply = "x\n" + FENCE('[{"kind":"knowledge","q":"a\\u202eb"},{"kind":"knowledge","q":"a\\nb"}]');
    const { navs } = applyNavExtraction(reply);
    expect(navs).toEqual([]);
  });

  it("壊れた JSON は fail-soft(navs=[]・本文はフェンスごと原文維持)", () => {
    const reply = "本文。\n" + FENCE("{not json");
    expect(applyNavExtraction(reply)).toEqual({ body: reply, navs: [] });
  });

  it("q の長さ 100 超・空は破棄", () => {
    const long = "あ".repeat(101);
    const { navs } = applyNavExtraction("x\n" + FENCE(`[{"kind":"knowledge","q":"${long}"},{"kind":"knowledge","q":""}]`));
    expect(navs).toEqual([]);
  });
});

describe("extractNavBlock — フェンス境界の決定性", () => {
  it("非末尾のフェンス・本文中の ``` は温存する(候補にしない)", () => {
    const reply = "前置き\n```nav\n[]\n```\n後続の本文が続く";
    expect(extractNavBlock(reply)).toEqual({ body: reply, rawJson: null });
    const code = "コード例:\n```\nconst x = 1;\n```\nです。";
    expect(extractNavBlock(code)).toEqual({ body: code, rawJson: null });
  });

  it("閉じ欠落は候補にしない(本文にそのまま残す)", () => {
    const reply = "本文\n```nav\n[{...}";
    expect(extractNavBlock(reply)).toEqual({ body: reply, rawJson: null });
  });

  it("フェンス2個は末尾の1個のみ候補(先行は非末尾として温存)", () => {
    const reply = "a\n```nav\n[1]\n```\nb\n" + FENCE('[{"kind":"retro","g":"week"}]');
    const { body, navs } = applyNavExtraction(reply);
    expect(navs).toHaveLength(1);
    expect(body).toContain("```nav\n[1]\n```"); // 先行フェンスは本文に残る
  });

  it("開始行は行全体一致(```navx は不一致)", () => {
    const reply = "x\n```navx\n[]\n```";
    expect(extractNavBlock(reply).rawJson).toBeNull();
  });

  it("除去後が空(trim)なら元 reply を維持しつつ navs は返す", () => {
    const reply = FENCE('[{"kind":"retro","g":"week"}]');
    const { body, navs } = applyNavExtraction(reply);
    expect(navs).toHaveLength(1);
    expect(body).toBe(reply);
  });
});

describe("buildNavs — 単体の検証", () => {
  it("非配列(単一オブジェクト)も受理・非オブジェクト要素は破棄", () => {
    expect(buildNavs('{"kind":"retro","g":"week"}')).toHaveLength(1);
    expect(buildNavs('[1,"x",null]')).toEqual([]);
  });
});
