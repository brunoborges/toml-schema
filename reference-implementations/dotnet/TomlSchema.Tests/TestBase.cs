namespace TomlSchema.Tests;

using Xunit;
using System.IO;

public class TestBase
{
    protected static string Fixture(string relativePath)
    {
        // Walk up from bin directory to find repository root
        var dir = AppContext.BaseDirectory;
        while (dir != null && !File.Exists(Path.Combine(dir, "toml-schema.abnf")))
        {
            dir = Path.GetDirectoryName(dir);
        }

        if (dir == null)
            throw new InvalidOperationException("Cannot find repository root with toml-schema.abnf");

        return Path.Combine(dir, relativePath);
    }

    protected static string Write(string fileName, string content)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), fileName);
        File.WriteAllText(tempPath, content);
        return tempPath;
    }
}
