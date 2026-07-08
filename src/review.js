// Frame-by-frame self-review: extract N frames with ffmpeg, then ask a
// vision-capable agent to verify the GIF actually shows a working demo.
// This is the "reading" direction of multimodal — writing is delegated to VHS.

import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, extractJson } from "./util.js";

const FRAME_COUNT = 6;

export async function extractFrames(gifPath) {
  const probe = await run(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 ${JSON.stringify(gifPath)}`,
    { timeout: 15_000 },
  );
  const duration = parseFloat(probe.stdout.trim()) || 10;
  const dir = await mkdtemp(join(tmpdir(), "autotape-frames-"));
  const fps = FRAME_COUNT / duration;
  const res = await run(
    `ffmpeg -y -v error -i ${JSON.stringify(gifPath)} -vf "fps=${fps.toFixed(4)},scale=800:-1" ${JSON.stringify(join(dir, "frame-%02d.png"))}`,
    { timeout: 60_000 },
  );
  if (res.code !== 0) throw new Error(`ffmpeg frame extraction failed: ${res.stderr.slice(0, 400)}`);
  const frames = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort().map((f) => join(dir, f));
  if (frames.length === 0) throw new Error("no frames extracted");
  return { dir, frames, duration };
}

export async function review(gifPath, { model = "sonnet", toolName = "the CLI" } = {}) {
  const { dir, frames, duration } = await extractFrames(gifPath);
  const prompt = `You are reviewing ${frames.length} frames (in chronological order) extracted from a terminal demo GIF for "${toolName}". Read each image file, then judge the demo.

Frames:
${frames.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Reject if you see any of: error messages or stack traces, "command not found", a mostly-blank terminal for several consecutive frames, text cut off by the window edge, or output that never visibly changes (broken demo).
Accept if the frames show a command being typed and producing sensible, readable output.

Reply with ONLY a JSON object: {"pass": true|false, "issues": ["specific issue", ...]}`;

  const res = await run(
    `claude -p ${JSON.stringify(prompt)} --model ${model} --allowed-tools "Read"`,
    { timeout: 300_000, cwd: dir },
  );
  const verdict = extractJson(res.stdout);
  if (!verdict || typeof verdict.pass !== "boolean") {
    return { pass: null, issues: [`review inconclusive: ${res.stdout.slice(0, 200) || res.stderr.slice(0, 200)}`], frames, duration };
  }
  return { pass: verdict.pass, issues: verdict.issues ?? [], frames, duration };
}
