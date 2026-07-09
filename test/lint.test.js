import { test } from "node:test";
import assert from "node:assert/strict";
import { lint, fix } from "../src/lint.js";
import { renderHeader, PROFILES } from "../src/profiles.js";

const heroHeader = renderHeader({ profile: "hero", output: "demo.gif" });

test("profile header carries the measured defaults", () => {
  assert.match(heroHeader, /Set FontSize 26/);
  assert.match(heroHeader, /Set MarginFill "#0d1117"/);
  assert.match(heroHeader, /Set TypingSpeed 100ms/);
  assert.match(heroHeader, /Set CursorBlink false/);
});

test("clean hero tape passes", () => {
  const tape = heroHeader + `\nType "greet hello world"\nEnter\nSleep 4s\nSleep 3s\n`;
  const { findings } = lint(tape, { profile: "hero", budget: 20 });
  assert.deepEqual(findings, []);
});

test("duration budget violation is an error", () => {
  const tape = heroHeader + `\nType "greet"\nEnter\nSleep 30s\n`;
  const { findings } = lint(tape, { profile: "hero", budget: 20 });
  assert.ok(findings.some((f) => f.rule === "duration-budget" && f.severity === "error"));
});

test("pr budget is stricter", () => {
  const tape = heroHeader + `\nType "greet"\nEnter\nSleep 15s\nSleep 3s\n`;
  assert.equal(lint(tape, { budget: 20 }).findings.filter((f) => f.rule === "duration-budget").length, 0);
  assert.equal(lint(tape, { budget: 10 }).findings.filter((f) => f.rule === "duration-budget").length, 1);
});

test("missing final hold detected and auto-fixed", () => {
  const tape = heroHeader + `\nType "greet"\nEnter\nSleep 1s\n`;
  const { findings } = lint(tape, { profile: "hero", budget: 20 });
  assert.ok(findings.some((f) => f.rule === "final-hold"));
  const fixed = fix(tape, { profile: "hero", budget: 20 });
  const after = lint(fixed, { profile: "hero", budget: 20 });
  assert.equal(after.findings.filter((f) => f.rule === "final-hold").length, 0);
});

test("visible setup command is an error; hidden setup passes", () => {
  const visible = heroHeader + `\nType "npm install -g greet"\nEnter\nSleep 3s\n`;
  assert.ok(lint(visible, { budget: 20 }).findings.some((f) => f.rule === "hide-setup"));

  const hidden = heroHeader + `\nHide\nType "npm install -g greet"\nEnter\nShow\nType "greet"\nEnter\nSleep 4s\nSleep 3s\n`;
  assert.equal(lint(hidden, { budget: 20 }).findings.filter((f) => f.rule === "hide-setup").length, 0);
});

test("function key in a TUI tape is a lint error", () => {
  const tape = heroHeader + `\nType "htop"\nEnter\nSleep 2s\nF6\nSleep 3s\n`;
  const { findings } = lint(tape, { profile: "tui", budget: 20 });
  assert.ok(findings.some((f) => f.rule === "invalid-command" && f.severity === "error"));
});

test("valid TUI navigation keys do not trip invalid-command", () => {
  const tape = heroHeader + `\nType "htop"\nEnter\nSleep 2s\nDown@400ms 3\nTab\nEscape\nSleep 3s\n`;
  const { findings } = lint(tape, { profile: "tui", budget: 20 });
  assert.equal(findings.filter((f) => f.rule === "invalid-command").length, 0);
});

test("bare tape is auto-fixed into a passing state (minus duration/content rules)", () => {
  const bare = `Output demo.gif\nSet FontSize 26\nSet Width 1500\nSet Height 640\nType "greet hello"\nEnter\nSleep 2s\n`;
  const fixed = fix(bare, { profile: "hero", budget: 20 });
  const { findings } = lint(fixed, { profile: "hero", budget: 20 });
  assert.deepEqual(findings.filter((f) => f.severity === "error"), []);
  assert.match(fixed, /Set CursorBlink false/);
  assert.match(fixed, /Set MarginFill "#0d1117"/);
  assert.match(fixed, /Set Theme/);
});

test("tui profile: hero-only rules stay quiet", () => {
  const header = renderHeader({ profile: "tui", output: "demo.gif" });
  const tape = header + `\nType "app"\nEnter\nSleep 4s\nSleep 3s\n`;
  const { findings } = lint(tape, { profile: "tui", budget: 20 });
  assert.equal(findings.filter((f) => f.rule === "github-blend").length, 0);
});

test("escaped quotes in Type strings are an error and get re-delimited", () => {
  const tape = heroHeader + `\nType "echo '{\\"name\\":\\"ada\\"}' | jq .name"\nEnter\nSleep 4s\nSleep 3s\n`;
  const { findings } = lint(tape, { profile: "hero", budget: 20 });
  assert.ok(findings.some((f) => f.rule === "vhs-string-escapes" && f.severity === "error"));

  const fixed = fix(tape, { profile: "hero", budget: 20 });
  assert.match(fixed, /Type `echo '\{"name":"ada"\}' \| jq \.name`/);
  const after = lint(fixed, { profile: "hero", budget: 20 });
  assert.equal(after.findings.filter((f) => f.rule === "vhs-string-escapes").length, 0);
});

test("dimension bounds warn outside measured clusters", () => {
  const weird = heroHeader.replace("Set Width 1500", "Set Width 640").replace("Set Height 640", "Set Height 200");
  const tape = weird + `\nType "greet"\nEnter\nSleep 4s\nSleep 3s\n`;
  assert.ok(lint(tape, { profile: "hero", budget: 20 }).findings.some((f) => f.rule === "dimension-bounds"));
});

test("every corpus-derived profile setting is a valid Set line", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    const header = renderHeader({ profile: name });
    for (const key of Object.keys(profile)) {
      assert.match(header, new RegExp(`^Set ${key} `, "m"), `${name} missing ${key}`);
    }
  }
});
