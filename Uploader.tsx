import React, { useState, useRef } from 'react';
import { FileUploaderRegular } from "@uploadcare/react-uploader";
import "@uploadcare/react-uploader/core.css";

interface UploaderProps {
    onUploadSuccess?: (url: string) => void;
    folder?: string;
    accept?: string;
    buttonText?: string;
}

export default function Uploader({ 
    onUploadSuccess, 
    folder = "media",
    accept = "*",
    buttonText = "Subir a R2"
}: UploaderProps) {
    const [uploading, setUploading] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [uploadProvider, setUploadProvider] = useState<'r2' | 'uploadcare' | 'youtube'>('r2');
    const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleYouTubeToR2 = async () => {
        const urlToProcess = youtubeUrlInput.trim();
        if (!urlToProcess) {
            setErrorMsg("Ingresa un enlace de YouTube o video válido.");
            return;
        }

        setUploading(true);
        setErrorMsg(null);
        setStatusMsg("Descargando video de YouTube e importando a Cloudflare R2...");

        try {
            const res = await fetch("/api/upload/youtube-to-r2", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: urlToProcess, folder }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "No se pudo procesar el video de YouTube.");
            }

            setStatusMsg(`¡Éxito! Video guardado en R2: ${data.url}`);
            if (onUploadSuccess) {
                onUploadSuccess(data.url);
            }
            setYoutubeUrlInput('');
        } catch (err: any) {
            console.error("Error al convertir YouTube a R2:", err);
            setErrorMsg(err.message || "Error al procesar la descarga de YouTube.");
            setStatusMsg(null);
        } finally {
            setUploading(false);
        }
    };

    const handleR2FileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        setErrorMsg(null);
        setStatusMsg(`Obteniendo URL de subida para ${file.name}...`);

        try {
            // Step 1: Request presigned URL from server (tiny JSON payload, bypasses proxy limits)
            const presignRes = await fetch("/api/upload/presign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fileName: file.name,
                    mimeType: file.type || "application/octet-stream",
                    folder,
                }),
            });

            const presignText = await presignRes.text();
            let presignData: any;
            try {
                presignData = JSON.parse(presignText);
            } catch (pErr) {
                throw new Error(`Error en servidor (${presignRes.status}): ${presignText.slice(0, 100)}`);
            }

            if (!presignRes.ok || !presignData.success) {
                throw new Error(presignData.error || "Error al obtener URL de Cloudflare R2.");
            }

            const { presignedUrl, url: filePublicUrl } = presignData;
            const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);

            // Step 2: Upload file directly to Cloudflare R2 via presigned PUT
            setStatusMsg(`Subiendo ${file.name} (${fileSizeMB} MB) a Cloudflare R2...`);

            try {
                const uploadRes = await fetch(presignedUrl, {
                    method: "PUT",
                    headers: {
                        "Content-Type": file.type || "application/octet-stream",
                    },
                    body: file,
                });

                if (!uploadRes.ok) {
                    throw new Error(`R2 respondió con estado ${uploadRes.status}`);
                }

                setStatusMsg(`¡Éxito! Subido a Cloudflare R2 (${fileSizeMB} MB)`);
                if (onUploadSuccess) {
                    onUploadSuccess(filePublicUrl);
                }
            } catch (directUploadErr: any) {
                console.warn("Direct presigned upload failed or blocked by CORS, trying proxy upload...", directUploadErr);

                // Fallback to proxy endpoint if file is up to 30MB
                if (file.size <= 30 * 1024 * 1024) {
                    setStatusMsg(`Subiendo mediante servidor proxy (${fileSizeMB} MB)...`);
                    const formData = new FormData();
                    formData.append("file", file);
                    formData.append("folder", folder);

                    const proxyRes = await fetch("/api/upload", {
                        method: "POST",
                        body: formData,
                    });

                    const proxyText = await proxyRes.text();
                    let proxyData: any;
                    try {
                        proxyData = JSON.parse(proxyText);
                    } catch (pErr) {
                        throw new Error(`Respuesta del servidor (${proxyRes.status}): ${proxyText.slice(0, 100)}`);
                    }

                    if (!proxyRes.ok || !proxyData.success) {
                        throw new Error(proxyData.error || "Error al subir el archivo mediante servidor.");
                    }

                    setStatusMsg(`¡Éxito! Subido a R2 vía servidor: ${proxyData.url}`);
                    if (onUploadSuccess) {
                        onUploadSuccess(proxyData.url);
                    }
                } else {
                    throw new Error(
                        `Error de CORS en Cloudflare R2 (${fileSizeMB} MB): El navegador bloqueó la subida directa. Por favor, añade las reglas CORS (*) en tu bucket de Cloudflare R2.`
                    );
                }
            }
        } catch (err: any) {
            console.error("Error al subir a Cloudflare R2:", err);
            setErrorMsg(err.message || "Error al subir el archivo.");
            setStatusMsg(null);
        } finally {
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    const handleUploadcareSuccess = (fileInfo: any) => {
        if (onUploadSuccess && fileInfo.cdnUrl) {
            onUploadSuccess(fileInfo.cdnUrl);
            setStatusMsg(`¡Exito! Subido a Uploadcare: ${fileInfo.cdnUrl}`);
        }
    };

    return (
        <div className="flex flex-col gap-2 my-1">
            <div className="flex items-center gap-2">
                {/* R2 Direct Upload Button */}
                {uploadProvider === 'r2' && (
                    <div className="flex items-center gap-2">
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            onChange={handleR2FileSelect} 
                            accept={accept}
                            className="hidden" 
                        />
                        <button
                            type="button"
                            disabled={uploading}
                            onClick={() => fileInputRef.current?.click()}
                            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold text-xs px-3 py-2 rounded-lg transition-all flex items-center gap-1.5 shadow-md shadow-orange-600/20"
                            title="Subir archivo (.mp3, video, imágenes) directamente a Cloudflare R2"
                        >
                            {uploading ? (
                                <>
                                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                                    <span>Subiendo a R2...</span>
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                    </svg>
                                    <span>{buttonText}</span>
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* YouTube to R2 Auto-Downloader */}
                {uploadProvider === 'youtube' && (
                    <div className="flex items-center gap-2 bg-red-950/20 border border-red-600/30 p-1.5 rounded-xl">
                        <input
                            type="url"
                            value={youtubeUrlInput}
                            onChange={(e) => setYoutubeUrlInput(e.target.value)}
                            placeholder="Pegar enlace de YouTube..."
                            className="bg-black/50 border border-white/10 text-white text-xs px-2.5 py-1.5 rounded-lg outline-none focus:border-red-500 w-48 sm:w-64"
                        />
                        <button
                            type="button"
                            disabled={uploading}
                            onClick={handleYouTubeToR2}
                            className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shadow-md shadow-red-600/30 shrink-0"
                        >
                            {uploading ? (
                                <>
                                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                                    <span>Importando a R2...</span>
                                </>
                            ) : (
                                <>
                                    <span>⚡ Guardar en R2</span>
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* Uploadcare fallback component */}
                {uploadProvider === 'uploadcare' && (
                    <div className="uc-light uc-purple">
                        <FileUploaderRegular
                            pubkey="402730eca012e7f7f816"
                            classNameUploader="uc-light uc-purple"
                            sourceList="local, camera, gdrive, facebook"
                            userAgentIntegration="llm-nextjs"
                            filesViewMode="grid"
                            onFileUploadSuccess={handleUploadcareSuccess}
                        />
                    </div>
                )}

                {/* Mode Selectors */}
                <div className="flex items-center gap-1.5">
                    {uploadProvider !== 'youtube' && (
                        <button
                            type="button"
                            onClick={() => setUploadProvider('youtube')}
                            className="text-[10px] bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 px-2 py-1 rounded-lg transition-all font-bold flex items-center gap-1"
                            title="Descargar desde enlace de YouTube y subir a Cloudflare R2 automáticamente"
                        >
                            <span>⚡</span> YouTube a R2
                        </button>
                    )}
                    {uploadProvider !== 'r2' && (
                        <button
                            type="button"
                            onClick={() => setUploadProvider('r2')}
                            className="text-[10px] bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 border border-orange-600/30 px-2 py-1 rounded-lg transition-all font-bold"
                            title="Subir archivo local directamente a Cloudflare R2"
                        >
                            Usar R2 Directo
                        </button>
                    )}
                    {uploadProvider !== 'uploadcare' && (
                        <button
                            type="button"
                            onClick={() => setUploadProvider('uploadcare')}
                            className="text-[10px] text-gray-400 hover:text-white underline px-1 py-1"
                            title="Cambiar a Uploadcare"
                        >
                            Uploadcare
                        </button>
                    )}
                </div>
            </div>

            {/* Status & Error Feedback */}
            {statusMsg && (
                <p className="text-[11px] text-emerald-400 font-medium truncate max-w-xs animate-fade-in">
                    {statusMsg}
                </p>
            )}
            {errorMsg && (
                <div className="flex flex-col gap-1.5 animate-fade-in max-w-sm">
                    <p className="text-[11px] text-red-400 font-medium">
                        ⚠️ {errorMsg}
                    </p>
                    {errorMsg.toLowerCase().includes('cors') && (
                        <button
                            type="button"
                            onClick={() => {
                                const corsJson = JSON.stringify([
                                    {
                                        "AllowedOrigins": ["*"],
                                        "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
                                        "AllowedHeaders": ["*"],
                                        "ExposeHeaders": []
                                    }
                                ], null, 2);
                                navigator.clipboard.writeText(corsJson);
                                alert("¡CORS JSON copiado!\n\nPégalo en Cloudflare R2 > Tu Bucket > Settings > CORS Policy.");
                            }}
                            className="self-start text-[10px] bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 px-2 py-1 rounded transition-all font-bold"
                        >
                            📋 Copiar Regla CORS para R2
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
