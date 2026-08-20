import { isIP } from "node:net";

export const STRING_FORMATS = ["email", "uuid", "uri", "hostname", "ipv4", "ipv6"] as const;
export type StringFormat = (typeof STRING_FORMATS)[number];

const FORMAT_SET: ReadonlySet<string> = new Set(STRING_FORMATS);
const HEX = /^[0-9A-Fa-f]+$/;
const UNRESERVED = "A-Za-z0-9._~\\-";
const SUB_DELIMS = "!$&'()*+,;=";

export function parseStringFormat(value: string): StringFormat | undefined {
  return FORMAT_SET.has(value) ? (value as StringFormat) : undefined;
}

export function isValidStringFormat(format: StringFormat, value: string): boolean {
  switch (format) {
    case "email":
      return isEmail(value);
    case "uuid":
      return /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(value);
    case "uri":
      return isAbsoluteUri(value);
    case "hostname":
      return isHostname(value);
    case "ipv4":
      return isIpv4(value);
    case "ipv6":
      return isIpv6(value);
  }
}

function isAscii(value: string): boolean {
  return /^[\x00-\x7f]*$/.test(value);
}

export function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) =>
    /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255
  );
}

export function isIpv6(value: string): boolean {
  if (!isAscii(value) || value.includes("%") || isIP(value) !== 6) return false;
  const dotted = value.lastIndexOf(":");
  return !value.includes(".") || (dotted >= 0 && isIpv4(value.slice(dotted + 1)));
}

export function isHostname(value: string, allowTrailingDot = true): boolean {
  if (!isAscii(value) || value.length === 0) return false;
  const hostname = allowTrailingDot && value.endsWith(".") ? value.slice(0, -1) : value;
  if (hostname.length === 0 || hostname.length > 253) return false;
  return hostname.split(".").every((label) =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  );
}

function isEmail(value: string): boolean {
  if (!isAscii(value) || value.length > 254) return false;
  let quoted = false;
  let escaped = false;
  let separator = -1;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    const character = value[index];
    if (quoted) {
      if (escaped) {
        if (code < 32 || code > 126) return false;
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        quoted = false;
      }
    } else if (character === "\"" && index === 0) {
      quoted = true;
    } else if (character === "@") {
      if (separator !== -1) return false;
      separator = index;
    }
  }
  if (quoted || escaped || separator <= 0 || separator === value.length - 1) return false;
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (local.length > 64 || !isEmailLocal(local)) return false;
  return domain.startsWith("[") && domain.endsWith("]")
    ? isAddressLiteral(domain.slice(1, -1))
    : isHostname(domain, false);
}

function isEmailLocal(local: string): boolean {
  if (local.startsWith("\"")) {
    if (!local.endsWith("\"") || local.length < 2) return false;
    for (let index = 1; index < local.length - 1; index++) {
      const code = local.charCodeAt(index);
      if (local[index] === "\\") {
        index++;
        if (index >= local.length - 1) return false;
        const escaped = local.charCodeAt(index);
        if (escaped < 32 || escaped > 126) return false;
      } else if (code < 32 || code > 126 || code === 34 || code === 92) {
        return false;
      }
    }
    return true;
  }
  const atom = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+$/;
  return local.split(".").every((part) => atom.test(part));
}

function isAddressLiteral(literal: string): boolean {
  if (isIpv4(literal)) return true;
  if (literal.startsWith("IPv6:")) return isIpv6(literal.slice(5));
  const colon = literal.indexOf(":");
  if (colon <= 0) return false;
  const tag = literal.slice(0, colon);
  const content = literal.slice(colon + 1);
  return /^[A-Za-z0-9-]*[A-Za-z0-9]$/.test(tag) &&
    content.length > 0 &&
    /^[\x21-\x5a\x5e-\x7e]+$/.test(content);
}

function validPercentEncoding(value: string): boolean {
  for (let index = value.indexOf("%"); index >= 0; index = value.indexOf("%", index + 3)) {
    if (index + 2 >= value.length || !HEX.test(value.slice(index + 1, index + 3))) return false;
  }
  return true;
}

function matchesComponent(value: string, extra: string): boolean {
  if (!validPercentEncoding(value)) return false;
  const withoutEscapes = value.replace(/%[0-9A-Fa-f]{2}/g, "");
  return new RegExp(`^[${UNRESERVED}${escapeClass(SUB_DELIMS + extra)}]*$`).test(withoutEscapes);
}

function escapeClass(value: string): string {
  return value.replace(/[\\\]\-^]/g, "\\$&");
}

function isAbsoluteUri(value: string): boolean {
  if (!isAscii(value) || /[\x00-\x20\x7f]/.test(value)) return false;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/.exec(value);
  if (!scheme) return false;
  let remainder = scheme[2] as string;
  const hash = remainder.indexOf("#");
  const fragment = hash < 0 ? undefined : remainder.slice(hash + 1);
  if (fragment !== undefined) remainder = remainder.slice(0, hash);
  if (fragment?.includes("#") || (fragment !== undefined && !matchesComponent(fragment, ":@/?"))) return false;
  const question = remainder.indexOf("?");
  const query = question < 0 ? undefined : remainder.slice(question + 1);
  if (query !== undefined) remainder = remainder.slice(0, question);
  if (query !== undefined && !matchesComponent(query, ":@/?")) return false;

  if (remainder.startsWith("//")) {
    const slash = remainder.indexOf("/", 2);
    const authority = slash < 0 ? remainder.slice(2) : remainder.slice(2, slash);
    const path = slash < 0 ? "" : remainder.slice(slash);
    return isAuthority(authority) && matchesComponent(path, ":@/");
  }
  if (remainder.startsWith("//") || !matchesComponent(remainder, ":@/")) return false;
  if (remainder !== "" && !remainder.startsWith("/") && !matchesComponent(remainder[0] as string, ":@")) {
    return false;
  }
  return true;
}

function isAuthority(authority: string): boolean {
  const at = authority.lastIndexOf("@");
  const hostPort = at < 0 ? authority : authority.slice(at + 1);
  if (at >= 0 && !matchesComponent(authority.slice(0, at), ":")) return false;
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close < 0 || !/^(?::[0-9]*)?$/.test(hostPort.slice(close + 1))) return false;
    const literal = hostPort.slice(1, close);
    return isIpv6(literal) ||
      /^[vV][0-9A-Fa-f]+\.[A-Za-z0-9._~!$&'()*+,;=:-]+$/.test(literal);
  }
  const colon = hostPort.lastIndexOf(":");
  if (colon >= 0 && (hostPort.indexOf(":") !== colon || !/^[0-9]*$/.test(hostPort.slice(colon + 1)))) {
    return false;
  }
  const host = colon < 0 ? hostPort : hostPort.slice(0, colon);
  return matchesComponent(host, "");
}
