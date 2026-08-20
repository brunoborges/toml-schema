namespace TomlSchema;

using System.Numerics;
using Tomlyn;

internal static class ValueSemantics
{
    internal static bool AreComparable(object left, object right) =>
        left is long or double && right is long or double
        || left is TomlDateTime leftToml && right is TomlDateTime rightToml
            && leftToml.Kind == rightToml.Kind
        || left is DateTimeOffset && right is DateTimeOffset
        || left is DateTime && right is DateTime
        || left is DateOnly && right is DateOnly
        || left is TimeOnly && right is TimeOnly;

    internal static bool MatchesComparableKind(object value, SchemaType? kind) => kind switch
    {
        SchemaType.Integer or SchemaType.Float => value is long or double,
        SchemaType.OffsetDateTime => value is DateTimeOffset
            or TomlDateTime { Kind: TomlDateTimeKind.OffsetDateTimeByZ or TomlDateTimeKind.OffsetDateTimeByNumber },
        SchemaType.LocalDateTime => value is DateTime
            or TomlDateTime { Kind: TomlDateTimeKind.LocalDateTime },
        SchemaType.LocalDate => value is DateOnly
            or TomlDateTime { Kind: TomlDateTimeKind.LocalDate },
        SchemaType.LocalTime => value is TimeOnly
            or TomlDateTime { Kind: TomlDateTimeKind.LocalTime },
        _ => false
    };

    internal static int Compare(object left, object right)
    {
        if (left is long or double && right is long or double)
            return CompareNumbers(left, right);
        if (left is TomlDateTime leftToml && right is TomlDateTime rightToml
            && leftToml.Kind == rightToml.Kind)
            return IsOffset(leftToml.Kind)
                ? leftToml.DateTime.UtcDateTime.CompareTo(rightToml.DateTime.UtcDateTime)
                : leftToml.DateTime.DateTime.CompareTo(rightToml.DateTime.DateTime);
        if (left is DateTimeOffset leftOffset && right is DateTimeOffset rightOffset)
            return leftOffset.UtcDateTime.CompareTo(rightOffset.UtcDateTime);
        if (left is DateTime leftDateTime && right is DateTime rightDateTime)
            return leftDateTime.CompareTo(rightDateTime);
        if (left is DateOnly leftDate && right is DateOnly rightDate)
            return leftDate.CompareTo(rightDate);
        if (left is TimeOnly leftTime && right is TimeOnly rightTime)
            return leftTime.CompareTo(rightTime);
        throw new InvalidOperationException("range values are not comparable");
    }

    private static bool IsOffset(TomlDateTimeKind kind) =>
        kind is TomlDateTimeKind.OffsetDateTimeByZ or TomlDateTimeKind.OffsetDateTimeByNumber;

    private static int CompareNumbers(object left, object right)
    {
        if (left is double leftFloat && double.IsNaN(leftFloat)
            || right is double rightFloat && double.IsNaN(rightFloat))
            throw new InvalidOperationException("NaN is unordered");
        if (left is double leftInfinity && double.IsInfinity(leftInfinity)
            || right is double rightInfinity && double.IsInfinity(rightInfinity))
            return ToDouble(left).CompareTo(ToDouble(right));
        var (leftNumerator, leftDenominator) = ExactNumber(left);
        var (rightNumerator, rightDenominator) = ExactNumber(right);
        return (leftNumerator * rightDenominator).CompareTo(
            rightNumerator * leftDenominator);
    }

    private static double ToDouble(object value) => value is long integer ? integer : (double)value;

    private static (BigInteger Numerator, BigInteger Denominator) ExactNumber(object value)
    {
        if (value is long integer)
            return (integer, BigInteger.One);
        var number = (double)value;
        if (number == 0)
            return (BigInteger.Zero, BigInteger.One);
        var bits = BitConverter.DoubleToInt64Bits(number);
        var negative = bits < 0;
        var exponentBits = (int)((bits >> 52) & 0x7ff);
        var fraction = bits & 0x000f_ffff_ffff_ffffL;
        BigInteger significand = exponentBits == 0
            ? fraction
            : fraction | (1L << 52);
        var exponent = exponentBits == 0 ? -1074 : exponentBits - 1075;
        if (negative)
            significand = -significand;
        return exponent >= 0
            ? (significand << exponent, BigInteger.One)
            : (significand, BigInteger.One << -exponent);
    }
}
