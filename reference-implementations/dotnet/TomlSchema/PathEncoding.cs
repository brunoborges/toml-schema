namespace TomlSchema;

using System.Globalization;
using System.Text;

/// <summary>
/// Encodes instance-path and schema-path segments per SPEC.md's <c>### Instance Path</c>
/// grammar. A segment is written literally when it is non-empty and consists only of ASCII
/// letters, digits, <c>_</c>, or <c>-</c>; otherwise it is written as an RFC 8259 JSON
/// string with the control-character escapes the specification enumerates.
/// </summary>
public static class PathEncoding
{
    /// <summary>Encodes a decoded key <c>K</c> as <c>EncodeKey(K)</c>.</summary>
    /// <param name="key">The decoded TOML key or schema key.</param>
    /// <returns>The encoded path segment.</returns>
    public static string EncodeKey(string key)
    {
        if (key.Length > 0 && IsBare(key))
        {
            return key;
        }

        var builder = new StringBuilder(key.Length + 2);
        builder.Append('"');
        foreach (var rune in key.EnumerateRunes())
        {
            switch (rune.Value)
            {
                case '"':
                    builder.Append("\\\"");
                    break;
                case '\\':
                    builder.Append("\\\\");
                    break;
                case 0x08:
                    builder.Append("\\b");
                    break;
                case 0x09:
                    builder.Append("\\t");
                    break;
                case 0x0A:
                    builder.Append("\\n");
                    break;
                case 0x0C:
                    builder.Append("\\f");
                    break;
                case 0x0D:
                    builder.Append("\\r");
                    break;
                default:
                    if (rune.Value <= 0x1F)
                    {
                        builder.Append("\\u");
                        builder.Append(rune.Value.ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        builder.Append(rune.ToString());
                    }

                    break;
            }
        }

        builder.Append('"');
        return builder.ToString();
    }

    /// <summary>Appends a decoded child key to a path with the <c>.</c> separator.</summary>
    public static string AppendKey(string path, string key) => path + "." + EncodeKey(key);

    /// <summary>Appends a zero-based array index to a path as <c>[i]</c>.</summary>
    public static string AppendIndex(string path, int index) =>
        path + "[" + index.ToString(CultureInfo.InvariantCulture) + "]";

    private static bool IsBare(string key)
    {
        foreach (var current in key)
        {
            var allowed = current is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z')
                or (>= '0' and <= '9') or '_' or '-';
            if (!allowed)
            {
                return false;
            }
        }

        return true;
    }
}
