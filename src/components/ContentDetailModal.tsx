import React, { useState, useEffect, useMemo } from 'react';
import { Content, Episode, Season } from '../../types';
import { db } from '../../firebaseConfig';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { ContentLikeButton } from './ContentLikeButton';
import { useUserHistory } from '../../App';

const PlayIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const DownloadIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="9" x2="12" y2="15" />
  </svg>
);

const DownloadProgressRing: React.FC<{ progress: number; size?: number }> = ({ progress = 0, size = 26 }) => {
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, progress)) / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.2)" strokeWidth={strokeWidth} fill="transparent" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#ef4444"
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-300"
        />
      </svg>
    </div>
  );
};

interface ContentDetailModalProps {
  item: Content;
  onClose: () => void;
  onPlayEpisode: (item: Content, episodeIndex: number) => void;
  downloadedUrls?: string[];
  downloadVideo?: (url: string, metadata?: any) => void;
  downloading?: Record<string, number>;
  removeDownload?: (url: string) => void;
}

export const ContentDetailModal: React.FC<ContentDetailModalProps> = ({
  item,
  onClose,
  onPlayEpisode,
  downloadedUrls = [],
  downloadVideo,
  downloading = {},
  removeDownload,
}) => {
  const { watchProgress } = useUserHistory();
  const [activeTab, setActiveTab] = useState<'episodes' | 'info' | 'cast'>('episodes');
  const [selectedSeasonIndex, setSelectedSeasonIndex] = useState<number>(0);
  const [firestoreSeasons, setFirestoreSeasons] = useState<Season[]>([]);
  const [firestoreEpisodes, setFirestoreEpisodes] = useState<Episode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState<boolean>(false);

  const [cast, setCast] = useState<{ id: string; name: string; role: string; character?: string; avatar?: string }[]>([]);
  const [loadingCast, setLoadingCast] = useState<boolean>(false);
  const [showTrailerModal, setShowTrailerModal] = useState<boolean>(false);

  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Set default tab based on item type
  useEffect(() => {
    if (item.type === 'movie') {
      setActiveTab('info');
    } else {
      setActiveTab('episodes');
    }
  }, [item.type]);

  // Fetch seasons & episodes from Firestore if available
  useEffect(() => {
    if (item.type === 'series') {
      let isMounted = true;
      const fetchData = async () => {
        setLoadingEpisodes(true);
        try {
          // 1. Fetch seasons from subcollection "temporadas"
          const seasonsRef = collection(db, 'content', item.id, 'temporadas');
          const seasonsQuery = query(seasonsRef, orderBy('seasonNumber', 'asc'));
          const seasonsSnap = await getDocs(seasonsQuery);

          const seasonsData = seasonsSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Season[];

          // 2. Fetch episodes from subcollection "episodes"
          const episodesRef = collection(db, 'content', item.id, 'episodes');
          const epQuery = query(episodesRef, orderBy('episodeNumber', 'asc'));
          const epSnap = await getDocs(epQuery);

          const episodesData = epSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Episode[];

          if (!isMounted) return;

          if (seasonsData.length > 0) {
            setFirestoreSeasons(seasonsData);
          }
          if (episodesData.length > 0) {
            setFirestoreEpisodes(episodesData);
          }
        } catch (error) {
          console.error('Error fetching series data from Firestore:', error);
        } finally {
          if (isMounted) setLoadingEpisodes(false);
        }
      };

      fetchData();
      return () => {
        isMounted = false;
      };
    }
  }, [item]);

  // Fetch Cast from Firestore
  useEffect(() => {
    let isSubscribed = true;
    setLoadingCast(true);
    const fetchCast = async () => {
      try {
        const castRef = collection(db, 'content', item.id, 'cast');
        const querySnapshot = await getDocs(castRef);
        if (!isSubscribed) return;

        const castData: any[] = [];
        querySnapshot.forEach((doc) => {
          castData.push({ id: doc.id, ...doc.data() });
        });
        setCast(castData);
      } catch (err) {
        console.error('Error fetching cast:', err);
      } finally {
        if (isSubscribed) setLoadingCast(false);
      }
    };

    fetchCast();
    return () => {
      isSubscribed = false;
    };
  }, [item.id]);

  // Derive Seasons list or group Firestore episodes by season
  const seasons: Season[] = useMemo(() => {
    // Priority 1: item.seasons if defined directly on item (e.g. mock data or embedded object)
    if (item.seasons && item.seasons.length > 0) {
      return item.seasons;
    }

    // Priority 2: Firestore temporadas & episodes
    if (firestoreSeasons.length > 0 || firestoreEpisodes.length > 0) {
      if (firestoreSeasons.length > 0) {
        return firestoreSeasons.map((season, idx) => {
          const seasonEps = firestoreEpisodes.filter((ep) => {
            if (ep.seasonId) return ep.seasonId === season.id;
            if (ep.seasonNumber) return ep.seasonNumber === season.seasonNumber;
            return idx === 0;
          });
          return {
            ...season,
            episodes: seasonEps,
          };
        });
      } else if (firestoreEpisodes.length > 0) {
        // Group episodes by seasonNumber
        const seasonMap: Record<number, Episode[]> = {};
        firestoreEpisodes.forEach((ep) => {
          const sNum = ep.seasonNumber || 1;
          if (!seasonMap[sNum]) seasonMap[sNum] = [];
          seasonMap[sNum].push(ep);
        });

        const seasonNumbers = Object.keys(seasonMap).map(Number).sort((a, b) => a - b);
        return seasonNumbers.map((sNum) => ({
          id: `season_${sNum}`,
          seasonNumber: sNum,
          title: `Temporada ${sNum}`,
          episodes: seasonMap[sNum],
        }));
      }
    }

    return [
      {
        id: 's1',
        seasonNumber: 1,
        title: 'Temporada 1',
        episodes: [],
      },
    ];
  }, [item.seasons, firestoreSeasons, firestoreEpisodes]);

  // Active episodes for currently selected season
  const currentSeasonEpisodes: Episode[] = useMemo(() => {
    const activeSeason = seasons[selectedSeasonIndex] || seasons[0];
    if (activeSeason && activeSeason.episodes) {
      return activeSeason.episodes;
    }
    return firestoreEpisodes;
  }, [seasons, selectedSeasonIndex, firestoreEpisodes]);

  // Calculate global index offset for multi-season playback positioning
  const getGlobalEpisodeIndex = (episodeInSeasonIndex: number) => {
    let offset = 0;
    for (let i = 0; i < selectedSeasonIndex; i++) {
      if (seasons[i] && seasons[i].episodes) {
        offset += seasons[i].episodes.length;
      }
    }
    return offset + episodeInSeasonIndex;
  };

  const getPlaceholderCast = (title: string, type: 'movie' | 'series') => {
    return [
      {
        id: 'p1',
        name: 'Yuki Dobladora 🎙️',
        role: 'Voz Principal (Protagonista)',
        character: 'Yumi',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
      },
      {
        id: 'p2',
        name: 'Ken Gacha-Voice 🎙️',
        role: 'Voz Co-Estelar',
        character: 'Ren',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
      },
      {
        id: 'p3',
        name: 'Miyuki Chann ✨',
        role: 'Voz de Reparto',
        character: 'Ami',
        avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200',
      },
    ];
  };

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      {/* Container Card */}
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-stone-950 border border-white/10 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col my-auto text-white">
        
        {/* Header Hero Banner with Backdrop */}
        <div className="relative w-full h-56 sm:h-72 md:h-80 shrink-0 overflow-hidden bg-black">
          <img
            src={item.backdropUrl || item.thumbnailUrl}
            alt={item.title}
            className="w-full h-full object-cover object-center opacity-65 filter brightness-90 scale-105 transform transition-transform duration-700 hover:scale-100"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-stone-950/90 via-transparent to-transparent" />

          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-black/60 hover:bg-red-600 border border-white/10 hover:border-red-500 flex items-center justify-center text-white transition-all transform active:scale-90 shadow-lg"
            title="Cerrar (Esc)"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>

          {/* Hero Content Overlay */}
          <div className="absolute bottom-4 sm:bottom-6 left-4 sm:left-8 right-4 sm:right-8 flex flex-col sm:flex-row items-start sm:items-end gap-4 z-10">
            {/* Poster Thumbnail */}
            <div className="w-24 sm:w-32 md:w-36 aspect-[2/3] rounded-2xl overflow-hidden border-2 border-white/20 shadow-[0_10px_30px_rgba(0,0,0,0.8)] shrink-0 hidden sm:block bg-stone-900">
              <img
                src={item.thumbnailUrl}
                alt={item.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="flex-1 space-y-2.5 min-w-0">
              {/* Type Badge & Tags */}
              <div className="flex flex-wrap items-center gap-2 text-[10px] sm:text-xs">
                <span className="bg-red-600 text-white font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-[0_0_12px_rgba(239,68,68,0.5)]">
                  {item.type === 'series' ? 'Serie Gacha' : 'Película'}
                </span>
                <span className="bg-white/10 px-2 py-0.5 rounded-md font-bold text-gray-300">
                  {item.releaseYear}
                </span>
                <span className="border border-white/20 px-2 py-0.5 rounded-md font-bold text-gray-300 uppercase">
                  {item.rating || 'PG-13'}
                </span>
                {item.status && (
                  <span
                    className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                      item.status === 'ongoing'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : item.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                    }`}
                  >
                    {item.status === 'ongoing' ? 'En emisión' : item.status === 'completed' ? 'Terminado' : 'Cancelado'}
                  </span>
                )}
              </div>

              {/* Title Logo or Stylized Heading */}
              {item.titleLogoUrl ? (
                <img
                  src={item.titleLogoUrl}
                  alt={item.title}
                  className="max-h-12 sm:max-h-16 md:max-h-20 object-contain filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <h2 className="text-2xl sm:text-4xl md:text-5xl font-bebas tracking-wider uppercase text-white drop-shadow-md leading-none">
                  {item.title}
                </h2>
              )}

              {/* Primary Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  onClick={() => onPlayEpisode(item, 0)}
                  className="bg-red-600 hover:bg-red-500 text-white px-5 sm:px-7 py-2.5 sm:py-3 rounded-2xl font-black text-xs sm:text-sm uppercase tracking-widest flex items-center gap-2.5 shadow-[0_0_20px_rgba(239,68,68,0.5)] transition-all transform active:scale-95 hover:scale-[1.02]"
                >
                  <PlayIcon className="w-5 h-5 text-white" />
                  <span>{item.type === 'series' ? 'Reproducir T1:E1' : 'Reproducir Película'}</span>
                </button>

                {item.trailerUrl && (
                  <button
                    onClick={() => setShowTrailerModal(true)}
                    className="bg-white/10 hover:bg-white/20 border border-white/20 text-white px-4 py-2.5 sm:py-3 rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 transition-all"
                  >
                    <span>🎬 Ver Trailer</span>
                  </button>
                )}

                <ContentLikeButton contentId={item.id} title={item.title} variant="header" />
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-white/10 px-4 sm:px-8 bg-stone-900/60 shrink-0">
          {item.type === 'series' && (
            <button
              onClick={() => setActiveTab('episodes')}
              className={`py-3.5 px-4 font-black text-xs uppercase tracking-widest transition-all border-b-2 ${
                activeTab === 'episodes'
                  ? 'border-red-600 text-red-500 shadow-[0_2px_10px_rgba(239,68,68,0.3)]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              Temporadas y Episodios
            </button>
          )}

          <button
            onClick={() => setActiveTab('info')}
            className={`py-3.5 px-4 font-black text-xs uppercase tracking-widest transition-all border-b-2 ${
              activeTab === 'info'
                ? 'border-red-600 text-red-500 shadow-[0_2px_10px_rgba(239,68,68,0.3)]'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Sinopsis y Detalles
          </button>

          <button
            onClick={() => setActiveTab('cast')}
            className={`py-3.5 px-4 font-black text-xs uppercase tracking-widest transition-all border-b-2 ${
              activeTab === 'cast'
                ? 'border-red-600 text-red-500 shadow-[0_2px_10px_rgba(239,68,68,0.3)]'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Reparto ({cast.length || 3})
          </button>
        </div>

        {/* Modal Body / Scrollable Content */}
        <div className="p-4 sm:p-6 md:p-8 overflow-y-auto flex-1 space-y-6">

          {/* TAB 1: SEASON & EPISODES SELECTOR (for Series) */}
          {activeTab === 'episodes' && item.type === 'series' && (
            <div className="space-y-6 animate-fade-in">
              {/* Season Selector Bar if multiple seasons or default */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white/5 border border-white/10 p-3 rounded-2xl">
                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mr-1 hidden sm:inline">
                    Temporadas:
                  </span>
                  {seasons.map((season, sIdx) => (
                    <button
                      key={season.id || `s-${sIdx}`}
                      onClick={() => setSelectedSeasonIndex(sIdx)}
                      className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                        selectedSeasonIndex === sIdx
                          ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] scale-105'
                          : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {season.title || `Temporada ${season.seasonNumber || sIdx + 1}`}
                      {season.episodes && season.episodes.length > 0 && (
                        <span className="ml-2 text-[10px] opacity-75">({season.episodes.length})</span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="text-xs text-gray-400 font-semibold">
                  Total Episodios: <strong className="text-white">{currentSeasonEpisodes.length}</strong>
                </div>
              </div>

              {/* Loading Indicator */}
              {loadingEpisodes ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-400 font-bold">Cargando episodios de la serie...</span>
                </div>
              ) : currentSeasonEpisodes.length === 0 ? (
                <div className="text-center py-12 bg-white/5 border border-white/10 rounded-2xl p-6">
                  <span className="text-4xl mb-2 block">📺</span>
                  <h4 className="text-base font-bold text-white">No hay episodios registrados aún</h4>
                  <p className="text-xs text-gray-400 mt-1">Próximamente se añadirán nuevos capítulos a esta temporada.</p>
                </div>
              ) : (
                /* Episode List Cards */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {currentSeasonEpisodes.map((ep, epIdx) => {
                    const globalIdx = getGlobalEpisodeIndex(epIdx);
                    const watchKey = `${item.id}_${ep.id}`;
                    const progress = watchProgress[watchKey];
                    const percent = progress && progress.duration > 0 ? (progress.currentTime / progress.duration) * 100 : 0;

                    return (
                      <div
                        key={ep.id || `ep-${epIdx}`}
                        onClick={() => onPlayEpisode(item, globalIdx)}
                        className="group relative bg-white/5 hover:bg-stone-900 border border-white/10 hover:border-red-600/60 p-3.5 rounded-2xl transition-all duration-300 cursor-pointer flex gap-3.5 items-start hover:shadow-[0_8px_25px_rgba(239,68,68,0.2)] hover:-translate-y-0.5"
                      >
                        {/* Thumbnail */}
                        <div className="relative w-28 sm:w-36 aspect-video bg-stone-900 rounded-xl overflow-hidden shrink-0 border border-white/10 group-hover:border-red-500/50">
                          <img
                            src={ep.thumbnailUrl || item.thumbnailUrl}
                            alt={ep.title}
                            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                            referrerPolicy="no-referrer"
                          />
                          {/* Play overlay button */}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-red-600/40 transition-colors">
                            <div className="w-9 h-9 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                              <PlayIcon className="w-5 h-5" />
                            </div>
                          </div>

                          {/* Duration Badge */}
                          {ep.duration && (
                            <span className="absolute bottom-1 right-1 bg-black/80 text-[9px] font-extrabold px-1.5 py-0.5 rounded text-gray-200">
                              {ep.duration}
                            </span>
                          )}

                          {/* Progress bar */}
                          {percent > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                              <div className="h-full bg-red-600" style={{ width: `${percent}%` }} />
                            </div>
                          )}
                        </div>

                        {/* Episode Info */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-black text-red-500 uppercase tracking-widest bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                              T{seasons[selectedSeasonIndex]?.seasonNumber || selectedSeasonIndex + 1} : E{ep.episodeNumber || epIdx + 1}
                            </span>

                            {/* Download Button */}
                            {ep.videoUrl && downloadVideo && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (downloadedUrls.includes(ep.videoUrl)) {
                                    if (removeDownload) removeDownload(ep.videoUrl);
                                  } else {
                                    downloadVideo(ep.videoUrl, {
                                      id: `${item.id}_${ep.id}`,
                                      title: `${item.title} - ${ep.title}`,
                                      thumbnailUrl: ep.thumbnailUrl || item.thumbnailUrl,
                                      type: 'episode',
                                      parentContent: item,
                                    });
                                  }
                                }}
                                className="p-1 hover:bg-white/10 rounded-full transition-all"
                                title="Descargar episodio"
                              >
                                {downloading[ep.videoUrl] !== undefined ? (
                                  <DownloadProgressRing progress={downloading[ep.videoUrl]} size={22} />
                                ) : downloadedUrls.includes(ep.videoUrl) ? (
                                  <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : (
                                  <DownloadIcon className="w-4 h-4 text-gray-400 hover:text-white" />
                                )}
                              </button>
                            )}
                          </div>

                          <h5 className="text-xs sm:text-sm font-black text-white group-hover:text-red-400 transition-colors truncate">
                            {ep.title}
                          </h5>

                          <p className="text-[11px] text-gray-400 line-clamp-2 leading-relaxed">
                            {ep.description || 'Sin descripción disponible para este episodio.'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SINOPSIS & DETAILS */}
          {activeTab === 'info' && (
            <div className="space-y-6 text-gray-300 animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                  <h4 className="text-base font-black text-white uppercase tracking-wider border-l-4 border-red-600 pl-3">
                    Sinopsis General
                  </h4>
                  <p className="text-xs sm:text-sm text-gray-300 leading-relaxed font-medium bg-white/5 border border-white/10 p-4 rounded-2xl">
                    {item.description || 'No hay una descripción disponible para esta obra.'}
                  </p>

                  <div className="space-y-2 pt-2">
                    <span className="text-[10px] text-gray-400 uppercase font-black tracking-widest block">
                      Géneros y Temáticas
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {item.genre && item.genre.map((g, idx) => (
                        <span
                          key={idx}
                          className="bg-white/10 hover:bg-red-600/30 text-white px-3 py-1 rounded-xl border border-white/10 text-xs font-bold transition-all"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-3 text-xs">
                  <h5 className="font-black text-white uppercase tracking-wider text-[11px] border-b border-white/10 pb-2">
                    Ficha Técnica
                  </h5>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Año:</span>
                    <span className="font-bold text-white">{item.releaseYear}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Tipo:</span>
                    <span className="font-bold text-red-400 uppercase">{item.type === 'series' ? 'Serie Gacha' : 'Película'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Clasificación:</span>
                    <span className="font-bold text-white">{item.rating}</span>
                  </div>
                  {item.status && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Estado:</span>
                      <span className="font-bold text-amber-400 capitalize">{item.status}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-400">Calidad:</span>
                    <span className="font-bold text-emerald-400">Full HD 1080p</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CAST & CREW */}
          {activeTab === 'cast' && (
            <div className="space-y-4 animate-fade-in">
              {loadingCast ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-400 font-bold">Cargando reparto...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {(cast.length > 0 ? cast : getPlaceholderCast(item.title, item.type)).map((actor) => (
                    <div
                      key={actor.id}
                      className="flex items-center gap-3 bg-white/5 p-3 rounded-2xl border border-white/10 hover:border-white/20 transition-all"
                    >
                      {actor.avatar ? (
                        <img
                          src={actor.avatar}
                          alt={actor.name}
                          className="w-12 h-12 rounded-full object-cover bg-stone-800 border border-white/20 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-red-700/20 border border-red-600/30 flex items-center justify-center text-red-500 font-black shrink-0 text-base">
                          {actor.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h5 className="text-white text-xs font-black truncate">{actor.name}</h5>
                        <p className="text-[10px] text-gray-400 truncate font-medium">
                          {actor.role}
                          {actor.character && <span className="text-red-400 font-bold"> · {actor.character}</span>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Trailer Modal Overlay if user clicks Trailer button */}
      {showTrailerModal && item.trailerUrl && (
        <div className="fixed inset-0 z-[220] bg-black/95 flex items-center justify-center p-4">
          <div className="relative w-full max-w-3xl aspect-video bg-black rounded-3xl overflow-hidden border border-white/20 shadow-2xl">
            <button
              onClick={() => setShowTrailerModal(false)}
              className="absolute top-3 right-3 z-30 w-9 h-9 rounded-full bg-black/80 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
            >
              ✕
            </button>
            <iframe
              src={item.trailerUrl.replace('watch?v=', 'embed/')}
              title={`Trailer ${item.title}`}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
    </div>
  );
};
