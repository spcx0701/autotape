import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTape, estimateDuration, parseDuration, lastVisibleAction } from "../src/tape.js";

test("parseDuration handles s, ms, and bare seconds", () => {
  assert.equal(parseDuration("2s"), 2);
  assert.equal(parseDuration("500ms"), 0.5);
  assert.equal(parseDuration("3"), 3);
  assert.equal(parseDuration(".5"), 0.5);
  assert.equal(parseDuration("abc"), null);
});

test("parseTape extracts settings, outputs, and hidden regions", () => {
  const tape = `Output demo.gif
Set FontSize 26
Set TypingSpeed 100ms
Hide
Type "npm install"
Enter
Show
Type "greet hello"
Enter
Sleep 3s`;
  const p = parseTape(tape);
  assert.equal(p.outputs[0], "demo.gif");
  assert.equal(p.settings.FontSize, "26");
  const hiddenType = p.commands.find((c) => c.type === "type" && c.text === "npm install");
  assert.equal(hiddenType.hidden, true);
  const visibleType = p.commands.find((c) => c.type === "type" && c.text === "greet hello");
  assert.equal(visibleType.hidden, false);
});

test("multiple commands per line (butterfish style) parse correctly", () => {
  // Real-world regression: butterfish's tape uses `Type "..." Enter` and `Sleep 2s Show`.
  const tape = `Set TypingSpeed 100ms
Hide
Type "mkdir ~/project" Enter
Type "clear"
Enter
Sleep 2s Show
Type "ls"
Sleep 4s`;
  const p = parseTape(tape);
  const enters = p.commands.filter((c) => c.type === "key" && c.name === "Enter");
  assert.equal(enters.length, 2);
  assert.equal(enters[0].hidden, true);

  // `Sleep 2s Show`: the sleep is hidden, but Show flips visibility for what follows.
  const ls = p.commands.find((c) => c.type === "type" && c.text === "ls");
  assert.equal(ls.hidden, false);

  // visible: "ls" 2 chars * 0.1 + Sleep 4s = 4.2
  const { seconds } = estimateDuration(p);
  assert.ok(Math.abs(seconds - 4.2) < 0.001, `expected 4.2, got ${seconds}`);
});

test("estimateDuration: typing time + sleeps, hidden excluded, playback divides", () => {
  const tape = `Set TypingSpeed 100ms
Hide
Type "0123456789"
Sleep 60s
Show
Type "0123456789"
Enter
Sleep 5s`;
  // visible: 10 chars * 0.1s + 1 key * 0.1s + 5s = 6.1s
  const { seconds } = estimateDuration(parseTape(tape));
  assert.ok(Math.abs(seconds - 6.1) < 0.001, `expected 6.1, got ${seconds}`);

  const fast = `Set TypingSpeed 100ms\nSet PlaybackSpeed 2.0\nType "0123456789"\nSleep 5s`;
  const { seconds: fastSec } = estimateDuration(parseTape(fast));
  assert.ok(Math.abs(fastSec - 3) < 0.001, `expected 3, got ${fastSec}`);
});

test("timed repeated keys count toward duration", () => {
  const tape = `Down@500ms 4\nSleep 1s`;
  const { seconds } = estimateDuration(parseTape(tape));
  assert.ok(Math.abs(seconds - 3) < 0.001, `expected 3, got ${seconds}`);
});

test("Wait commands flag hasWait instead of guessing a duration", () => {
  const tape = `Type "make build"\nEnter\nWait+Line\nSleep 3s`;
  const { hasWait } = estimateDuration(parseTape(tape));
  assert.equal(hasWait, true);
});

test("lastVisibleAction skips hidden lines", () => {
  const tape = `Type "x"\nSleep 4s\nHide\nSleep 99s`;
  const last = lastVisibleAction(parseTape(tape));
  assert.equal(last.type, "sleep");
  assert.equal(last.seconds, 4);
});
