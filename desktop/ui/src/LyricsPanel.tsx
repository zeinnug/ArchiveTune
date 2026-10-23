import { useEffect, useRef, useState } from "react";
import type { Song } from "./usePlayer";

interface LyricsConfig {
  baseUrl: string;
  token: string;
}

interface TimedLine {
  timeMs: number;
  text: string;
}

interface LyricsResult {
  synced: TimedLine[] | null;
  plain: string | null;
  source: string;
}

type LyricsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "ready"; result: LyricsResult }
  | { status: "error"; message: string };

interface LyricsPanelProps {
  config: LyricsConfig | null;
  song: Song | null;
  currentTime: number;
  onSeek: (time: number) => void;
}

function isLyricsResult(value: unknown): value is LyricsResult {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const validSynced =
    data.synced === null ||
    (Array.isArray(data.synced) &&
      data.synced.every(
        (line) =>
          line !== null &&
          typeof line === "object" &&
          typeof (line as Record<string, unknown>).timeMs === "number" &&
          Number.isFinite((line as Record<string, unknown>).timeMs) &&
          typeof (line as Record<string, unknown>).text === "string",
      ));
  return (
    validSynced &&
    (data.plain === null || typeof data.plain === "string") &&
    typeof data.source === "string"
  );
}

export function LyricsPanel({ config, song, currentTime, onSeek }: LyricsPanelProps) {
  const [lyrics, setLyrics] = useState<LyricsState>({ status: "idle" });
  const lyricsScrollRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLButtonElement>(null);
  const synced = lyrics.status === "ready" ? lyrics.result.synced : null;
  const activeIndex =
    synced && synced.length > 0
      ? synced.reduce(
          (active, line, index) => (line.timeMs <= currentTime * 1000 ? index : active),
          -1,
        )
      : -1;

  useEffect(() => {
    if (!song || !config) {
      setLyrics({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setLyrics({ status: "loading" });
    const url = new URL("/lyrics", config.baseUrl);
    url.searchParams.set("title", song.title);
    url.searchParams.set("artist", song.artists.join(", "));
    url.searchParams.set("t", config.token);
    if (song.album) url.searchParams.set("album", song.album);
    if (song.durationSec !== null) {
      url.searchParams.set("durationSec", String(song.durationSec));
    }

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setLyrics({ status: "not-found" });
          return;
        }
        if (!response.ok) {
          let detail = "";
          try {
            const body: unknown = await response.json();
            if (body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string") {
              detail = ` ${(body as Record<string, string>).error}`;
            }
          } catch {
            detail = "";
          }
          throw new Error(`Lirik gagal dimuat (HTTP ${response.status}).${detail}`);
        }
        const payload: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (!isLyricsResult(payload)) throw new Error("Format respons lirik tidak valid.");
        if (!payload.synced?.length && !payload.plain?.trim()) {
          setLyrics({ status: "not-found" });
          return;
        }
        setLyrics({ status: "ready", result: payload });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLyrics({
          status: "error",
          message: error instanceof Error ? error.message : "Terjadi kesalahan saat memuat lirik.",
        });
      }
    })();

    return () => controller.abort();
  }, [config, song?.id]);

  useEffect(() => {
    const container = lyricsScrollRef.current;
    const activeLine = activeLineRef.current;
    if (!container || !activeLine || activeIndex < 0) return;
    const target =
      activeLine.offsetTop -
      (container.clientHeight - activeLine.clientHeight) / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeIndex, lyrics.status]);

  return (
    <section className="lyrics-section" aria-labelledby="lyrics-heading">
      <div className="results-heading lyrics-heading">
        <h2 id="lyrics-heading">Lirik</h2>
        {song && <span>{song.title}</span>}
      </div>
      <div className="lyrics-content" aria-live="polite">
        {lyrics.status === "idle" && <p className="lyrics-message">Pilih lagu untuk mencari lirik.</p>}
        {lyrics.status === "loading" && <p className="lyrics-message">Memuat lirik…</p>}
        {lyrics.status === "not-found" && <p className="lyrics-message">Lirik tidak ditemukan.</p>}
        {lyrics.status === "error" && <p className="lyrics-message error" role="alert">{lyrics.message}</p>}
        {lyrics.status === "ready" && lyrics.result.synced && lyrics.result.synced.length > 0 && (
          <div className="lyrics-scroll" ref={lyricsScrollRef}>
            <div className="synced-lyrics">
              {lyrics.result.synced.map((line, index) => (
                <button
                  className={`lyric-line ${index === activeIndex ? "active" : ""} ${line.text ? "" : "lyric-break"}`}
                  key={`${line.timeMs}-${index}`}
                  ref={index === activeIndex ? activeLineRef : null}
                  type="button"
                  aria-current={index === activeIndex ? "true" : undefined}
                  aria-label={line.text || "Jeda lirik"}
                  onClick={() => onSeek(line.timeMs / 1000)}
                >
                  {line.text || "\u00a0"}
                </button>
              ))}
            </div>
          </div>
        )}
        {lyrics.status === "ready" && (!lyrics.result.synced || lyrics.result.synced.length === 0) && lyrics.result.plain && (
          <div className="lyrics-scroll plain-lyrics">
            <p className="plain-lyrics-label">Lirik tidak tersinkron</p>
            <div>{lyrics.result.plain}</div>
          </div>
        )}
      </div>
    </section>
  );
}
