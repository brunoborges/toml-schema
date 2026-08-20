import assert from "node:assert/strict";
import { test } from "node:test";
import { SchemaError, loadSchemaFromSource } from "../src/index.js";

function schemaFor(format: string, extra = "") {
  return loadSchemaFromSource(
    `${format}.tosd`,
    `[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
format = "${format}"
${extra}`,
  );
}

const cases: Readonly<Record<string, { valid: string[]; invalid: string[] }>> = {
  email: {
    valid: [
      "simple@example.com",
      "first.last+tag@sub.example.com",
      "\"quoted local\"@example.com",
      "\"a@b\"@example.com",
      "\"escaped\\\\\\\"quote\"@example.com",
      "user@[192.0.2.1]",
      "user@[IPv6:2001:db8::1]",
      "user@[TAG:value]",
    ],
    invalid: [
      ".leading@example.com",
      "trailing.@example.com",
      "two..dots@example.com",
      "unquoted space@example.com",
      "\"unterminated@example.com",
      "user@-example.com",
      "user@example..com",
      "user@example.com.",
      "user@[IPv6:2001:::1]",
      "ü@example.com",
      `${"a".repeat(65)}@example.com`,
      `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(60)}.com`,
    ],
  },
  uuid: {
    valid: ["550e8400-e29b-41d4-a716-446655440000", "00000000-0000-0000-0000-000000000000"],
    invalid: ["{550e8400-e29b-41d4-a716-446655440000}", "550e8400e29b41d4a716446655440000", "not-a-uuid"],
  },
  uri: {
    valid: [
      "https://example.com/a%20b?q=x#fragment",
      "mailto:user@example.com",
      "urn:isbn:0451450523",
      "file:///etc/hosts",
      "http://[2001:db8::1]/",
      "http://[v1.fe]/",
      "scheme:",
    ],
    invalid: [
      "example.com/path",
      "https://example.com/%zz",
      "https://example.com/a b",
      "1http://example.com",
      "http://[2001:::1]/",
      "http://example.com/#first#second",
    ],
  },
  hostname: {
    valid: ["example.com", "EXAMPLE.com.", "123.example", "a"],
    invalid: ["-example.com", "example-.com", "example..com", "éxample.com", `${"a".repeat(64)}.com`],
  },
  ipv4: {
    valid: ["0.0.0.0", "192.0.2.1", "255.255.255.255"],
    invalid: ["192.168.001.1", "256.0.0.1", "1.2.3", "1.2.3.4.5", "1.2.3.-1"],
  },
  ipv6: {
    valid: ["::", "::1", "2001:db8::1", "2001:db8:0:0:0:0:192.0.2.1", "::ffff:192.0.2.128"],
    invalid: ["2001:::1", "2001:db8", "::ffff:192.168.001.1", "fe80::1%eth0", "192.0.2.1"],
  },
};

for (const [format, values] of Object.entries(cases)) {
  test(`validates ${format} format`, () => {
    const schema = schemaFor(format);
    for (const value of values.valid) {
      const result = schema.validate({ value });
      assert.equal(result.valid, true, `${value}: ${JSON.stringify(result.errors)}`);
    }
    for (const value of values.invalid) {
      const result = schema.validate({ value });
      assert.equal(result.valid, false, `${value} should be rejected`);
      assert.match(result.errors[0]?.message ?? "", new RegExp(`valid ${format}`));
    }
  });
}

test("rejects unknown, non-string, incompatible, and inherited format declarations", () => {
  for (const declaration of [
    'type = "string"\nformat = "date"',
    'type = "integer"\nformat = "uuid"',
    'type = "string"\nformat = true',
    'type = "types.formatted"\nformat = "email"',
  ]) {
    assert.throws(
      () => loadSchemaFromSource("invalid-format.tosd", `[toml-schema]
version = "1.0.0"

[types.formatted]
type = "string"

[elements.value]
${declaration}
`),
      SchemaError,
    );
  }
});

test("rejects allowedvalues that violate their declared format at schema load", () => {
  assert.throws(
    () => schemaFor("email", 'allowedvalues = [ "not-an-email" ]'),
    /allowedvalues\[0\] does not satisfy format email/,
  );
});
