package org.tomlschema;

import org.junit.jupiter.api.Named;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.tomlj.Toml;
import org.tomlj.TomlArray;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Runs the shared conformance corpus (see {@code conformance/manifest.toml}) against
 * the Java reference implementation. Each case is executed as its own parameterized
 * test so a systematic gap is diagnosable from a single named result.
 *
 * <p>Besides reproducing each case's coarse {@code expect} outcome, this runner asserts
 * the normative diagnostic model: every {@code [[case.diagnostics]]} expectation must be
 * present (REQUIRED-PRESENT, not an exact set), and the six universal checks from
 * {@code conformance/README.md} are applied to every diagnostic the implementation emits.
 */
class ConformanceCorpusTest {

    private static final Pattern EXTENSION_CODE = Pattern.compile("^x-[a-z][a-z0-9]*-[a-z0-9-]+$");
    private static final Pattern BARE_SEGMENT = Pattern.compile("[A-Za-z0-9_-]+");
    private static final Pattern ARRAY_INDEX = Pattern.compile("0|[1-9][0-9]*");

    private record ExpectedDiagnostic(
            String phase, String severity, String code, String instancePath, String schemaPath) {
    }

    private record ConformanceCase(
            String id, String expect, boolean document, String summary,
            List<ExpectedDiagnostic> diagnostics) {
    }

    private record RegistryEntry(String severity, List<String> phases) {
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    void conforms(ConformanceCase testCase) {
        Path caseDir = corpusRoot().resolve("cases").resolve(testCase.id());
        Path schemaPath = caseDir.resolve("schema.tosd");

        List<ValidationDiagnostic> actual = new ArrayList<>();
        TomlSchema schema;
        try {
            schema = TomlSchema.load(schemaPath);
        } catch (SchemaException loadError) {
            actual.add(loadError.toDiagnostic());
            if (!testCase.expect().equals("schema-load-error")) {
                fail("case " + testCase.id() + ": expected " + testCase.expect()
                        + " but the schema failed to load: " + describe(loadError));
            }
            checkUniversal(testCase, actual);
            assertExpectedPresent(testCase, actual);
            return;
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
        } catch (DocumentParseException parseError) {
            // A document that is not well-formed TOML never reaches the validator, so it
            // yields no diagnostics at all (SPEC.md `### TOML Version Baseline`).
            if (!testCase.expect().equals("document-parse-error")) {
                fail("case " + testCase.id() + ": expected " + testCase.expect()
                        + " but the document failed to parse as TOML: " + parseError.getMessage());
            }
            return;
        } catch (Exception validateError) {
            fail("case " + testCase.id() + ": expected " + testCase.expect()
                    + " but validation threw: " + describe(validateError));
            return;
        }
        if (testCase.expect().equals("document-parse-error")) {
            fail("case " + testCase.id()
                    + ": expected document-parse-error but the document parsed successfully");
        }
        actual.addAll(result.diagnostics());

        if (testCase.expect().equals("valid")) {
            assertTrue(result.isValid(),
                    () -> "case " + testCase.id() + ": expected valid but validation reported errors: "
                            + result.errors());
        } else { // validation-failure
            assertTrue(!result.isValid(),
                    () -> "case " + testCase.id()
                            + ": expected validation-failure but the document validated with no errors");
        }

        checkUniversal(testCase, actual);
        assertExpectedPresent(testCase, actual);
    }

    private void assertExpectedPresent(ConformanceCase testCase, List<ValidationDiagnostic> actual) {
        for (ExpectedDiagnostic expected : testCase.diagnostics()) {
            boolean present = actual.stream().anyMatch(d -> matches(expected, d));
            assertTrue(present, () -> "case " + testCase.id() + ": expected diagnostic "
                    + expected + " not present in actual diagnostics " + actual);
        }
    }

    /**
     * REQUIRED-PRESENT match on {@code (phase, severity, code, instance_path, schema_path)}.
     * An omitted path in the expectation is unasserted; message is never compared.
     */
    private static boolean matches(ExpectedDiagnostic expected, ValidationDiagnostic actual) {
        if (!expected.phase().equals(actual.phase().wireName())) {
            return false;
        }
        if (!expected.severity().equals(actual.severity().wireName())) {
            return false;
        }
        if (!expected.code().equals(actual.code())) {
            return false;
        }
        if (expected.instancePath() != null && !expected.instancePath().equals(actual.instancePath())) {
            return false;
        }
        return expected.schemaPath() == null || expected.schemaPath().equals(actual.schemaPath());
    }

    private void checkUniversal(ConformanceCase testCase, List<ValidationDiagnostic> actual) {
        Map<String, RegistryEntry> registry = registry();
        boolean sawError = false;
        for (ValidationDiagnostic diagnostic : actual) {
            String code = diagnostic.code();
            String where = "case " + testCase.id() + " diagnostic " + diagnostic;

            // 1. Code is in the registry or is a namespaced extension code.
            RegistryEntry entry = registry.get(code);
            if (entry == null) {
                assertTrue(EXTENSION_CODE.matcher(code).matches(),
                        () -> where + ": code '" + code + "' is neither registered nor a valid extension code");
            }

            // 2. Severity and phase are well-formed.
            String severity = diagnostic.severity().wireName();
            assertTrue(severity.equals("error") || severity.equals("warning"),
                    () -> where + ": invalid severity " + severity);
            String phase = diagnostic.phase().wireName();
            assertTrue(phase.equals("discovery") || phase.equals("schema-load") || phase.equals("validation"),
                    () -> where + ": invalid phase " + phase);

            // 3. Only deprecated and version-mismatch are warnings.
            if (severity.equals("warning")) {
                assertTrue(code.equals("deprecated") || code.equals("version-mismatch"),
                        () -> where + ": only deprecated/version-mismatch may be warnings");
            } else if (entry != null) {
                assertTrue(entry.severity().equals("error"),
                        () -> where + ": registry marks '" + code + "' as " + entry.severity()
                                + " but it was emitted as error");
            }

            // 4. Schema-load and discovery diagnostics carry no instance path.
            if (phase.equals("schema-load") || phase.equals("discovery")) {
                assertTrue(diagnostic.instancePath() == null,
                        () -> where + ": " + phase + " diagnostic must not carry an instance_path");
            }

            // 5. Any instance/schema path parses under the path grammar.
            assertTrue(pathIsValid(diagnostic.instancePath()),
                    () -> where + ": instance_path does not parse: " + diagnostic.instancePath());
            assertTrue(pathIsValid(diagnostic.schemaPath()),
                    () -> where + ": schema_path does not parse: " + diagnostic.schemaPath());

            if (severity.equals("error")) {
                sawError = true;
            }
        }

        // 6. valid => no error; validation-failure => at least one error.
        boolean finalSawError = sawError;
        if (testCase.expect().equals("valid")) {
            assertTrue(!finalSawError,
                    () -> "case " + testCase.id() + ": valid case must not produce an error diagnostic");
        } else if (testCase.expect().equals("validation-failure")) {
            assertTrue(finalSawError,
                    () -> "case " + testCase.id() + ": validation-failure must produce at least one error");
        }
    }

    /**
     * Verifies that every diagnostic code this implementation can emit is in the shared
     * registry. Reflecting over {@link DiagnosticCodes} catches typos and legacy names that
     * a case-driven run might not exercise.
     *
     * @throws IllegalAccessException if a registry constant cannot be read
     */
    @Test
    void everyEmittableCodeIsRegistered() throws IllegalAccessException {
        Map<String, RegistryEntry> registry = registry();
        for (Field field : DiagnosticCodes.class.getDeclaredFields()) {
            if (!Modifier.isStatic(field.getModifiers()) || field.getType() != String.class) {
                continue;
            }
            field.setAccessible(true);
            String code = (String) field.get(null);
            assertTrue(registry.containsKey(code),
                    () -> "DiagnosticCodes." + field.getName() + " = '" + code
                            + "' is not present in conformance/codes.toml");
        }
    }

    /** Validates an instance or schema path against the SPEC.md path grammar. */
    private static boolean pathIsValid(String path) {
        if (path == null) {
            return true;
        }
        if (!path.startsWith("$")) {
            return false;
        }
        int i = 1;
        int n = path.length();
        while (i < n) {
            char c = path.charAt(i);
            if (c == '.') {
                i++;
                if (i >= n) {
                    return false;
                }
                if (path.charAt(i) == '"') {
                    int end = scanJsonString(path, i);
                    if (end < 0) {
                        return false;
                    }
                    i = end;
                } else {
                    int start = i;
                    while (i < n && path.charAt(i) != '.' && path.charAt(i) != '[') {
                        i++;
                    }
                    if (!BARE_SEGMENT.matcher(path.substring(start, i)).matches()) {
                        return false;
                    }
                }
            } else if (c == '[') {
                int close = path.indexOf(']', i);
                if (close < 0) {
                    return false;
                }
                String index = path.substring(i + 1, close);
                if (!ARRAY_INDEX.matcher(index).matches()) {
                    return false;
                }
                i = close + 1;
            } else {
                return false;
            }
        }
        return true;
    }

    private static int scanJsonString(String path, int start) {
        int i = start + 1;
        int n = path.length();
        while (i < n) {
            char c = path.charAt(i);
            if (c == '\\') {
                if (i + 1 >= n) {
                    return -1;
                }
                char next = path.charAt(i + 1);
                if ("\"\\/bfnrt".indexOf(next) >= 0) {
                    i += 2;
                } else if (next == 'u' && i + 5 < n) {
                    i += 6;
                } else {
                    return -1;
                }
            } else if (c == '"') {
                return i + 1;
            } else {
                i++;
            }
        }
        return -1;
    }

    static Stream<Arguments> cases() {
        TomlTable parsed = parseToml(corpusRoot().resolve("manifest.toml"));
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
            List<ExpectedDiagnostic> diagnostics = new ArrayList<>();
            TomlArray diagArray = table.getArray("diagnostics");
            if (diagArray != null) {
                for (int j = 0; j < diagArray.size(); j++) {
                    TomlTable diag = diagArray.getTable(j);
                    diagnostics.add(new ExpectedDiagnostic(
                            diag.getString("phase"),
                            diag.getString("severity"),
                            diag.getString("code"),
                            diag.getString("instance_path"),
                            diag.getString("schema_path")));
                }
            }
            ConformanceCase testCase = new ConformanceCase(id, expect, document, summary, diagnostics);
            arguments.add(Arguments.of(Named.of(id, testCase)));
        }
        return arguments.stream();
    }

    private static Map<String, RegistryEntry> registry() {
        TomlTable parsed = parseToml(corpusRoot().resolve("codes.toml"));
        TomlArray codes = parsed.getArray("code");
        Map<String, RegistryEntry> registry = new LinkedHashMap<>();
        for (int i = 0; i < codes.size(); i++) {
            TomlTable code = codes.getTable(i);
            List<String> phases = new ArrayList<>();
            TomlArray phaseArray = code.getArray("phases");
            if (phaseArray != null) {
                for (int j = 0; j < phaseArray.size(); j++) {
                    phases.add(phaseArray.getString(j));
                }
            }
            registry.put(Objects.requireNonNull(code.getString("name")),
                    new RegistryEntry(code.getString("severity"), phases));
        }
        return registry;
    }

    private static TomlTable parseToml(Path path) {
        TomlParseResult parsed;
        try {
            parsed = Toml.parse(path);
        } catch (Exception e) {
            throw new IllegalStateException("could not read " + path, e);
        }
        if (parsed.hasErrors()) {
            throw new IllegalStateException(path + " has TOML errors: " + parsed.errors());
        }
        return parsed;
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
