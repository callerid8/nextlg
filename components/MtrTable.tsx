import { memo, useState, useEffect } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isIPAddress, getFormattedTimestamp, resolveDns } from "@/utils/network"; // Utility functions moved to a separate file
import type { MtrTableProps } from "@/types/network"; // Type definitions moved to a separate file]


// Tooltip Cell Component
const TableCellWithTooltip = ({ label, content, href }: { label: string; content: string; href?: string }) => (
    <Tooltip>
        <TooltipTrigger asChild>
            <TableCell>
                {href ? (
                    <Link
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        aria-label={content}
                    >
                        {label}
                    </Link>
                ) : (
                    <span aria-label={content}>{label}</span>
                )}
            </TableCell>
        </TooltipTrigger>
        <TooltipContent>
            <p>{content}</p>
        </TooltipContent>
    </Tooltip>
);

// Main Component
export const MtrTable = memo(({ data, sourceInfo, target }: MtrTableProps) => {
    const [startTime] = useState(getFormattedTimestamp());
    const [resolvedTarget, setResolvedTarget] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const resolveTarget = async () => {
            if (!target) return;

            setIsLoading(true);
            try {
                const { isIp } = isIPAddress(target);
                const resolved = await resolveDns(target, isIp, sourceInfo?.ips);
                setResolvedTarget(resolved);
            } catch (error) {
                console.error("Failed to resolve DNS:", error);
                setResolvedTarget(null);
            } finally {
                setIsLoading(false);
            }
        };

        resolveTarget();
    }, [target, sourceInfo]);

    return (
        <Table className="text-xs font-mono">
            <TableHeader>
                {sourceInfo && (
                    <>
                        <TableRow>
                            <TableCell colSpan={10}>Start: {startTime}</TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell colSpan={10}>
                                {sourceInfo.hostname} ({sourceInfo.ips?.[0] || "unknown"}) -&gt; {target}
                                {resolvedTarget && ` (${resolvedTarget})`}
                                {isLoading && " (resolving...)"}
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
                            className={`${row.isHidden ? "hidden" : ""} text-xs`}
                            aria-hidden={row.isHidden}
                        >
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
                            <TableCell>{isNaN(row.LossPercent) ? 0.0 : row.LossPercent.toFixed(1)}</TableCell>
                            <TableCell>{row.SentPackets.length}</TableCell>
                            <TableCell>{row.Last === Infinity ? "N/A" : row.Last.toFixed(2)}</TableCell>
                            <TableCell>{row.Avg === 0 ? "N/A" : row.Avg.toFixed(2)}</TableCell>
                            <TableCell>{row.Best === Infinity ? "N/A" : row.Best.toFixed(2)}</TableCell>
                            <TableCell>{row.Worst === -Infinity ? "N/A" : row.Worst.toFixed(2)}</TableCell>
                            <TableCell>{isNaN(row.StDev) ? "N/A" : row.StDev.toFixed(2)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </TooltipProvider>
        </Table>
    );
});

MtrTable.displayName = "MtrTable";