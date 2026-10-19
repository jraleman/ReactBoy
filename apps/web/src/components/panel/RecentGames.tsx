import { useId } from 'react';
import { formatPlayed } from '../../format';
import { useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import styles from './Panel.module.css';

/** Games stored on this device, for one-click relaunch. */
export function RecentGames() {
  const client = useEmulatorClient();
  const { recent, gameId } = useEmulatorState();
  const id = useId();
  if (recent.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby={`${id}-recent`}>
      <h2 id={`${id}-recent`} className={styles.heading}>
        Recent games
      </h2>
      <ul className={styles.recent}>
        {recent.map((game) => {
          const playing = game.id === gameId;
          return (
            <li key={game.id} className={styles.recentItem}>
              <button
                type="button"
                className={styles.recentGame}
                disabled={playing}
                onClick={() => void client.loadRecent(game.id)}
              >
                <span className={styles.recentTitle}>{game.title}</span>
                <span className={styles.recentMeta}>
                  {playing ? 'Playing now' : formatPlayed(game.lastPlayed)}
                </span>
              </button>
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${game.title} from this device`}
                title="Remove from this device"
                onClick={() => void client.removeRecent(game.id)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.note}>Removing a game keeps its saves for when you load it again.</p>
    </section>
  );
}
