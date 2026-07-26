
import React, { useState, useEffect } from 'react';
import { db } from './firebaseConfig';
import { collection, addDoc, serverTimestamp as firestoreTimestamp, getDocs, query, where, orderBy, deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { Content, Season } from './types';
import { LANGUAGES } from './constants';
import Uploader from './Uploader';
import SeikoMediaEngine from './src/components/SeikoMediaEngine';
import { useAuth } from './AuthContext';

const AdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { isAdmin, user } = useAuth();
    const canUploadLogo = isAdmin || user?.email === 'tomokari07@gmail.com';

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [type, setType] = useState<'movie' | 'series' | 'season' | 'episode' | 'cast' | 'teapot' | 'r2'>('movie');
    const [seriesList, setSeriesList] = useState<Content[]>([]);
    const [seasonsList, setSeasonsList] = useState<Season[]>([]);
    const [selectedSeriesId, setSelectedSeriesId] = useState('');
    const [selectedSeasonId, setSelectedSeasonId] = useState('');
    const [showPreview, setShowPreview] = useState(false);
    const [subtitles, setSubtitles] = useState<{ label: string; src: string }[]>([]);
    
    // AI Subtitles Generator States
    const [aiGeneratingSubtitles, setAiGeneratingSubtitles] = useState(false);
    const [aiSubtitlesStatus, setAiSubtitlesStatus] = useState('');
    const [aiSuccessList, setAiSuccessList] = useState<string[]>([]);
    
    // Cast members management
    const [allContentList, setAllContentList] = useState<Content[]>([]);
    const [selectedContentId, setSelectedContentId] = useState('');
    const [castList, setCastList] = useState<any[]>([]);
    const [loadingCastList, setLoadingCastList] = useState(false);
    const [castForm, setCastForm] = useState({
        name: '',
        role: '',
        character: '',
        avatar: ''
    });

    const [teapotDate, setTeapotDate] = useState('2026-07-25');

    const [formData, setFormData] = useState({
        title: '',
        description: '',
        thumbnailUrl: '',
        backdropUrl: '',
        videoUrl: '', // URL principal (fallback)
        embedCode: '',
        serverType: 'uploadcare' as 'uploadcare' | 'streamtape' | 'savefiles' | 'embed',
        audioTracks: [
            { lang: 'en', url: '' },
            { lang: 'es-419', url: '' }
        ],
        genre: '',
        rating: 'PG-13',
        releaseYear: new Date().getFullYear(),
        featured: false,
        status: 'ongoing', // Default status
        // Season specific
        seasonNumber: 1,
        // Episode specific
        episodeNumber: 1,
        duration: '24m',
        skipIntro: 0,
        titleLogoUrl: ''
    });

    useEffect(() => {
        if (type === 'episode' || type === 'season') {
            const fetchSeries = async () => {
                const q = query(collection(db, "content"), where("type", "==", "series"));
                const snap = await getDocs(q);
                setSeriesList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Content)));
            };
            fetchSeries();
        }
        if (type === 'cast') {
            const fetchAllContent = async () => {
                try {
                    const snap = await getDocs(collection(db, "content"));
                    setAllContentList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Content)));
                } catch (err) {
                    console.error("Error fetching all content:", err);
                }
            };
            fetchAllContent();
        }
    }, [type]);

    useEffect(() => {
        if (type === 'cast' && selectedContentId) {
            const fetchCastList = async () => {
                setLoadingCastList(true);
                try {
                    const castRef = collection(db, "content", selectedContentId, "cast");
                    const snap = await getDocs(castRef);
                    setCastList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                } catch (err) {
                    console.error("Error fetching cast list:", err);
                } finally {
                    setLoadingCastList(false);
                }
            };
            fetchCastList();
        } else {
            setCastList([]);
        }
    }, [type, selectedContentId]);

    useEffect(() => {
        if (type === 'teapot') {
            const fetchTeapotDate = async () => {
                setLoading(true);
                try {
                    const docRef = doc(db, "config", "teapot");
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        setTeapotDate(docSnap.data().redirectDate || '2026-07-25');
                    }
                } catch (err) {
                    console.error("Error fetching teapot date:", err);
                } finally {
                    setLoading(false);
                }
            };
            fetchTeapotDate();
        }
    }, [type]);

    const handleSaveTeapot = async () => {
        setLoading(true);
        setError(null);
        try {
            const docRef = doc(db, "config", "teapot");
            await setDoc(docRef, { redirectDate: teapotDate });
            alert("¡Fecha de redirección Teapot guardada con éxito! ☕");
        } catch (err: any) {
            console.error("Error saving teapot date:", err);
            setError(err.message || "Error al guardar la fecha.");
        } finally {
            setLoading(false);
        }
    };

    const handleAddCastMember = async () => {
        if (!selectedContentId) return;
        if (!castForm.name.trim()) {
            setError("El nombre es obligatorio.");
            return;
        }
        if (!castForm.role.trim()) {
            setError("El rol es obligatorio.");
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const castRef = collection(db, "content", selectedContentId, "cast");
            await addDoc(castRef, {
                name: castForm.name,
                role: castForm.role,
                character: castForm.character || null,
                avatar: castForm.avatar || null,
                createdAt: firestoreTimestamp()
            });

            // Reset form fields
            setCastForm({
                name: '',
                role: '',
                character: '',
                avatar: ''
            });

            // Refetch list
            const snap = await getDocs(castRef);
            setCastList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            
            alert("¡Miembro del reparto añadido con éxito! 🎙️");
        } catch (err: any) {
            console.error("Error adding cast member:", err);
            setError(err.message || "Error al guardar el miembro del reparto.");
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteCastMember = async (memberId: string) => {
        if (!selectedContentId) return;
        if (!window.confirm("¿Seguro que deseas eliminar este miembro del reparto?")) return;

        setLoadingCastList(true);
        try {
            const docRef = doc(db, "content", selectedContentId, "cast", memberId);
            await deleteDoc(docRef);

            // Refetch list
            const castRef = collection(db, "content", selectedContentId, "cast");
            const snap = await getDocs(castRef);
            setCastList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        } catch (err: any) {
            console.error("Error deleting cast member:", err);
            alert("Error al eliminar el miembro: " + err.message);
        } finally {
            setLoadingCastList(false);
        }
    };

    useEffect(() => {
        if (type === 'episode' && selectedSeriesId) {
            const fetchSeasons = async () => {
                const seasonsRef = collection(db, "content", selectedSeriesId, "temporadas");
                const q = query(seasonsRef, orderBy("seasonNumber", "asc"));
                const snap = await getDocs(q);
                setSeasonsList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Season)));
            };
            fetchSeasons();
        } else {
            setSeasonsList([]);
            setSelectedSeasonId('');
        }
    }, [type, selectedSeriesId]);

    const handleGenerateAISubtitles = async () => {
        if (!formData.title) {
            alert("Por favor ingresa al menos un título antes de generar subtítulos.");
            return;
        }

        setAiGeneratingSubtitles(true);
        setAiSuccessList([]);

        try {
            setAiSubtitlesStatus('Analizando audio...');
            await new Promise(r => setTimeout(r, 1200));
            
            setAiSubtitlesStatus('Generando transcripción original...');
            
            const response = await fetch('/api/subtitles/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoUrl: formData.videoUrl,
                    title: formData.title,
                    description: formData.description,
                    languages: ['es', 'en', 'ja']
                })
            });

            if (!response.ok) {
                throw new Error("Error en el servidor de subtitulación.");
            }

            setAiSubtitlesStatus('Traduciendo a otros idiomas...');
            await new Promise(r => setTimeout(r, 1200));

            const data = await response.json();
            if (data.success && data.tracks) {
                setSubtitles(prev => {
                    const labels = data.tracks.map((t: any) => t.label);
                    const filteredPrev = prev.filter(p => !labels.includes(p.label));
                    return [...filteredPrev, ...data.tracks];
                });
                setAiSuccessList(data.tracks.map((t: any) => t.label));
            } else {
                throw new Error(data.message || "No se pudieron generar los subtítulos.");
            }
        } catch (err: any) {
            console.error("AI Subtitles Error:", err);
            alert(`Error al generar subtítulos: ${err.message}`);
        } finally {
            setAiGeneratingSubtitles(false);
            setAiSubtitlesStatus('');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            if (type !== 'season' && !formData.title.trim()) throw new Error("El título es obligatorio.");
            if (type !== 'season' && !formData.thumbnailUrl.trim()) throw new Error("La miniatura es obligatoria.");
            
            const filteredTracks: Record<string, string> = {};
            formData.audioTracks.forEach(track => {
                if (track.lang && track.url) {
                    filteredTracks[track.lang] = track.url;
                }
            });

            const newAudioTracksArray = formData.audioTracks
                .filter(track => track.lang && track.url)
                .map(track => {
                    const matchedLang = LANGUAGES.find(l => l.code === track.lang);
                    return {
                        id: track.lang,
                        languageLabel: matchedLang ? matchedLang.name : track.lang,
                        audioUrl: track.url
                    };
                });

            if (type === 'episode') {
                if (!selectedSeriesId) throw new Error("Debes seleccionar una serie");
                if (!selectedSeasonId) throw new Error("Debes seleccionar una temporada");
                
                const episodesRef = collection(db, "content", selectedSeriesId, "episodes"); // Updated path as per user request
                await addDoc(episodesRef, {
                    title: formData.title,
                    description: formData.description,
                    thumbnailUrl: formData.thumbnailUrl,
                    videoUrl: formData.videoUrl,
                    embedCode: formData.embedCode,
                    serverType: formData.serverType,
                    audioTracks: newAudioTracksArray,
                    episodeNumber: Number(formData.episodeNumber),
                    duration: formData.duration,
                    skipIntro: Number(formData.skipIntro),
                    createdAt: firestoreTimestamp(),
                    titleLogoUrl: formData.titleLogoUrl || "",
                    subtitles: subtitles.filter(sub => sub.label.trim() && sub.src.trim())
                });
                alert("¡Episodio añadido con éxito! 🎬");
            } else if (type === 'season') {
                if (!selectedSeriesId) throw new Error("Debes seleccionar una serie");
                
                const seasonsRef = collection(db, "content", selectedSeriesId, "temporadas");
                await addDoc(seasonsRef, {
                    seasonNumber: Number(formData.seasonNumber),
                    title: formData.title || `Temporada ${formData.seasonNumber}`,
                    createdAt: firestoreTimestamp()
                });
                alert("¡Temporada creada con éxito! 📅");
            } else {
                const contentRef = collection(db, "content");
                const newContent = {
                    title: formData.title,
                    description: formData.description,
                    thumbnailUrl: formData.thumbnailUrl,
                    backdropUrl: formData.backdropUrl,
                    videoUrl: formData.videoUrl,
                    embedCode: formData.embedCode,
                    serverType: formData.serverType,
                    audioTracks: filteredTracks,
                    type,
                    genre: formData.genre.split(',').map(g => g.trim()),
                    releaseYear: Number(formData.releaseYear),
                    rating: formData.rating,
                    featured: formData.featured,
                    status: formData.status,
                    skipIntro: Number(formData.skipIntro),
                    createdAt: firestoreTimestamp(),
                    titleLogoUrl: formData.titleLogoUrl || "",
                    subtitles: subtitles.filter(sub => sub.label.trim() && sub.src.trim())
                };
                await addDoc(contentRef, newContent);
                alert(type === 'series' ? "¡Serie creada! 🎉" : "¡Película subida! 🎉");
            }
            onClose();
        } catch (err: any) {
            console.error("Error adding document: ", err);
            let message = "Ocurrió un error inesperado al guardar en la base de datos.";
            
            if (err.code === 'permission-denied') {
                message = "No tienes permisos suficientes para realizar esta acción.";
            } else if (err.code === 'unavailable') {
                message = "La base de datos no está disponible. Revisa tu conexión.";
            } else if (err.message) {
                message = err.message;
            }
            
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center p-2 md:p-4 overflow-y-auto">
            <div className="bg-[#121212] w-full max-w-2xl rounded-2xl border border-white/5 shadow-2xl p-6 md:p-10 my-auto">
                <div className="flex justify-between items-center mb-6 md:mb-10 border-b border-white/5 pb-4 md:pb-6">
                    <h2 className="text-2xl md:text-4xl font-bebas text-red-600 tracking-wider">Editor de Contenido</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-2">Cerrar</button>
                </div>

                <div className="flex gap-2 mb-6 md:mb-8 flex-wrap">
                    {['movie', 'series', 'season', 'episode', 'cast', 'teapot', 'r2'].map((t) => (
                        <button 
                            key={t}
                            type="button"
                            onClick={() => {
                                setType(t as any);
                                setError(null);
                            }}
                            className={`flex-1 min-w-[70px] py-2 md:py-3 rounded-lg md:rounded-xl font-bold transition-all text-[8px] md:text-[10px] tracking-widest uppercase ${type === t ? 'bg-red-600 text-white shadow-lg shadow-red-600/20' : 'bg-white/5 text-gray-500 hover:text-gray-300'}`}
                        >
                            {t === 'movie' ? 'Película' : t === 'series' ? 'Serie' : t === 'season' ? 'Temporada' : t === 'episode' ? 'Episodio' : t === 'cast' ? 'Reparto' : t === 'teapot' ? 'Día Teapot ☕' : 'Cloudflare R2 ☁️'}
                        </button>
                    ))}
                </div>

                {type === 'teapot' ? (
                    <div className="space-y-6 animate-fade-in text-left">
                        <div className="flex flex-col gap-2 font-sans">
                            <label className="text-[10px] text-red-500 uppercase font-black tracking-widest">Fecha de Redirección Teapot</label>
                            <p className="text-[11px] text-gray-400 leading-relaxed">
                                En la fecha configurada abajo, cualquier usuario que visite la web será redirigido automáticamente a <strong className="text-red-500">google.com/teapot</strong>. Antes y después de ese día, el sitio funcionará de forma totalmente normal.
                            </p>
                            <input 
                                type="date"
                                className="bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none transition-all text-sm mt-2"
                                value={teapotDate}
                                onChange={e => setTeapotDate(e.target.value)}
                                required
                            />
                        </div>

                        <button
                            type="button"
                            onClick={handleSaveTeapot}
                            disabled={loading}
                            className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 rounded-xl text-xs transition-all tracking-[0.2em] uppercase shadow-lg shadow-red-600/10 mt-4"
                        >
                            {loading ? "Guardando..." : "Guardar Configuración Teapot ☕"}
                        </button>

                        {error && (
                            <div className="p-4 bg-red-600/20 border border-red-600/50 rounded-xl">
                                <p className="text-xs text-red-500 font-bold flex items-center gap-2">
                                    ⚠️ {error}
                                </p>
                            </div>
                        )}
                    </div>
                ) : type === 'r2' ? (
                    <div className="space-y-6 animate-fade-in text-left">
                        <div className="p-4 bg-orange-950/30 border border-orange-500/30 rounded-xl space-y-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <h3 className="text-sm font-bold text-orange-400 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                                    Panel Cloudflare R2
                                </h3>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            const res = await fetch('/api/upload');
                                            const data = await res.json();
                                            alert(`Cloudflare R2:\n• Configurado: ${data.isConfigured ? 'SÍ ✅' : 'NO ❌'}\n• Bucket: ${data.bucket}\n• URL Pública: ${data.publicUrl}\n• Mensaje: ${data.message}`);
                                        } catch (err: any) {
                                            alert('Error al verificar R2: ' + err.message);
                                        }
                                    }}
                                    className="text-[10px] bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 px-3 py-1.5 rounded-lg border border-orange-500/30 transition-all font-bold"
                                >
                                    Verificar Conexión R2 🔄
                                </button>
                            </div>
                            <p className="text-xs text-gray-300 leading-relaxed">
                                Sube directamente tus archivos de audio <strong>.mp3</strong> (multi-audio), videos (<strong>.mp4</strong>, <strong>.mkv</strong>) o imágenes a Cloudflare R2. Las credenciales se configuran mediante las variables de entorno <code>R2_ACCOUNT_ID</code>, <code>R2_ACCESS_KEY_ID</code>, <code>R2_SECRET_ACCESS_KEY</code> y <code>R2_BUCKET_NAME</code>.
                            </p>
                        </div>

                        {/* CORS Config Help Box */}
                        <div className="p-4 bg-neutral-900 border border-amber-500/30 rounded-xl space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                                    ⚙️ Configuración CORS requerida en Cloudflare R2 (para subir desde el navegador):
                                </span>
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
                                        alert("¡CORS JSON copiado al portapapeles!\n\nPégalo en Cloudflare R2 > Tu Bucket > Settings > CORS Policy.");
                                    }}
                                    className="text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-2.5 py-1 rounded border border-amber-500/40 transition-all font-bold"
                                >
                                    📋 Copiar Regla CORS
                                </button>
                            </div>
                            <p className="text-[11px] text-gray-400">
                                Para permitir la subida directa de archivos grandes (&gt;25MB) desde el navegador a R2 sin bloqueos, ve a tu panel de Cloudflare R2 &rarr; <strong>Tu Bucket</strong> &rarr; <strong>Settings</strong> &rarr; <strong>CORS Policy</strong> y pega la regla.
                            </p>
                        </div>

                        <div className="space-y-3 p-5 bg-white/5 border border-white/10 rounded-xl">
                            <label className="text-[10px] text-orange-400 uppercase font-black tracking-widest block">
                                Subir Archivo a Cloudflare R2 (.mp3, .mp4, etc.)
                            </label>
                            <Uploader 
                                accept="audio/*,video/*,image/*" 
                                folder="uploads" 
                                buttonText="Seleccionar y Subir Archivo a R2" 
                                onUploadSuccess={(url) => {
                                    alert('¡Archivo subido exitosamente a Cloudflare R2!\n\nURL:\n' + url);
                                }}
                            />
                        </div>
                    </div>
                ) : type === 'cast' ? (
                    <div className="space-y-6 animate-fade-in text-left">
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] text-red-500 uppercase font-black tracking-widest">Seleccionar Película o Serie</label>
                            <select 
                                className="bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white outline-none focus:border-red-600 text-sm"
                                value={selectedContentId}
                                onChange={e => setSelectedContentId(e.target.value)}
                                required
                            >
                                <option value="" className="bg-[#121212]">-- Elige un contenido --</option>
                                {allContentList.map(c => (
                                    <option key={c.id} value={c.id} className="bg-[#121212]">
                                        {c.title} ({c.type === 'series' ? 'Serie' : 'Película'})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {selectedContentId && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-white/5 animate-fade-in">
                                {/* Formulario de Adición */}
                                <div className="space-y-4">
                                    <h3 className="text-sm font-black text-red-500 uppercase tracking-widest border-b border-white/5 pb-2">Añadir Miembro</h3>
                                    
                                    <div className="flex flex-col gap-1.5 font-sans">
                                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Nombre completo</label>
                                        <input 
                                            className="bg-white/5 border border-white/10 p-3 rounded-lg text-white focus:border-red-600 outline-none text-xs"
                                            value={castForm.name}
                                            onChange={e => setCastForm({...castForm, name: e.target.value})}
                                            placeholder="ej: Yuki Dobladora 🎙️"
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1.5 font-sans">
                                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Rol / Función</label>
                                        <input 
                                            className="bg-white/5 border border-white/10 p-3 rounded-lg text-white focus:border-red-600 outline-none text-xs"
                                            value={castForm.role}
                                            onChange={e => setCastForm({...castForm, role: e.target.value})}
                                            placeholder="ej: Actriz de voz principal, Director..."
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1.5 font-sans">
                                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Personaje (Opcional)</label>
                                        <input 
                                            className="bg-white/5 border border-white/10 p-3 rounded-lg text-white focus:border-red-600 outline-none text-xs"
                                            value={castForm.character}
                                            onChange={e => setCastForm({...castForm, character: e.target.value})}
                                            placeholder="ej: Yumi, Ren..."
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1.5 font-sans">
                                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Avatar URL (Opcional)</label>
                                        <div className="flex gap-2">
                                            <input 
                                                className="flex-grow bg-white/5 border border-white/10 p-3 rounded-lg text-white focus:border-red-600 outline-none text-xs"
                                                value={castForm.avatar}
                                                onChange={e => setCastForm({...castForm, avatar: e.target.value})}
                                                placeholder="https://..."
                                            />
                                            <Uploader onUploadSuccess={(url) => setCastForm({...castForm, avatar: url})} />
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleAddCastMember}
                                        disabled={loading}
                                        className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-3 rounded-lg text-xs transition-colors tracking-wider uppercase shadow-lg shadow-red-600/10"
                                    >
                                        {loading ? "Añadiendo..." : "Añadir al reparto"}
                                    </button>
                                </div>

                                {/* Lista de Miembros Actuales */}
                                <div className="space-y-4">
                                    <h3 className="text-sm font-black text-red-500 uppercase tracking-widest border-b border-white/5 pb-2">Reparto Actual</h3>
                                    
                                    {loadingCastList ? (
                                        <div className="flex justify-center items-center py-8">
                                            <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                                        </div>
                                    ) : castList.length === 0 ? (
                                        <p className="text-xs text-gray-400 italic py-4">No hay miembros personalizados en el reparto. Se usarán los predeterminados.</p>
                                    ) : (
                                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                            {castList.map(member => (
                                                <div key={member.id} className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-white/5 text-xs text-left">
                                                    {member.avatar ? (
                                                        <img src={member.avatar} alt={member.name} className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                                                    ) : (
                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-red-600/20 to-red-600/5 border border-red-600/20 flex items-center justify-center text-red-500 font-bold shrink-0">
                                                            {member.name.charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className="min-w-0 flex-grow">
                                                        <h5 className="font-bold text-white truncate">{member.name}</h5>
                                                        <p className="text-[10px] text-gray-500 truncate">
                                                            {member.role} {member.character && `(como ${member.character})`}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteCastMember(member.id)}
                                                        className="text-red-500 hover:text-red-400 p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/10 rounded transition-colors"
                                                        title="Eliminar miembro"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                                                            <line x1="18" y1="6" x2="6" y2="18" />
                                                            <line x1="6" y1="6" x2="18" y2="18" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        
                        {error && (
                            <div className="p-4 bg-red-600/20 border border-red-600/50 rounded-xl">
                                <p className="text-xs text-red-500 font-bold flex items-center gap-2">
                                    ⚠️ {error}
                                </p>
                            </div>
                        )}
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-5">

                {(type === 'episode' || type === 'season') && (
                    <div className="flex flex-col gap-2 animate-fade-in mb-4 md:mb-6">
                        <label className="text-[10px] text-red-500 uppercase font-black tracking-widest">Seleccionar Serie</label>
                        <select 
                            className="bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white outline-none focus:border-red-600 text-sm"
                            value={selectedSeriesId}
                            onChange={e => setSelectedSeriesId(e.target.value)}
                            required
                        >
                            <option value="" className="bg-[#121212]">-- Elige una serie --</option>
                            {seriesList.map(s => (
                                <option key={s.id} value={s.id} className="bg-[#121212]">{s.title}</option>
                            ))}
                        </select>
                    </div>
                )}

                {type === 'episode' && selectedSeriesId && (
                    <div className="flex flex-col gap-2 animate-fade-in mb-4 md:mb-6">
                        <label className="text-[10px] text-red-500 uppercase font-black tracking-widest">Seleccionar Temporada</label>
                        <select 
                            className="bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white outline-none focus:border-red-600 text-sm"
                            value={selectedSeasonId}
                            onChange={e => setSelectedSeasonId(e.target.value)}
                            required
                        >
                            <option value="" className="bg-[#121212]">-- Elige una temporada --</option>
                            {seasonsList.map(s => (
                                <option key={s.id} value={s.id} className="bg-[#121212]">Temporada {s.seasonNumber} {s.title ? `- ${s.title}` : ''}</option>
                            ))}
                        </select>
                    </div>
                )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                                {type === 'episode' ? 'Título del Capítulo' : type === 'season' ? 'Título de Temporada (Opcional)' : 'Título'}
                            </label>
                            <input 
                                className="bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none transition-all text-sm"
                                value={formData.title}
                                onChange={e => setFormData({...formData, title: e.target.value})}
                                required={type !== 'season'}
                            />
                        </div>
                        {type === 'episode' ? (
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Número de Episodio</label>
                                <input 
                                    type="number"
                                    className="bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none transition-all text-sm"
                                    value={isNaN(formData.episodeNumber) ? '' : formData.episodeNumber}
                                    onChange={e => {
                                        const val = parseInt(e.target.value);
                                        setFormData({...formData, episodeNumber: isNaN(val) ? 0 : val});
                                    }}
                                    required
                                />
                            </div>
                        ) : type === 'season' ? (
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Número de Temporada</label>
                                <input 
                                    type="number"
                                    className="bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none transition-all text-sm"
                                    value={isNaN(formData.seasonNumber) ? '' : formData.seasonNumber}
                                    onChange={e => {
                                        const val = parseInt(e.target.value);
                                        setFormData({...formData, seasonNumber: isNaN(val) ? 0 : val});
                                    }}
                                    required
                                />
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Año</label>
                                <input 
                                    type="number"
                                    className="bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none transition-all text-sm"
                                    value={isNaN(formData.releaseYear) ? '' : formData.releaseYear}
                                    onChange={e => {
                                        const val = parseInt(e.target.value);
                                        setFormData({...formData, releaseYear: isNaN(val) ? 0 : val});
                                    }}
                                    required
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Descripción</label>
                        <textarea 
                            className="w-full bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none h-20 md:h-24 resize-none transition-all text-sm"
                            value={formData.description}
                            onChange={e => setFormData({...formData, description: e.target.value})}
                            required
                        />
                    </div>

                    {type !== 'episode' && type !== 'season' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Géneros (Separados por coma)</label>
                                <input 
                                    className="w-full bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none transition-all text-sm"
                                    value={formData.genre}
                                    onChange={e => setFormData({...formData, genre: e.target.value})}
                                    required
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Estado</label>
                                <select
                                    className="w-full bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white outline-none focus:border-red-600 text-sm"
                                    value={formData.status}
                                    onChange={e => setFormData({...formData, status: e.target.value})}
                                >
                                    <option value="ongoing" className="bg-[#121212]">En emisión</option>
                                    <option value="completed" className="bg-[#121212]">Terminado</option>
                                    <option value="cancelled" className="bg-[#121212]">Cancelado</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {type !== 'season' && (
                        <div className="space-y-4 pt-4 border-t border-white/5">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="flex flex-col gap-2">
                                    <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">URL Miniatura</label>
                                    <div className="flex gap-2">
                                        <input 
                                            className="flex-grow bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none transition-all text-xs"
                                            value={formData.thumbnailUrl}
                                            onChange={e => setFormData({...formData, thumbnailUrl: e.target.value})}
                                            required
                                        />
                                        <Uploader onUploadSuccess={(url) => setFormData({...formData, thumbnailUrl: url})} />
                                    </div>
                                </div>
                                {type !== 'episode' ? (
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">URL Fondo (Hero)</label>
                                        <div className="flex gap-2">
                                            <input 
                                                className="flex-grow bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none transition-all text-xs"
                                                value={formData.backdropUrl}
                                                onChange={e => setFormData({...formData, backdropUrl: e.target.value})}
                                                required
                                            />
                                            <Uploader onUploadSuccess={(url) => setFormData({...formData, backdropUrl: url})} />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Duración (ej: 24m)</label>
                                        <input 
                                            className="w-full bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none transition-all text-sm"
                                            value={formData.duration}
                                            onChange={e => setFormData({...formData, duration: e.target.value})}
                                            required
                                        />
                                    </div>
                                )}
                            </div>

                            {type !== 'series' && (
                                <div className="space-y-4 animate-fade-in pt-4 border-t border-white/5">
                                    <div className="space-y-6 pt-6 border-t border-white/5">
                                        <div className="flex flex-col gap-4">
                                            <div className="flex flex-col gap-3">
                                                <label className="text-[10px] text-red-600 uppercase font-black tracking-widest flex items-center gap-2">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 shadow-[0_0_8px_rgba(255,0,0,0.8)]" />
                                                    Servidor de Video
                                                </label>
                                                <div className="flex gap-4 p-1.5 bg-[#1a1a1a] rounded-xl border border-white/10 w-fit shadow-inner">
                                                    <button 
                                                        type="button"
                                                        onClick={() => setFormData({...formData, serverType: 'uploadcare'})}
                                                        className={`px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${formData.serverType === 'uploadcare' ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(255,0,0,0.4)]' : 'text-gray-500 hover:text-gray-300'}`}
                                                    >
                                                        Uploadcare (CDN)
                                                    </button>
                                                    <button 
                                                        type="button"
                                                        onClick={() => setFormData({...formData, serverType: 'streamtape'})}
                                                        className={`px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${formData.serverType === 'streamtape' ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(255,0,0,0.4)]' : 'text-gray-500 hover:text-gray-300'}`}
                                                    >
                                                        Streamtape
                                                    </button>
                                                    <button 
                                                        type="button"
                                                        onClick={() => setFormData({...formData, serverType: 'savefiles'})}
                                                        className={`px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${formData.serverType === 'savefiles' ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(255,0,0,0.4)]' : 'text-gray-500 hover:text-gray-300'}`}
                                                    >
                                                        Savefiles
                                                    </button>
                                                    <button 
                                                        type="button"
                                                        onClick={() => setFormData({...formData, serverType: 'embed'})}
                                                        className={`px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${formData.serverType === 'embed' ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(255,0,0,0.4)]' : 'text-gray-500 hover:text-gray-300'}`}
                                                    >
                                                        Código Embed
                                                    </button>
                                                </div>
                                                <button 
                                                    type="button"
                                                    onClick={() => {
                                                        localStorage.clear();
                                                        sessionStorage.clear();
                                                        alert('Caché local limpiada. Recarga la página.');
                                                    }}
                                                    className="bg-transparent border border-red-600/50 hover:bg-red-600/10 text-red-500 text-[8px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all"
                                                >
                                                    Forzar Refresco de Cache
                                                </button>
                                            </div>

                                            <div className="flex flex-col gap-3">
                                                <label className="text-[10px] text-red-600 uppercase font-black tracking-widest flex items-center gap-2">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 shadow-[0_0_8px_rgba(255,0,0,0.8)]" />
                                                    {formData.serverType === 'embed' ? 'Código <iframe> del Proveedor' : 'URL de Video (Directo o Link de Versión Embed)'}
                                                </label>
                                                <div className="flex flex-col gap-3">
                                                    {formData.serverType === 'embed' ? (
                                                        <textarea 
                                                            className="w-full bg-[#1a1a1a] border border-white/10 p-4 rounded-xl text-white focus:border-red-600 focus:ring-1 focus:ring-red-600/50 outline-none transition-all text-xs placeholder:text-gray-600 shadow-inner h-32 resize-none"
                                                            value={formData.embedCode}
                                                            onChange={e => setFormData({...formData, embedCode: e.target.value})}
                                                            placeholder='Pegue aquí el código completo <iframe src="..." ...></iframe>'
                                                            required={formData.serverType === 'embed'}
                                                        />
                                                    ) : (
                                                        <div className="flex gap-2 items-center">
                                                            <input 
                                                                className="flex-grow bg-[#1a1a1a] border border-white/10 p-4 rounded-xl text-white focus:border-red-600 focus:ring-1 focus:ring-red-600/50 outline-none transition-all text-xs placeholder:text-gray-600 shadow-inner"
                                                                value={formData.videoUrl}
                                                                onChange={e => setFormData({...formData, videoUrl: e.target.value})}
                                                                placeholder={formData.serverType === 'uploadcare' ? "Ej: https://ucarecdn.com/..." : "Ej: https://... (R2 / Servidor)"}
                                                                required={type === 'episode'}
                                                            />
                                                            <Uploader 
                                                                accept="video/*,audio/*" 
                                                                folder="videos" 
                                                                buttonText="Subir Video"
                                                                onUploadSuccess={(url) => setFormData({...formData, videoUrl: url})} 
                                                            />
                                                        </div>
                                                    )}
                                                    
                                                    <button 
                                                        type="button"
                                                        onClick={() => setShowPreview(!showPreview)}
                                                        className={`w-full py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.4em] transition-all duration-300 border ${showPreview ? 'bg-red-600 border-red-600 text-white shadow-[0_0_20px_rgba(255,0,0,0.5)]' : 'border-red-600/30 text-red-500 hover:bg-red-600/10'}`}
                                                    >
                                                        {showPreview ? 'OCULTAR PREVISUALIZACIÓN' : 'PROBAR REPRODUCTOR'}
                                                    </button>
                                                </div>
                                            </div>

                                            {showPreview && (formData.videoUrl || formData.embedCode) && (
                                                <div className="mt-4 animate-scale-in p-2 bg-black rounded-2xl border border-red-600/20 shadow-[0_0_30px_rgba(255,0,0,0.1)]">
                                                    <SeikoMediaEngine 
                                                        videoUrl={formData.videoUrl} 
                                                        serverType={formData.serverType}
                                                        embedCode={formData.embedCode}
                                                        title="Previsualización"
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-4 pt-6 border-t border-white/5">
                                            <div className="flex justify-between items-center mb-4">
                                                <label className="text-[10px] text-red-600 uppercase font-black tracking-widest flex items-center gap-2">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 shadow-[0_0_8px_rgba(255,0,0,0.8)]" />
                                                    Pistas de Audio (Multi-Audio)
                                                </label>
                                                <button 
                                                    type="button"
                                                    onClick={() => setFormData({...formData, audioTracks: [...formData.audioTracks, { lang: 'en', url: '' }]})}
                                                    className="bg-[#1a1a1a] border border-white/10 hover:border-red-600 text-[10px] font-bold text-gray-400 hover:text-red-600 px-4 py-2 rounded-lg transition-all uppercase tracking-widest flex items-center gap-2"
                                                >
                                                    <span className="text-sm">+</span> Añadir Idioma
                                                </button>
                                            </div>
                                            
                                            <div className="space-y-3">
                                                {formData.audioTracks.map((track, index) => (
                                                    <div key={index} className="flex gap-3 animate-fade-in group">
                                                        <select 
                                                            className="bg-[#1a1a1a] border border-white/10 p-3 rounded-xl text-white text-xs outline-none focus:border-red-600 transition-all w-48 shadow-inner"
                                                            value={track.lang}
                                                            onChange={e => {
                                                                const newTracks = [...formData.audioTracks];
                                                                newTracks[index].lang = e.target.value;
                                                                setFormData({...formData, audioTracks: newTracks});
                                                            }}
                                                        >
                                                            {LANGUAGES.map(l => (
                                                                <option key={l.code} value={l.code} className="bg-[#121212]">{l.name}</option>
                                                            ))}
                                                        </select>
                                                        <input 
                                                            className="flex-grow bg-[#1a1a1a] border border-white/10 p-3 rounded-xl text-white focus:border-red-600 outline-none transition-all text-xs placeholder:text-gray-600 shadow-inner"
                                                            value={track.url}
                                                            onChange={e => {
                                                                const newTracks = [...formData.audioTracks];
                                                                newTracks[index].url = e.target.value;
                                                                setFormData({...formData, audioTracks: newTracks});
                                                            }}
                                                            placeholder="URL del audio (.mp3) o video"
                                                        />
                                                        <Uploader 
                                                            accept="audio/*,video/*" 
                                                            folder="audio" 
                                                            buttonText="Subir .mp3"
                                                            onUploadSuccess={(url) => {
                                                                const newTracks = [...formData.audioTracks];
                                                                newTracks[index].url = url;
                                                                setFormData({...formData, audioTracks: newTracks});
                                                            }} 
                                                        />
                                                        <button 
                                                            type="button"
                                                            onClick={() => {
                                                                const newTracks = formData.audioTracks.filter((_, i) => i !== index);
                                                                setFormData({...formData, audioTracks: newTracks});
                                                            }}
                                                            className="p-3 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/20"
                                                        >
                                                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Subtítulos (Multi-Idioma) */}
                                        <div className="space-y-4 pt-6 border-t border-white/5">
                                            {/* AI Subtitles Generator Controls */}
                                            <div className="bg-black/40 border border-red-600/20 rounded-2xl p-6 mb-6 space-y-4 shadow-[0_0_20px_rgba(220,38,38,0.05)]">
                                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                                    <div>
                                                        <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                                                            <span className="flex h-1.5 w-1.5 relative">
                                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                                                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-600"></span>
                                                            </span>
                                                            Subtitulado Inteligente
                                                        </h4>
                                                        <p className="text-[9px] text-gray-500 uppercase tracking-widest mt-1">Genera y traduce subtítulos instantáneamente usando Gemini AI</p>
                                                    </div>
                                                    
                                                    <button
                                                        type="button"
                                                        disabled={aiGeneratingSubtitles}
                                                        onClick={handleGenerateAISubtitles}
                                                        className="relative px-5 py-2.5 rounded-xl bg-black border border-red-600 hover:bg-red-950/20 text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-400 transition-all cursor-pointer shadow-[0_0_15px_rgba(220,38,38,0.2)] hover:shadow-[0_0_25px_rgba(220,38,38,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {aiGeneratingSubtitles ? (
                                                            <span className="flex items-center gap-2">
                                                                <svg className="animate-spin h-3 w-3 text-red-500" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                                                Procesando...
                                                             </span>
                                                         ) : "✨ Generar Subtítulos por IA"}
                                                    </button>
                                                </div>

                                                {/* Dynamic Status / Progress Bar */}
                                                {aiGeneratingSubtitles && (
                                                    <div className="space-y-3 animate-pulse">
                                                        <div className="flex justify-between items-center text-[9px] uppercase font-bold text-red-500 tracking-widest">
                                                            <span>Estado: {aiSubtitlesStatus}</span>
                                                            <span className="animate-bounce">●</span>
                                                        </div>
                                                        <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden border border-red-600/20">
                                                            <div 
                                                                className="bg-red-600 h-full rounded-full animate-pulse shadow-[0_0_10px_rgba(220,38,38,0.8)]"
                                                                style={{
                                                                    width: aiSubtitlesStatus === 'Analizando audio...' ? '33%' : 
                                                                           aiSubtitlesStatus === 'Generando transcripción original...' ? '66%' : '100%',
                                                                    transition: 'width 0.8s ease-in-out'
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Confirmation List of Created Languages */}
                                                {aiSuccessList.length > 0 && (
                                                    <div className="bg-red-950/10 border border-red-600/20 rounded-xl p-4 space-y-2 animate-fade-in">
                                                        <div className="text-[9px] text-green-500 font-black uppercase tracking-wider flex items-center gap-2">
                                                            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                            ¡Subtítulos Generados Exitosamente!
                                                        </div>
                                                        <ul className="text-[10px] text-gray-400 space-y-1 pl-4 list-disc">
                                                            {aiSuccessList.map((lang, idx) => (
                                                                <li key={idx} className="font-semibold">{lang}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex justify-between items-center mb-4">
                                                <label className="text-[10px] text-red-600 uppercase font-black tracking-widest flex items-center gap-2">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 shadow-[0_0_8px_rgba(255,0,0,0.8)]" />
                                                    Pistas de Subtítulos (.vtt)
                                                </label>
                                                <button 
                                                    type="button"
                                                    onClick={() => setSubtitles([...subtitles, { label: 'Español Latino', src: '' }])}
                                                    className="bg-[#1a1a1a] border border-white/10 hover:border-red-600 text-[10px] font-bold text-gray-400 hover:text-red-600 px-4 py-2 rounded-lg transition-all uppercase tracking-widest flex items-center gap-2"
                                                >
                                                    <span className="text-sm">+</span> Añadir Subtítulo
                                                </button>
                                            </div>
                                            
                                            <div className="space-y-3">
                                                {subtitles.map((sub, index) => (
                                                    <div key={index} className="flex gap-3 animate-fade-in group">
                                                        <input 
                                                            className="bg-[#1a1a1a] border border-white/10 p-3 rounded-xl text-white text-xs outline-none focus:border-red-600 transition-all w-48 shadow-inner font-bold"
                                                            value={sub.label}
                                                            onChange={e => {
                                                                const newSubs = [...subtitles];
                                                                newSubs[index].label = e.target.value;
                                                                setSubtitles(newSubs);
                                                            }}
                                                            placeholder="Ej: Español Latino"
                                                            required
                                                        />
                                                        <div className="flex-grow flex gap-2">
                                                            <input 
                                                                className="flex-grow bg-[#1a1a1a] border border-white/10 p-3 rounded-xl text-white focus:border-red-600 outline-none transition-all text-xs placeholder:text-gray-600 shadow-inner"
                                                                value={sub.src}
                                                                onChange={e => {
                                                                    const newSubs = [...subtitles];
                                                                    newSubs[index].src = e.target.value;
                                                                    setSubtitles(newSubs);
                                                                }}
                                                                placeholder="URL del archivo .vtt"
                                                                required
                                                            />
                                                            <Uploader onUploadSuccess={(url) => {
                                                                const newSubs = [...subtitles];
                                                                newSubs[index].src = url;
                                                                setSubtitles(newSubs);
                                                            }} />
                                                        </div>
                                                        <button 
                                                            type="button"
                                                            onClick={() => {
                                                                const newSubs = subtitles.filter((_, i) => i !== index);
                                                                setSubtitles(newSubs);
                                                            }}
                                                            className="p-3 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/20"
                                                        >
                                                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {type === 'series' && (
                                <div className="p-4 bg-red-600/10 rounded-xl border border-red-600/20 animate-fade-in">
                                    <p className="text-xs text-red-400 font-bold leading-relaxed">
                                        ℹ️ Las series no tienen video URL principal. Una vez creada, usa la pestaña "TEMPORADA" para añadir temporadas y luego "EPISODIO" para añadir sus capítulos.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex flex-col gap-2 pt-4 border-t border-white/5">
                        <label className="text-[10px] text-yellow-500 uppercase font-black tracking-widest flex justify-between items-center">
                            Final de Intro (Segundos)
                            <span className="text-[8px] text-gray-500 normal-case font-normal">Marca el segundo exacto donde termina la intro</span>
                        </label>
                        <div className="flex gap-2">
                            <input 
                                type="number"
                                className="flex-grow bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-yellow-500 outline-none transition-all text-sm"
                                value={formData.skipIntro}
                                onChange={e => setFormData({...formData, skipIntro: parseInt(e.target.value) || 0})}
                            />
                            <button 
                                type="button"
                                onClick={() => {
                                    const currentTime = (window as any).seikotv_current_time || 0;
                                    setFormData({...formData, skipIntro: Math.floor(currentTime)});
                                }}
                                className="bg-yellow-600/20 hover:bg-yellow-600 text-yellow-500 hover:text-white px-4 rounded-lg md:rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-yellow-600/30 whitespace-nowrap"
                            >
                                Marcar aquí
                            </button>
                        </div>
                    </div>

                    {canUploadLogo && (type === 'movie' || type === 'series' || type === 'episode') && (
                        <div className="flex flex-col gap-2 pt-4 border-t border-white/5 animate-fade-in text-left">
                            <label className="text-[10px] text-red-500 uppercase font-black tracking-widest flex items-center gap-2">
                                <span>Logotipo del Título (PNG/WEBP Transparente)</span>
                                <span className="bg-red-500/15 text-red-500 px-2 py-0.5 rounded text-[8px] border border-red-500/20 font-sans">Exclusivo Admin</span>
                            </label>
                            <div className="flex gap-2">
                                <input 
                                    className="flex-grow bg-white/5 border border-white/10 p-3 md:p-4 rounded-lg md:rounded-xl text-white focus:border-red-600 outline-none transition-all text-xs"
                                    placeholder="ej: https://res.cloudinary.com/.../logo.png"
                                    value={formData.titleLogoUrl}
                                    onChange={e => setFormData({...formData, titleLogoUrl: e.target.value})}
                                />
                                <Uploader onUploadSuccess={(url) => setFormData({...formData, titleLogoUrl: url})} />
                            </div>
                            <p className="text-[10px] text-gray-500 italic mt-0.5 font-sans">Este logotipo se mostrará en el protector de pantalla &quot;Estás viendo...&quot; tras 5 segundos de pausa.</p>
                        </div>
                    )}

                    {type !== 'episode' && type !== 'season' && (
                        <div className="flex items-center gap-3 pt-4">
                            <input 
                                type="checkbox" 
                                id="featured" 
                                className="w-6 h-6 rounded accent-red-600 cursor-pointer"
                                checked={formData.featured}
                                onChange={e => setFormData({...formData, featured: e.target.checked})}
                            />
                            <label htmlFor="featured" className="text-gray-300 font-bold text-sm cursor-pointer">Destacar en la pantalla de inicio</label>
                        </div>
                    )}

                    {error && (
                        <div className="p-4 bg-red-600/20 border border-red-600/50 rounded-xl animate-shake">
                            <p className="text-xs text-red-500 font-bold flex items-center gap-2">
                                ⚠️ {error}
                            </p>
                        </div>
                    )}

                    <button 
                        type="submit" 
                        disabled={loading}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-5 rounded-xl mt-6 transition-all transform active:scale-95 disabled:opacity-50 tracking-[0.4em] uppercase shadow-2xl shadow-red-600/20"
                    >
                        {loading ? "PROCESANDO..." : type === 'movie' ? "SUBIR PELÍCULA" : type === 'series' ? "CREAR SERIE" : type === 'season' ? "CREAR TEMPORADA" : "AÑADIR EPISODIO"}
                    </button>
                </form>
                )}
            </div>
        </div>
    );
};

export default AdminPanel;
