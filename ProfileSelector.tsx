
import React, { useState, useEffect } from 'react';
import { db } from './firebaseConfig';
import { collection, onSnapshot, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { useAuth } from './AuthContext';
import { UserProfile } from './types';
import { handleFirestoreError, OperationType } from './src/lib/firestoreErrorHandler';

interface ProfileSelectorProps {
    onProfileSelect: (profile: UserProfile) => void;
}

const ProfileSelector: React.FC<ProfileSelectorProps> = ({ onProfileSelect }) => {
    const { user } = useAuth();
    const [profiles, setProfiles] = useState<UserProfile[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newProfileName, setNewProfileName] = useState('');
    const [loading, setLoading] = useState(true);

    const AVATARS = [
        'https://upload.wikimedia.org/wikipedia/commons/0/0b/Netflix-avatar.png',
        'https://i.pinimg.com/originals/b6/77/cd/b677cd1cde292f261166533d6fe75872.png',
        'https://i.pinimg.com/originals/fb/8e/8a/fb8e8a96fca2f049334f312086a6e2f6.png',
        'https://i.pinimg.com/originals/61/54/76/61547625e01d375f9adfc1ffef350747.png'
    ];

    useEffect(() => {
        if (!user) return;

        const profilesRef = collection(db, "usuarios", user.uid, "perfiles");
        const q = query(profilesRef, orderBy("createdAt", "asc"));
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile));
            setProfiles(data);
            setLoading(false);
        }, (error) => {
            handleFirestoreError(error, OperationType.GET, profilesRef.path);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const handleAddProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !newProfileName.trim()) return;

        try {
            const randomAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
            const profilesRef = collection(db, "usuarios", user.uid, "perfiles");
            await addDoc(profilesRef, {
                name: newProfileName,
                avatar: randomAvatar,
                role: 'user',
                createdAt: serverTimestamp()
            });
            setNewProfileName('');
            setIsModalOpen(false);
        } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, `usuarios/${user.uid}/perfiles`);
        }
    };

    if (loading) {
        return (
            <div className="fixed inset-0 bg-black flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black z-[500] flex flex-col items-center justify-center p-4">
            <h1 className="text-3xl md:text-5xl font-bebas text-white mb-12 tracking-widest animate-fade-in">¿Quién está viendo ahora?</h1>
            
            <div className="flex flex-wrap justify-center gap-6 md:gap-10 max-w-5xl animate-fade-in-up">
                {profiles.map((profile) => (
                    <div 
                        key={profile.id}
                        onClick={() => onProfileSelect(profile)}
                        className="group flex flex-col items-center gap-4 cursor-pointer"
                    >
                        <div className="relative w-24 h-24 md:w-40 md:h-40 rounded-md overflow-hidden border-2 border-transparent group-hover:border-white group-hover:shadow-[0_0_20px_#ef4444] transition-all duration-300 transform group-hover:scale-110">
                            <img src={profile.avatar} alt={profile.name} className="w-full h-full object-cover" />
                        </div>
                        <span className="text-gray-400 group-hover:text-white text-sm md:text-xl font-medium transition-colors">{profile.name}</span>
                    </div>
                ))}

                {/* Add Profile Button */}
                <div 
                    onClick={() => setIsModalOpen(true)}
                    className="group flex flex-col items-center gap-4 cursor-pointer"
                >
                    <div className="w-24 h-24 md:w-40 md:h-40 rounded-md bg-white/5 border-2 border-transparent group-hover:bg-white/10 group-hover:border-white transition-all duration-300 flex items-center justify-center transform group-hover:scale-110">
                        <svg className="w-12 h-12 md:w-20 md:h-20 text-gray-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 4v16m8-8H4"></path>
                        </svg>
                    </div>
                    <span className="text-gray-500 group-hover:text-white text-sm md:text-xl font-medium transition-colors">Añadir perfil</span>
                </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[600] flex items-center justify-center p-4">
                    <div className="bg-[#141414] border border-white/10 rounded-2xl p-8 w-full max-w-md animate-scale-in">
                        <h2 className="text-2xl font-bold text-white mb-6">Añadir perfil</h2>
                        <form onSubmit={handleAddProfile} className="space-y-6">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Nombre del perfil</label>
                                <input 
                                    type="text"
                                    autoFocus
                                    value={newProfileName}
                                    onChange={(e) => setNewProfileName(e.target.value)}
                                    placeholder="Ej. Seiko"
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-red-600 outline-none transition-all"
                                />
                            </div>
                            <div className="flex gap-4 pt-4">
                                <button 
                                    type="submit"
                                    className="flex-grow bg-white text-black font-bold py-3 rounded-lg hover:bg-red-600 hover:text-white transition-all"
                                >
                                    Guardar
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="flex-grow bg-white/5 text-white font-bold py-3 rounded-lg hover:bg-white/10 transition-all"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProfileSelector;
