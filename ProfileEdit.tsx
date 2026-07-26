
import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { db } from './firebaseConfig';
import { doc, updateDoc } from 'firebase/firestore';
import AvatarUpload from './src/components/AvatarUpload';

interface ProfileEditProps {
    onClose: () => void;
    activeProfile: any; // Sub-profile being edited
}

const ProfileEdit: React.FC<ProfileEditProps> = ({ onClose, activeProfile }) => {
    const { user } = useAuth();
    const [name, setName] = useState(activeProfile?.name || '');
    const [loading, setLoading] = useState(false);
    const [preview, setPreview] = useState<string | null>(activeProfile?.avatar || null);

    const handleUploadSuccess = (url: string) => {
        setPreview(url);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !activeProfile) return;

        setLoading(true);
        try {
            // Path requested by user: usuarios/{uid}/perfiles/{profileId}
            const profileRef = doc(db, "usuarios", user.uid, "perfiles", activeProfile.id);
            await updateDoc(profileRef, { name });
            onClose();
        } catch (err) {
            console.error("Error updating profile:", err);
            alert("Error al guardar los cambios");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-[300] backdrop-blur-sm">
            <div className="bg-[#121212] w-full max-w-md p-8 rounded-2xl border border-white/10 shadow-2xl animate-scale-in">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-2xl font-bebas text-white tracking-widest">Editar Perfil</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <div className="flex flex-col items-center mb-8">
                    {user && activeProfile && (
                        <AvatarUpload 
                            uid={user.uid} 
                            profileId={activeProfile.id} 
                            currentAvatar={preview || undefined}
                            onUploadSuccess={handleUploadSuccess}
                        />
                    )}
                    <p className="text-[10px] text-gray-500 mt-4 uppercase font-black tracking-widest">Foto de Perfil (ImageKit Optimized)</p>
                </div>

                <form onSubmit={handleSave} className="space-y-6">
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1 block">Nombre de Usuario</label>
                        <input 
                            type="text"
                            className="w-full bg-white/5 border border-white/10 p-4 rounded-xl text-white outline-none focus:border-red-600 transition-all font-bold"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    <button 
                        type="submit"
                        disabled={loading}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 rounded-xl transition-all active:scale-95 disabled:opacity-50 uppercase tracking-widest"
                    >
                        {loading ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ProfileEdit;
