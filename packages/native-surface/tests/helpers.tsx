import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeRoot, snapshotPNG } from '../src/engine/renderer';
import type { RootImpl } from '../src/engine/renderer';
import type { LayoutNode, NativeRoot, RootOptions } from '../src/types';

export function createTestRoot(width: number, height: number, opts?: Partial<RootOptions>): NativeRoot {
  return createNativeRoot({ surfaceWidth: width, surfaceHeight: height }, { width, height, dpr: 1, ...opts });
}

export function asImpl(root: NativeRoot): RootImpl {
  return root as RootImpl;
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-output');

export async function writeSnapshot(root: NativeRoot, name: string): Promise<Uint8Array> {
  const png = await snapshotPNG(root);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${name}.png`), png);
  return png;
}

/** Depth-first search of the layout tree. */
export function findNode(tree: LayoutNode, pred: (n: LayoutNode) => boolean): LayoutNode | null {
  if (pred(tree)) return tree;
  for (const c of tree.children) {
    const hit = findNode(c, pred);
    if (hit) return hit;
  }
  return null;
}

export function frames(tree: LayoutNode): Array<{ type: string; x: number; y: number; width: number; height: number }> {
  const out: Array<{ type: string; x: number; y: number; width: number; height: number }> = [];
  const walk = (n: LayoutNode) => {
    out.push({ type: n.type, ...n.frame });
    n.children.forEach(walk);
  };
  walk(tree);
  return out;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
