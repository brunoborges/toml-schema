package io.github.brunoborges.tomlschema;

/**
 * Thrown when a TOML Schema document is malformed or cannot be loaded.
 */
public final class SchemaException extends RuntimeException {
    public SchemaException(String message) {
        super(message);
    }

    public SchemaException(String message, Throwable cause) {
        super(message, cause);
    }
}
