export interface MtrData {
  Hop: number;

  ASN: string;
  Prefix: string;
  Host: string;
  Sent: number;
  SentPacket: number;
  SentPackets: number[];
  Received: number;
  ReceivedPacket: number;
  ReceivedPackets: number[];
  Pings: number[];
  TotalTime: number;
  VarianceSum: number;
  Last: number;
  Best: number;
  Worst: number;
  Avg: number;
  StDev: number;
  LossPercent: number;
  isHidden: boolean;
}

const LOCALSTORAGE_CACHE_DURATION = 12 * 60 * 60 * 1000;
const DNS_API_URL = "https://dns.google/resolve";
const reservedIPv4Regex =
  /^(?:0\.0\.0\.|10\.(?:[0-9]{1,2}\.){2}|100\.(?:6[4-9]|7[0-9]|8[0-9]|9[0-9])\.(?:[0-9]{1,2}\.)|127\.(?:[0-9]{1,2}\.){2}|169\.254\.(?:[0-9]{1,2}\.)|172\.(?:1[6-9]|2[0-9]|3[0-1])\.(?:[0-9]{1,2}\.)|192\.(?:0\.0\.|0\.2\.|168\.)|198\.(?:1[8-9]\.|51\.(?:100\.))|203\.0\.113\.|2(?:2[4-9]|3[0-9])\.(?:[0-9]{1,2}\.){2}|240\.(?:[0-9]{1,2}\.){3}|255\.255\.255\.255)$/;

const MAX_PACKETS = 100;

export const createDefaultMtrRow = (hop: number): MtrData => ({
  Hop: hop,
  ASN: "N/A",
  Prefix: "N/A",
  Host: "N/A",
  Sent: 0,
  SentPacket: 0,
  SentPackets: [],
  Received: 0,
  ReceivedPacket: 0,
  ReceivedPackets: [],
  Pings: [],
  TotalTime: 0,
  VarianceSum: 0,
  Last: Infinity,
  Best: Infinity,
  Worst: -Infinity,
  Avg: 0,
  StDev: 0,
  LossPercent: 0,
  isHidden: false,
});

const calculateStats = (
  pings: number[],
): { avg: number; min: number; max: number; stdev: number } => {
  const validPings = pings.filter((p) => p > 0 && p !== Infinity);
  if (validPings.length === 0) {
    return { avg: 0, min: Infinity, max: -Infinity, stdev: 0 };
  }

  const avg = validPings.reduce((a, b) => a + b, 0) / validPings.length;
  const variance =
    validPings.reduce((acc, ping) => acc + Math.pow(ping - avg, 2), 0) /
    validPings.length;

  return {
    avg: avg / 1000,
    min: Math.min(...validPings) / 1000,
    max: Math.max(...validPings) / 1000,
    stdev: Math.sqrt(variance) / 1000,
  };
};

export const updateMtrRow = (row: MtrData, lastTime: number): void => {
  // Add the new ping time
  if (lastTime > 0) {
    row.Pings.push(lastTime);
    // Keep only last MAX_PACKETS pings
    if (row.Pings.length > MAX_PACKETS) {
      row.Pings.shift();
    }

    // Update stats
    const stats = calculateStats(row.Pings);
    row.Last = lastTime / 1000;
    row.Avg = stats.avg;
    row.Best = stats.min;
    row.Worst = stats.max;
    row.StDev = stats.stdev;
  }
};

export const updateLossPercent = (row: MtrData): void => {
  if (row.SentPackets.length === 0) {
    row.LossPercent = 0;
    return;
  }

  // Use Set for O(1) lookup performance
  const receivedSet = new Set(row.ReceivedPackets);
  const lostPackets = row.SentPackets.filter((seq) => !receivedSet.has(seq));
  row.LossPercent = (lostPackets.length / row.SentPackets.length) * 100;
};

export const fetchASN = async (
  reversedHost: string,
  cacheKey: string,
  currentRow: MtrData,
): Promise<void> => {
  try {
    const response = await fetch(
      `${DNS_API_URL}?name=${reversedHost}.origin.asn.cymru.com&type=txt`,
    );
    if (!response.ok) throw new Error("Failed to fetch ASN data");

    const data = await response.json();
    if (data.Answer?.[0]?.data) {
      const asn = data.Answer[0].data
        .split(" |")[0]
        .trim()
        .split(" ")[0]
        .trim();
      const prefix = data.Answer[0].data
        .split(" |")[1]
        .trim()
        .split(" ")[0]
        .trim();
      currentRow.ASN = asn;
      currentRow.Prefix = prefix;
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ asn, prefix, timestamp: Date.now() }),
      );
    }
  } catch (error) {
    console.error("Failed to fetch ASN:", error);
  }
};

export const parseMtrLine = (
  line: string,
  prev: Map<number, MtrData>,
): Map<number, MtrData> => {
  const newMap = new Map(prev);
  console.log(line);
  const lines = line.split("\n").filter((l) => l.trim());

  for (const singleLine of lines) {
    const [type, ...parts] = singleLine.split(/\s+/).filter(Boolean);
    if (!parts[0]) continue;

    const hop = parseInt(parts[0], 10);
    if (isNaN(hop) || hop < 0) continue;

    const currentRow = newMap.get(hop) || createDefaultMtrRow(hop);

    switch (type) {
      case "h":
        if (parts[1]) {
          currentRow.Host = parts[1];
          currentRow.isHidden = parts[1] === newMap.get(hop - 1)?.Host;

          if (
            !currentRow.isHidden &&
            parts[1] !== "N/A" &&
            !reservedIPv4Regex.test(parts[1])
          ) {
            const reversedHost = parts[1]
              .split(".")
              .slice(0, 3)
              .reverse()
              .join(".");
            const cacheKey = `asn_${reversedHost}`;
            const cachedData = localStorage.getItem(cacheKey);

            if (cachedData) {
              try {
                const { asn, prefix, timestamp } = JSON.parse(cachedData);
                if (Date.now() - timestamp < LOCALSTORAGE_CACHE_DURATION) {
                  currentRow.ASN = asn;
                  currentRow.Prefix = prefix;
                } else {
                  void fetchASN(reversedHost, cacheKey, currentRow);
                }
              } catch {
                void fetchASN(reversedHost, cacheKey, currentRow);
              }
            } else {
              void fetchASN(reversedHost, cacheKey, currentRow);
            }
          }
        }
        break;
      case "p":
        if (parts[1] && parts[2]) {
          const lastTime = parseFloat(parts[1]);
          const recPacket = parseInt(parts[2], 10);

          // Only process valid packets
          if (!isNaN(recPacket) && !isNaN(lastTime) && lastTime > 0) {
            if (!currentRow.ReceivedPackets.includes(recPacket)) {
              currentRow.Received++;
              currentRow.ReceivedPackets.push(recPacket);
              currentRow.ReceivedPacket = Math.max(
                currentRow.ReceivedPacket,
                recPacket,
              );
              updateMtrRow(currentRow, lastTime);
            }
            updateLossPercent(currentRow);
          }
        }
        break;
      case "x":
        if (parts[1]) {
          const sentPacket = parseInt(parts[1], 10);
          if (
            !isNaN(sentPacket) &&
            !currentRow.SentPackets.includes(sentPacket)
          ) {
            currentRow.Sent++;
            currentRow.SentPackets.push(sentPacket);
            currentRow.SentPacket = Math.max(currentRow.SentPacket, sentPacket);
            if (10 == currentRow.SentPackets.length) {
              updateLossPercent(currentRow);
            }
          }
        }
        break;
    }

    newMap.set(hop, currentRow);
  }

  return newMap;
};
