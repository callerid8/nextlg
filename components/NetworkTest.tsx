// components/NetworkTest.tsx
"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useForm, Controller, set } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Card, CardContent, CardDescription,
    CardFooter, CardHeader, CardTitle
} from "@/components/ui/card";
import { MtrTable } from "@/components/MtrTable";
import { parseMtrLine, type MtrData } from "@/lib/mtr";

interface ChunkData {
    error?: string;
    output?: string;
}

interface MtrHead {
    hostname: string;
    ips: string[];
}

const formSchema = z.object({
    targetHost: z.string()
        .min(1, "Target host is required")
        .refine(host => {
            const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
            // Updated domain regex to allow numbers in TLD
            const domainRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
            return ipv4Regex.test(host) || domainRegex.test(host);
        }, "Invalid IP address or domain name"),
    command: z.enum(["ping", "host", "mtr", "livemtr", "ping6", "mtr6"]),
});

type FormValues = z.infer<typeof formSchema>;

const LoadingSpinner = () => (
    <div
        className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
        role="status"
        aria-label="Loading"
    >
        <span className="sr-only">Loading...</span>
    </div>
);

export function NetworkTest() {
    const [output, setOutput] = useState<string>("");
    const [mtrHead, setMtrHead] = useState<Map<number, MtrHead>>(new Map());
    const [mtrDataMap, setMtrDataMap] = useState<Map<number, MtrData>>(new Map());
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>("");

    const ipv4Address = process.env.NEXT_PUBLIC_IPV4_ADDRESS || "";
    const ipv6Address = process.env.NEXT_PUBLIC_IPV6_ADDRESS || "";

    // Get the file URLs from environment variables
    const file1Url = process.env.NEXT_PUBLIC_FILE1_URL || "";
    const file1Size = process.env.NEXT_PUBLIC_FILE1_SIZE || "10MB";
    const file2Url = process.env.NEXT_PUBLIC_FILE2_URL || "";
    const file2Size = process.env.NEXT_PUBLIC_FILE2_SIZE || "100MB";
    const file3Url = process.env.NEXT_PUBLIC_FILE3_URL || "";
    const file3Size = process.env.NEXT_PUBLIC_FILE3_SIZE || "250MB";


    const { control, handleSubmit, formState: { errors } } = useForm<FormValues>({
        defaultValues: {
            targetHost: "",
            command: "ping",
        },
        resolver: zodResolver(formSchema),
    });

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
                        //console.log(data)
                        if (data.type === "system_info") {
                            setMtrHead(prev => new Map(prev).set(0, { hostname: data.hostname, ips: data.ips }));
                        }
                        else if (data.output !== undefined) {
                            setMtrDataMap(prev => parseMtrLine(data.output, prev));
                        }
                    } else {
                        const data = JSON.parse(line) as ChunkData;
                        if (data.error) {
                            setOutput(prev => `${prev}\nError: ${data.error}`);
                        } else if (data.output) {
                            setOutput(prev => `${prev}${data.output}`);
                        }
                    }
                } catch (error) {
                    console.error("Failed to parse event data:", error);
                    setOutput(prev => `${prev}\nError parsing output: ${error instanceof Error ? error.message : "Unknown error"}`);
                }
            }
        }
    }, []);

    const onSubmit = useCallback(async (values: FormValues) => {
        setOutput("");
        setMtrDataMap(new Map());
        setIsLoading(true);
        setError("");

        try {
            const response = await fetch("/api/command", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values),
            });

            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

            await handleStreamedResponse(response, values.command);
        } catch (error) {
            console.error("Fetch failed:", error);
            setError(error instanceof Error ? error.message : "Network error. Please try again later.");
        } finally {
            setIsLoading(false);
        }
    }, [handleStreamedResponse]);

    const sortedMtrData = useMemo(() =>
        [...mtrDataMap.values()].sort((a, b) => a.Hop - b.Hop),
        [mtrDataMap]
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
                <p className="p-2 space-y-2 space-x-2 text-sm hidden lg:block"><span className="">Test Files:</span>

                    <Link href={`${file1Url !== "" ? file1Url : "/api/download/10mb"}`} className="font-semibold hover:underline dark:text-blue-400 text-blue-600">
                        {file1Size}
                    </Link>
                    <Link href={`${file2Url !== "" ? file2Url : "/api/download/100mb"}`} className="font-semibold hover:underline dark:text-blue-400 text-blue-600">
                        {file2Size}
                    </Link>
                    <Link href={`${file3Url !== "" ? file3Url : "/api/download/250mb"}`} className="font-semibold hover:underline dark:text-blue-400 text-blue-600">
                        {file3Size}
                    </Link>
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
                                    type="text"
                                    placeholder="Enter target host (IP or domain)"
                                    {...field}
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
                                        <SelectItem value="host">host</SelectItem>
                                        <SelectItem value="mtr">mtr</SelectItem>
                                        <SelectItem value="livemtr">mtr --live</SelectItem>
                                        {ipv6Address && (<SelectItem value="mtr6">mtr -6</SelectItem>)}
                                        <SelectItem value="ping">ping</SelectItem>
                                        {ipv6Address && (<SelectItem value="ping6">ping -6</SelectItem>)}
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
                            sourceInfo={mtrHead.get(0)}
                            target={control._formValues.targetHost}
                        />
                    </div>
                )}
            </CardFooter>
        </Card>
    );
}
