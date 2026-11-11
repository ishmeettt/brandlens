/**
 * Rule replay harness.
 *
 * Runs the real deterministic engine against the labelled corpus and reports
 * precision and recall per rule. Exit code is non-zero if any labelled case is
 * missed or any unlabelled finding appears, so this can gate a rule change.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = new URL("..", import.meta.url);
const corpusPath = fileURLToPath(new URL("evals/corpus.json", root));
const bundlePath = fileURLToPath(new URL(".build/rules.mjs", root));

await esbuild.build({
  entryPoints: [fileURLToPath(new URL("src/lib/rules.ts", root))],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  logLevel: "warning",
});

const { runDeterministicRules } = await import(new URL(".build/rules.mjs", root).href);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));

const stats = new Map();
const problems = [];

function bucket(ruleId) {
  if (!stats.has(ruleId)) stats.set(ruleId, { tp: 0, fp: 0, fn: 0 });
  return stats.get(ruleId);
}

let totalTp = 0;
let totalFp = 0;
let totalFn = 0;

for (const document of corpus.documents) {
  const findings = runDeterministicRules(document.text, corpus.kit);
  const expected = document.expect ?? [];
  const used = new Set();

  for (const want of expected) {
    const hit = findings.find((finding, index) => {
      if (used.has(index)) return false;
      if (finding.ruleId !== want.ruleId) return false;
      if (!want.contains) return true;
      return finding.message.toLowerCase().includes(want.contains.toLowerCase());
    });

    if (hit) {
      used.add(findings.indexOf(hit));
      bucket(want.ruleId).tp += 1;
      totalTp += 1;
    } else {
      bucket(want.ruleId).fn += 1;
      totalFn += 1;
      problems.push(
        `MISS  ${document.id}: expected ${want.ruleId}${want.contains ? ` containing "${want.contains}"` : ""}`
      );
    }
  }

  findings.forEach((finding, index) => {
    if (used.has(index)) return;
    bucket(finding.ruleId).fp += 1;
    totalFp += 1;
    problems.push(`EXTRA ${document.id}: ${finding.ruleId} — ${finding.message}`);
  });
}

const rules = [...stats.keys()].sort();
const pad = (value, width) => String(value).padEnd(width);

console.log("");
console.log(
  pad("rule", 26) + pad("hit", 6) + pad("miss", 6) + pad("extra", 7) + pad("precision", 11) + "recall"
);
console.log("-".repeat(66));
for (const rule of rules) {
  const { tp, fp, fn } = stats.get(rule);
  const precision = tp + fp === 0 ? "—" : `${((tp / (tp + fp)) * 100).toFixed(0)}%`;
  const recall = tp + fn === 0 ? "—" : `${((tp / (tp + fn)) * 100).toFixed(0)}%`;
  console.log(pad(rule, 26) + pad(tp, 6) + pad(fn, 6) + pad(fp, 7) + pad(precision, 11) + recall);
}
console.log("-".repeat(66));

const overallPrecision = totalTp + totalFp === 0 ? 1 : totalTp / (totalTp + totalFp);
const overallRecall = totalTp + totalFn === 0 ? 1 : totalTp / (totalTp + totalFn);
console.log(
  `${corpus.documents.length} documents · ${totalTp} expected matched · ${totalFp} unexpected · ${totalFn} missed`
);
console.log(
  `overall precision ${(overallPrecision * 100).toFixed(0)}% · recall ${(overallRecall * 100).toFixed(0)}%`
);

if (problems.length > 0) {
  console.log("");
  for (const line of problems) console.log(line);
  console.log(`\n${problems.length} mismatch(es).`);
  process.exit(1);
}

console.log("\nCorpus matches the engine exactly.");
