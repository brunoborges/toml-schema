namespace TomlSchema.Tests;

using Xunit;
using System.Text.RegularExpressions;

public class AbnfConformanceTests : TestBase
{
    [Fact]
    public void SchemaLoaderDefinitionKeysMatchAbnfSchemaKeys()
    {
        var abnf = ReadAbnf();
        var expected = AlternativesFor("schema-key", abnf);
        var actual = SchemaLoader.DefinitionKeys;

        Assert.Equal(expected.OrderBy(x => x), actual.OrderBy(x => x));
    }

    [Fact]
    public void SchemaTypesMatchAbnfBuiltInTypes()
    {
        var abnf = ReadAbnf();
        var implementationTypes = SchemaTypeExtensions.AllTypeNames;
        var abnfTypes = BuiltInTypeTokens(abnf);

        Assert.Equal(abnfTypes.OrderBy(x => x), implementationTypes.OrderBy(x => x));
    }

    private string ReadAbnf()
    {
        var path = AbnfPath();
        if (!File.Exists(path))
            throw new FileNotFoundException($"Cannot find toml-schema.abnf at {path}");
        return File.ReadAllText(path);
    }

    private string AbnfPath()
    {
        if (File.Exists("toml-schema.abnf"))
            return "toml-schema.abnf";

        var dir = AppContext.BaseDirectory;
        while (dir != null)
        {
            var candidate = Path.Combine(dir, "toml-schema.abnf");
            if (File.Exists(candidate))
                return candidate;
            dir = Path.GetDirectoryName(dir);
        }

        throw new FileNotFoundException("Cannot find toml-schema.abnf");
    }

    private HashSet<string> AlternativesFor(string ruleName, string abnf)
    {
        var expression = RuleExpression(ruleName, abnf);
        var tokens = new HashSet<string>();

        foreach (var token in expression.Split('/'))
        {
            var trimmed = token.Trim();
            if (!string.IsNullOrEmpty(trimmed) && trimmed != "version")
            {
                tokens.Add(trimmed);
            }
        }

        return tokens;
    }

    private string RuleExpression(string ruleName, string abnf)
    {
        var expression = new System.Text.StringBuilder();
        var inRule = false;
        var ruleStart = new Regex($"^{Regex.Escape(ruleName)}\\s*=\\s*(.*)$");

        foreach (var line in abnf.Split('\n'))
        {
            var match = ruleStart.Match(line);
            if (match.Success)
            {
                expression.Append(match.Groups[1].Value.Trim());
                inRule = true;
                continue;
            }

            if (inRule)
            {
                if (line.StartsWith(" ") || line.StartsWith("\t"))
                {
                    expression.Append(' ').Append(line.Trim());
                    continue;
                }
                else
                {
                    break;
                }
            }
        }

        return expression.ToString();
    }

    private HashSet<string> BuiltInTypeTokens(string abnf)
    {
        var expression = RuleExpression("built-in-type", abnf);
        var tokens = new HashSet<string>();

        foreach (var token in expression.Split('/'))
        {
            var trimmed = token.Trim();
            var typeRule = RuleExpression(trimmed, abnf);
            var match = Regex.Match(typeRule, "\"([^\"]+)\"");
            if (match.Success)
                tokens.Add(match.Groups[1].Value);
        }

        return tokens;
    }
}
