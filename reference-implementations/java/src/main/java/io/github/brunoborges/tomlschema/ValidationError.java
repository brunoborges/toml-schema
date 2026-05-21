package io.github.brunoborges.tomlschema;

public record ValidationError(String path, String message) {
    @Override
    public String toString() {
        return path + ": " + message;
    }
}
