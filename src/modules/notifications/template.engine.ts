// INIT-014 — minimal Handlebars-style template renderer.
//
// Replaces {{path.to.var}} from a context object. Missing values render
// as empty strings (we log them via the caller). HTML escaping is
// applied unless the placeholder is `{{{triple}}}` (raw).
//
// Why not full Handlebars: zero-deps + audit-able (workspace_owner can
// edit templates without us shipping a Turing-complete engine into a
// security boundary). If/when we add helpers (each, if), do it here.

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c] || c);
}

function getPath(obj: any, path: string): unknown {
  if (!obj) return undefined;
  const parts = path.split('.');
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  if (!template) return '';
  return template.replace(/\{\{\{?([\w.]+)\}?\}\}/g, (full, expr) => {
    const raw = full.startsWith('{{{') && full.endsWith('}}}');
    const value = getPath(context, expr.trim());
    if (value === undefined || value === null) return '';
    const s = String(value);
    return raw ? s : escapeHtml(s);
  });
}

// Used by the contract test — return the placeholder names a template
// references. Helps catch mismatches between template body and the
// declared `variables[]` array.
export function extractPlaceholders(template: string): string[] {
  const out = new Set<string>();
  const re = /\{\{\{?([\w.]+)\}?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    out.add(m[1].split('.')[0]);
  }
  return [...out];
}
