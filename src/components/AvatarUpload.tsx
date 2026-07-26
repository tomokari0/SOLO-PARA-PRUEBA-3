import React, { useState, useRef } from 'react';
import ImageKit from 'imagekit-javascript';
import { db, auth } from '../../firebaseConfig';
import { doc, updateDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

interface AvatarUploadProps {
  uid: string;
  profileId: string;
  currentAvatar?: string;
  onUploadSuccess?: (newUrl: string) => void;
}

/**
 * Utility to get optimized ImageKit URL
 * Applies WebP format, 80% quality, and face-centered smart crop.
 */
export const getOptimizedAvatarUrl = (url: string) => {
  if (!url) return '';
  // Check if it's already an ImageKit URL
  if (url.includes('ik.imagekit.io')) {
    // Add transformation parameters
    // fo-face: smart crop focused on face
    // f-webp: auto format selection (webp)
    // q-80: quality 80
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}tr=fo-face,f-webp,q-80,w-300,h-300`;
  }
  return url;
};

const AvatarUpload: React.FC<AvatarUploadProps> = ({ uid, profileId, currentAvatar, onUploadSuccess }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize ImageKit Client inside a ref or just before use
  const getIKClient = () => {
    const meta = (import.meta as any).env;
    return new ImageKit({
      publicKey: meta.VITE_IMAGEKIT_PUBLIC_KEY || '',
      urlEndpoint: meta.VITE_IMAGEKIT_URL_ENDPOINT || '',
      authenticationEndpoint: typeof window !== 'undefined' ? `${window.location.origin}/api/imagekit/auth` : ''
    } as any);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const meta = (import.meta as any).env;
    console.log("File selected:", file.name, file.size, file.type);

    if (!meta.VITE_IMAGEKIT_PUBLIC_KEY || !meta.VITE_IMAGEKIT_URL_ENDPOINT) {
      setError("Configuración de ImageKit incompleta. Revisa las variables de entorno.");
      console.error("Missing ImageKit config:", {
        pub: !!meta.VITE_IMAGEKIT_PUBLIC_KEY,
        endpoint: !!meta.VITE_IMAGEKIT_URL_ENDPOINT
      });
      return;
    }

    // Validate if user is authenticated
    if (!auth.currentUser) {
      setError("Debes estar autenticado para subir imágenes.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      console.log("Starting ImageKit upload...");
      const ik = getIKClient();
      
      // 1. Upload to ImageKit
      const uploadResponse = await new Promise<any>((resolve, reject) => {
        ik.upload({
          file: file,
          fileName: `avatar_${uid}_${profileId}_${Date.now()}`,
          folder: "/perfiles/",
          useUniqueFileName: true,
        } as any, (err: any, result: any) => {
          if (err) {
            console.error("ImageKit SDK Upload Error:", err);
            reject(err);
          } else {
            console.log("ImageKit Upload Success:", result);
            resolve(result);
          }
        });
      });

      const rawUrl = uploadResponse.url;
      const optimizedUrl = getOptimizedAvatarUrl(rawUrl);

      console.log("Updating Firestore with URL:", optimizedUrl);
      // 2. Update Firestore
      // Path: usuarios/{uid}/perfiles/{profileId}
      const profileRef = doc(db, 'usuarios', uid, 'perfiles', profileId);
      await updateDoc(profileRef, {
        avatar: optimizedUrl,
        updatedAt: new Date().toISOString()
      });

      if (onUploadSuccess) {
        onUploadSuccess(optimizedUrl);
      }
    } catch (err: any) {
      console.error("Detailed Upload Error:", err);
      // Handle the specific "Missing token" error or others
      let msg = "Error al subir la imagen";
      if (err.message && err.message.includes("Missing token")) {
        msg = "Error de autenticación con el servidor. Verifica las credenciales de ImageKit.";
      } else if (err.message) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-black/40 rounded-2xl border border-white/5 backdrop-blur-xl">
      <div className="relative group">
        <div className="w-32 h-32 rounded-full overflow-hidden border-2 border-red-600/30 group-hover:border-red-600 transition-all duration-300 shadow-[0_0_15px_rgba(255,0,0,0.1)] group-hover:shadow-[0_0_25px_rgba(255,0,0,0.3)]">
          <img 
            src={currentAvatar || 'https://ik.imagekit.io/seikoyt/default-avatar.png'} 
            alt="Avatar Preview" 
            className="w-full h-full object-cover"
          />
        </div>
        
        <AnimatePresence>
          {uploading && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center rounded-full"
            >
              <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <input 
        type="file" 
        accept="image/*" 
        onChange={handleFileSelect} 
        ref={fileInputRef}
        className="hidden"
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className={`
          flex items-center gap-2 px-6 py-3 bg-black text-white font-bold rounded-xl 
          border border-[#ff0000] shadow-[0_0_10px_#ff0000] 
          hover:shadow-[0_0_20px_#ff0000] hover:scale-[1.02] active:scale-[0.98] 
          transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed
        `}
      >
        {uploading ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Subiendo...</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>Cambiar Foto</span>
          </>
        )}
      </button>

      {error && (
        <span className="text-red-500 text-xs font-medium animate-pulse">{error}</span>
      )}
    </div>
  );
};

export default AvatarUpload;
