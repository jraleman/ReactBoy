import { useId, useRef } from 'react';
import type { CartridgeHeader } from '@reactboy/core';
import { formatSaved } from '../../format';
import { useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import { MANUAL_SLOTS } from '../../storage/store';
import styles from './Panel.module.css';

/** File names can't hold every title character on every system. */
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, '_')}.sav`;

function download(data: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save-state slots for the loaded game, plus .sav export/import for battery-backed carts. */
export function SaveSlots({ header }: { header: CartridgeHeader }) {
  const client = useEmulatorClient();
  const { slots, persistent } = useEmulatorState();
  const importInput = useRef<HTMLInputElement>(null);
  const id = useId();

  return (
    <section className={styles.section} aria-labelledby={`${id}-saves`}>
      <h2 id={`${id}-saves`} className={styles.heading}>
        Save states
      </h2>
      <ol className={styles.slots}>
        {MANUAL_SLOTS.map((slot) => {
          const info = slots.find((s) => s.slot === slot);
          const when = info && formatSaved(info.created);
          return (
            <li key={slot} className={styles.slot}>
              <div className={styles.slotPreview} aria-hidden="true">
                {info?.thumbnail ? (
                  <img src={info.thumbnail} alt="" width={160} height={144} />
                ) : (
                  <span>{slot}</span>
                )}
              </div>
              <p className={styles.slotLabel}>
                Slot {slot}
                <span className={styles.slotTime}>{when ?? 'Empty'}</span>
              </p>
              <div className={styles.slotActions}>
                <button
                  type="button"
                  className={styles.small}
                  aria-label={`Save to slot ${slot}`}
                  onClick={() => void client.saveState(slot)}
                >
                  Save
                </button>
                <button
                  type="button"
                  className={styles.small}
                  disabled={!info}
                  aria-label={info ? `Load slot ${slot}, saved ${when}` : `Slot ${slot} is empty`}
                  onClick={() => void client.loadState(slot)}
                >
                  Load
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {header.hasBattery && (
        <div className={styles.row}>
          <button
            type="button"
            className={styles.button}
            onClick={async () => {
              const data = await client.exportBattery();
              if (data) download(data, fileName(header.title));
            }}
          >
            Download save
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => importInput.current?.click()}
          >
            Import save
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".sav,.srm,application/octet-stream"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              const replace = `Replace the in-game save of ${header.title} with this file? The game restarts.`;
              if (file && window.confirm(replace)) void client.importBattery(file);
            }}
          />
        </div>
      )}
      <p className={styles.note}>
        {persistent === false
          ? 'This browser isn’t keeping site data, so saves last only until you close the page.'
          : header.hasBattery
            ? 'In-game saves and your place are kept automatically. Download the save to move it to another device or emulator.'
            : 'Your place is kept automatically when you pause or leave.'}
      </p>
    </section>
  );
}
