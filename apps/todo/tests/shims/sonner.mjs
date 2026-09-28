// Toasts have no meaning outside a browser, so nothing is drawn.
// A copy of apps/mail/tests/shims/sonner.mjs, for the reason in
// ../mounted-dom.mjs.
//
// A suite that must press a toast's button (an Undo) sets
// `toastSink.push` to a function. Every call then goes to it as
// { kind, message, data }. For every other suite the sink is null, and a
// toast does nothing.
export const toastSink = { push: null };
const record = (kind) => (message, data) => {
  toastSink.push?.({ kind, message, data });
  return `${kind}-${Math.random().toString(36).slice(2, 8)}`;
};
export const toast = Object.assign(record("plain"), {
  success: record("success"),
  info: record("info"),
  error: record("error"),
  message: record("message"),
  loading: record("loading"),
  warning: record("warning"),
  custom: record("custom"),
  dismiss: () => {},
});
export default { toast };
