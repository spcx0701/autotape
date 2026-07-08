// VHS tape parsing + visible-duration estimation.
// VHS allows multiple commands per line (`Type "cd ~" Enter`, `Sleep 2s Show`),
// so parsing is token-based, not line-based. VHS defaults: TypingSpeed 50ms.

const KEY_COMMANDS = new Set([
  "Backspace", "Delete", "Insert", "Down", "Left", "Right", "Up",
  "End", "Home", "PageUp", "PageDown", "Tab", "Space", "Enter", "Escape",
]);

// Commands that own their whole line (never share it with actions).
const LINE_COMMANDS = new Set(["Set", "Output", "Require", "Source", "Env", "Screenshot"]);

export function parseDuration(str) {
  if (str == null) return null;
  const m = String(str).trim().match(/^(\d*\.?\d+)(ms|s)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return m[2] === "ms" ? v / 1000 : v;
}

function tokenize(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      let value = "";
      while (j < line.length && line[j] !== ch) {
        if (line[j] === "\\" && j + 1 < line.length) {
          value += line[j + 1];
          j += 2;
        } else {
          value += line[j];
          j++;
        }
      }
      tokens.push({ kind: "string", value });
      i = j + 1;
    } else {
      let j = i;
      while (j < line.length && !/\s/.test(line[j])) j++;
      tokens.push({ kind: "word", value: line.slice(i, j) });
      i = j;
    }
  }
  return tokens;
}

function isActionWord(word) {
  const name = word.split("@")[0];
  return (
    name === "Type" || name === "Sleep" || name === "Hide" || name === "Show" ||
    name === "Wait" || name.startsWith("Wait+") || name === "Copy" || name === "Paste" ||
    KEY_COMMANDS.has(name) || /^(Ctrl|Alt|Shift)\+./.test(name)
  );
}

export function parseTape(text) {
  const raws = text.split("\n");
  const commands = [];
  const settings = {};
  const outputs = [];
  let hidden = false;

  for (const [idx, raw] of raws.entries()) {
    const n = idx + 1;
    const t = raw.trim();
    if (t === "" || t.startsWith("#")) continue;

    const firstWord = t.split(/\s/, 1)[0];
    if (LINE_COMMANDS.has(firstWord)) {
      if (firstWord === "Set") {
        const m = t.match(/^Set\s+(\S+)\s+(.*)$/);
        if (m) settings[m[1]] = m[2].trim();
      } else if (firstWord === "Output") {
        outputs.push(t.replace(/^Output\s+/, "").trim());
      }
      commands.push({ type: "meta", name: firstWord, n, hidden, raw: t });
      continue;
    }

    const tokens = tokenize(t);
    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.kind !== "word" || !isActionWord(tok.value)) {
        commands.push({ type: "unknown", name: tok.value ?? "", n, hidden, raw: t });
        i++;
        continue;
      }
      const [name, atStr] = tok.value.split("@");
      const at = parseDuration(atStr);
      i++;

      if (name === "Hide") {
        hidden = true;
        commands.push({ type: "hide", name, n, hidden });
      } else if (name === "Show") {
        hidden = false;
        commands.push({ type: "show", name, n, hidden });
      } else if (name === "Sleep") {
        let seconds = 0;
        if (i < tokens.length && tokens[i].kind === "word") {
          const d = parseDuration(tokens[i].value);
          if (d != null) {
            seconds = d;
            i++;
          }
        }
        commands.push({ type: "sleep", name, n, hidden, seconds });
      } else if (name === "Type") {
        let textContent = "";
        while (i < tokens.length && tokens[i].kind === "string") {
          textContent += tokens[i].value;
          i++;
        }
        commands.push({ type: "type", name, n, hidden, at, text: textContent, chars: textContent.length });
      } else if (name === "Copy") {
        if (i < tokens.length && tokens[i].kind === "string") i++;
        commands.push({ type: "meta", name, n, hidden });
      } else if (name === "Wait" || name.startsWith("Wait+")) {
        if (i < tokens.length && tokens[i].kind === "word" && tokens[i].value.startsWith("/")) i++;
        commands.push({ type: "wait", name, n, hidden });
      } else {
        // key press (Enter, Tab, arrows, Ctrl+X, ...) with optional repeat count
        let count = 1;
        if (i < tokens.length && tokens[i].kind === "word" && /^\d+$/.test(tokens[i].value)) {
          count = parseInt(tokens[i].value, 10);
          i++;
        }
        commands.push({ type: "key", name, n, hidden, at, count });
      }
    }
  }

  return { raws, commands, settings, outputs };
}

// Estimated *visible* duration in seconds: Hide/Show regions contribute nothing,
// PlaybackSpeed divides the total. Wait commands are unbounded → estimated 0
// and reported via `hasWait` so linters can soften the duration verdict.
export function estimateDuration(parsed) {
  const typingSpeed = parseDuration(parsed.settings.TypingSpeed) ?? 0.05;
  const playback = parseFloat(parsed.settings.PlaybackSpeed) || 1.0;
  let sec = 0;
  let hasWait = false;

  for (const cmd of parsed.commands) {
    if (cmd.hidden && cmd.type !== "show") continue;
    if (cmd.type === "sleep") sec += cmd.seconds;
    else if (cmd.type === "type") sec += cmd.chars * (cmd.at ?? typingSpeed);
    else if (cmd.type === "key") sec += (cmd.at ?? typingSpeed) * cmd.count;
    else if (cmd.type === "wait") hasWait = true;
  }
  return { seconds: sec / playback, hasWait };
}

// Last visible timing-relevant action (used by the final-hold rule).
export function lastVisibleAction(parsed) {
  for (let i = parsed.commands.length - 1; i >= 0; i--) {
    const cmd = parsed.commands[i];
    if (cmd.hidden) continue;
    if (["sleep", "type", "key", "wait"].includes(cmd.type)) return cmd;
  }
  return null;
}

export function serialize(parsed) {
  return parsed.raws.join("\n");
}
