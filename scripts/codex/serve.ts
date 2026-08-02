// 対象設計: docs/design/basic/codex-spar.md §1 やる-1(dev 専用 Codex ランナー — 壁打ち Codex モード)
//
// 起動は人間の端末から `npm run codex:serve`(Claude セッションからの起動は guard-bash が遮断)。
// クリーンコピー隔離: リクエストごとに git archive HEAD を一時 dir へ展開(= git 追跡ファイルのみ・
// gitignore 資産は構造的に不在)し、そこを workingDirectory に Codex を単発実行する。
// サンドボックス条件は SDK 実 API で確定済み(2026-08-02): sandboxMode=read-only /
// approvalPolicy=never(昇格不可)/ networkAccessEnabled=false / webSearchMode=disabled。
// 質問文・応答はログに出さない(件数・所要時間・拒否種別のみ — §1 やる-1)。
import { execFileSync, execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Codex } from "@openai/codex-sdk";
import { buildChildEnv, checkAdmission, checkPreflight, corsHeaders, validateQuestion } from "./serve-lib";

const PORT = 8788;
const BIND_ADDR = "127.0.0.1"; // LAN 非露出(§1 やる-1)
const TIMEOUT_MS = 10 * 60 * 1000;
const BODY_MAX_BYTES = 64 * 1024;

const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim();
// 事後検知の基準(§1 やる-1 — review.sh とパリティ。検知範囲は本 repo のみ)
const statusAtStart = execSync("git status --porcelain", { cwd: repoRoot }).toString();

// SDK は ESM 専用(exports に import 条件のみ・require 不可)のため、CJS 実行(tsx)からは
// main() の dynamic import で読み込む。インスタンスは listen 前に必ず代入される。
let codex: Codex;

let busy = false;
let served = 0;
const activeWorkDirs = new Set<string>();

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function review(question: string): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "codex-spar-"));
  activeWorkDirs.add(workDir);
  try {
    // クリーンコピー展開(追跡ファイルのみ)— パスは位置引数で渡す(シェル展開に晒さない)
    execFileSync("bash", ["-c", 'git archive HEAD | tar -x -C "$1"', "--", workDir], { cwd: repoRoot });
    // 毎回の不変条件 assert(初回限りにしない — codex-ops ゲート (b) の常時形)
    for (const p of [".env", "e2e/.auth", "e2e/screenshots"]) {
      if (existsSync(join(workDir, p))) {
        throw new Error(`ABORT: コピー先に ${p} が存在する(追跡ファイルへの秘密混入の兆候 — 黄金ルール2 違反)`);
      }
    }
    const thread = codex.startThread({
      workingDirectory: workDir,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      skipGitRepoCheck: true,
    });
    const turn = await thread.run(question);
    return turn.finalResponse;
  } finally {
    // 破棄対象は mkdtemp が返したパス変数のみ(固定パス直書き禁止・force なし — §1 やる-1)
    await rm(workDir, { recursive: true });
    activeWorkDirs.delete(workDir);
    const statusNow = execSync("git status --porcelain", { cwd: repoRoot }).toString();
    if (statusNow !== statusAtStart) {
      console.warn("!! 警告: 起動時と比べて元 repo の状態が変化した。逸脱の兆候として差分を確認すること");
    }
  }
}

function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_MAX_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

function respond(res: http.ServerResponse, status: number, payload: object): void {
  res.writeHead(status, { ...corsHeaders(), "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const host = req.headers.host;

  // OPTIONS(プリフライト)= Origin/Host 検証のみ・CORS 返却のみ(§1 やる-1 — CT 検証は課さない)
  if (req.method === "OPTIONS") {
    if (!checkPreflight({ origin, host })) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/review") {
    respond(res, 404, { error: "not_found" });
    return;
  }

  // 受理3検証(不通過は処理しない — §3)
  const admission = checkAdmission({ origin, host, contentType: req.headers["content-type"] });
  if (!admission.ok) {
    console.warn(`拒否: ${admission.error}`);
    respond(res, admission.status, { error: admission.error });
    return;
  }

  if (busy) {
    respond(res, 429, { error: "busy" });
    return;
  }

  const raw = await readBody(req);
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    respond(res, 400, { error: "bad_request" });
    return;
  }
  const question = validateQuestion(parsed);
  if (question === null) {
    respond(res, 400, { error: "bad_request" });
    return;
  }

  busy = true;
  const startedAt = Date.now();
  const job = review(question);
  // busy の解放は review 本体の決着に同期(タイムアウト応答後も多重実行を許さない)
  job.catch(() => {}).finally(() => {
    busy = false;
  });

  try {
    const reply = await withTimeout(job, TIMEOUT_MS);
    const durationMs = Date.now() - startedAt;
    served += 1;
    console.log(`#${served} 完了(${Math.round(durationMs / 1000)}s)`);
    respond(res, 200, { reply, durationMs });
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.warn("打ち切り: timeout(実行の決着まで新規リクエストは 429)");
      respond(res, 504, { error: "timeout" });
      return;
    }
    console.warn("失敗: codex_failed");
    respond(res, 502, { error: "codex_failed" });
  }
});

// SIGINT/SIGTERM でも一時 dir を破棄して終了(§1 やる-1)
function shutdown(): void {
  for (const dir of activeWorkDirs) {
    try {
      rmSync(dir, { recursive: true });
    } catch {
      // 破棄失敗は残骸として受容(追跡ファイルのみで機微低 — §4)
    }
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main(): Promise<void> {
  const sdk = await import("@openai/codex-sdk");
  // env は allowlist の全量置換(SDK は env 指定時に process.env を継承しない)
  codex = new sdk.Codex({ env: buildChildEnv(process.env) });
  server.listen(PORT, BIND_ADDR, () => {
    console.log(`codex-spar ランナー起動: http://${BIND_ADDR}:${PORT}(壁打ち Codex モード用・LAN 非公開)`);
    console.log("アプリは http://localhost:3000 で開くこと(Origin 検証)。停止は Ctrl-C。");
  });
}

main().catch((err) => {
  console.error("起動失敗:", err);
  process.exit(1);
});
