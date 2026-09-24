// Regenerates server/arcade/snakeCore.js (CommonJS) from the one source of truth,
// frontend/src/dashboard/arcade/snakeCore.js (ESM). Run after editing the ESM file:
//   node server/scripts/sync-snake-core.js
// server/test/snakeParity.test.mjs fails while the two copies differ.
const fs = require("fs");
const path = require("path");

const SOURCE = path.resolve(__dirname, "../../frontend/src/dashboard/arcade/snakeCore.js");
const TARGET = path.resolve(__dirname, "../arcade/snakeCore.js");
const START = "// --- core start ---";
const END = "// --- core end ---";

function coreBody(text) {
  const from = text.indexOf(START);
  const to = text.indexOf(END);
  if (from === -1 || to === -1 || to < from) throw new Error("core markers not found");
  return text.slice(from, to + END.length);
}

function exportedNames(text) {
  const m = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(text.trim());
  if (!m) throw new Error("export list not found");
  return m[1].split(",").map((n) => n.trim()).filter(Boolean);
}

function render(sourceText) {
  const names = exportedNames(sourceText);
  const lines = [];
  for (let i = 0; i < names.length; i += 8) lines.push(`  ${names.slice(i, i + 8).join(", ")},`);
  return [
    "// GENERATED from frontend/src/dashboard/arcade/snakeCore.js by",
    "// server/scripts/sync-snake-core.js - edit the frontend file, then rerun the script.",
    "// The server replays finished Arcade games with exactly the browser's rules.",
    "\"use strict\";",
    "",
    coreBody(sourceText),
    "",
    "module.exports = {",
    ...lines,
    "};",
    "",
  ].join("\n");
}

if (require.main === module) {
  fs.writeFileSync(TARGET, render(fs.readFileSync(SOURCE, "utf8")));
  console.log(`Wrote ${path.relative(process.cwd(), TARGET)}`);
}

module.exports = { SOURCE, TARGET, coreBody, render };
