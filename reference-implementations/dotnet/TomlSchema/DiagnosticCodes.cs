namespace TomlSchema;

/// <summary>
/// The stable diagnostic codes defined by SPEC.md's <c>### Code Registry</c>. Every
/// unprefixed code emitted by this implementation is one of these constants, which lets
/// a conformance guard test assert that the implementation never emits a code outside the
/// registry. Message text is presentation and is not represented here.
/// </summary>
public static class DiagnosticCodes
{
    // Discovery codes.
    /// <summary>Discovery was requested and the document has no usable location.</summary>
    public const string DiscoveryMissingLocation = "discovery-missing-location";
    /// <summary><c>[toml-schema]</c> metadata is not valid schema-reference metadata.</summary>
    public const string DiscoveryInvalidMetadata = "discovery-invalid-metadata";
    /// <summary>A relative location cannot be resolved to a usable URI.</summary>
    public const string DiscoveryUnresolvedLocation = "discovery-unresolved-location";
    /// <summary>Retrieval is disabled or policy rejects the target.</summary>
    public const string SchemaRetrievalRefused = "schema-retrieval-refused";
    /// <summary>An authorized retrieval does not yield a usable schema.</summary>
    public const string SchemaRetrievalFailed = "schema-retrieval-failed";
    /// <summary>The document version and loaded schema version differ compatibly.</summary>
    public const string VersionMismatch = "version-mismatch";
    /// <summary>An unsupported language version is requested or declared.</summary>
    public const string UnsupportedVersion = "unsupported-version";
    /// <summary>A configured limit was reached.</summary>
    public const string ResourceLimitExceeded = "resource-limit-exceeded";

    // Schema-load codes.
    /// <summary>A key/value pair is not in the closed property set.</summary>
    public const string UnrecognizedProperty = "unrecognized-property";
    /// <summary>A recognized property appears where it is not permitted.</summary>
    public const string InapplicableProperty = "inapplicable-property";
    /// <summary>Mutually exclusive properties appear together.</summary>
    public const string ExclusiveProperties = "exclusive-properties";
    /// <summary>A type reference names no built-in or defined type.</summary>
    public const string UnresolvedReference = "unresolved-reference";
    /// <summary>Two composition entries share a resolved identity.</summary>
    public const string DuplicateReference = "duplicate-reference";
    /// <summary><c>min</c>/<c>max</c> or <c>minlength</c>/<c>maxlength</c> is reversed.</summary>
    public const string InvertedRange = "inverted-range";
    /// <summary>A boundary value is invalid for the comparable kind.</summary>
    public const string InvalidBoundary = "invalid-boundary";
    /// <summary>A sibling-rule operand is not a determinate fixed child.</summary>
    public const string IndeterminateOperand = "indeterminate-operand";
    /// <summary>A pattern cannot be compiled.</summary>
    public const string InvalidPattern = "invalid-pattern";
    /// <summary>A pattern uses syntax outside the portable profile.</summary>
    public const string UnsupportedPattern = "unsupported-pattern";
    /// <summary>The reference graph contains an illegal cycle.</summary>
    public const string CyclicReference = "cyclic-reference";
    /// <summary><c>allof</c> participants do not compose.</summary>
    public const string IncompatibleComposition = "incompatible-composition";
    /// <summary>A declared default does not validate against its definition.</summary>
    public const string InvalidDefault = "invalid-default";
    /// <summary>The schema-load catch-all for any other malformation.</summary>
    public const string SchemaMalformed = "schema-malformed";

    // Validation codes.
    /// <summary>A closed table has a key outside its effective closure set.</summary>
    public const string UnknownKey = "unknown-key";
    /// <summary>A required fixed child is absent.</summary>
    public const string MissingRequired = "missing-required";
    /// <summary>A node's TOML kind does not match the effective type.</summary>
    public const string TypeMismatch = "type-mismatch";
    /// <summary>A value is not a member of <c>allowedvalues</c>.</summary>
    public const string AllowedValues = "allowedvalues";
    /// <summary>A string does not match <c>pattern</c>.</summary>
    public const string Pattern = "pattern";
    /// <summary>A string does not match the required <c>format</c>.</summary>
    public const string Format = "format";
    /// <summary>A comparable value is less than <c>min</c>.</summary>
    public const string Min = "min";
    /// <summary>A comparable value is greater than <c>max</c>.</summary>
    public const string Max = "max";
    /// <summary>A string, array, or collection is shorter than <c>minlength</c>.</summary>
    public const string MinLength = "minlength";
    /// <summary>A string, array, or collection is longer than <c>maxlength</c>.</summary>
    public const string MaxLength = "maxlength";
    /// <summary>An array with <c>uniqueitems</c> contains equal items.</summary>
    public const string UniqueItems = "uniqueitems";
    /// <summary>An array validated by <c>items</c> has the wrong arity.</summary>
    public const string TupleLength = "tuple-length";
    /// <summary>A dynamic entry key does not match <c>keypattern</c>.</summary>
    public const string KeyPattern = "keypattern";
    /// <summary>The number of matching <c>oneof</c> alternatives is not exactly one.</summary>
    public const string OneOf = "oneof";
    /// <summary>No <c>anyof</c> alternative matches.</summary>
    public const string AnyOf = "anyof";
    /// <summary>A trigger child is present and a dependent child is absent.</summary>
    public const string DependentRequired = "dependentrequired";
    /// <summary>More than one member of a mutually exclusive group is present.</summary>
    public const string MutuallyExclusive = "mutuallyexclusive";
    /// <summary>An exactly-one group does not have exactly one present member.</summary>
    public const string ExactlyOne = "exactlyone";
    /// <summary>A present node is deprecated.</summary>
    public const string Deprecated = "deprecated";
}
