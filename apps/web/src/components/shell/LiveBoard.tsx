import { useEffect, useMemo, type CSSProperties } from 'react';
import { useBusActivity, useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import { boardActivity } from './activity';
import { Board } from './Board';
import styles from './GameBoyShell.module.css';

/**
 * The board, lit by what the game is doing: watches the machine's activity while shown and
 * hands it to the (static) board drawing as custom properties, so only this wrapper
 * re-renders ~10 times a second.
 */
export function LiveBoard() {
  const client = useEmulatorClient();
  const { status } = useEmulatorState();
  const report = useBusActivity();

  useEffect(() => client.watchActivity(), [client]);

  const activity = useMemo(() => boardActivity(status, report), [status, report]);
  const vars = Object.fromEntries(
    Object.entries(activity).map(([name, level]) => [`--${name}`, level.toFixed(2)]),
  ) as CSSProperties;

  return (
    <div className={styles.live} data-running={status === 'running' || undefined} style={vars}>
      <Board />
    </div>
  );
}
