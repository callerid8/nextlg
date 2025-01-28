export const LOCALSTORAGE_CACHE_DURATION = 12 * 60 * 60 * 1000;
export const DNS_API_URL = "https://dns.google/resolve";

interface DnsResponse {
  Answer?: { name: string; data: string; type: number }[];
  Status: number;
}

export function expandIPv6(address: string): string {
  if (address === "::") return "0000:0000:0000:0000:0000:0000:0000:0000";

  let expanded = address;
  if (expanded.startsWith("::")) expanded = "0" + expanded;
  if (expanded.endsWith("::")) expanded = expanded + "0";

  const groups = expanded.split(":");
  const doubleColonIndex = groups.indexOf("");

  if (doubleColonIndex !== -1) {
    groups.splice(doubleColonIndex, 1);
    const missing = 8 - groups.length;
    const zeros = Array(missing).fill("0000");
    groups.splice(doubleColonIndex, 0, ...zeros);
  }

  return groups
    .map((g) => g.padStart(4, "0"))
    .join("")
    .toLowerCase();
}

export function getFormattedTimestamp(): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "shortOffset",
  })
    .format(new Date())
    .replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2");
}

export function isIPAddress(ip: string): {
  isIp: boolean;
  version: 4 | 6 | null;
} {
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern =
    /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,7}:|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}$|^([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}$|^([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}$|^([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})$|^:((:[0-9a-fA-F]{1,4}){1,7}|:)$/;

  if (ipv4Pattern.test(ip)) return { isIp: true, version: 4 };
  if (ipv6Pattern.test(ip)) return { isIp: true, version: 6 };
  return { isIp: false, version: null };
}

export const resolveDns = async (
  target: string,
  isIp: boolean,
  sourceIps?: string[],
): Promise<string | null> => {
  const ipInfo = isIPAddress(target);
  const sourceIsIpv6 = sourceIps?.[0]?.includes(":");
  const recordType = isIp
    ? "ptr"
    : ipInfo.version === 6 || sourceIsIpv6
      ? "aaaa"
      : "a";
  const cacheKey = `${recordType}_${target}`;

  const cachedData = localStorage.getItem(cacheKey);
  if (cachedData) {
    try {
      const { value, timestamp } = JSON.parse(cachedData);
      if (Date.now() - timestamp < LOCALSTORAGE_CACHE_DURATION) {
        return value;
      }
    } catch {
      // Cache invalid or expired, continue to fetch
    }
  }

  try {
    let query = target;
    if (isIp) {
      if (ipInfo.version === 4) {
        query = target.split(".").reverse().join(".") + ".in-addr.arpa";
      } else if (ipInfo.version === 6) {
        const expanded = expandIPv6(target);
        if (expanded.length !== 32) return null;
        query = expanded.split("").reverse().join(".") + ".ip6.arpa";
      }
    }

    const response = await fetch(
      `${DNS_API_URL}?name=${query}&type=${recordType}`,
    );
    const data: DnsResponse = await response.json();

    if (data.Status === 0 && data.Answer?.[0]) {
      const result = data.Answer[0].data.replace(/\.$/, "");
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ value: result, timestamp: Date.now() }),
      );
      return result;
    }
    return null;
  } catch (error) {
    console.error("DNS resolution failed:", error);
    return null;
  }
};
