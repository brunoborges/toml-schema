import assert from "node:assert/strict";
import { test } from "node:test";
import { encodePathKey, appendPath } from "../src/paths.js";

/**
 * Pins the diagnostic path key-encoding profile from SPEC.md `### Instance Path`
 * directly. The conformance corpus does NOT exercise control characters, so this
 * whole class of bug is corpus-invisible; the encoder must not be delegated to a
 * platform JSON encoder without verification. Digit case is normative: control
 * escapes are `\u00xx` in lowercase hexadecimal, never uppercase.
 */
test("encodePathKey follows the SPEC.md path key-encoding profile", () => {
  // A bare key (ASCII letters, digits, `_`, `-`) is written literally.
  assert.equal(encodePathKey("port"), "port");
  assert.equal(encodePathKey("a-b_9"), "a-b_9");

  // The empty key and keys needing quoting become RFC 8259 JSON strings.
  assert.equal(encodePathKey(""), '""');
  assert.equal(encodePathKey("google.com"), '"google.com"');
  assert.equal(encodePathKey("a b"), '"a b"');

  // `"` and `\` are escaped.
  assert.equal(encodePathKey('a"b'), '"a\\"b"');
  assert.equal(encodePathKey("a\\b"), '"a\\\\b"');

  // The five named control escapes.
  assert.equal(encodePathKey("\b"), '"\\b"');
  assert.equal(encodePathKey("\t"), '"\\t"');
  assert.equal(encodePathKey("\n"), '"\\n"');
  assert.equal(encodePathKey("\f"), '"\\f"');
  assert.equal(encodePathKey("\r"), '"\\r"');

  // Every other U+0000-U+001F scalar as `\u00xx` in LOWERCASE hex.
  assert.equal(encodePathKey("\u0001"), '"\\u0001"');
  assert.equal(encodePathKey("\u001f"), '"\\u001f"');
  assert.ok(!encodePathKey("\u001f").includes("\\u001F"), "control escape must be lowercase hex");

  // Non-ASCII passes through unescaped (it is not a control character and does
  // not require quoting beyond being non-bare).
  assert.equal(encodePathKey("café"), '"café"');
});

test("appendPath composes encoded segments", () => {
  assert.equal(appendPath("$", "site"), "$.site");
  assert.equal(appendPath("$.site", "google.com"), '$.site."google.com"');
  assert.equal(appendPath("$", ""), '$.""');
});
