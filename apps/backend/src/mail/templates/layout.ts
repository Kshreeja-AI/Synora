/**
 * Shared, email-client-safe HTML wrapper: inline CSS only (no <style>
 * blocks or external stylesheets — most mail clients strip both), a table
 * body would be more bulletproof for ancient clients, but every provider
 * this application targets (Gmail, Outlook 365, Apple Mail) renders modern
 * flex/block CSS fine, so plain divs are used for readability.
 */
export function renderEmailLayout(params: {
  previewText: string;
  heading: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <span style="display:none;font-size:1px;color:#0a0a0a;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(params.previewText)}</span>
    <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
      <div style="margin-bottom:32px;">
        <span style="font-size:20px;font-weight:700;color:#fafafa;letter-spacing:-0.02em;">Synora</span>
      </div>
      <div style="background-color:#141414;border:1px solid #262626;border-radius:12px;padding:32px;">
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#fafafa;">${escapeHtml(params.heading)}</h1>
        <div style="font-size:15px;line-height:1.6;color:#d4d4d4;">${params.bodyHtml}</div>
      </div>
      <p style="margin-top:24px;font-size:13px;color:#737373;">
        Synora AI · If you didn't expect this email, you can safely ignore it.
      </p>
    </div>
  </body>
</html>`;
}

export function renderEmailButton(url: string, label: string): string {
  return `<a href="${escapeHtmlAttr(url)}" style="display:inline-block;margin-top:8px;padding:12px 24px;background-color:#fafafa;color:#0a0a0a;font-weight:600;font-size:14px;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
