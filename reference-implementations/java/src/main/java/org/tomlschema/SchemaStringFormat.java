package org.tomlschema;

import java.util.Set;

enum SchemaStringFormat {
    EMAIL("email"),
    UUID("uuid"),
    URI("uri"),
    HOSTNAME("hostname"),
    IPV4("ipv4"),
    IPV6("ipv6");

    private static final Set<Character> ATEXT_PUNCTUATION =
            Set.of('!', '#', '$', '%', '&', '\'', '*', '+', '-', '/', '=',
                    '?', '^', '_', '`', '{', '|', '}', '~');

    private final String schemaName;

    SchemaStringFormat(String schemaName) {
        this.schemaName = schemaName;
    }

    static SchemaStringFormat fromSchemaName(String value) {
        for (SchemaStringFormat format : values()) {
            if (format.schemaName.equals(value)) {
                return format;
            }
        }
        throw new SchemaException("Unsupported string format: " + value);
    }

    String schemaName() {
        return schemaName;
    }

    boolean isValid(String value) {
        return switch (this) {
            case EMAIL -> isEmail(value);
            case UUID -> isUuid(value);
            case URI -> isUri(value);
            case HOSTNAME -> isHostname(value, true);
            case IPV4 -> isIpv4(value);
            case IPV6 -> isIpv6(value);
        };
    }

    private static boolean isEmail(String value) {
        if (!isAscii(value) || value.length() > 254) {
            return false;
        }
        int at = mailboxAt(value);
        if (at <= 0 || at > 64 || at == value.length() - 1) {
            return false;
        }
        String local = value.substring(0, at);
        String domain = value.substring(at + 1);
        return isLocalPart(local) && (isHostname(domain, false) || isAddressLiteral(domain));
    }

    private static int mailboxAt(String value) {
        boolean quoted = false;
        boolean escaped = false;
        int at = -1;
        for (int i = 0; i < value.length(); i++) {
            char current = value.charAt(i);
            if (escaped) {
                escaped = false;
            } else if (quoted && current == '\\') {
                escaped = true;
            } else if (current == '"') {
                quoted = !quoted;
            } else if (current == '@' && !quoted) {
                if (at >= 0) {
                    return -1;
                }
                at = i;
            }
        }
        return quoted || escaped ? -1 : at;
    }

    private static boolean isLocalPart(String value) {
        if (value.startsWith("\"")) {
            if (value.length() < 2 || !value.endsWith("\"")) {
                return false;
            }
            for (int i = 1; i < value.length() - 1; i++) {
                char current = value.charAt(i);
                if (current == '\\') {
                    if (++i >= value.length() - 1 || !isPrintableAscii(value.charAt(i))) {
                        return false;
                    }
                } else if (current == '"' || current < 32 || current > 126) {
                    return false;
                }
            }
            return true;
        }
        String[] atoms = value.split("\\.", -1);
        if (atoms.length == 0) {
            return false;
        }
        for (String atom : atoms) {
            if (atom.isEmpty()) {
                return false;
            }
            for (int i = 0; i < atom.length(); i++) {
                char current = atom.charAt(i);
                if (!isAsciiLetterOrDigit(current) && !ATEXT_PUNCTUATION.contains(current)) {
                    return false;
                }
            }
        }
        return true;
    }

    private static boolean isAddressLiteral(String value) {
        if (value.length() < 3 || value.charAt(0) != '[' || value.charAt(value.length() - 1) != ']') {
            return false;
        }
        String literal = value.substring(1, value.length() - 1);
        if (isIpv4(literal)) {
            return true;
        }
        if (literal.regionMatches(true, 0, "IPv6:", 0, 5)) {
            return isIpv6(literal.substring(5));
        }
        int colon = literal.indexOf(':');
        if (colon <= 0 || colon == literal.length() - 1) {
            return false;
        }
        String tag = literal.substring(0, colon);
        if (!isAsciiLetterOrDigit(tag.charAt(tag.length() - 1))) {
            return false;
        }
        for (int i = 0; i < tag.length(); i++) {
            char current = tag.charAt(i);
            if (!isAsciiLetterOrDigit(current) && current != '-') {
                return false;
            }
        }
        for (int i = colon + 1; i < literal.length(); i++) {
            char current = literal.charAt(i);
            if (current < 33 || current > 126
                    || current == '[' || current == '\\' || current == ']') {
                return false;
            }
        }
        return true;
    }

    private static boolean isUuid(String value) {
        int[] hyphens = {8, 13, 18, 23};
        if (value.length() != 36) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            boolean hyphen = false;
            for (int position : hyphens) {
                hyphen |= i == position;
            }
            if (hyphen ? value.charAt(i) != '-' : !isAsciiHex(value.charAt(i))) {
                return false;
            }
        }
        return true;
    }

    private static boolean isUri(String value) {
        if (value.isEmpty() || !isAscii(value)) {
            return false;
        }
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            if (current <= 32 || current == 127) {
                return false;
            }
        }
        int colon = value.indexOf(':');
        if (colon <= 0 || !isAsciiLetter(value.charAt(0))) {
            return false;
        }
        for (int index = 1; index < colon; index++) {
            char current = value.charAt(index);
            if (!isAsciiLetterOrDigit(current) && current != '+' && current != '-' && current != '.') {
                return false;
            }
        }

        String remainder = value.substring(colon + 1);
        int hash = remainder.indexOf('#');
        if (hash >= 0) {
            if (!matchesUriComponent(remainder.substring(hash + 1), ":@/?")) {
                return false;
            }
            remainder = remainder.substring(0, hash);
        }
        int question = remainder.indexOf('?');
        if (question >= 0) {
            if (!matchesUriComponent(remainder.substring(question + 1), ":@/?")) {
                return false;
            }
            remainder = remainder.substring(0, question);
        }

        if (remainder.startsWith("//")) {
            int slash = remainder.indexOf('/', 2);
            String authority = slash < 0 ? remainder.substring(2) : remainder.substring(2, slash);
            String path = slash < 0 ? "" : remainder.substring(slash);
            return isUriAuthority(authority) && matchesUriComponent(path, ":@/");
        }
        return matchesUriComponent(remainder, ":@/");
    }

    private static boolean isUriAuthority(String authority) {
        int at = authority.lastIndexOf('@');
        String hostPort = at < 0 ? authority : authority.substring(at + 1);
        if (at >= 0 && !matchesUriComponent(authority.substring(0, at), ":")) {
            return false;
        }
        if (hostPort.startsWith("[")) {
            int close = hostPort.indexOf(']');
            if (close < 0 || !isUriPort(hostPort.substring(close + 1))) {
                return false;
            }
            String literal = hostPort.substring(1, close);
            return isIpv6(literal) || isIpvFuture(literal);
        }
        int colon = hostPort.lastIndexOf(':');
        if (colon >= 0) {
            if (hostPort.indexOf(':') != colon || !isUriPort(hostPort.substring(colon))) {
                return false;
            }
            hostPort = hostPort.substring(0, colon);
        }
        return matchesUriComponent(hostPort, "");
    }

    private static boolean isUriPort(String value) {
        if (value.isEmpty()) {
            return true;
        }
        if (value.charAt(0) != ':') {
            return false;
        }
        for (int index = 1; index < value.length(); index++) {
            if (value.charAt(index) < '0' || value.charAt(index) > '9') {
                return false;
            }
        }
        return true;
    }

    private static boolean isIpvFuture(String value) {
        if (value.length() < 4 || value.charAt(0) != 'v' && value.charAt(0) != 'V') {
            return false;
        }
        int dot = value.indexOf('.', 1);
        if (dot <= 1 || dot == value.length() - 1) {
            return false;
        }
        for (int index = 1; index < dot; index++) {
            if (!isAsciiHex(value.charAt(index))) {
                return false;
            }
        }
        for (int index = dot + 1; index < value.length(); index++) {
            char current = value.charAt(index);
            if (!isUriUnreserved(current) && !isUriSubDelimiter(current) && current != ':') {
                return false;
            }
        }
        return true;
    }

    private static boolean matchesUriComponent(String value, String extra) {
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            if (current == '%') {
                if (index + 2 >= value.length()
                        || !isAsciiHex(value.charAt(index + 1))
                        || !isAsciiHex(value.charAt(index + 2))) {
                    return false;
                }
                index += 2;
            } else if (!isUriUnreserved(current)
                    && !isUriSubDelimiter(current)
                    && extra.indexOf(current) < 0) {
                return false;
            }
        }
        return true;
    }

    private static boolean isUriUnreserved(char value) {
        return isAsciiLetterOrDigit(value) || value == '-' || value == '.'
                || value == '_' || value == '~';
    }

    private static boolean isUriSubDelimiter(char value) {
        return "!$&'()*+,;=".indexOf(value) >= 0;
    }

    private static boolean isHostname(String value, boolean allowFinalDot) {
        String hostname = value;
        if (allowFinalDot && hostname.endsWith(".")) {
            hostname = hostname.substring(0, hostname.length() - 1);
        }
        if (hostname.isEmpty() || hostname.length() > 253 || !isAscii(hostname)) {
            return false;
        }
        String[] labels = hostname.split("\\.", -1);
        for (String label : labels) {
            if (label.isEmpty() || label.length() > 63
                    || !isAsciiLetterOrDigit(label.charAt(0))
                    || !isAsciiLetterOrDigit(label.charAt(label.length() - 1))) {
                return false;
            }
            for (int i = 1; i < label.length() - 1; i++) {
                char current = label.charAt(i);
                if (!isAsciiLetterOrDigit(current) && current != '-') {
                    return false;
                }
            }
        }
        return true;
    }

    private static boolean isIpv4(String value) {
        String[] octets = value.split("\\.", -1);
        if (octets.length != 4) {
            return false;
        }
        for (String octet : octets) {
            if (octet.isEmpty() || octet.length() > 3
                    || octet.length() > 1 && octet.charAt(0) == '0') {
                return false;
            }
            int number = 0;
            for (int i = 0; i < octet.length(); i++) {
                char current = octet.charAt(i);
                if (current < '0' || current > '9') {
                    return false;
                }
                number = number * 10 + current - '0';
            }
            if (number > 255) {
                return false;
            }
        }
        return true;
    }

    private static boolean isIpv6(String value) {
        if (value.isEmpty() || value.indexOf('%') >= 0) {
            return false;
        }
        int compression = value.indexOf("::");
        if (compression >= 0 && value.indexOf("::", compression + 2) >= 0) {
            return false;
        }
        if (compression < 0) {
            if (value.startsWith(":") || value.endsWith(":")) {
                return false;
            }
            return ipv6Units(value, true) == 8;
        }
        String left = value.substring(0, compression);
        String right = value.substring(compression + 2);
        int leftUnits = ipv6Units(left, false);
        int rightUnits = ipv6Units(right, true);
        return leftUnits >= 0 && rightUnits >= 0 && leftUnits + rightUnits < 8;
    }

    private static int ipv6Units(String side, boolean mayContainIpv4) {
        if (side.isEmpty()) {
            return 0;
        }
        String[] groups = side.split(":", -1);
        int units = 0;
        for (int i = 0; i < groups.length; i++) {
            String group = groups[i];
            if (group.isEmpty()) {
                return -1;
            }
            if (group.indexOf('.') >= 0) {
                if (!mayContainIpv4 || i != groups.length - 1 || !isIpv4(group)) {
                    return -1;
                }
                units += 2;
            } else {
                if (group.length() > 4) {
                    return -1;
                }
                for (int j = 0; j < group.length(); j++) {
                    if (!isAsciiHex(group.charAt(j))) {
                        return -1;
                    }
                }
                units++;
            }
        }
        return units;
    }

    private static boolean isAscii(String value) {
        for (int i = 0; i < value.length(); i++) {
            if (value.charAt(i) > 127) {
                return false;
            }
        }
        return true;
    }

    private static boolean isPrintableAscii(char value) {
        return value >= 32 && value <= 126;
    }

    private static boolean isAsciiLetterOrDigit(char value) {
        return isAsciiLetter(value)
                || value >= '0' && value <= '9';
    }

    private static boolean isAsciiLetter(char value) {
        return value >= 'a' && value <= 'z'
                || value >= 'A' && value <= 'Z';
    }

    private static boolean isAsciiHex(char value) {
        return value >= '0' && value <= '9'
                || value >= 'a' && value <= 'f'
                || value >= 'A' && value <= 'F';
    }
}
