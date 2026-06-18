import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Contract (e): the CLI emits a single parseable JSON object to stdout and keeps
// all human/debug logging on stderr — the shape the composite action parses.
//
// We exercise the real entrypoint as a subprocess via tsx (the same runtime CI
// uses) rather than importing internals, so stdout/stderr separation is tested
// end-to-end. OPENROUTER_MOCK drives it offline; the child runs in a scratch cwd
// so the repo `.env` (loaded by cli.ts via process.loadEnvFile) can't bleed real
// secrets into the run.

const REPO_ROOT = process.cwd();
const TSX_BIN = path.resolve(REPO_ROOT, "node_modules/.bin/tsx");
const CLI_PATH = path.resolve(REPO_ROOT, "packages/code-reviewer/src/cli.ts");

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface ReviewJson {
  verdict: "passed" | "failed";
  summary: string;
  scores: Record<string, number>;
}

let workDir: string;

/** Run the CLI against a diff string in mock mode with no API key available. */
function runCli(title: string, body: string, diff: string): CliResult {
  const diffFile = path.join(workDir, `diff-${title.replace(/\W+/g, "_")}.txt`);
  writeFileSync(diffFile, diff, "utf8");

  const childEnv: NodeJS.ProcessEnv = { ...process.env, OPENROUTER_MOCK: "true" };
  delete childEnv.OPENROUTER_API_KEY;

  const result = spawnSync(TSX_BIN, [CLI_PATH, "--title", title, "--body", body, "--diff-file", diffFile], {
    cwd: workDir,
    env: childEnv,
    encoding: "utf8",
  });

  expect(result.error).toBeUndefined();
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

describe("cli.ts: machine-readable JSON contract (mock mode)", () => {
  beforeAll(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "ai-cr-cli-"));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("emits a single parseable { verdict, summary, scores } object on stdout and exits 0", () => {
    const { status, stdout } = runCli("Clean change", "no issues", "+ const x = 1;");

    expect(status).toBe(0);
    // The entire stdout must parse as one JSON object — nothing else on stdout.
    const parsed = JSON.parse(stdout.trim()) as ReviewJson;
    expect(parsed.verdict).toBe("passed");
    expect(typeof parsed.summary).toBe("string");
    expect(Object.keys(parsed.scores)).toHaveLength(7);
  });

  it("reports a failed verdict for a diff carrying the fail marker", () => {
    const { status, stdout } = runCli("Risky change", "", "+ // FAIL_MARKER\n+ broken();");

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as ReviewJson;
    expect(parsed.verdict).toBe("failed");
  });

  it("keeps stdout pure JSON even when stderr carries logging", () => {
    const { stdout, stderr } = runCli("Clean change", "no issues", "+ const x = 1;");

    // stdout is exactly one JSON object (parse of the whole trimmed buffer succeeds)...
    expect(() => JSON.parse(stdout.trim())).not.toThrow();
    // ...and any human/debug output lives on stderr, never interleaved into stdout.
    expect(stdout).not.toContain("[warn]");
    expect(stdout).not.toContain("[error]");
    expect(typeof stderr).toBe("string");
  });
});
