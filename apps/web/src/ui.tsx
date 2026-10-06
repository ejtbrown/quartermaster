import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  assets: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M9 9v12M8 4V2m8 2V2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0014 0v-2M12 19v3m-4 0h8" />
    </>
  ),
  work: (
    <path d="M14 5a6 6 0 00-7 7l-5 5a3 3 0 004 4l5-5a6 6 0 007-7l-4 4-3-3 4-4z" />
  ),
  location: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1114 0z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  alert: (
    <>
      <path d="M10 4L2 19a1 1 0 001 2h18a1 1 0 001-2L14 4a2 2 0 00-4 0zM12 9v5m0 3v1" />
    </>
  ),
  report: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 16v-3m4 3V8m4 8v-6" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-4a6 6 0 0112 0v4M16 4a3 3 0 010 6m2 3a5 5 0 013 5v3" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M4 12l5 5L20 6" />,
  close: <path d="M6 6l12 12M6 18L18 6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v1" />
    </>
  ),
  camera: (
    <>
      <path d="M3 6h4l2-3h6l2 3h4v15H3z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  arrow: <path d="M5 12h14m-6-6l6 6-6 6" />,
};
export function Icon({ name, ...props }: { name: string; className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] ?? paths.assets}
    </svg>
  );
}
export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Quartermaster home">
      <span className="brand-mark" aria-hidden="true">
        Q
      </span>
      <span>
        Quartermaster<small>Clear by design</small>
      </span>
    </a>
  );
}
export function InfoDisclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId(),
    root = useRef<HTMLSpanElement>(null),
    button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <span className="info-disclosure" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-button help-button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          event.preventDefault();
          setOpen(!open);
        }}
      >
        <Icon name="info" />
      </button>
      {open && (
        <span id={id} className="help-content" role="note">
          <strong>{label}</strong>
          <span>{children}</span>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setOpen(false);
              button.current?.focus();
            }}
          >
            Close explanation
          </button>
        </span>
      )}
    </span>
  );
}
export function EmptyState({
  title,
  children,
  icon = 'assets',
}: {
  title: string;
  children: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export const fieldHelp: Record<string, string> = {
  criticality:
    'How much disruption a failure would cause. This helps prioritize attention; it is not a safety assessment.',
  condition:
    'Your observed condition of this asset. Choose Unknown if it has not been assessed.',
  replacement:
    'Your estimate of the cost to replace this asset today. Used for planning and insurance summaries; not a coverage decision.',
  replacementMinor:
    'Your estimate of the cost to replace this asset today, entered in US dollars. It does not confirm insurance coverage.',
  residual:
    'Estimated value remaining at the end of the asset’s useful life. Used in straight-line depreciation estimates.',
  usefulLifeMonths:
    'How many months you expect to use this asset. Used to estimate depreciation, not to predict its failure date.',
  capitalized:
    'Treat this as a long-term asset in management reporting. Confirm your organization’s accounting policy before choosing this.',
  costCenter:
    'An optional department, ministry, or budget code used to group spending.',
  accessConstraints:
    'Anything that makes inspection or maintenance harder, such as damaged fasteners or a locked enclosure.',
  intervalMonths:
    'How often this maintenance repeats, in calendar months. The next task is scheduled from the plan’s due date.',
  deductibleMinor:
    'The amount your organization is responsible for before the policy contributes, entered in US dollars. Check your policy terms.',
  limitMinor:
    'The policy’s recorded coverage limit in US dollars. This is reference information, not a confirmation that a loss is covered.',
  basis:
    'What the valuation represents: replacement cost, market value, or a professional appraisal.',
  operator:
    'How the rule compares the selected field with your value. Preview the affected assets before approving changes.',
  asOf: 'The date used for this report’s calculations. It does not reconstruct earlier records unless the report explicitly uses a saved snapshot.',
  captureIntents:
    'The photo views guided capture should request for this asset type. People can always skip a view they cannot safely obtain.',
  fields:
    'Additional information to record for this asset type. Field keys are stable identifiers; labels are the names people see.',
};
export function FieldHelp({ name, label }: { name: string; label?: string }) {
  return fieldHelp[name] ? (
    <InfoDisclosure label={label ?? name}>{fieldHelp[name]}</InfoDisclosure>
  ) : null;
}
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
}) {
  const id = useId(),
    explanation = help ? fieldHelp[help] : undefined;
  return (
    <div className="field">
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        {explanation && (
          <InfoDisclosure label={label}>{explanation}</InfoDisclosure>
        )}
      </div>
      {cloneElement(children, {
        id,
        ...(explanation ? { 'aria-describedby': id + '-help' } : {}),
      })}
      {explanation && (
        <span id={id + '-help'} className="sr-only">
          {explanation}
        </span>
      )}
    </div>
  );
}
