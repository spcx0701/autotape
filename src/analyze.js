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
  return { repoPath, cmd: resolvedCmd, name, readme, helpText, files };
}
