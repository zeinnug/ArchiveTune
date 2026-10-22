import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

interface Song {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationSec: number | null;
  thumbnail: string | null;
  explicit: boolean;
}

interface ApiConfig {
  baseUrl: string;
  token: string;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function App() {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const [serverError, setServerError] = useState("");
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [playbackError, setPlaybackError] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const searchController = useRef<AbortController | null>(null);
  const selectedSong = selectedIndex === null ? null : songs[selectedIndex] ?? null;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    async function checkServer() {
      try {
        const nextConfig = await window.archiveTune.getConfig();
        if (cancelled) return;
        setConfig(nextConfig);
        const response = await fetch(`${nextConfig.baseUrl}/health?t=${encodeURIComponent(nextConfig.token)}`);
        if (!response.ok) throw new Error(`Server menjawab HTTP ${response.status}.`);
        if (cancelled) return;
        setServerReady(true);
        setServerError("");
      } catch (error) {
        if (cancelled) return;
        attempts += 1;
        if (attempts >= 60) {
          setServerError(
            error instanceof Error
              ? `Server tidak dapat dimulai: ${error.message}`
              : "Server tidak dapat dimulai.",
          );
          return;
        }
        timer = window.setTimeout(checkServer, 750);
      }
    }

    void checkServer();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      searchController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!config || selectedSong === null) return;
    const audio = audioRef.current;
    if (!audio) return;
    setPlaybackError("");
    audio.load();
    void audio.play().catch((error: unknown) => {
      setPlaybackError(
        error instanceof Error ? `Pemutaran gagal: ${error.message}` : "Pemutaran gagal dimulai.",
      );
    });
  }, [config, selectedSong?.id]);

  const search = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!config || !serverReady) return;
      const trimmed = query.trim();
      if (!trimmed) {
        setSearchError("Masukkan kata kunci pencarian.");
        return;
      }

      searchController.current?.abort();
      const controller = new AbortController();
      searchController.current = controller;
      setSearching(true);
      setSearchError("");
      setPlaybackError("");
      try {
        const url = new URL("/search", config.baseUrl);
        url.searchParams.set("q", trimmed);
        url.searchParams.set("t", config.token);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Pencarian gagal (HTTP ${response.status}).`);
        }
        const results = (await response.json()) as Song[];
        setSongs(results);
        setSelectedIndex(null);
        if (results.length === 0) setSearchError("Tidak ada lagu yang ditemukan.");
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchError(
          error instanceof Error ? error.message : "Pencarian gagal karena kesalahan jaringan.",
        );
      } finally {
        if (searchController.current === controller) {
          searchController.current = null;
          setSearching(false);
        }
      }
    },
    [config, query, serverReady],
  );

  function playAt(index: number) {
    setSelectedIndex(index);
    setPlaybackError("");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="ArchiveTune Desktop">
          <span className="brand-mark">A</span>
          <span>ArchiveTune</span>
        </a>
        <div className={`server-status ${serverReady ? "ready" : "starting"}`} role="status">
          <span className="status-dot" />
          {serverReady ? "server siap" : serverError || "server sedang dimulai"}
        </div>
      </header>

      <section className="content">
        <div className="heading">
          <p className="eyebrow">MUSIC LIBRARY</p>
          <h1>Temukan musik.</h1>
          <p className="subtitle">Cari lagu dari YouTube Music dan dengarkan di desktop.</p>
        </div>

        <form className="search-form" onSubmit={search}>
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            aria-label="Cari lagu"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari lagu, artis, atau album"
            disabled={!serverReady}
          />
          <button type="submit" disabled={!serverReady || searching}>
            {searching ? "Mencari…" : "Cari"}
          </button>
        </form>

        {searchError && <p className="message error" role="alert">{searchError}</p>}
        {playbackError && <p className="message error" role="alert">{playbackError}</p>}

        <div className="results-heading">
          <h2>Hasil pencarian</h2>
          {songs.length > 0 && <span>{songs.length} lagu</span>}
        </div>

        {songs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">♫</div>
            <p>{serverReady ? "Cari sesuatu untuk mulai mendengarkan." : "Menghubungkan ke server lokal…"}</p>
          </div>
        ) : (
          <div className="song-list" role="list">
            {songs.map((song, index) => (
              <button
                className={`song-row ${index === selectedIndex ? "selected" : ""}`}
                key={`${song.id}-${index}`}
                onClick={() => playAt(index)}
                role="listitem"
                type="button"
              >
                <span className="artwork-wrap">
                  {song.thumbnail ? (
                    <img className="artwork" src={song.thumbnail} alt="" />
                  ) : (
                    <span className="artwork artwork-fallback">♫</span>
                  )}
                  <span className="play-overlay">{index === selectedIndex ? "Ⅱ" : "▶"}</span>
                </span>
                <span className="song-info">
                  <span className="song-title">
                    {song.title}
                    {song.explicit && <span className="explicit-badge">E</span>}
                  </span>
                  <span className="song-artists">{song.artists.join(", ")}</span>
                </span>
                <span className="song-album">{song.album ?? ""}</span>
                <span className="song-duration">{formatDuration(song.durationSec)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <footer className="player">
        <div className="now-playing">
          {selectedSong?.thumbnail ? (
            <img className="player-artwork" src={selectedSong.thumbnail} alt="" />
          ) : (
            <div className="player-artwork player-artwork-empty">♫</div>
          )}
          <div className="now-playing-info">
            <strong>{selectedSong?.title ?? "Belum ada lagu diputar"}</strong>
            <span>{selectedSong?.artists.join(", ") ?? "Pilih lagu dari hasil pencarian"}</span>
          </div>
        </div>
        <div className="audio-controls">
          <audio
            ref={audioRef}
            controls
            preload="none"
            src={
              selectedSong && config
                ? `${config.baseUrl}/stream/${encodeURIComponent(selectedSong.id)}?t=${encodeURIComponent(config.token)}`
                : undefined
            }
            onEnded={() => {
              if (selectedIndex !== null && selectedIndex + 1 < songs.length) {
                setSelectedIndex(selectedIndex + 1);
              } else {
                setSelectedIndex(null);
              }
            }}
            onError={() => {
              if (selectedSong) {
                setPlaybackError(`Tidak dapat memutar “${selectedSong.title}”. Periksa koneksi server dan coba lagi.`);
              }
            }}
          />
        </div>
        <div className="player-spacer" />
      </footer>
    </main>
  );
}

export default App;
