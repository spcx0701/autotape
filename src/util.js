import { spawn } from "node:child_process";

// `command` may be a shell string or an argv array. Argv form spawns without a
// shell — required whenever an argument embeds untrusted text (model prompts,
// --help output), which a shell would happily expand (`…` runs commands).
export function run(command, { cwd, timeout = 30_000, env, input } = {}) {
  return new Promise((resolve) => {
    const argvMode = Array.isArray(command);
    // An `undefined` value in `env` deletes the variable for the child —
    // spreading alone can't unset anything inherited from process.env.
    const childEnv = { ...process.env, TERM: "xterm-256color", ...env };
    for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
    const child = argvMode
      ? spawn(command[0], command.slice(1), {
          cwd,
          env: childEnv,
          stdio: ["pipe", "pipe", "pipe"],
        })
      : spawn(command, {
          cwd,
          shell: true,
          env: childEnv,
          stdio: ["pipe", "pipe", "pipe"],
        });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : code, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err), timedOut });
    });
    if (input != null) child.stdin.write(input);
    child.stdin.end();
  });
}

const TTY = process.stdout.isTTY;
export const c = {
  bold: (s) => (TTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s) => (TTY ? `\x1b[36m${s}\x1b[0m` : s),
};

export function step(msg) {
  console.log(`${c.cyan("▸")} ${msg}`);
}

// Extract the first top-level JSON object from free-form model output.
export function extractJson(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
