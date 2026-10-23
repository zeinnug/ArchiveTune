import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

export interface Song {
  id: string;
  title: string;
  artists: string[];
  album?: string | null;
  thumbnail: string | null;
  durationSec: number | null;
}

export type RepeatMode = "off" | "all" | "one";
export type PlayerStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

interface PlayerState {
  queue: Song[];
  index: number | null;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  status: PlayerStatus;
  error: string;
  currentTime: number;
  duration: number;
  playRequest: number;
}

type PlayerAction =
  | { type: "start"; songs: Song[]; index: number }
  | { type: "enqueue"; song: Song }
  | { type: "play-next"; song: Song }
  | { type: "remove"; index: number }
  | { type: "move"; from: number; to: number }
  | { type: "navigate"; index: number; autoplay: boolean }
  | { type: "clear-selection" }
  | { type: "shuffle"; enabled: boolean; queue: Song[] }
  | { type: "repeat"; repeat: RepeatMode }
  | { type: "volume"; volume: number }
  | { type: "status"; status: PlayerStatus; error?: string }
  | { type: "time"; currentTime: number }
  | { type: "duration"; duration: number };

const STORAGE_KEY = "archivetune-player-v1";
const SONG_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function currentSong(queue: Song[], index: number | null): Song | null {
  return index === null ? null : queue[index] ?? null;
}

function readSavedState(): Pick<PlayerState, "queue" | "index" | "shuffle" | "repeat" | "volume"> | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return null;

    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== "object") throw new Error("data bukan object");
    const data = value as Record<string, unknown>;
    if (
      data.version !== 1 ||
      !Array.isArray(data.queue) ||
      (data.index !== null && (!Number.isInteger(data.index) || (data.index as number) < 0)) ||
      typeof data.shuffle !== "boolean" ||
      !["off", "all", "one"].includes(String(data.repeat)) ||
      typeof data.volume !== "number" ||
      !Number.isFinite(data.volume) ||
      data.volume < 0 ||
      data.volume > 1
    ) {
      throw new Error("format tidak didukung");
    }

    const queue = data.queue.map((entry): Song => {
      if (!entry || typeof entry !== "object") throw new Error("metadata lagu tidak valid");
      const song = entry as Record<string, unknown>;
      if (
        typeof song.id !== "string" ||
        !SONG_ID_PATTERN.test(song.id) ||
        typeof song.title !== "string" ||
        song.title.trim().length === 0 ||
        !Array.isArray(song.artists) ||
        !song.artists.every((artist) => typeof artist === "string") ||
        (song.thumbnail !== null &&
          (typeof song.thumbnail !== "string" ||
            !song.thumbnail.startsWith("https://"))) ||
        (song.durationSec !== null &&
          (typeof song.durationSec !== "number" ||
            !Number.isFinite(song.durationSec) ||
            song.durationSec < 0))
      ) {
        throw new Error("metadata lagu tidak valid");
      }
      return {
        id: song.id,
        title: song.title,
        artists: song.artists,
        thumbnail: song.thumbnail,
        durationSec: song.durationSec,
      };
    });

    if (
      new Set(queue.map((song) => song.id)).size !== queue.length ||
      (data.index !== null && (data.index as number) >= queue.length) ||
      (queue.length === 0 && data.index !== null)
    ) {
      throw new Error("indeks atau antrean tidak valid");
    }

    return {
      queue,
      index: data.index as number | null,
      shuffle: data.shuffle,
      repeat: data.repeat as RepeatMode,
      volume: data.volume,
    };
  } catch (error) {
    console.warn("Data pemutar tersimpan tidak dapat dipulihkan; memulai dengan antrean kosong.", error);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (removeError) {
      console.warn("Data pemutar yang rusak tidak dapat dihapus dari localStorage.", removeError);
    }
    return null;
  }
}

function createInitialState(): PlayerState {
  const saved = readSavedState();
  return {
    queue: saved?.queue ?? [],
    index: saved?.index ?? null,
    shuffle: saved?.shuffle ?? false,
    repeat: saved?.repeat ?? "off",
    volume: saved?.volume ?? 1,
    status: saved?.index === null || saved === null ? "idle" : "paused",
    error: "",
    currentTime: 0,
    duration: 0,
    playRequest: 0,
  };
}

function reducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "start": {
      const queue = action.songs.filter(
        (song, index, allSongs) => allSongs.findIndex((item) => item.id === song.id) === index,
      );
      const requestedSong = action.songs[action.index];
      const index = requestedSong
        ? queue.findIndex((song) => song.id === requestedSong.id)
        : -1;
      return {
        ...state,
        queue,
        index: index >= 0 ? index : null,
        status: index >= 0 ? "loading" : "idle",
        error: "",
        currentTime: 0,
        duration: 0,
        playRequest: state.playRequest + 1,
      };
    }
    case "enqueue": {
      if (state.queue.some((song) => song.id === action.song.id)) return state;
      const queue = [...state.queue, action.song];
      return { ...state, queue, index: state.index ?? 0 };
    }
    case "play-next": {
      const active = currentSong(state.queue, state.index);
      if (active?.id === action.song.id) return state;
      const queue = state.queue.filter((song) => song.id !== action.song.id);
      const activeIndex = active ? queue.findIndex((song) => song.id === active.id) : -1;
      const insertAt = activeIndex < 0 ? 0 : activeIndex + 1;
      queue.splice(insertAt, 0, action.song);
      const index = active ? queue.findIndex((song) => song.id === active.id) : 0;
      return {
        ...state,
        queue,
        index,
        status: active ? state.status : "loading",
        error: "",
        currentTime: active ? state.currentTime : 0,
        duration: active ? state.duration : 0,
        playRequest: active ? state.playRequest : state.playRequest + 1,
      };
    }
    case "remove": {
      if (action.index < 0 || action.index >= state.queue.length) return state;
      const removedActive = action.index === state.index;
      const queue = state.queue.filter((_, index) => index !== action.index);
      if (queue.length === 0) {
        return {
          ...state,
          queue,
          index: null,
          status: "idle",
          error: "",
          currentTime: 0,
          duration: 0,
        };
      }
      const index =
        state.index === null
          ? null
          : removedActive
            ? Math.min(action.index, queue.length - 1)
            : action.index < state.index
              ? state.index - 1
              : state.index;
      return {
        ...state,
        queue,
        index,
        status: removedActive ? "loading" : state.status,
        error: removedActive ? "" : state.error,
        currentTime: removedActive ? 0 : state.currentTime,
        duration: removedActive ? 0 : state.duration,
        playRequest: removedActive && index !== null ? state.playRequest + 1 : state.playRequest,
      };
    }
    case "move": {
      if (
        action.from < 0 ||
        action.from >= state.queue.length ||
        action.to < 0 ||
        action.to >= state.queue.length ||
        action.from === action.to
      ) {
        return state;
      }
      const activeId = currentSong(state.queue, state.index)?.id;
      const queue = [...state.queue];
      const [song] = queue.splice(action.from, 1);
      queue.splice(action.to, 0, song);
      return {
        ...state,
        queue,
        index: activeId ? queue.findIndex((item) => item.id === activeId) : null,
      };
    }
    case "navigate":
      return {
        ...state,
        index: action.index,
        status: action.autoplay ? "loading" : "paused",
        error: "",
        currentTime: 0,
        duration: 0,
        playRequest: action.autoplay ? state.playRequest + 1 : state.playRequest,
      };
    case "clear-selection":
      return {
        ...state,
        index: null,
        status: "idle",
        error: "",
        currentTime: 0,
        duration: 0,
      };
    case "shuffle":
      return {
        ...state,
        shuffle: action.enabled,
        queue: action.queue,
        index: currentSong(state.queue, state.index)
          ? action.queue.findIndex((song) => song.id === currentSong(state.queue, state.index)?.id)
          : null,
      };
    case "repeat":
      return { ...state, repeat: action.repeat };
    case "volume":
      return { ...state, volume: action.volume };
    case "status":
      return {
        ...state,
        status: action.status,
        error: action.error ?? (action.status === "error" ? state.error : ""),
      };
    case "time":
      return { ...state, currentTime: action.currentTime };
    case "duration":
      return { ...state, duration: action.duration };
  }
}

function shuffledQueue(queue: Song[], activeIndex: number | null): Song[] {
  const active = currentSong(queue, activeIndex);
  const remaining = queue.filter((song) => song.id !== active?.id);
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
  }
  if (!active) return remaining;
  return [active, ...remaining];
}

export function usePlayer(baseUrl: string | null, token: string | null) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stateRef = useRef(state);
  const activeSongRef = useRef(currentSong(state.queue, state.index));
  const failureCountRef = useRef(0);
  const failedIdsRef = useRef(new Set<string>());
  const failedTrackRef = useRef<string | null>(null);
  const failureTimerRef = useRef<number | undefined>(undefined);

  stateRef.current = state;
  activeSongRef.current = currentSong(state.queue, state.index);
  const selectedSong = currentSong(state.queue, state.index);
  const src =
    selectedSong && baseUrl && token
      ? `${baseUrl}/stream/${encodeURIComponent(selectedSong.id)}?t=${encodeURIComponent(token)}`
      : undefined;

  const isCurrentAudioEvent = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    return event.currentTarget === audioRef.current && activeSongRef.current !== null;
  }, []);

  const clearFailureTimer = useCallback(() => {
    if (failureTimerRef.current !== undefined) {
      window.clearTimeout(failureTimerRef.current);
      failureTimerRef.current = undefined;
    }
  }, []);

  const resetFailureRun = useCallback(() => {
    failureCountRef.current = 0;
    failedIdsRef.current.clear();
    failedTrackRef.current = null;
    clearFailureTimer();
  }, [clearFailureTimer]);

  const requestTrack = useCallback(
    (index: number, autoplay: boolean, resetFailures = true) => {
      if (resetFailures) resetFailureRun();
      dispatch({ type: "navigate", index, autoplay });
    },
    [resetFailureRun],
  );

  const navigateNext = useCallback(
    (afterFailure = false) => {
      const current = stateRef.current;
      const active = currentSong(current.queue, current.index);
      if (!active || current.index === null) return;
      const nextIndex =
        current.index + 1 < current.queue.length
          ? current.index + 1
          : current.repeat === "all"
            ? 0
            : null;
      if (nextIndex === null) {
        if (!afterFailure) resetFailureRun();
        audioRef.current?.pause();
        dispatch({ type: "status", status: afterFailure ? "error" : "paused", error: afterFailure ? current.error : "" });
        return;
      }
      requestTrack(nextIndex, true, !afterFailure);
    },
    [requestTrack, resetFailureRun],
  );

  const handleFailure = useCallback(
    (song: Song, message: string, audio: HTMLAudioElement) => {
      if (
        audio !== audioRef.current ||
        activeSongRef.current?.id !== song.id ||
        failedTrackRef.current === song.id
      ) {
        return;
      }
      failedTrackRef.current = song.id;
      failureCountRef.current += 1;
      failedIdsRef.current.add(song.id);
      dispatch({ type: "status", status: "error", error: `Gagal memutar “${song.title}”: ${message}` });
      clearFailureTimer();
      failureTimerRef.current = window.setTimeout(() => {
        failureTimerRef.current = undefined;
        if (audioRef.current !== audio || activeSongRef.current?.id !== song.id) return;
        const current = stateRef.current;
        const allTracksFailed = failedIdsRef.current.size >= current.queue.length;
        if (failureCountRef.current >= 3 || allTracksFailed) {
          audio.pause();
          dispatch({
            type: "status",
            status: "error",
            error: allTracksFailed
              ? "Semua lagu dalam antrean gagal diputar. Pemutaran dihentikan."
              : "Tiga lagu berturut-turut gagal diputar. Pemutaran dihentikan.",
          });
          return;
        }
        navigateNext(true);
      }, 2000);
    },
    [clearFailureTimer, navigateNext],
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          queue: state.queue.map(({ id, title, artists, thumbnail, durationSec }) => ({
            id,
            title,
            artists,
            thumbnail,
            durationSec,
          })),
          index: state.index,
          volume: state.volume,
          repeat: state.repeat,
          shuffle: state.shuffle,
        }),
      );
    } catch (error) {
      console.warn("Setelan pemutar tidak dapat disimpan di localStorage.", error);
    }
  }, [state.index, state.queue, state.repeat, state.shuffle, state.volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = state.volume;
  }, [selectedSong?.id, state.volume]);

  useEffect(() => {
    if (state.playRequest === 0) return;
    const audio = audioRef.current;
    const song = activeSongRef.current;
    if (!audio || !song || !src) return;
    dispatch({ type: "status", status: "loading" });
    audio.load();
    void audio.play().catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Peramban tidak dapat memulai pemutaran.";
      handleFailure(song, message, audio);
    });
  }, [handleFailure, src, state.playRequest]);

  useEffect(
    () => () => {
      clearFailureTimer();
    },
    [clearFailureTimer],
  );

  useEffect(() => {
    if (!selectedSong || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if ("MediaMetadata" in window) {
      session.metadata = new MediaMetadata({
        title: selectedSong.title,
        artist: selectedSong.artists.join(", "),
        artwork: selectedSong.thumbnail
          ? [{ src: selectedSong.thumbnail, sizes: "120x120" }]
          : [],
      });
    }

    const setHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        session.setActionHandler(action, handler);
      } catch (error) {
        console.warn(`Media Session tidak mendukung aksi ${action}.`, error);
      }
    };
    setHandler("play", () => void play());
    setHandler("pause", pause);
    setHandler("nexttrack", () => next());
    setHandler("previoustrack", () => previous());
    setHandler("seekto", (details) => {
      if (details.seekTime !== undefined) seek(details.seekTime);
    });
    setHandler("seekbackward", (details) => seek(Math.max(0, stateRef.current.currentTime - (details.seekOffset ?? 10))));
    setHandler("seekforward", (details) => seek(Math.min(stateRef.current.duration, stateRef.current.currentTime + (details.seekOffset ?? 10))));

    return () => {
      session.metadata = null;
      for (const action of ["play", "pause", "nexttrack", "previoustrack", "seekto", "seekbackward", "seekforward"] as MediaSessionAction[]) {
        setHandler(action, null);
      }
    };
  }, [selectedSong?.id]);

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session || state.duration <= 0 || !Number.isFinite(state.duration)) return;
    try {
      session.setPositionState({
        duration: state.duration,
        playbackRate: audioRef.current?.playbackRate ?? 1,
        position: Math.min(state.currentTime, state.duration),
      });
    } catch {
      return;
    }
  }, [state.currentTime, state.duration]);

  useEffect(() => {
    if (!navigator.mediaSession) return;
    navigator.mediaSession.playbackState =
      state.status === "playing" ? "playing" : state.status === "paused" ? "paused" : "none";
  }, [state.status]);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!activeSongRef.current) {
      if (stateRef.current.queue.length === 0) return;
      requestTrack(0, true);
      return;
    }
    clearFailureTimer();
    failedTrackRef.current = null;
    dispatch({ type: "status", status: "loading" });
    try {
      await audio.play();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Peramban tidak dapat memulai pemutaran.";
      handleFailure(activeSongRef.current, message, audio);
    }
  }, [clearFailureTimer, handleFailure, requestTrack]);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const togglePlay = useCallback(() => {
    if (audioRef.current?.paused) void play();
    else pause();
  }, [pause, play]);

  const next = useCallback(() => {
    navigateNext();
  }, [navigateNext]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    const current = stateRef.current;
    if (!currentSong(current.queue, current.index) || current.index === null) return;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      dispatch({ type: "time", currentTime: 0 });
      return;
    }
    const previousIndex =
      current.index > 0
        ? current.index - 1
        : current.repeat === "all"
          ? current.queue.length - 1
          : null;
    if (previousIndex !== null) requestTrack(previousIndex, true);
    else if (audio) audio.currentTime = 0;
  }, [requestTrack]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    audio.currentTime = Math.max(0, Math.min(time, Number.isFinite(audio.duration) ? audio.duration : time));
  }, []);

  const startFrom = useCallback(
    (songs: Song[], index: number) => {
      resetFailureRun();
      dispatch({ type: "start", songs, index });
    },
    [resetFailureRun],
  );

  const enqueue = useCallback((song: Song) => dispatch({ type: "enqueue", song }), []);
  const playNext = useCallback((song: Song) => dispatch({ type: "play-next", song }), []);
  const remove = useCallback(
    (index: number) => {
      if (index === stateRef.current.index) resetFailureRun();
      dispatch({ type: "remove", index });
    },
    [resetFailureRun],
  );
  const move = useCallback((from: number, to: number) => dispatch({ type: "move", from, to }), []);
  const toggleShuffle = useCallback(() => {
    const current = stateRef.current;
    const enabled = !current.shuffle;
    dispatch({
      type: "shuffle",
      enabled,
      queue: enabled ? shuffledQueue(current.queue, current.index) : current.queue,
    });
  }, []);
  const cycleRepeat = useCallback(() => {
    const modes: RepeatMode[] = ["off", "all", "one"];
    const currentIndex = modes.indexOf(stateRef.current.repeat);
    dispatch({ type: "repeat", repeat: modes[(currentIndex + 1) % modes.length] });
  }, []);
  const setVolume = useCallback((volume: number) => {
    dispatch({ type: "volume", volume: Math.max(0, Math.min(1, volume)) });
  }, []);

  const onLoadStart = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (isCurrentAudioEvent(event)) dispatch({ type: "status", status: "loading" });
  }, [isCurrentAudioEvent]);
  const onWaiting = onLoadStart;
  const onCanPlay = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!isCurrentAudioEvent(event)) return;
    if (stateRef.current.status === "loading") dispatch({ type: "status", status: "ready" });
    if (Number.isFinite(event.currentTarget.duration)) {
      dispatch({ type: "duration", duration: event.currentTarget.duration });
    }
  }, [isCurrentAudioEvent]);
  const onPlaying = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!isCurrentAudioEvent(event)) return;
    resetFailureRun();
    dispatch({ type: "status", status: "playing" });
  }, [isCurrentAudioEvent, resetFailureRun]);
  const onPause = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!isCurrentAudioEvent(event) || event.currentTarget.ended) return;
    dispatch({ type: "status", status: "paused" });
  }, [isCurrentAudioEvent]);
  const onTimeUpdate = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!isCurrentAudioEvent(event)) return;
    dispatch({ type: "time", currentTime: event.currentTarget.currentTime });
    if (Number.isFinite(event.currentTarget.duration)) {
      dispatch({ type: "duration", duration: event.currentTarget.duration });
    }
  }, [isCurrentAudioEvent]);
  const onError = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!isCurrentAudioEvent(event)) return;
    const song = activeSongRef.current;
    if (!song) return;
    const mediaError = event.currentTarget.error;
    const detail = mediaError?.message || (mediaError ? `kesalahan media ${mediaError.code}` : "stream tidak tersedia");
    handleFailure(song, detail, event.currentTarget);
  }, [handleFailure, isCurrentAudioEvent]);
  const onEnded = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!isCurrentAudioEvent(event)) return;
    const current = stateRef.current;
    if (current.repeat === "one") {
      event.currentTarget.currentTime = 0;
      dispatch({ type: "time", currentTime: 0 });
      void event.currentTarget.play().catch((error: unknown) => {
        const song = activeSongRef.current;
        if (!song) return;
        handleFailure(song, error instanceof Error ? error.message : "Pemutaran ulang gagal.", event.currentTarget);
      });
      return;
    }
    resetFailureRun();
    navigateNext();
  }, [handleFailure, isCurrentAudioEvent, navigateNext, resetFailureRun]);

  return useMemo(
    () => ({
      audioRef,
      src,
      queue: state.queue,
      index: state.index,
      selectedSong,
      shuffle: state.shuffle,
      repeat: state.repeat,
      volume: state.volume,
      status: state.status,
      error: state.error,
      currentTime: state.currentTime,
      duration: state.duration,
      startFrom,
      enqueue,
      playNext,
      remove,
      move,
      next,
      previous,
      play,
      pause,
      togglePlay,
      toggleShuffle,
      cycleRepeat,
      setVolume,
      seek,
      onLoadStart,
      onWaiting,
      onCanPlay,
      onPlaying,
      onPause,
      onTimeUpdate,
      onError,
      onEnded,
    }),
    [
      cycleRepeat,
      enqueue,
      move,
      next,
      onCanPlay,
      onEnded,
      onError,
      onLoadStart,
      onPause,
      onPlaying,
      onTimeUpdate,
      onWaiting,
      pause,
      play,
      playNext,
      previous,
      remove,
      seek,
      selectedSong,
      setVolume,
      src,
      startFrom,
      state,
      togglePlay,
      toggleShuffle,
    ],
  );
}

export type PlayerController = ReturnType<typeof usePlayer>;
