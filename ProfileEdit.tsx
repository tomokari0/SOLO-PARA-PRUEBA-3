import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { db } from './firebaseConfig';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import AvatarUpload from './src/components/AvatarUpload';
import { UserProfile, UserSocialLinks, UserPreferences } from './types';

interface ProfileEditProps {
    onClose: () => void;
    activeProfile: UserProfile | any;
    onProfileUpdate?: (updatedProfile: UserProfile | any) => void;
}

const NEON_PRESETS = [
    { label: 'Rojo Neón', value: '#ef4444' },
    { label: 'Azul Neón', value: '#3b82f6' },
    { label: 'Morado Neón', value: '#a855f7' },
    { label: 'Verde Neón', value: '#10b981' },
    { label: 'Cyan Neón', value: '#06b6d4' },
    { label: 'Dorado Neón', value: '#f59e0b' },
    { label: 'Rosa Neón', value: '#ec4899' },
    { label: 'Naranja Neón', value: '#f97316' },
];

const DEFAULT_AVATARS = [
    'https://upload.wikimedia.org/wikipedia/commons/0/0b/Netflix-avatar.png',
    'https://i.pinimg.com/originals/b6/77/cd/b677cd1cde292f261166533d6fe75872.png',
    'https://i.pinimg.com/originals/fb/8e/8a/fb8e8a96fca2f049334f312086a6e2f6.png',
    'https://i.pinimg.com/originals/61/54/76/61547625e01d375f9adfc1ffef350747.png'
];

const DEFAULT_BANNERS = [
    'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&q=80&w=1000',
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=1000',
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=1000',
    'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&q=80&w=1000'
];

const ProfileEdit: React.FC<ProfileEditProps> = ({ onClose, activeProfile, onProfileUpdate }) => {
    const { user, profile: mainProfile } = useAuth();
    const [activeTab, setActiveTab] = useState<'basic' | 'aesthetic' | 'social' | 'preferences' | 'system'>('basic');

    // Section 1: Basic Info
    const [username, setUsername] = useState(activeProfile?.username || mainProfile?.username || user?.email?.split('@')[0] || '');
    const [displayName, setDisplayName] = useState(activeProfile?.displayName || activeProfile?.name || mainProfile?.displayName || user?.displayName || '');
    const [photoURL, setPhotoURL] = useState(activeProfile?.photoURL || activeProfile?.avatar || mainProfile?.photoURL || mainProfile?.avatar || DEFAULT_AVATARS[0]);
    const [bannerURL, setBannerURL] = useState(activeProfile?.bannerURL || mainProfile?.bannerURL || DEFAULT_BANNERS[0]);
    const [bio, setBio] = useState(activeProfile?.bio || mainProfile?.bio || '');

    // Section 2: Aesthetics
    const [accentColor, setAccentColor] = useState(activeProfile?.accentColor || mainProfile?.accentColor || '#ef4444');

    // Section 3: Social Links
    const [socialLinks, setSocialLinks] = useState<UserSocialLinks>({
        youtube: activeProfile?.socialLinks?.youtube || mainProfile?.socialLinks?.youtube || '',
        discord: activeProfile?.socialLinks?.discord || mainProfile?.socialLinks?.discord || '',
        twitter: activeProfile?.socialLinks?.twitter || mainProfile?.socialLinks?.twitter || '',
        instagram: activeProfile?.socialLinks?.instagram || mainProfile?.socialLinks?.instagram || '',
        tiktok: activeProfile?.socialLinks?.tiktok || mainProfile?.socialLinks?.tiktok || '',
    });

    // Section 4: System Preferences
    const [preferences, setPreferences] = useState<UserPreferences>({
        audioLang: activeProfile?.preferences?.audioLang || mainProfile?.preferences?.audioLang || 'es-LAT',
        subtitlesLang: activeProfile?.preferences?.subtitlesLang || mainProfile?.preferences?.subtitlesLang || 'es',
    });

    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');

    // Fetch full document from Firestore on mount if available
    useEffect(() => {
        if (!user) return;
        const loadFullProfile = async () => {
            try {
                const userRef = doc(db, 'usuarios', user.uid);
                const snap = await getDoc(userRef);
                if (snap.exists()) {
                    const data = snap.data();
                    if (data.username) setUsername(data.username);
                    if (data.displayName) setDisplayName(data.displayName);
                    if (data.photoURL || data.avatar) setPhotoURL(data.photoURL || data.avatar);
                    if (data.bannerURL) setBannerURL(data.bannerURL);
                    if (data.bio) setBio(data.bio);
                    if (data.accentColor) setAccentColor(data.accentColor);
                    if (data.socialLinks) setSocialLinks((prev) => ({ ...prev, ...data.socialLinks }));
                    if (data.preferences) setPreferences((prev) => ({ ...prev, ...data.preferences }));
                }
            } catch (err) {
                console.warn('Could not fetch user profile details:', err);
            }
        };
        loadFullProfile();
    }, [user]);

    const handleUploadSuccess = (url: string) => {
        setPhotoURL(url);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatusMsg('');

        try {
            const finalUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') || 'usuario';
            const finalDisplay = displayName.trim() || 'Usuario';
            const finalAvatar = photoURL || DEFAULT_AVATARS[0];

            const updatedFields: Partial<UserProfile> = {
                username: finalUsername,
                displayName: finalDisplay,
                name: finalDisplay,
                avatar: finalAvatar,
                photoURL: finalAvatar,
                bannerURL: bannerURL.trim(),
                bio: bio.trim().slice(0, 250),
                accentColor: accentColor,
                socialLinks: {
                    youtube: socialLinks.youtube?.trim() || '',
                    discord: socialLinks.discord?.trim() || '',
                    twitter: socialLinks.twitter?.trim() || '',
                    instagram: socialLinks.instagram?.trim() || '',
                    tiktok: socialLinks.tiktok?.trim() || '',
                },
                preferences: {
                    audioLang: preferences.audioLang || 'es-LAT',
                    subtitlesLang: preferences.subtitlesLang || 'es',
                },
            };

            // Save to Firestore main user document
            if (user?.uid) {
                try {
                    const mainUserRef = doc(db, 'usuarios', user.uid);
                    await setDoc(mainUserRef, updatedFields, { merge: true });

                    // If editing sub-profile
                    if (activeProfile?.id && activeProfile.id !== user.uid) {
                        const subProfileRef = doc(db, 'usuarios', user.uid, 'perfiles', activeProfile.id);
                        await setDoc(subProfileRef, {
                            name: finalDisplay,
                            avatar: finalAvatar,
                            updatedAt: new Date().toISOString()
                        }, { merge: true });
                    }
                } catch (firestoreErr) {
                    console.warn("Aviso al guardar en Firestore (se mantendrá guardado localmente):", firestoreErr);
                }
            }

            const merged = { ...activeProfile, ...updatedFields };
            sessionStorage.setItem('seikotv_active_profile', JSON.stringify(merged));
            if (onProfileUpdate) {
                onProfileUpdate(merged);
            }

            setStatusMsg('¡Perfil actualizado con éxito!');
            setTimeout(() => {
                onClose();
            }, 600);
        } catch (err) {
            console.warn('Excepción al procesar datos de perfil:', err);
            setStatusMsg('Guardado localmente');
            setTimeout(() => {
                onClose();
            }, 600);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-3 sm:p-6 z-[300] backdrop-blur-md overflow-y-auto">
            <div className="bg-[#121212] w-full max-w-3xl rounded-3xl border border-white/10 shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]">
                
                {/* Header */}
                <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-black/40">
                    <div>
                        <h2 className="text-2xl font-bebas text-white tracking-widest">
                            EDICIÓN DE PERFIL
                        </h2>
                        <p className="text-xs text-gray-400">Personaliza tus datos, estética neón y preferencias de SeikoYT</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-all">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                {/* Tabs Bar */}
                <div className="flex border-b border-white/10 overflow-x-auto no-scrollbar bg-white/[0.02] p-2 gap-2">
                    {[
                        { 
                            id: 'basic', 
                            label: 'Básico', 
                            icon: 'https://pub-642e744b66244b29b7b5a6d9bc8925f4.r2.dev/Iconos/Gemini_Generated_Image_a1eq6ia1eq6ia1eq-Photoroom.png', 
                            desc: 'Identidad y Bio' 
                        },
                        { 
                            id: 'aesthetic', 
                            label: 'Estética', 
                            icon: 'https://pub-642e744b66244b29b7b5a6d9bc8925f4.r2.dev/Iconos/Gemini_Generated_Image_tyqi2ztyqi2ztyqi-Photoroom.png', 
                            desc: 'Color Neón' 
                        },
                        { 
                            id: 'social', 
                            label: 'Redes', 
                            icon: 'https://pub-642e744b66244b29b7b5a6d9bc8925f4.r2.dev/Iconos/Redes.png', 
                            desc: 'Enlaces' 
                        },
                        { 
                            id: 'preferences', 
                            label: 'Preferencias', 
                            icon: 'https://pub-642e744b66244b29b7b5a6d9bc8925f4.r2.dev/Iconos/Preferencias.png', 
                            desc: 'Audio / Subs' 
                        },
                        { 
                            id: 'system', 
                            label: 'Sistema', 
                            icon: 'https://pub-642e744b66244b29b7b5a6d9bc8925f4.r2.dev/Iconos/Sistema.png', 
                            desc: 'Datos Firebase' 
                        },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex-1 min-w-[125px] py-2.5 px-3 rounded-xl transition-all text-left flex items-center gap-2.5 ${
                                activeTab === tab.id
                                    ? 'bg-red-600/20 border border-red-500/40 text-white shadow-lg'
                                    : 'hover:bg-white/5 text-gray-400'
                            }`}
                        >
                            <img 
                                src={tab.icon} 
                                alt={tab.label} 
                                className="w-6 h-6 object-contain shrink-0 filter drop-shadow" 
                                referrerPolicy="no-referrer" 
                            />
                            <div className="flex flex-col min-w-0">
                                <span className="text-xs font-black uppercase tracking-wider truncate">{tab.label}</span>
                                <span className="text-[10px] text-gray-500 font-normal truncate">{tab.desc}</span>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
                    
                    {/* 1. BASIC DATA */}
                    {activeTab === 'basic' && (
                        <div className="space-y-6 animate-fade-in">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[11px] text-gray-400 uppercase font-black tracking-widest mb-1.5 block">
                                        Nombre de Usuario (username)
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">@</span>
                                        <input
                                            type="text"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            placeholder="seiko_art"
                                            className="w-full bg-white/5 border border-white/10 pl-9 pr-4 py-3 rounded-xl text-white outline-none focus:border-red-600 transition-all font-bold text-sm"
                                            required
                                        />
                                    </div>
                                    <p className="text-[10px] text-gray-500 mt-1">Identificador único público</p>
                                </div>

                                <div>
                                    <label className="text-[11px] text-gray-400 uppercase font-black tracking-widest mb-1.5 block">
                                        Nombre de Mostrar (displayName)
                                    </label>
                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        placeholder="Carlos o Seiko"
                                        className="w-full bg-white/5 border border-white/10 px-4 py-3 rounded-xl text-white outline-none focus:border-red-600 transition-all font-bold text-sm"
                                        required
                                    />
                                    <p className="text-[10px] text-gray-500 mt-1">Alias visible en comentarios y comunidad</p>
                                </div>
                            </div>

                            {/* Banner & Avatar Row */}
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[11px] text-gray-400 uppercase font-black tracking-widest mb-1.5 block">
                                        Banner de Perfil (bannerURL)
                                    </label>
                                    <input
                                        type="text"
                                        value={bannerURL}
                                        onChange={(e) => setBannerURL(e.target.value)}
                                        placeholder="https://pub-xxxx.r2.dev/banners/banner.png"
                                        className="w-full bg-white/5 border border-white/10 px-4 py-3 rounded-xl text-white outline-none focus:border-red-600 transition-all text-xs font-mono mb-2"
                                    />
                                    
                                    {/* Default Banner selector */}
                                    <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                                        {DEFAULT_BANNERS.map((b, i) => (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => setBannerURL(b)}
                                                className={`relative h-12 w-28 rounded-lg overflow-hidden shrink-0 border-2 transition-all ${
                                                    bannerURL === b ? 'border-red-500 scale-105' : 'border-transparent opacity-60 hover:opacity-100'
                                                }`}
                                            >
                                                <img src={b} className="w-full h-full object-cover" />
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Avatar Uploader & Default Selector */}
                                <div>
                                    <label className="text-[11px] text-gray-400 uppercase font-black tracking-widest mb-1.5 block">
                                        Foto de Perfil (photoURL)
                                    </label>
                                    <div className="flex flex-col sm:flex-row items-center gap-6 p-4 bg-white/5 border border-white/10 rounded-2xl">
                                        {user && (
                                            <AvatarUpload
                                                uid={user.uid}
                                                profileId={activeProfile?.id || user.uid}
                                                currentAvatar={photoURL}
                                                onUploadSuccess={handleUploadSuccess}
                                            />
                                        )}
                                        <div className="flex-1 space-y-2">
                                            <p className="text-xs text-gray-300 font-medium">Subir foto personalizada a Cloudflare R2 / ImageKit o elegir de la plataforma:</p>
                                            <div className="flex items-center gap-2">
                                                {DEFAULT_AVATARS.map((av, idx) => (
                                                    <button
                                                        key={idx}
                                                        type="button"
                                                        onClick={() => setPhotoURL(av)}
                                                        className={`w-10 h-10 rounded-xl overflow-hidden border-2 transition-all ${
                                                            photoURL === av ? 'border-red-500 scale-110 shadow-lg' : 'border-transparent opacity-60 hover:opacity-100'
                                                        }`}
                                                    >
                                                        <img src={av} className="w-full h-full object-cover" />
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Bio */}
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className="text-[11px] text-gray-400 uppercase font-black tracking-widest block">
                                        Biografía / Descripción (bio)
                                    </label>
                                    <span className={`text-[10px] font-mono ${bio.length > 250 ? 'text-red-500 font-bold' : 'text-gray-500'}`}>
                                        {bio.length} / 250
                                    </span>
                                </div>
                                <textarea
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value.slice(0, 250))}
                                    rows={3}
                                    placeholder="Creador de contenido y animador 3D / Gacha..."
                                    className="w-full bg-white/5 border border-white/10 p-4 rounded-xl text-white outline-none focus:border-red-600 transition-all text-xs resize-none"
                                />
                            </div>
                        </div>
                    )}

                    {/* 2. AESTHETICS / NEON ACCENT */}
                    {activeTab === 'aesthetic' && (
                        <div className="space-y-6 animate-fade-in">
                            <div>
                                <label className="text-[11px] text-gray-400 uppercase font-black tracking-widest mb-2 block">
                                    Color Temático del Perfil (accentColor)
                                </label>
                                <p className="text-xs text-gray-400 mb-4">
                                    Elige un destello neón o color de acento personalizado para tu tarjeta de perfil y resaltados en la plataforma.
                                </p>

                                {/* Color Presets */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                                    {NEON_PRESETS.map((p) => (
                                        <button
                                            key={p.value}
                                            type="button"
                                            onClick={() => setAccentColor(p.value)}
                                            className={`p-3 rounded-2xl border flex items-center gap-3 transition-all ${
                                                accentColor === p.value
                                                    ? 'bg-white/10 border-white text-white shadow-xl scale-105'
                                                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30'
                                            }`}
                                        >
                                            <span
                                                className="w-5 h-5 rounded-full shrink-0 shadow-lg"
                                                style={{ backgroundColor: p.value, boxShadow: `0 0 12px ${p.value}` }}
                                            />
                                            <span className="text-xs font-bold truncate">{p.label}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Custom Color Input */}
                                <div className="flex items-center gap-4 p-4 bg-white/5 border border-white/10 rounded-2xl">
                                    <input
                                        type="color"
                                        value={accentColor}
                                        onChange={(e) => setAccentColor(e.target.value)}
                                        className="w-12 h-12 rounded-xl border-none cursor-pointer bg-transparent"
                                    />
                                    <div className="flex-1">
                                        <label className="text-[10px] text-gray-500 uppercase font-bold block">Código Hexadecimal Personalizado</label>
                                        <input
                                            type="text"
                                            value={accentColor}
                                            onChange={(e) => setAccentColor(e.target.value)}
                                            className="bg-black/40 border border-white/10 px-3 py-1.5 rounded-lg text-white font-mono text-xs w-32 uppercase focus:border-red-600 outline-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Live Card Preview */}
                            <div>
                                <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-2 block">
                                    Vista Previa de la Tarjeta de Perfil
                                </label>
                                <div
                                    className="relative rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl p-4 transition-all"
                                    style={{
                                        boxShadow: `0 0 35px ${accentColor}25`,
                                        borderColor: `${accentColor}50`,
                                    }}
                                >
                                    {/* Banner background */}
                                    <div className="h-24 -m-4 mb-3 relative overflow-hidden bg-gradient-to-r from-gray-900 to-black">
                                        {bannerURL && <img src={bannerURL} className="w-full h-full object-cover opacity-80" />}
                                        <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />
                                    </div>

                                    {/* Avatar & Badges */}
                                    <div className="flex items-end gap-4 relative z-10 -mt-10 px-2 mb-3">
                                        <div
                                            className="w-16 h-16 rounded-2xl overflow-hidden border-2 bg-black shrink-0 shadow-2xl"
                                            style={{ borderColor: accentColor }}
                                        >
                                            <img src={photoURL} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-lg font-black text-white truncate">{displayName || 'Nombre'}</h3>
                                                <span
                                                    className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase text-black"
                                                    style={{ backgroundColor: accentColor }}
                                                >
                                                    {mainProfile?.role || 'User'}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-400 font-mono">@{username || 'username'}</p>
                                        </div>
                                    </div>

                                    {/* Bio */}
                                    <p className="text-xs text-gray-300 px-2 mb-3 line-clamp-2">
                                        {bio || 'Sin biografía especificada.'}
                                    </p>

                                    {/* Social Badges */}
                                    <div className="flex gap-2 px-2 text-[10px] text-gray-400">
                                        {socialLinks.youtube && <span className="px-2 py-1 bg-red-600/20 text-red-400 rounded-md">YouTube</span>}
                                        {socialLinks.discord && <span className="px-2 py-1 bg-indigo-600/20 text-indigo-400 rounded-md">Discord</span>}
                                        {socialLinks.twitter && <span className="px-2 py-1 bg-sky-600/20 text-sky-400 rounded-md">Twitter/X</span>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 3. SOCIAL LINKS */}
                    {activeTab === 'social' && (
                        <div className="space-y-4 animate-fade-in">
                            <p className="text-xs text-gray-400 mb-2">
                                Vincula tus plataformas y comunidades oficiales para mostrarlas en tu perfil de SeikoYT.
                            </p>

                            {[
                                { key: 'youtube', label: 'Canal de YouTube (youtubeUrl)', icon: '📺', placeholder: 'https://youtube.com/@tu_canal' },
                                { key: 'discord', label: 'Servidor de Discord (discordUrl)', icon: '💬', placeholder: 'https://discord.gg/ejemplo' },
                                { key: 'twitter', label: 'Twitter / X (twitterUrl)', icon: '🐦', placeholder: 'https://x.com/tu_usuario' },
                                { key: 'instagram', label: 'Instagram (instagramUrl)', icon: '📸', placeholder: 'https://instagram.com/tu_usuario' },
                                { key: 'tiktok', label: 'TikTok (tiktokUrl)', icon: '🎵', placeholder: 'https://tiktok.com/@tu_usuario' },
                            ].map((s) => (
                                <div key={s.key}>
                                    <label className="text-[11px] text-gray-400 uppercase font-black tracking-widest mb-1 block flex items-center gap-2">
                                        <span>{s.icon}</span>
                                        <span>{s.label}</span>
                                    </label>
                                    <input
                                        type="url"
                                        value={(socialLinks as any)[s.key]}
                                        onChange={(e) => setSocialLinks({ ...socialLinks, [s.key]: e.target.value })}
                                        placeholder={s.placeholder}
                                        className="w-full bg-white/5 border border-white/10 px-4 py-3 rounded-xl text-white outline-none focus:border-red-600 transition-all text-xs font-mono"
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* 4. PREFERENCES */}
                    {activeTab === 'preferences' && (
                        <div className="space-y-6 animate-fade-in">
                            <p className="text-xs text-gray-400 mb-2">
                                Configura tus opciones de reproductor y pistas de audio/subtítulos predeterminadas.
                            </p>

                            <div>
                                <label className="text-[11px] text-gray-400 uppercase font-black tracking-widest mb-1.5 block">
                                    Idioma de Audio Preferido (preferredAudioLanguage)
                                </label>
                                <select
                                    value={preferences.audioLang}
                                    onChange={(e) => setPreferences({ ...preferences, audioLang: e.target.value })}
                                    className="w-full bg-white/5 border border-white/10 p-3.5 rounded-xl text-white outline-none focus:border-red-600 transition-all text-xs font-bold"
                                >
                                    <option value="es-LAT" className="bg-[#121212]">Español Latino (es-LAT)</option>
                                    <option value="es-ES" className="bg-[#121212]">Español España (es-ES)</option>
                                    <option value="ja" className="bg-[#121212]">Japonés Original (ja)</option>
                                    <option value="en" className="bg-[#121212]">Inglés (en)</option>
                                    <option value="pt" className="bg-[#121212]">Portugués (pt)</option>
                                </select>
                            </div>

                            <div>
                                <label className="text-[11px] text-gray-400 uppercase font-black tracking-widest mb-1.5 block">
                                    Idioma de Subtítulos Preferido (preferredSubtitlesLanguage)
                                </label>
                                <select
                                    value={preferences.subtitlesLang}
                                    onChange={(e) => setPreferences({ ...preferences, subtitlesLang: e.target.value })}
                                    className="w-full bg-white/5 border border-white/10 p-3.5 rounded-xl text-white outline-none focus:border-red-600 transition-all text-xs font-bold"
                                >
                                    <option value="es" className="bg-[#121212]">Español (es)</option>
                                    <option value="en" className="bg-[#121212]">Inglés (en)</option>
                                    <option value="ja" className="bg-[#121212]">Japonés (ja)</option>
                                    <option value="off" className="bg-[#121212]">Desactivado por Defecto</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* 5. FIRESTORE SYSTEM DATA */}
                    {activeTab === 'system' && (
                        <div className="space-y-4 animate-fade-in text-xs">
                            <p className="text-gray-400">
                                Información y metadatos internos almacenados en la colección de Firebase Firestore (<code className="text-red-400">/usuarios/&#123;uid&#125;</code>):
                            </p>

                            <div className="bg-black/60 border border-white/10 p-4 rounded-2xl font-mono space-y-2 text-[11px] overflow-x-auto">
                                <div className="flex justify-between border-b border-white/5 pb-1.5">
                                    <span className="text-gray-500">UID Documento:</span>
                                    <span className="text-white font-bold">{user?.uid || activeProfile?.id || 'NO_AUTH'}</span>
                                </div>
                                <div className="flex justify-between border-b border-white/5 pb-1.5">
                                    <span className="text-gray-500">Rol de Usuario:</span>
                                    <span className="text-red-400 font-bold uppercase">{mainProfile?.role || activeProfile?.role || 'user'}</span>
                                </div>
                                <div className="flex justify-between border-b border-white/5 pb-1.5">
                                    <span className="text-gray-500">Términos Aceptados (termsAccepted):</span>
                                    <span className="text-green-400 font-bold">{mainProfile?.termsAccepted ? 'TRUE ✅' : 'PENDIENTE ⚠️'}</span>
                                </div>
                                <div className="flex justify-between border-b border-white/5 pb-1.5">
                                    <span className="text-gray-500">Fecha Términos (termsAcceptedAt):</span>
                                    <span className="text-gray-300">{mainProfile?.termsAcceptedAt ? String(mainProfile.termsAcceptedAt) : 'N/A'}</span>
                                </div>
                                <div className="flex justify-between border-b border-white/5 pb-1.5">
                                    <span className="text-gray-500">Lista Guardados (watchlist):</span>
                                    <span className="text-sky-400 font-bold">{mainProfile?.watchlist ? `${mainProfile.watchlist.length} items` : '0 items'}</span>
                                </div>
                                <div className="flex justify-between pt-1">
                                    <span className="text-gray-500">Correo Electrónico:</span>
                                    <span className="text-white">{user?.email || mainProfile?.email || 'N/A'}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Submit Bar */}
                    <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-4">
                        {statusMsg ? (
                            <span className="text-xs font-bold text-green-400 animate-pulse">{statusMsg}</span>
                        ) : (
                            <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                                Guardado automático en Firebase Firestore
                            </span>
                        )}

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-bold text-xs transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-red-600/30"
                            >
                                {loading ? 'Guardando...' : 'Guardar Cambios'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ProfileEdit;
