import { renderHeader } from "./profiles.js";
import { lint, fix } from "./lint.js";
import { run } from "./util.js";

const TAPE_CHEATSHEET = `Available tape commands (one per line):
  Type "text to type"        — types text into the terminal
  Enter / Tab / Space / Up / Down / Left / Right / Escape / Backspace
  Ctrl+C, Ctrl+R             — modifier combos
  Sleep 2s / Sleep 500ms     — pause so viewers can read the output
  Hide / Show                — commands between Hide and Show run but are NOT recorded (use for setup)
  Down@500ms 3               — timed, repeated key press (TUI navigation emphasis)`;

function buildPrompt(analysis, { budget, feedback }) {
  return `You are writing the BODY of a VHS tape — a script that records a terminal demo GIF for a CLI tool's README.

${TAPE_CHEATSHEET}

Hard rules:
- Output ONLY tape body lines. No \`Set\`/\`Output\` lines (the header is already written), no markdown fences, no commentary.
- VHS strings have NO escape sequences — never write \\" inside a quoted string. To type text containing double quotes, delimit with backticks: Type \`echo "hi"\`
- Total visible time under ${Math.max(budget - 4, 8)} seconds. GIFs loop: demo the SINGLE most impressive interaction, not a tour.
- Start by typing the command (viewers must see what was typed), end with the result on screen followed by \`Sleep 3s\`.
- After every command's output appears, \`Sleep\` long enough to read it (2s+).
- Any setup (installs, builds) goes between \`Hide\` and \`Show\`.
- The recording font has no Nerd Font glyphs — avoid icon flags (\`--icons\` etc.); they render as empty boxes.
- The typed text runs in a real shell — quote multi-word flag values (\`--header 'Pick a file'\`), or the shell splits them into stray arguments.
- After opening an interactive UI (menus, pagers, TUIs), \`Sleep 2s\` before navigating — viewers need to see the interface before it reacts.
- The tool is invoked as: ${analysis.cmd}
- The shell already starts in the working directory whose contents are listed below. Do NOT \`cd\` anywhere. Only reference files/directories from that listing (or ones you create in a Hide block first) — inventing a filename breaks the demo.

Tool name: ${analysis.name}

Files in the working directory:
${analysis.files?.length ? analysis.files.join("\n") : "(empty)"}

--help output:
${analysis.helpText || "(none captured)"}

README excerpt:
${analysis.readme || "(none)"}
${feedback ? `\nA previous attempt was rejected by a frame-by-frame review. Fix these issues:\n${feedback}` : ""}
Write the tape body now.`;
}

function stripFences(text) {
  return text
    .replace(/^```[a-z]*\s*$/gim, "")
    .split("\n")
    .filter((l) => !/^(Set|Output)\s/.test(l.trim()))
    .join("\n")
    .trim();
}

function templateBody(analysis, tryCmd) {
  const lines = [
    `Type "${analysis.cmd} --help"`,
    "Enter",
    "Sleep 4s",
  ];
  if (tryCmd) {
    lines.push(`Type "clear"`, "Enter", `Type "${tryCmd}"`, "Enter", "Sleep 4s");
  }
  lines.push("Sleep 3s");
  return lines.join("\n");
}

export async function generateBody(analysis, { agent = "claude", model = "sonnet", budget = 20, tryCmd, feedback } = {}) {
  if (agent === "none") return templateBody(analysis, tryCmd);

  const prompt = buildPrompt(analysis, { budget, feedback });
  let res;
  if (agent === "claude") {
    res = await run(["claude", "-p", prompt, "--model", model], { timeout: 240_000 });
  } else if (agent === "codex") {
    res = await run(["codex", "exec", prompt], { timeout: 240_000 });
  } else {
    throw new Error(`unknown agent driver: ${agent}`);
  }
  if (res.code !== 0 || !res.stdout.trim()) {
    throw new Error(`agent generation failed (${agent}): ${res.stderr.slice(0, 400) || "empty output"}`);
  }
  return stripFences(res.stdout);
}

export async function generateTape(analysis, opts = {}) {
  const { profile = "hero", output = "demo.gif", budget = 20, shell } = opts;
  const requires = [];
  const bin = analysis.cmd.split(/\s+/)[0];
  if (bin && !bin.includes("/")) requires.push(bin);

  const body = await generateBody(analysis, opts);
  const draft = renderHeader({ profile, output, shell, requires }) + "\n" + body + "\n";
  const fixed = fix(draft, { profile, budget });
  const report = lint(fixed, { profile, budget });
  return { tape: fixed, report };
}
