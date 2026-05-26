package org.tomlschema;

public record ValidationError(String path, String message) {
    @Override
    public String toString() {
        return path + ": " + message;
    }
}
