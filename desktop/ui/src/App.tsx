import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PlayerControls } from "./PlayerControls";
import { QueuePanel } from "./QueuePanel";
import { LyricsPanel } from "./LyricsPanel";
import { Song, usePlayer } from "./usePlayer";

interface SearchSong extends Song {
  album: string | null;
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
  const [songs, setSongs] = useState<SearchSong[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const player = usePlayer(config?.baseUrl ?? null, config?.token ?? null);
  const searchController = useRef<AbortController | null>(null);

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
      try {
        const url = new URL("/search", config.baseUrl);
        url.searchParams.set("q", trimmed);
        url.searchParams.set("t", config.token);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Pencarian gagal (HTTP ${response.status}).`);
        }
        const results = (await response.json()) as SearchSong[];
        setSongs(results);
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
            {songs.map((song, index) => {
              const queued = player.queue.some((queuedSong) => queuedSong.id === song.id);
              return (
                <div className="search-result" role="listitem" key={`${song.id}-${index}`}>
                  <button
                    className={`song-row ${player.selectedSong?.id === song.id ? "selected" : ""}`}
                    onClick={() => player.startFrom(songs, index)}
                    type="button"
                  >
                    <span className="artwork-wrap">
                      {song.thumbnail ? (
                        <img className="artwork" src={song.thumbnail} alt="" />
                      ) : (
                        <span className="artwork artwork-fallback">♫</span>
                      )}
                      <span className="play-overlay">{player.selectedSong?.id === song.id ? "Ⅱ" : "▶"}</span>
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
                  <div className="result-actions">
                    <button type="button" disabled={queued} onClick={() => player.enqueue(song)}>
                      {queued ? "Di antrean" : "Tambah ke antrean"}
                    </button>
                    <button type="button" onClick={() => player.playNext(song)}>Putar berikutnya</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="library-panels">
          <QueuePanel player={player} />
          <LyricsPanel
            config={config}
            song={player.selectedSong}
            currentTime={player.currentTime}
            onSeek={player.seek}
          />
        </div>
      </section>

      <PlayerControls player={player} />
    </main>
  );
}

export default App;
