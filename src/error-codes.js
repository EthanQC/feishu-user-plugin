// Feishu error-code classification for read_messages fallback routing.
//
// The v1.3.2 read_messages handler catches any bot failure and unconditionally
// retries with UAT. That's cheap when the bot fails fast, but it has two flaws
// in v1.3.3:
//   • Transient errors (rate-limit, network stalls) are treated the same as
//     permanent permission errors — the UAT path runs when a 2-second retry
//     would have worked.
//   • When UAT is absent, the raw Feishu payload leaks to the user verbatim,
//     with no hint that OAuth is the fix.
//
// This table classifies known codes into three buckets:
//   'uat'     — permanent bot failure; hop straight to UAT.
//   'retry'   — likely transient; caller should retry once (after short delay)
//               and fall through to UAT if still failing.
//   'unknown' — not seen before; preserve v1.3.3 behaviour (try UAT silently).

const FAILURE_MAP = {
  // External tenant — bot lives in a different tenant, will never be granted.
  240001: { action: 'uat', reason: 'bot_external_tenant' },
  // No permission for the resource (scope missing, or chat restricts bot reads).
  70009:  { action: 'uat', reason: 'bot_no_permission' },
  // Bot is not a member of the chat.
  70003:  { action: 'uat', reason: 'bot_not_in_chat' },
  99991668: { action: 'uat', reason: 'bot_not_in_chat' },
  // Chat does not exist (from the bot's POV — may still be accessible to user).
  19001:  { action: 'uat', reason: 'bot_chat_not_found' },

  // Rate limited — Feishu throttles, try once more after a brief pause.
  42101:  { action: 'retry', reason: 'bot_rate_limited' },
  // Frequency control variants occasionally observed.
  99991400: { action: 'retry', reason: 'bot_rate_limited' },
};

// HTTP-status / network-error patterns that warrant one retry.
// Axios-wrapped messages from @larksuiteoapi/node-sdk embed the http status
// into _safeSDKCall's rethrown message. We match those substrings.
const TRANSIENT_PATTERNS = [
  /HTTP 5\d\d/i,         // Any 5xx from upstream
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /fetch timeout after/i, // from utils.fetchWithTimeout
  /socket hang up/i,
];

/**
 * Classify an error thrown by a bot-API path.
 * Input is either the Feishu code number (preferred) or the Error object —
 * the code is extracted from the message if present.
 *
 * Output: { action: 'uat' | 'retry' | 'unknown', reason: string, code: number|null }
 */
function classifyError(errOrCode) {
  let code = null;
  let msg = '';
  if (typeof errOrCode === 'number') {
    code = errOrCode;
  } else if (errOrCode && typeof errOrCode === 'object') {
    msg = errOrCode.message || String(errOrCode);
    // _safeSDKCall formats as "label failed (HTTP N, code=XXX): ..." or "label failed (CODE): ..."
    const m = msg.match(/code[=(]\s*(\d+)/i) || msg.match(/failed\s*\((\d+)\)/i);
    if (m) code = parseInt(m[1], 10);
  }

  if (code != null && FAILURE_MAP[code]) {
    return { ...FAILURE_MAP[code], code };
  }
  for (const re of TRANSIENT_PATTERNS) {
    if (re.test(msg)) return { action: 'retry', reason: 'bot_network_error', code };
  }
  return { action: 'unknown', reason: 'bot_unknown_error', code };
}

module.exports = {
  classifyError,
  FAILURE_MAP,
  TRANSIENT_PATTERNS,
};
