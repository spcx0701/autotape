import { parseArgs } from "node:util";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { analyze } from "./analyze.js";
import { generateTape } from "./generate.js";
import { lint } from "./lint.js";
import { render } from "./render.js";
import { review } from "./review.js";
import { c, step } from "./util.js";

const HELP = `${c.bold("autotape")} — point it at a CLI repo, get a README-ready demo GIF

${c.bold("Usage:")}
  autotape [repo-path] [options]        generate tape → lint → render → self-review
  autotape lint <file.tape> [options]   lint an existing tape

${c.bold("Options:")}
  --cmd "<command>"    how to invoke the CLI (auto-detected from package.json bin)
  --profile <p>        hero | tui                       (default: hero)
  --agent <a>          claude | codex | none            (default: claude)
  --model <m>          model for generation/review      (default: sonnet)
  --try "<command>"    example invocation, used by --agent none
  --out <dir>          output directory                 (default: ./autotape-out)
  --pr                 PR mode: 10s budget instead of 20s
  --no-review          skip the frame-by-frame self-review
  --shell <shell>      shell for the recording (default: vhs default)
  -h, --help           show this help

${c.dim(`Profiles and lint thresholds are measured from 13 real tapes in popular
repos — see data/extracted-defaults.json for the distributions and sources.`)}`;

// Paths shown to the user: relative when inside cwd, absolute otherwise
// (a ../../../ chain is worse than an absolute path).
function disp(p) {
  const rel = relative(process.cwd(), p);
  return rel.startsWith("..") ? p : rel;
}

function printFindings(findings) {
  for (const f of findings) {
    const tag = f.severity === "error" ? c.red("error") : c.yellow("warn ");
    console.log(`  ${tag} ${c.dim(`[${f.rule}]`)} ${f.message}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      cmd: { type: "string" },
      profile: { type: "string", default: "hero" },
      agent: { type: "string", default: "claude" },
      model: { type: "string", default: "sonnet" },
      try: { type: "string" },
      out: { type: "string", default: "autotape-out" },
      pr: { type: "boolean", default: false },
      "no-review": { type: "boolean", default: false },
      shell: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const budget = values.pr ? 10 : 20;

  // Subcommand: autotape lint <file.tape>
  if (positionals[0] === "lint") {
    const file = positionals[1];
    if (!file) throw new Error("usage: autotape lint <file.tape>");
    const text = await readFile(file, "utf8");
    const { findings, durationSec } = lint(text, { profile: values.profile, budget });
    console.log(`${c.bold(file)} — estimated visible duration ${durationSec.toFixed(1)}s (budget ${budget}s)`);
    if (findings.length === 0) {
      console.log(c.green("✓ clean"));
      return 0;
    }
    printFindings(findings);
    return findings.some((f) => f.severity === "error") ? 1 : 0;
  }

  // VHS rejects absolute Output paths (`/…` collides with its /regex/ syntax),
  // so the tape gets a repo-relative path — computed on realpaths, because
  // relative() breaks across symlinks like macOS /tmp → /private/tmp.
  const repoPath = realpathSync(resolve(positionals[0] ?? "."));
  await mkdir(resolve(values.out), { recursive: true });
  const outDir = realpathSync(resolve(values.out));
  const gifPath = join(outDir, "demo.gif");
  const gifRel = relative(repoPath, gifPath);
  const tapePath = join(outDir, "demo.tape");

  step(`analyzing ${c.bold(repoPath)}`);
  const analysis = await analyze({ repoPath, cmd: values.cmd });
  step(`tool: ${c.bold(analysis.name)} ${c.dim(`(${analysis.cmd})`)} — help captured: ${analysis.helpText ? "yes" : "no"}`);

  let feedback;
  const maxAttempts = values.agent === "none" || values["no-review"] ? 1 : 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    step(`writing tape ${c.dim(`(agent: ${values.agent}, profile: ${values.profile}, attempt ${attempt}/${maxAttempts})`)}`);
    const { tape, report } = await generateTape(analysis, {
      profile: values.profile,
      agent: values.agent,
      model: values.model,
      budget,
      tryCmd: values.try,
      output: gifRel,
      shell: values.shell,
      feedback,
    });

    await writeFile(tapePath, tape);
    step(`lint: estimated ${report.durationSec.toFixed(1)}s visible ${c.dim(`(budget ${budget}s)`)}`);
    printFindings(report.findings);
    const errors = report.findings.filter((f) => f.severity === "error");
    if (errors.length > 0 && attempt === maxAttempts) {
      console.log(c.red(`✗ ${errors.length} lint error(s) remain — tape written to ${tapePath}, fix and re-render with: vhs ${tapePath}`));
      return 1;
    }
    if (errors.length > 0) {
      feedback = errors.map((e) => e.message).join("\n");
      continue;
    }

    step("rendering with vhs (deterministic)");
    const { bytes } = await render(tapePath, { cwd: repoPath, outputPath: gifRel });
    step(`rendered ${c.bold(disp(gifPath))} ${c.dim(`(${(bytes / 1024).toFixed(0)} KB)`)}`);

    if (values["no-review"] || values.agent === "none") {
      await writeSnippet(outDir, analysis.name);
      console.log(c.green(`✓ done (self-review skipped)`));
      return 0;
    }

    step("self-review: reading the GIF frame by frame");
    const verdict = await review(gifPath, { model: values.model, toolName: analysis.name });
    if (verdict.pass === true) {
      await writeFile(join(outDir, "review.json"), JSON.stringify(verdict, null, 2));
      await writeSnippet(outDir, analysis.name);
      console.log(c.green(`✓ review passed — demo.gif, demo.tape, README-snippet.md in ${disp(outDir)}/`));
      return 0;
    }
    if (verdict.pass === null) {
      await writeSnippet(outDir, analysis.name);
      console.log(c.yellow(`⚠ review inconclusive (${verdict.issues[0] ?? "no verdict"}) — inspect ${disp(gifPath)} yourself`));
      return 0;
    }
    console.log(c.yellow(`✗ review rejected the GIF:`));
    for (const issue of verdict.issues) console.log(`    - ${issue}`);
    feedback = verdict.issues.join("\n");
    if (attempt === maxAttempts) {
      console.log(c.red("✗ giving up after review rejection — the tape draft is yours to edit"));
      return 1;
    }
  }
  return 1;
}

async function writeSnippet(outDir, name) {
  const snippet = `<!-- Generated by autotape -->
<p align="center">
  <img src="./autotape-out/demo.gif" alt="${name} demo" width="800" />
</p>
`;
  await writeFile(join(outDir, "README-snippet.md"), snippet);
}
