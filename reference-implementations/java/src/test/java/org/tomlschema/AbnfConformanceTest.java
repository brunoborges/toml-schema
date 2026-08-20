package org.tomlschema;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AbnfConformanceTest {
    private static final Pattern QUOTED_TOKEN = Pattern.compile("\"([^\"]+)\"");
    private static final Set<String> NON_SCHEMA_KEYS = Set.of("version");

    @Test
    void schemaLoaderDefinitionKeysMatchAbnfSchemaKeys() throws IOException {
        String abnf = readAbnf();

        assertEquals(SchemaLoader.DEFINITION_KEYS, alternativesFor("schema-key", abnf));
    }

    @Test
    void specificationAndSelfSchemaDefinitionKeysMatchAbnf() throws IOException {
        Set<String> abnfKeys = alternativesFor("schema-key", readAbnf());
        String specification = Files.readString(fixture("SPEC.md"), StandardCharsets.UTF_8);
        int inventoryStart = specification.indexOf("In full,");
        int inventoryEnd = specification.indexOf("The set is closed", inventoryStart);
        String inventory = specification.substring(inventoryStart, inventoryEnd);
        Matcher property = Pattern.compile("`([a-z]+)`").matcher(inventory);
        Set<String> specificationKeys = property.results()
                .map(result -> result.group(1))
                .collect(Collectors.toSet());
        assertEquals(abnfKeys, specificationKeys);

        String selfSchema = Files.readString(fixture("toml-schema.tosd"), StandardCharsets.UTF_8);
        Matcher keyPattern = Pattern.compile("(?m)^keypattern = '\\^\\(([^)]*)\\)")
                .matcher(selfSchema);
        if (!keyPattern.find()) {
            throw new AssertionError("self-schema escaped-children keypattern not found");
        }
        Set<String> selfSchemaKeys = Arrays.stream(keyPattern.group(1).split("\\|"))
                .filter(key -> !key.equals("children"))
                .collect(Collectors.toSet());
        assertEquals(abnfKeys, selfSchemaKeys);
    }

    @Test
    void schemaTypesMatchAbnfBuiltInTypes() throws IOException {
        String abnf = readAbnf();
        Set<String> implementationTypes = Arrays.stream(SchemaType.values())
                .map(SchemaType::schemaName)
                .collect(Collectors.toSet());
        assertEquals(implementationTypes, builtInTypeTokens(abnf));
    }

    private Set<String> alternativesFor(String ruleName, String abnf) {
        String expression = ruleExpression(ruleName, abnf);
        return Arrays.stream(expression.split("/"))
                .map(String::trim)
                .filter(token -> !token.isEmpty())
                .filter(token -> !NON_SCHEMA_KEYS.contains(token))
                .collect(Collectors.toSet());
    }

    private String ruleExpression(String ruleName, String abnf) {
        String[] lines = abnf.split("\\R");
        StringBuilder expression = new StringBuilder();
        boolean inRule = false;
        Pattern ruleStart = Pattern.compile("^" + Pattern.quote(ruleName) + "\\s*=\\s*(.*)$");
        for (String line : lines) {
            Matcher rule = ruleStart.matcher(line);
            if (rule.matches()) {
                expression.append(rule.group(1).trim());
                inRule = true;
                continue;
            }
            if (inRule) {
                if (line.startsWith(" ") || line.startsWith("\t")) {
                    expression.append(' ').append(line.trim());
                    continue;
                }
                break;
            }
        }
        return expression.toString();
    }

    private Set<String> builtInTypeTokens(String abnf) {
        return Arrays.stream(ruleExpression("built-in-type", abnf).split("/"))
                .map(String::trim)
                .map(typeRule -> ruleExpression(typeRule, abnf))
                .map(QUOTED_TOKEN::matcher)
                .filter(Matcher::find)
                .map(matcher -> matcher.group(1))
                .collect(Collectors.toSet());
    }

    private String readAbnf() throws IOException {
        return Files.readString(fixture("toml-schema.abnf"), StandardCharsets.UTF_8);
    }

    private Path fixture(String fileName) {
        Path fromRepositoryRoot = Path.of(fileName);
        if (Files.exists(fromRepositoryRoot)) {
            return fromRepositoryRoot;
        }
        return Path.of("..", "..", fileName);
    }
}
