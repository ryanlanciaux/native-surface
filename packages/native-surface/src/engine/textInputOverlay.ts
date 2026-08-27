/**
 * The DOM sliver of TextInput: one real <input>/<textarea>, position:fixed
 * over the canvas, materialized only while an input is focused. Everything
 * stateful lives in textInputState.ts; this module is pure geometry + DOM
 * plumbing and is never loaded into the paint/layout path (no top-level DOM
 * access, so it is Node-import-safe; the factory just returns null there).
 *
 * Placement comes from engine/canvasGeometry — the same helper the portal host
 * and the CNode DOM facade use — so the overlay, a portal, and a measured node
 * agree on where a node is to the pixel. The scale factors it returns also
 * size the type, not just the box.
 */
import { Edge } from 'yoga-layout/load';
import { canvasGeometry, canvasHostOf } from './canvasGeometry';
import type { CNode } from './node';
import { DEFAULT_TEXT_STYLE, resolveTextStyle } from './styles';
import type { InputOverlay, OverlayController, TextInputSpec } from './textInputState';
import { specOfInput } from './textInputState';

const KEYBOARD_TYPE_MAP: Record<string, { type?: string; inputmode?: string }> = {
  'default': {},
  'email-address': { type: 'email' },
  'numeric': { inputmode: 'numeric' },
  'number-pad': { inputmode: 'numeric' },
  'decimal-pad': { inputmode: 'decimal' },
  'phone-pad': { type: 'tel' },
  'url': { type: 'url' },
  'web-search': { type: 'search' },
};

const RETURN_KEY_MAP: Record<string, string> = {
  done: 'done', go: 'go', next: 'next', search: 'search', send: 'send',
};

function cssFontWeight(w: number): string {
  return String(Math.max(100, Math.min(900, Math.round(w / 100) * 100)));
}

export function createDomInputOverlay(node: CNode, controller: OverlayController): InputOverlay | null {
  if (typeof document === 'undefined') return null;
  const host = canvasHostOf(node);
  if (!host) return null;

  const spec = specOfInput(node);
  const el = document.createElement(spec.multiline ? 'textarea' : 'input') as
    | HTMLInputElement
    | HTMLTextAreaElement;

  applyStaticAttrs(el, spec);
  const s = el.style;
  s.position = 'fixed';
  s.margin = '0';
  s.border = 'none';
  s.outline = 'none';
  s.background = 'transparent';
  s.boxSizing = 'border-box';
  s.zIndex = '9999';
  s.overflow = 'hidden';
  s.resize = 'none';
  if (spec.selectionColor || spec.cursorColor) s.caretColor = spec.cursorColor ?? spec.selectionColor!;

  const reposition = () => {
    const h = canvasHostOf(node);
    const geo = h ? canvasGeometry(node, h) : null;
    if (!geo) return;
    // The canvas's CSS-stretch factors also scale the type: an overlay whose
    // box is stretched 2x but whose font is not would not line up with the
    // Skia text it replaces. Both come off the same geometry.
    const { sx, sy } = geo;
    const text = resolveTextStyle(node.flatStyle, DEFAULT_TEXT_STYLE);
    const yoga = node.yoga;
    const pad = (edge: Edge) =>
      (yoga ? yoga.getComputedPadding(edge) + yoga.getComputedBorder(edge) : 0);

    s.left = `${geo.left}px`;
    s.top = `${geo.top}px`;
    s.width = `${geo.width}px`;
    s.height = `${geo.height}px`;
    s.paddingLeft = `${pad(Edge.Left) * sx}px`;
    s.paddingRight = `${pad(Edge.Right) * sx}px`;
    s.paddingTop = `${pad(Edge.Top) * sy}px`;
    s.paddingBottom = `${pad(Edge.Bottom) * sy}px`;
    s.fontFamily = `"${text.fontFamily}", "Inter", sans-serif`;
    s.fontSize = `${text.fontSize * sy}px`;
    s.fontWeight = cssFontWeight(text.fontWeight);
    s.fontStyle = text.italic ? 'italic' : 'normal';
    s.letterSpacing = `${text.letterSpacing * sx}px`;
    s.color = `rgba(${text.color.r}, ${text.color.g}, ${text.color.b}, ${text.color.a})`;
    s.textAlign = text.textAlign;
    if (spec.multiline) {
      s.lineHeight = text.lineHeight != null ? `${text.lineHeight * sy}px` : 'normal';
    } else {
      // vertically center single-line text the way the paint side does
      s.lineHeight = `${Math.max(0, geo.height - (pad(Edge.Top) + pad(Edge.Bottom)) * sy)}px`;
      s.paddingTop = '0px';
      s.paddingBottom = '0px';
    }
  };

  // Engine→DOM syncs run on the (async) flush loop, so they can echo values
  // one or more keystrokes behind the DOM. Every value the DOM reports goes
  // into a pending queue; a sync carrying any still-pending value is our own
  // input coming back (skip — the DOM is ahead). Only a value the DOM never
  // reported is a genuine programmatic/controlled change (apply).
  const pendingReports: string[] = [];
  const onInput = () => {
    pendingReports.push(el.value);
    if (pendingReports.length > 64) pendingReports.shift();
    controller.onInput(el.value);
  };
  const onKeyDown = (evt: Event) => {
    const e = evt as globalThis.KeyboardEvent;
    controller.onKeyPress(e.key);
    if (e.key === 'Enter') {
      const behavior = spec.submitBehavior ?? (spec.multiline ? 'newline' : 'blurAndSubmit');
      const newline = spec.multiline && (behavior === 'newline' || e.shiftKey);
      if (!newline) {
        e.preventDefault();
        controller.onSubmit();
      }
    }
  };
  const onBlur = () => controller.onDomBlur();
  const onPage = () => reposition();

  el.addEventListener('input', onInput);
  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('blur', onBlur);
  window.addEventListener('scroll', onPage, true);
  window.addEventListener('resize', onPage);

  document.body.appendChild(el);
  reposition();
  el.focus({ preventScroll: true });
  if (spec.selectTextOnFocus) el.select();

  return {
    sync(value: string) {
      const idx = pendingReports.indexOf(value);
      if (idx !== -1) {
        // our own report acknowledged; older reports are superseded
        pendingReports.splice(0, idx + 1);
        return;
      }
      if (el.value === value) return;
      pendingReports.length = 0; // a real external change resets the ledger
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = value;
      if (start != null && end != null) {
        const max = value.length;
        try {
          el.setSelectionRange(Math.min(start, max), Math.min(end, max));
        } catch {
          /* number/email inputs reject selection APIs */
        }
      }
    },
    reposition,
    destroy() {
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('blur', onBlur);
      window.removeEventListener('scroll', onPage, true);
      window.removeEventListener('resize', onPage);
      el.remove();
    },
  };
}

function applyStaticAttrs(el: HTMLInputElement | HTMLTextAreaElement, spec: TextInputSpec): void {
  const kb = KEYBOARD_TYPE_MAP[spec.keyboardType ?? 'default'] ?? {};
  if (el instanceof HTMLInputElement) {
    el.type = spec.secureTextEntry ? 'password' : (kb.type ?? 'text');
  }
  if (kb.inputmode) el.setAttribute('inputmode', kb.inputmode);
  if (spec.returnKeyType && RETURN_KEY_MAP[spec.returnKeyType]) {
    el.setAttribute('enterkeyhint', RETURN_KEY_MAP[spec.returnKeyType]!);
  }
  if (spec.maxLength != null) el.setAttribute('maxlength', String(spec.maxLength));
  if (spec.autoCapitalize) el.setAttribute('autocapitalize', spec.autoCapitalize);
  if (spec.autoCorrect === false) el.setAttribute('autocorrect', 'off');
  el.setAttribute('autocomplete', spec.autoComplete ?? 'off');
  el.setAttribute('spellcheck', spec.autoCorrect === false ? 'false' : 'true');
  // While focused the engine suppresses its Skia text (placeholder included),
  // so the DOM element shows the placeholder — in the right color.
  if (spec.placeholder) {
    ensurePlaceholderRule();
    el.classList.add('cn-input-overlay');
    el.setAttribute('placeholder', spec.placeholder);
    el.style.setProperty('--cn-input-ph', spec.placeholderTextColor ?? '#9BA1AB');
  }
}

let placeholderRuleAdded = false;
function ensurePlaceholderRule(): void {
  if (placeholderRuleAdded || typeof document === 'undefined') return;
  placeholderRuleAdded = true;
  const style = document.createElement('style');
  style.textContent = '.cn-input-overlay::placeholder { color: var(--cn-input-ph, #9BA1AB); opacity: 1; }';
  document.head.appendChild(style);
}
