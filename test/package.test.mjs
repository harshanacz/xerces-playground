// Feeds XSD + XML input into the real xerces-wasm npm package and asserts on
// the ValidationResult output — the same input→output flow the playground UI
// drives (src/main.ts), minus the DOM. Run with: node --test test/package.test.mjs
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createProjectValidator, validate } from "xerces-wasm";

// Same schema the playground loads by default.
const LOG_XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="log">
    <xs:complexType>
      <xs:attribute name="level" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

describe("single-file schema (playground default flow)", () => {
  let v;
  before(async () => {
    v = await createProjectValidator({ entry: "main.xsd", files: { "main.xsd": LOG_XSD } });
  });
  after(() => v.destroy());

  test("valid XML -> valid with no diagnostics", async () => {
    const r = await v.validate(`<log level="full"/>`);
    assert.equal(r.valid, true);
    assert.deepEqual(r.parseErrors, []);
    assert.deepEqual(r.schemaErrors, []);
  });

  test("missing required attribute -> invalid with schema error", async () => {
    const r = await v.validate(`<log/>`);
    assert.equal(r.valid, false);
    assert.ok(r.schemaErrors.length > 0, "expected at least one schema error");
    assert.match(r.schemaErrors[0].message, /level/);
  });

  test("undeclared root element -> invalid with schema error", async () => {
    const r = await v.validate(`<other/>`);
    assert.equal(r.valid, false);
    assert.match(r.schemaErrors[0].message, /no declaration found for element 'other'/);
  });

  test("malformed XML -> invalid with fatal parse error", async () => {
    const r = await v.validate(`<log level="full"`);
    assert.equal(r.valid, false);
    assert.ok(r.parseErrors.length > 0, "expected at least one parse error");
    assert.equal(r.parseErrors[0].severity, "fatal");
  });

  test("empty input -> invalid with fatal parse error", async () => {
    const r = await v.validate("");
    assert.equal(r.valid, false);
    assert.equal(r.parseErrors[0].severity, "fatal");
  });

  test("diagnostics carry usable message/line/column/severity", async () => {
    const r = await v.validate(`<log/>`);
    for (const d of [...r.parseErrors, ...r.schemaErrors]) {
      assert.equal(typeof d.message, "string");
      assert.ok(d.message.length > 0);
      assert.ok(Number.isInteger(d.line) && d.line >= 1, `line: ${d.line}`);
      assert.ok(Number.isInteger(d.column) && d.column >= 1, `column: ${d.column}`);
      assert.ok(["warning", "error", "fatal"].includes(d.severity), `severity: ${d.severity}`);
    }
  });

  test("one validator handles many documents (cache reuse as in main.ts)", async () => {
    assert.equal((await v.validate(`<log level="a"/>`)).valid, true);
    assert.equal((await v.validate(`<log/>`)).valid, false);
    assert.equal((await v.validate(`<log level="b"/>`)).valid, true);
  });
});

describe("multi-file schema project", () => {
  const MAIN_XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="types.xsd"/>
  <xs:element name="person">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="age" type="AgeType"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
  const TYPES_XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:simpleType name="AgeType">
    <xs:restriction base="xs:integer">
      <xs:minInclusive value="0"/>
      <xs:maxInclusive value="150"/>
    </xs:restriction>
  </xs:simpleType>
</xs:schema>`;

  let v;
  before(async () => {
    v = await createProjectValidator({
      entry: "main.xsd",
      files: { "main.xsd": MAIN_XSD, "types.xsd": TYPES_XSD },
    });
  });
  after(() => v.destroy());

  test("included type resolves across files", async () => {
    const r = await v.validate(`<person><age>42</age></person>`);
    assert.equal(r.valid, true);
  });

  test("range facet from included file is enforced", async () => {
    const r = await v.validate(`<person><age>200</age></person>`);
    assert.equal(r.valid, false);
    assert.match(r.schemaErrors[0].message, /maxInclusive/);
  });

  test("non-integer value rejected by included type", async () => {
    const r = await v.validate(`<person><age>abc</age></person>`);
    assert.equal(r.valid, false);
    assert.ok(r.schemaErrors.length > 0);
  });
});

describe("validator lifecycle", () => {
  test("reload() swaps the schema in place", async () => {
    const v = await createProjectValidator({ entry: "main.xsd", files: { "main.xsd": LOG_XSD } });
    assert.equal((await v.validate(`<log level="x"/>`)).valid, true);

    await v.reload({
      "main.xsd": `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="item" type="xs:string"/>
</xs:schema>`,
    });

    assert.equal((await v.validate(`<item>hi</item>`)).valid, true);
    assert.equal((await v.validate(`<log level="x"/>`)).valid, false, "old schema should be gone");
    v.destroy();
  });

  test("uncompilable XSD rejects at creation (playground shows ERROR badge)", async () => {
    await assert.rejects(
      createProjectValidator({ entry: "main.xsd", files: { "main.xsd": `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element` } }),
      /failed to compile schema/
    );
  });
});

describe("top-level validate()", () => {
  test("one-shot validate(xml, xsd) works without a validator instance", async () => {
    const ok = await validate(`<log level="full"/>`, LOG_XSD);
    assert.equal(ok.valid, true);

    const bad = await validate(`<log/>`, LOG_XSD);
    assert.equal(bad.valid, false);
    assert.ok(bad.schemaErrors.length > 0);
  });
});
