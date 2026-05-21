package io.github.brunoborges.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Path;

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
        if (!args[0].equals("validate")) {
            err.println("Unknown command: " + args[0]);
            usage(err);
            return 2;
        }
        try {
            return switch (args.length) {
                case 2 -> validateWithEmbeddedSchema(Path.of(args[1]), out, err);
                case 3 -> validate(Path.of(args[1]), Path.of(args[2]), out, err);
                default -> {
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

    private static void usage(PrintStream stream) {
        stream.println("Usage:");
        stream.println("  toml-schema validate <schema.tosd> <document.toml>");
        stream.println("  toml-schema validate <document.toml>");
    }
}
