
import React, { useEffect, useRef, useState } from 'react';
import ShakaPlayer from './ShakaPlayer';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface SeikoMediaEngineProps {
    videoUrl: string;
    serverType: 'uploadcare' | 'streamtape' | 'savefiles' | 'embed';
    embedCode?: string;
    title?: string;
    autoPlay?: boolean;
    onTimeUpdate?: (time: number) => void;
    onDurationChange?: (duration: number) => void;
    videoRef?: React.RefObject<HTMLVideoElement>;
    subtitles?: { label: string; src: string }[];
}

const SeikoMediaEngine: React.FC<SeikoMediaEngineProps> = ({ 
    videoUrl, 
    serverType, 
    embedCode,
    title,
    autoPlay = true,
    onTimeUpdate,
    onDurationChange,
    videoRef,
    subtitles
}) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [hasError, setHasError] = useState(false);

    // Dynamic URL processing for different servers
    const getIframeSrc = () => {
        if (!videoUrl) return '';
        let cleanUrl = videoUrl.trim();
        
        if (serverType === 'streamtape') {
            if (cleanUrl.includes('streamtape.com/v/')) {
                cleanUrl = cleanUrl.replace('streamtape.com/v/', 'streamtape.com/e/');
            }
        }
        
        if (serverType === 'savefiles') {
            // Savefiles typically uses /e/ or /embed/ links
            if (cleanUrl.includes('savefiles.org/v/')) {
                cleanUrl = cleanUrl.replace('savefiles.org/v/', 'savefiles.org/e/');
            }
        }

        // Add cache buster for iframe variants to avoid some domain blocks
        if (serverType !== 'uploadcare') {
            const connector = cleanUrl.includes('?') ? '&' : '?';
            cleanUrl = `${cleanUrl}${connector}cache=${Date.now()}`;
        }
        
        return cleanUrl;
    };

    const isExternal = ['streamtape', 'savefiles', 'embed'].includes(serverType);

    return (
        <div className="relative w-full aspect-video rounded-[15px] overflow-hidden shadow-[0_0_20px_rgba(255,0,0,0.5)] bg-black group border border-red-600/20">
            {isExternal ? (
                // Condition B: External Providers (Iframe)
                serverType === 'embed' && embedCode ? (
                    <div 
                        className="w-full h-full flex items-center justify-center pointer-events-auto"
                        dangerouslySetInnerHTML={{ __html: embedCode }} 
                    />
                ) : (
                    <iframe
                        ref={iframeRef}
                        src={getIframeSrc()}
                        className="w-full h-full border-none"
                        allowFullScreen
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        sandbox="allow-forms allow-scripts allow-pointer-lock allow-same-origin allow-top-navigation"
                        allow="autoplay; encrypted-media; fullscreen"
                        title={title || "Video Player"}
                        onError={() => setHasError(true)}
                    />
                )
            ) : (
                // Condition A: Uploadcare / Direct (Shaka Player)
                <ShakaPlayer 
                    src={videoUrl} 
                    className="w-full h-full"
                    videoRef={videoRef || { current: null } as any}
                    subtitles={subtitles}
                />
            )}

            {/* Neon Glow Overlay (Shared) */}
            <div className="absolute inset-0 pointer-events-none border border-red-600/20 rounded-[15px] z-10" />

            {/* External controls fallback */}
            {isExternal && (
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity z-20 flex gap-2">
                    <button 
                        onClick={() => window.open(videoUrl || '#', '_blank')}
                        className="bg-red-600/90 hover:bg-red-600 text-[10px] text-white font-black uppercase px-3 py-1.5 rounded-lg border border-red-500 shadow-[0_0_15px_rgba(255,0,0,0.5)] backdrop-blur-sm transition-all"
                    >
                        Abrir Fuente
                    </button>
                </div>
            )}
            
            {hasError && (
                <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center p-6 text-center z-30 animate-fade-in">
                    <AlertCircle className="text-red-600 mb-4" size={48} />
                    <h3 className="text-white font-bold mb-2">Error de Carga</h3>
                    <p className="text-gray-400 text-sm max-w-xs mb-6 font-medium">
                        El servidor externo está bloqueando la conexión. Intenta recargar o abrir la fuente directamente.
                    </p>
                    <button 
                        onClick={() => window.location.reload()}
                        className="flex items-center gap-2 px-8 py-3 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-[0_0_20px_rgba(255,0,0,0.4)]"
                    >
                        <RefreshCw size={16} />
                        Recargar
                    </button>
                </div>
            )}
        </div>
    );
};

export default SeikoMediaEngine;

