namespace TomlSchema;

using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;

internal static partial class StringFormatValidator
{
    private static readonly HashSet<string> Supported =
        ["email", "uuid", "uri", "hostname", "ipv4", "ipv6"];

    public static bool IsSupported(string format) => Supported.Contains(format);

    public static bool IsValid(string format, string value) => format switch
    {
        "email" => IsEmail(value),
        "uuid" => UuidPattern().IsMatch(value),
        "uri" => IsUri(value),
        "hostname" => IsHostname(value),
        "ipv4" => IsIpv4(value),
        "ipv6" => IsIpv6(value),
        _ => false
    };

    private static bool IsEmail(string value)
    {
        if (!IsAscii(value) || value.Length > 254)
            return false;

        var at = FindMailboxSeparator(value);
        if (at <= 0 || at == value.Length - 1)
            return false;

        var local = value[..at];
        var domain = value[(at + 1)..];
        return local.Length <= 64
            && (IsDotString(local) || IsQuotedString(local))
            && IsEmailDomain(domain);
    }

    private static int FindMailboxSeparator(string value)
    {
        var quoted = false;
        var escaped = false;
        var separator = -1;
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            if (escaped)
            {
                escaped = false;
                continue;
            }
            if (quoted && c == '\\')
            {
                escaped = true;
                continue;
            }
            if (c == '"')
                quoted = !quoted;
            else if (c == '@' && !quoted)
            {
                if (separator >= 0)
                    return -1;
                separator = i;
            }
        }
        return quoted || escaped ? -1 : separator;
    }

    private static bool IsDotString(string local) =>
        local.Length > 0
        && local[0] != '.'
        && local[^1] != '.'
        && !local.Contains("..", StringComparison.Ordinal)
        && local.All(c => char.IsAsciiLetterOrDigit(c)
            || "!#$%&'*+-/=?^_`{|}~.".Contains(c));

    private static bool IsQuotedString(string local)
    {
        if (local.Length < 2 || local[0] != '"' || local[^1] != '"')
            return false;
        for (var i = 1; i < local.Length - 1; i++)
        {
            var c = local[i];
            if (c == '\\')
            {
                if (++i >= local.Length - 1 || local[i] is < (char)32 or > (char)126)
                    return false;
            }
            else if (c is < (char)32 or > (char)126 || c is '"' or '\\')
                return false;
        }
        return true;
    }

    private static bool IsEmailDomain(string domain)
    {
        if (domain.Length >= 2 && domain[0] == '[' && domain[^1] == ']')
        {
            var literal = domain[1..^1];
            if (IsIpv4(literal))
                return true;
            if (literal.StartsWith("IPv6:", StringComparison.OrdinalIgnoreCase))
                return IsIpv6(literal[5..]);

            var colon = literal.IndexOf(':');
            return colon > 0
                && char.IsAsciiLetterOrDigit(literal[0])
                && char.IsAsciiLetterOrDigit(literal[colon - 1])
                && literal[..colon].All(c => char.IsAsciiLetterOrDigit(c) || c == '-')
                && literal[(colon + 1)..].Length > 0
                && literal[(colon + 1)..].All(c => c is >= (char)33 and <= (char)90
                    || c is >= (char)94 and <= (char)126);
        }
        return IsHostname(domain, allowTrailingDot: false);
    }

    private static bool IsUri(string value)
    {
        if (value.Length == 0 || !IsAscii(value) || value.Count(c => c == '#') > 1
            || value.Any(c => !IsUriCharacter(c)))
            return false;

        for (var i = 0; i < value.Length; i++)
        {
            if (value[i] != '%')
                continue;
            if (i + 2 >= value.Length || !char.IsAsciiHexDigit(value[i + 1])
                || !char.IsAsciiHexDigit(value[i + 2]))
                return false;
            i += 2;
        }

        var colon = value.IndexOf(':');
        if (colon <= 0 || !char.IsAsciiLetter(value[0])
            || !value[1..colon].All(c => char.IsAsciiLetterOrDigit(c) || c is '+' or '-' or '.'))
            return false;

        return IsAbsoluteUri(value, value[..colon])
            || TryNormalizeIpvFuture(value, out var normalized)
                && IsAbsoluteUri(normalized, value[..colon]);
    }

    private static bool IsAbsoluteUri(string value, string scheme) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.IsAbsoluteUri
        && string.Equals(uri.Scheme, scheme, StringComparison.OrdinalIgnoreCase);

    private static bool TryNormalizeIpvFuture(string value, out string normalized)
    {
        normalized = "";
        var schemeEnd = value.IndexOf(':');
        if (schemeEnd < 0 || !value.AsSpan(schemeEnd + 1).StartsWith("//"))
            return false;
        var authorityStart = schemeEnd + 3;
        var authorityEnd = value.IndexOfAny(['/', '?', '#'], authorityStart);
        if (authorityEnd < 0)
            authorityEnd = value.Length;
        var at = value.LastIndexOf('@', authorityEnd - 1, authorityEnd - authorityStart);
        var hostStart = at >= authorityStart ? at + 1 : authorityStart;
        if (hostStart >= authorityEnd || value[hostStart] != '[')
            return false;
        var close = value.IndexOf(']', hostStart + 1);
        if (close < 0 || close >= authorityEnd || !IsIpvFuture(value[(hostStart + 1)..close]))
            return false;
        normalized = string.Concat(value.AsSpan(0, hostStart + 1), "::1", value.AsSpan(close));
        return true;
    }

    private static bool IsIpvFuture(string value)
    {
        if (value.Length < 4 || value[0] is not ('v' or 'V'))
            return false;
        var dot = value.IndexOf('.', 1);
        return dot > 1
            && dot < value.Length - 1
            && value[1..dot].All(char.IsAsciiHexDigit)
            && value[(dot + 1)..].All(c => char.IsAsciiLetterOrDigit(c)
                || "-._~!$&'()*+,;=:".Contains(c));
    }

    private static bool IsHostname(string value, bool allowTrailingDot = true)
    {
        if (!IsAscii(value) || value.Length == 0)
            return false;
        var hostname = allowTrailingDot && value.EndsWith('.') ? value[..^1] : value;
        if (hostname.Length == 0 || hostname.Length > 253)
            return false;

        return hostname.Split('.').All(label =>
            label.Length is >= 1 and <= 63
            && char.IsAsciiLetterOrDigit(label[0])
            && char.IsAsciiLetterOrDigit(label[^1])
            && label.All(c => char.IsAsciiLetterOrDigit(c) || c == '-'));
    }

    private static bool IsIpv4(string value)
    {
        var parts = value.Split('.');
        if (parts.Length != 4)
            return false;
        foreach (var part in parts)
        {
            if (part.Length == 0 || part.Length > 3
                || (part.Length > 1 && part[0] == '0')
                || !part.All(char.IsAsciiDigit)
                || !int.TryParse(part, out var octet) || octet > 255)
                return false;
        }
        return true;
    }

    private static bool IsIpv6(string value)
    {
        if (!value.Contains(':') || value.Contains('%') || !IsAscii(value))
            return false;
        if (value.Contains('.'))
        {
            var start = value.LastIndexOf(':') + 1;
            if (!IsIpv4(value[start..]))
                return false;
        }
        return IPAddress.TryParse(value, out var address)
            && address.AddressFamily == AddressFamily.InterNetworkV6;
    }

    private static bool IsAscii(string value) => value.All(c => c <= 127);
    private static bool IsUriCharacter(char c) =>
        char.IsAsciiLetterOrDigit(c) || "-._~:/?#[]@!$&'()*+,;=%".Contains(c);

    [GeneratedRegex("^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$")]
    private static partial Regex UuidPattern();
}
