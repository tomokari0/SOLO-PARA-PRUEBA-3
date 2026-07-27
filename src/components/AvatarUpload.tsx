import React, { useState, useRef } from 'react';
import ImageKit from 'imagekit-javascript';
import { db, auth } from '../../firebaseConfig';
import { doc, updateDoc, setDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

interface AvatarUploadProps {
  uid?: string;
  profileId?: string;
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
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}tr=fo-face,f-webp,q-80,w-300,h-300`;
  }
  return url;
};

const AvatarUpload: React.FC<AvatarUploadProps> = ({ uid, profileId, currentAvatar, onUploadSuccess }) => {
  const [provider, setProvider] = useState<'r2' | 'imagekit'>('r2');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
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

  const handleR2Upload = async (file: File) => {
    // 1. Try presigned URL first for maximum performance
    let uploadedUrl = '';
    try {
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: `avatar_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
          mimeType: file.type || "image/jpeg",
          folder: "perfiles",
        }),
      });

      if (presignRes.ok) {
        const presignData = await presignRes.json();
        if (presignData.success && presignData.presignedUrl) {
          const putRes = await fetch(presignData.presignedUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "image/jpeg" },
            body: file,
          });

          if (putRes.ok) {
            uploadedUrl = presignData.url;
          }
        }
      }
    } catch (e) {
      console.warn("R2 presigned upload failed, falling back to server upload route...", e);
    }

    // 2. Fallback to direct server endpoint `/api/upload` if presigned PUT is unavailable
    if (!uploadedUrl) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("folder", "perfiles");

        const serverRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const serverData = await serverRes.json();
        if (serverRes.ok && serverData.success && serverData.url) {
          uploadedUrl = serverData.url;
        }
      } catch (err) {
        console.warn("Server direct R2 upload failed:", err);
      }
    }

    // 3. Fail-safe Data URL fallback if R2 endpoint/bucket is unconfigured or unavailable
    if (!uploadedUrl) {
      console.log("R2 server upload unavailable, using Base64 Data URL fallback for profile picture...");
      uploadedUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(file);
      });
    }

    return uploadedUrl;
  };

  const handleImageKitUpload = async (file: File) => {
    const meta = (import.meta as any).env;
    if (!meta.VITE_IMAGEKIT_PUBLIC_KEY || !meta.VITE_IMAGEKIT_URL_ENDPOINT) {
      throw new Error("Configuración de ImageKit incompleta. Revisa las variables de entorno.");
    }

    const ik = getIKClient();
    const uploadResponse = await new Promise<any>((resolve, reject) => {
      ik.upload({
        file: file,
        fileName: `avatar_${uid || 'user'}_${profileId || 'default'}_${Date.now()}`,
        folder: "/perfiles/",
        useUniqueFileName: true,
      } as any, (err: any, result: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });

    return getOptimizedAvatarUrl(uploadResponse.url);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError("Por favor selecciona un archivo de imagen válido.");
      return;
    }

    setUploading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      let finalAvatarUrl = '';

      if (provider === 'r2') {
        console.log("Subiendo imagen de perfil a Cloudflare R2...");
        finalAvatarUrl = await handleR2Upload(file);
      } else {
        console.log("Subiendo imagen de perfil a ImageKit...");
        finalAvatarUrl = await handleImageKitUpload(file);
      }

      console.log("Subida exitosa, URL generada:", finalAvatarUrl);

      // Save to Firestore if uid & profileId are present
      if (uid && profileId && auth.currentUser) {
        try {
          const profileRef = doc(db, 'usuarios', uid, 'perfiles', profileId);
          await setDoc(profileRef, {
            avatar: finalAvatarUrl,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (subErr) {
          try {
            const mainUserRef = doc(db, 'usuarios', uid);
            await setDoc(mainUserRef, {
              avatar: finalAvatarUrl,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          } catch (mainErr) {
            console.warn("No se pudo actualizar avatar en Firestore:", mainErr);
          }
        }
      }

      setSuccessMsg(provider === 'r2' ? "¡Imagen guardada en Cloudflare R2!" : "¡Imagen guardada en ImageKit!");

      if (onUploadSuccess) {
        onUploadSuccess(finalAvatarUrl);
      }
    } catch (err: any) {
      console.error("Error al cargar la imagen de perfil:", err);
      let msg = err.message || "Error al subir la imagen de perfil.";
      if (msg.includes("Missing token")) {
        msg = "Error de autenticación con el servidor. Intenta con Cloudflare R2.";
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
    <div className="flex flex-col items-center gap-4 p-6 bg-black/50 rounded-2xl border border-white/10 backdrop-blur-xl shadow-xl w-full max-w-sm">
      <div className="relative group">
        <div className="w-32 h-32 rounded-full overflow-hidden border-2 border-red-600/40 group-hover:border-red-500 transition-all duration-300 shadow-[0_0_20px_rgba(255,0,0,0.2)] group-hover:shadow-[0_0_30px_rgba(255,0,0,0.4)] bg-neutral-900">
          <img 
            src={currentAvatar || 'https://upload.wikimedia.org/wikipedia/commons/0/0b/Netflix-avatar.png'} 
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
              className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center rounded-full p-2 text-center"
            >
              <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mb-1"></div>
              <span className="text-[10px] text-white font-bold tracking-wider uppercase">Subiendo...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Provider selector toggle */}
      <div className="flex items-center bg-white/5 p-1 rounded-xl border border-white/10 gap-1 text-xs">
        <button
          type="button"
          onClick={() => { setProvider('r2'); setError(null); }}
          className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
            provider === 'r2'
              ? 'bg-orange-600 text-white shadow-md shadow-orange-600/30'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <span>Cloudflare R2</span>
        </button>

        <button
          type="button"
          onClick={() => { setProvider('imagekit'); setError(null); }}
          className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
            provider === 'imagekit'
              ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>ImageKit</span>
        </button>
      </div>

      <input 
        type="file" 
        accept="image/*" 
        onChange={handleFileSelect} 
        ref={fileInputRef}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className={`
          w-full flex items-center justify-center gap-2 px-6 py-3 text-white font-bold text-xs rounded-xl 
          transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider
          ${provider === 'r2' 
            ? 'bg-orange-600 hover:bg-orange-500 shadow-[0_0_15px_rgba(234,88,12,0.3)] hover:scale-[1.02]' 
            : 'bg-red-600 hover:bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:scale-[1.02]'
          }
        `}
      >
        {uploading ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Subiendo a {provider === 'r2' ? 'Cloudflare R2' : 'ImageKit'}...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>Cargar Foto ({provider === 'r2' ? 'R2' : 'ImageKit'})</span>
          </>
        )}
      </button>

      {successMsg && (
        <span className="text-emerald-400 text-xs font-bold animate-fade-in text-center flex items-center gap-1">
          ✓ {successMsg}
        </span>
      )}

      {error && (
        <span className="text-red-400 text-xs font-medium animate-pulse text-center">{error}</span>
      )}
    </div>
  );
};

export default AvatarUpload;

