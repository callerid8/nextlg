"use client";

// React imports
import { useState, useCallback, useEffect, useRef } from "react";

// UI Components
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import LoadingSpinner from "@/components/LoadingSpinner";
import { AlertCircle } from "lucide-react";

// Types and Interfaces
interface SpeedTestResults {
    downloadSpeed: number;
    uploadSpeed: number;
    currentDownloadSpeed?: number;
    currentUploadSpeed?: number;
}

interface TestMetrics {
    startTime: number;
    bytesTransferred: number;
    lastProgress: number;
}

// Constants
const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB base chunk size
const MIN_CHUNK_SIZE = 256 * 1024;  // 256KB minimum
const MAX_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB maximum
const INITIAL_CHUNK_SIZE = 2 * 1024 * 1024; // Start with 2MB chunks
const CONCURRENT_REQUESTS = 8;
const MAX_RETRIES = 3;
const TEST_TIMEOUT = 60000; // 1 minute timeout
const TEST_DURATION = 5000; // 5 seconds per test
const UPLOAD_CHUNK_POOL_SIZE = 4;

// Utility Functions
const clearCache = async () => {
    if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
};

// Main Component
export function Speedtest() {
    // State declarations
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string>("");
    const [progress, setProgress] = useState(0);
    const [currentTest, setCurrentTest] = useState<"download" | "upload" | null>(null);
    const [results, setResults] = useState<SpeedTestResults | null>(null);
    const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);
    const [detailedError, setDetailedError] = useState<{
        type: 'network' | 'timeout' | 'unknown';
        message: string;
    } | null>(null);

    // Refs
    const abortControllerRef = useRef<AbortController | null>(null);
    const chunkPool = useRef<Uint8Array[]>([]);
    const testMetrics = useRef<TestMetrics>({ startTime: 0, bytesTransferred: 0, lastProgress: 0 });

    const createChunk = useCallback((chunkId: number, size: number): Uint8Array => {
        const chunk = chunkPool.current.length > 0
            ? chunkPool.current.pop()!
            : new Uint8Array(size);

        const view = new DataView(chunk.buffer);
        const pattern = (chunkId & 0xffff) | ((chunkId & 0xff) << 16);

        for (let i = 0; i < size; i += 4) {
            view.setUint32(i, pattern + (i & 0xffff), true);
        }
        return chunk;
    }, []);

    useEffect(() => {
        return () => {
            abortControllerRef.current?.abort();
            performance.clearMarks();
            performance.clearMeasures();
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
                cache: "no-store",
                headers: {
                    "X-Chunk-ID": chunkId.toString(),
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache"
                }
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

    const uploadChunk = useCallback(async (chunkId: number, retryCount = 0): Promise<void> => {
        let chunk: Uint8Array | undefined;
        try {
            // Use the pre-generated chunk from the pool
            chunk = chunkPool.current.shift();
            if (!chunk) {
                throw new Error('No chunks available for upload');
            }

            const uniqueId = `${Date.now()}-${chunkId}`;

            const response = await fetch(`/api/speedtest/${uniqueId}`, {
                method: "POST",
                body: chunk,
                signal: abortControllerRef.current?.signal,
                headers: {
                    "Content-Type": "application/octet-stream",
                    "Content-Length": chunk.length.toString(),
                    "X-Chunk-ID": chunkId.toString(),
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache"
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Upload error:', errorData);
                throw new Error(`Upload failed (${response.status}): ${errorData.error || 'Unknown error'}`);
            }
        } catch (error) {
            if (retryCount < MAX_RETRIES && !abortControllerRef.current?.signal.aborted) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
                return uploadChunk(chunkId, retryCount + 1);
            }
            throw error;
        } finally {
            if (chunk && chunkPool.current.length < UPLOAD_CHUNK_POOL_SIZE) {
                chunkPool.current.push(chunk);
            }
        }
    }, []);

    const runTest = useCallback(async (
        isUpload: boolean,
        chunkHandler: (chunkId: number) => Promise<ArrayBuffer | void>
    ) => {
        testMetrics.current = {
            startTime: performance.now(),
            bytesTransferred: 0,
            lastProgress: 0
        };

        let chunkSize = INITIAL_CHUNK_SIZE;
        let completedChunks = 0;
        const activePromises = new Set();
        const testEndTime = performance.now() + TEST_DURATION;

        let lastSpeedUpdate = performance.now();
        let lastBytes = 0;

        const updateProgress = () => {
            const elapsed = performance.now() - testMetrics.current.startTime;
            setProgress((elapsed / TEST_DURATION) * 100);

            // Update current speed every 200ms
            const now = performance.now();
            if (now - lastSpeedUpdate >= 200) {
                const bytesInInterval = testMetrics.current.bytesTransferred - lastBytes;
                const intervalInSeconds = (now - lastSpeedUpdate) / 1000;
                const currentSpeed = (bytesInInterval * 8) / (1024 * 1024 * intervalInSeconds);

                setResults(prev => ({
                    ...prev || { downloadSpeed: 0, uploadSpeed: 0 },
                    ...(isUpload
                        ? { currentUploadSpeed: currentSpeed }
                        : { currentDownloadSpeed: currentSpeed }
                    )
                }));

                lastSpeedUpdate = now;
                lastBytes = testMetrics.current.bytesTransferred;
            }
        };

        // Dynamic chunk size adjustment
        const adjustChunkSize = (duration: number) => {
            const targetDuration = 200; // Aim for 200ms per chunk
            const ratio = targetDuration / duration;
            const newSize = Math.floor(chunkSize * ratio);
            return Math.max(MIN_CHUNK_SIZE, Math.min(MAX_CHUNK_SIZE, newSize));
        };

        while (performance.now() < testEndTime) {
            while (activePromises.size < CONCURRENT_REQUESTS && performance.now() < testEndTime) {
                const chunkStartTime = performance.now();
                const chunkId = completedChunks++;

                const promise = chunkHandler(chunkId)
                    .then(() => {
                        const chunkDuration = performance.now() - chunkStartTime;
                        testMetrics.current.bytesTransferred += chunkSize;
                        chunkSize = adjustChunkSize(chunkDuration);
                        updateProgress();
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

        const duration = (performance.now() - testMetrics.current.startTime) / 1000;
        const finalSpeed = (testMetrics.current.bytesTransferred * 8) / (1024 * 1024 * duration);
        setResults(prev => ({
            ...prev || { downloadSpeed: 0, uploadSpeed: 0 },
            ...(isUpload
                ? { uploadSpeed: finalSpeed, currentUploadSpeed: undefined }
                : { downloadSpeed: finalSpeed, currentDownloadSpeed: undefined }
            )
        }));
        return finalSpeed;
    }, []);

    const runDownloadTest = useCallback(async () => {
        setCurrentTest("download");
        setProgress(0);

        try {
            const speed = await runTest(false, downloadChunk);
            // Immediately show download results
            setResults({
                downloadSpeed: speed,
                uploadSpeed: 0,
                currentDownloadSpeed: undefined
            });
            return speed;
        } catch (err) {
            if (!abortControllerRef.current?.signal.aborted) {
                setError("Download test failed. Please try again.");
                console.error("Download test error:", err);
            }
            throw err;
        }
    }, [runTest, downloadChunk]);

    const runUploadTest = useCallback(async () => {
        setCurrentTest("upload");
        setProgress(0);

        try {
            // Pre-generated chunks are already in chunkPool.current
            const speed = await runTest(true, uploadChunk);
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
        } finally {
            chunkPool.current = [];
        }
    }, [runTest, uploadChunk]);

    const runSpeedTest = async () => {
        if (timeoutId) clearTimeout(timeoutId);
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        setIsLoading(true);
        setError("");
        setDetailedError(null);
        setResults(null);

        const newTimeoutId = setTimeout(handleTimeout, TEST_TIMEOUT);
        setTimeoutId(newTimeoutId);

        try {
            await clearCache();

            // Pre-generate chunks for upload test
            const preGeneratedChunks = Array.from(
                { length: Math.ceil(TEST_DURATION / CHUNK_SIZE) },
                (_, chunkId) => createChunk(chunkId, CHUNK_SIZE)
            );
            chunkPool.current = preGeneratedChunks;

            if (chunkPool.current.length === 0) {
                throw new Error('Failed to generate upload chunks');
            }

            // Run download test and show results
            await runDownloadTest();

            // Add a small delay before starting upload test
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Run upload test
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
                    <div className="flex justify-center">
                        <Button
                            onClick={runSpeedTest}
                            disabled={isLoading}
                            className="w-48"
                        >
                            {isLoading ? <LoadingSpinner /> : "Run Speed Test →"}
                        </Button>
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
                    <div className="grid grid-cols-2 gap-2 py-2 items-center">
                        <div>
                            <p className="text-sm font-medium">Download ↓</p>
                            <p className="text-2xl font-bold">
                                {results.currentDownloadSpeed !== undefined
                                    ? `${results.currentDownloadSpeed.toFixed(2)}*`
                                    : `${results.downloadSpeed.toFixed(2)}`
                                } Mbps
                            </p>
                        </div>
                        <div>
                            <p className="text-sm font-medium">Upload ↑</p>
                            <p className="text-2xl font-bold">
                                {results.currentUploadSpeed !== undefined
                                    ? `${results.currentUploadSpeed.toFixed(2)}*`
                                    : `${results.uploadSpeed.toFixed(2)}`
                                } Mbps
                            </p>
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
