import React, { useState, useEffect, useMemo, useRef } from 'react';
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

const PlusIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CloseIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const DownloadIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="9" x2="12" y2="15" />
  </svg>
);

const DownloadProgressRing: React.FC<{ progress: number; size?: number }> = ({ progress = 0, size = 24 }) => {
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
  allContent?: Content[];
  onSelectContent?: (item: Content) => void;
  downloadedUrls?: string[];
  downloadVideo?: (url: string, metadata?: any) => void;
  downloading?: Record<string, number>;
  removeDownload?: (url: string) => void;
}

export const ContentDetailModal: React.FC<ContentDetailModalProps> = ({
  item,
  onClose,
  onPlayEpisode,
  allContent = [],
  onSelectContent,
  downloadedUrls = [],
  downloadVideo,
  downloading = {},
  removeDownload,
}) => {
  const { watchProgress } = useUserHistory();
  const [selectedSeasonIndex, setSelectedSeasonIndex] = useState<number>(0);
  const [firestoreSeasons, setFirestoreSeasons] = useState<Season[]>([]);
  const [firestoreEpisodes, setFirestoreEpisodes] = useState<Episode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState<boolean>(false);
  const [cast, setCast] = useState<{ id: string; name: string; role: string; character?: string; avatar?: string }[]>([]);
  const [showTrailerModal, setShowTrailerModal] = useState<boolean>(false);
  const [inWatchlist, setInWatchlist] = useState<boolean>(false);
  const [activeLang, setActiveLang] = useState<string>('Spanish');
  const [showMoreRecs, setShowMoreRecs] = useState<boolean>(false);
  const [recWatchlist, setRecWatchlist] = useState<Record<string, boolean>>({});

  // Deterministic match percentage generator (e.g. 84% - 98%)
  const matchRate = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < item.title.length; i++) {
      hash = item.title.charCodeAt(i) + ((hash << 5) - hash);
    }
    return 80 + (Math.abs(hash) % 19);
  }, [item.title]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [item.id]);

  // ESC Key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Load Watchlist state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('seikotv_watchlist');
      if (saved) {
        const list: string[] = JSON.parse(saved);
        setInWatchlist(list.includes(item.id));
      }
    } catch {
      setInWatchlist(false);
    }
  }, [item.id]);

  const toggleWatchlist = () => {
    try {
      const saved = localStorage.getItem('seikotv_watchlist');
      let list: string[] = saved ? JSON.parse(saved) : [];
      if (list.includes(item.id)) {
        list = list.filter((id) => id !== item.id);
        setInWatchlist(false);
      } else {
        list.push(item.id);
        setInWatchlist(true);
      }
      localStorage.setItem('seikotv_watchlist', JSON.stringify(list));
    } catch (e) {
      console.error('Error toggling watchlist:', e);
    }
  };

  const toggleRecWatchlist = (recId: string) => {
    setRecWatchlist((prev) => ({ ...prev, [recId]: !prev[recId] }));
  };

  // Fetch Seasons & Episodes from Firestore
  useEffect(() => {
    if (item.type === 'series') {
      let isMounted = true;
      const fetchData = async () => {
        setLoadingEpisodes(true);
        try {
          const seasonsRef = collection(db, 'content', item.id, 'temporadas');
          const seasonsQuery = query(seasonsRef, orderBy('seasonNumber', 'asc'));
          const seasonsSnap = await getDocs(seasonsQuery);
          const seasonsData = seasonsSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Season[];

          const episodesRef = collection(db, 'content', item.id, 'episodes');
          const epQuery = query(episodesRef, orderBy('episodeNumber', 'asc'));
          const epSnap = await getDocs(epQuery);
          const episodesData = epSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Episode[];

          if (!isMounted) return;
          if (seasonsData.length > 0) setFirestoreSeasons(seasonsData);
          if (episodesData.length > 0) setFirestoreEpisodes(episodesData);
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
      }
    };
    fetchCast();
    return () => {
      isSubscribed = false;
    };
  }, [item.id]);

  // Derive Seasons list
  const seasons: Season[] = useMemo(() => {
    if (item.seasons && item.seasons.length > 0) {
      return item.seasons;
    }
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
          title: `Season ${sNum}`,
          episodes: seasonMap[sNum],
        }));
      }
    }

    // Default fallback single season
    return [
      {
        id: 's1',
        seasonNumber: 1,
        title: 'Season 1',
        episodes: [
          {
            id: 'ep1',
            episodeNumber: 1,
            title: 'Episodio 1: Inicio de la Aventura',
            description: 'Un misterioso acontecimiento desencadena una serie de eventos sobrenaturales que cambiarán el destino de los protagonistas.',
            duration: '45m',
            thumbnailUrl: item.thumbnailUrl,
            videoUrl: item.videoUrl || '',
          },
          {
            id: 'ep2',
            episodeNumber: 2,
            title: 'Episodio 2: Revelaciones',
            description: 'Nuevos secretos salen a la luz mientras el equipo intenta descifrar los misterios ocultos.',
            duration: '48m',
            thumbnailUrl: item.backdropUrl || item.thumbnailUrl,
            videoUrl: item.videoUrl || '',
          },
          {
            id: 'ep3',
            episodeNumber: 3,
            title: 'Episodio 3: Encuentros',
            description: 'Las emociones aumentan cuando los personajes deben tomar decisiones difíciles para proteger a sus seres queridos.',
            duration: '52m',
            thumbnailUrl: item.thumbnailUrl,
            videoUrl: item.videoUrl || '',
          },
          {
            id: 'ep4',
            episodeNumber: 4,
            title: 'Episodio 4: Desafío Final',
            description: 'El clímax de la temporada enfrenta a los héroes contra sus peores temores.',
            duration: '55m',
            thumbnailUrl: item.backdropUrl || item.thumbnailUrl,
            videoUrl: item.videoUrl || '',
          },
        ],
      },
    ];
  }, [item, firestoreSeasons, firestoreEpisodes]);

  const currentSeasonEpisodes: Episode[] = useMemo(() => {
    const activeSeason = seasons[selectedSeasonIndex] || seasons[0];
    if (activeSeason && activeSeason.episodes && activeSeason.episodes.length > 0) {
      return activeSeason.episodes;
    }
    return firestoreEpisodes.length > 0 ? firestoreEpisodes : seasons[0]?.episodes || [];
  }, [seasons, selectedSeasonIndex, firestoreEpisodes]);

  const getGlobalEpisodeIndex = (episodeInSeasonIndex: number) => {
    let offset = 0;
    for (let i = 0; i < selectedSeasonIndex; i++) {
      if (seasons[i] && seasons[i].episodes) {
        offset += seasons[i].episodes.length;
      }
    }
    return offset + episodeInSeasonIndex;
  };

  // Recommendations logic ("More Like This")
  const recommendations: Content[] = useMemo(() => {
    if (allContent && allContent.length > 0) {
      const filtered = allContent.filter((c) => c.id !== item.id);
      // Prioritize same genre or same type
      const sameGenre = filtered.filter((c) =>
        c.genre && item.genre ? c.genre.some((g) => item.genre.includes(g)) : false
      );
      if (sameGenre.length >= 3) return sameGenre;
      return filtered;
    }
    // Fallback generated recommendations if allContent isn't provided
    return [
      {
        id: 'rec_1',
        title: 'No tail to tell',
        description: 'An eccentric, selfish supernatural being whose life takes a turn when she changes the fate of a soccer player.',
        type: 'series',
        thumbnailUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&q=80&w=400',
        backdropUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&q=80&w=600',
        genre: ['Korean', 'TV Comedies', 'Supernatural'],
        rating: 'U/A 12+',
        releaseYear: 2026,
      },
      {
        id: 'rec_2',
        title: 'King the Land',
        description: 'Amid a tense inheritance fight, a charming heir clashes with his hardworking employee who is known for her irresistible smile.',
        type: 'series',
        thumbnailUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&q=80&w=400',
        backdropUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&q=80&w=600',
        genre: ['Korean', 'Romantic TV Comedies'],
        rating: 'U/A 13+',
        releaseYear: 2023,
      },
      {
        id: 'rec_3',
        title: 'MY DEMON',
        description: 'A pitiless demon becomes powerless after getting entangled with an icy heiress, who may hold the key to his lost abilities.',
        type: 'series',
        thumbnailUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&q=80&w=400',
        backdropUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&q=80&w=600',
        genre: ['Korean', 'Fantasy', 'Romance'],
        rating: 'U/A 16+',
        releaseYear: 2023,
      },
      {
        id: 'rec_4',
        title: 'Business Proposal',
        description: 'In disguise as her friend, Ha-ri shows up to a blind date to scare him away. But plans go awry when he turns out to be her CEO.',
        type: 'series',
        thumbnailUrl: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&q=80&w=400',
        backdropUrl: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&q=80&w=600',
        genre: ['Korean', 'TV Comedies', 'Romance'],
        rating: 'U/A 16+',
        releaseYear: 2022,
      },
      {
        id: 'rec_5',
        title: "What's Wrong with Secretary Kim",
        description: 'A vainglorious executive who seemingly has everything faces devastating news when his adept personal assistant announces she is quitting.',
        type: 'series',
        thumbnailUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=400',
        backdropUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=600',
        genre: ['Korean', 'Romantic TV Comedies'],
        rating: 'U/A 16+',
        releaseYear: 2018,
      },
      {
        id: 'rec_6',
        title: "The Master's Sun",
        description: 'A woman who sees ghosts pairs with the materialistic head of a conglomerate to help each other out of jams as their hearts become entangled.',
        type: 'series',
        thumbnailUrl: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?auto=format&fit=crop&q=80&w=400',
        backdropUrl: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?auto=format&fit=crop&q=80&w=600',
        genre: ['Korean', 'Ghosts', 'Romantic Comedies'],
        rating: 'U/A 16+',
        releaseYear: 2013,
      },
    ];
  }, [allContent, item]);

  const visibleRecs = showMoreRecs ? recommendations : recommendations.slice(0, 6);

  // Strings for credits & tags
  const castString = useMemo(() => {
    if (cast.length > 0) return cast.map((c) => c.name).join(', ');
    return 'Park Eun-bin, Yang Se-jong, Ong Seong-wu, Jo Hye-joo, Kim Do-wan, Ye Soo-jung';
  }, [cast]);

  const genresString = useMemo(() => {
    if (item.genre && item.genre.length > 0) return item.genre.join(', ');
    return 'Korean, TV Comedies, Romantic TV Comedies';
  }, [item.genre]);

  const vibeTagsString = 'Quirky, Suspenseful, Comedy, Ghosts, Korean, Romantic, Opposites-Attract, TV';

  const languagesList = ['German', 'English', 'Spanish', 'French', 'Hindi', 'Italian', 'Korean', 'Portuguese'];

  return (
    <div ref={scrollContainerRef} className="fixed inset-0 z-[200] flex justify-center items-start overflow-y-auto bg-black/80 backdrop-blur-md p-0 sm:p-4 md:p-6 animate-fade-in scrollbar-thin">
      {/* Container Card */}
      <div className="relative w-full max-w-[880px] bg-[#181818] sm:rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col my-auto text-white border border-white/10 font-sans">
        
        {/* Floating Close Button X */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-40 w-9 h-9 rounded-full bg-[#181818]/90 hover:bg-[#2a2a2a] text-white flex items-center justify-center cursor-pointer transition-colors shadow-xl border border-white/20"
          title="Close (Esc)"
        >
          <CloseIcon className="w-5 h-5 text-white" />
        </button>

        {/* Hero Banner with Backdrop Image */}
        <div className="relative w-full h-72 sm:h-96 md:h-[420px] shrink-0 bg-black overflow-hidden select-none">
          <img
            src={item.backdropUrl || item.thumbnailUrl}
            alt={item.title}
            className="w-full h-full object-cover object-center filter brightness-95 opacity-90"
            referrerPolicy="no-referrer"
          />
          {/* Gradients */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-[#181818]/30 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#181818]/70 via-transparent to-transparent" />

          {/* Title & Action Buttons Overlay */}
          <div className="absolute bottom-6 left-6 sm:left-10 right-6 sm:right-10 flex flex-col items-start gap-4 z-20">
            {/* Title Logo or Typography */}
            {item.titleLogoUrl ? (
              <img
                src={item.titleLogoUrl}
                alt={item.title}
                className="max-h-16 sm:max-h-24 md:max-h-28 object-contain filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)]"
                referrerPolicy="no-referrer"
              />
            ) : (
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-black tracking-tight text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)] leading-none">
                {item.title}
              </h1>
            )}

            {/* Actions Row */}
            <div className="flex items-center gap-3 pt-1">
              {/* Play Button */}
              <button
                onClick={() => onPlayEpisode(item, 0)}
                className="bg-white hover:bg-white/90 text-black px-7 sm:px-9 py-2.5 sm:py-3 rounded-md font-extrabold text-sm sm:text-base flex items-center gap-2.5 cursor-pointer shadow-xl transition-all transform active:scale-95"
              >
                <PlayIcon className="w-5 h-5 sm:w-6 sm:h-6 text-black fill-current" />
                <span>Play</span>
              </button>

              {/* Add to Watchlist Button */}
              <button
                onClick={toggleWatchlist}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-full border-2 border-white/40 hover:border-white bg-[#2a2a2a]/80 hover:bg-[#333] text-white flex items-center justify-center cursor-pointer transition-all shadow-md"
                title={inWatchlist ? 'Remove from My List' : 'Add to My List'}
              >
                {inWatchlist ? <CheckIcon className="w-5 h-5 text-green-400" /> : <PlusIcon className="w-5 h-5 text-white" />}
              </button>

              {/* Content Like Button */}
              <ContentLikeButton contentId={item.id} title={item.title} variant="header" />

              {/* Trailer button */}
              {item.trailerUrl && (
                <button
                  onClick={() => setShowTrailerModal(true)}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-full border-2 border-white/40 hover:border-white bg-[#2a2a2a]/80 hover:bg-[#333] text-white flex items-center justify-center cursor-pointer transition-all shadow-md"
                  title="Watch Trailer"
                >
                  <span className="text-sm">🎬</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-10 space-y-10 bg-[#181818]">

          {/* Section 1: Metadata & Synopsis (2-Column Grid) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-10">
            {/* Left Column (2 spans) */}
            <div className="md:col-span-2 space-y-4">
              {/* Match & Tags Row */}
              <div className="flex flex-wrap items-center gap-2.5 text-xs sm:text-sm font-semibold">
                <span className="text-[#46d369] font-bold text-sm sm:text-base">{matchRate}% match</span>
                <span className="text-gray-300">{item.releaseYear}</span>
                <span className="text-gray-300">
                  {item.type === 'series' ? `${seasons.length} Season${seasons.length > 1 ? 's' : ''}` : '1h 52m'}
                </span>
                <span className="border border-white/40 text-gray-200 text-[10px] font-bold px-1.5 py-0.5 rounded leading-none">HD</span>
                <span className="border border-white/40 text-gray-200 text-[10px] font-bold px-1.5 py-0.5 rounded leading-none uppercase">
                  {item.rating || 'U/A 13+'}
                </span>
              </div>

              {/* Content Advisory Warnings */}
              <div className="text-xs text-gray-400 font-normal">
                violence, threat, mature themes, language, tobacco use
              </div>

              {/* Plot Description */}
              <p className="text-white/90 text-sm sm:text-base leading-relaxed font-sans pt-1">
                {item.description || 'In this supernatural story, a unique protagonist uncovers a chilling secret and navigates mysterious encounters.'}
              </p>

              {/* Audio & Languages List */}
              <div className="pt-3 border-t border-white/10">
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  {languagesList.map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setActiveLang(lang)}
                      className={`px-2.5 py-1 rounded transition-all cursor-pointer ${
                        activeLang === lang
                          ? 'bg-white text-black font-extrabold shadow-sm'
                          : 'text-gray-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column (Cast, Genres, Tags) */}
            <div className="md:col-span-1 space-y-3.5 text-xs sm:text-sm text-gray-400 leading-relaxed">
              <div>
                <span className="text-gray-500 font-medium">Cast: </span>
                <span className="text-white/90 font-normal">{castString}</span>
              </div>
              <div>
                <span className="text-gray-500 font-medium">Genres: </span>
                <span className="text-white/90 font-normal">{genresString}</span>
              </div>
              <div>
                <span className="text-gray-500 font-medium">This show is: </span>
                <span className="text-white/90 font-normal">{vibeTagsString}</span>
              </div>
            </div>
          </div>

          {/* Section 2: Episodes (for Series) */}
          {item.type === 'series' && (
            <div className="pt-6 border-t border-white/10 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-xl sm:text-2xl font-bold text-white">Episodes</h3>

                {/* Season Dropdown */}
                {seasons.length > 0 && (
                  <div className="relative">
                    <select
                      value={selectedSeasonIndex}
                      onChange={(e) => setSelectedSeasonIndex(Number(e.target.value))}
                      className="bg-[#242424] text-white border border-white/30 font-bold text-xs sm:text-sm px-4 py-2.5 rounded-md cursor-pointer hover:bg-[#333] transition-colors focus:outline-none appearance-none pr-9 shadow-md"
                    >
                      {seasons.map((s, idx) => (
                        <option key={s.id || idx} value={idx}>
                          {s.title || `Season ${s.seasonNumber || idx + 1}`} ({s.episodes?.length || 0} EP)
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">▼</div>
                  </div>
                )}
              </div>

              {/* Episodes List */}
              {loadingEpisodes ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-400 font-bold">Loading episodes...</span>
                </div>
              ) : currentSeasonEpisodes.length === 0 ? (
                <div className="text-center py-10 bg-[#242424] rounded-lg p-6 border border-white/5">
                  <p className="text-sm font-semibold text-gray-300">No episodes found for this season.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {currentSeasonEpisodes.map((ep, epIdx) => {
                    const globalIdx = getGlobalEpisodeIndex(epIdx);
                    const watchKey = `${item.id}_${ep.id}`;
                    const progress = watchProgress[watchKey];
                    const percent = progress && progress.duration > 0 ? (progress.currentTime / progress.duration) * 100 : 0;

                    return (
                      <div
                        key={ep.id || `ep-${epIdx}`}
                        onClick={() => onPlayEpisode(item, globalIdx)}
                        className="group relative bg-transparent hover:bg-[#2f2f2f] p-3 sm:p-4 rounded-lg transition-colors cursor-pointer border-b border-white/5 flex gap-4 items-center"
                      >
                        {/* Index Number */}
                        <span className="text-lg sm:text-2xl font-bold text-gray-400 group-hover:text-white w-6 sm:w-8 text-center shrink-0">
                          {epIdx + 1}
                        </span>

                        {/* Thumbnail */}
                        <div className="relative w-28 sm:w-36 aspect-video bg-[#2f2f2f] rounded overflow-hidden shrink-0 border border-white/10 group-hover:border-white/30">
                          <img
                            src={ep.thumbnailUrl || item.thumbnailUrl}
                            alt={ep.title}
                            className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition-opacity"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition-colors">
                            <div className="w-8 h-8 rounded-full bg-black/60 group-hover:bg-red-600 text-white flex items-center justify-center transition-transform transform group-hover:scale-110">
                              <PlayIcon className="w-4 h-4 text-white fill-current ml-0.5" />
                            </div>
                          </div>

                          {/* Watch Progress bar */}
                          {percent > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
                              <div className="h-full bg-red-600" style={{ width: `${percent}%` }} />
                            </div>
                          )}
                        </div>

                        {/* Info Column */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-xs sm:text-base font-bold text-white group-hover:text-red-400 transition-colors truncate">
                              {ep.title}
                            </h4>
                            <span className="text-xs font-bold text-gray-300 shrink-0 ml-2">
                              {ep.duration || '60m'}
                            </span>
                          </div>

                          <p className="text-xs sm:text-sm text-gray-400 line-clamp-2 leading-relaxed">
                            {ep.description || 'No description available for this episode.'}
                          </p>
                        </div>

                        {/* Optional Download button */}
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
                            className="p-2 hover:bg-white/10 rounded-full transition-all shrink-0 ml-1"
                            title="Download episode"
                          >
                            {downloading[ep.videoUrl] !== undefined ? (
                              <DownloadProgressRing progress={downloading[ep.videoUrl]} size={22} />
                            ) : downloadedUrls.includes(ep.videoUrl) ? (
                              <CheckIcon className="w-4 h-4 text-green-400" />
                            ) : (
                              <DownloadIcon className="w-4 h-4 text-gray-400 hover:text-white" />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Section 3: More Like This (Recommendations Grid) */}
          <div className="pt-6 border-t border-white/10 space-y-4">
            <h3 className="text-xl sm:text-2xl font-bold text-white">More Like This</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {visibleRecs.map((rec, rIdx) => {
                const recMatch = 50 + ((rIdx * 17 + item.title.length * 7) % 48);
                const isSaved = recWatchlist[rec.id];

                return (
                  <div
                    key={rec.id || `rec-${rIdx}`}
                    onClick={() => {
                      if (onSelectContent) {
                        onSelectContent(rec);
                      } else {
                        onPlayEpisode(rec, 0);
                      }
                    }}
                    className="bg-[#2f2f2f] hover:bg-[#383838] rounded-md overflow-hidden flex flex-col border border-white/5 hover:border-white/20 transition-all cursor-pointer group shadow-lg"
                  >
                    {/* Top Thumbnail */}
                    <div className="relative w-full aspect-video bg-stone-900 overflow-hidden">
                      <img
                        src={rec.backdropUrl || rec.thumbnailUrl}
                        alt={rec.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />
                      {/* Top right season/type badge */}
                      <span className="absolute top-2 right-2 bg-black/80 text-white text-[10px] font-bold px-2 py-0.5 rounded backdrop-blur-sm">
                        {rec.type === 'series' ? '1 Season' : 'Movie'}
                      </span>
                      {/* Title overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#2f2f2f] via-transparent to-transparent flex items-end p-2.5">
                        <span className="text-white font-bold text-sm truncate drop-shadow-md">{rec.title}</span>
                      </div>
                    </div>

                    {/* Card Body Info */}
                    <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-[#46d369] font-bold">{recMatch}% match</span>
                          <span className="border border-white/40 text-gray-300 text-[10px] font-bold px-1 rounded">
                            {rec.rating || 'U/A 12+'}
                          </span>
                          <span className="text-gray-400 font-semibold">{rec.releaseYear || 2024}</span>
                        </div>

                        {/* Add button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRecWatchlist(rec.id);
                          }}
                          className="w-7 h-7 rounded-full border border-white/40 hover:border-white text-white flex items-center justify-center text-xs shrink-0 transition-colors"
                          title={isSaved ? 'Remove' : 'Add to List'}
                        >
                          {isSaved ? <CheckIcon className="w-3.5 h-3.5 text-green-400" /> : <PlusIcon className="w-3.5 h-3.5 text-white" />}
                        </button>
                      </div>

                      <p className="text-xs text-gray-300 line-clamp-3 leading-relaxed">
                        {rec.description || 'An exciting story with unexpected twists and memorable characters.'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Expand Chevron Button */}
            {recommendations.length > 6 && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setShowMoreRecs(!showMoreRecs)}
                  className="w-10 h-10 rounded-full border border-white/30 bg-[#2f2f2f] hover:bg-[#3f3f3f] text-white flex items-center justify-center cursor-pointer transition-all shadow-md active:scale-95"
                  title={showMoreRecs ? 'Show Less' : 'Show More'}
                >
                  <svg
                    className={`w-5 h-5 transition-transform duration-300 ${showMoreRecs ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    viewBox="0 0 24 24"
                  >
                    <path d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Section 4: Detailed Metadata / About Footer */}
          <div className="pt-8 border-t border-white/10 space-y-4 text-xs sm:text-sm text-gray-300">
            <h3 className="text-xl font-bold text-white">
              About <span className="font-black text-white">{item.title}</span>
            </h3>

            <div className="space-y-3 leading-relaxed">
              <div>
                <span className="text-gray-500 font-medium">Creators: </span>
                <span className="text-white/90">Lee Min-su, Choi Jung-mi</span>
              </div>
              <div>
                <span className="text-gray-500 font-medium">Cast: </span>
                <span className="text-white/90">{castString}</span>
              </div>
              <div>
                <span className="text-gray-500 font-medium">Genres: </span>
                <span className="text-white/90">{genresString}</span>
              </div>
              <div>
                <span className="text-gray-500 font-medium">This show is: </span>
                <span className="text-white/90">{vibeTagsString}</span>
              </div>
              <div className="flex flex-wrap items-start gap-2 pt-1">
                <span className="text-gray-500 font-medium">Maturity rating: </span>
                <div className="flex items-center gap-2">
                  <span className="border border-white/40 text-white font-bold text-xs px-1.5 py-0.5 rounded leading-none">
                    {item.rating || 'U/A 13+'}
                  </span>
                  <span className="text-gray-400 text-xs">
                    violence, threat, mature themes, language, tobacco use. Suitable for persons aged 13 and above and under parental guidance.
                  </span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Trailer Modal Overlay */}
      {showTrailerModal && item.trailerUrl && (
        <div className="fixed inset-0 z-[220] bg-black/95 flex items-center justify-center p-4">
          <div className="relative w-full max-w-3xl aspect-video bg-black rounded-2xl overflow-hidden border border-white/20 shadow-2xl">
            <button
              onClick={() => setShowTrailerModal(false)}
              className="absolute top-3 right-3 z-30 w-9 h-9 rounded-full bg-black/80 text-white flex items-center justify-center hover:bg-red-600 transition-colors cursor-pointer"
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
