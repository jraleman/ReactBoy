import { useEffect, useState } from 'react';
import { useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import { applyUpdate, dismissPwaNotice, usePwa } from '../../pwa';
import panel from '../panel/Panel.module.css';
import styles from './UpdateBanner.module.css';

const OFFLINE_NOTICE_MS = 6_000;

/**
 * Offers a downloaded update. It never reloads by itself: the player chooses when, and the
 * game is saved and reopened around the reload.
 */
export function UpdateBanner() {
  const client = useEmulatorClient();
  const { header } = useEmulatorState();
  const { updateReady, offlineReady } = usePwa();
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!offlineReady || updateReady) return;
    const timer = setTimeout(dismissPwaNotice, OFFLINE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [offlineReady, updateReady]);

  if (!updateReady && !offlineReady) return null;
  return (
    <div className={styles.banner} role="status">
      {updateReady ? (
        <>
          <p className={styles.text}>
            A new version of ReactBoy is ready.{' '}
            {header ? 'Your game is saved and reopened when you update.' : ''}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={panel.primary}
              disabled={updating}
              onClick={() => {
                setUpdating(true);
                void applyUpdate(client);
              }}
            >
              {updating ? 'Updating…' : 'Update now'}
            </button>
            <button
              type="button"
              className={panel.button}
              title="The update installs next time you open ReactBoy"
              onClick={dismissPwaNotice}
            >
              Later
            </button>
          </div>
        </>
      ) : (
        <p className={styles.text}>ReactBoy is ready to work offline.</p>
      )}
    </div>
  );
}
