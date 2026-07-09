// Deterministic tape linter. The rules encode measured conventions from
// well-made demo GIFs (data/extracted-defaults.json) plus README GIF best
// practices (≤20s README, ≤10s PR). Subjective taste, compressed into checks.

import { parseTape, estimateDuration, lastVisibleAction, parseDuration } from "./tape.js";
import { DIMENSION_BOUNDS, MIN_FONT_SIZE, PROFILES } from "./profiles.js";

const SETUP_RE = /\b(npm (i|ci|install)|pip3? install|go install|cargo (install|build)|brew install|git clone|make(\s|$)|apt(-get)? install)\b/;

export const RULES = [
  {
    // VHS tape strings have NO escape sequences: `Type "a \" b"` is a parse
    // error. Text containing double quotes must use backtick or single-quote
    // delimiters. Agents love writing \" — this rule heals it deterministically.
    id: "vhs-string-escapes",
    severity: "error",
    check(p) {
      const idx = p.raws.findIndex((r) => /^\s*Type(@\S+)?\s+"/.test(r) && r.includes('\\"'));
      if (idx === -1) return null;
      return {
        line: idx + 1,
        message: `line ${idx + 1}: VHS strings have no escape sequences — \\" breaks the tape; use backtick delimiters`,
      };
    },
    fix(text) {
      return text
        .split("\n")
        .map((line) => {
          if (!line.includes('\\"')) return line;
          const m = line.match(/^(\s*Type(?:@\S+)?\s+)"(.*)"(.*)$/);
          if (!m) return line;
          const inner = m[2].replace(/\\"/g, '"');
          const delim = !inner.includes("`") ? "`" : !inner.includes("'") ? "'" : null;
          if (!delim) return line;
          return `${m[1]}${delim}${inner}${delim}${m[3]}`;
        })
        .join("\n");
    },
  },
  {
    // VHS has no function keys (F1–F12) and rejects unknown tokens with a parse
    // error at render time. Catching it here turns a hard render failure into
    // review feedback the agent can act on (common when a TUI's keybindings
    // table lists F-keys). No auto-fix: only the agent knows the right key.
    id: "invalid-command",
    severity: "error",
    check(p) {
      const bad = p.commands.find(
        (c) => c.type === "unknown" && !c.hidden && /^(F\d{1,2}|[A-Z][A-Za-z]{2,})$/.test(c.name),
      );
      if (!bad) return null;
      return {
        line: bad.n,
        message: `line ${bad.n}: \`${bad.name}\` is not a valid VHS key — no function keys (F1–F12); use a letter-key alternative, or arrows / Enter / Tab / Escape / Ctrl+ / Alt+ combos`,
      };
    },
  },
  {
    id: "has-output",
    severity: "error",
    check(p) {
      if (p.outputs.some((o) => o.endsWith(".gif"))) return null;
      return { message: "no `Output <file>.gif` — VHS won't produce a GIF" };
    },
    fix(text) {
      return `Output demo.gif\n${text}`;
    },
  },
  {
    id: "duration-budget",
    severity: "error",
    check(p, ctx) {
      const { seconds, hasWait } = estimateDuration(p);
      const budget = ctx.budget;
      if (seconds <= budget) return null;
      return {
        message: `estimated visible duration ${seconds.toFixed(1)}s exceeds ${budget}s budget${hasWait ? " (plus unbounded Wait)" : ""} — GIFs loop; show one interaction, not a tour`,
      };
    },
  },
  {
    id: "final-hold",
    severity: "error",
    check(p) {
      const last = lastVisibleAction(p);
      if (last && last.type === "sleep" && last.seconds >= 3) return null;
      return { message: "tape should end with `Sleep 3s`+ so the result is readable before the loop restarts" };
    },
    fix(text) {
      return `${text.replace(/\n+$/, "")}\nSleep 3s\n`;
    },
  },
  {
    id: "typing-speed",
    severity: "warn",
    check(p) {
      const ts = parseDuration(p.settings.TypingSpeed);
      if (ts == null) return { message: "no `Set TypingSpeed` — VHS default 50ms reads rushed; measured norm is 100ms" };
      if (ts < 0.05 || ts > 0.15)
        return { message: `TypingSpeed ${p.settings.TypingSpeed} is outside the measured 50–150ms range` };
      return null;
    },
    fix(text) {
      if (/^Set TypingSpeed /m.test(text)) return text.replace(/^Set TypingSpeed .*$/m, "Set TypingSpeed 100ms");
      return text.replace(/^(Output .*)$/m, "$1\nSet TypingSpeed 100ms");
    },
  },
  {
    id: "font-size",
    severity: "error",
    check(p, ctx) {
      const fs = parseInt(p.settings.FontSize, 10);
      if (!fs) return { message: "no `Set FontSize` — readability is not optional" };
      if (fs < MIN_FONT_SIZE.absolute) return { message: `FontSize ${fs} < ${MIN_FONT_SIZE.absolute} — unreadable in a README column` };
      if (ctx.profile === "hero" && fs < MIN_FONT_SIZE.hero)
        return { severity: "warn", message: `FontSize ${fs} — hero GIFs in the corpus use 22–28` };
      return null;
    },
  },
  {
    id: "cursor-blink",
    severity: "warn",
    check(p) {
      if (String(p.settings.CursorBlink).toLowerCase() === "false") return null;
      return { message: "set `Set CursorBlink false` — blinking cursor reads as noise in a loop (butterfish, hwatch)" };
    },
    fix(text) {
      if (/^Set CursorBlink /m.test(text)) return text.replace(/^Set CursorBlink .*$/m, "Set CursorBlink false");
      return text.replace(/^(Output .*)$/m, "$1\nSet CursorBlink false");
    },
  },
  {
    id: "hide-setup",
    severity: "error",
    check(p) {
      const offender = p.commands.find((c) => c.type === "type" && !c.hidden && SETUP_RE.test(c.text));
      if (!offender) return null;
      return {
        line: offender.n,
        message: `setup command visible in the GIF (line ${offender.n}) — wrap install/build steps in Hide/Show`,
      };
    },
  },
  {
    id: "github-blend",
    severity: "warn",
    check(p, ctx) {
      if (ctx.profile !== "hero") return null;
      if (p.settings.Margin && p.settings.MarginFill?.includes("#0d1117")) return null;
      return { message: 'hero GIFs blend into GitHub dark with `Margin 20` + `MarginFill "#0d1117"` + `BorderRadius 10` (ggh)' };
    },
    fix(text) {
      let out = text;
      if (!/^Set Margin /m.test(out)) out = out.replace(/^(Output .*)$/m, "$1\nSet Margin 20\nSet BorderRadius 10");
      if (/^Set MarginFill /m.test(out)) out = out.replace(/^Set MarginFill .*$/m, 'Set MarginFill "#0d1117"');
      else out = out.replace(/^(Set Margin .*)$/m, '$1\nSet MarginFill "#0d1117"');
      return out;
    },
  },
  {
    id: "theme-set",
    severity: "warn",
    check(p) {
      if (p.settings.Theme) return null;
      return { message: "no `Set Theme` — every well-made tape in the corpus names a dark theme" };
    },
    fix(text) {
      return text.replace(/^(Output .*)$/m, '$1\nSet Theme "Catppuccin Mocha"');
    },
  },
  {
    id: "dimension-bounds",
    severity: "warn",
    check(p, ctx) {
      const bounds = DIMENSION_BOUNDS[ctx.profile];
      if (!bounds) return null;
      const w = parseInt(p.settings.Width, 10);
      const h = parseInt(p.settings.Height, 10);
      if (!w || !h) return { message: "Width/Height not set — output size will be the VHS default" };
      if (w < bounds.w[0] || w > bounds.w[1] || h < bounds.h[0] || h > bounds.h[1])
        return { message: `${w}x${h} is outside the measured ${ctx.profile} cluster (${bounds.w.join("–")} × ${bounds.h.join("–")})` };
      return null;
    },
  },
];

export function lint(text, { profile = "hero", budget = 20 } = {}) {
  const parsed = parseTape(text);
  const ctx = { profile, budget };
  const findings = [];
  for (const rule of RULES) {
    const result = rule.check(parsed, ctx);
    if (result) {
      findings.push({
        rule: rule.id,
        severity: result.severity ?? rule.severity,
        message: result.message,
        line: result.line,
        fixable: typeof rule.fix === "function",
      });
    }
  }
  const { seconds } = estimateDuration(parsed);
  return { findings, durationSec: seconds };
}

export function fix(text, { profile = "hero", budget = 20 } = {}) {
  let out = text;
  // Two passes: fixes can unlock other fixes (e.g. Output line inserted first).
  for (let pass = 0; pass < 2; pass++) {
    const { findings } = lint(out, { profile, budget });
    for (const f of findings) {
      const rule = RULES.find((r) => r.id === f.rule);
      if (rule?.fix) out = rule.fix(out);
    }
  }
  return out;
}
