package io.github.brunoborges.tomlschema;

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
    private static final Pattern TOKEN_COMMENT = Pattern.compile(";\\s*\"([^\"]+)\"");
    private static final Set<String> NON_SCHEMA_KEYS = Set.of("version");

    @Test
    void schemaLoaderDefinitionKeysMatchAbnfSchemaKeys() throws IOException {
        String abnf = readAbnf();

        assertEquals(SchemaLoader.DEFINITION_KEYS, alternativesFor("schema-key", abnf));
    }

    @Test
    void schemaTypesMatchAbnfBuiltInTypes() throws IOException {
        String abnf = readAbnf();
        Set<String> implementationTypes = Arrays.stream(SchemaType.values())
                .map(SchemaType::schemaName)
                .collect(Collectors.toSet());
        implementationTypes.add("table-collection");

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
        for (String line : lines) {
            if (line.startsWith(ruleName + " =")) {
                expression.append(line.substring(line.indexOf('=') + 1).trim());
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
        return abnf.lines()
                .map(TOKEN_COMMENT::matcher)
                .filter(Matcher::find)
                .map(matcher -> matcher.group(1))
                .filter(token -> SchemaLoader.DEFINITION_KEYS.stream().noneMatch(token::equals))
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
