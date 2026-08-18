package org.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlArray;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.io.IOException;
import java.io.PrintStream;
import java.net.URI;
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
        Object metadataValue = document.get(List.of("toml-schema"));
        if (!(metadataValue instanceof TomlTable metadata)) {
            err.println("Document must contain a [toml-schema] table");
            return 2;
        }
        for (String key : metadata.keySet()) {
            if (!isSchemaReferenceScalar(metadata.get(key))) {
                err.printf("Document [toml-schema].%s must be a scalar value%n", key);
                return 2;
            }
        }
        Object locationValue = metadata.get("location");
        if (!(locationValue instanceof String location) || location.isBlank()) {
            err.println("Document [toml-schema].location must be a non-empty string");
            return 2;
        }

        Path schemaPath = resolveSchemaPath(tomlPath, location);
        TomlSchema schema = TomlSchema.load(schemaPath);
        if (metadata.contains("version")) {
            TomlSchemaVersion.Version expected = TomlSchemaVersion.parseDocumentVersion(metadata.get("version"));
            TomlSchemaVersion.Version actual = TomlSchemaVersion.validate(schema.version());
            if (!expected.major().equals(actual.major())) {
                err.printf(
                        "Document expects TOML Schema major version %s, but resolved schema uses %s%n",
                        expected.value(),
                        actual.value());
                return 2;
            }
            if (!expected.value().equals(actual.value())) {
                err.printf(
                        "Warning: document expects TOML Schema version %s, but resolved schema uses %s%n",
                        expected.value(),
                        actual.value());
            }
        }
        return validate(schema, document, tomlPath, out, err);
    }

    private static boolean isSchemaReferenceScalar(Object value) {
        return value instanceof String
                || value instanceof Long
                || value instanceof Double
                || value instanceof Boolean
                || value instanceof OffsetDateTime
                || value instanceof LocalDateTime
                || value instanceof LocalDate
                || value instanceof LocalTime;
    }

    private static Path resolveSchemaPath(Path tomlPath, String location) {
        URI reference;
        try {
            reference = URI.create(location);
        } catch (IllegalArgumentException e) {
            throw new SchemaException("Invalid [toml-schema].location URI: " + location, e);
        }
        if (reference.isOpaque() && "file".equalsIgnoreCase(reference.getScheme())) {
            throw new SchemaException("Invalid file schema location: " + location);
        }
        URI resolved = tomlPath.toAbsolutePath().toUri().resolve(reference);
        if (!"file".equalsIgnoreCase(resolved.getScheme())) {
            throw new SchemaException("Unsupported schema location URI scheme: " + resolved.getScheme());
        }
        try {
            return Path.of(resolved).normalize();
        } catch (IllegalArgumentException e) {
            throw new SchemaException("Invalid file schema location: " + location, e);
        }
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
        schema.append("version = \"").append(TomlSchemaVersion.CURRENT).append("\"\n\n");
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
            schema.append("itemtype = \"").append(inferArrayType(array)).append("\"\n");
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
