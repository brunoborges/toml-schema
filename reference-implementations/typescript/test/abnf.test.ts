import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BUILTIN_TYPES, DEFINITION_KEYS } from "../src/index.js";
import { repoPath } from "./helpers.js";

async function readAbnf(): Promise<string> {
  return readFile(repoPath("toml-schema.abnf"), "utf-8");
}

function ruleExpression(ruleName: string, abnf: string): string {
  let expression = "";
  let inRule = false;
  for (const line of abnf.split("\n")) {
    if (line.startsWith(`${ruleName} =`)) {
      const [, value] = line.split(/=(.*)/s);
      expression += (value ?? "").trim();
      inRule = true;
      continue;
    }
    if (inRule) {
      if (line.startsWith(" ") || line.startsWith("\t")) {
        expression += ` ${line.trim()}`;
        continue;
      }
      break;
    }
  }
  return expression;
}

function alternativesFor(ruleName: string, abnf: string): string[] {
  const expression = ruleExpression(ruleName, abnf);
  const tokens: string[] = [];
  for (const rawToken of expression.split("/")) {
    const token = rawToken.trim();
    if (token === "" || token === "version") continue;
    tokens.push(token);
  }
  return tokens;
}

function builtInTypeTokens(abnf: string): string[] {
  const tokens: string[] = [];
  const pattern = /;\s*"([^"]+)"/;
  for (const line of abnf.split("\n")) {
    const match = pattern.exec(line);
    if (!match) continue;
    const token = match[1] as string;
    if ((DEFINITION_KEYS as readonly string[]).includes(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

test("DEFINITION_KEYS matches the ABNF schema-key alternatives", async () => {
  const abnf = await readAbnf();
  const expected = alternativesFor("schema-key", abnf);
  assert.deepEqual([...DEFINITION_KEYS].sort(), [...expected].sort());
});

test("BUILTIN_TYPES matches the ABNF built-in-type token comments", async () => {
  const abnf = await readAbnf();
  const expected = builtInTypeTokens(abnf);
  assert.deepEqual([...BUILTIN_TYPES].sort(), [...expected].sort());
});
