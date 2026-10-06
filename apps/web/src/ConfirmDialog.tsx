import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './ui';
type Confirmation = { message: string; resolve: (accepted: boolean) => void };
let show: ((value: Confirmation) => void) | undefined;
export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (show) show({ message, resolve });
    else resolve(false);
  });
}
export function ConfirmationHost() {
  const [current, setCurrent] = useState<Confirmation>();
  const pending = useRef<Confirmation | undefined>(undefined),
    dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    id = useId();
  useEffect(() => {
    show = (value) => {
      if (pending.current) {
        value.resolve(false);
        return;
      }
      pending.current = value;
      setCurrent(value);
    };
    return () => {
      show = undefined;
      pending.current?.resolve(false);
      pending.current = undefined;
    };
  }, []);
  useEffect(() => {
    if (!current) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    cancel.current?.focus();
    return () => {
      dialog.current?.close();
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLElement>('#main')?.focus();
    };
  }, [current]);
  function finish(accepted: boolean) {
    pending.current?.resolve(accepted);
    pending.current = undefined;
    setCurrent(undefined);
  }
  const destructive = /delete|purge|permanently/i.test(current?.message ?? '');
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby={id}
      aria-describedby={id + '-message'}
      onCancel={(event) => {
        event.preventDefault();
        finish(false);
      }}
    >
      {current && (
        <>
          <div className="dialog-heading">
            <h2 id={id}>
              {destructive ? 'Confirm deletion' : 'Before you continue'}
            </h2>
            <button
              className="icon-button"
              type="button"
              aria-label="Close confirmation"
              onClick={() => finish(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <p id={id + '-message'}>{current.message}</p>
          {destructive && (
            <p className="deletion-notice">
              <strong>About retained backups</strong>Live content is purged.
              Isolated backup copies expire within 90 days, and deleted content
              is purged again before restored access. This action cannot be
              undone in Quartermaster.
            </p>
          )}
          <div className="actions">
            <button ref={cancel} type="button" onClick={() => finish(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={destructive ? 'danger' : 'primary'}
              onClick={() => finish(true)}
            >
              {destructive ? 'Confirm deletion' : 'Continue'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
