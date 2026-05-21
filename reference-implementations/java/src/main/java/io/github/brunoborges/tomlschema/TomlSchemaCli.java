package io.github.brunoborges.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlArray;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

public final class TomlSchemaCli {
    private TomlSchemaCli() {
    }

    public static void main(String[] args) {
        int exitCode = run(args, System.out, System.err);
        if (exitCode != 0) {
            System.exit(exitCode);
        }
    }

    static int run(String[] args, PrintStream out, PrintStream err) {
        if (args.length == 0 || args[0].equals("--help") || args[0].equals("-h")) {
            usage(out);
            return 0;
        }
        try {
            return switch (args[0]) {
                case "validate" -> switch (args.length) {
                    case 2 -> validateWithEmbeddedSchema(Path.of(args[1]), out, err);
                    case 3 -> validate(Path.of(args[1]), Path.of(args[2]), out, err);
                    default -> {
                        usage(err);
                        yield 2;
                    }
                };
                case "extract" -> {
                    if (args.length != 3) {
                        usage(err);
                        yield 2;
                    }
                    yield extract(Path.of(args[1]), Path.of(args[2]), out, err);
                }
                default -> {
                    err.println("Unknown command: " + args[0]);
                    usage(err);
                    yield 2;
                }
            };
        } catch (IOException | SchemaException e) {
            err.println(e.getMessage());
            return 2;
        }
    }

    private static int validateWithEmbeddedSchema(Path tomlPath, PrintStream out, PrintStream err) throws IOException {
        TomlParseResult document = Toml.parse(tomlPath);
        if (document.hasErrors()) {
            document.errors().forEach(error -> err.println(error.toString()));
            return 1;
        }
        TomlTable metadata = document.getTable("toml-schema");
        if (metadata == null) {
            err.println("Document does not contain [toml-schema].location");
            return 2;
        }
        String location = metadata.getString("location");
        if (location == null || location.isBlank()) {
            err.println("Document does not contain [toml-schema].location");
            return 2;
        }
        Path schemaPath = tomlPath.toAbsolutePath().getParent().resolve(location).normalize();
        return validate(TomlSchema.load(schemaPath), document, tomlPath, out, err);
    }

    private static int validate(Path schemaPath, Path tomlPath, PrintStream out, PrintStream err) throws IOException {
        return validate(TomlSchema.load(schemaPath), tomlPath, out, err);
    }

    private static int validate(TomlSchema schema, Path tomlPath, PrintStream out, PrintStream err) throws IOException {
        ValidationResult result = schema.validate(tomlPath);
        return report(result, tomlPath, out, err);
    }

    private static int validate(TomlSchema schema, TomlParseResult document, Path tomlPath, PrintStream out, PrintStream err) {
        ValidationResult result = schema.validate(document);
        return report(result, tomlPath, out, err);
    }

    private static int report(ValidationResult result, Path tomlPath, PrintStream out, PrintStream err) {
        if (result.isValid()) {
            out.println(tomlPath + " is valid");
            return 0;
        }
        err.println(tomlPath + " is invalid:");
        result.errors().forEach(error -> err.println("  - " + error));
        return 1;
    }

    private static int extract(Path tomlPath, Path schemaPath, PrintStream out, PrintStream err) throws IOException {
        TomlParseResult document = Toml.parse(tomlPath);
        if (document.hasErrors()) {
            document.errors().forEach(error -> err.println(error.toString()));
            return 1;
        }
        String schema = generateSchema(document);
        Files.writeString(schemaPath, schema, StandardCharsets.UTF_8);
        out.println("Extracted schema to " + schemaPath);
        return 0;
    }

    private static String generateSchema(TomlTable document) {
        StringBuilder schema = new StringBuilder();
        schema.append("[toml-schema]\n");
        schema.append("version = \"1\"\n\n");
        schema.append("[elements]\n");
        for (String key : document.keySet()) {
            if ("toml-schema".equals(key)) {
                continue;
            }
            appendDefinition(schema, List.of("elements", key), document.get(key));
        }
        return schema.toString();
    }

    private static void appendDefinition(StringBuilder schema, List<String> path, Object value) {
        schema.append("\n[")
                .append(path.stream().map(TomlSchemaCli::encodeTomlKey).collect(Collectors.joining(".")))
                .append("]\n");
        String type = schemaType(value);
        schema.append("type = \"").append(type).append("\"\n");
        if ("array".equals(type) && value instanceof TomlArray array) {
            schema.append("arraytype = \"").append(inferArrayType(array)).append("\"\n");
        }
        if (value instanceof TomlTable table) {
            for (String childKey : table.keySet()) {
                List<String> childPath = new ArrayList<>(path);
                childPath.add(childKey);
                appendDefinition(schema, childPath, table.get(childKey));
            }
        }
    }

    private static String schemaType(Object value) {
        return switch (value) {
            case String _ -> "string";
            case Long _ -> "integer";
            case Double _ -> "float";
            case Boolean _ -> "boolean";
            case OffsetDateTime _ -> "offset-date-time";
            case LocalDateTime _ -> "local-date-time";
            case LocalDate _ -> "local-date";
            case LocalTime _ -> "local-time";
            case TomlArray _ -> "array";
            case TomlTable _ -> "table";
            default -> "any";
        };
    }

    private static String inferArrayType(TomlArray array) {
        if (array.isEmpty()) {
            return "any";
        }
        String firstType = schemaType(array.get(0));
        for (int i = 1; i < array.size(); i++) {
            if (!firstType.equals(schemaType(array.get(i)))) {
                return "any";
            }
        }
        return firstType;
    }

    private static String encodeTomlKey(String key) {
        if (key.matches("^[A-Za-z0-9_-]+$")) {
            return key;
        }
        StringBuilder encoded = new StringBuilder("\"");
        for (int i = 0; i < key.length(); i++) {
            char current = key.charAt(i);
            switch (current) {
                case '\\' -> encoded.append("\\\\");
                case '"' -> encoded.append("\\\"");
                case '\b' -> encoded.append("\\b");
                case '\t' -> encoded.append("\\t");
                case '\n' -> encoded.append("\\n");
                case '\f' -> encoded.append("\\f");
                case '\r' -> encoded.append("\\r");
                default -> {
                    if (current < 0x20) {
                        encoded.append(String.format("\\u%04X", (int) current));
                    } else {
                        encoded.append(current);
                    }
                }
            }
        }
        return encoded.append("\"").toString();
    }

    private static void usage(PrintStream stream) {
        stream.println("Usage:");
        stream.println("  toml-schema validate <schema.tosd> <document.toml>");
        stream.println("  toml-schema validate <document.toml>");
        stream.println("  toml-schema extract <document.toml> <schema.tosd>");
    }
}
