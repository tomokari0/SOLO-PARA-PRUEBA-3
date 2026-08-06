
import React, { useState, useEffect, useRef, createContext, useContext, useMemo, useCallback } from 'react';
import { Content, Episode, Season, UserProfile, SkipSegment } from './types';
import { LANGUAGES, TRANSLATIONS, MOCK_CONTENT } from './constants';
import { auth, db, isConfigured } from './firebaseConfig';
import { collection, onSnapshot, query, orderBy, getDocs, addDoc, serverTimestamp, doc, setDoc, updateDoc, arrayUnion, arrayRemove, increment } from "firebase/firestore";
import { handleFirestoreError, OperationType } from './src/lib/firestoreErrorHandler';
import AdminPanel from './AdminPanel';
import ContentUploadForm from './ContentUploadForm';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './Login';
import { TermsModal } from './src/components/TermsModal';
import ProfileEdit from './ProfileEdit';
import Footer from './src/components/Footer';
import SeikoMediaEngine from './src/components/SeikoMediaEngine';
import PosterImage from './src/components/PosterImage';
import ShakaPlayer from './src/components/ShakaPlayer';
import ProfileSelector from './ProfileSelector';
import AiAssistant from './src/components/AiAssistant';
import { useMemoryCleanup } from './src/hooks/useMemoryCleanup';
import { audioPreloadManager } from './src/lib/AudioPreloadManager';
import ContentLikeButton from './src/components/ContentLikeButton';
import { ContentDetailModal } from './src/components/ContentDetailModal';
import { Subtitles, Sun } from 'lucide-react';
import { generateAutoCues, createWebVTTDataUrl, parseVTTToCues, SubtitleCue } from './src/utils/autoSubtitles';
import AutoSubtitleOverlay from './src/components/AutoSubtitleOverlay';

declare global {
  interface Window {
    JitsiMeetExternalAPI: any;
    shaka: any;
    YT: any;
    onYouTubeIframeAPIReady: () => void;
    seikotv_current_time: number;
  }
}

// --- HELPER & UTILITY ---
const formatTime = (timeInSeconds: number): string => {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) return "00:00";
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

// --- LANGUAGE CONTEXT ---
type LanguageContextType = {
    currentLanguage: string;
    t: (key: string) => string;
};
const LanguageContext = createContext<LanguageContextType>({
    currentLanguage: 'en',
    t: (key) => key,
});
export const useLanguage = () => useContext(LanguageContext);
export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentLanguage] = useState('es-419');
    const translations = useMemo(() => TRANSLATIONS[currentLanguage] || TRANSLATIONS['en'], [currentLanguage]);
    
    const t = useCallback((key: string): string => {
        const val = translations[key] || TRANSLATIONS['en'][key] || key;
        return typeof val === 'string' ? val : String(val);
    }, [translations]);

    return <LanguageContext.Provider value={{ currentLanguage, t }}>{children}</LanguageContext.Provider>;
};

// --- HISTORY CONTEXT ---
type WatchProgress = { currentTime: number; duration: number; lastWatched: number; };
type UserHistoryContextType = {
    watchProgress: Record<string, WatchProgress>;
    updateProgress: (id: string, currentTime: number, duration: number) => void;
    setActiveProfileId: (id: string | null) => void;
};
const UserHistoryContext = createContext<UserHistoryContextType>({
    watchProgress: {},
    updateProgress: () => {},
    setActiveProfileId: () => {},
});
export const useUserHistory = () => useContext(UserHistoryContext);
export const UserHistoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, profile: currentProfile } = useAuth();
    const profileId = currentProfile?.id || 'global';
    const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
    const [watchProgress, setWatchProgress] = useState<Record<string, WatchProgress>>({});
    const lastWriteTimeRef = useRef<Record<string, number>>({});

    useEffect(() => {
        if (!user || !activeProfileId) {
            const key = `seikotv_watch_progress_${profileId}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    setWatchProgress(JSON.parse(saved));
                } catch {
                    setWatchProgress({});
                }
            } else {
                setWatchProgress({});
            }
            return;
        }

        // Setup real-time listener for this active profile's watchProgress subcollection
        const progressColRef = collection(db, 'usuarios', user.uid, 'perfiles', activeProfileId, 'watchProgress');
        
        const unsubscribe = onSnapshot(progressColRef, (snapshot) => {
            const remoteProgress: Record<string, WatchProgress> = {};
            snapshot.forEach((doc) => {
                const data = doc.data();
                remoteProgress[doc.id] = {
                    currentTime: data.currentTime || 0,
                    duration: data.duration || 0,
                    lastWatched: data.lastWatched || 0
                };
            });
            
            setWatchProgress(remoteProgress);

            // Keep localStorage updated as fallback
            const key = `seikotv_watch_progress_${activeProfileId}`;
            localStorage.setItem(key, JSON.stringify(remoteProgress));
        }, (error) => {
            console.error("Error listening to watch progress from firestore:", error);
        });

        return () => unsubscribe();
    }, [user, activeProfileId, profileId]);

    const updateProgress = (id: string, currentTime: number, duration: number) => {
        const lastWatched = Date.now();
        const progressObj = { currentTime, duration, lastWatched };

        // 1. Update local state immediately
        setWatchProgress(prev => {
            const next = { ...prev, [id]: progressObj };
            const activeId = activeProfileId || profileId;
            const key = `seikotv_watch_progress_${activeId}`;
            localStorage.setItem(key, JSON.stringify(next));
            return next;
        });

        // 2. Sync to Firestore
        if (user && activeProfileId) {
            const lastWriteTime = lastWriteTimeRef.current[id] || 0;
            const now = Date.now();

            // Write if:
            // - It's been more than 4 seconds since the last write,
            // - OR it's the very first progress (currentTime near 0)
            // - OR the video has finished (currentTime >= duration)
            if (now - lastWriteTime > 4000 || currentTime === 0 || currentTime >= duration) {
                lastWriteTimeRef.current[id] = now;
                const docRef = doc(db, 'usuarios', user.uid, 'perfiles', activeProfileId, 'watchProgress', id);
                setDoc(docRef, {
                    currentTime,
                    duration,
                    lastWatched
                }, { merge: true }).catch(err => {
                    console.error("Error updating watch progress in Firestore:", err);
                });
            }
        }
    };

    return (
        <UserHistoryContext.Provider value={{ watchProgress, updateProgress, setActiveProfileId }}>
            {children}
        </UserHistoryContext.Provider>
    );
};

// --- ICONS ---
const PlayIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
const PauseIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;
const NextIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>;
const ListIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>;
const AudioIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>;
const SearchIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const DownloadIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="9" x2="12" y2="15"/></svg>;
const VolumeIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>;
const MuteIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>;
const FullscreenIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>;
const PiPIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><rect x="13" y="11" width="7" height="5" rx="1" /></svg>;
const ZoomInIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>;
const SpeedIcon = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const RotateCcw = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>;
const RotateCw = ({ className }: { className?: string }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>;
const Skip10Back = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21a9 9 0 1 0-9-9c0 1.48.36 2.88 1 4.12" />
        <polyline points="4 12 1 16 7 16" />
        <text x="12" y="15" textAnchor="middle" fontSize="7.5" fontWeight="900" fill="currentColor" stroke="none" fontFamily="sans-serif">10</text>
    </svg>
);
const Skip10Forward = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21a9 9 0 1 1 9-9c0 1.48-.36 2.88-1 4.12" />
        <polyline points="20 12 23 16 17 16" />
        <text x="12" y="15" textAnchor="middle" fontSize="7.5" fontWeight="900" fill="currentColor" stroke="none" fontFamily="sans-serif">10</text>
    </svg>
);
const ChatBubblesIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        <line x1="8" y1="9" x2="16" y2="9"/>
        <line x1="8" y1="13" x2="14" y2="13"/>
    </svg>
);
const GearIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>
);
const CloseIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
);
const HelpIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

// --- COMPONENTE DE PROGRESO CIRCULAR DE DESCARGA ---
const DownloadProgressRing: React.FC<{ progress: number; size?: number }> = ({ progress = 0, size = 28 }) => {
    const strokeWidth = 2.5;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (Math.min(100, Math.max(0, progress)) / 100) * circumference;
    const roundedPercent = Math.round(progress);

    return (
        <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
            <svg className="transform -rotate-90 w-full h-full" viewBox={`0 0 ${size} ${size}`}>
                {/* Track circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    className="text-white/20"
                    strokeWidth={strokeWidth}
                    stroke="currentColor"
                    fill="transparent"
                />
                {/* Progress arc */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    className="text-red-500 transition-all duration-300 ease-out"
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                />
            </svg>
            {/* Subtle glow effect */}
            <div className="absolute inset-0 bg-red-500/20 blur-sm rounded-full -z-10 animate-pulse" />
            {/* Percentage text inside circle */}
            <span className="absolute text-[8px] font-extrabold text-white select-none tracking-tighter">
                {roundedPercent}%
            </span>
        </div>
    );
};

// --- HOOK DE DESCARGAS OFFLINE ---
const useOfflineDownloads = () => {
    const [downloadedUrls, setDownloadedUrls] = useState<string[]>([]);
    const [downloading, setDownloading] = useState<Record<string, number>>({});

    useEffect(() => {
        const checkDownloads = async () => {
            try {
                const cache = await caches.open('seikotv-downloads');
                const keys = await cache.keys();
                setDownloadedUrls(keys.map(req => req.url));
            } catch (e) {
                console.warn("Caches not available:", e);
            }
        };
        checkDownloads();
    }, []);

    const downloadVideo = async (url: string, metadata?: any) => {
        if (!url || downloading[url] !== undefined || downloadedUrls.includes(url)) return;
        
        setDownloading(prev => ({ ...prev, [url]: 0 }));
        
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("Failed to fetch video for download");

            const reader = response.body?.getReader();
            const contentLength = +(response.headers.get('Content-Length') || 0);

            if (!reader) {
                const cache = await caches.open('seikotv-downloads');
                await cache.put(url, response.clone());
                setDownloadedUrls(prev => [...prev, url]);
                return;
            }

            let receivedLength = 0;
            const chunks = [];

            while(true) {
                const {done, value} = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedLength += value.length;
                if (contentLength) {
                    setDownloading(prev => ({ ...prev, [url]: Math.round((receivedLength / contentLength) * 100) }));
                }
            }

            const blob = new Blob(chunks);
            const cache = await caches.open('seikotv-downloads');
            await cache.put(url, new Response(blob, {
                headers: response.headers
            }));
            
            setDownloadedUrls(prev => [...prev, url]);

            // Persistir metadata para modo offline
            if (metadata) {
                const savedMetadata = JSON.parse(localStorage.getItem('seikotv_downloads_metadata') || '{}');
                savedMetadata[url] = metadata;
                localStorage.setItem('seikotv_downloads_metadata', JSON.stringify(savedMetadata));
            }
            
            // Avisar sobre persistencia
            if (!localStorage.getItem('seikotv_persistence_warning_shown')) {
                alert("¡Descarga completa! Recuerda que si borras el caché de tu navegador, tus descargas desaparecerán.");
                localStorage.setItem('seikotv_persistence_warning_shown', 'true');
            }
        } catch (error) {
            console.error("Download error:", error);
            alert("La descarga falló. Verifique su espacio en disco o conexión.");
        } finally {
            setDownloading(prev => {
                const n = { ...prev };
                delete n[url];
                return n;
            });
        }
    };

    const removeDownload = async (url: string) => {
        const cache = await caches.open('seikotv-downloads');
        await cache.delete(url);
        setDownloadedUrls(prev => prev.filter(u => u !== url));
        
        const savedMetadata = JSON.parse(localStorage.getItem('seikotv_downloads_metadata') || '{}');
        delete savedMetadata[url];
        localStorage.setItem('seikotv_downloads_metadata', JSON.stringify(savedMetadata));
    };

    return { downloadedUrls, downloading, downloadVideo, removeDownload };
};

// --- FEEDBACK TOAST COMPONENT ---
const FeedbackToast: React.FC<{ 
    onClose: () => void; 
    userId: string;
}> = ({ onClose, userId }) => {
    const [submitted, setSubmitted] = useState(false);
    const [rating, setRating] = useState<number | null>(null);

    const options = [
        { emoji: '😠', label: 'Muy Mal', value: 1 },
        { emoji: '🙁', label: 'Mal', value: 2 },
        { emoji: '😐', label: 'Regular', value: 3 },
        { emoji: '🙂', label: 'Bien', value: 4 },
        { emoji: '😍', label: 'Excelente', value: 5 },
    ];

    const handleSubmit = async (val: number) => {
        setRating(val);
        try {
            await addDoc(collection(db, "feedback"), {
                userId,
                rating: val,
                timestamp: serverTimestamp(),
                date: new Date().toISOString()
            });
            setSubmitted(true);
            localStorage.setItem('seikotv_feedback_last_shown', Date.now().toString());
            setTimeout(onClose, 3000);
        } catch (error) {
            console.error("Error sending feedback:", error);
        }
    };

    const handleClose = () => {
        localStorage.setItem('seikotv_feedback_last_shown', Date.now().toString());
        onClose();
    };

    return (
        <div className="fixed bottom-6 right-6 z-[300] w-80 bg-[#121212] border border-white/10 rounded-2xl shadow-2xl p-6 animate-fade-in-up overflow-hidden">
            <button onClick={handleClose} className="absolute top-3 right-3 text-gray-500 hover:text-white transition-colors">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>

            {!submitted ? (
                <div className="space-y-4">
                    <h3 className="text-lg font-bold text-white">¿Qué te parece SeikoTV?</h3>
                    <div className="flex justify-between gap-2">
                        {options.map((opt) => (
                            <button 
                                key={opt.value}
                                onClick={() => handleSubmit(opt.value)}
                                className="flex flex-col items-center gap-1 group"
                            >
                                <span className="text-3xl group-hover:scale-125 transition-transform duration-200">{opt.emoji}</span>
                                <span className="text-[8px] text-gray-500 group-hover:text-white uppercase font-bold">{opt.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-4 space-y-2 animate-scale-in">
                    <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                    <p className="text-white font-bold text-center">¡Gracias por tu opinión!</p>
                    <p className="text-gray-500 text-xs text-center">Nos ayuda a mejorar cada día.</p>
                </div>
            )}
        </div>
    );
};

// --- REPRODUCTOR DINÁMICO DE SERIES ---
const VideoPlayer: React.FC<{ 
    item: Content; 
    initialEpIndex?: number;
    onClose: () => void;
    autoSkipIntro: boolean;
    setAutoSkipIntro: (val: boolean) => void;
    downloadedUrls: string[];
    downloadVideo: (url: string, metadata?: any) => void;
    downloading: Record<string, number>;
    removeDownload: (url: string) => void;
}> = ({ item, initialEpIndex, onClose, autoSkipIntro, setAutoSkipIntro, downloadedUrls, downloadVideo, downloading, removeDownload }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const ytPlayerRef = useRef<any>(null);
    const ytContainerId = useMemo(() => `yt-player-${Math.random().toString(36).substr(2, 9)}`, []);
    
    const { updateProgress, watchProgress } = useUserHistory();
    const [episodes, setEpisodes] = useState<Episode[]>([]);
    const [currentEpIndex, setCurrentEpIndex] = useState(0);

    const initialIndexSetRef = useRef<string | null>(null);

    useEffect(() => {
        if (episodes.length > 0 && initialIndexSetRef.current !== item.id) {
            initialIndexSetRef.current = item.id;
            
            if (typeof initialEpIndex === 'number' && initialEpIndex >= 0 && initialEpIndex < episodes.length) {
                setCurrentEpIndex(initialEpIndex);
            } else {
                // Find the last watched episode
                let bestIndex = 0;
                let latestTime = 0;
                let lastEpProgressRatio = 0;

                episodes.forEach((ep, idx) => {
                    const progress = watchProgress[`${item.id}_${ep.id}`];
                    if (progress && progress.lastWatched > latestTime) {
                        latestTime = progress.lastWatched;
                        bestIndex = idx;
                        lastEpProgressRatio = progress.currentTime / (progress.duration || 1);
                    }
                });

                // If the last watched episode is basically finished (>90%), advance to the next episode if available!
                if (lastEpProgressRatio > 0.90 && bestIndex < episodes.length - 1) {
                    setCurrentEpIndex(bestIndex + 1);
                } else {
                    setCurrentEpIndex(bestIndex);
                }
            }
        }
    }, [episodes, item.id, watchProgress, initialEpIndex]);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isAudioMenuOpen, setIsAudioMenuOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [currentAudio, setCurrentAudio] = useState('en');
    const [loading, setLoading] = useState(true);
    const [lastTime, setLastTime] = useState(0);
    const [showControls, setShowControls] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);
    const isPlayingRef = useRef(isPlaying);
    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState<number>(() => {
        try {
            const savedVolume = localStorage.getItem('seikotv_player_volume');
            if (savedVolume !== null) {
                const parsed = parseFloat(savedVolume);
                if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
                    return parsed;
                }
            }
        } catch (e) {
            console.warn("Error reading volume from localStorage", e);
        }
        return 1;
    });

    // Persist volume state in localStorage across sessions
    useEffect(() => {
        try {
            localStorage.setItem('seikotv_player_volume', volume.toString());
        } catch (e) {
            console.warn("Error saving volume to localStorage", e);
        }
    }, [volume]);
    const [duration, setDuration] = useState(0);
    const [isNextClicked, setIsNextClicked] = useState(false);
    const [showSkipButton, setShowSkipButton] = useState(false);
    const [showSkipNotification, setShowSkipNotification] = useState(false);
    const [skipNotificationText, setSkipNotificationText] = useState('Intro omitida');

    const formatSecondsToTime = useCallback((totalSeconds: number): string => {
        if (isNaN(totalSeconds) || totalSeconds < 0) return '0:00';
        const mins = Math.floor(totalSeconds / 60);
        const secs = Math.floor(totalSeconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }, []);
    const [showCopiedToast, setShowCopiedToast] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [brightness, setBrightness] = useState(100);
    const hasAutoSkippedRef = useRef<string | null>(null);
    const prefetchedEpIndexRef = useRef<number | null>(null);
    const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [showScreensaver, setShowScreensaver] = useState(false);
    const screensaverTimerRef = useRef<NodeJS.Timeout | null>(null);

    const [isAccelerating, setIsAccelerating] = useState(false);
    const isAcceleratingRef = useRef(false);
    const isSystemPausingRef = useRef(false);

    // Binge-Watch / Autoplay State & Refs
    const [bingeWatchEnabled, setBingeWatchEnabled] = useState(() => {
        const saved = localStorage.getItem('seikotv_binge_watch');
        return saved !== 'false'; // Default to true!
    });

    useEffect(() => {
        localStorage.setItem('seikotv_binge_watch', String(bingeWatchEnabled));
    }, [bingeWatchEnabled]);

    const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null);

    const bingeWatchEnabledRef = useRef(bingeWatchEnabled);
    useEffect(() => {
        bingeWatchEnabledRef.current = bingeWatchEnabled;
    }, [bingeWatchEnabled]);

    const currentEpIndexRef = useRef(currentEpIndex);
    useEffect(() => {
        currentEpIndexRef.current = currentEpIndex;
    }, [currentEpIndex]);

    const episodesRef = useRef(episodes);
    useEffect(() => {
        episodesRef.current = episodes;
    }, [episodes]);

    const nextEpisode = useMemo(() => {
        if (item.type === 'series' && currentEpIndex < episodes.length - 1) {
            return episodes[currentEpIndex + 1];
        }
        return null;
    }, [item, episodes, currentEpIndex]);

    const normalizedAudioTracks = useMemo(() => {
        const data = item.type === 'movie' ? item : episodes[currentEpIndex];
        
        const tracks: Array<{ id: string; label: string; url?: string }> = [];
        
        // Always add original (Japanese) track as default
        tracks.push({ id: 'ja', label: '🇯🇵 Audio Original (Japonés)' });

        if (data && data.audioTracks) {
            if (Array.isArray(data.audioTracks)) {
                // New system: array of objects
                data.audioTracks.forEach((track: any) => {
                    if (track.id !== 'ja') {
                        tracks.push({
                            id: track.id,
                            label: track.languageLabel,
                            url: track.audioUrl
                        });
                    }
                });
            } else if (typeof data.audioTracks === 'object') {
                Object.entries(data.audioTracks).forEach(([lang, url]) => {
                    if (lang !== 'ja' && lang !== 'japanese') {
                        const name = LANGUAGES.find(l => l.code === lang)?.name || lang;
                        tracks.push({
                            id: lang,
                            label: name
                        });
                    }
                });
            }
        }

        // If no additional custom audio tracks were specified for this content, offer standard dubbing options
        if (tracks.length === 1) {
            tracks.push(
                { id: 'es-mx', label: '🇲🇽 Español Latino (Doblaje)' },
                { id: 'es-es', label: '🇪🇸 Español Castellano' },
                { id: 'en', label: '🇺🇸 Inglés (English)' }
            );
        }

        return tracks;
    }, [item, episodes, currentEpIndex]);

    const activeAudioTrack = useMemo(() => {
        return normalizedAudioTracks.find(t => t.id === currentAudio);
    }, [normalizedAudioTracks, currentAudio]);

    const activeAudioLabel = useMemo(() => {
        const active = normalizedAudioTracks.find(t => t.id === currentAudio);
        if (!active) return 'AUDIO';
        
        const labelLower = active.label.toLowerCase();
        if (active.id === 'ja' || active.id === 'japanese' || labelLower.includes('japon') || labelLower.includes('japan')) {
            return 'JAPONÉS';
        }
        if (labelLower.includes('latino') || labelLower.includes('doblaje latino') || labelLower.includes('mexic')) {
            return 'LATINO';
        }
        if (labelLower.includes('castellano') || labelLower.includes('español') || labelLower.includes('espanol')) {
            return 'ESPAÑOL';
        }
        if (labelLower.includes('english') || labelLower.includes('ingl')) {
            return 'ENGLISH';
        }
        
        const emojisRemoved = active.label.replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "").trim();
        const firstWord = emojisRemoved.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ ]/g, '').trim().split(' ')[0];
        return firstWord ? firstWord.toUpperCase() : active.id.toUpperCase();
    }, [normalizedAudioTracks, currentAudio]);
    const touchTimeoutRef = useRef<any>(null);
    const isTouchingRef = useRef(false);
    const spacePressedRef = useRef(false);
    const spaceHoldTimerRef = useRef<any>(null);

    const startAccelerating = useCallback(() => {
        setIsAccelerating(true);
        isAcceleratingRef.current = true;
        if (videoRef.current) {
            videoRef.current.playbackRate = 2.0;
        }
        if (ytPlayerRef.current?.setPlaybackRate) {
            ytPlayerRef.current.setPlaybackRate(2.0);
        }
    }, []);

    const stopAccelerating = useCallback(() => {
        setIsAccelerating(false);
        isAcceleratingRef.current = false;
        if (videoRef.current) {
            videoRef.current.playbackRate = playbackSpeed;
        }
        if (ytPlayerRef.current?.setPlaybackRate) {
            ytPlayerRef.current.setPlaybackRate(playbackSpeed);
        }
    }, [playbackSpeed]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        isTouchingRef.current = true;
        if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
        
        touchTimeoutRef.current = setTimeout(() => {
            if (isTouchingRef.current) {
                startAccelerating();
            }
        }, 300);
    }, [startAccelerating]);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        isTouchingRef.current = false;
        if (touchTimeoutRef.current) {
            clearTimeout(touchTimeoutRef.current);
            touchTimeoutRef.current = null;
        }
        
        if (isAcceleratingRef.current) {
            stopAccelerating();
        } else {
            setShowControls(prev => !prev);
        }
    }, [stopAccelerating]);

    const handleTouchCancel = useCallback((e: React.TouchEvent) => {
        isTouchingRef.current = false;
        if (touchTimeoutRef.current) {
            clearTimeout(touchTimeoutRef.current);
            touchTimeoutRef.current = null;
        }
        if (isAcceleratingRef.current) {
            stopAccelerating();
        }
    }, [stopAccelerating]);

    const [activeTab, setActiveTab] = useState<'episodes' | 'cast' | 'info'>('episodes');
    const [cast, setCast] = useState<{ id: string; name: string; role: string; character?: string; avatar?: string; }[]>([]);
    const [loadingCast, setLoadingCast] = useState(false);

    // Default active tab based on item type
    useEffect(() => {
        if (item.type === 'movie') {
            setActiveTab('info');
        } else {
            setActiveTab('episodes');
        }
    }, [item.type]);

    // Fetch Cast & Crew from Firestore
    useEffect(() => {
        let isSubscribed = true;
        setLoadingCast(true);
        const fetchCast = async () => {
            try {
                const castRef = collection(db, "content", item.id, "cast");
                const querySnapshot = await getDocs(castRef);
                if (!isSubscribed) return;
                
                const castData: any[] = [];
                querySnapshot.forEach((doc) => {
                    castData.push({ id: doc.id, ...doc.data() });
                });
                setCast(castData);
            } catch (err) {
                console.error("Error fetching cast:", err);
            } finally {
                if (isSubscribed) setLoadingCast(false);
            }
        };

        fetchCast();
        return () => {
            isSubscribed = false;
        };
    }, [item.id]);

    const getPlaceholderCast = (title: string, type: 'movie' | 'series') => {
        return [
            {
                id: 'p1',
                name: 'Yuki Dobladora 🎙️',
                role: 'Voz Principal (Protagonista)',
                character: 'Yumi',
                avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'
            },
            {
                id: 'p2',
                name: 'Ken Gacha-Voice 🎙️',
                role: 'Voz Co-Estelar',
                character: 'Ren',
                avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200'
            },
            {
                id: 'p3',
                name: 'Miyuki Chann ✨',
                role: 'Voz de Reparto',
                character: 'Ami',
                avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200'
            },
            {
                id: 'p4',
                name: 'Seiko Creator 🎬',
                role: 'Director, Guionista y Animación Gacha',
                avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=200'
            },
            {
                id: 'p5',
                name: 'Sora Edits 💻',
                role: 'Edición y Efectos Visuales',
                avatar: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&q=80&w=200'
            }
        ];
    };

    const [showResumeToast, setShowResumeToast] = useState(false);
    const [resumeTime, setResumeTime] = useState(0);
    const [showSubtitlesMenu, setShowSubtitlesMenu] = useState(false);
    const [currentSubtitleIndex, setCurrentSubtitleIndex] = useState<number>(-1);

    const lastActiveVideoIdRef = useRef<string | null>(null);

    // Generate automatic subtitles & transcriptions (SDH sound actions + on-screen text)
    const autoCues = useMemo(() => {
        if (!item) return [];
        const currentEp = item.type === 'series' && episodes && episodes.length > 0 ? episodes[currentEpIndex] : null;
        const title = currentEp?.title || item.title || 'Video';
        const desc = currentEp?.description || item.description || '';
        const durSec = duration && duration > 0 ? duration : 300;
        return generateAutoCues(title, desc, durSec);
    }, [item, episodes, currentEpIndex, duration]);

    const autoSubtitleVttUrl = useMemo(() => {
        if (!autoCues || autoCues.length === 0) return '';
        return createWebVTTDataUrl(autoCues);
    }, [autoCues]);

    const activeVideo = useMemo(() => {
        const getData = (data: any) => {
            let url = data.videoUrl || '';
            
            // Check if audioTracks is the old map format or the new array format
            if (data.audioTracks) {
                if (Array.isArray(data.audioTracks)) {
                    // New format: We always play the base videoUrl, as audio is in secondary tag.
                    url = data.videoUrl || '';
                } else if (typeof data.audioTracks === 'object') {
                    // Old map format: We load a different video stream URL if exists (except ja)
                    if (currentAudio !== 'ja' && currentAudio !== 'japanese' && data.audioTracks[currentAudio]) {
                        url = data.audioTracks[currentAudio];
                    }
                }
            }
            
            // Auto-detection as a fallback
            let serverType = data.serverType;
            if (!serverType) {
                if (url.includes('streamtape.com')) serverType = 'streamtape';
                else if (url.includes('ucarecdn.com')) serverType = 'uploadcare';
                else serverType = 'uploadcare'; // Default
            }

            const customSubs = data.subtitles || [];
            const autoTrack = {
                label: 'Español (Auto CC)',
                src: autoSubtitleVttUrl
            };

            const subtitles = [
                ...(autoSubtitleVttUrl ? [autoTrack] : []),
                ...customSubs
            ];

            return { 
                url, 
                serverType: data.serverType || 'uploadcare',
                embedCode: data.embedCode,
                subtitles
            };
        };

        if (item.type === 'movie') {
            const data = getData(item);
            return { ...data, id: item.id };
        }
        const ep = episodes[currentEpIndex];
        if (ep) {
            const data = getData(ep);
            return { ...data, id: `${item.id}_${ep.id}` };
        }
        return { url: '', serverType: 'uploadcare', id: '', embedCode: '', subtitles: [] };
    }, [item, episodes, currentEpIndex, currentAudio, autoSubtitleVttUrl]);

    // Track active video and prompt resume if watched before
    useEffect(() => {
        if (!activeVideo.id) return;
        if (lastActiveVideoIdRef.current !== activeVideo.id) {
            lastActiveVideoIdRef.current = activeVideo.id;
            setCurrentTime(0);
            setDuration(0);
            setLastTime(0);
            setIsAudioLoading(false);
            if (videoRef.current && videoRef.current.readyState >= 1) {
                try {
                    videoRef.current.currentTime = 0;
                } catch (e) {}
            }
            if (audioRef.current) {
                audioRef.current.pause();
                try {
                    audioRef.current.removeAttribute('src');
                    audioRef.current.load();
                } catch (e) {}
            }

            const progress = watchProgress[activeVideo.id];
            if (progress && progress.currentTime > 10 && (progress.duration === 0 || progress.duration - progress.currentTime > 15)) {
                setResumeTime(progress.currentTime);
                setShowResumeToast(true);
                const timer = setTimeout(() => {
                    setShowResumeToast(false);
                }, 10000); // 10s auto-dismiss
                return () => clearTimeout(timer);
            } else {
                setShowResumeToast(false);
                setResumeTime(0);
            }
        }
    }, [activeVideo.id, watchProgress]);

    const handleResume = useCallback(() => {
        if (videoRef.current) {
            videoRef.current.currentTime = resumeTime;
        } else if (ytPlayerRef.current && ytPlayerRef.current.seekTo) {
            ytPlayerRef.current.seekTo(resumeTime, true);
        }
        setShowResumeToast(false);
    }, [resumeTime]);

    const handleRestart = useCallback(() => {
        if (videoRef.current) {
            videoRef.current.currentTime = 0;
        } else if (ytPlayerRef.current && ytPlayerRef.current.seekTo) {
            ytPlayerRef.current.seekTo(0, true);
        }
        updateProgress(activeVideo.id, 0, duration || 1);
        setShowResumeToast(false);
    }, [activeVideo.id, duration, updateProgress]);

    // Refs for outside click detection
    const audioMenuRef = useRef<HTMLDivElement>(null);
    const settingsMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (audioMenuRef.current && !audioMenuRef.current.contains(event.target as Node)) {
                setIsAudioMenuOpen(false);
            }
            if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
                setIsSettingsOpen(false);
            }
        };

        if (isAudioMenuOpen || isSettingsOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isAudioMenuOpen, isSettingsOpen]);

    // Detector de links de Uqload para conversión automática a Embed
    const processedUrl = useMemo(() => {
        const url = activeVideo.url;
        if (url.includes('uqload.com') && !url.includes('embed-')) {
            // Convierte https://uqload.com/xyz a https://uqload.com/embed-xyz.html
            const idMatch = url.match(/uqload\.com\/([a-zA-Z0-9]+)/);
            if (idMatch) return `https://uqload.com/embed-${idMatch[1]}.html`;
        }
        return url;
    }, [activeVideo.url]);

    const isEmbed = processedUrl.includes('iframe') || processedUrl.includes('uqload.com') || processedUrl.includes('youtube.com') || item.source === 'youtube';

    // Sincronizar subtítulos nativos elegidos
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const syncTracks = () => {
            const tracks = video.textTracks;
            if (!tracks || tracks.length === 0) return;
            for (let i = 0; i < tracks.length; i++) {
                if (i === currentSubtitleIndex) {
                    tracks[i].mode = 'showing';
                } else {
                    tracks[i].mode = 'disabled';
                }
            }
        };

        video.addEventListener('loadedmetadata', syncTracks);
        video.addEventListener('canplay', syncTracks);

        if (video.textTracks) {
            video.textTracks.addEventListener('addtrack', syncTracks);
        }

        syncTracks();
        const t1 = setTimeout(syncTracks, 100);
        const t2 = setTimeout(syncTracks, 500);

        return () => {
            video.removeEventListener('loadedmetadata', syncTracks);
            video.removeEventListener('canplay', syncTracks);
            if (video.textTracks) {
                video.textTracks.removeEventListener('addtrack', syncTracks);
            }
            clearTimeout(t1);
            clearTimeout(t2);
        };
    }, [currentSubtitleIndex, activeVideo]);

    useEffect(() => {
        setCurrentSubtitleIndex(-1);
        setShowSubtitlesMenu(false);
    }, [activeVideo.id]);

    const [isPiPActive, setIsPiPActive] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const togglePiP = useCallback(async () => {
        if (!videoRef.current || isEmbed) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled) {
                await videoRef.current.requestPictureInPicture();
            }
        } catch (error) {
            console.error("Error toggling Picture-in-Picture:", error);
        }
    }, [isEmbed]);

    // --- LÓGICA DE SKIP INTRO Y MOMENTOS DE OMISIÓN ---
    const activeSkipSegments = useMemo<SkipSegment[]>(() => {
        const data = item.type === 'movie' ? item : episodes[currentEpIndex];
        if (!data) return [];

        if (data.skipSegments && Array.isArray(data.skipSegments) && data.skipSegments.length > 0) {
            return data.skipSegments
                .map(seg => ({
                    label: seg.label || 'Omitir intro',
                    start: Number(seg.start) || 0,
                    end: Number(seg.end) || 0
                }))
                .filter(seg => seg.end > seg.start);
        }

        if (data.skipIntro && data.skipIntro > 0) {
            const start = data.introStart !== undefined ? data.introStart : 2;
            return [{
                label: 'Omitir intro',
                start,
                end: data.skipIntro
            }];
        }

        return [];
    }, [item, episodes, currentEpIndex]);

    const activeSkipSegment = useMemo(() => {
        if (!activeSkipSegments.length) return null;
        return activeSkipSegments.find(seg => currentTime >= seg.start && currentTime < seg.end) || null;
    }, [activeSkipSegments, currentTime]);

    const handleSkipSegment = useCallback((targetSegment?: SkipSegment | null) => {
        const seg = targetSegment || activeSkipSegment;
        if (seg && seg.end > 0) {
            let skipped = false;
            if (videoRef.current) {
                videoRef.current.currentTime = seg.end;
                skipped = true;
            } else if (ytPlayerRef.current && ytPlayerRef.current.seekTo) {
                ytPlayerRef.current.seekTo(seg.end, true);
                skipped = true;
            }
            
            if (skipped) {
                setShowSkipButton(false);
                const labelName = seg.label || 'Intro';
                setSkipNotificationText(`${labelName} omitido/a`);
                setShowSkipNotification(true);
                setTimeout(() => setShowSkipNotification(false), 3000);

                const segKey = `${activeVideo.id}_${seg.start}_${seg.end}`;
                hasAutoSkippedRef.current = segKey;
            }
        }
    }, [activeSkipSegment, activeVideo.id]);

    // Monitor de tiempo y skip automático
    useEffect(() => {
        const interval = setInterval(() => {
            let current = 0;
            let dur = 0;

            if (videoRef.current) {
                current = videoRef.current.currentTime;
                dur = videoRef.current.duration;
            } else if (ytPlayerRef.current && ytPlayerRef.current.getCurrentTime) {
                current = ytPlayerRef.current.getCurrentTime();
                dur = ytPlayerRef.current.getDuration();
            }

            if (current > 0) {
                setCurrentTime(current);
                setDuration(dur);
                (window as any).seikotv_current_time = current;

                // Lógica de botón Skip Intro y momentos de omisión
                const matchingSeg = activeSkipSegments.find(s => current >= s.start && current < s.end);
                if (matchingSeg) {
                    const segKey = `${activeVideo.id}_${matchingSeg.start}_${matchingSeg.end}`;
                    if (autoSkipIntro && hasAutoSkippedRef.current !== segKey) {
                        handleSkipSegment(matchingSeg);
                    } else if (!autoSkipIntro) {
                        setShowSkipButton(true);
                    }
                } else {
                    setShowSkipButton(false);
                }
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [activeSkipSegments, autoSkipIntro, handleSkipSegment, activeVideo.id]);

    // Reset prefetched episode ref and purge expired/irrelevant cache entries when content item or episode changes
    const PREFETCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
    const prefetchedCacheRef = useRef<Map<number, {
        timestamp: number;
        timerId?: NodeJS.Timeout;
        imgElement?: HTMLImageElement;
        logoElement?: HTMLImageElement;
        linkElement?: HTMLLinkElement;
        aborter?: AbortController;
    }>>(new Map());

    const purgePrefetchCache = useCallback((keepIndex?: number) => {
        const now = Date.now();
        prefetchedCacheRef.current.forEach((entry, idx) => {
            const isExpired = now - entry.timestamp >= PREFETCH_CACHE_TTL_MS;
            const isIrrelevant = keepIndex === undefined || idx !== keepIndex;
            if (isExpired || isIrrelevant) {
                if (entry.timerId) clearTimeout(entry.timerId);
                if (entry.imgElement) {
                    entry.imgElement.src = '';
                }
                if (entry.logoElement) {
                    entry.logoElement.src = '';
                }
                if (entry.linkElement && entry.linkElement.parentNode) {
                    try { entry.linkElement.parentNode.removeChild(entry.linkElement); } catch (e) {}
                }
                if (entry.aborter) {
                    try { entry.aborter.abort(); } catch (e) {}
                }
                prefetchedCacheRef.current.delete(idx);
                console.log(`[Prefetch Cache] Expired/Evicted cached assets for episode index ${idx}`);
            }
        });
    }, []);

    useEffect(() => {
        prefetchedEpIndexRef.current = null;
        purgePrefetchCache();
    }, [item.id, currentEpIndex, purgePrefetchCache]);

    // Unmount cleanup for prefetched cache
    useEffect(() => {
        return () => {
            purgePrefetchCache();
        };
    }, [purgePrefetchCache]);

    // Background Prefetcher: preloads next episode metadata, thumbnail, and video headers when current episode passes 90% progress
    useEffect(() => {
        if (item.type !== 'series' || !episodes || episodes.length === 0) return;
        if (currentEpIndex >= episodes.length - 1) return;

        const nextEpTargetIndex = currentEpIndex + 1;
        if (prefetchedEpIndexRef.current === nextEpTargetIndex) return;

        if (duration > 0 && currentTime > 0 && (currentTime / duration) >= 0.90) {
            const nextEp = episodes[nextEpTargetIndex];
            if (!nextEp) return;

            prefetchedEpIndexRef.current = nextEpTargetIndex;
            console.log(`[Background Prefetcher] Progress >= 90% (${Math.round((currentTime / duration) * 100)}%). Prefetching next episode (Ep ${nextEpTargetIndex + 1}): ${nextEp.title}`);

            // Evict any old or irrelevant entries before populating new cache entry
            purgePrefetchCache(nextEpTargetIndex);

            const aborter = new AbortController();
            const cacheEntry: {
                timestamp: number;
                timerId?: NodeJS.Timeout;
                imgElement?: HTMLImageElement;
                logoElement?: HTMLImageElement;
                linkElement?: HTMLLinkElement;
                aborter?: AbortController;
            } = {
                timestamp: Date.now(),
                aborter
            };

            // Set TTL timer to auto-expire entry if not played within 5 minutes
            cacheEntry.timerId = setTimeout(() => {
                console.log(`[Prefetch Cache] 5-min TTL expired for episode index ${nextEpTargetIndex}. Evicting assets.`);
                purgePrefetchCache();
            }, PREFETCH_CACHE_TTL_MS);

            // 1. Prefetch Next Episode Thumbnail & Logo
            const thumbUrl = nextEp.thumbnailUrl || (nextEp as any).stillUrl || (nextEp as any).poster || item.thumbnailUrl || (item as any).banner || (item as any).coverUrl;
            if (thumbUrl) {
                const img = new Image();
                img.src = thumbUrl;
                cacheEntry.imgElement = img;
            }
            if (nextEp.titleLogoUrl) {
                const logoImg = new Image();
                logoImg.src = nextEp.titleLogoUrl;
                cacheEntry.logoElement = logoImg;
            }

            // 2. Prefetch Next Episode Video Metadata & Headers
            if (nextEp.videoUrl && (nextEp.videoUrl.startsWith('http://') || nextEp.videoUrl.startsWith('https://'))) {
                try {
                    const link = document.createElement('link');
                    link.rel = 'prefetch';
                    link.as = 'fetch';
                    link.href = nextEp.videoUrl;
                    link.dataset.prefetchEp = String(nextEpTargetIndex);
                    document.head.appendChild(link);
                    cacheEntry.linkElement = link;
                } catch (e) {}

                // Warm up HTTP connection & cache initial video bytes with abort signal
                fetch(nextEp.videoUrl, {
                    method: 'GET',
                    headers: { Range: 'bytes=0-2048' },
                    mode: 'cors',
                    signal: aborter.signal
                }).then(() => {
                    console.log(`[Background Prefetcher] Successfully preloaded video metadata header for Episode ${nextEpTargetIndex + 1}`);
                }).catch((err) => {
                    if (err.name !== 'AbortError') {
                        // Ignore CORS or range header errors silently in background
                    }
                });
            }

            prefetchedCacheRef.current.set(nextEpTargetIndex, cacheEntry);
        }
    }, [item, episodes, currentEpIndex, currentTime, duration, purgePrefetchCache]);

    // Inicialización de YouTube Player
    useEffect(() => {
        if (item.source === 'youtube' && item.youtubeId) {
            const initYT = () => {
                if ((window as any).YT && (window as any).YT.Player) {
                    ytPlayerRef.current = new (window as any).YT.Player(ytContainerId, {
                        videoId: item.youtubeId,
                        playerVars: {
                            autoplay: 1,
                            controls: 0,
                            modestbranding: 1,
                            rel: 0,
                            showinfo: 0,
                            enablejsapi: 1
                        },
                        events: {
                            onReady: (event: any) => {
                                event.target.playVideo();
                                try {
                                    event.target.setVolume(volume * 100);
                                } catch (e) {}
                                if (lastTime > 0) {
                                    event.target.seekTo(lastTime, true);
                                } else if (watchProgress[activeVideo.id]) {
                                    const progress = watchProgress[activeVideo.id];
                                    const shouldPrompt = progress && progress.currentTime > 10 && (progress.duration === 0 || progress.duration - progress.currentTime > 15);
                                    if (!shouldPrompt) {
                                        event.target.seekTo(progress.currentTime, true);
                                    }
                                }
                            },
                            onStateChange: (event: any) => {
                                if (event.data === (window as any).YT.PlayerState.PLAYING) setIsPlaying(true);
                                else if (event.data === (window as any).YT.PlayerState.PAUSED) setIsPlaying(false);
                                else if (event.data === (window as any).YT.PlayerState.ENDED) {
                                    if (item.type === 'series' && bingeWatchEnabledRef.current && currentEpIndexRef.current < episodesRef.current.length - 1) {
                                        setAutoplayCountdown(5);
                                    }
                                }
                            }
                        }
                    });
                } else {
                    setTimeout(initYT, 500);
                }
            };
            initYT();
        }
        return () => {
            if (ytPlayerRef.current) {
                ytPlayerRef.current.destroy();
            }
        };
    }, [item.youtubeId, ytContainerId, activeVideo.id, lastTime, watchProgress]);

    const resetIdleTimer = useCallback(() => {
        setShowControls(true);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
            if (isAudioMenuOpen || showSubtitlesMenu || isSettingsOpen) {
                // Keep controls open if a menu is actively used
                return;
            }
            setShowControls(false);
            setIsAudioMenuOpen(false);
        }, 3000);
    }, [isAudioMenuOpen, showSubtitlesMenu, isSettingsOpen]);

    const resetScreensaver = useCallback(() => {
        setShowScreensaver(false);
        if (screensaverTimerRef.current) {
            clearTimeout(screensaverTimerRef.current);
            screensaverTimerRef.current = null;
        }

        if (videoRef.current && videoRef.current.paused && !videoRef.current.ended) {
            screensaverTimerRef.current = setTimeout(() => {
                setShowScreensaver(true);
            }, 5000);
        }
    }, [videoRef]);

    useEffect(() => {
        const handleActivity = () => {
            resetIdleTimer();
            resetScreensaver();
        };

        window.addEventListener('mousemove', handleActivity);
        window.addEventListener('touchstart', handleActivity);
        window.addEventListener('keydown', handleActivity);
        window.addEventListener('mousedown', handleActivity);

        handleActivity();

        return () => {
            window.removeEventListener('mousemove', handleActivity);
            window.removeEventListener('touchstart', handleActivity);
            window.removeEventListener('keydown', handleActivity);
            window.removeEventListener('mousedown', handleActivity);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            if (screensaverTimerRef.current) clearTimeout(screensaverTimerRef.current);
        };
    }, [resetIdleTimer, resetScreensaver]);

    // 1. Lógica de Firebase: Consultar sub-colección de episodios
    useEffect(() => {
        if (item.type === 'series') {
            const fetchEpisodes = async () => {
                setLoading(true);
                try {
                    // Consultamos la sub-colección "episodes" del documento de la serie
                    const episodesRef = collection(db, "content", item.id, "episodes");
                    const q = query(episodesRef, orderBy("episodeNumber", "asc"));
                    const querySnapshot = await getDocs(q);
                    
                    const episodesData = querySnapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    } as Episode));

                    if (episodesData.length > 0) {
                        episodesData.sort((a, b) => {
                            const sA = a.seasonNumber || 1;
                            const sB = b.seasonNumber || 1;
                            if (sA !== sB) return sA - sB;
                            return (a.episodeNumber || 0) - (b.episodeNumber || 0);
                        });
                        setEpisodes(episodesData);
                    } else if (item.seasons && item.seasons.length > 0) {
                        // Fallback a mock data flatten across all seasons
                        const allEp = item.seasons.flatMap((s, sIdx) => 
                            (s.episodes || []).map((ep, epIdx) => ({
                                ...ep,
                                seasonNumber: ep.seasonNumber || s.seasonNumber || (sIdx + 1),
                                episodeNumber: ep.episodeNumber || (epIdx + 1)
                            }))
                        );
                        setEpisodes(allEp);
                    }
                } catch (error) {
                    console.error("Error fetching episodes:", error);
                    if (item.seasons && item.seasons.length > 0) {
                        const allEp = item.seasons.flatMap((s, sIdx) => 
                            (s.episodes || []).map((ep, epIdx) => ({
                                ...ep,
                                seasonNumber: ep.seasonNumber || s.seasonNumber || (sIdx + 1),
                                episodeNumber: ep.episodeNumber || (epIdx + 1)
                            }))
                        );
                        setEpisodes(allEp);
                    }
                } finally {
                    setLoading(false);
                }
            };
            fetchEpisodes();
        } else {
            setLoading(false);
        }
    }, [item]);

    const playerContainerRef = useRef<HTMLDivElement>(null);

    const togglePlay = useCallback(() => {
        if (isEmbed) {
            if (ytPlayerRef.current) {
                const state = ytPlayerRef.current.getPlayerState();
                if (state === 1) ytPlayerRef.current.pauseVideo();
                else ytPlayerRef.current.playVideo();
            }
            return;
        }

        if (videoRef.current) {
            if (videoRef.current.paused) videoRef.current.play();
            else videoRef.current.pause();
        }
    }, [isEmbed]);

    const toggleMute = useCallback(() => {
        if (isEmbed) {
            if (ytPlayerRef.current) {
                if (ytPlayerRef.current.isMuted()) ytPlayerRef.current.unMute();
                else ytPlayerRef.current.mute();
                setIsMuted(ytPlayerRef.current.isMuted());
            }
            return;
        }

        if (videoRef.current) {
            videoRef.current.muted = !videoRef.current.muted;
            setIsMuted(videoRef.current.muted);
        }
    }, [isEmbed]);

    const jump = useCallback((seconds: number) => {
        if (isEmbed) {
            if (ytPlayerRef.current) {
                const current = ytPlayerRef.current.getCurrentTime();
                ytPlayerRef.current.seekTo(current + seconds, true);
            }
            return;
        }

        if (videoRef.current) {
            videoRef.current.currentTime += seconds;
        }
    }, [isEmbed]);

    const toggleFullscreen = useCallback(() => {
        if (!playerContainerRef.current) return;
        if (!document.fullscreenElement) {
            playerContainerRef.current.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    }, []);

    useEffect(() => {
        const isTyping = () => {
            const el = document.activeElement;
            if (!el) return false;
            const tag = el.tagName.toUpperCase();
            return tag === 'INPUT' || tag === 'TEXTAREA' || el.hasAttribute('contenteditable');
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (isTyping()) return;

            if (!showControls) setShowControls(true);
            resetIdleTimer();

            if (e.code === 'Space' || e.keyCode === 32) {
                e.preventDefault();
                if (e.repeat) return;

                spacePressedRef.current = true;
                if (spaceHoldTimerRef.current) clearTimeout(spaceHoldTimerRef.current);
                
                spaceHoldTimerRef.current = setTimeout(() => {
                    if (spacePressedRef.current) {
                        startAccelerating();
                    }
                }, 300);
                return;
            }

            switch(e.code) {
                case 'KeyM':
                    toggleMute();
                    break;
                case 'KeyF':
                    toggleFullscreen();
                    break;
                case 'ArrowRight':
                    jump(10);
                    break;
                case 'ArrowLeft':
                    jump(-10);
                    break;
                case 'KeyH':
                    setShowHelpModal(prev => !prev);
                    break;
                case 'Escape':
                    setShowHelpModal(false);
                    break;
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (isTyping()) return;

            if (e.code === 'Space' || e.keyCode === 32) {
                e.preventDefault();
                spacePressedRef.current = false;
                if (spaceHoldTimerRef.current) {
                    clearTimeout(spaceHoldTimerRef.current);
                    spaceHoldTimerRef.current = null;
                }

                if (isAcceleratingRef.current) {
                    stopAccelerating();
                } else {
                    togglePlay();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            if (spaceHoldTimerRef.current) clearTimeout(spaceHoldTimerRef.current);
        };
    }, [togglePlay, toggleMute, toggleFullscreen, jump, showControls, resetIdleTimer, startAccelerating, stopAccelerating, setShowHelpModal]);

    const youtubeUrl = useMemo(() => {
        if (item.source === 'youtube' && item.youtubeId) {
            return `https://www.youtube.com/embed/${item.youtubeId}?autoplay=1&modestbranding=1&rel=0&showinfo=0&controls=0&enablejsapi=1`;
        }
        return null;
    }, [item]);

    useEffect(() => {
        const speedToUse = isAccelerating ? 2.0 : playbackSpeed;
        if (ytPlayerRef.current && ytPlayerRef.current.setPlaybackRate) {
            ytPlayerRef.current.setPlaybackRate(speedToUse);
        }
        if (videoRef.current) {
            videoRef.current.playbackRate = speedToUse;
        }
    }, [playbackSpeed, isAccelerating]);

    useEffect(() => {
        const v = videoRef.current;
        if (!v || isEmbed) return;
        
        const onTime = () => { 
            if(v.duration) {
                updateProgress(activeVideo.id, v.currentTime, v.duration);
                setLastTime(v.currentTime);
                setCurrentTime(v.currentTime);
                setDuration(v.duration);
            }
        };
        const onLoaded = () => { 
            if (lastTime > 0) {
                v.currentTime = lastTime;
            } else if (watchProgress[activeVideo.id]) {
                const progress = watchProgress[activeVideo.id];
                const shouldPrompt = progress && progress.currentTime > 10 && (progress.duration === 0 || progress.duration - progress.currentTime > 15);
                if (!shouldPrompt) {
                    v.currentTime = progress.currentTime;
                }
            }
            setDuration(v.duration);
        };
        
        const handlePlayEvent = () => {
            setIsPlaying(true);
            setShowScreensaver(false);
            if (screensaverTimerRef.current) {
                clearTimeout(screensaverTimerRef.current);
                screensaverTimerRef.current = null;
            }
        };

        const handlePauseEvent = () => {
            if (isSystemPausingRef.current) {
                console.log("[Multi-Audio] Pausa de sistema detectada. Preservando estado isPlaying=true");
                isSystemPausingRef.current = false;
                return;
            }
            setIsPlaying(false);
            if (screensaverTimerRef.current) clearTimeout(screensaverTimerRef.current);
            screensaverTimerRef.current = setTimeout(() => {
                setShowScreensaver(true);
            }, 5000);
        };

        const handleEnterPiP = () => setIsPiPActive(true);
        const handleLeavePiP = () => setIsPiPActive(false);

        const handleEndedEvent = () => {
            if (item.type === 'series' && bingeWatchEnabledRef.current && currentEpIndexRef.current < episodesRef.current.length - 1) {
                setAutoplayCountdown(5);
            }
        };

        v.addEventListener('timeupdate', onTime);
        v.addEventListener('loadedmetadata', onLoaded);
        v.addEventListener('play', handlePlayEvent);
        v.addEventListener('pause', handlePauseEvent);
        v.addEventListener('enterpictureinpicture', handleEnterPiP);
        v.addEventListener('leavepictureinpicture', handleLeavePiP);
        v.addEventListener('ended', handleEndedEvent);
        v.addEventListener('loadedmetadata', () => {
            v.playbackRate = isAccelerating ? 2.0 : playbackSpeed;
        });
        const handleVideoVolumeChange = () => {
            const hasExternal = !isEmbed && !!activeAudioTrack?.url;
            if (!hasExternal) {
                setIsMuted(v.muted);
            }
            setVolume(v.volume);
        };

        v.addEventListener('volumechange', handleVideoVolumeChange);
        
        return () => { 
            v.removeEventListener('timeupdate', onTime); 
            v.removeEventListener('loadedmetadata', onLoaded); 
            v.removeEventListener('play', handlePlayEvent);
            v.removeEventListener('pause', handlePauseEvent);
            v.removeEventListener('enterpictureinpicture', handleEnterPiP);
            v.removeEventListener('leavepictureinpicture', handleLeavePiP);
            v.removeEventListener('ended', handleEndedEvent);
            v.removeEventListener('volumechange', handleVideoVolumeChange);
        };
    }, [activeVideo.id, isEmbed, lastTime, activeAudioTrack]);

    // Scroll-up and swipe-down event listeners to trigger Picture-in-Picture mode automatically
    useEffect(() => {
        if (isPiPActive) return;

        const handleWheel = (e: WheelEvent) => {
            // deltaY < 0 means wheeling/scrolling up (moving finger/scroll up)
            if (e.deltaY < -8) {
                setIsPiPActive(true);
            }
        };

        let touchStartY = 0;
        const handleTouchStart = (e: TouchEvent) => {
            touchStartY = e.touches[0].clientY;
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (isPiPActive) return;
            const currentY = e.touches[0].clientY;
            const diffY = currentY - touchStartY; // Positive diffY means swiping downwards (which scrolls up)
            if (diffY > 60) {
                setIsPiPActive(true);
            }
        };

        window.addEventListener('wheel', handleWheel, { passive: true });
        window.addEventListener('touchstart', handleTouchStart, { passive: true });
        window.addEventListener('touchmove', handleTouchMove, { passive: true });

        return () => {
            window.removeEventListener('wheel', handleWheel);
            window.removeEventListener('touchstart', handleTouchStart);
            window.removeEventListener('touchmove', handleTouchMove);
        };
    }, [isPiPActive]);

    const handleNext = () => {
        if (currentEpIndex < episodes.length - 1) {
            setIsNextClicked(true);
            setTimeout(() => setIsNextClicked(false), 1500);
            setLastTime(0);
            setCurrentTime(0);
            setDuration(0);
            setIsAudioLoading(false);
            if (videoRef.current) {
                try {
                    videoRef.current.currentTime = 0;
                } catch (e) {}
            }
            setCurrentEpIndex(prev => prev + 1);
        }
    };

    // Binge-Watch Autoplay Timer logic
    useEffect(() => {
        if (autoplayCountdown === null) return;
        if (autoplayCountdown <= 0) {
            setAutoplayCountdown(null);
            handleNext();
            return;
        }

        const timer = setTimeout(() => {
            setAutoplayCountdown(prev => (prev !== null ? prev - 1 : null));
        }, 1000);

        return () => clearTimeout(timer);
    }, [autoplayCountdown, handleNext]);

    useEffect(() => {
        setAutoplayCountdown(null);
    }, [currentEpIndex]);

    const handleMarkAsWatched = () => {
        // Mark as 100% watched
        updateProgress(activeVideo.id, duration || 100, duration || 100);
        onClose();
        // Trigger feedback when marking as watched
        if (window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('seikotv_trigger_feedback'));
        }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        if (videoRef.current) {
            videoRef.current.currentTime = time;
        }
        setCurrentTime(time);
    };

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h > 0 ? h + ':' : ''}${m < 10 && h > 0 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
    };

    const handleAudioChange = (lang: string) => {
        if (videoRef.current && !isEmbed) {
            setLastTime(videoRef.current.currentTime);
        }
        setCurrentAudio(lang);
        setIsAudioMenuOpen(false);
    };



    // Ensure currentAudio is valid for the current content
    useEffect(() => {
        if (normalizedAudioTracks.length > 0) {
            const exists = normalizedAudioTracks.some(t => t.id === currentAudio);
            if (!exists) {
                // Fallback to ja if available
                const hasJa = normalizedAudioTracks.some(t => t.id === 'ja');
                setCurrentAudio(hasJa ? 'ja' : normalizedAudioTracks[0].id);
            }
        }
    }, [normalizedAudioTracks, currentAudio]);

    const [isAudioLoading, _setIsAudioLoading] = useState(false);
    const isAudioLoadingRef = useRef(false);
    const setIsAudioLoading = (loading: boolean) => {
        isAudioLoadingRef.current = loading;
        _setIsAudioLoading(loading);
    };
    const audioRef = useRef<HTMLAudioElement>(null);

    // Audio Preloading Logic: Preloads secondary tracks in background when normalizedAudioTracks updates
    useEffect(() => {
        if (normalizedAudioTracks && normalizedAudioTracks.length > 0) {
            audioPreloadManager.preloadTracks(normalizedAudioTracks);
        }
    }, [normalizedAudioTracks]);

    // Memory optimization: Clean up preloaded tracks when full content item or episode selection changes or player unmounts
    useEffect(() => {
        return () => {
            audioPreloadManager.cleanup();
        };
    }, [item.id, currentEpIndex]);

    // Primary Video Buffering detection to pause background preloading automatically
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleWaiting = () => {
            audioPreloadManager.setBuffering(true);
        };

        const handlePlaying = () => {
            audioPreloadManager.setBuffering(false);
        };

        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('stalled', handleWaiting);
        video.addEventListener('canplay', handlePlaying);

        return () => {
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('stalled', handleWaiting);
            video.removeEventListener('canplay', handlePlaying);
        };
    }, [videoRef.current]);

    // Keep audio/video elements muted/volume in sync with React state
    useEffect(() => {
        const audio = audioRef.current;
        if (audio) {
            audio.muted = isMuted;
            audio.volume = volume;
        }
        const video = videoRef.current;
        if (video) {
            video.volume = volume;
        }
    }, [isMuted, volume]);

    // Audio / Video strict synchronization & Anti-Lag Correction
    useEffect(() => {
        const video = videoRef.current;
        const audio = audioRef.current;
        if (!video || !audio || isEmbed || !activeAudioTrack?.url) {
            if (video) {
                video.muted = false; // Unmute if no external audio track
                if (isPlayingRef.current && video.paused) {
                    video.play().catch(e => console.warn("Failed to play on original audio switch:", e));
                }
            }
            if (audio) {
                audio.removeAttribute('src');
                try {
                    audio.load();
                } catch (e) {}
            }
            setIsAudioLoading(false);
            return;
        }

        console.log(`[Multi-Audio] Activando pista de audio: "${activeAudioTrack.label}" (${activeAudioTrack.url})`);

        // Mute video native audio
        video.muted = true;

        // Immediately set loading to true and pause the video programmatically to wait for audio
        setIsAudioLoading(true);
        if (!video.paused) {
            isSystemPausingRef.current = true;
            video.pause();
        }

        // Set audio source - utilizing swift preloaded blob url if ready and video currentTime is in preloaded range
        const sourceUrl = audioPreloadManager.getPreloadedUrl(activeAudioTrack.id, activeAudioTrack.url, video.currentTime);
        audio.src = sourceUrl;
        audio.load();

        let initialSeekCompleted = false;
        const targetTime = video.currentTime;

        const checkReadyToPlay = () => {
            // Once initial seek (if any) and buffering are cleared, we are ready
            if (initialSeekCompleted || targetTime < 0.5) {
                // Audio is ready to play at correct timestamp, hide loading spinner
                setIsAudioLoading(false);
                if (isPlayingRef.current && video.paused) {
                    isSystemPausingRef.current = false;
                    video.play().catch(e => console.warn("[MediaSync] Failed to resume video:", e));
                }
            }
        };

        const onMetadata = () => {
            if (targetTime >= 0.5) {
                // Seek audio to match video position
                try {
                    audio.currentTime = targetTime;
                } catch (e) {
                    console.warn("[MediaSync] Initial seek failed on metadata:", e);
                    initialSeekCompleted = true;
                    checkReadyToPlay();
                }
            } else {
                initialSeekCompleted = true;
                checkReadyToPlay();
            }
        };

        const onAudioSeeked = () => {
            if (!initialSeekCompleted && targetTime >= 0.5) {
                console.log(`[MediaSync] Initial audio seek completed to ${audio.currentTime}s`);
                initialSeekCompleted = true;
                checkReadyToPlay();
            }
        };

        // If audio already has metadata
        if (audio.readyState >= 1) {
            onMetadata();
        }

        audio.addEventListener('loadedmetadata', onMetadata);
        audio.addEventListener('canplay', checkReadyToPlay);
        audio.addEventListener('seeked', onAudioSeeked);

        // Match playback state
        if (!isPlaying) {
            audio.pause();
        }

        const handlePlay = () => {
            if (isAudioLoadingRef.current) {
                isSystemPausingRef.current = true;
                if (!video.paused) {
                    video.pause();
                }
                return;
            }
            audio.play().catch(e => console.warn("Audio play error during video play:", e));
        };

        const handlePause = () => {
            audio.pause();
        };

        const handleSeeking = () => {
            setIsAudioLoading(true);
            audio.pause();
        };

        const handleSeeked = () => {
            // Video seek completed, sync audio to it
            try {
                audio.currentTime = video.currentTime;
            } catch (e) {
                console.warn("[MediaSync] Seeked error:", e);
            }
        };

        // Initialize volume & mute from current React states
        audio.volume = volume;
        audio.muted = isMuted;

        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('seeking', handleSeeking);
        video.addEventListener('seeked', handleSeeked);

        let lastSyncTimestamp = 0;

        // Intervalo de Corrección de Desfase (Anti-Lag) con Throttle de 2.5s y mayor de tolerancia (0.35s)
        const syncInterval = setInterval(() => {
            if (!video.paused && !isAudioLoadingRef.current && !audio.seeking && audio.readyState >= 2) {
                const now = Date.now();
                if (now - lastSyncTimestamp < 2500) {
                    return; // Throttle to prevent stutter feedback loops
                }

                // Sincronización proactiva: Si el audio cargado es un Blob parcial y pasamos los 25s,
                // intercambiamos en caliente al stream directo de la red de forma transparente.
                const isBlob = audio.src.startsWith('blob:');
                if (isBlob && video.currentTime >= 25 && !audioPreloadManager.isComplete(activeAudioTrack.id)) {
                    console.log(`[AudioPreloadManager] Traspasando buffer parcial a stream directo de red para continuar de forma indefinida...`);
                    setIsAudioLoading(true);
                    
                    audio.src = activeAudioTrack.url;
                    audio.load();
                    
                    const handleSwapReady = () => {
                        try {
                            audio.currentTime = video.currentTime;
                        } catch (e) {
                            console.warn("Failed to seek on swap:", e);
                        }
                        setIsAudioLoading(false);
                        if (!video.paused) {
                            audio.play().catch(e => console.warn("Failed to play on swap:", e));
                        }
                        audio.removeEventListener('canplay', handleSwapReady);
                    };
                    audio.addEventListener('canplay', handleSwapReady);
                    return;
                }

                const diff = Math.abs(video.currentTime - audio.currentTime);
                if (diff > 0.35) {
                    console.log(`[Anti-Lag] Desfase detectado (${diff}s). Sincronizando...`);
                    lastSyncTimestamp = now;
                    try {
                        audio.currentTime = video.currentTime;
                    } catch (e) {
                        console.warn("[MediaSync] Anti-Lag correction seek failed:", e);
                    }
                }
            }
        }, 500);

        return () => {
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('seeking', handleSeeking);
            video.removeEventListener('seeked', handleSeeked);
            audio.removeEventListener('loadedmetadata', onMetadata);
            audio.removeEventListener('canplay', checkReadyToPlay);
            audio.removeEventListener('seeked', onAudioSeeked);
            clearInterval(syncInterval);
            audio.pause();
        };
    }, [activeAudioTrack, isEmbed]);

    const handleAudioWaiting = () => {
        setIsAudioLoading(true);
        if (videoRef.current && !videoRef.current.paused) {
            isSystemPausingRef.current = true;
            videoRef.current.pause();
        }
    };



    const availableTracks = useMemo(() => {
        return normalizedAudioTracks.map(t => t.id);
    }, [normalizedAudioTracks]);

    const handleShare = async () => {
        const shareUrl = window.location.origin + window.location.pathname + '?content=' + item.id + (item.type === 'series' && episodes[currentEpIndex] ? `&episode=${currentEpIndex + 1}` : '');
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(shareUrl);
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = shareUrl;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            setShowCopiedToast(true);
            setTimeout(() => setShowCopiedToast(false), 2500);
        } catch (err) {
            console.error("Error copying episode URL:", err);
            setShowCopiedToast(true);
            setTimeout(() => setShowCopiedToast(false), 2500);
        }
    };

    return (
        <div 
            ref={playerContainerRef} 
            className={`fixed z-[200] group flex flex-col items-center justify-center transition-all duration-500 overflow-hidden ${
                isPiPActive 
                    ? 'bottom-6 right-6 w-72 sm:w-96 aspect-video bg-[#0c0c0c] rounded-2xl border-2 border-red-600/30 shadow-[0_20px_50px_rgba(239,68,68,0.25)]' 
                    : 'inset-0 bg-black cursor-none'
            }`}
            style={{ 
                cursor: (showControls || autoplayCountdown !== null || isPiPActive) ? 'default' : 'none' 
            }}
        >
            {/* Top Close Button (X) */}
            <button 
                onClick={onClose} 
                className={`absolute top-4 md:top-6 right-4 md:right-8 z-[180] text-white/80 hover:text-white p-2.5 rounded-full hover:bg-white/10 transition-all cursor-pointer ${(showControls && !isPiPActive) ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}
                title="Cerrar reproductor"
            >
                <CloseIcon className="w-6 h-6 md:w-8 md:h-8" />
            </button>

            {/* Cabecera del reproductor (Top Left Overlay) */}
            <div className={`absolute top-0 inset-x-0 h-16 md:h-20 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-end px-4 md:px-8 z-[175] transition-all duration-500 ease-in-out ${(showControls && !isPiPActive) ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
                <div className="flex gap-2 items-center mr-12 md:mr-16">
                    <ContentLikeButton contentId={activeVideo.id || item.id} title={item.title} variant="header" />
                    <button 
                        onClick={handleShare}
                        className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full transition-all flex items-center justify-center cursor-pointer"
                        title="Compartir enlace"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                            <circle cx="18" cy="5" r="3"/>
                            <circle cx="6" cy="12" r="3"/>
                            <circle cx="18" cy="19" r="3"/>
                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                        </svg>
                    </button>
                    <button 
                        onClick={() => {
                            setIsMenuOpen(!isMenuOpen);
                            if (!isMenuOpen) {
                                setActiveTab(item.type === 'movie' ? 'info' : 'episodes');
                            }
                        }}
                        className={`bg-white/10 hover:bg-white/20 text-white p-2 rounded-full transition-all flex items-center justify-center cursor-pointer ${isMenuOpen ? 'ring-2 ring-red-600' : ''}`}
                        title={item.type === 'series' ? "Episodios y Detalles" : "Información"}
                    >
                        <ListIcon className="w-5 h-5" />
                    </button>
                    <button 
                        onClick={() => setIsPiPActive(true)} 
                        className="bg-red-600 hover:bg-red-700 text-white p-2 rounded-full transition-all cursor-pointer"
                        title="Mini Reproductor (PiP)"
                    >
                        <PiPIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Contenedor de Video Dinámico */}
            <div 
                className="w-full h-full absolute inset-0 flex items-center justify-center transition-transform duration-300 ease-out origin-center overflow-hidden" 
                style={{ 
                    transform: `scale(${zoomLevel})`,
                    filter: `brightness(${brightness}%)`
                }}
            >
                {loading ? (
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                        <span className="font-bebas text-white tracking-widest">Cargando Episodios...</span>
                    </div>
                ) : youtubeUrl ? (
                    <div className="w-full h-full relative">
                        <div id={ytContainerId} className="w-full h-full" />
                        {/* Overlay to block YouTube interactions and show custom controls */}
                        <div className="absolute inset-0 pointer-events-none" />
                    </div>
                ) : (
                    <>
                        <SeikoMediaEngine 
                            key={activeVideo.id || `${item.id}_${currentEpIndex}`}
                            videoUrl={activeVideo.url} 
                            serverType={activeVideo.serverType as any}
                            embedCode={activeVideo.embedCode}
                            videoRef={videoRef}
                            title={item.title}
                            subtitles={activeVideo.subtitles}
                        />
                        <audio 
                            ref={audioRef}
                            preload="auto"
                            className="hidden"
                            onWaiting={handleAudioWaiting}
                            onStalled={handleAudioWaiting}
                        />
                    </>
                )}

                {isAudioLoading && activeAudioTrack?.url && (
                    <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-[150] flex flex-col items-center justify-center animate-fade-in pointer-events-none">
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-12 h-12 rounded-full border-4 border-red-600/30 border-t-red-600 animate-spin shadow-[0_0_15px_rgba(239,68,68,0.5)]" />
                            <div className="text-red-500 font-bebas text-lg tracking-[0.2em] animate-pulse drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]">
                                Cargando Audio...
                            </div>
                            <p className="text-gray-400 text-[10px] uppercase tracking-widest font-black opacity-60">Sincronizando FanDub</p>
                        </div>
                    </div>
                )}
            </div>

                {/* Zonas interactivas invisibles para eventos táctiles (Aceleración x2 Dinámica) */}
                <div 
                    className="absolute left-0 top-20 bottom-32 w-1/4 z-[140] bg-transparent cursor-pointer select-none pointer-events-auto"
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchCancel}
                />
                <div 
                    className="absolute right-0 top-20 bottom-32 w-1/4 z-[140] bg-transparent cursor-pointer select-none pointer-events-auto"
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchCancel}
                />

                {/* Indicador Flotante de Aceleración x2 */}
                {isAccelerating && (
                    <div id="playback-speed-indicator" className="absolute top-24 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md border border-red-500/40 px-5 py-2.5 rounded-full text-red-500 font-extrabold text-xs tracking-widest flex items-center gap-2 z-[160] pointer-events-none select-none animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.5)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                        <span>⚡ x2</span>
                    </div>
                )}


                {/* Botón Omitir Intro / Segmentos */}
                {showSkipButton && activeSkipSegment && !isPiPActive && (
                    <button 
                        onClick={() => handleSkipSegment(activeSkipSegment)}
                        className="absolute bottom-24 md:bottom-32 left-4 md:left-8 bg-black/85 backdrop-blur-md text-white px-5 md:px-7 py-3 md:py-3.5 rounded-xl font-black text-xs md:text-sm border-2 border-red-600 shadow-[0_0_25px_rgba(220,38,38,0.6)] animate-fade-in hover:scale-105 transition-all z-[165] flex items-center gap-2.5 uppercase tracking-wider group"
                    >
                        <span className="text-red-400 font-mono text-xs md:text-sm group-hover:text-white transition-colors">
                            {formatSecondsToTime(activeSkipSegment.start)} - {formatSecondsToTime(activeSkipSegment.end)}
                        </span>
                        <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping" />
                        <span>{activeSkipSegment.label || 'Omitir intro'}</span>
                    </button>
                )}

                {/* Notificación Intro / Segmento Omitido */}
                {showSkipNotification && !isPiPActive && (
                    <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-md text-white px-6 py-2.5 rounded-full border border-red-500/30 text-[11px] font-bold tracking-widest uppercase animate-slide-up z-40 shadow-lg flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span>{skipNotificationText}</span>
                    </div>
                )}

                {/* Notificación Copiado / Copied! Toast */}
                {showCopiedToast && !isPiPActive && (
                    <div className="absolute top-20 md:top-24 left-1/2 -translate-x-1/2 bg-red-600/90 text-white px-6 py-2.5 rounded-full border border-white/20 text-xs md:text-sm font-bold tracking-widest uppercase shadow-[0_0_25px_rgba(239,68,68,0.7)] animate-slide-up z-50 flex items-center gap-2">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        <span>Copied!</span>
                    </div>
                )}

                {/* Countdown de reproducción automática (Binge-Watch Mode) */}
                {autoplayCountdown !== null && nextEpisode && !isPiPActive && (
                    <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[250] animate-fade-in">
                        <div className="bg-[#0e0e0e] border border-red-500/40 rounded-2xl p-6 md:p-8 shadow-[0_0_50px_rgba(239,68,68,0.25)] max-w-md w-full mx-4 flex flex-col items-center text-center gap-6">
                            <div className="flex flex-col items-center gap-1">
                                <span className="bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] md:text-xs font-black uppercase tracking-[0.25em] px-3 py-1 rounded-full animate-pulse">
                                    Siguiente episodio en...
                                </span>
                            </div>

                            {/* Gran círculo con el número de cuenta atrás pulsante */}
                            <div className="relative w-24 h-24 flex items-center justify-center">
                                <div className="absolute inset-0 rounded-full border-4 border-white/5" />
                                <div className="absolute inset-0 rounded-full border-4 border-red-600 border-t-transparent animate-spin duration-1000" />
                                <span className="text-white font-bebas text-5xl md:text-6xl tracking-tighter drop-shadow-[0_0_15px_rgba(239,68,68,0.6)] animate-ping absolute">
                                    {autoplayCountdown}
                                </span>
                                <span className="text-white font-bebas text-5xl md:text-6xl tracking-tighter drop-shadow-[0_0_15px_rgba(239,68,68,0.6)]">
                                    {autoplayCountdown}
                                </span>
                            </div>

                            {/* Tarjeta con los detalles del siguiente episodio */}
                            <div className="w-full bg-white/5 border border-white/10 rounded-xl p-4 flex gap-4 text-left items-center">
                                {nextEpisode.thumbnailUrl && (
                                    <div className="relative w-24 aspect-video flex-shrink-0 bg-gray-800 rounded overflow-hidden">
                                        <img 
                                            src={nextEpisode.thumbnailUrl} 
                                            alt={nextEpisode.title}
                                            className="w-full h-full object-cover"
                                            referrerPolicy="no-referrer"
                                        />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <span className="text-xs text-red-500 font-bold uppercase tracking-wider">Episodio {currentEpIndex + 2}</span>
                                    <h4 className="text-white font-bold text-sm md:text-base truncate">{nextEpisode.title}</h4>
                                    <p className="text-xs text-gray-400 truncate">{nextEpisode.description || 'Sin descripción'}</p>
                                </div>
                            </div>

                            {/* Botones de acción */}
                            <div className="flex gap-4 w-full">
                                <button
                                    onClick={() => setAutoplayCountdown(null)}
                                    className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 hover:border-white/20 py-3 rounded-xl text-xs md:text-sm font-black uppercase tracking-wider transition-all active:scale-95"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => {
                                        setAutoplayCountdown(null);
                                        handleNext();
                                    }}
                                    className={`flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl text-xs md:text-sm font-black uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)] hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 ${isNextClicked ? 'scale-105 ring-2 ring-red-400 animate-pulse' : ''}`}
                                >
                                    {isNextClicked ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                                            <span>Cargando...</span>
                                        </>
                                    ) : (
                                        <span>Reproducir Ya</span>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Toast de confirmación visual al cambiar de episodio */}
                {isNextClicked && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-[#0a0a0a]/90 backdrop-blur-md border border-red-500/60 text-white px-5 py-2.5 rounded-full z-[350] flex items-center gap-3 shadow-[0_0_30px_rgba(239,68,68,0.5)] animate-bounce pointer-events-none font-sans">
                        <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin shrink-0" />
                        <span className="text-xs md:text-sm font-extrabold uppercase tracking-widest text-red-400">
                            Cargando Siguiente Episodio...
                        </span>
                    </div>
                )}

                {/* Notificación para Reanudar o Reiniciar Reproducción */}
                {showResumeToast && !isPiPActive && (
                    <div className="absolute top-24 right-4 md:right-8 bg-[#0c0c0c]/95 backdrop-blur-md border border-[#ef4444]/40 rounded-xl p-4 md:p-5 shadow-[0_0_25px_rgba(239,68,68,0.25)] z-[300] max-w-sm animate-fade-in flex flex-col gap-3">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-lg bg-red-600/10 border border-red-600/30 flex items-center justify-center text-red-500 shrink-0">
                                <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div className="flex-grow min-w-0">
                                <h4 className="text-white font-bebas text-lg tracking-wider uppercase">¿Continuar viendo?</h4>
                                <p className="text-xs text-gray-400 leading-relaxed font-semibold">
                                    Te quedaste en <span className="text-red-500 font-extrabold">{formatTime(resumeTime)}</span>. ¿Quieres reanudar desde ahí o reiniciar?
                                </p>
                            </div>
                            <button 
                                onClick={() => setShowResumeToast(false)}
                                className="text-gray-500 hover:text-white transition-colors p-0.5"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="flex gap-2.5">
                            <button
                                onClick={handleResume}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:scale-[1.02] active:scale-95"
                            >
                                Reanudar ({formatTime(resumeTime)})
                            </button>
                            <button
                                onClick={handleRestart}
                                className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all border border-white/10 hover:border-white/25 active:scale-95"
                            >
                                Reiniciar
                            </button>
                        </div>
                    </div>
                )}

                {/* Floating Next Episode Button (Above Progress Bar on Right) */}
                {item.type === 'series' && currentEpIndex < episodes.length - 1 && (
                    <button 
                        onClick={handleNext}
                        className={`absolute bottom-24 md:bottom-28 right-4 md:right-10 font-bold text-xs md:text-sm px-4 md:px-5 py-2 md:py-2.5 rounded transition-all duration-300 shadow-2xl z-[180] flex items-center gap-2 cursor-pointer ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'} ${isNextClicked ? 'bg-red-600 text-white scale-110 ring-4 ring-red-500/60 shadow-[0_0_30px_rgba(239,68,68,0.85)] animate-pulse' : 'bg-[#e5e5e5] hover:bg-white text-black active:scale-90 hover:scale-[1.03]'}`}
                    >
                        {isNextClicked ? (
                            <>
                                <div className="w-3.5 h-3.5 md:w-4 md:h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                                <span>Cargando Siguiente...</span>
                            </>
                        ) : (
                            <>
                                <PlayIcon className="w-3.5 h-3.5 md:w-4 md:h-4 text-black" />
                                <span>Next Episode</span>
                            </>
                        )}
                    </button>
                )}

                {/* Bottom Controls Bar */}
                <div className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-8 pb-4 md:pb-6 px-4 md:px-10 flex flex-col gap-2 z-[170] transition-all duration-500 ease-in-out ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'}`}>
                    {/* Full-width Progress Bar */}
                    <div className="group/progress relative h-1.5 md:h-2 flex items-center cursor-pointer mb-1">
                        <input 
                            type="range"
                            min="0"
                            max={isNaN(duration) ? 100 : (duration || 100)}
                            value={isNaN(currentTime) ? 0 : currentTime}
                            onChange={handleSeek}
                            className="absolute inset-0 w-full h-full opacity-0 z-30 cursor-pointer"
                        />
                        <div className="absolute inset-0 bg-white/20 rounded-full" />
                        <div 
                            className="absolute inset-y-0 left-0 bg-[#e50914] rounded-full shadow-[0_0_8px_#e50914] transition-all duration-75"
                            style={{ width: `${(isNaN(currentTime) || isNaN(duration) || duration === 0) ? 0 : Math.min(100, Math.max(0, (currentTime / duration) * 100))}%` }}
                        />
                        <div 
                            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 md:w-4 md:h-4 bg-white rounded-full shadow-md z-20"
                            style={{ left: `${(isNaN(currentTime) || isNaN(duration) || duration === 0) ? 0 : Math.min(100, Math.max(0, (currentTime / duration) * 100))}%`, marginLeft: '-7px' }}
                        />
                    </div>

                    {/* Controls Row */}
                    <div className="flex items-center justify-between gap-2 md:gap-6 text-white font-sans">
                        {/* Left Side */}
                        <div className="flex items-center gap-3 md:gap-5 min-w-0">
                            <button onClick={togglePlay} className="text-white hover:opacity-80 transition-all p-1 cursor-pointer" title={isPlaying ? "Pausar" : "Reproducir"}>
                                {isPlaying ? <PauseIcon className="w-7 h-7 md:w-8 md:h-8" /> : <PlayIcon className="w-7 h-7 md:w-8 md:h-8" />}
                            </button>

                            <button onClick={() => jump(-10)} className="text-white/90 hover:text-white transition-all p-1 cursor-pointer" title="Retroceder 10s">
                                <Skip10Back className="w-6 h-6 md:w-7 md:h-7" />
                            </button>

                            <button onClick={() => jump(10)} className="text-white/90 hover:text-white transition-all p-1 cursor-pointer" title="Adelantar 10s">
                                <Skip10Forward className="w-6 h-6 md:w-7 md:h-7" />
                            </button>

                            <div className="flex items-center gap-2 group/volume relative">
                                <button onClick={toggleMute} className="text-white/90 hover:text-white transition-all p-1 cursor-pointer">
                                    {isMuted || volume === 0 ? <MuteIcon className="w-6 h-6 md:w-7 md:h-7" /> : <VolumeIcon className="w-6 h-6 md:w-7 md:h-7" />}
                                </button>
                                <div className="w-0 overflow-hidden group-hover/volume:w-20 md:group-hover/volume:w-28 transition-all duration-300">
                                    <input 
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={isMuted ? 0 : volume}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value);
                                            setVolume(v);
                                            if (videoRef.current) videoRef.current.volume = v;
                                            if (ytPlayerRef.current) ytPlayerRef.current.setVolume(v * 100);
                                            setIsMuted(v === 0);
                                        }}
                                        className="w-full h-1 bg-white/30 rounded-full appearance-none accent-red-600 cursor-pointer"
                                    />
                                </div>
                            </div>

                            <div className="text-white/90 font-mono text-xs md:text-sm font-medium tracking-wide whitespace-nowrap select-none">
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </div>
                        </div>

                        {/* Center Side: Badge & Title */}
                        <div className="hidden sm:flex items-center gap-2.5 max-w-[45%] truncate px-2">
                            {item.type === 'series' && (
                                <span className="bg-white text-black font-extrabold text-[11px] md:text-xs px-2.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 shadow-sm select-none">
                                    S{(item.type === 'series' && episodes[currentEpIndex]) ? (episodes[currentEpIndex].seasonNumber || 1) : 1} • E{(item.type === 'series' && episodes[currentEpIndex]) ? (episodes[currentEpIndex].episodeNumber || (currentEpIndex + 1)) : 1}
                                </span>
                            )}
                            <div className="text-xs md:text-sm font-semibold truncate select-none">
                                <span className="text-white">{item.title}</span>
                                {item.type === 'series' && (
                                    <>
                                        <span className="text-white/80 mx-1">–</span>
                                        <span className="text-[#22c55e] font-bold">
                                            {episodes[currentEpIndex]?.title || `Episode ${(item.type === 'series' && episodes[currentEpIndex]) ? (episodes[currentEpIndex].episodeNumber || (currentEpIndex + 1)) : 1}`}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Right Side */}
                        <div className="flex items-center gap-3 md:gap-5">
                            {/* Audio Selector Button */}
                            <button 
                                onClick={() => {
                                    setIsAudioMenuOpen(!isAudioMenuOpen);
                                    setShowSubtitlesMenu(false);
                                    setIsSettingsOpen(false);
                                }} 
                                className={`p-1 transition-all cursor-pointer ${isAudioMenuOpen ? 'text-red-500 scale-110' : 'text-white/90 hover:text-white'}`}
                                title="Selector de Audio e Idiomas"
                            >
                                <ChatBubblesIcon className="w-6 h-6 md:w-7 md:h-7" />
                            </button>

                            {/* Subtitles CC toggle */}
                            {activeVideo.subtitles && activeVideo.subtitles.length > 0 && (
                                <button 
                                    onClick={() => {
                                        setShowSubtitlesMenu(!showSubtitlesMenu);
                                        setIsAudioMenuOpen(false);
                                        setIsSettingsOpen(false);
                                    }} 
                                    className={`p-1 transition-all cursor-pointer ${currentSubtitleIndex !== -1 ? 'text-red-500' : 'text-white/90 hover:text-white'}`}
                                    title="Subtítulos (CC)"
                                >
                                    <div className={`border-2 ${currentSubtitleIndex !== -1 ? 'border-red-500 bg-red-500/20' : 'border-white/80'} rounded px-1 py-0.5 text-[10px] md:text-xs font-black tracking-tighter leading-none`}>
                                        CC
                                    </div>
                                </button>
                            )}

                            {/* Settings Gear */}
                            <button 
                                onClick={() => {
                                    setIsSettingsOpen(!isSettingsOpen);
                                    setIsAudioMenuOpen(false);
                                    setShowSubtitlesMenu(false);
                                }} 
                                className={`p-1 transition-all cursor-pointer ${isSettingsOpen ? 'text-red-500 rotate-45' : 'text-white/90 hover:text-white'}`}
                                title="Ajustes"
                            >
                                <GearIcon className="w-6 h-6 md:w-7 md:h-7 transition-transform" />
                            </button>

                            {/* Fullscreen */}
                            <button onClick={toggleFullscreen} className="text-white/90 hover:text-white transition-all p-1 cursor-pointer" title="Pantalla Completa">
                                <FullscreenIcon className="w-6 h-6 md:w-7 md:h-7" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Menú de Selector de Audios (Desktop/Laptop Layout) */}
                {isAudioMenuOpen && (
                    <div className="hidden md:flex absolute bottom-36 right-48 bg-[#0c0c0c]/95 backdrop-blur-xl border border-red-500/30 rounded-2xl p-6 shadow-[0_0_40px_rgba(220,38,38,0.25)] z-[230] w-72 max-w-xs animate-scale-in flex-col gap-4 text-left font-sans">
                        <div className="flex justify-between items-center border-b border-white/10 pb-2">
                            <h4 className="text-white font-bebas text-lg tracking-wider uppercase flex items-center gap-2">
                                <span className="text-red-500 text-base">🎧</span>
                                Selector de Audio
                            </h4>
                            <button 
                                onClick={() => setIsAudioMenuOpen(false)}
                                className="text-gray-400 hover:text-white text-xs font-black uppercase tracking-widest bg-white/5 px-2 py-1 rounded-md transition-colors"
                            >
                                Listo
                            </button>
                        </div>
                        
                        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto scrollbar-hide pr-1">
                            {normalizedAudioTracks.map(track => (
                                <button
                                    key={track.id}
                                    type="button"
                                    onClick={() => {
                                        setCurrentAudio(track.id);
                                        setIsAudioMenuOpen(false);
                                    }}
                                    className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs tracking-wider uppercase text-left transition-all flex items-center justify-between gap-2 border ${currentAudio === track.id ? 'bg-red-600 border-red-500 text-white shadow-lg shadow-red-600/20' : 'bg-white/5 border-transparent text-gray-300 hover:bg-white/10 hover:text-white'}`}
                                >
                                    <span className="truncate">{track.label}</span>
                                    {currentAudio === track.id && (
                                        <span className="w-2 h-2 rounded-full bg-white animate-ping shrink-0" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Menú de Subtítulos (Desktop/Laptop Layout) */}
                {showSubtitlesMenu && activeVideo.subtitles && activeVideo.subtitles.length > 0 && (
                    <div className="hidden md:flex absolute bottom-36 right-32 bg-[#0c0c0c]/95 backdrop-blur-xl border border-red-500/30 rounded-2xl p-6 shadow-[0_0_40px_rgba(220,38,38,0.25)] z-[230] w-64 max-w-xs animate-scale-in flex-col gap-4 text-left font-sans">
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <h4 className="text-white font-bebas text-lg tracking-wider uppercase flex items-center gap-2">
                                <Subtitles className="w-4 h-4 text-red-500" />
                                Subtítulos
                            </h4>
                            <button 
                                onClick={() => setShowSubtitlesMenu(false)}
                                className="text-gray-500 hover:text-white text-xs font-black uppercase tracking-widest bg-white/5 px-2 py-1 rounded-md transition-colors"
                            >
                                Listo
                            </button>
                        </div>
                        
                        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto scrollbar-hide pr-1">
                            {/* Opción Desactivar */}
                            <button
                                type="button"
                                onClick={() => {
                                    setCurrentSubtitleIndex(-1);
                                    setShowSubtitlesMenu(false);
                                }}
                                className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs tracking-wider uppercase text-left transition-all ${currentSubtitleIndex === -1 ? 'bg-red-600 text-white shadow-lg shadow-red-600/20' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                            >
                                🚫 Desactivados
                            </button>
                            
                            {/* Opciones de idiomas */}
                            {activeVideo.subtitles.map((sub, index) => (
                                <button
                                    key={index}
                                    type="button"
                                    onClick={() => {
                                        setCurrentSubtitleIndex(index);
                                        setShowSubtitlesMenu(false);
                                    }}
                                    className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs tracking-wider uppercase text-left transition-all flex items-center justify-between ${currentSubtitleIndex === index ? 'bg-red-600 text-white shadow-lg shadow-red-600/20' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                                >
                                    <span>💬 {sub.label}</span>
                                    {currentSubtitleIndex === index && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Mobile Bottom Sheet Menu for Subtitles */}
                {showSubtitlesMenu && activeVideo.subtitles && activeVideo.subtitles.length > 0 && !isPiPActive && (
                    <>
                        {/* Backdrop */}
                        <div 
                            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[250] md:hidden cursor-default animate-fade-in"
                            onClick={() => setShowSubtitlesMenu(false)}
                        />
                        {/* Sheet content */}
                        <div className="fixed bottom-0 left-0 right-0 max-w-xl mx-auto w-full bg-[#0c0c0c] border-t border-red-600/40 rounded-t-[25px] p-6 z-[260] md:hidden animate-slide-up shadow-[0_-15px_40px_rgba(239,68,68,0.15)] flex flex-col gap-4">
                            <div className="w-10 h-1.5 bg-white/10 rounded-full mx-auto" />
                            <div className="text-center">
                                <h3 className="text-red-500 text-sm font-bebas tracking-widest uppercase mb-1">Subtítulos</h3>
                                <p className="text-gray-500 text-[10px] uppercase tracking-widest font-bold">Selecciona el idioma de los subtítulos</p>
                            </div>
                            <div className="grid grid-cols-1 min-[450px]:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-1">
                                {/* Opción Desactivar */}
                                <button
                                    onClick={() => {
                                        setCurrentSubtitleIndex(-1);
                                        setShowSubtitlesMenu(false);
                                    }}
                                    className={`w-full text-left p-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-between gap-3 border ${currentSubtitleIndex === -1 ? 'text-red-500 bg-red-500/10 border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.1)]' : 'text-gray-300 bg-white/5 border-transparent hover:bg-white/10 hover:text-white'}`}
                                >
                                    <span className="truncate">🚫 Desactivados</span>
                                    {currentSubtitleIndex === -1 && (
                                        <div className="w-2.5 h-2.5 bg-red-600 rounded-full shadow-[0_0_10px_#ef4444] shrink-0" />
                                    )}
                                </button>
                                
                                {/* Opciones de idiomas */}
                                {activeVideo.subtitles.map((sub, index) => (
                                    <button
                                        key={index}
                                        onClick={() => {
                                            setCurrentSubtitleIndex(index);
                                            setShowSubtitlesMenu(false);
                                        }}
                                        className={`w-full text-left p-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-between gap-3 border ${currentSubtitleIndex === index ? 'text-red-500 bg-red-500/10 border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.1)]' : 'text-gray-300 bg-white/5 border-transparent hover:bg-white/10 hover:text-white'}`}
                                    >
                                        <span className="truncate">💬 {sub.label}</span>
                                        {currentSubtitleIndex === index && (
                                            <div className="w-2.5 h-2.5 bg-red-600 rounded-full shadow-[0_0_10px_#ef4444] shrink-0 animate-scale-in" />
                                        )}
                                    </button>
                                ))}
                            </div>
                            <button 
                                onClick={() => setShowSubtitlesMenu(false)}
                                className="w-full mt-2 py-4 bg-white/5 border border-white/15 hover:border-white/20 text-white font-bold text-xs rounded-xl tracking-widest uppercase transition-all"
                            >
                                Cerrar
                            </button>
                        </div>
                    </>
                )}

                {/* Mobile Bottom Sheet Menu for Audio Track Selection */}
                {isAudioMenuOpen && !isPiPActive && (
                    <>
                        {/* Backdrop */}
                        <div 
                            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[250] md:hidden cursor-default animate-fade-in"
                            onClick={() => setIsAudioMenuOpen(false)}
                        />
                        {/* Sheet content */}
                        <div className="fixed bottom-0 left-0 right-0 max-w-xl mx-auto w-full bg-[#0c0c0c] border-t border-red-600/40 rounded-t-[25px] p-6 z-[260] md:hidden animate-slide-up shadow-[0_-15px_40px_rgba(239,68,68,0.15)] flex flex-col gap-4">
                            <div className="w-10 h-1.5 bg-white/10 rounded-full mx-auto" />
                            <div className="text-center">
                                <h3 className="text-red-500 text-sm font-bebas tracking-widest uppercase mb-1">Pistas de Audio e Idioma</h3>
                                <p className="text-gray-500 text-[10px] uppercase tracking-widest font-bold">Selecciona tu idioma de audio preferido</p>
                            </div>
                            <div className="grid grid-cols-1 min-[450px]:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-1">
                                {normalizedAudioTracks.map(track => (
                                    <button
                                        key={track.id}
                                        onClick={() => {
                                            setCurrentAudio(track.id);
                                            setIsAudioMenuOpen(false);
                                        }}
                                        className={`w-full text-left p-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-between gap-3 border ${currentAudio === track.id ? 'text-red-500 bg-red-500/10 border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.1)]' : 'text-gray-300 bg-white/5 border-transparent hover:bg-white/10 hover:text-white'}`}
                                    >
                                        <span className="break-words line-clamp-2 pr-1 flex-1 text-left">{track.label}</span>
                                        {currentAudio === track.id && (
                                            <div className="w-2.5 h-2.5 bg-red-600 rounded-full shadow-[0_0_10px_#ef4444] shrink-0 animate-scale-in" />
                                        )}
                                    </button>
                                ))}
                            </div>
                            <button 
                                onClick={() => setIsAudioMenuOpen(false)}
                                className="w-full mt-2 py-4 bg-white/5 border border-white/10 hover:border-white/20 text-white font-bold text-xs rounded-xl tracking-widest uppercase transition-all"
                            >
                                Cerrar
                            </button>
                        </div>
                    </>
                )}

                {/* Informative Screensaver Overlay (Replicated from Image 2) */}
                {showScreensaver && (
                    <div 
                        onClick={() => setShowScreensaver(false)}
                        className="absolute inset-0 z-[180] bg-black/40 flex flex-col justify-between p-6 sm:p-10 md:p-16 select-none animate-fade-in transition-all duration-500 cursor-pointer"
                    >
                        {/* Smooth 40% subtle gradient backdrop overlay */}
                        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-transparent pointer-events-none" />

                        {/* Top-Right Close (X) Button */}
                        <button 
                            onClick={(e) => { e.stopPropagation(); setShowScreensaver(false); }}
                            className="absolute top-6 right-6 md:top-8 md:right-10 text-white/80 hover:text-white p-2 transition-colors cursor-pointer z-20"
                            title="Cerrar"
                        >
                            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        {/* Middle-Left Content Block */}
                        <div className="max-w-2xl text-left space-y-3 md:space-y-4 my-auto z-10 p-2 md:p-4">
                            {/* "Estás viendo" Header */}
                            <p className="text-gray-300 font-normal text-lg md:text-xl tracking-normal">
                                Estás viendo
                            </p>

                            {/* Title Logo or High-Impact Typography */}
                            <div className="flex items-center">
                                {((item.type === 'series' && episodes[currentEpIndex]?.titleLogoUrl) || item.titleLogoUrl) ? (
                                    <img 
                                        src={(item.type === 'series' && episodes[currentEpIndex]?.titleLogoUrl) || item.titleLogoUrl} 
                                        alt={item.title} 
                                        className="max-h-28 sm:max-h-36 md:max-h-44 lg:max-h-52 object-contain filter drop-shadow-md animate-fade-in my-1.5" 
                                        referrerPolicy="no-referrer"
                                    />
                                ) : (
                                    <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-none drop-shadow-md my-1">
                                        {item.title}
                                    </h1>
                                )}
                            </div>

                            {/* Metadata Row: Año • Rating • Duración/Temporadas */}
                            <div className="flex items-center gap-3 text-sm md:text-base font-semibold text-gray-300 flex-wrap my-1">
                                <span>{item.releaseYear || '2025'}</span>
                                <span className="border border-white/30 bg-white/10 px-1.5 py-0.5 rounded text-xs font-bold text-white tracking-wider">
                                    {item.rating || 'U/A 16+'}
                                </span>
                                <span>
                                    {item.type === 'series' ? `${(item as any).seasonsCount || (item.seasons ? item.seasons.length : 1)} Temporadas` : ((item as any).duration || '2h 10m')}
                                </span>
                            </div>

                            {/* Episode Identification Line */}
                            {item.type === 'series' && episodes[currentEpIndex] && (
                                <p className="text-base md:text-lg font-bold text-white mt-3 mb-1">
                                    Episodio {(episodes[currentEpIndex] as any).episodeNumber || (currentEpIndex + 1)}: {episodes[currentEpIndex]?.title || `Ep ${(episodes[currentEpIndex] as any).episodeNumber || (currentEpIndex + 1)}`}
                                </p>
                            )}

                            {/* Synopsis / Description */}
                            <p className="text-sm md:text-base text-gray-300 leading-relaxed font-normal line-clamp-3 select-none max-w-xl">
                                {(item.type === 'series' && episodes[currentEpIndex]?.description) || item.description}
                            </p>
                        </div>

                        {/* Bottom-Right "Siguiente episodio" Pill Button */}
                        {item.type === 'series' && currentEpIndex < episodes.length - 1 && (
                            <div className="absolute bottom-8 right-8 md:bottom-12 md:right-12 z-20">
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowScreensaver(false);
                                        handleNext();
                                    }}
                                    className="flex items-center gap-2.5 bg-white/20 hover:bg-white/30 active:bg-white/40 text-white font-semibold text-xs md:text-sm px-4 py-2.5 rounded-md transition-all backdrop-blur-md border border-white/15 shadow-lg cursor-pointer"
                                >
                                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                                    </svg>
                                    Siguiente episodio
                                </button>
                            </div>
                        )}
                    </div>
                )}

            {/* MENÚ DE DETALLES Y EPISODIOS (Lateral deslizable) */}
            <div className={`fixed right-0 top-0 bottom-0 w-full sm:w-80 bg-black/95 backdrop-blur-xl border-l border-white/10 z-[210] transition-transform duration-500 shadow-2xl p-6 overflow-y-auto ${(isMenuOpen && !isPiPActive) ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-4">
                    <h3 className="font-bebas text-2xl text-red-500 tracking-wider">
                        {item.type === 'series' ? 'Detalles & Episodios' : 'Detalles & Reparto'}
                    </h3>
                    <button onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                </div>

                {/* Selector de pestañas */}
                <div className="flex border-b border-white/10 mb-6 select-none font-semibold text-xs">
                    {item.type === 'series' && (
                        <button 
                            onClick={() => setActiveTab('episodes')}
                            className={`flex-1 py-2 text-center tracking-wider uppercase transition-all border-b-2 font-black ${activeTab === 'episodes' ? 'border-red-600 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                        >
                            Episodios
                        </button>
                    )}
                    <button 
                        onClick={() => setActiveTab('info')}
                        className={`flex-1 py-2 text-center tracking-wider uppercase transition-all border-b-2 font-black ${activeTab === 'info' ? 'border-red-600 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                    >
                        Sinopsis
                    </button>
                    <button 
                        onClick={() => setActiveTab('cast')}
                        className={`flex-1 py-2 text-center tracking-wider uppercase transition-all border-b-2 font-black ${activeTab === 'cast' ? 'border-red-600 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                    >
                        Reparto
                    </button>
                </div>
                
                {/* Episodes List Tab */}
                {activeTab === 'episodes' && item.type === 'series' && (
                    <div className="space-y-4 animate-fade-in animate-duration-150">
                        {episodes.map((ep, idx) => {
                            const progress = watchProgress[`${item.id}_${ep.id}`];
                            const percent = progress && progress.duration > 0 ? (progress.currentTime / progress.duration) * 100 : 0;

                            return (
                                <div 
                                    key={`${ep.id}-${idx}`}
                                    onClick={() => { setCurrentEpIndex(idx); setIsMenuOpen(false); }}
                                    className={`group cursor-pointer p-3 rounded-lg border transition-all ${currentEpIndex === idx ? 'bg-red-950/30 border-red-500 shadow-[0_0_15px_rgba(255,0,0,0.6)] ring-1 ring-red-500/50 animate-pulse' : 'bg-white/5 border-transparent hover:border-white/20'}`}
                                >
                                    <div className="flex gap-3">
                                        <div className="relative w-24 aspect-video flex-shrink-0 bg-gray-800 rounded overflow-hidden">
                                            <img src={ep.thumbnailUrl || item.thumbnailUrl} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                                            {currentEpIndex === idx && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-red-600/40">
                                                    <PlayIcon className="w-6 h-6 text-white" />
                                                </div>
                                            )}
                                            {/* Barra de progreso miniatura */}
                                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                                                <div className="h-full bg-red-500" style={{ width: `${percent}%` }} />
                                            </div>
                                        </div>
                                        <div className="flex flex-col justify-center min-w-0 flex-grow">
                                            <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Capítulo {idx + 1}</span>
                                            <h4 className="text-sm font-bold text-white truncate">{ep.title}</h4>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-gray-500">{ep.duration}</span>
                                                    <ContentLikeButton contentId={`${item.id}_${ep.id}`} variant="inline" />
                                                </div>
                                                {/* Download Button */}
                                                {ep.videoUrl && (
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (downloadedUrls.includes(ep.videoUrl)) {
                                                                removeDownload(ep.videoUrl);
                                                            } else {
                                                                downloadVideo(ep.videoUrl, {
                                                                    id: `${item.id}_${ep.id}`,
                                                                    title: `${item.title} - ${ep.title}`,
                                                                    thumbnailUrl: ep.thumbnailUrl || item.thumbnailUrl,
                                                                    type: 'episode',
                                                                    parentContent: item
                                                                });
                                                            }
                                                        }}
                                                        className="p-1 hover:bg-white/10 rounded-full transition-all relative"
                                                    >
                                                        {downloading[ep.videoUrl] !== undefined ? (
                                                            <DownloadProgressRing progress={downloading[ep.videoUrl]} size={26} />
                                                        ) : downloadedUrls.includes(ep.videoUrl) ? (
                                                            <svg className="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                                        ) : (
                                                            <DownloadIcon className="w-5 h-5 text-gray-400 hover:text-white transition-colors" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Info (Sinopsis) Tab */}
                {activeTab === 'info' && (
                    <div className="space-y-6 text-gray-300 animate-fade-in animate-duration-150">
                        <div className="relative aspect-video w-full bg-gray-900 rounded-lg overflow-hidden border border-white/5">
                            <img src={item.backdropUrl || item.thumbnailUrl} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                        </div>
                        <div className="space-y-3">
                            <h4 className="text-base font-black text-white">{item.title}</h4>
                            <div className="flex flex-wrap gap-2 items-center text-[10px]">
                                <span className="bg-red-600/20 text-red-500 px-2 py-0.5 rounded border border-red-600/30 font-black uppercase tracking-wider">
                                    {item.type === 'series' ? 'Serie' : 'Película'}
                                </span>
                                <span className="text-gray-400 font-bold">{item.releaseYear}</span>
                                <span className="px-1.5 py-0.2 border border-gray-600 text-gray-400 rounded uppercase font-bold">{item.rating}</span>
                                {item.status && (
                                    <span className={`px-2 py-0.5 rounded font-bold ${item.status === 'ongoing' ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' : item.status === 'completed' ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-500 border border-rose-500/30'}`}>
                                        {item.status === 'ongoing' ? 'En emisión' : item.status === 'completed' ? 'Terminado' : 'Cancelado'}
                                    </span>
                                )}
                            </div>
                            
                            <ContentLikeButton contentId={item.id} title={item.title} variant="full" className="my-3" />
                            
                            <div className="flex flex-wrap gap-1.5 pt-1">
                                {item.genre.map((g, idx) => (
                                    <span key={idx} className="bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white px-2 py-0.5 rounded border border-white/5 text-[10px] transition-colors font-semibold">
                                        {g}
                                    </span>
                                ))}
                            </div>
                        </div>
                        
                        <div className="border-t border-white/10 pt-4 space-y-2">
                            <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest block">Sinopsis</span>
                            <p className="text-xs md:text-sm text-gray-300 leading-relaxed font-semibold">
                                {item.description || "No hay una descripción disponible."}
                            </p>
                        </div>
                    </div>
                )}

                {/* Cast (Reparto) Tab */}
                {activeTab === 'cast' && (
                    <div className="space-y-4 animate-fade-in animate-duration-150 text-gray-300">
                        {loadingCast ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-3">
                                <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-xs text-gray-400 font-bold">Cargando reparto...</span>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] text-gray-400 uppercase font-black tracking-widest">Actores y Creadores</span>
                                    {cast.length > 0 ? (
                                        <span className="text-[9px] bg-red-600/10 text-red-500 px-1.5 py-0.5 rounded border border-red-600/20 font-black tracking-wider uppercase">Firestore</span>
                                    ) : (
                                        <span className="text-[9px] bg-white/5 text-gray-500 px-1.5 py-0.5 rounded border border-white/10 font-bold tracking-wider uppercase">Predeterminado</span>
                                    )}
                                </div>
                                
                                {(cast.length > 0 ? cast : getPlaceholderCast(item.title, item.type)).map((actor) => (
                                    <div key={actor.id} className="flex items-center gap-3 bg-white/5 hover:bg-white/10 p-2.5 rounded-lg border border-transparent hover:border-white/5 transition-all">
                                        {actor.avatar ? (
                                            <img src={actor.avatar} alt={actor.name} className="w-10 h-10 rounded-full object-cover bg-gray-800 border border-white/10 shrink-0" referrerPolicy="no-referrer" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-red-700/20 border border-red-600/30 flex items-center justify-center text-red-500 font-black shrink-0 text-sm">
                                                {actor.name.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-grow">
                                            <h5 className="text-white text-xs font-black truncate">{actor.name}</h5>
                                            <p className="text-[10px] text-gray-400 truncate font-semibold">
                                                {actor.role}
                                                {actor.character && <span className="text-red-500 font-bold"> · {actor.character}</span>}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {isPiPActive && (
                <div className="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-3.5 z-30 select-none">
                    {/* Mini Header */}
                    <div className="flex justify-between items-start">
                        <span className="text-[10px] font-bold text-white truncate max-w-[150px] bg-black/50 px-2 py-1 rounded border border-white/5 font-sans uppercase tracking-wider">
                            {item.title}
                        </span>
                        <div className="flex gap-2">
                            {/* Expand Button */}
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsPiPActive(false);
                                }}
                                className="w-7 h-7 bg-black/60 hover:bg-red-600 rounded-full flex items-center justify-center text-white transition-all transform active:scale-90 border border-white/10"
                                title="Volver a Pantalla Completa"
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9m5.25 11.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
                                </svg>
                            </button>
                            {/* Close Button */}
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClose();
                                }}
                                className="w-7 h-7 bg-black/60 hover:bg-red-600 rounded-full flex items-center justify-center text-white transition-all transform active:scale-90 border border-white/10"
                                title="Cerrar"
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Mini Center Play/Pause button */}
                    <div className="flex justify-center items-center">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                togglePlay();
                            }}
                            className="w-10 h-10 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-lg transition-all transform active:scale-90 hover:scale-105"
                        >
                            {isPlaying ? (
                                <PauseIcon className="w-5 h-5 text-white" />
                            ) : (
                                <PlayIcon className="w-5 h-5 text-white ml-0.5" />
                            )}
                        </button>
                    </div>

                    {/* Mini progress bar at the bottom */}
                    <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-red-600 transition-all duration-150"
                            style={{ width: `${((isNaN(currentTime) ? 0 : currentTime) / (isNaN(duration) || duration === 0 ? 1 : duration)) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {showHelpModal && !isPiPActive && (
                <div 
                    className="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[310] animate-fade-in"
                    onClick={() => setShowHelpModal(false)}
                >
                    <div 
                        className="bg-[#0c0c0c] border border-red-600/30 rounded-2xl p-6 md:p-8 shadow-[0_0_50px_rgba(239,68,68,0.25)] max-w-md w-full mx-4 flex flex-col gap-6 relative animate-scale-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex justify-between items-center border-b border-white/10 pb-4">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-red-600/10 border border-red-600/30 flex items-center justify-center text-red-500">
                                    <HelpIcon className="w-5 h-5" />
                                </div>
                                <h4 className="text-white font-bebas text-2xl tracking-wider uppercase">
                                    Atajos de Teclado
                                </h4>
                            </div>
                            <button 
                                onClick={() => setShowHelpModal(false)}
                                className="text-gray-400 hover:text-white transition-colors"
                                title="Cerrar"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Shortcuts list */}
                        <div className="flex flex-col gap-3.5 max-h-[60vh] overflow-y-auto pr-1">
                            {[
                                { keys: ['Espacio'], desc: 'Reproducir / Pausar (Mantener para Velocidad 2x)' },
                                { keys: ['▶', 'Flecha Derecha'], desc: 'Adelantar 10 segundos' },
                                { keys: ['◀', 'Flecha Izquierda'], desc: 'Retroceder 10 segundos' },
                                { keys: ['M'], desc: 'Silenciar / Activar sonido' },
                                { keys: ['F'], desc: 'Alternar Pantalla Completa' },
                                { keys: ['H'], desc: 'Mostrar / Ocultar esta ayuda' },
                                { keys: ['Esc'], desc: 'Cerrar esta ayuda o menús' },
                            ].map((shortcut, idx) => (
                                <div key={idx} className="flex items-center justify-between gap-4 py-1.5 border-b border-white/5 last:border-0">
                                    <span className="text-gray-400 text-xs font-semibold">{shortcut.desc}</span>
                                    <div className="flex gap-1.5 shrink-0">
                                        {shortcut.keys.map((key, keyIdx) => (
                                            <kbd 
                                                key={keyIdx} 
                                                className="bg-white/5 border border-white/10 px-2.5 py-1 rounded text-white font-mono text-[10px] font-bold shadow-md uppercase tracking-wider min-w-[30px] text-center"
                                            >
                                                {key}
                                            </kbd>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Footer info */}
                        <div className="text-center text-[10px] text-gray-500 font-medium">
                            Presiona <span className="text-red-500 font-bold font-mono bg-red-600/10 px-1 py-0.5 rounded border border-red-600/20">H</span> en cualquier momento del reproductor para abrir este menú
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- STATUS BADGE COMPONENT ---
const StatusBadge: React.FC<{ status?: 'ongoing' | 'completed' | 'cancelled' }> = ({ status }) => {
    if (!status) return null;

    const styles = {
        ongoing: "bg-[#39ff14]/80 text-black border-[#39ff14]", // Neon green
        completed: "bg-blue-900/80 text-white border-blue-500", // Dark blue
        cancelled: "bg-red-600/80 text-white border-red-500" // Red
    };

    const labels = {
        ongoing: "En emisión",
        completed: "Terminado",
        cancelled: "Cancelado"
    };

    return (
        <div className={`absolute top-2 left-2 z-20 px-2 py-0.5 rounded-md text-[8px] md:text-[10px] font-black uppercase tracking-widest border backdrop-blur-sm shadow-lg ${styles[status]}`}>
            {labels[status]}
        </div>
    );
};

// --- COMPONENTE DE TARJETA DE CONTENIDO ---
/**
 * FIX: Added missing ContentCard component to fix compilation error.
 * This component provides a Netflix-style hoverable card with progress tracking.
 */
const ContentCard: React.FC<{ 
    item: Content; 
    onPlay: () => void; 
    progress?: number; 
}> = ({ item, onPlay, progress }) => {
    return (
        <div 
            onClick={onPlay}
            className="group relative aspect-[2/3] bg-gray-900 rounded-lg md:rounded-xl overflow-hidden cursor-pointer transition-all duration-500 md:hover:scale-110 md:hover:z-10 shadow-xl border border-white/5 md:hover:border-red-600/50"
        >
            <StatusBadge status={item.status} />
            <div className="absolute top-2 right-2 z-20">
                <ContentLikeButton contentId={item.id} variant="badge" />
            </div>
            <PosterImage 
                src={item.thumbnailUrl} 
                alt={item.title}
                className="w-full h-full"
            />
            
            {/* Overlay Info (Desktop) */}
            <div className="absolute inset-0 flex flex-col justify-end p-2 md:p-4 opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-t from-black via-black/40 to-transparent">
                <div className="flex flex-col gap-0.5 md:gap-1 translate-y-4 md:group-hover:translate-y-0 transition-transform duration-300">
                    <span className="text-[8px] md:text-[10px] font-black text-red-500 uppercase tracking-widest">
                        {item.type === 'series' ? 'Serie' : 'Película'}
                    </span>
                    <h4 className="text-xs md:text-sm font-bold text-white line-clamp-1">{item.title}</h4>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[8px] md:text-[10px] text-gray-400">{item.releaseYear}</span>
                        <span className="text-[8px] md:text-[10px] px-1 border border-gray-600 text-gray-400 rounded uppercase">{item.rating}</span>
                    </div>
                </div>
            </div>

            {/* Mobile Info (Always visible or subtle) */}
            <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black to-transparent md:hidden">
                <h4 className="text-[10px] font-bold text-white truncate">{item.title}</h4>
            </div>

            {/* Play Button Center Overlay (Desktop) */}
            <div className="absolute inset-0 hidden md:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="bg-red-600 rounded-full p-3 shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-300">
                    <PlayIcon className="w-6 h-6 text-white" />
                </div>
            </div>

            {/* Progress Bar */}
            {progress !== undefined && progress > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                    <div className="h-full bg-red-600" style={{ width: `${progress}%` }} />
                </div>
            )}
        </div>
    );
};

// --- COMPONENTE PRINCIPAL ---
type Page = 'home' | 'movies' | 'series' | 'genres' | 'downloads';
type Filter = 'all' | 'recent' | 'popular' | 'following' | 'ongoing';

const MainApp: React.FC = () => {
    const { user, profile: currentProfile, isAdmin, loading, needsTermsAcceptance } = useAuth();
    const { t } = useLanguage();
    const { watchProgress, setActiveProfileId } = useUserHistory();
    const { downloadedUrls, downloading, downloadVideo, removeDownload } = useOfflineDownloads();

    const [currentPage, setCurrentPage] = useState<Page>('home');
    const [selectedGenre, setSelectedGenre] = useState<string>('all');
    const [genreContentTypeFilter, setGenreContentTypeFilter] = useState<'all' | 'series' | 'movie'>('all');
    const [genreSearchQuery, setGenreSearchQuery] = useState<string>('');
    const [teapotDate, setTeapotDate] = useState<string | null>(null);

    // Subscribe to Teapot config in Firestore
    useEffect(() => {
        const docRef = doc(db, "config", "teapot");
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setTeapotDate(docSnap.data().redirectDate || "2026-07-25");
            } else {
                setTeapotDate("2026-07-25"); // Default date if document doesn't exist
            }
        }, (error) => {
            console.error("Error listening to teapot config:", error);
            setTeapotDate("2026-07-25");
        });
        return () => unsubscribe();
    }, []);

    // Perform redirect on target date
    useEffect(() => {
        if (!teapotDate) return;

        // Get current date string in local time (YYYY-MM-DD)
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const currentDateStr = `${year}-${month}-${day}`;

        // Check if there is a query parameter to bypass (for testing/developing)
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('bypassTeapot') === 'true' || urlParams.get('bypass') === 'true') {
            console.log("Teapot redirect bypassed via URL parameter.");
            return;
        }

        if (currentDateStr === teapotDate) {
            console.log(`Redirecting to teapot on date: ${currentDateStr}`);
            window.location.href = "https://www.google.com/teapot";
        }
    }, [teapotDate]);
    
    // RAM Cleanup on page change
    useMemoryCleanup(currentPage);
    const [activeFilter, setActiveFilter] = useState<Filter>('all');
    const [contentList, setContentList] = useState<Content[]>(MOCK_CONTENT);

    const handleSelectGenre = useCallback((genre: string) => {
        setSelectedGenre(genre);
        setCurrentPage('genres');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const availableGenresWithCount = useMemo(() => {
        const counts: Record<string, { total: number; series: number; movies: number }> = {};
        
        contentList.forEach(item => {
            if (Array.isArray(item.genre)) {
                item.genre.forEach(rawGenre => {
                    const g = rawGenre ? rawGenre.trim() : '';
                    if (!g) return;
                    if (!counts[g]) {
                        counts[g] = { total: 0, series: 0, movies: 0 };
                    }
                    counts[g].total += 1;
                    if (item.type === 'series') counts[g].series += 1;
                    if (item.type === 'movie') counts[g].movies += 1;
                });
            }
        });

        const sortedGenres = Object.keys(counts).sort((a, b) => {
            if (counts[b].total !== counts[a].total) {
                return counts[b].total - counts[a].total;
            }
            return a.localeCompare(b);
        });

        return sortedGenres.map(genreName => ({
            name: genreName,
            counts: counts[genreName]
        }));
    }, [contentList]);

    const filteredGenresList = useMemo(() => {
        if (!genreSearchQuery.trim()) return availableGenresWithCount;
        const q = genreSearchQuery.toLowerCase().trim();
        return availableGenresWithCount.filter(g => g.name.toLowerCase().includes(q));
    }, [availableGenresWithCount, genreSearchQuery]);

    const getGenreIcon = (genreName: string) => {
        const lower = genreName.toLowerCase();
        if (lower.includes('sci-fi') || lower.includes('ciencia')) return '🚀';
        if (lower.includes('drama')) return '🎭';
        if (lower.includes('action') || lower.includes('acción')) return '💥';
        if (lower.includes('horror') || lower.includes('terror')) return '👻';
        if (lower.includes('comedy') || lower.includes('comedia')) return '😂';
        if (lower.includes('romance') || lower.includes('amor')) return '💖';
        if (lower.includes('adventure') || lower.includes('aventura')) return '🧭';
        if (lower.includes('fantasy') || lower.includes('fantasía')) return '🧙';
        if (lower.includes('mystery') || lower.includes('misterio')) return '🔍';
        if (lower.includes('crime') || lower.includes('crimen')) return '🕵️';
        if (lower.includes('history') || lower.includes('historia')) return '📜';
        if (lower.includes('family') || lower.includes('familia')) return '👨‍👩‍👧';
        if (lower.includes('music') || lower.includes('música')) return '🎵';
        if (lower.includes('thriller') || lower.includes('suspenso')) return '⚡';
        if (lower.includes('youtube')) return '▶️';
        return '🎬';
    };

    const continueWatchingList = useMemo(() => {
        const itemsWithProgress: Array<{ item: Content; lastWatched: number }> = [];

        contentList?.forEach(item => {
            if (item.type === 'movie') {
                const progress = watchProgress[item.id];
                if (progress && progress.currentTime > 0) {
                    const ratio = progress.currentTime / (progress.duration || 1);
                    if (ratio > 0.01 && ratio < 0.95) {
                        itemsWithProgress.push({
                            item,
                            lastWatched: progress.lastWatched || 0,
                        });
                    }
                }
            } else if (item.type === 'series') {
                let latestEpProgress: any = null;
                let latestEpId = '';
                let latestEpIndex = -1;

                const seriesEpisodes = item.seasons?.[0]?.episodes || [];

                Object.keys(watchProgress).forEach(key => {
                    if (key.startsWith(`${item.id}_`)) {
                        const progress = watchProgress[key];
                        if (progress && progress.currentTime > 0) {
                            if (!latestEpProgress || progress.lastWatched > latestEpProgress.lastWatched) {
                                latestEpProgress = progress;
                                latestEpId = key.substring(item.id.length + 1);
                            }
                        }
                    }
                });

                if (latestEpProgress) {
                    if (seriesEpisodes.length > 0) {
                        latestEpIndex = seriesEpisodes.findIndex(ep => ep.id === latestEpId);
                    }

                    const ratio = latestEpProgress.currentTime / (latestEpProgress.duration || 1);
                    if (ratio < 0.90) {
                        itemsWithProgress.push({
                            item,
                            lastWatched: latestEpProgress.lastWatched || 0,
                        });
                    } else {
                        if (latestEpIndex !== -1 && latestEpIndex < seriesEpisodes.length - 1) {
                            itemsWithProgress.push({
                                item,
                                lastWatched: latestEpProgress.lastWatched || 0,
                            });
                        }
                    }
                }
            }
        });

        return itemsWithProgress
            .sort((a, b) => b.lastWatched - a.lastWatched)
            .map(x => x.item);
    }, [contentList, watchProgress]);

    const getLatestProgress = useCallback((item: Content) => {
        if (item.type === 'movie') {
            const progress = watchProgress[item.id];
            if (progress && progress.currentTime > 0) {
                return (progress.currentTime / (progress.duration || 1)) * 100;
            }
        } else if (item.type === 'series') {
            let latestEpProgress: any = null;
            Object.keys(watchProgress).forEach(key => {
                if (key.startsWith(`${item.id}_`)) {
                    const progress = watchProgress[key];
                    if (progress && progress.currentTime > 0) {
                        if (!latestEpProgress || progress.lastWatched > latestEpProgress.lastWatched) {
                            latestEpProgress = progress;
                        }
                    }
                }
            });
            if (latestEpProgress) {
                const ratio = latestEpProgress.currentTime / (latestEpProgress.duration || 1);
                return ratio * 100;
            }
        }
        return undefined;
    }, [watchProgress]);
    const [selectedContentForModal, setSelectedContentForModal] = useState<Content | null>(null);
    const [selectedVideo, setSelectedVideo] = useState<Content | null>(null);
    const [selectedVideoEpIndex, setSelectedVideoEpIndex] = useState<number>(0);

    const handleOpenContentDetail = useCallback((item: Content) => {
        setSelectedContentForModal(item);
    }, []);

    const handlePlayFromModal = useCallback((item: Content, episodeIndex: number = 0) => {
        setSelectedContentForModal(null);
        setSelectedVideoEpIndex(episodeIndex);
        setSelectedVideo(item);
    }, []);
    const [isAdminOpen, setIsAdminOpen] = useState(false);
    const [isUploadFormOpen, setIsUploadFormOpen] = useState(false);
    const [isProfileEditOpen, setIsProfileEditOpen] = useState(false);
    const [isAdminModeActive, setIsAdminModeActive] = useState(false);
    const [logoClicks, setLogoClicks] = useState(0);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Content[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showFeedback, setShowFeedback] = useState(false);
    
    // Voice Search States and Handler
    const [isListening, setIsListening] = useState(false);
    const [voiceSearchError, setVoiceSearchError] = useState('');
    const recognitionRef = useRef<any>(null);
    
    // Search history and input focus states
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [isMobileSearchFocused, setIsMobileSearchFocused] = useState(false);
    const [searchHistory, setSearchHistory] = useState<string[]>([]);

    const [autoSkipIntro, setAutoSkipIntro] = useState(() => {
        return localStorage.getItem('seikotv_auto_skip_intro') === 'true';
    });

    const [activeProfile, setActiveProfile] = useState<UserProfile | null>(() => {
        const saved = sessionStorage.getItem('seikoyt_active_profile');
        try {
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    });

    useEffect(() => {
        setActiveProfileId(activeProfile?.id || null);
    }, [activeProfile, setActiveProfileId]);

    const handleProfileSelect = (profile: UserProfile) => {
        setActiveProfile(profile);
        sessionStorage.setItem('seikoyt_active_profile', JSON.stringify(profile));
    };

    const handleSwitchProfile = () => {
        setActiveProfile(null);
        sessionStorage.removeItem('seikoyt_active_profile');
    };

    // Load and sync Search History per Profile
    useEffect(() => {
        const key = `seikotv_search_history_${activeProfile?.id || 'global'}`;
        const saved = localStorage.getItem(key);
        try {
            setSearchHistory(saved ? JSON.parse(saved) : []);
        } catch {
            setSearchHistory([]);
        }
    }, [activeProfile]);

    const addToSearchHistory = useCallback((queryText: string) => {
        const trimmed = queryText.trim();
        if (!trimmed || trimmed.length < 2) return;
        setSearchHistory(prev => {
            const filtered = prev.filter(q => q.toLowerCase() !== trimmed.toLowerCase());
            const updated = [trimmed, ...filtered].slice(0, 5);
            const key = `seikotv_search_history_${activeProfile?.id || 'global'}`;
            localStorage.setItem(key, JSON.stringify(updated));
            return updated;
        });
    }, [activeProfile]);

    const deleteHistoryItem = useCallback((queryText: string) => {
        setSearchHistory(prev => {
            const updated = prev.filter(q => q !== queryText);
            const key = `seikotv_search_history_${activeProfile?.id || 'global'}`;
            localStorage.setItem(key, JSON.stringify(updated));
            return updated;
        });
    }, [activeProfile]);

    const clearSearchHistory = useCallback(() => {
        setSearchHistory([]);
        const key = `seikotv_search_history_${activeProfile?.id || 'global'}`;
        localStorage.removeItem(key);
    }, [activeProfile]);

    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [showInstallButton, setShowInstallButton] = useState(false);

    useEffect(() => {
        const handleBeforeInstallPrompt = (e: any) => {
            e.preventDefault();
            setDeferredPrompt(e);
            setShowInstallButton(true);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        // Check if already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setShowInstallButton(false);
        }

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const handleInstallClick = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setShowInstallButton(false);
        }
        setDeferredPrompt(null);
    };

    const logout = () => {
        auth.signOut();
    };

    useEffect(() => {
        localStorage.setItem('seikotv_auto_skip_intro', autoSkipIntro.toString());
    }, [autoSkipIntro]);

    const triggerFeedback = useCallback(() => {
        const lastShown = localStorage.getItem('seikotv_feedback_last_shown');
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;

        if (!lastShown || (now - parseInt(lastShown)) > oneWeek) {
            setShowFeedback(true);
        }
    }, []);

    useEffect(() => {
        // Trigger feedback after 5 minutes (300,000 ms)
        const timer = setTimeout(triggerFeedback, 300000);
        return () => clearTimeout(timer);
    }, [triggerFeedback]);

    const performSearch = useCallback(async (queryText: string) => {
        if (!queryText.trim()) {
            setSearchResults([]);
            return;
        }
        
        setIsSearching(true);
        addToSearchHistory(queryText);
        try {
            const apiKey = (import.meta as any).env.VITE_YOUTUBE_API_KEY;
            if (!apiKey) {
                console.warn("YouTube API Key not found in environment variables.");
                return;
            }

            const response = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=10&q=${encodeURIComponent(queryText)}&type=video&key=${apiKey}`);
            const data = await response.json();
            
            if (data.items) {
                const results: Content[] = data.items.map((item: any) => ({
                    id: item.id.videoId,
                    source: 'youtube',
                    type: 'movie',
                    title: item.snippet.title,
                    description: item.snippet.description,
                    thumbnailUrl: item.snippet.thumbnails.high.url,
                    backdropUrl: item.snippet.thumbnails.high.url,
                    genre: ['YouTube'],
                    rating: 'G',
                    releaseYear: new Date(item.snippet.publishedAt).getFullYear(),
                    youtubeId: item.id.videoId
                }));
                setSearchResults(results);
                setCurrentPage('home');
            }
        } catch (error) {
            console.error("YouTube Search Error:", error);
        } finally {
            setIsSearching(false);
        }
    }, [addToSearchHistory]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchQuery) {
                performSearch(searchQuery);
            } else {
                setSearchResults([]);
            }
        }, 600); // 600ms debounce

        return () => clearTimeout(timer);
    }, [searchQuery, performSearch]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        performSearch(searchQuery);
    };

    const toggleVoiceSearch = useCallback(() => {
        if (isListening) {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
            setIsListening(false);
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Tu navegador no soporta la API de reconocimiento de voz (Speech Recognition). Intenta con Google Chrome.");
            return;
        }

        try {
            const recognition = new SpeechRecognition();
            recognition.lang = 'es-ES';
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;

            recognition.onstart = () => {
                setIsListening(true);
                setVoiceSearchError('');
            };

            recognition.onerror = (event: any) => {
                console.error("Speech recognition error:", event.error);
                setVoiceSearchError(event.error);
                setIsListening(false);
                if (event.error === 'not-allowed') {
                    alert("Acceso al micrófono denegado. 🎙️\n\nPor favor, permite el acceso al micrófono en la barra de direcciones de tu navegador.\n\nNota: Si estás viendo la aplicación dentro de la ventana de vista previa (iframe), es posible que necesites abrirla en una pestaña independiente haciendo clic en el icono 'Abrir en pestaña nueva' de la esquina superior derecha para poder autorizar el micrófono.");
                } else if (event.error === 'no-speech') {
                    // Ignorar silencios para no molestar con alertas
                } else {
                    alert("Error de reconocimiento: " + event.error);
                }
            };

            recognition.onend = () => {
                setIsListening(false);
            };

            recognition.onresult = (event: any) => {
                const transcript = event.results[0][0].transcript;
                if (transcript) {
                    setSearchQuery(transcript);
                    performSearch(transcript);
                }
            };

            recognitionRef.current = recognition;
            recognition.start();
        } catch (err) {
            console.error("Failed to start speech recognition:", err);
            setIsListening(false);
        }
    }, [isListening, performSearch]);

    useEffect(() => {
        if (!isConfigured) return;
        const q = query(collection(db, "content"), orderBy("createdAt", "desc"));
        const unsub = onSnapshot(q, (snap) => {
            const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Content));
            setContentList([...data, ...MOCK_CONTENT.filter(m => !data.find(d => d.id === m.id))]);
        }, (error) => {
            console.warn("Error listening to content from Firestore:", error);
        });
        return () => unsub();
    }, []);

    const handleLogoClick = () => {
        const nextClicks = logoClicks + 1;
        setLogoClicks(nextClicks);
        if (nextClicks === 5) {
            setIsAdminModeActive(true);
            setLogoClicks(0);
        }
        setTimeout(() => setLogoClicks(0), 2000);
    };

    useEffect(() => {
        const handleTrigger = () => triggerFeedback();
        window.addEventListener('seikotv_trigger_feedback', handleTrigger);
        return () => window.removeEventListener('seikotv_trigger_feedback', handleTrigger);
    }, [triggerFeedback]);

    const featured = contentList.find(c => c.featured) || contentList[0];
    
    const filteredContent = useMemo(() => {
        let list = [...contentList];

        // Page filtering
        if (currentPage === 'movies') list = list.filter(item => item.type === 'movie');
        if (currentPage === 'series') list = list.filter(item => item.type === 'series');
        if (currentPage === 'genres') {
            if (genreContentTypeFilter === 'series') list = list.filter(item => item.type === 'series');
            if (genreContentTypeFilter === 'movie') list = list.filter(item => item.type === 'movie');

            if (selectedGenre && selectedGenre !== 'all') {
                list = list.filter(item => 
                    Array.isArray(item.genre) && item.genre.some(g => g.toLowerCase() === selectedGenre.toLowerCase())
                );
            }
        }

        // Tag filtering
        if (activeFilter === 'recent') {
            list = list.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));
        } else if (activeFilter === 'popular') {
            // Mocking popularity with rating or just a different sort
            list = list.sort((a, b) => b.title.localeCompare(a.title));
        } else if (activeFilter === 'following') {
            list = list.filter(item => {
                const progressKey = item.type === 'movie' ? item.id : `${item.id}_${item.seasons?.[0]?.episodes?.[0]?.id || ''}`;
                return watchProgress[progressKey] !== undefined;
            });
        } else if (activeFilter === 'ongoing') {
            list = list.filter(item => item.status === 'ongoing');
        }

        return list;
    }, [contentList, currentPage, activeFilter, watchProgress, selectedGenre, genreContentTypeFilter]);

    if (loading) {
        return (
            <div className="fixed inset-0 bg-[#0a0a0a] flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (needsTermsAcceptance) {
        return <TermsModal />;
    }

    if (!currentProfile) {
        return <Login />;
    }

    if (!activeProfile) {
        return <ProfileSelector onProfileSelect={handleProfileSelect} />;
    }

    return (
        <div className="bg-[#0a0a0a] min-h-screen flex flex-col text-white font-montserrat">
            <header className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/90 via-black/50 to-transparent h-16 md:h-24 px-4 md:px-16 flex items-center justify-between transition-all backdrop-blur-sm">
                <div className="flex items-center gap-4 md:gap-12">
                    <button 
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="md:hidden text-white p-2"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
                    </button>
                    <h1 
                        onClick={() => { setCurrentPage('home'); handleLogoClick(); }} 
                        className={`text-3xl md:text-5xl font-bebas tracking-widest cursor-pointer transition-all duration-300 select-none ${isAdminModeActive ? 'text-red-500 drop-shadow-[0_0_12px_rgba(239,68,68,0.8)]' : 'text-red-600'}`}
                    >
                        SEIKOTV
                    </h1>
                    <nav className="hidden md:flex gap-6 lg:gap-8">
                        {['home', 'movies', 'series', 'genres', 'downloads'].map(p => (
                            <button 
                                key={p} 
                                onClick={() => { setCurrentPage(p as Page); setSearchResults([]); }} 
                                className={`text-[11px] lg:text-[12px] font-bold uppercase tracking-[0.2em] lg:tracking-[0.3em] transition-all hover:text-red-500 ${currentPage === p && searchResults.length === 0 ? 'text-red-500 border-b-2 border-red-500' : 'text-gray-400'}`}
                            >
                                {p === 'home' ? 'Inicio' : p === 'movies' ? 'Películas' : p === 'series' ? 'Series' : p === 'genres' ? 'Géneros' : 'Descargas'}
                            </button>
                        ))}
                    </nav>
                </div>
                
                <div className="flex-grow max-w-md mx-8 hidden lg:block relative">
                    <form onSubmit={handleSearch} className="relative group">
                        <input 
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={() => setIsSearchFocused(true)}
                            onBlur={() => setTimeout(() => setIsSearchFocused(false), 250)}
                            placeholder="Buscar en YouTube..."
                            className="w-full bg-white/5 border border-white/10 px-12 py-2.5 rounded-full text-sm focus:bg-white/10 focus:border-red-600 outline-none transition-all placeholder:text-gray-500"
                        />
                        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-red-500 transition-colors" />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10">
                            {isSearching && (
                                <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                            )}
                            <button
                                type="button"
                                onClick={toggleVoiceSearch}
                                title="Búsqueda por voz"
                                className={`p-1.5 rounded-full hover:bg-white/10 transition-all flex items-center justify-center cursor-pointer ${isListening ? 'text-red-500 animate-pulse bg-red-500/20 shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'text-gray-400 hover:text-white'}`}
                            >
                                <AudioIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </form>

                    {/* Búsquedas Recientes Dropdown */}
                    {searchHistory.length > 0 && isSearchFocused && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-[#0c0c0c]/98 backdrop-blur-md border border-red-600/30 rounded-2xl p-4 shadow-[0_10px_35px_rgba(239,68,68,0.2)] z-[60] animate-fade-in space-y-3">
                            <div className="flex justify-between items-center border-b border-white/5 pb-2">
                                <span className="text-[10px] font-black tracking-widest text-[#ef4444] uppercase flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Búsquedas Recientes
                                </span>
                                <button 
                                    type="button"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        clearSearchHistory();
                                    }}
                                    className="text-[9px] font-black text-gray-500 hover:text-red-500 uppercase tracking-wider transition-colors"
                                >
                                    Borrar Todo
                                </button>
                            </div>
                            <div className="flex flex-col gap-1">
                                {searchHistory.map((query, index) => (
                                    <div 
                                        key={index}
                                        className="flex justify-between items-center group/item hover:bg-white/5 rounded-lg px-2.5 py-1.5 transition-all duration-200"
                                    >
                                        <button
                                            type="button"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                setSearchQuery(query);
                                                performSearch(query);
                                                setIsSearchFocused(false);
                                            }}
                                            className="flex-grow text-left text-xs text-gray-300 hover:text-white transition-colors flex items-center gap-2 font-medium"
                                        >
                                            {query}
                                        </button>
                                        <button
                                            type="button"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                deleteHistoryItem(query);
                                            }}
                                            className="opacity-0 group-hover/item:opacity-100 text-gray-500 hover:text-red-500 p-1 rounded-md hover:bg-white/5 transition-all duration-150"
                                            title="Eliminar de mi historial"
                                        >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 md:gap-6">
                    <button 
                        onClick={() => setIsMobileSearchOpen(!isMobileSearchOpen)}
                        className="lg:hidden text-white p-2"
                    >
                        <SearchIcon className="w-6 h-6" />
                    </button>

                    <button 
                        onClick={() => setIsUploadFormOpen(true)}
                        className="hidden md:flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-full hover:border-red-600/50 transition-all group"
                    >
                        <svg className="w-4 h-4 text-gray-400 group-hover:text-red-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 group-hover:text-white transition-colors">Subir</span>
                    </button>
                    {isAdminModeActive && isAdmin && (
                        <button onClick={() => setIsAdminOpen(true)} className="text-white hover:text-red-500 transition-all">
                            <svg className="w-6 h-6 md:w-7 md:h-7" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c.59-.24 1.13.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.11-.22.06-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                        </button>
                    )}
                    {showInstallButton && (
                        <button 
                            onClick={handleInstallClick}
                            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-full text-[10px] md:text-xs font-black uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(239,68,68,0.4)] flex items-center gap-2"
                        >
                            <svg className="w-3 h-3 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                            <span className="hidden sm:inline">Instalar App</span>
                            <span className="sm:hidden">Instalar</span>
                        </button>
                    )}
                    <div className="relative group">
                        <div className="flex items-center gap-2 cursor-pointer">
                            <img src={activeProfile.avatar} className="w-8 h-8 md:w-12 md:h-12 rounded-lg md:rounded-xl border-2 border-transparent hover:border-red-600 transition-all shadow-xl" />
                            <span className="hidden sm:block text-xs font-bold text-gray-400 group-hover:text-white transition-colors">{activeProfile.name}</span>
                        </div>
                        <div className="absolute top-full right-0 mt-2 w-48 bg-black/95 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all p-2 z-50">
                            <button onClick={handleSwitchProfile} className="w-full text-left px-4 py-2 text-xs font-bold hover:bg-white/5 rounded-lg transition-colors flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                Cambiar Perfil
                            </button>
                            <button onClick={() => setIsProfileEditOpen(true)} className="w-full text-left px-4 py-2 text-xs font-bold hover:bg-white/5 rounded-lg transition-colors">Ajustes de Cuenta</button>
                            <button onClick={logout} className="w-full text-left px-4 py-2 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors">Cerrar Sesión</button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Mobile Search Overlay */}
            <div className={`fixed inset-x-0 top-16 bg-black/95 z-[55] p-4 transition-all duration-300 lg:hidden ${isMobileSearchOpen ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'}`}>
                <form onSubmit={(e) => { handleSearch(e); setIsMobileSearchOpen(false); }} className="relative">
                    <input 
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => setIsMobileSearchFocused(true)}
                        onBlur={() => setTimeout(() => setIsMobileSearchFocused(false), 250)}
                        placeholder="Buscar en YouTube..."
                        className="w-full bg-white/10 border border-white/20 px-12 py-3 rounded-xl text-sm focus:border-red-600 outline-none transition-all"
                    />
                    <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10">
                        {isSearching && (
                            <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                        )}
                        <button
                            type="button"
                            onClick={toggleVoiceSearch}
                            title="Búsqueda por voz"
                            className={`p-1.5 rounded-full hover:bg-white/10 transition-all flex items-center justify-center cursor-pointer ${isListening ? 'text-red-500 animate-pulse bg-red-500/20 shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'text-gray-400 hover:text-white'}`}
                        >
                            <AudioIcon className="w-5 h-5" />
                        </button>
                    </div>
                </form>

                {/* Mobile Search History */}
                {searchHistory.length > 0 && isMobileSearchFocused && (
                    <div className="mt-4 bg-[#0c0c0c] border border-red-600/20 rounded-xl p-4 shadow-xl space-y-3">
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <span className="text-[10px] font-black tracking-widest text-[#ef4444] uppercase flex items-center gap-1.5">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Búsquedas Recientes
                            </span>
                            <button 
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    clearSearchHistory();
                                }}
                                className="text-[9px] font-black text-gray-500 hover:text-red-500 uppercase tracking-wider transition-colors"
                            >
                                Borrar
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {searchHistory.map((query, index) => (
                                <div key={index} className="flex items-center gap-1.5 bg-white/5 border border-white/10 hover:border-red-600/30 hover:bg-white/10 rounded-full px-3 py-1.5 transition-all">
                                    <button
                                        type="button"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            setSearchQuery(query);
                                            performSearch(query);
                                            setIsMobileSearchOpen(false);
                                        }}
                                        className="text-xs text-gray-300 hover:text-white font-medium"
                                    >
                                        {query}
                                    </button>
                                    <button
                                        type="button"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            deleteHistoryItem(query);
                                        }}
                                        className="text-gray-500 hover:text-red-500 p-0.5 rounded-full hover:bg-white/5 transition-colors"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Mobile Menu Overlay */}
            <div className={`fixed inset-0 bg-black/95 z-[60] transition-all duration-500 md:hidden ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                <div className="flex flex-col items-center justify-center h-full gap-8">
                    {['home', 'movies', 'series', 'genres', 'downloads'].map(p => (
                        <button 
                            key={p} 
                            onClick={() => { setCurrentPage(p as Page); setIsMobileMenuOpen(false); setSearchResults([]); }} 
                            className={`text-4xl font-bebas tracking-[0.2em] transition-all ${currentPage === p ? 'text-red-500' : 'text-gray-400'}`}
                        >
                            {p === 'home' ? 'Inicio' : p === 'movies' ? 'Películas' : p === 'series' ? 'Series' : p === 'genres' ? 'Géneros' : 'Descargas'}
                        </button>
                    ))}
                    <button 
                        onClick={() => { setIsUploadFormOpen(true); setIsMobileMenuOpen(false); }}
                        className="text-4xl font-bebas tracking-[0.2em] text-gray-400 hover:text-red-500 transition-all uppercase"
                    >
                        Subir
                    </button>
                    <button onClick={() => setIsMobileMenuOpen(false)} className="mt-12 text-gray-500 uppercase font-bold tracking-widest text-sm">Cerrar</button>
                </div>
            </div>

            <main className="flex-grow">
                {currentPage === 'home' && featured && (
                    <div className="relative h-[70vh] md:h-[90vh] w-full mb-8 md:mb-16 overflow-hidden">
                        <img src={featured.backdropUrl} className="w-full h-full object-cover animate-kenburns opacity-70" />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent" />
                        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-transparent" />
                        <div className="absolute bottom-12 md:bottom-32 left-4 md:left-24 right-4 md:right-auto max-w-3xl space-y-4 md:space-y-6 animate-fade-in-up">
                            <h2 className="text-4xl md:text-9xl font-bebas text-white drop-shadow-2xl leading-none">{featured.title}</h2>
                            <p className="text-sm md:text-xl text-gray-300 line-clamp-2 md:line-clamp-3 leading-relaxed drop-shadow-lg font-medium">{featured.description}</p>
                            <div className="flex flex-col sm:flex-row gap-3 md:gap-4 pt-2 md:pt-4">
                                <button onClick={() => handleOpenContentDetail(featured)} className="bg-white text-black px-6 md:px-12 py-3 md:py-5 rounded-lg md:rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-red-600 hover:text-white transition-all transform active:scale-95 shadow-2xl text-sm md:text-lg uppercase tracking-widest">
                                    <PlayIcon className="w-5 h-5 md:w-7 md:h-7" /> {t('play')}
                                </button>
                                <button onClick={() => handleOpenContentDetail(featured)} className="bg-gray-500/30 backdrop-blur-md text-white px-6 md:px-12 py-3 md:py-5 rounded-lg md:rounded-xl font-bold hover:bg-gray-500/50 transition-all text-sm md:text-lg uppercase tracking-widest border border-white/10">
                                    MÁS INFO
                                </button>
                                <ContentLikeButton contentId={featured.id} title={featured.title} variant="header" />
                                {/* Download button for featured movie */}
                                {featured.type === 'movie' && featured.videoUrl && (
                                    <button 
                                        onClick={() => downloadedUrls.includes(featured.videoUrl!) ? removeDownload(featured.videoUrl!) : downloadVideo(featured.videoUrl!, { ...featured, id: featured.id, type: 'movie' })}
                                        className="bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
                                    >
                                        {downloading[featured.videoUrl!] !== undefined ? (
                                            <DownloadProgressRing progress={downloading[featured.videoUrl!]} size={24} />
                                        ) : downloadedUrls.includes(featured.videoUrl!) ? (
                                            <svg className="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                        ) : (
                                            <DownloadIcon className="w-5 h-5" />
                                        )}
                                        <span className="text-xs font-bold uppercase tracking-widest">{downloadedUrls.includes(featured.videoUrl!) ? 'Descargado' : 'Descargar'}</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <div className={`px-4 md:px-24 pb-24 ${currentPage !== 'home' ? 'pt-24 md:pt-32' : ''}`}>

                    {currentPage === 'downloads' ? (
                        <div className="animate-fade-in">
                            <h3 className="text-2xl md:text-5xl font-bebas text-white tracking-[0.2em] uppercase border-l-4 md:border-l-8 border-red-600 pl-4 md:pl-6 mb-12">
                                Mis Descargas
                            </h3>
                            
                            {downloadedUrls.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-24 text-center">
                                    <DownloadIcon className="w-16 h-16 text-gray-700 mb-4" />
                                    <p className="text-gray-500 text-xl font-medium">No tienes descargas aún.</p>
                                    <p className="text-gray-600 text-sm mt-2">Los videos que descargues aparecerán aquí para ver sin conexión.</p>
                                    <button onClick={() => setCurrentPage('home')} className="mt-8 bg-red-600 text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest hover:bg-red-700 transition-all">Ver catálogo</button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                                    {downloadedUrls.map((url, idx) => {
                                        const metadata = JSON.parse(localStorage.getItem('seikotv_downloads_metadata') || '{}')[url];
                                        if (!metadata) return null;
                                        
                                        return (
                                            <div key={`${url}-${idx}`} className="group relative bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-red-600/50 transition-all shadow-2xl">
                                                <div className="relative aspect-video">
                                                    <img src={metadata.thumbnailUrl} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                                    <button 
                                                        onClick={() => {
                                                            setSelectedVideo(metadata.type === 'episode' ? metadata.parentContent : metadata);
                                                        }}
                                                        className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <div className="bg-red-600 p-4 rounded-full shadow-2xl transform scale-75 group-hover:scale-100 transition-transform">
                                                            <PlayIcon className="w-8 h-8 text-white" />
                                                        </div>
                                                    </button>
                                                </div>
                                                <div className="p-6">
                                                    <div className="flex justify-between items-start gap-4">
                                                        <div className="min-w-0">
                                                            <h4 className="text-white font-bold text-lg truncate">{metadata.title}</h4>
                                                            <p className="text-gray-500 text-[10px] uppercase tracking-widest mt-1">Listo para ver offline</p>
                                                        </div>
                                                        <button 
                                                            onClick={() => removeDownload(url)}
                                                            className="text-gray-500 hover:text-red-500 transition-colors"
                                                            title="Eliminar descarga"
                                                        >
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            
                            <div className="mt-12 p-6 bg-red-600/10 border border-red-600/20 rounded-2xl flex items-start gap-4">
                                <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                <div>
                                    <h5 className="text-white font-bold text-sm">Información sobre Descargas</h5>
                                    <p className="text-gray-400 text-xs mt-1 leading-relaxed">
                                        Las descargas ocupan espacio en tu dispositivo. La persistencia depende de tu navegador; si borras los datos del sitio o el historial, las descargas podrían eliminarse automáticamente.
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            {searchResults.length > 0 && (
                        <div className="mb-16 animate-fade-in">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                                <h3 className="text-2xl md:text-4xl font-bebas text-white tracking-[0.2em] uppercase border-l-4 md:border-l-8 border-red-600 pl-4 md:pl-6">
                                    Resultados de YouTube
                                </h3>
                                <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
                                    {searchHistory.length > 0 && (
                                        <div className="hidden sm:flex items-center gap-2 bg-white/5 border border-white/5 px-3 py-1 rounded-full text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                                            <span className="text-stone-500">Recientes:</span>
                                            <div className="flex gap-2">
                                                {searchHistory.slice(0, 3).map((q, idx) => (
                                                    <button
                                                        key={idx}
                                                        onClick={() => {
                                                            setSearchQuery(q);
                                                            performSearch(q);
                                                        }}
                                                        className="text-gray-400 hover:text-red-500 transition-colors uppercase text-[9px] hover:underline font-extrabold"
                                                    >
                                                        {q}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <button 
                                        onClick={() => { setSearchResults([]); setSearchQuery(''); }}
                                        className="text-gray-500 hover:text-white text-xs font-bold uppercase tracking-widest"
                                    >
                                        Limpiar
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-8">
                                {searchResults.map((item, idx) => (
                                    <ContentCard 
                                        key={`${item.id || 'search'}-${idx}`} 
                                        item={item} 
                                        onPlay={() => handleOpenContentDetail(item)} 
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {searchResults.length === 0 && currentPage === 'home' && continueWatchingList.length > 0 && (
                        <div className="mb-16 animate-fade-in">
                            <h3 className="text-2xl md:text-4xl font-bebas text-white tracking-[0.2em] uppercase border-l-4 md:border-l-8 border-red-600 pl-4 md:pl-6 mb-8 font-sans">
                                Continuar viendo
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-8">
                                {continueWatchingList.map((item, idx) => (
                                    <ContentCard 
                                        key={`continue-${item.id}-${idx}`} 
                                        item={item} 
                                        onPlay={() => handleOpenContentDetail(item)} 
                                        progress={getLatestProgress(item)} 
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Generos Page View */}
                    {searchResults.length === 0 && currentPage === 'genres' && (
                        <div className="mb-12 animate-fade-in space-y-8">
                            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-red-950/50 via-black to-stone-900/70 border border-red-600/30 p-6 md:p-10 shadow-[0_10px_35px_rgba(239,68,68,0.15)]">
                                <div className="relative z-10 max-w-3xl space-y-3">
                                    <div className="inline-flex items-center gap-2 bg-red-600/20 border border-red-600/40 text-red-500 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                                        <span>🎬</span> Explorador por Temáticas
                                    </div>
                                    <h2 className="text-3xl md:text-6xl font-bebas text-white tracking-[0.15em] uppercase">
                                        Descubre por Géneros y Temáticas
                                    </h2>
                                    <p className="text-gray-300 text-xs md:text-sm leading-relaxed max-w-2xl font-medium">
                                        Explora el catálogo completo filtrado por tus géneros favoritos: ciencia ficción, acción, romance, suspenso, comedia, misterio y más.
                                    </p>
                                </div>
                                <div className="absolute top-0 right-0 w-96 h-96 bg-red-600/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
                            </div>

                            {/* Tipo y Búsqueda de Género */}
                            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-white/5 border border-white/10 p-4 rounded-2xl">
                                <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0 scrollbar-hide">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mr-2 hidden sm:inline">
                                        Filtrar por:
                                    </span>
                                    {[
                                        { id: 'all', label: 'Todos los Contenidos' },
                                        { id: 'series', label: 'Solo Series' },
                                        { id: 'movie', label: 'Solo Películas' }
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setGenreContentTypeFilter(tab.id as any)}
                                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${genreContentTypeFilter === tab.id ? 'bg-red-600 text-white shadow-[0_0_12px_rgba(239,68,68,0.4)]' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'}`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>

                                <div className="relative max-w-xs w-full">
                                    <input
                                        type="text"
                                        value={genreSearchQuery}
                                        onChange={(e) => setGenreSearchQuery(e.target.value)}
                                        placeholder="Buscar género o tema..."
                                        className="w-full bg-black/60 border border-white/10 focus:border-red-600 px-4 py-2 pl-9 rounded-xl text-xs text-white placeholder-gray-500 outline-none transition-all"
                                    />
                                    <svg className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                    {genreSearchQuery && (
                                        <button 
                                            onClick={() => setGenreSearchQuery('')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs font-bold"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Tarjetas / Fichas de Géneros */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">
                                        Selecciona una Temática ({filteredGenresList.length})
                                    </span>
                                    {selectedGenre !== 'all' && (
                                        <button
                                            onClick={() => setSelectedGenre('all')}
                                            className="text-xs font-bold text-red-500 hover:text-red-400 uppercase tracking-wider flex items-center gap-1"
                                        >
                                            Ver Todos ↺
                                        </button>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                    <button
                                        onClick={() => setSelectedGenre('all')}
                                        className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-300 ${selectedGenre === 'all' ? 'bg-red-600 border-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)] scale-[1.02]' : 'bg-white/5 border-white/10 text-gray-300 hover:border-red-600/50 hover:bg-white/10 hover:text-white'}`}
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <span className="text-xl">🌟</span>
                                            <span className="font-bold text-xs truncate">Todos</span>
                                        </div>
                                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${selectedGenre === 'all' ? 'bg-white/20 text-white' : 'bg-white/10 text-gray-400'}`}>
                                            {contentList.length}
                                        </span>
                                    </button>

                                    {filteredGenresList.map(({ name, counts }) => {
                                        const isSelected = selectedGenre.toLowerCase() === name.toLowerCase();
                                        const icon = getGenreIcon(name);
                                        const countToShow = genreContentTypeFilter === 'series' ? counts.series : genreContentTypeFilter === 'movie' ? counts.movies : counts.total;

                                        return (
                                            <button
                                                key={name}
                                                onClick={() => setSelectedGenre(isSelected ? 'all' : name)}
                                                className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-300 ${isSelected ? 'bg-red-600 border-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)] scale-[1.02]' : 'bg-white/5 border-white/10 text-gray-300 hover:border-red-600/50 hover:bg-white/10 hover:text-white'}`}
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <span className="text-xl">{icon}</span>
                                                    <span className="font-bold text-xs truncate">{name}</span>
                                                </div>
                                                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-white/10 text-gray-400'}`}>
                                                    {countToShow}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 mb-8 md:mb-12">
                        <h3 className="text-2xl md:text-4xl font-bebas text-white tracking-[0.2em] uppercase border-l-4 md:border-l-8 border-red-600 pl-4 md:pl-6">
                            {currentPage === 'movies' ? 'Todas las Películas' : currentPage === 'series' ? 'Series SeikoTV' : currentPage === 'genres' ? (selectedGenre !== 'all' ? `Género: ${selectedGenre.toUpperCase()}` : 'Catálogo por Géneros') : 'Nuestras Recomendaciones'}
                        </h3>
                        
                        {/* Filtros Rápidos */}
                        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                            {[
                                { id: 'all', label: 'Todos' },
                                { id: 'recent', label: 'Recientes' },
                                { id: 'popular', label: 'Más vistos' },
                                { id: 'following', label: 'Siguiendo' },
                                { id: 'ongoing', label: 'En emisión' }
                            ].map(filter => (
                                <button
                                    key={filter.id}
                                    onClick={() => setActiveFilter(filter.id as Filter)}
                                    className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border whitespace-nowrap ${activeFilter === filter.id ? 'bg-red-600 border-red-600 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30 hover:text-white'}`}
                                >
                                    {filter.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {filteredContent.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center bg-white/5 border border-white/10 rounded-3xl p-8 my-8 animate-fade-in">
                            <span className="text-5xl mb-4">🔍</span>
                            <h4 className="text-2xl font-bebas text-white tracking-widest uppercase">
                                No hay contenidos disponibles
                            </h4>
                            <p className="text-gray-400 text-sm mt-2 max-w-md">
                                No se encontraron resultados para el género <strong className="text-white">"{selectedGenre}"</strong>
                                {genreContentTypeFilter !== 'all' ? ` (${genreContentTypeFilter === 'series' ? 'series' : 'películas'})` : ''}.
                            </p>
                            <button
                                onClick={() => { setSelectedGenre('all'); setGenreContentTypeFilter('all'); }}
                                className="mt-6 bg-red-600 text-white px-6 py-2.5 rounded-full font-bold uppercase tracking-widest text-xs hover:bg-red-700 transition-all shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                            >
                                Ver Todos los Géneros
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-8">
                            {filteredContent.map((item, idx) => {
                                // Si es serie, mostramos el progreso del primer capítulo como referencia general
                                const progressKey = item.type === 'movie' ? item.id : `${item.id}_${item.seasons?.[0]?.episodes?.[0]?.id || ''}`;
                                const progress = watchProgress[progressKey];
                                
                                return (
                                    <ContentCard 
                                        key={`${item.id}-${idx}`} 
                                        item={item} 
                                        onPlay={() => handleOpenContentDetail(item)} 
                                        progress={progress && progress.duration > 0 ? (progress.currentTime / progress.duration) * 100 : undefined} 
                                    />
                                );
                            })}
                        </div>
                    )}
                        </>
                    )}
                </div>
            </main>

            <Footer onNavigate={(tab) => {
                const validPages: Page[] = ['home', 'movies', 'series', 'genres', 'downloads'];
                if (validPages.includes(tab as any)) {
                    setCurrentPage(tab as any);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }} />

            {selectedContentForModal && (
                <ContentDetailModal
                    item={selectedContentForModal}
                    onClose={() => setSelectedContentForModal(null)}
                    onPlayEpisode={(item, epIndex) => handlePlayFromModal(item, epIndex)}
                    allContent={contentList}
                    onSelectContent={(item) => setSelectedContentForModal(item)}
                    downloadedUrls={downloadedUrls}
                    downloadVideo={downloadVideo}
                    downloading={downloading}
                    removeDownload={removeDownload}
                />
            )}

            {selectedVideo && (
                <VideoPlayer 
                    item={selectedVideo} 
                    initialEpIndex={selectedVideoEpIndex}
                    onClose={() => { setSelectedVideo(null); setSelectedVideoEpIndex(0); }} 
                    autoSkipIntro={autoSkipIntro}
                    setAutoSkipIntro={setAutoSkipIntro}
                    downloadedUrls={downloadedUrls}
                    downloadVideo={downloadVideo}
                    downloading={downloading}
                    removeDownload={removeDownload}
                />
            )}
            {isAdminOpen && <AdminPanel onClose={() => setIsAdminOpen(false)} />}
            {isUploadFormOpen && <ContentUploadForm onClose={() => setIsUploadFormOpen(false)} />}
            {isProfileEditOpen && (
                <ProfileEdit 
                    activeProfile={activeProfile} 
                    onClose={() => setIsProfileEditOpen(false)} 
                    onProfileUpdate={(updated) => setActiveProfile(updated)}
                />
            )}
            {showFeedback && currentProfile && <FeedbackToast userId={currentProfile.id} onClose={() => setShowFeedback(false)} />}
            <AiAssistant />

            {/* Voice Search active listening notification */}
            {isListening && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] bg-black/95 border border-red-600/30 px-6 py-4 rounded-2xl flex items-center gap-4 shadow-[0_0_30px_rgba(239,68,68,0.25)] animate-bounce select-none">
                    <div className="relative flex items-center justify-center h-10 w-10">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-8 w-8 bg-red-600 items-center justify-center">
                            <AudioIcon className="w-4 h-4 text-white animate-pulse" />
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-black text-white uppercase tracking-wider">Escuchando voz...</span>
                        <span className="text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">Habla ahora para buscar</span>
                    </div>
                </div>
            )}
        </div>
    );
};

const App: React.FC = () => (
    <AuthProvider>
        <LanguageProvider>
            <UserHistoryProvider>
                <MainApp />
            </UserHistoryProvider>
        </LanguageProvider>
    </AuthProvider>
);

export default App;
