
import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from './firebaseConfig';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { UserProfile } from './types';
import { handleFirestoreError, OperationType } from './src/lib/firestoreErrorHandler';

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
    isAdmin: boolean;
    needsTermsAcceptance: boolean;
    acceptTermsAndCreateProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    profile: null,
    loading: true,
    isAdmin: false,
    needsTermsAcceptance: false,
    acceptTermsAndCreateProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [needsTermsAcceptance, setNeedsTermsAcceptance] = useState(false);

    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            if (!firebaseUser) {
                setProfile(null);
                setNeedsTermsAcceptance(false);
                setLoading(false);
            }
        });

        return () => unsubscribeAuth();
    }, []);

    useEffect(() => {
        if (!user) return;

        const profileRef = doc(db, "usuarios", user.uid);
        
        const unsubscribeProfile = onSnapshot(profileRef, async (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setProfile({ id: docSnap.id, ...data } as UserProfile);
                if (data.termsAccepted === true) {
                    setNeedsTermsAcceptance(false);
                } else {
                    setNeedsTermsAcceptance(true);
                }
                setLoading(false);
            } else {
                setProfile(null);
                setNeedsTermsAcceptance(true);
                setLoading(false);
            }
        }, (error) => {
            handleFirestoreError(error, OperationType.GET, profileRef.path);
            setLoading(false);
        });

        return () => unsubscribeProfile();
    }, [user]);

    const acceptTermsAndCreateProfile = async () => {
        if (!user) return;
        setLoading(true);
        const profileRef = doc(db, "usuarios", user.uid);
        const isAdminUser = user.email === 'tomokari07@gmail.com';
        
        const termsData = {
            termsAccepted: true,
            termsAcceptedAt: serverTimestamp(),
        };

        try {
            const docSnap = await getDoc(profileRef);
            if (docSnap.exists()) {
                await setDoc(profileRef, termsData, { merge: true });
            } else {
                const newProfile = {
                    id: user.uid,
                    name: user.displayName || 'Usuario',
                    avatar: user.photoURL || 'https://upload.wikimedia.org/wikipedia/commons/0/0b/Netflix-avatar.png',
                    role: isAdminUser ? 'admin' : 'user',
                    email: user.email || '',
                    ...termsData
                };
                await setDoc(profileRef, newProfile);
            }
            setNeedsTermsAcceptance(false);
        } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, profileRef.path);
        } finally {
            setLoading(false);
        }
    };

    const isAdmin = profile?.role === 'admin';

    return (
        <AuthContext.Provider value={{ user, profile, loading, isAdmin, needsTermsAcceptance, acceptTermsAndCreateProfile }}>
            {children}
        </AuthContext.Provider>
    );
};
