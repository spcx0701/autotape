import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./util.js";

const README_LIMIT = 6000;
const HELP_LIMIT = 4000;

async function readReadme(repoPath) {
  try {
    const entries = await readdir(repoPath);
    const name = entries.find((e) => /^readme(\.(md|rst|txt))?$/i.test(e));
    if (!name) return "";
    const text = await readFile(join(repoPath, name), "utf8");
    return text.slice(0, README_LIMIT);
  } catch {
    return "";
  }
}

const IGNORED = new Set(["node_modules", ".git", "dist", "build", "target", ".DS_Store"]);
const FILE_LIMIT = 40;

// Shallow listing (two levels) so the agent scripts against files that exist
// instead of hallucinating names — the #1 cause of broken first drafts.
async function listFiles(repoPath) {
  const out = [];
  try {
    const top = await readdir(repoPath, { withFileTypes: true });
    for (const entry of top) {
      if (IGNORED.has(entry.name)) continue;
      if (out.length >= FILE_LIMIT) break;
      if (entry.isDirectory()) {
        out.push(`${entry.name}/`);
        const sub = await readdir(join(repoPath, entry.name)).catch(() => []);
        for (const name of sub.slice(0, 8)) {
          if (out.length >= FILE_LIMIT) break;
          out.push(`${entry.name}/${name}`);
        }
      } else {
        out.push(entry.name);
      }
    }
  } catch {
    // unreadable dir — the agent just gets no listing
  }
  return out;
}

// Lines that read like a key→action mapping, pulled verbatim from the README.
// The agent interprets them; we just need high recall without drowning it in
// every backticked token, so a candidate needs both a key-ish thing AND an
// action verb (except unambiguous signals: <kbd>, arrow glyphs, "press …").
const ACTION_RE = /\b(quit|exit|select|move|open|close|toggle|next|prev(ious)?|scroll|navigate|filter|search|up|down|left|right|enter|back|switch|jump|delete|refresh|help|focus|confirm|cancel|page)\b/i;
const KBD_RE = /<kbd>/i;
const ARROW_RE = /[↑↓←→⏎⇥]/;
const COMBO_RE = /\b(Ctrl|Alt|Cmd|Shift|Meta)[-+]\w/i;
const FKEY_RE = /\bF\d{1,2}\b/;
// A backticked token that looks like a KEY, not a flag or command: 1–5 chars,
// not starting with `-` (excludes `--help`), no spaces/slashes/dots. Matches
// `q` `Tab` `gg` `Ctrl-a` but not `--icons`, `npm install`, `data.json`.
const CODE_KEY_RE = /`(?!-)(?:Ctrl|Alt|Shift|Cmd)?[-+]?[A-Za-z0-9↑↓←→]{1,4}`/;
const KEYBIND_LIMIT = 40;
const KEYBIND_CHARS = 2500;

function extractKeybindings(readme) {
  if (!readme) return [];
  const out = [];
  let chars = 0;
  for (const raw of readme.split("\n")) {
    const line = raw.trim();
    if (line.length < 3 || line.length > 140) continue;
    const hasKbd = KBD_RE.test(line) || ARROW_RE.test(line) || COMBO_RE.test(line) || FKEY_RE.test(line);
    const hasCodeKey = CODE_KEY_RE.test(line);
    const hasAction = ACTION_RE.test(line);
    const isPress = /\bpress\b/i.test(line) && hasAction;
    const keep = hasKbd || isPress || (hasCodeKey && hasAction);
    if (!keep) continue;
    // Strip markdown table pipes/kbd tags to a compact "key — action" form.
    const clean = line
      .replace(/<\/?kbd>/gi, "")
      .replace(/^\|\s*/, "")
      .replace(/\s*\|\s*/g, " — ")
      .replace(/\s*[—–|:-]\s*$/, "")
      .trim();
    if (!clean || /^[-—|: ]+$/.test(clean)) continue;
    if (chars + clean.length > KEYBIND_CHARS) break;
    out.push(clean);
    chars += clean.length;
    if (out.length >= KEYBIND_LIMIT) break;
  }
  return out;
}

// Definitive: a specific TUI framework, or the phrase spelled out. Broad org
// names (charmbracelet, which also ships plain CLIs) are deliberately excluded.
const TUI_DEFINITIVE_RE = /\b(terminal user interface|ncurses|notcurses|bubble ?tea|ratatui|textual|blessed\.js|tview|urwid|prompt[_-]?toolkit)\b/i;
const TUI_QUIT_RE = /\bpress\b[^.\n]{0,24}\b(q|esc|escape|ctrl)\b[^.\n]{0,16}\b(quit|exit)\b/i;
// Case-sensitive "TUI": real TUI apps write it uppercase ("a TUI for …"); this
// avoids matching a README that merely documents a lowercase `tui` option.
const TUI_WORD_RE = /\bTUI\b|\bterminal[- ]UI\b|\bfull[- ]?screen (app|interface|terminal)\b/;
const TUI_WEAK_RE = /\b(navigate|arrow keys?|keybindings?|hotkeys?|interactive (mode|ui|dashboard|browser))\b/i;

// TUI vs one-shot decides everything downstream (profile, prompt shape). We
// only have --help + README to go on, so score it: definitive signals win
// outright; otherwise a bare "TUI" word, weak phrasing, and keybinding-table
// density accumulate — a single feature mention won't clear the bar, a real
// keybindings table will.
function detectKind({ readme = "", helpText = "", keybindings = [] }) {
  const hay = `${readme}\n${helpText}`;
  if (TUI_DEFINITIVE_RE.test(hay) || TUI_QUIT_RE.test(hay)) return "tui";
  let score = 0;
  if (TUI_WORD_RE.test(hay)) score += 2;
  if (TUI_WEAK_RE.test(hay)) score += 1;
  score += Math.min(keybindings.length, 4);
  return score >= 4 ? "tui" : "oneshot";
}

async function detectCmd(repoPath) {
  try {
    const pkg = JSON.parse(await readFile(join(repoPath, "package.json"), "utf8"));
    if (typeof pkg.bin === "string") return `node ${pkg.bin}`;
    if (pkg.bin && typeof pkg.bin === "object") {
      const rel = Object.values(pkg.bin)[0];
      return `node ${rel}`;
    }
  } catch {
    // not a node project — caller must pass --cmd
  }
  return null;
}

export async function analyze({ repoPath = ".", cmd }) {
  const readme = await readReadme(repoPath);
  const resolvedCmd = cmd ?? (await detectCmd(repoPath));
  if (!resolvedCmd) {
    throw new Error("could not detect the CLI command — pass it with --cmd \"<command>\"");
  }

  let helpText = "";
  for (const flag of ["--help", "-h", "help"]) {
    const res = await run(`${resolvedCmd} ${flag}`, { cwd: repoPath, timeout: 8000 });
    const out = (res.stdout + res.stderr).trim();
    if (out.length > 20) {
      helpText = out.slice(0, HELP_LIMIT);
      break;
    }
  }

  const name = resolvedCmd.split(/\s+/).find((w) => !w.startsWith("-") && w !== "node") ?? resolvedCmd;
  const files = await listFiles(repoPath);
  const keybindings = extractKeybindings(readme);
  const kind = detectKind({ readme, helpText, keybindings });
  return { repoPath, cmd: resolvedCmd, name, readme, helpText, files, keybindings, kind };
}

export { extractKeybindings, detectKind };
