import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../../firebaseConfig';
import { doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove, increment, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../AuthContext';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrorHandler';

export const getVisitorId = (): string => {
    let id = localStorage.getItem('seikotv_visitor_id');
    if (!id) {
        id = 'visitor_' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('seikotv_visitor_id', id);
    }
    return id;
};

interface ContentLikeButtonProps {
    contentId: string;
    title?: string;
    variant?: 'header' | 'full' | 'inline' | 'badge';
    className?: string;
}

export const ContentLikeButton: React.FC<ContentLikeButtonProps> = ({
    contentId,
    title,
    variant = 'header',
    className = ''
}) => {
    const { user, profile } = useAuth();
    const [likesCount, setLikesCount] = useState<number>(0);
    const [likedBy, setLikedBy] = useState<string[]>([]);
    const [isAnimating, setIsAnimating] = useState<boolean>(false);

    const currentUserId = useMemo(() => {
        return user?.uid || profile?.id || getVisitorId();
    }, [user, profile]);

    const hasLiked = useMemo(() => {
        return Array.isArray(likedBy) && likedBy.includes(currentUserId);
    }, [likedBy, currentUserId]);

    // Realtime Firestore Sync
    useEffect(() => {
        if (!contentId || !db) return;
        const docRef = doc(db, "content_likes", String(contentId));

        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setLikesCount(typeof data.likesCount === 'number' ? data.likesCount : 0);
                setLikedBy(Array.isArray(data.likedBy) ? data.likedBy : []);
            } else {
                setLikesCount(0);
                setLikedBy([]);
            }
        }, (error) => {
            console.error("Error al sincronizar me gusta en tiempo real:", error);
        });

        return () => unsubscribe();
    }, [contentId]);

    const toggleLike = useCallback(async (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (!contentId || !db) return;

        // Trigger animation
        setIsAnimating(true);
        setTimeout(() => setIsAnimating(false), 500);

        const newHasLiked = !hasLiked;
        const newLikesCount = newHasLiked ? likesCount + 1 : Math.max(0, likesCount - 1);
        const newLikedBy = newHasLiked
            ? [...likedBy, currentUserId]
            : likedBy.filter(id => id !== currentUserId);

        // Optimistic state
        setLikesCount(newLikesCount);
        setLikedBy(newLikedBy);

        try {
            const docRef = doc(db, "content_likes", String(contentId));
            if (newHasLiked) {
                await setDoc(docRef, {
                    likedBy: arrayUnion(currentUserId),
                    likesCount: increment(1),
                    updatedAt: serverTimestamp()
                }, { merge: true });
            } else {
                await updateDoc(docRef, {
                    likedBy: arrayRemove(currentUserId),
                    likesCount: increment(-1),
                    updatedAt: serverTimestamp()
                });
            }
        } catch (err) {
            console.error("Error al actualizar me gusta en Firestore:", err);
            handleFirestoreError(err, OperationType.WRITE, `content_likes/${contentId}`);
        }
    }, [contentId, hasLiked, likesCount, likedBy, currentUserId]);

    if (variant === 'badge') {
        return (
            <div 
                onClick={toggleLike}
                className={`flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10 text-xs font-mono cursor-pointer hover:bg-black/80 transition-all ${
                    hasLiked ? 'text-red-500 border-red-500/30' : 'text-gray-300'
                } ${className}`}
                title={hasLiked ? "Quitar me gusta" : "Me gusta"}
            >
                <svg 
                    className={`w-3.5 h-3.5 transition-transform ${isAnimating ? 'scale-125' : ''} ${
                        hasLiked ? 'fill-current text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'fill-none stroke-current'
                    }`} 
                    strokeWidth="2" 
                    viewBox="0 0 24 24"
                >
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
                <span>{likesCount}</span>
            </div>
        );
    }

    if (variant === 'full') {
        return (
            <button 
                onClick={toggleLike}
                className={`w-full py-3.5 px-6 rounded-xl font-bold flex items-center justify-between gap-3 transition-all transform active:scale-95 text-xs md:text-sm uppercase tracking-widest shadow-lg ${
                    hasLiked 
                        ? 'bg-red-600 hover:bg-red-700 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)] border border-red-500' 
                        : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
                } ${className}`}
            >
                <div className="flex items-center gap-3">
                    <svg 
                        className={`w-5 h-5 transition-transform ${isAnimating ? 'scale-125' : ''} ${
                            hasLiked ? 'fill-current text-white scale-110 drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'fill-none stroke-current'
                        }`} 
                        strokeWidth="2" 
                        viewBox="0 0 24 24"
                    >
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                    <span>{hasLiked ? '¡Te gusta este contenido!' : 'Me gusta'}</span>
                </div>
                <span className="font-mono bg-black/40 px-3 py-1 rounded-full text-xs font-black border border-white/10">
                    {likesCount} {likesCount === 1 ? 'LIKE' : 'LIKES'}
                </span>
            </button>
        );
    }

    if (variant === 'inline') {
        return (
            <button 
                onClick={toggleLike}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all transform active:scale-95 ${
                    hasLiked 
                        ? 'bg-red-600/20 text-red-500 border-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.3)]' 
                        : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/10 hover:text-white'
                } ${className}`}
                title={hasLiked ? "Quitar me gusta" : "Me gusta"}
            >
                <svg 
                    className={`w-4 h-4 transition-transform ${isAnimating ? 'scale-125' : ''} ${
                        hasLiked ? 'fill-current text-red-500 scale-110 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]' : 'fill-none stroke-current'
                    }`} 
                    strokeWidth="2" 
                    viewBox="0 0 24 24"
                >
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
                <span className="font-mono">{likesCount}</span>
            </button>
        );
    }

    // Default: 'header' variant
    return (
        <button 
            onClick={toggleLike}
            className={`px-3 py-1.5 md:px-4 md:py-2.5 rounded-full border text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all transform active:scale-95 shadow-lg ${
                hasLiked 
                    ? 'bg-red-600 text-white border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)] scale-105' 
                    : 'bg-black/60 hover:bg-white/20 text-gray-200 border-white/20 hover:text-white backdrop-blur-md'
            } ${className}`}
            title={hasLiked ? "Quitar me gusta" : "Me gusta"}
        >
            <svg 
                className={`w-4 h-4 md:w-5 md:h-5 transition-transform ${isAnimating ? 'scale-125' : ''} ${
                    hasLiked ? 'fill-current text-white scale-110 drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'fill-none stroke-current'
                }`} 
                strokeWidth="2" 
                viewBox="0 0 24 24"
            >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            <span className="font-mono text-xs md:text-sm">{likesCount}</span>
        </button>
    );
};

export default ContentLikeButton;
