import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Membership } from '@quartermaster/contracts';
import { confirmAction } from './ConfirmDialog';

export type Destination = { section: string; params: URLSearchParams };
const sections = [
  'Assets',
  'Capture',
  'Maintenance',
  'Locations',
  'Asset types',
  'Insurance',
  'Incidents',
  'Accounting',
  'Rules',
  'Reports',
  'Activity',
  'Team',
  'Settings',
];
export const slug = (name: string) => name.toLowerCase().replaceAll(' ', '-');
export function destination(
  section: string,
  values: Record<string, string> = {},
) {
  const params = new URLSearchParams(
    Object.entries(values).filter(([, v]) => v),
  );
  return '#' + slug(section) + (params.size ? '?' + params : '');
}
export function hasUnsavedWork() {
  return Boolean(
    document.querySelector(
      '[data-dirty="true"],[data-unsaved-editor],[data-uncertain-save]',
    ),
  );
}
export async function allowLeaving(
  message = 'Leave this view? Unsaved input will be lost.',
) {
  return !hasUnsavedWork() || (await confirmAction(message));
}
export function readDestination(
  hash: string,
  membership: Membership,
  mobile: boolean,
): Destination {
  const [name, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const allowed = sections
    .filter(
      (s) =>
        s !== 'Capture' ||
        (mobile && membership.capabilities.includes('assets:write')),
    )
    .filter(
      (s) =>
        s !== 'Reports' || membership.capabilities.includes('exports:read'),
    )
    .filter(
      (s) =>
        !['Team', 'Settings'].includes(s) ||
        membership.capabilities.includes('workspace:admin'),
    );
  if (
    params.has('workspace') &&
    params.get('workspace') !== membership.tenantId
  )
    return { section: 'Assets', params: new URLSearchParams() };
  const section = name
    ? (allowed.find((s) => slug(s) === name) ?? 'Assets')
    : mobile && allowed.includes('Capture')
      ? 'Capture'
      : 'Assets';
  // Only navigation identifiers and applied filters belong in URLs; never editor contents.
  const keys = [
    'asset',
    'detail',
    'q',
    'status',
    'assetClass',
    'locationId',
    'workspace',
  ];
  for (const key of [...params.keys()])
    if (!keys.includes(key)) params.delete(key);
  if (
    params.get('asset') === 'new' &&
    !membership.capabilities.includes('assets:write')
  )
    params.delete('asset');
  return { section, params };
}
type Navigation = {
  route: Destination;
  mobile: boolean;
  go: (
    hash: string,
    options?: { discard?: boolean; replace?: boolean },
  ) => Promise<boolean>;
};
const Context = createContext<Navigation | null>(null);
export function useNavigation() {
  const value = useContext(Context);
  if (!value) throw new Error('Missing estate navigation');
  return value;
}
export function EstateNavigation({
  membership,
  children,
}: {
  membership: Membership;
  children: ReactNode;
}) {
  // Select once per workspace session. Resizing must not replace an active editor/capture.
  const [mobile] = useState(
    () => window.matchMedia('(max-width: 639px)').matches,
  );
  const [route, setRoute] = useState(() =>
    readDestination(window.location.hash, membership, mobile),
  );
  const current = useRef(window.location.hash),
    index = useRef(0),
    locked = useRef(false),
    reverting = useRef(false);
  const listPosition = useRef<{ y: number; focus?: string }>({ y: 0 });
  const canonical = (hash: string) => {
    const next = readDestination(hash, membership, mobile);
    next.params.set('workspace', membership.tenantId);
    return destination(next.section, Object.fromEntries(next.params));
  };
  const snapshot = () =>
    window.history.replaceState(
      {
        ...window.history.state,
        estateIndex: index.current,
        y: window.scrollY,
        focus: document.activeElement?.id,
      },
      '',
      current.current,
    );
  const apply = (hash: string, restore = false) => {
    const prior = readDestination(current.current, membership, mobile);
    const next = readDestination(hash, membership, mobile);
    const returning =
      next.section === 'Assets' &&
      !next.params.get('asset') &&
      (prior.section !== 'Assets' || Boolean(prior.params.get('asset')));
    current.current = hash;
    setRoute(readDestination(hash, membership, mobile));
    const state = restore
      ? window.history.state
      : returning
        ? listPosition.current
        : null;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const target = state?.focus
          ? document.getElementById(state.focus)
          : document.getElementById('main');
        target?.focus({ preventScroll: true });
        window.scrollTo({ top: state?.y ?? 0 });
      }),
    );
  };
  const go: Navigation['go'] = async (hash, options = {}) => {
    const next = canonical(hash);
    if (next === current.current) return true;
    if (locked.current) return false;
    locked.current = true;
    try {
      if (options.discard !== false && !(await allowLeaving())) return false;
      snapshot();
      const prior = readDestination(current.current, membership, mobile);
      if (prior.section === 'Assets' && !prior.params.get('asset'))
        listPosition.current = {
          y: window.scrollY,
          focus: document.activeElement?.id ?? '',
        };
      if (!options.replace) index.current++;
      window.history[options.replace ? 'replaceState' : 'pushState'](
        { estateIndex: index.current },
        '',
        next,
      );
      apply(next);
      return true;
    } finally {
      locked.current = false;
    }
  };
  useEffect(() => {
    current.current = canonical(window.location.hash);
    window.history.replaceState({ estateIndex: 0 }, '', current.current);
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const back = async () => {
      if (reverting.current) {
        reverting.current = false;
        return;
      }
      const next = canonical(window.location.hash);
      if (next === current.current) {
        if (window.location.hash !== next)
          window.history.replaceState({ estateIndex: index.current }, '', next);
        return;
      }
      if (locked.current) return;
      locked.current = true;
      const nextIndex = window.history.state?.estateIndex;
      const parsed = readDestination(next, membership, mobile);
      const prior = readDestination(current.current, membership, mobile);
      const discards =
        parsed.section !== prior.section ||
        parsed.params.get('asset') !== prior.params.get('asset');
      const allowed = !discards || (await allowLeaving());
      if (!allowed) {
        if (typeof nextIndex === 'number' && nextIndex !== index.current) {
          reverting.current = true;
          window.history.go(
            index.current - (window.history.state?.estateIndex ?? nextIndex),
          );
        } else
          window.history.replaceState(
            { estateIndex: index.current },
            '',
            current.current,
          );
      } else {
        index.current =
          typeof nextIndex === 'number' ? nextIndex : index.current + 1;
        window.history.replaceState(
          { ...window.history.state, estateIndex: index.current },
          '',
          next,
        );
        apply(next, true);
      }
      locked.current = false;
    };
    const capturePosition = () => {
      if (!locked.current && window.location.hash === current.current)
        snapshot();
    };
    window.addEventListener('popstate', back);
    window.addEventListener('scroll', capturePosition, { passive: true });
    window.addEventListener('focusin', capturePosition);
    const unload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedWork()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      window.history.scrollRestoration = previousRestoration;
      window.removeEventListener('popstate', back);
      window.removeEventListener('scroll', capturePosition);
      window.removeEventListener('focusin', capturePosition);
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  return (
    <Context.Provider value={{ route, mobile, go }}>
      {children}
    </Context.Provider>
  );
}
