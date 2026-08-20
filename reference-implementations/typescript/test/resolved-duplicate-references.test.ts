import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSchemaFromSource } from "../src/index.js";

for (const property of ["oneof", "anyof", "allof"] as const) {
  test(`${property} rejects duplicate references by resolved identity`, () => {
    const localType = property === "allof" ? 'type = "string"\n' : "";
    assert.throws(
      () =>
        loadSchemaFromSource(
          `${property}.tosd`,
          `[toml-schema]
version = "1.0.0"

[types.foo]
type = "string"

[elements.value]
${localType}${property} = ["types.foo", "foo"]
`,
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          `elements.value ${property} contains duplicate type references "types.foo" and "foo"; both resolve to foo`,
        );
        return true;
      },
    );
  });
}

test("items allows repeated references", () => {
  const schema = loadSchemaFromSource(
    "tuple.tosd",
    `[toml-schema]
version = "1.0.0"

[types.coordinate]
type = "float"

[elements.point]
type = "array"
items = ["types.coordinate", "types.coordinate"]
`,
  );

  const result = schema.validate({ point: [1.0, 2.0] });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
