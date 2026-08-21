package org.tomlschema;

import org.junit.jupiter.api.Named;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.tomlj.Toml;
import org.tomlj.TomlArray;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Runs the shared conformance corpus (see {@code conformance/manifest.toml}) against
 * the Java reference implementation. Each case is executed as its own parameterized
 * test so a systematic gap is diagnosable from a single named result.
 */
class ConformanceCorpusTest {

    private record ConformanceCase(String id, String expect, boolean document, String summary) {
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    void conforms(ConformanceCase testCase) {
        Path caseDir = corpusRoot().resolve("cases").resolve(testCase.id());
        Path schemaPath = caseDir.resolve("schema.tosd");

        TomlSchema schema;
        try {
            schema = TomlSchema.load(schemaPath);
        } catch (RuntimeException loadError) {
            if (testCase.expect().equals("schema-load-error")) {
                return;
            }
            fail("case " + testCase.id() + ": expected " + testCase.expect()
                    + " but the schema failed to load: " + describe(loadError));
            return;
        }

        if (testCase.expect().equals("schema-load-error")) {
            fail("case " + testCase.id()
                    + ": expected schema-load-error but the schema loaded successfully");
        }

        ValidationResult result;
        try {
            result = schema.validate(caseDir.resolve("document.toml"));
        } catch (Exception validateError) {
            fail("case " + testCase.id() + ": expected " + testCase.expect()
                    + " but validation threw: " + describe(validateError));
            return;
        }

        if (testCase.expect().equals("valid")) {
            assertTrue(result.isValid(),
                    () -> "case " + testCase.id() + ": expected valid but validation reported errors: "
                            + result.errors());
        } else { // validation-failure
            assertTrue(!result.isValid(),
                    () -> "case " + testCase.id()
                            + ": expected validation-failure but the document validated with no errors");
        }
    }

    static Stream<Arguments> cases() {
        Path manifest = corpusRoot().resolve("manifest.toml");
        TomlParseResult parsed;
        try {
            parsed = Toml.parse(manifest);
        } catch (Exception e) {
            throw new IllegalStateException("could not read conformance manifest at " + manifest, e);
        }
        if (parsed.hasErrors()) {
            throw new IllegalStateException("conformance manifest has TOML errors: " + parsed.errors());
        }
        TomlArray caseArray = parsed.getArray("case");
        if (caseArray == null) {
            throw new IllegalStateException("conformance manifest has no [[case]] entries");
        }
        List<Arguments> arguments = new ArrayList<>();
        for (int i = 0; i < caseArray.size(); i++) {
            TomlTable table = caseArray.getTable(i);
            String id = table.getString("id");
            String expect = table.getString("expect");
            boolean document = table.getBoolean("document", () -> false);
            String summary = table.getString("summary");
            ConformanceCase testCase = new ConformanceCase(id, expect, document, summary);
            arguments.add(Arguments.of(Named.of(id, testCase)));
        }
        return arguments.stream();
    }

    private static String describe(Throwable error) {
        String message = error.getMessage();
        return error.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private static Path corpusRoot() {
        Path here;
        try {
            here = Path.of(ConformanceCorpusTest.class.getProtectionDomain()
                    .getCodeSource().getLocation().toURI());
        } catch (Exception e) {
            here = Path.of("").toAbsolutePath();
        }
        for (Path dir = here.toAbsolutePath(); dir != null; dir = dir.getParent()) {
            Path candidate = dir.resolve("conformance");
            if (Files.isDirectory(candidate) && Files.isRegularFile(candidate.resolve("manifest.toml"))) {
                return candidate;
            }
        }
        throw new IllegalStateException("could not locate conformance/ directory from " + here);
    }
}
