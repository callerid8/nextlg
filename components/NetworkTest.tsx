"use client";

// React and Next.js imports
import { useState, useCallback, useMemo, useEffect } from "react";
//import Link from "next/link";

// Third-party imports
import { useForm, Controller } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";

// Local components
import LoadingSpinner from "@/components/LoadingSpinner";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Card, CardContent, CardDescription,
    CardFooter, CardHeader, CardTitle
} from "@/components/ui/card";
import { MtrTable } from "@/components/MtrTable";

// Utils and types
import { expandIPv6, DNS_API_URL, LOCALSTORAGE_CACHE_DURATION } from "@/utils/network";
import type { MtrData } from "@/types/network";

// Types and Interfaces
interface MtrHead {
    hostname: string;
    ips: string[];
}

// Constants
const MAX_PACKETS = 100;
const reservedIPv4Regex = /^(?:0\.0\.0\.|10\.(?:[0-9]{1,2}\.){2}|100\.(?:6[4-9]|7[0-9]|8[0-9]|9[0-9])\.(?:[0-9]{1,2}\.)|127\.(?:[0-9]{1,2}\.){2}|169\.254\.(?:[0-9]{1,2}\.)|172\.(?:1[6-9]|2[0-9]|3[0-1])\.(?:[0-9]{1,2}\.)|192\.(?:0\.0\.|0\.2\.|168\.)|198\.(?:1[8-9]\.|51\.(?:100\.))|203\.0\.113\.|2(?:2[4-9]|3[0-9])\.(?:[0-9]{1,2}\.){2}|240\.(?:[0-9]{1,2}\.){3}|255\.255\.255\.255)$/;
const reservedIPv6Regex = /^(?::|fe80:|fc00:|fd00:|::1$)/i;

// Environment variables
/*const ENV = {
    ipv4Address: process.env.NEXT_PUBLIC_IPV4_ADDRESS || "127.0.0.1",
    ipv6Address: process.env.NEXT_PUBLIC_IPV6_ADDRESS || "::1",
    file1Url: process.env.NEXT_PUBLIC_FILE1_URL || "/api/download/10mb",
    file1Size: process.env.NEXT_PUBLIC_FILE1_SIZE || "10MB",
    file2Url: process.env.NEXT_PUBLIC_FILE2_URL || "/api/download/100mb",
    file2Size: process.env.NEXT_PUBLIC_FILE2_SIZE || "100MB",
    file3Url: process.env.NEXT_PUBLIC_FILE3_URL || "/api/download/250mb",
    file3Size: process.env.NEXT_PUBLIC_FILE3_SIZE || "250MB",
};*/

// Form Schema
const formSchema = z.object({
    targetHost: z.string()
        .min(1, "Target host is required")
        .refine(host => {
            const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
            const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,7}:|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}$|^([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}$|^([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}$|^([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})$|^:((:[0-9a-fA-F]{1,4}){1,7}|:)$/;
            const domainRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
            return ipv4Regex.test(host) || ipv6Regex.test(host) || domainRegex.test(host);
        }, "Invalid IP address or domain name"),
    command: z.enum(["host", "ping", "mtr", "livemtr", "ping6", "mtr6", "livemtr6"]),
});

type FormValues = z.infer<typeof formSchema>;

// Utility Functions
const createDefaultMtrRow = ((hop: number): MtrData => ({
    Hop: hop,
    ASN: "N/A",
    Prefix: "N/A",
    Host: "N/A",
    SentPackets: [],
    ReceivedPackets: [],
    Pings: [],
    Last: Infinity,
    Best: Infinity,
    Worst: -Infinity,
    Avg: 0,
    StDev: 0,
    LossPercent: 0,
    isHidden: false,
}));

const handleHostLine = async (
    currentRow: MtrData,
    prevRow: MtrData | undefined,
    host: string,
    fetchASN: (reversedHost: string, cacheKey: string, currentRow: MtrData) => Promise<void>
) => {
    currentRow.Host = host;
    currentRow.isHidden = host === prevRow?.Host;

    // Skip ASN lookup for reserved/private addresses
    if (reservedIPv4Regex.test(host) || reservedIPv6Regex.test(host)) {
        return;
    }

    let reversedHost: string;
    let cacheKey: string;

    if (host.includes(':')) {
        // Handle IPv6 address with proper expansion
        const expanded = expandIPv6(host);

        if (expanded.length !== 32) {
            return;
        }

        // Properly format for ASN lookup
        reversedHost = expanded
            .split('')
            .reverse()
            .join('.');
        cacheKey = `asn6_${host}`; // Use original host for cache key

    } else {
        // Handle IPv4 address
        reversedHost = host
            .split('.')
            .slice(0, 3)
            .reverse()
            .join('.');
        cacheKey = `asn4_${host}`;
    }

    // Check cache
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
        try {
            const { asn, prefix, timestamp } = JSON.parse(cachedData);
            if (Date.now() - timestamp < LOCALSTORAGE_CACHE_DURATION) {
                currentRow.ASN = asn;
                currentRow.Prefix = prefix;
                return;
            }
        } catch {
            // Cache invalid or expired, continue to fetch
        }
    }

    await fetchASN(reversedHost, cacheKey, currentRow);
};

const handlePingLine = (
    currentRow: MtrData,
    lastTime: number,
    recPacket: number,
    updateMtrRow: (row: MtrData, lastTime: number) => void,
    updateLossPercentage: (hop: number) => void
) => {
    if (!isNaN(recPacket) && !isNaN(lastTime) && lastTime > 0) {
        if (!currentRow.ReceivedPackets.includes(recPacket)) {
            currentRow.ReceivedPackets.push(recPacket);
            updateMtrRow(currentRow, lastTime);
            updateLossPercentage(currentRow.Hop);
        }
    }
};

const handleSentPacketLine = (
    currentRow: MtrData,
    sentPacket: number,
    updateLossPercentage: (hop: number) => void
) => {
    if (!isNaN(sentPacket) && !currentRow.SentPackets.includes(sentPacket)) {
        currentRow.SentPackets.push(sentPacket);

        if (0 === currentRow.SentPackets.length % 5) {
            updateLossPercentage(currentRow.Hop);
        }
    }
};

export default function NetworkTest() {
    const [output, setOutput] = useState<string>("");
    const [mtrHead, setMtrHead] = useState<MtrHead>();
    const [mtrDataArray, setMtrDataArray] = useState<MtrData[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>("");
    const [targetHost, setTargetHost] = useState("");
    //const [clearError] = useState(() => () => setError(""));

    const ipv4Address = process.env.NEXT_PUBLIC_IPV4_ADDRESS || "127.0.0.1";
    const ipv6Address = process.env.NEXT_PUBLIC_IPV6_ADDRESS || "::1";

    // Get the file URLs from environment variables
    const file1Url = process.env.NEXT_PUBLIC_FILE1_URL || "/api/download/10mb";
    const file1Size = process.env.NEXT_PUBLIC_FILE1_SIZE || "10MB";
    const file2Url = process.env.NEXT_PUBLIC_FILE2_URL || "/api/download/100mb";
    const file2Size = process.env.NEXT_PUBLIC_FILE2_SIZE || "100MB";
    const file3Url = process.env.NEXT_PUBLIC_FILE3_URL || "/api/download/250mb";
    const file3Size = process.env.NEXT_PUBLIC_FILE3_SIZE || "250MB";

    // Add new state for available commands
    const [availableCommands, setAvailableCommands] = useState<FormValues['command'][]>([
        "host", "ping", "mtr", "livemtr", "ping6", "mtr6", "livemtr6",
    ]);

    // Form setup needs to come before any hooks that use its methods
    const { control, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
        defaultValues: {
            targetHost: "",
            command: "ping",
        },
        resolver: zodResolver(formSchema),
    });

    // Add input type detection
    const detectInputType = useCallback((input: string) => {
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,7}:|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}$|^([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}$|^([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}$|^([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})$|^:((:[0-9a-fA-F]{1,4}){1,7}|:)$/;

        if (ipv4Regex.test(input)) return 'ipv4';
        if (ipv6Regex.test(input)) return 'ipv6';
        return 'host';
    }, []);

    // Update commands based on input type with memoized function
    const updateAvailableCommands = useCallback((input: string) => {
        const type = detectInputType(input);
        const baseCommands: FormValues['command'][] = ["host"];
        let newCommands: FormValues['command'][];

        switch (type) {
            case 'ipv4':
                newCommands = [...baseCommands, "ping", "mtr", "livemtr",];
                break;
            case 'ipv6':
                newCommands = [...baseCommands, "ping6", "mtr6", "livemtr6"];
                break;
            default:
                newCommands = [
                    ...baseCommands,
                    "ping", "mtr", "livemtr", "ping6", "mtr6", "livemtr6",
                ];
        }

        setAvailableCommands(newCommands);

        const currentCommand = watch('command');
        if (!newCommands.includes(currentCommand)) {
            setValue('command', type === 'ipv6' ? 'ping6' : 'ping');
        }
    }, [detectInputType, watch, setValue]);

    // Single effect to handle input changes
    useEffect(() => {
        const subscription = watch((value, { name }) => {
            if (name === 'targetHost') {
                updateAvailableCommands(value.targetHost || '');
            }
        });
        return () => subscription.unsubscribe();
    }, [watch, updateAvailableCommands]);

    // Memoize the stats calculation
    const calculateStats = useCallback((pings: number[]) => {
        const validPings = pings.filter((p) => p > 0 && p !== Infinity);
        if (validPings.length === 0) {
            return { avg: 0, min: Infinity, max: -Infinity, stdev: 0 };
        }

        const avg = validPings.reduce((a, b) => a + b, 0) / validPings.length;
        const variance = validPings.reduce((acc, ping) => acc + Math.pow(ping - avg, 2), 0) / validPings.length;

        return {
            avg: avg / 1000,
            min: Math.min(...validPings) / 1000,
            max: Math.max(...validPings) / 1000,
            stdev: Math.sqrt(variance) / 1000,
        };
    }, []);

    // Memoize the MTR row update
    const updateMtrRow = useCallback((row: MtrData, lastTime: number): void => {
        if (lastTime > 0) {
            row.Pings.push(lastTime);
            if (row.Pings.length > MAX_PACKETS) {
                row.Pings.shift();
            }
            const stats = calculateStats(row.Pings);
            row.Last = lastTime / 1000;
            row.Avg = stats.avg;
            row.Best = stats.min;
            row.Worst = stats.max;
            row.StDev = stats.stdev;
        }
    }, [calculateStats]);

    // Memoize the loss percentage update
    const updateLossPercentage = useCallback((hop: number): void => {
        setMtrDataArray(prev => {
            const rowIndex = prev.findIndex(row => row.Hop === hop);
            if (rowIndex !== -1) {
                const row = prev[rowIndex];
                if (row.SentPackets.length === 0) {
                    row.LossPercent = 0;
                    return [...prev.slice(0, rowIndex), row, ...prev.slice(rowIndex + 1)];
                }
                //const receivedSet = new Set(row.ReceivedPackets);
                //const lostPackets = row.SentPackets.filter((seq) => !row.ReceivedPackets.includes(seq));
                row.LossPercent = ((row.SentPackets.length - row.ReceivedPackets.length) / row.SentPackets.length) * 100;
            }
            return prev;
        });
    }, []);

    // Memoize the ASN fetch
    const fetchASN = useCallback(async (reversedHost: string, cacheKey: string, currentRow: MtrData) => {
        try {
            const queryHost = cacheKey.startsWith('asn6_')
                ? `${reversedHost}.origin6.asn.cymru.com`
                : `${reversedHost}.origin.asn.cymru.com`;

            const asnLookupUrl = `${DNS_API_URL}?name=${queryHost}&type=txt`;
            const response = await fetch(asnLookupUrl);

            if (!response.ok) return;

            const data = await response.json();
            if (!data.Answer?.[0]?.data) return;

            const asnData = data.Answer[0].data.split('|').map((s: string) => s.trim());
            if (asnData.length < 2) return;

            const asn = asnData[0].split(' ')[0];
            const prefix = asnData[1].split(' ')[0];

            if (asn && prefix) {
                currentRow.ASN = asn;
                currentRow.Prefix = prefix;
                localStorage.setItem(cacheKey, JSON.stringify({
                    asn,
                    prefix,
                    timestamp: Date.now()
                }));
            }
        } catch {
            // Silently handle errors
        }
    }, []);

    // Update the parseMtrLine function to use the new handlers
    const parseMtrLine = useCallback((line: string, prev: MtrData[]): MtrData[] => {
        const lines = line.split("\n").filter((l) => l.trim());
        const newRows = [...prev];

        for (const singleLine of lines) {
            const [type, ...parts] = singleLine.split(/\s+/).filter(Boolean);
            if (!parts[0]) continue;

            const hop = parseInt(parts[0], 10);
            if (isNaN(hop) || hop < 0) continue;

            const currentRow = newRows.find(row => row.Hop === hop) || createDefaultMtrRow(hop);
            const prevRow = newRows.find(row => row.Hop === hop - 1);

            if ("h" === type) {
                if (parts[1]) {
                    handleHostLine(currentRow, prevRow, parts[1], fetchASN);
                }
            }
            if ("p" === type) {
                if (parts[1] && parts[2]) {
                    const lastTime = parseFloat(parts[1]);
                    const recPacket = parseInt(parts[2], 10);
                    handlePingLine(currentRow, lastTime, recPacket, updateMtrRow, updateLossPercentage);
                }
            }
            if ("x" === type) {
                if (parts[1]) {
                    const sentPacket = parseInt(parts[1], 10);
                    handleSentPacketLine(currentRow, sentPacket, updateLossPercentage);
                }
            }

            const rowIndex = newRows.findIndex(row => row.Hop === hop);
            if (rowIndex !== -1) {
                newRows[rowIndex] = currentRow;
            } else {
                newRows.push(currentRow);
            }
        }

        return newRows //.sort((a, b) => a.Hop - b.Hop);
    }, [updateMtrRow, updateLossPercentage, fetchASN]);

    // Handle streamed response
    const handleStreamedResponse = useCallback(async (response: Response, command: string) => {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const result = await reader?.read();
            if (!result || result.done) break;

            const chunk = decoder.decode(result.value);
            const outputLines = chunk.split("data: ").filter(line => line.trim());

            for (const line of outputLines) {
                try {
                    if (command.startsWith("livemtr")) {
                        const data = JSON.parse(line);
                        if (data.type === "system_info") {
                            setMtrHead({ hostname: data.hostname, ips: data.ips });
                        } else if (data.output !== undefined) {
                            setMtrDataArray(prev => parseMtrLine(data.output, prev));
                        }
                    } else {
                        const data = JSON.parse(line);
                        if (data.error) {
                            setOutput(prev => `${prev}\nError: ${data.error}`);
                        } else if (data.output) {
                            setOutput(prev => `${prev}${data.output}`);
                        }
                    }
                } catch (error) {
                    setOutput(prev => `${prev}\nError parsing output: ${error instanceof Error ? error.message : "Unknown error"}`);
                }
            }
        }
    }, [parseMtrLine]);

    // Handle form submission
    const onSubmit = useCallback(async (values: FormValues) => {
        setOutput("");
        setMtrDataArray([]);
        setIsLoading(true);
        setError("");
        setTargetHost(values.targetHost);

        try {
            const response = await fetch("/api/command", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values),
            });

            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

            await handleStreamedResponse(response, values.command);
        } catch (error) {
            setError(error instanceof Error ? error.message : "Network error. Please try again later.");
        } finally {
            setIsLoading(false);
        }
    }, [handleStreamedResponse]);

    // Memoize the sorted MTR data
    const sortedMtrData = useMemo(() =>
        [...mtrDataArray].sort((a, b) => a.Hop - b.Hop),
        [mtrDataArray]
    );

    return (
        <Card className="w-full max-w-md lg:max-w-3xl">
            <CardHeader>
                <CardTitle>Network Information</CardTitle>
                <CardDescription>
                    Test connectivity to a remote host using ping, host lookup, or MTR
                </CardDescription>
                {ipv4Address && (
                    <p className="p-2 space-x-2 text-sm">
                        <span>Test IPv4:</span><span className="font-semibold">{ipv4Address}</span>
                    </p>
                )}
                {ipv6Address && (
                    <p className="p-2 space-x-2 text-sm">
                        <span>Test IPv6:</span><span className="font-semibold">{ipv6Address}</span>
                    </p>
                )}
                <p className="p-2 space-y-2 space-x-2 text-sm hidden lg:block">
                    <span className="">Test Files:</span>
                    <a href={file1Url} className="font-semibold hover:underline dark:text-blue-400 text-blue-600">{file1Size}</a>
                    <a href={file2Url} className="font-semibold hover:underline dark:text-blue-400 text-blue-600">{file2Size}</a>
                    <a href={file3Url} className="font-semibold hover:underline dark:text-blue-400 text-blue-600">{file3Size}</a>
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="flex flex-col sm:flex-row md:space-x-2 space-y-2 sm:space-y-0">
                        <Controller
                            name="targetHost"
                            control={control}
                            render={({ field }) => (
                                <Input
                                    {...field}
                                    type="text"
                                    placeholder="Enter target host (IP or domain)"
                                    className="w-full flex-1 text-sm md:text-md"
                                    disabled={isLoading}
                                    aria-invalid={!!errors.targetHost}
                                    aria-describedby={errors.targetHost ? "target-host-error" : undefined}
                                />
                            )}
                        />
                        <Controller
                            name="command"
                            control={control}
                            render={({ field }) => (
                                <Select
                                    onValueChange={field.onChange}
                                    value={field.value}
                                >
                                    <SelectTrigger
                                        className="sm:w-32 w-full flex-shrink-0"
                                        disabled={isLoading}
                                        aria-invalid={!!errors.command}
                                    >
                                        <SelectValue placeholder="Select command" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableCommands.map(cmd => (
                                            <SelectItem key={cmd} value={cmd}>
                                                {cmd === "livemtr" ? "mtr (live)" :
                                                    cmd === "livemtr6" ? "mtr -6 (live)" :
                                                        cmd === "mtr6" ? "mtr -6" :
                                                            cmd === "ping6" ? "ping -6" : cmd}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="w-full sm:w-24 flex-shrink-0"
                        >
                            {isLoading ? <LoadingSpinner /> : 'Run Test'}
                        </Button>
                    </div>
                    {errors.targetHost && (
                        <p id="target-host-error" className="mt-1 text-red-500 text-sm">
                            {errors.targetHost.message}
                        </p>
                    )}
                </form>
            </CardContent>
            <CardFooter>
                {error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                {output && (
                    <div className="w-full">
                        <Textarea
                            value={output}
                            readOnly
                            className="h-72 min-w-3xl resize-none overflow-x-auto font-mono text-xs md:text-sm"
                            aria-label="Command output"
                        />
                    </div>
                )}
                {sortedMtrData.length > 0 && (
                    <div className="w-full overflow-x-auto">
                        <MtrTable
                            data={sortedMtrData}
                            sourceInfo={mtrHead}
                            target={targetHost}
                        />
                    </div>
                )}
            </CardFooter>
        </Card>
    );
}
