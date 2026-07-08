#!/usr/bin/env node
// Tiny fixture CLI used to exercise the autotape pipeline in tests and demos.
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const GREEN = "\x1b[32m";

const [, , cmd, ...rest] = process.argv;

function help() {
  console.log(`${BOLD}greet${RESET} — say hello, beautifully

${BOLD}Usage:${RESET}
  greet hello <name>     Greet someone with style
  greet wave             Wave at the whole terminal
  greet --help           Show this help

${DIM}A fixture CLI for autotape's end-to-end tests.${RESET}`);
}

if (!cmd || cmd === "--help" || cmd === "-h") {
  help();
} else if (cmd === "hello") {
  const name = rest.join(" ") || "world";
  const msg = `Hello, ${name}!`;
  const bar = "─".repeat(msg.length + 2);
  console.log(`${CYAN}╭${bar}╮${RESET}`);
  console.log(`${CYAN}│ ${BOLD}${MAGENTA}${msg}${RESET}${CYAN} │${RESET}`);
  console.log(`${CYAN}╰${bar}╯${RESET}`);
} else if (cmd === "wave") {
  console.log(`${GREEN}~~~ 👋 ~~~${RESET}`);
} else {
  console.error(`unknown command: ${cmd}`);
  help();
  process.exit(1);
}
