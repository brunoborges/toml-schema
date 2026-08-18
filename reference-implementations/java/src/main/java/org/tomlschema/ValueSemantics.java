package org.tomlschema;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Objects;

final class ValueSemantics {
    private ValueSemantics() {
    }

    static int compare(Object left, Object right) {
        if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
            return compareNumbers(leftNumber, rightNumber);
        }
        if (left instanceof OffsetDateTime leftDateTime && right instanceof OffsetDateTime rightDateTime) {
            return leftDateTime.toInstant().compareTo(rightDateTime.toInstant());
        }
        if (left instanceof Comparable<?> comparable && left.getClass().isInstance(right)) {
            return compareComparable(comparable, right);
        }
        throw new SchemaException("Cannot compare " + typeName(left) + " with boundary " + typeName(right));
    }

    static boolean valuesEqual(Object left, Object right) {
        if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
            if (isNaN(leftNumber) || isNaN(rightNumber)) {
                return isNaN(leftNumber) && isNaN(rightNumber);
            }
            return compareNumbers(leftNumber, rightNumber) == 0;
        }
        return Objects.equals(left, right);
    }

    private static int compareNumbers(Number left, Number right) {
        if (isNaN(left) || isNaN(right)) {
            throw new SchemaException("NaN is unordered");
        }
        if (left instanceof Long leftInteger && right instanceof Long rightInteger) {
            return Long.compare(leftInteger, rightInteger);
        }
        if (isInfinite(left) || isInfinite(right)) {
            return compareNonFinite(left.doubleValue(), right.doubleValue());
        }
        return decimal(left).compareTo(decimal(right));
    }

    private static BigDecimal decimal(Number number) {
        if (number instanceof Long integer) {
            return BigDecimal.valueOf(integer);
        }
        return new BigDecimal(number.doubleValue());
    }

    private static boolean isNaN(Number number) {
        return number instanceof Double value && value.isNaN();
    }

    private static boolean isInfinite(Number number) {
        return number instanceof Double value && value.isInfinite();
    }

    private static int compareNonFinite(double left, double right) {
        if (left < right) {
            return -1;
        }
        if (left > right) {
            return 1;
        }
        return 0;
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static int compareComparable(Comparable left, Object right) {
        return left.compareTo(right);
    }

    private static String typeName(Object value) {
        return value == null ? "null" : value.getClass().getSimpleName();
    }
}
