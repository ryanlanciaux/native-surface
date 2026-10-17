export interface EmdashHit {
  file: string;
  line: number;
  col: number;
  snippet: string;
}
export const ROOT: string;
export function loadAllowlist(): string[];
export function checkEmdash(opts?: { allowlist?: string[] }): EmdashHit[];
export function formatHits(hits: EmdashHit[]): string;
