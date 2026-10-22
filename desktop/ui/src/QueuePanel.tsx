import type { PlayerController } from "./usePlayer";

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

interface QueuePanelProps {
  player: PlayerController;
}

export function QueuePanel({ player }: QueuePanelProps) {
  return (
    <section className="queue-section" aria-labelledby="queue-heading">
      <div className="results-heading queue-heading">
        <h2 id="queue-heading">Antrean putar</h2>
        <span>{player.queue.length} lagu</span>
      </div>
      {player.queue.length === 0 ? (
        <div className="queue-empty">Antrean masih kosong. Tambahkan lagu dari hasil pencarian.</div>
      ) : (
        <ol className="queue-list">
          {player.queue.map((song, index) => (
            <li className={`queue-row ${index === player.index ? "selected" : ""}`} key={song.id}>
              <span className="queue-number">{index + 1}</span>
              {song.thumbnail ? <img className="queue-artwork" src={song.thumbnail} alt="" /> : <span className="queue-artwork queue-artwork-empty">♫</span>}
              <span className="song-info">
                <span className="song-title">{song.title}</span>
                <span className="song-artists">{song.artists.join(", ")}</span>
              </span>
              <span className="song-duration">{formatDuration(song.durationSec)}</span>
              <div className="queue-actions">
                <button type="button" aria-label={`Naikkan ${song.title}`} title="Naikkan" disabled={index === 0} onClick={() => player.move(index, index - 1)}>↑</button>
                <button type="button" aria-label={`Turunkan ${song.title}`} title="Turunkan" disabled={index === player.queue.length - 1} onClick={() => player.move(index, index + 1)}>↓</button>
                <button type="button" aria-label={`Hapus ${song.title} dari antrean`} title="Hapus dari antrean" onClick={() => player.remove(index)}>×</button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
