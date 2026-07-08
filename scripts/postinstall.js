#!/usr/bin/env node
// Checks for vhs/ttyd/ffmpeg on PATH and prints install commands if missing.
// Never fails the install (exit 0 always) — this is a nudge, not a gate.
import { execFileSync } from "node:child_process";

const REQUIRED = [
  { bin: "vhs", purpose: "renders the tape into a GIF" },
  { bin: "ttyd", purpose: "the virtual terminal VHS records (usually pulled in by the vhs package)" },
  { bin: "ffmpeg", purpose: "extracted frames for autotape's self-review step" },
];

const INSTALL_CMD = {
  darwin: "brew install vhs",
  linux: "sudo apt install ttyd ffmpeg && go install github.com/charmbracelet/vhs@latest  # or: brew install vhs / pacman -S vhs",
  win32: "scoop install vhs",
};

function isOnPath(bin) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const missing = REQUIRED.filter((r) => !isOnPath(r.bin));
if (missing.length === 0) {
  console.log("autotape: found vhs, ttyd, and ffmpeg on PATH — ready to go.");
  process.exit(0);
}

const cmd = INSTALL_CMD[process.platform] ?? INSTALL_CMD.linux;
console.log("\nautotape needs these on PATH to render GIFs:");
for (const r of missing) console.log(`  - ${r.bin}  (${r.purpose})`);
console.log(`\nInstall with:\n  ${cmd}\n`);
console.log("(autotape itself is installed — this is just a heads-up. See https://github.com/charmbracelet/vhs#installation for other platforms.)\n");
process.exit(0);
