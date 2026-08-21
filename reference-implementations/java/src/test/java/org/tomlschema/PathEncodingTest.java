package org.tomlschema;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/**
 * Pins the path-segment encoding from SPEC.md {@code ### Instance Path}, including the
 * normative lowercase hex digits. The conformance corpus does not exercise control
 * characters, so this guards the profile directly.
 */
class PathEncodingTest {

    @Test
    void encodesKeysPerRfc8259Profile() {
        assertEquals("port", PathEncoding.encodeKey("port"));
        assertEquals("a-b_9", PathEncoding.encodeKey("a-b_9"));
        assertEquals("\"\"", PathEncoding.encodeKey(""));
        assertEquals("\"google.com\"", PathEncoding.encodeKey("google.com"));
        assertEquals("\"a b\"", PathEncoding.encodeKey("a b"));
        assertEquals("\"a\\\"b\"", PathEncoding.encodeKey("a\"b"));
        assertEquals("\"a\\\\b\"", PathEncoding.encodeKey("a\\b"));
        assertEquals("\"\\b\"", PathEncoding.encodeKey("\b"));
        assertEquals("\"\\t\"", PathEncoding.encodeKey("\t"));
        assertEquals("\"\\n\"", PathEncoding.encodeKey("\n"));
        assertEquals("\"\\f\"", PathEncoding.encodeKey("\f"));
        assertEquals("\"\\r\"", PathEncoding.encodeKey("\r"));
        assertEquals("\"\\u0001\"", PathEncoding.encodeKey("\u0001"));
        assertEquals("\"\\u001f\"", PathEncoding.encodeKey("\u001f"));
        assertEquals("\"café\"", PathEncoding.encodeKey("café"));
    }
}
