"""Validation for the string formats supported by the Python implementation."""

from __future__ import annotations

import ipaddress
import re
import urllib.parse

SUPPORTED_FORMATS = frozenset({"email", "uuid", "uri", "hostname", "ipv4", "ipv6"})

_ATEXT = frozenset("!#$%&'*+-/=?^_`{|}~")
_UUID_RE = re.compile(
    r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-"
    r"[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
)
_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
_URI_PATH_RE = re.compile(r"^[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$")
_URI_QUERY_RE = re.compile(r"^[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$")
_URI_AUTHORITY_RE = re.compile(r"^[A-Za-z0-9\-._~!$&'()*+,;=:@%\[\]]*$")
_URI_USERINFO_RE = re.compile(r"^[A-Za-z0-9\-._~!$&'()*+,;=:%]*$")
_URI_REG_NAME_RE = re.compile(r"^[A-Za-z0-9\-._~!$&'()*+,;=%]*$")
_IPV_FUTURE_RE = re.compile(r"^v[0-9A-Fa-f]+\.[A-Za-z0-9\-._~!$&'()*+,;=:]+$", re.I)
_BAD_PERCENT_RE = re.compile(r"%(?![0-9A-Fa-f]{2})")
_IPV4_RE = re.compile(r"^(0|[1-9][0-9]{0,2})(?:\.(0|[1-9][0-9]{0,2})){3}$")
_GENERAL_LITERAL_TAG_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$")


def _valid_hostname(value: str, *, allow_trailing_dot: bool = True) -> bool:
    if not value or not value.isascii():
        return False
    name = value[:-1] if allow_trailing_dot and value.endswith(".") else value
    if not name or len(name) > 253:
        return False
    labels = name.split(".")
    return all(
        1 <= len(label) <= 63
        and label[0].isalnum()
        and label[-1].isalnum()
        and all(character.isascii() and (character.isalnum() or character == "-") for character in label)
        for label in labels
    )


def _valid_ipv4(value: str) -> bool:
    if not _IPV4_RE.fullmatch(value):
        return False
    try:
        ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        return False
    return True


def _valid_ipv6(value: str) -> bool:
    if ":" not in value or "%" in value:
        return False
    try:
        ipaddress.IPv6Address(value)
    except ipaddress.AddressValueError:
        return False
    return True


def _valid_local_part(value: str) -> bool:
    if value.startswith('"'):
        if len(value) < 2 or not value.endswith('"'):
            return False
        index = 1
        while index < len(value) - 1:
            codepoint = ord(value[index])
            if value[index] == "\\":
                index += 1
                if index >= len(value) - 1 or not 32 <= ord(value[index]) <= 126:
                    return False
            elif not (codepoint in (32, 33) or 35 <= codepoint <= 91 or 93 <= codepoint <= 126):
                return False
            index += 1
        return True

    atoms = value.split(".")
    return bool(value) and all(
        atom
        and all(character.isascii() and (character.isalnum() or character in _ATEXT) for character in atom)
        for atom in atoms
    )


def _split_mailbox(value: str) -> tuple[str, str] | None:
    quoted = False
    escaped = False
    separator = -1
    for index, character in enumerate(value):
        if escaped:
            escaped = False
        elif quoted and character == "\\":
            escaped = True
        elif character == '"':
            quoted = not quoted
        elif character == "@" and not quoted:
            if separator != -1:
                return None
            separator = index
    if quoted or escaped or separator < 0:
        return None
    return value[:separator], value[separator + 1 :]


def _valid_address_literal(value: str) -> bool:
    if len(value) < 3 or not value.startswith("[") or not value.endswith("]"):
        return False
    literal = value[1:-1]
    if _valid_ipv4(literal):
        return True
    if literal.lower().startswith("ipv6:"):
        return _valid_ipv6(literal[5:])
    tag, separator, content = literal.partition(":")
    return bool(
        separator
        and content
        and _GENERAL_LITERAL_TAG_RE.fullmatch(tag)
        and all(33 <= ord(character) <= 90 or 94 <= ord(character) <= 126 for character in content)
    )


def _valid_email(value: str) -> bool:
    if not value.isascii() or len(value.encode("ascii")) > 254:
        return False
    parts = _split_mailbox(value)
    if parts is None:
        return False
    local, domain = parts
    if len(local.encode("ascii")) > 64 or not _valid_local_part(local):
        return False
    return _valid_address_literal(domain) if domain.startswith("[") else _valid_hostname(
        domain, allow_trailing_dot=False
    )


def _valid_uri_authority(authority: str) -> bool:
    if not _URI_AUTHORITY_RE.fullmatch(authority) or authority.count("@") > 1:
        return False
    userinfo, separator, host_port = authority.rpartition("@")
    if separator and not _URI_USERINFO_RE.fullmatch(userinfo):
        return False
    if host_port.startswith("["):
        closing = host_port.find("]")
        if closing < 0:
            return False
        literal = host_port[1:closing]
        remainder = host_port[closing + 1 :]
        if not (_valid_ipv6(literal) or _IPV_FUTURE_RE.fullmatch(literal)):
            return False
        if remainder and not remainder.startswith(":"):
            return False
        port = remainder[1:] if remainder else ""
    else:
        if host_port.count(":") > 1:
            return False
        host, separator, port = host_port.partition(":")
        if not _URI_REG_NAME_RE.fullmatch(host):
            return False
    return not separator or port.isdigit() or port == ""


def _valid_uri(value: str) -> bool:
    if not value.isascii() or not _SCHEME_RE.match(value):
        return False
    if _BAD_PERCENT_RE.search(value) or value.count("#") > 1:
        return False
    without_fragment, _, fragment = value.partition("#")
    if not _URI_QUERY_RE.fullmatch(fragment):
        return False
    before_query, _, query = without_fragment.partition("?")
    if not _URI_QUERY_RE.fullmatch(query):
        return False
    _, hierarchical = before_query.split(":", 1)
    if hierarchical.startswith("//"):
        authority_and_path = hierarchical[2:]
        authority, separator, path = authority_and_path.partition("/")
        if not _valid_uri_authority(authority):
            return False
        path = "/" + path if separator else ""
    else:
        path = hierarchical
    if not _URI_PATH_RE.fullmatch(path):
        return False
    try:
        parsed = urllib.parse.urlsplit(value)
        if parsed.netloc:
            _ = parsed.hostname
            _ = parsed.port
    except ValueError:
        return False
    return bool(parsed.scheme)


def matches_format(value: str, format_name: str) -> bool:
    """Return whether *value* conforms to the named string format."""
    validators = {
        "email": _valid_email,
        "uuid": lambda candidate: bool(_UUID_RE.fullmatch(candidate)),
        "uri": _valid_uri,
        "hostname": _valid_hostname,
        "ipv4": _valid_ipv4,
        "ipv6": _valid_ipv6,
    }
    return validators[format_name](value)
