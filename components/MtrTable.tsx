import { memo, useState, useEffect } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MtrData {
    Hop: number;
    ASN: string;
    Prefix: string;
    Host: string;
    SentPackets: number[];
    ReceivedPackets: number[];
    Pings: number[];
    Last: number;
    Best: number;
    Worst: number;
    Avg: number;
    StDev: number;
    LossPercent: number;
    isHidden: boolean;
}

interface MtrTableProps {
    data: MtrData[];
    sourceInfo?: {
        hostname: string;
        ips: string[];
    };
    target?: string;
}

interface DnsResponse {
    Answer?: { name: string; data: string; type: number }[];
    Status: number;
}

const LOCALSTORAGE_CACHE_DURATION = 12 * 60 * 60 * 1000;
const DNS_API_URL = "https://dns.google/resolve";

// Add helper function for timestamp
function getFormattedTimestamp() {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'shortOffset'
    }).format(new Date()).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2');
}

const resolveDns = async (
    target: string,
    isIp: boolean,
): Promise<string | null> => {
    const cacheKey = `${isIp ? "ptr" : "a"}_${target}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (cachedData) {
        try {
            const { value, timestamp } = JSON.parse(cachedData);
            if (Date.now() - timestamp < LOCALSTORAGE_CACHE_DURATION) {
                return value;
            }
        } catch (error) {
            console.error("Failed to parse cached DNS data:", error);
        }
    }

    try {
        const type = isIp ? "ptr" : "a";
        const query = isIp
            ? target.split(".").reverse().join(".") + ".in-addr.arpa"
            : target;

        const response = await fetch(`${DNS_API_URL}?name=${query}&type=${type}`);
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
        console.error("DNS lookup failed:", error);
        return null;
    }
}

const TableCellWithTooltip = ({ label, content, href }: { label: string, content: string, href?: string }) => (
    <Tooltip>
        <TooltipTrigger asChild>
            <TableCell>
                {href ? (
                    <Link
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                    >
                        {label}
                    </Link>
                ) : label}
            </TableCell>
        </TooltipTrigger>
        <TooltipContent>
            <p>{content}</p>
        </TooltipContent>
    </Tooltip>
);

export const MtrTable = memo(({ data, sourceInfo, target }: MtrTableProps) => {
    const [startTime] = useState(getFormattedTimestamp());
    const [resolvedTarget, setResolvedTarget] = useState<string | null>(null);

    useEffect(() => {
        if (target) {
            const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(target);
            resolveDns(target, isIp).then(setResolvedTarget);
        }
    }, [target]);

    return (
        <Table className="text-xs font-mono">
            <TableHeader >
                {sourceInfo && (
                    <>
                        <TableRow >
                            <TableCell colSpan={10}>
                                Start: {startTime}
                            </TableCell>
                        </TableRow>
                        <TableRow >
                            <TableCell colSpan={10} >
                                {sourceInfo.hostname} ({sourceInfo.ips?.[0] || 'unknown'}) -&gt; {target}
                                {resolvedTarget && ` (${resolvedTarget})`}
                            </TableCell>
                        </TableRow>
                    </>
                )}
                <TableRow>
                    <TableHead className="font-bold">Hop</TableHead>
                    <TableHead className="font-bold">ASN</TableHead>
                    <TableHead className="font-bold">Host</TableHead>
                    <TableHead className="font-bold">Loss%</TableHead>
                    <TableHead className="font-bold">Snt</TableHead>
                    <TableHead className="font-bold">Last</TableHead>
                    <TableHead className="font-bold">Avg</TableHead>
                    <TableHead className="font-bold">Best</TableHead>
                    <TableHead className="font-bold">Wrst</TableHead>
                    <TableHead className="font-bold">StDev</TableHead>
                </TableRow>
            </TableHeader>
            <TooltipProvider>
                <TableBody>
                    {data.map((row) => (
                        <TableRow
                            key={row.Hop}
                            className={`${row.isHidden ? "hidden" : ""} text-xs`}>
                            <TableCellWithTooltip
                                label={`${row.Hop + 1}`}
                                content={`Hop ${row.Hop + 1}`}
                            />
                            <TableCellWithTooltip
                                label={row.ASN}
                                content={`Autonomous System Number: ${row.ASN}`}
                                href={row.ASN !== "N/A" ? `https://bgp.he.net/AS${row.ASN}` : undefined}
                            />
                            <TableCellWithTooltip
                                label={row.Host}
                                content={`Prefix: ${row.Prefix}`}
                                href={row.Prefix !== "N/A" ? `https://bgp.he.net/net/${row.Prefix}` : undefined}
                            />
                            <TableCell>{isNaN(row.LossPercent) ? 0.0 : (row.LossPercent).toFixed(1)}</TableCell>
                            <TableCell>{row.SentPackets.length}</TableCell>
                            <TableCell>{row.Last === Infinity ? "N/A" : (row.Last).toFixed(2)}</TableCell>
                            <TableCell>{row.Avg === 0 ? "N/A" : (row.Avg).toFixed(2)}</TableCell>
                            <TableCell>{row.Best === Infinity ? "N/A" : (row.Best).toFixed(2)}</TableCell>
                            <TableCell>{row.Worst === -Infinity ? "N/A" : (row.Worst).toFixed(2)}</TableCell>
                            <TableCell>{isNaN(row.StDev) ? "N/A" : (row.StDev).toFixed(2)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </TooltipProvider>
        </Table>
    );
});

MtrTable.displayName = 'MtrTable';
