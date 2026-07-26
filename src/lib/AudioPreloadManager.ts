/**
 * AudioPreloadManager.ts
 * 
 * High-performance pre-buffering and lifecycle optimizer for secondary FanDub audio tracks.
 * Employs custom chunk-by-chunk stream readers to download the initial 2MB buffer silent in the background.
 * Automatically halts fetches during main player network buffering to prioritize active stream bandwidth.
 * Prevents mobile memory leaks via comprehensive, garbage-collected objectURL reclamation.
 */

class AudioPreloadManager {
    private blobs: Map<string, string> = new Map(); // id -> blobURL
    private blobInfos: Map<string, { url: string; isComplete: boolean }> = new Map(); // id -> info
    private abortControllers: Map<string, AbortController> = new Map();
    private activePreloads: Set<string> = new Set();
    private isBuffering: boolean = false;
    private resumePromise: Promise<void> | null = null;
    private resumeResolver: (() => void) | null = null;

    /**
     * Updates the buffering state of the primary video feed.
     * When buffering is active, ongoing preloads are suspended immediately to prioritize bandwidth.
     */
    public setBuffering(isBuffering: boolean) {
        if (this.isBuffering === isBuffering) return;
        this.isBuffering = isBuffering;
        
        console.log(`[AudioPreloadManager] Estado de buffering del video principal cambiado: ${isBuffering}`);
        
        if (!isBuffering) {
            // Resume if paused
            if (this.resumeResolver) {
                this.resumeResolver();
                this.resumeResolver = null;
                this.resumePromise = null;
            }
        }
    }

    /**
     * Awaits the release signal if the main player is buffering.
     */
    private async waitForResume() {
        if (!this.isBuffering) return;
        if (!this.resumePromise) {
            console.log(`[AudioPreloadManager] Precarga EN PAUSA Temporalmente (Evitando saturar ancho de banda de video)`);
            this.resumePromise = new Promise<void>((resolve) => {
                this.resumeResolver = resolve;
            });
        }
        await this.resumePromise;
        console.log(`[AudioPreloadManager] Precarga REANUDADA (Video principal con buffer suficiente)`);
    }

    /**
     * Initiates quiet background downloads of the first 2MB for all secondary audio tracks.
     */
    public preloadTracks(tracks: Array<{ id: string; url?: string }>) {
        tracks.forEach(track => {
            if (!track.url || track.id === 'ja' || track.id === 'japanese') return;
            if (this.blobs.has(track.id) || this.activePreloads.has(track.id)) return;

            this.preloadTrack(track.id, track.url);
        });
    }

    /**
     * Fetches and caches the initial segment of an audio track in memory.
     */
    private async preloadTrack(id: string, url: string) {
        this.activePreloads.add(id);
        const controller = new AbortController();
        this.abortControllers.set(id, controller);

        console.log(`[AudioPreloadManager] Iniciando precarga silenciosa para el idioma "${id}": ${url}`);

        try {
            // Support 'force-cache' to leverage browser HTTP-level caches
            const response = await fetch(url, {
                signal: controller.signal,
                cache: 'force-cache'
            });

            if (!response.ok) {
                throw new Error(`Error en respuesta HTTP: ${response.status} ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error("El cuerpo de la respuesta de red está vacío.");
            }

            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let receivedLength = 0;
            const MAX_BUFFER_SIZE = 2 * 1024 * 1024; // 2MB (~120 - 150 segundos de audio @ 128kbps)

            let isComplete = true;
            while (true) {
                // Suspend reading if the main player enters a buffering state
                if (this.isBuffering) {
                    await this.waitForResume();
                }

                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                if (value) {
                    chunks.push(value);
                    receivedLength += value.length;
                }

                // Stop fetching when initial pre-buffer size is secured (2MB target limit)
                if (receivedLength >= MAX_BUFFER_SIZE) {
                    console.log(`[AudioPreloadManager] Buffer inicial de 2MB alcanzado para "${id}". Finalizando precarga.`);
                    isComplete = false;
                    break;
                }
            }

            // Cleanly release the stream reader
            try {
                await reader.cancel();
            } catch (e) {}

            if (chunks.length === 0) {
                throw new Error("No se recibieron datos para esta pista.");
            }

            // Create modular streamable Media blob
            const mergedBlob = new Blob(chunks, { type: 'audio/mpeg' });
            const blobUrl = URL.createObjectURL(mergedBlob);
            
            this.blobs.set(id, blobUrl);
            this.blobInfos.set(id, { url: blobUrl, isComplete });
            console.log(`[AudioPreloadManager] "${id}" listo en caché! Completo: ${isComplete}, Tamaño del buffer: ${(receivedLength / 1024 / 1024).toFixed(2)} MB. URL del Blob: ${blobUrl}`);

        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log(`[AudioPreloadManager] Precarga abortada para "${id}"`);
            } else {
                console.warn(`[AudioPreloadManager] Falló la precarga de la pista "${id}":`, error.message);
            }
        } finally {
            this.activePreloads.delete(id);
            this.abortControllers.delete(id);
        }
    }

    /**
     * Resolves and swaps the active audio supply instantly using the memory blobs when available.
     * Backs up to standard URL streaming if the pre-buffer is currently unavailable or downloading.
     */
    public getPreloadedUrl(id: string, originalUrl: string, videoTime: number = 0): string {
        const info = this.blobInfos.get(id);
        if (info) {
            if (info.isComplete) {
                console.log(`[AudioPreloadManager] ¡Swap de audio instantáneo Completo para "${id}"!`);
                return info.url;
            } else if (videoTime < 25) {
                console.log(`[AudioPreloadManager] ¡Swap de audio instantáneo Parcial para "${id}" (tiempo: ${videoTime.toFixed(1)}s < 25s)!`);
                return info.url;
            } else {
                console.log(`[AudioPreloadManager] Tiempo de video ${videoTime.toFixed(1)}s excede pre-buffer de "${id}". Usando streaming de red original.`);
                return originalUrl;
            }
        }
        console.log(`[AudioPreloadManager] La pista "${id}" aún no se ha precargado o falló. Transmitiendo por red directa: ${originalUrl}`);
        return originalUrl;
    }

    /**
     * Returns whether the track is complete.
     */
    public isComplete(id: string): boolean {
        const info = this.blobInfos.get(id);
        return info ? info.isComplete : false;
    }

    /**
     * Returns whether the track is ready in memory.
     */
    public isPreloaded(id: string): boolean {
        return this.blobs.has(id);
    }

    /**
     * Clears and deallocates all memory references, aborting active downloads.
     * Crucial to prevent RAM bloating on mobile devices.
     */
    public cleanup() {
        console.log(`[AudioPreloadManager] Ejecutando limpieza completa (Deallocating memory & aborting preloads)`);
        
        // Abort all ongoing downloads
        this.abortControllers.forEach(controller => {
            try {
                controller.abort();
            } catch (e) {}
        });
        this.abortControllers.clear();
        this.activePreloads.clear();

        // Evaporate all objectURLs from the browser's memory allocation pool
        this.blobs.forEach(blobUrl => {
            try {
                URL.revokeObjectURL(blobUrl);
            } catch (e) {}
        });
        this.blobs.clear();
        this.blobInfos.clear();

        // Neutralize buffering locks
        this.isBuffering = false;
        if (this.resumeResolver) {
            this.resumeResolver();
            this.resumeResolver = null;
            this.resumePromise = null;
        }
        
        console.log(`[AudioPreloadManager] Limpieza terminada exitosamente.`);
    }
}

export const audioPreloadManager = new AudioPreloadManager();
