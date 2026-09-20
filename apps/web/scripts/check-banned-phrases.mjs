#!/usr/bin/env node
/**
 * Greps src/ for the banned-phrase list in docs/04-ui-ux/COPY-DECK.md §5.
 * Exits non-zero (and prints every hit) if anything matches — the anti-slop
 * gate the plan's Phase 4 requires before UI-QA sign-off.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BANNED = [
  /the new standard for/i,
  /-ized\b/i, // coined "-ized" abstractions (e.g. "perpetualized")
  /revolutioniz/i,
  /\bunleash/i,
  /supercharge/i,
  /\btransform\b/i,
  /next-generation/i,
  /cutting-edge/i,
  /game-chang/i,
  /paradigm shift/i,
  /seamless/i,
  /effortless/i,
  /frictionless/i,
  /institutional-grade/i,
  /professional-grade/i,
  /trustless/i,
  /fully decentralized/i,
  /battle-tested/i,
  /secure by design/i,
  /bank-grade/i,
  /\byield\b/i, // premium is a payment, not a yield
  /\bAPY\b/,
  /\brewards\b/i,
];

const ROOT = join(import.meta.dirname, "..", "src");
let hits = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      walk(p);
    } else if (/\.tsx?$/.test(entry)) {
      const text = readFileSync(p, "utf8");
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        for (const pattern of BANNED) {
          if (pattern.test(line)) {
            console.log(`${p}:${i + 1}: matches ${pattern} -> ${line.trim()}`);
            hits++;
          }
        }
      });
    }
  }
}

walk(ROOT);

if (hits > 0) {
  console.error(`\n${hits} banned-phrase match(es) found. See docs/04-ui-ux/COPY-DECK.md §5.`);
  process.exit(1);
}
console.log("No banned phrases found.");
