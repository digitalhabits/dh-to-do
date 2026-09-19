/**
 * Shared helpers for parsing `msstore submission get` stdout (Spectre may wrap
 * long lines mid-string when stdout is redirected).
 */

const ANSI_RE =
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|[\x00-\x08\x0b-\x1f]/g;

function keyOf(obj, name) {
  if (!obj || typeof obj !== 'object') return null;
  const lower = name.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) return k;
  }
  return null;
}

/**
 * Spectre.Console wraps long lines at ~80 cols when stdout is redirected, which
 * inserts *literal* newlines inside JSON string values. Real newlines were
 * already escaped as `\n` by System.Text.Json — strip wrap artifacts.
 */
function repairWrappedJsonStrings(text) {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (inString && c === '\\') {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString) {
      if (c === '\r') {
        if (text[i + 1] === '\n') i += 1;
        continue;
      }
      if (c === '\n') continue;
      const code = c.charCodeAt(0);
      if (code < 0x20) continue;
    }
    out += c;
  }
  return out;
}

function extractJson(raw) {
  const cleaned = raw.replace(ANSI_RE, '');
  const candidates = [];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    candidates.push(cleaned.slice(start, end + 1));
  }
  candidates.push(cleaned);

  let lastErr;
  for (const candidate of candidates) {
    for (const text of [candidate, repairWrappedJsonStrings(candidate)]) {
      try {
        return JSON.parse(text);
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr || new Error('no JSON object found in the CLI output');
}

module.exports = { keyOf, extractJson, repairWrappedJsonStrings };
