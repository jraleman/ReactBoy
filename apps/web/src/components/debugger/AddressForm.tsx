import { useId, useState } from 'react';
import panel from '../panel/Panel.module.css';
import styles from './Debugger.module.css';
import { parseLocation, type Location, type SymbolTable } from './symbols';

interface Props {
  /** Accessible name of the field, e.g. "Go to address". */
  label: string;
  /** The submit button's text. */
  action: string;
  /** Labels the field also accepts. */
  symbols: SymbolTable | null;
  onSubmit: (location: Location) => void;
}

/** An address field: C000, $C000, 0xC000, bank:address (03:4567) or a label. */
export function AddressForm({ label, action, symbols, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const id = useId();

  return (
    <form
      className={styles.addressForm}
      onSubmit={(event) => {
        event.preventDefault();
        const location = parseLocation(text, symbols);
        setInvalid(location === null);
        if (location === null) return;
        onSubmit(location);
        setText('');
      }}
    >
      <input
        className={styles.addressInput}
        value={text}
        placeholder={symbols ? '$0000 or label' : '$0000'}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        spellCheck={false}
        autoComplete="off"
        maxLength={symbols ? 64 : 8}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
      />
      <button type="submit" className={`${panel.small} ${styles.fit}`}>
        {action}
      </button>
      {invalid && (
        <span id={`${id}-error`} className={styles.error} role="alert">
          {symbols
            ? 'Enter a hex address (0000 to FFFF), bank:address or a label from the symbols.'
            : 'Enter a hex address (0000 to FFFF) or bank:address.'}
        </span>
      )}
    </form>
  );
}
