namespace TomlSchema.Tests;

using Xunit;

/// <summary>
/// Pins the path-segment encoding from SPEC.md <c>### Instance Path</c>, including the
/// normative lowercase hex digits. The conformance corpus does not exercise control
/// characters, so this guards the profile directly rather than relying on the corpus.
/// </summary>
public class PathEncodingTests
{
    [Fact]
    public void EncodesKeysPerRfc8259Profile()
    {
        Assert.Equal("port", PathEncoding.EncodeKey("port"));
        Assert.Equal("a-b_9", PathEncoding.EncodeKey("a-b_9"));
        Assert.Equal("\"\"", PathEncoding.EncodeKey(""));
        Assert.Equal("\"google.com\"", PathEncoding.EncodeKey("google.com"));
        Assert.Equal("\"a b\"", PathEncoding.EncodeKey("a b"));
        Assert.Equal("\"a\\\"b\"", PathEncoding.EncodeKey("a\"b"));
        Assert.Equal("\"a\\\\b\"", PathEncoding.EncodeKey("a\\b"));
        Assert.Equal("\"\\b\"", PathEncoding.EncodeKey("\b"));
        Assert.Equal("\"\\t\"", PathEncoding.EncodeKey("\t"));
        Assert.Equal("\"\\n\"", PathEncoding.EncodeKey("\n"));
        Assert.Equal("\"\\f\"", PathEncoding.EncodeKey("\f"));
        Assert.Equal("\"\\r\"", PathEncoding.EncodeKey("\r"));
        Assert.Equal("\"\\u0001\"", PathEncoding.EncodeKey("\u0001"));
        Assert.Equal("\"\\u001f\"", PathEncoding.EncodeKey("\u001f"));
        Assert.Equal("\"café\"", PathEncoding.EncodeKey("café"));
    }
}
