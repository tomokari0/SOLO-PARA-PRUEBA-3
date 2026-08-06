
import React from 'react';

export interface SkipSegment {
  label: string; // e.g. "Intro", "Intermedio", "Outro", "Resumen"
  start: number; // in seconds
  end: number;   // in seconds
}

export interface Episode {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  videoUrl: string;
  serverType?: 'uploadcare' | 'streamtape' | 'savefiles' | 'embed';
  embedCode?: string;
  audioTracks?: Record<string, string>; // e.g., { 'es': 'url1', 'en': 'url2' }
  duration: string; // e.g., "24m"
  introStart?: number;
  introEnd?: number;
  skipIntro?: number;
  skipSegments?: SkipSegment[];
  titleLogoUrl?: string;
  seasonId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface Season {
  id: string;
  seasonNumber: number;
  title?: string; // Optional custom title for season
  episodes: Episode[];
}

export interface DrmConfig {
  widevine?: {
    licenseUrl: string;
  };
  playready?: {
    licenseUrl: string;
  };
  fairplay?: {
    licenseUrl: string;
    certificateUrl: string;
  };
}

export interface Content {
  id: string;
  type: 'movie' | 'series'; // Differentiator
  source?: 'internal' | 'youtube';
  title: string;
  description: string;
  thumbnailUrl: string;
  backdropUrl: string;
  genre: string[];
  rating: string;
  releaseYear: number;
  featured?: boolean;
  youtubeId?: string;
  titleLogoUrl?: string;
 
  // Movie specific (or default fallback)
  videoUrl?: string;
  serverType?: 'uploadcare' | 'streamtape' | 'savefiles' | 'embed';
  embedCode?: string;
  audioTracks?: Record<string, string>; // e.g., { 'es': 'url1', 'en': 'url2' }
  introStart?: number;
  introEnd?: number;
  skipIntro?: number;
  skipSegments?: SkipSegment[];
 
  // Series specific
  seasons?: Season[];
  status?: 'ongoing' | 'completed' | 'cancelled';

  trailerUrl?: string;
  
  // DRM Configuration
  drm?: DrmConfig;
}

export interface Comment {
  id: string;
  username: string;
  avatar: string;
  text: string;
  timestamp: string;
  likes: number;
  userInteraction?: 'like' | 'dislike';
}

export interface UserSocialLinks {
  youtube?: string;
  discord?: string;
  twitter?: string;
  instagram?: string;
  tiktok?: string;
}

export interface UserPreferences {
  audioLang?: string;
  subtitlesLang?: string;
}

export interface UserProfile {
  id: string;
  uid?: string;
  username?: string;
  displayName?: string;
  name?: string;
  avatar?: string;
  photoURL?: string;
  bannerURL?: string;
  bio?: string;
  role: 'user' | 'admin';
  email?: string;
  isKid?: boolean;
  accentColor?: string;
  socialLinks?: UserSocialLinks;
  preferences?: UserPreferences;
  watchlist?: string[];
  createdAt?: any;
  termsAccepted?: boolean;
  termsAcceptedAt?: any;
  streak?: number;
  lastLogin?: string; // ISO date string
  totalWatchTime?: number; // Total seconds watched
}
