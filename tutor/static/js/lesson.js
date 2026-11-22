// Pure lesson logic: no DOM, no storage, no eval.

const TAMIL_DIGITS = '௦௧௨௩௪௫௬௭௮௯';
const PROBE_ITEMS = ['E05', 'E06'];

function digitValue(ch) {
  const code = ch.charCodeAt(0) - 48;
  if (ch.length === 1 && code >= 0 && code <= 9) return code;
  return TAMIL_DIGITS.indexOf(ch);
}

// Accepts optional leading "-" or "\u2212", then 1-4 ASCII or Tamil digits.
export function parseSignedInt(text) {
  const invalid = { ok: false, reason: 'invalid' };
  if (typeof text !== 'string') return invalid;
  const s = text.trim();
  let sign = 1;
  let body = s;
  if (s[0] === '-' || s[0] === '\u2212') {
    sign = -1;
    body = s.slice(1);
  }
  if (body.length < 1 || body.length > 4) return invalid;
  let n = 0;
  for (const ch of body) {
    const d = digitValue(ch);
    if (d < 0) return invalid;
    n = n * 10 + d;
  }
  return { ok: true, value: n === 0 ? 0 : sign * n };
}

// item: pack item with options[] and answer. Unknown stepIds are not graded.
export function gradeChoice(item, stepId) {
  const known = (item.options || []).some((o) => o.stepId === stepId);
  if (!known) return { ok: false, invalid: true };
  return { ok: true, correct: stepId === item.answer, stepId };
}

export function gradeNumeric(item, text) {
  const parsed = parseSignedInt(text);
  if (!parsed.ok) return { ok: false, invalid: true };
  return { ok: true, correct: String(parsed.value) === item.answer };
}

// Original goal after the diagnostic's correct branch: two-step practice, never shown during the probe.
const RETURN_ITEM = 'E03';

// Returns the pack-level misconception tag for an option, or null when untagged.
// Looked up from pack metadata so historical events without a tag field still resolve.
export function misconceptionOf(pack, itemId, optionId) {
  const item = (pack?.items || []).find((i) => i.id === itemId);
  const option = (item?.options || []).find((o) => o.stepId === optionId);
  return option?.misconception ?? null;
}

// state: { mode, remaining, exhaustedText }
// graded: { itemId, kind: 'choice' | 'numeric', stepId, correct }
// events: committed events [{ itemId, stepId, ... }] from earlier items; defaults to none.
// pack: content pack used to resolve misconception tags; optional.
// Returns an action object; never names a misconception for numeric errors.
// Exhaustion is an end state: no progress increment, and it carries the pack-level exhaustedText when supplied.
export function nextStep(state, graded, events = [], pack = null) {
  if (Array.isArray(state.remaining) && state.remaining.length === 0) {
    return {
      action: 'exhausted',
      progressDelta: 0,
      ...(state.exhaustedText ? { text: state.exhaustedText } : {}),
    };
  }
  const { itemId, kind, stepId, correct } = graded;

  if (kind === 'numeric') {
    return correct
      ? { action: 'advance', progressDelta: 1 }
      : { action: 'hint', generic: true };
  }

  if (itemId === 'E01') {
    if (correct) return { action: 'advance', item: 'E03', progressDelta: 1 };
    if (stepId === 'SUB8_LEFT') {
      return {
        action: 'explain',
        explanation: 'balance',
        next: { action: 'probe', item: 'E05' },
      };
    }
    return { action: 'hint', generic: true };
  }

  if (PROBE_ITEMS.includes(itemId)) {
    if (correct) return { action: 'return', item: RETURN_ITEM };
    // Independent confirmation: same tag from a committed event on a different item.
    const tag = misconceptionOf(pack, itemId, stepId);
    if (tag && events.some((e) => e.itemId !== itemId && misconceptionOf(pack, e.itemId, e.stepId) === tag)) {
      return { action: 'repair', item: 'E10' };
    }
    return { action: 'retry', item: itemId };
  }

  return correct
    ? { action: 'advance', progressDelta: 1 }
    : { action: 'hint', generic: true };
}
