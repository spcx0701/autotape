import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { run } from "./util.js";

export async function render(tapePath, { cwd, outputPath, timeout = 180_000 } = {}) {
  const res = await run(`vhs ${JSON.stringify(tapePath)}`, { cwd, timeout });
  if (res.timedOut) throw new Error("vhs render timed out");
  if (res.code !== 0) {
    throw new Error(`vhs failed (exit ${res.code}): ${(res.stderr || res.stdout).slice(0, 600)}`);
  }
  const gif = resolve(cwd ?? ".", outputPath);
  const info = await stat(gif).catch(() => null);
  if (!info || info.size === 0) throw new Error(`vhs exited 0 but ${outputPath} was not written`);
  return { gifPath: gif, bytes: info.size };
}
