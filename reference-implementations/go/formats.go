package tomlschema

import (
	"net"
	"net/url"
	"regexp"
	"strings"
)

var supportedStringFormats = map[string]bool{
	"email": true, "uuid": true, "uri": true, "hostname": true, "ipv4": true, "ipv6": true,
}

var uuidFormatPattern = regexp.MustCompile(`^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`)

func validateStringFormat(format, value string) bool {
	switch format {
	case "email":
		return validEmail(value)
	case "uuid":
		return uuidFormatPattern.MatchString(value)
	case "uri":
		return validURI(value)
	case "hostname":
		return validHostname(value)
	case "ipv4":
		return validIPv4(value)
	case "ipv6":
		return validIPv6(value)
	default:
		return false
	}
}

func validEmail(value string) bool {
	if len(value) > 254 || !asciiOnly(value) {
		return false
	}
	at := emailAt(value)
	if at <= 0 || at > 64 || at == len(value)-1 {
		return false
	}
	local, domain := value[:at], value[at+1:]
	if !validEmailLocal(local) {
		return false
	}
	if strings.HasPrefix(domain, "[") && strings.HasSuffix(domain, "]") {
		return validAddressLiteral(domain[1 : len(domain)-1])
	}
	return validHostnameWithTrailingDot(domain, false)
}

func emailAt(value string) int {
	quoted, escaped := false, false
	at := -1
	for i := 0; i < len(value); i++ {
		switch {
		case escaped:
			escaped = false
		case quoted && value[i] == '\\':
			escaped = true
		case value[i] == '"':
			quoted = !quoted
		case value[i] == '@' && !quoted:
			if at >= 0 {
				return -1
			}
			at = i
		}
	}
	if quoted || escaped {
		return -1
	}
	return at
}

func validEmailLocal(local string) bool {
	if len(local) >= 2 && local[0] == '"' && local[len(local)-1] == '"' {
		for i := 1; i < len(local)-1; i++ {
			c := local[i]
			if c == '\\' {
				i++
				if i >= len(local)-1 || local[i] < 32 || local[i] > 126 {
					return false
				}
			} else if c < 32 || c > 126 || c == '"' || c == '\\' {
				return false
			}
		}
		return true
	}
	if local == "" || local[0] == '.' || local[len(local)-1] == '.' {
		return false
	}
	previousDot := false
	for i := 0; i < len(local); i++ {
		c := local[i]
		if c == '.' {
			if previousDot {
				return false
			}
			previousDot = true
			continue
		}
		previousDot = false
		if !isEmailAtom(c) {
			return false
		}
	}
	return true
}

func isEmailAtom(c byte) bool {
	return isASCIIAlnum(c) || strings.ContainsRune("!#$%&'*+-/=?^_`{|}~", rune(c))
}

func validAddressLiteral(value string) bool {
	if validIPv4(value) {
		return true
	}
	if len(value) > 5 && strings.EqualFold(value[:5], "IPv6:") {
		return validIPv6(value[5:])
	}
	colon := strings.IndexByte(value, ':')
	if colon <= 0 || colon == len(value)-1 || !validStandardizedTag(value[:colon]) {
		return false
	}
	for i := colon + 1; i < len(value); i++ {
		if value[i] < 33 || value[i] > 126 || value[i] == '[' || value[i] == ']' || value[i] == '\\' {
			return false
		}
	}
	return true
}

func validURI(value string) bool {
	if value == "" || !asciiOnly(value) || strings.Count(value, "#") > 1 || uriHostHasZoneIdentifier(value) {
		return false
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		if c == '%' {
			if i+2 >= len(value) || !isHex(value[i+1]) || !isHex(value[i+2]) {
				return false
			}
			i += 2
		} else if !isURIChar(c) {
			return false
		}
	}
	parsed, err := url.Parse(value)
	if err == nil && parsed.Scheme != "" {
		return true
	}
	normalized, ok := normalizeIPvFutureURI(value)
	if !ok {
		return false
	}
	parsed, err = url.Parse(normalized)
	return err == nil && parsed.Scheme != ""
}

func uriHostHasZoneIdentifier(value string) bool {
	colon := strings.IndexByte(value, ':')
	if colon < 0 || !strings.HasPrefix(value[colon+1:], "//") {
		return false
	}
	authority := value[colon+3:]
	if end := strings.IndexAny(authority, "/?#"); end >= 0 {
		authority = authority[:end]
	}
	if at := strings.LastIndexByte(authority, '@'); at >= 0 {
		authority = authority[at+1:]
	}
	if !strings.HasPrefix(authority, "[") {
		return false
	}
	close := strings.IndexByte(authority, ']')
	return close > 0 && strings.Contains(authority[1:close], "%")
}

func normalizeIPvFutureURI(value string) (string, bool) {
	colon := strings.IndexByte(value, ':')
	if colon < 0 || !strings.HasPrefix(value[colon+1:], "//") {
		return "", false
	}
	authorityStart := colon + 3
	authorityEnd := len(value)
	if end := strings.IndexAny(value[authorityStart:], "/?#"); end >= 0 {
		authorityEnd = authorityStart + end
	}
	authority := value[authorityStart:authorityEnd]
	hostOffset := 0
	if at := strings.LastIndexByte(authority, '@'); at >= 0 {
		hostOffset = at + 1
	}
	hostPort := authority[hostOffset:]
	if !strings.HasPrefix(hostPort, "[") {
		return "", false
	}
	close := strings.IndexByte(hostPort, ']')
	if close < 0 || !validIPvFuture(hostPort[1:close]) {
		return "", false
	}
	literalStart := authorityStart + hostOffset + 1
	literalEnd := authorityStart + hostOffset + close
	return value[:literalStart] + "::1" + value[literalEnd:], true
}

func validIPvFuture(value string) bool {
	if len(value) < 4 || value[0] != 'v' && value[0] != 'V' {
		return false
	}
	dot := strings.IndexByte(value, '.')
	if dot <= 1 || dot == len(value)-1 {
		return false
	}
	for i := 1; i < dot; i++ {
		if !isHex(value[i]) {
			return false
		}
	}
	for i := dot + 1; i < len(value); i++ {
		c := value[i]
		if !isASCIIAlnum(c) && !strings.ContainsRune("-._~!$&'()*+,;=:", rune(c)) {
			return false
		}
	}
	return true
}

func validHostname(value string) bool {
	return validHostnameWithTrailingDot(value, true)
}

func validHostnameWithTrailingDot(value string, allowTrailingDot bool) bool {
	if allowTrailingDot && strings.HasSuffix(value, ".") {
		value = value[:len(value)-1]
	}
	if len(value) == 0 || len(value) > 253 || !asciiOnly(value) {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if len(label) == 0 || len(label) > 63 || !isASCIIAlnum(label[0]) || !isASCIIAlnum(label[len(label)-1]) {
			return false
		}
		for i := 1; i < len(label)-1; i++ {
			if !isASCIIAlnum(label[i]) && label[i] != '-' {
				return false
			}
		}
	}
	return true
}

func validIPv4(value string) bool {
	parts := strings.Split(value, ".")
	if len(parts) != 4 {
		return false
	}
	for _, part := range parts {
		if part == "" || (len(part) > 1 && part[0] == '0') || len(part) > 3 {
			return false
		}
		number := 0
		for i := 0; i < len(part); i++ {
			if part[i] < '0' || part[i] > '9' {
				return false
			}
			number = number*10 + int(part[i]-'0')
		}
		if number > 255 {
			return false
		}
	}
	return true
}

func validIPv6(value string) bool {
	if !strings.Contains(value, ":") || strings.Contains(value, "%") {
		return false
	}
	if dot := strings.LastIndexByte(value, '.'); dot >= 0 {
		colon := strings.LastIndexByte(value[:dot], ':')
		if colon < 0 || !validIPv4(value[colon+1:]) {
			return false
		}
	}
	ip := net.ParseIP(value)
	return ip != nil
}

func validStandardizedTag(value string) bool {
	if value == "" || !isASCIIAlnum(value[len(value)-1]) {
		return false
	}
	for i := 0; i < len(value)-1; i++ {
		if !isASCIIAlnum(value[i]) && value[i] != '-' {
			return false
		}
	}
	return true
}

func asciiOnly(value string) bool {
	for i := 0; i < len(value); i++ {
		if value[i] > 127 {
			return false
		}
	}
	return true
}

func isASCIIAlnum(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

func isHex(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F'
}

func isURIChar(c byte) bool {
	return isASCIIAlnum(c) || strings.ContainsRune("-._~:/?#[]@!$&'()*+,;=", rune(c))
}
