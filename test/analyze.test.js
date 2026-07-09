import { test } from "node:test";
import assert from "node:assert/strict";
import { extractKeybindings, detectKind } from "../src/analyze.js";

const tuiReadme = `# ratatop
A terminal UI for monitoring processes.

## Keybindings
| Key | Action |
|-----|--------|
| <kbd>j</kbd> / <kbd>k</kbd> | move down / up |
| <kbd>Tab</kbd> | switch panel |
| <kbd>/</kbd> | filter processes |

Press <kbd>q</kbd> to quit. Use the arrow keys to navigate.
`;

const oneshotReadme = `# jq
A lightweight JSON processor.

Usage: jq FILTER [file.json]
Example: jq '.name' data.json
`;

test("extractKeybindings pulls key→action rows without pipe/kbd noise", () => {
  const kb = extractKeybindings(tuiReadme);
  assert.ok(kb.length >= 3, `expected >=3 keybindings, got ${kb.length}`);
  assert.ok(kb.some((l) => /switch panel/.test(l)));
  // table pipes and <kbd> tags are stripped, no trailing separator survives
  assert.ok(!kb.some((l) => /<kbd>|\|/.test(l)), "kbd tags / pipes leaked");
  assert.ok(!kb.some((l) => /[—–|:-]\s*$/.test(l)), "trailing separator leaked");
});

test("extractKeybindings returns nothing for a plain one-shot README", () => {
  assert.deepEqual(extractKeybindings(oneshotReadme), []);
});

test("detectKind flags a TUI from strong signals and keybinding density", () => {
  const kb = extractKeybindings(tuiReadme);
  assert.equal(detectKind({ readme: tuiReadme, helpText: "", keybindings: kb }), "tui");
});

test("detectKind leaves a plain command as one-shot", () => {
  const kb = extractKeybindings(oneshotReadme);
  assert.equal(detectKind({ readme: oneshotReadme, helpText: "", keybindings: kb }), "oneshot");
});

test("detectKind catches a framework mention even with no keybinding table", () => {
  const readme = "# myapp\nBuilt with bubbletea. Just run `myapp` and enjoy.";
  assert.equal(detectKind({ readme, helpText: "", keybindings: [] }), "tui");
});
