import type { PlayerController } from "./usePlayer";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

interface PlayerControlsProps {
  player: PlayerController;
}

export function PlayerControls({ player }: PlayerControlsProps) {
  const duration = player.duration || player.selectedSong?.durationSec || 0;
  const repeatLabel =
    player.repeat === "all" ? "Ulang semua" : player.repeat === "one" ? "Ulang satu" : "Ulang mati";

  return (
    <footer className="player">
      <div className="now-playing">
        {player.selectedSong?.thumbnail ? (
          <img className="player-artwork" src={player.selectedSong.thumbnail} alt="" />
        ) : (
          <div className="player-artwork player-artwork-empty">♫</div>
        )}
        <div className="now-playing-info">
          <strong>{player.selectedSong?.title ?? "Belum ada lagu diputar"}</strong>
          <span>{player.selectedSong?.artists.join(", ") ?? "Pilih lagu dari hasil pencarian"}</span>
          {player.status === "loading" && <span className="player-status">Memuat stream… byte audio pertama mungkin perlu beberapa detik.</span>}
          {player.status === "ready" && <span className="player-status">Stream siap diputar</span>}
          {player.error && <span className="player-error" role="status">{player.error}</span>}
        </div>
      </div>

      <div className="player-center">
        <div className="transport-controls">
          <button type="button" aria-label="Sebelumnya" title="Sebelumnya" onClick={player.previous} disabled={!player.selectedSong}>|◀</button>
          <button type="button" aria-label={player.status === "playing" ? "Jeda" : "Putar"} title={player.status === "playing" ? "Jeda" : "Putar"} onClick={player.togglePlay} disabled={!player.queue.length}>
            {player.status === "playing" ? "Ⅱ" : "▶"}
          </button>
          <button type="button" aria-label="Berikutnya" title="Berikutnya" onClick={player.next} disabled={!player.selectedSong}>▶|</button>
          <button className={player.shuffle ? "mode-active" : ""} type="button" aria-label="Acak" aria-pressed={player.shuffle} title="Acak" onClick={player.toggleShuffle}>⤨</button>
          <button className={player.repeat !== "off" ? "mode-active" : ""} type="button" aria-label={repeatLabel} aria-pressed={player.repeat !== "off"} title={repeatLabel} onClick={player.cycleRepeat}>
            {player.repeat === "one" ? "↻¹" : "↻"}
          </button>
        </div>
        <div className="seek-controls">
          <span>{formatTime(player.currentTime)}</span>
          <input
            aria-label="Posisi lagu"
            type="range"
            min={0}
            max={Math.max(duration, 0)}
            step={0.1}
            value={Math.min(player.currentTime, duration)}
            onChange={(event) => player.seek(Number(event.currentTarget.value))}
            disabled={!player.selectedSong || duration <= 0}
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="volume-control">
        <label htmlFor="player-volume">Volume</label>
        <input
          id="player-volume"
          aria-label="Volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={player.volume}
          onChange={(event) => player.setVolume(Number(event.currentTarget.value))}
        />
        <audio
          key={player.selectedSong?.id ?? "empty"}
          ref={player.audioRef}
          src={player.src}
          preload="none"
          onLoadStart={player.onLoadStart}
          onWaiting={player.onWaiting}
          onCanPlay={player.onCanPlay}
          onPlaying={player.onPlaying}
          onPause={player.onPause}
          onTimeUpdate={player.onTimeUpdate}
          onError={player.onError}
          onEnded={player.onEnded}
        />
      </div>
    </footer>
  );
}
