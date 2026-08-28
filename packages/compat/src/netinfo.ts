/**
 * @react-native-community/netinfo compat shim — navigator.onLine-backed.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface — default NetInfo {fetch, refresh, configure, addEventListener}
 * plus the named exports (same functions, useNetInfo, NetInfoStateType).
 *
 * Deliberate simplification, stated rather than hidden: the browser only
 * exposes online/offline, not the radio type, so the state is 'wifi' whenever
 * the page is online and 'none' otherwise — no cellular-generation mapping
 * from (navigator as any).connection.effectiveType. details carries the one
 * field apps commonly branch on, isConnectionExpensive, sourced from the
 * Network Information API's saveData when present (details is null when
 * offline, matching upstream). isInternetReachable mirrors isConnected —
 * there is no reachability probe.
 *
 * Change events come from window 'online'/'offline'. Handlers derive the new
 * state from the event type (not navigator.onLine, which some hosts update
 * after dispatch), so synthetic events behave deterministically. Matching
 * upstream, a listener also receives the current state once on subscription
 * (delivered on a microtask).
 */
import * as React from 'react';

export const NetInfoStateType = {
  none: 'none',
  unknown: 'unknown',
  cellular: 'cellular',
  wifi: 'wifi',
  bluetooth: 'bluetooth',
  ethernet: 'ethernet',
  wimax: 'wimax',
  vpn: 'vpn',
  other: 'other',
} as const;
export type NetInfoStateType = (typeof NetInfoStateType)[keyof typeof NetInfoStateType];

export interface NetInfoState {
  type: NetInfoStateType;
  isConnected: boolean;
  isInternetReachable: boolean;
  isWifiEnabled?: boolean;
  details: { isConnectionExpensive: boolean } | null;
}

export type NetInfoChangeHandler = (state: NetInfoState) => void;
export type NetInfoSubscription = () => void;

function currentOnline(): boolean {
  // Missing navigator (node/SSR) or missing onLine both count as online.
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function stateFor(online: boolean): NetInfoState {
  if (!online) {
    return { type: NetInfoStateType.none, isConnected: false, isInternetReachable: false, isWifiEnabled: false, details: null };
  }
  const connection =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      : undefined;
  return {
    type: NetInfoStateType.wifi,
    isConnected: true,
    isInternetReachable: true,
    isWifiEnabled: true,
    details: { isConnectionExpensive: connection?.saveData === true },
  };
}

const listeners = new Set<NetInfoChangeHandler>();
let windowBound = false;

function emit(online: boolean): void {
  const state = stateFor(online);
  for (const listener of [...listeners]) listener(state);
}

function ensureWindowBinding(): void {
  if (windowBound || typeof window === 'undefined') return;
  windowBound = true;
  window.addEventListener('online', () => emit(true));
  window.addEventListener('offline', () => emit(false));
}

export function fetch(_requestedInterface?: string): Promise<NetInfoState> {
  return Promise.resolve(stateFor(currentOnline()));
}

export function refresh(): Promise<NetInfoState> {
  return fetch();
}

/** Reachability probing is not simulated; configuration is accepted and ignored. */
export function configure(_configuration: Record<string, unknown>): void {}

export function addEventListener(listener: NetInfoChangeHandler): NetInfoSubscription {
  ensureWindowBinding();
  listeners.add(listener);
  queueMicrotask(() => {
    if (listeners.has(listener)) listener(stateFor(currentOnline()));
  });
  return () => {
    listeners.delete(listener);
  };
}

export function useNetInfo(): NetInfoState {
  const [state, setState] = React.useState<NetInfoState>(() => stateFor(currentOnline()));
  React.useEffect(() => addEventListener(setState), []);
  return state;
}

const NetInfo = { fetch, refresh, configure, addEventListener, useNetInfo };
export default NetInfo;
