package org.tomlschema;

/**
 * Encodes instance-path and schema-path segments per SPEC.md's {@code ### Instance Path}
 * grammar. A segment is written literally when it is non-empty and consists only of ASCII
 * letters, digits, {@code _}, or {@code -}; otherwise it is written as an RFC 8259 JSON
 * string with the control-character escapes the specification enumerates.
 */
final class PathEncoding {
    private PathEncoding() {
    }

    /**
     * Encodes a decoded key {@code K} as {@code EncodeKey(K)}.
     *
     * @param key the decoded TOML key or schema key
     * @return the encoded path segment
     */
    static String encodeKey(String key) {
        if (!key.isEmpty() && isBare(key)) {
            return key;
        }
        StringBuilder builder = new StringBuilder(key.length() + 2);
        builder.append('"');
        for (int index = 0; index < key.length(); ) {
            int codePoint = key.codePointAt(index);
            index += Character.charCount(codePoint);
            switch (codePoint) {
                case '"' -> builder.append("\\\"");
                case '\\' -> builder.append("\\\\");
                case 0x08 -> builder.append("\\b");
                case 0x09 -> builder.append("\\t");
                case 0x0A -> builder.append("\\n");
                case 0x0C -> builder.append("\\f");
                case 0x0D -> builder.append("\\r");
                default -> {
                    if (codePoint <= 0x1F) {
                        builder.append(String.format("\\u%04x", codePoint));
                    } else {
                        builder.appendCodePoint(codePoint);
                    }
                }
            }
        }
        builder.append('"');
        return builder.toString();
    }

    private static boolean isBare(String key) {
        for (int index = 0; index < key.length(); index++) {
            char current = key.charAt(index);
            boolean allowed = (current >= 'A' && current <= 'Z')
                    || (current >= 'a' && current <= 'z')
                    || (current >= '0' && current <= '9')
                    || current == '_' || current == '-';
            if (!allowed) {
                return false;
            }
        }
        return true;
    }
}
