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
  return { repoPath, cmd: resolvedCmd, name, readme, helpText };
}
