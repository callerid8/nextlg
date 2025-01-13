"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

// Constants
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
const TEST_SIZES = {
    SMALL: {
        download: 16 * 1024 * 1024,  // 16MB
        upload: 4 * 1024 * 1024,     // 4MB
        label: 'Small (16MB ↓, 4MB ↑)'
    },
    MEDIUM: {
        download: 64 * 1024 * 1024,  // 64MB
        upload: 16 * 1024 * 1024,    // 16MB
        label: 'Medium (64MB ↓, 16MB ↑)'
    },
    LARGE: {
        download: 128 * 1024 * 1024, // 128MB
        upload: 32 * 1024 * 1024,    // 32MB
        label: 'Large (128MB ↓, 32MB ↑)'
    }
} as const;
const CONCURRENT_REQUESTS = 8;
const MAX_RETRIES = 3;
const PROGRESS_UPDATE_INTERVAL = 100; // 500ms
const TEST_TIMEOUT = 60000; // 1 minute timeout

interface SpeedTestResults {
    downloadSpeed: number;
    uploadSpeed: number;
}

const LoadingSpinner = () => (
    <div
        className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
        role="status"
        aria-label="Loading"
    >
        <span className="sr-only">Loading...</span>
    </div>
);

const clearCache = async () => {
    if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
};

export function Speedtest() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string>("");
    const [progress, setProgress] = useState(0);
    const [currentTest, setCurrentTest] = useState<"download" | "upload" | null>(null);
    const [results, setResults] = useState<SpeedTestResults | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [testSize, setTestSize] = useState(TEST_SIZES.MEDIUM);
    const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);
    const [detailedError, setDetailedError] = useState<{
        type: 'network' | 'timeout' | 'unknown';
        message: string;
    } | null>(null);

    const createRandomChunks = useCallback((size: number, chunkSize: number): Uint8Array[] => {
        const chunks: Uint8Array[] = [];
        const maxCryptoSize = 65536; // Max size for crypto.getRandomValues

        for (let i = 0; i < size; i += chunkSize) {
            const length = Math.min(chunkSize, size - i);
            const chunk = new Uint8Array(length);

            for (let j = 0; j < length; j += maxCryptoSize) {
                const subLength = Math.min(maxCryptoSize, length - j);
                const tempBuffer = new Uint8Array(subLength);
                crypto.getRandomValues(tempBuffer);
                chunk.set(tempBuffer, j);
            }

            chunks.push(chunk);
        }

        return chunks;
    }, []);

    useEffect(() => {
        return () => {
            abortControllerRef.current?.abort();
        };
    }, []);

    const handleTimeout = useCallback(() => {
        abortControllerRef.current?.abort();
        setError("Test timed out. Please check your connection and try again.");
        setDetailedError({
            type: 'timeout',
            message: 'The test took too long to complete. Please try again.'
        });
        setIsLoading(false);
    }, []);

    const downloadChunk = useCallback(async (chunkId: number, retryCount = 0): Promise<ArrayBuffer> => {
        try {
            const uniqueId = `${Date.now()}-${chunkId}`;
            const response = await fetch(`/api/speedtest/${uniqueId}`, {
                signal: abortControllerRef.current?.signal,
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error(`Chunk download failed (ID: ${chunkId})`);
            }

            return await response.arrayBuffer();
        } catch (error) {
            if (retryCount < MAX_RETRIES && !abortControllerRef.current?.signal.aborted) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
                return downloadChunk(chunkId, retryCount + 1);
            }
            throw error;
        }
    }, [abortControllerRef]);

    const uploadChunk = useCallback(async (chunk: Uint8Array, chunkId: number, retryCount = 0): Promise<void> => {
        try {
            const uniqueId = `${Date.now()}-${chunkId}`;
            const response = await fetch(`/api/speedtest/${uniqueId}`, {
                method: "POST",
                body: chunk,
                signal: abortControllerRef.current?.signal,
                headers: {
                    "Content-Type": "application/octet-stream",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache"
                }
            });

            if (!response.ok) {
                throw new Error(`Chunk upload failed (ID: ${chunkId})`);
            }
        } catch (error) {
            if (retryCount < MAX_RETRIES && !abortControllerRef.current?.signal.aborted) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
                return uploadChunk(chunk, chunkId, retryCount + 1);
            }
            throw error;
        }
    }, [abortControllerRef]);

    const runTest = useCallback(async (
        isUpload: boolean,
        chunkHandler: (chunkId: number) => Promise<ArrayBuffer | void>
    ) => {
        const startTime = performance.now();
        let totalBytes = 0;
        let lastProgressUpdate = startTime;

        const size = isUpload ? testSize.upload : testSize.download;
        const TOTAL_CHUNKS = Math.ceil(size / CHUNK_SIZE);
        let completedChunks = 0;
        const activePromises = new Set();
        const chunkQueue = Array.from({ length: TOTAL_CHUNKS }, (_, i) => i);

        while (chunkQueue.length > 0 || activePromises.size > 0) {
            while (chunkQueue.length > 0 && activePromises.size < CONCURRENT_REQUESTS) {
                const chunkId = chunkQueue.shift()!;
                const promise = chunkHandler(chunkId)
                    .then(() => {
                        totalBytes += CHUNK_SIZE;
                        completedChunks++;

                        const now = performance.now();
                        if (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL) {
                            setProgress((completedChunks / TOTAL_CHUNKS) * 100);
                            lastProgressUpdate = now;
                        }

                        activePromises.delete(promise);
                    })
                    .catch(error => {
                        console.error("Test error:", error.message);
                        activePromises.delete(promise);
                        throw error;
                    });

                activePromises.add(promise);
            }

            if (activePromises.size > 0) {
                await Promise.race(Array.from(activePromises));
            }
        }

        setProgress(100);

        const endTime = performance.now();
        const durationInSeconds = (endTime - startTime) / 1000;
        const speedMbps = (totalBytes * 8) / (1024 * 1024 * durationInSeconds);

        return speedMbps;
    }, [testSize]);

    const runDownloadTest = useCallback(async () => {
        setCurrentTest("download");
        setProgress(0);

        try {
            const speed = await runTest(false, downloadChunk);
            setResults(prev => ({
                downloadSpeed: speed,
                uploadSpeed: prev?.uploadSpeed || 0
            }));
        } catch (err) {
            if (!abortControllerRef.current?.signal.aborted) {
                setError("Download test failed. Please try again.");
                console.error("Download test error:", err);
            }
        }
    }, [runTest, downloadChunk]);

    const runUploadTest = useCallback(async () => {
        setCurrentTest("upload");
        setProgress(0);

        try {
            const chunks = createRandomChunks(testSize.upload, CHUNK_SIZE);
            const speed = await runTest(true,
                (chunkId) => uploadChunk(chunks[chunkId], chunkId)
            );
            setResults(prev => ({
                downloadSpeed: prev?.downloadSpeed || 0,
                uploadSpeed: speed
            }));
        } catch (err) {
            if (!abortControllerRef.current?.signal.aborted) {
                setError("Upload test failed. Please try again.");
                setDetailedError({
                    type: 'network',
                    message: 'Upload test failed. Check your connection and try again.'
                });
                console.error("Upload test error:", err);
            }
        }
    }, [runTest, uploadChunk, testSize]);

    const runSpeedTest = async () => {
        if (timeoutId) clearTimeout(timeoutId);

        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        // Set isLoading first, then clear other states
        setIsLoading(true);
        setError("");
        setDetailedError(null);
        setResults(null);

        // Use a setTimeout to ensure the state update is applied before proceeding
        await new Promise(resolve => setTimeout(resolve, 0));

        const newTimeoutId = setTimeout(handleTimeout, TEST_TIMEOUT);
        setTimeoutId(newTimeoutId);

        try {
            await clearCache();
            await runDownloadTest();
            await runUploadTest();
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
            console.error("Speed test error:", errorMessage);

            setDetailedError({
                type: 'unknown',
                message: 'An unexpected error occurred. Please try again.'
            });
        } finally {
            clearTimeout(newTimeoutId);
            setTimeoutId(null);
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    };

    return (
        <Card className="w-full max-w-md lg:max-w-3xl">
            <CardHeader className="flex">
                <CardTitle>Speed Test</CardTitle>
                <CardDescription className="space-y-4">
                    <div>Test your connection speed to this server</div>
                    <div className="grid grid-rows-2 lg:grid-cols-2 lg:items-start space-y-2 md:space-y-0">
                        <div>
                            <Select
                                value={JSON.stringify(testSize)}
                                onValueChange={(value) => setTestSize(JSON.parse(value))}
                                disabled={isLoading}
                            >
                                <SelectTrigger className="w-[280px]">
                                    <SelectValue placeholder="Test Size" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={JSON.stringify(TEST_SIZES.SMALL)}>{TEST_SIZES.SMALL.label}</SelectItem>
                                    <SelectItem value={JSON.stringify(TEST_SIZES.MEDIUM)}>{TEST_SIZES.MEDIUM.label}</SelectItem>
                                    <SelectItem value={JSON.stringify(TEST_SIZES.LARGE)}>{TEST_SIZES.LARGE.label}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div><div>
                            <Button
                                onClick={runSpeedTest}
                                disabled={isLoading}
                                className="w-full"
                            >
                                {isLoading ? <LoadingSpinner /> : "Run Speed Test →"}
                            </Button>
                        </div>
                    </div>

                </CardDescription>

            </CardHeader>
            <CardContent className="space-y-4">


                {error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <div className="space-y-2">
                    {currentTest && (
                        <>
                            <div className="flex justify-between text-sm">
                                <span>Testing {currentTest === "download" ? "download" : "upload"} speed...</span>
                                <span>{Math.round(progress)}%</span>
                            </div>
                            <Progress value={progress} />
                        </>
                    )}
                </div>

                {results && (
                    <div className="grid grid-cols-2 gap-2 py-2 items-center space-y-2">
                        <div>
                            <p className="text-sm font-medium">Download↓</p>
                            <p className="text-2xl font-bold">{results.downloadSpeed.toFixed(2)} Mbps</p>
                        </div>
                        <div>
                            <p className="text-sm font-medium">Upload↑</p>
                            <p className="text-2xl font-bold">{results.uploadSpeed.toFixed(2)} Mbps</p>
                        </div>
                    </div>
                )}

                {detailedError && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                            {detailedError.message}
                            {detailedError.type === 'network' && (
                                <Button variant="link" onClick={() => window.location.reload()}>
                                    Refresh page
                                </Button>
                            )}
                        </AlertDescription>
                    </Alert>
                )}
            </CardContent>
        </Card>
    );
}
