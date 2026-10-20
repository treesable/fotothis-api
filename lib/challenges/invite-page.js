// The friend's invite page (docs/CHALLENGES.md screen 3, canvas C3): who invited you, who's in,
// one line on FotoThis, and the App Store button. No stats. Everything user-typed is escaped.
import { config } from "../config.js";

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const COLOUR = /^#[0-9A-Fa-f]{6}$/;
const safeColour = (value) => (COLOUR.test(value ?? "") ? value : "#8FD19E");
const initial = (name) => escapeHtml([...String(name ?? "?")][0]?.toUpperCase() ?? "?");

function avatar(member, size) {
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:${safeColour(member.colour)}">${initial(member.nickname)}</span>`;
}

/** `preview` from previewByCode, or null when the code doesn't exist. */
export function invitePage(code, preview) {
  const url = `https://${config.inviteHost}/c/${encodeURIComponent(code)}`;
  const ended = preview?.status === "ended";
  const full = preview && preview.spotsLeft === 0;
  const inviter = preview?.inviter?.nickname ?? "A friend";
  const title = preview ? `${inviter} invited you to a 7-day Outside Challenge` : "This invite wasn't found";
  const description = "FotoThis locks your distracting apps until you step outside and snap nature. Do it together for 7 days.";

  let body;
  if (!preview || ended) {
    body = `
      <h1>${preview ? "This challenge has ended" : "This invite wasn't found"}</h1>
      <p class="line">${preview ? "Ask your friend to start another round." : "Check the code, or ask your friend for a new link."}</p>
      <a class="button" href="${escapeHtml(config.appStoreUrl)}">Get FotoThis on the App Store</a>`;
  } else {
    const chips = preview.members.map((m) => `<span class="chip">${avatar(m, 22)}${escapeHtml(m.nickname)}</span>`).join("");
    body = `
      ${preview.inviter ? avatar(preview.inviter, 64) : ""}
      <h1>${escapeHtml(inviter)} invited you to a 7‑day Outside Challenge</h1>
      <p class="line">${description}</p>
      <div class="crew">${chips}${full ? "" : '<span class="chip you">You?</span>'}</div>
      ${full ? '<p class="line">This crew is full (8 people).</p>' : `
      <a class="button" id="get" href="${escapeHtml(config.appStoreUrl)}">Get FotoThis on the App Store</a>
      <p class="code">Your invite code: <b>${escapeHtml(preview.code)}</b> · The app finds it for you after install.</p>
      <a class="open" href="fotothis://c/${encodeURIComponent(preview.code)}">Already have FotoThis? Open the invite</a>`}`;
  }

  const banner = config.appStoreId
    ? `<meta name="apple-itunes-app" content="app-id=${escapeHtml(config.appStoreId)}, app-argument=${escapeHtml(url)}">` : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} · FotoThis</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="https://${config.inviteHost}/icon.png">
<meta property="og:url" content="${escapeHtml(url)}">
<meta name="theme-color" content="#0B1A10">
${banner}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #0B1A10; color: #F3F6F0; font-family: Manrope, -apple-system, sans-serif;
    display: flex; justify-content: center; overflow-x: hidden; }
  body::before, body::after { content: ""; position: fixed; border-radius: 50%; filter: blur(10px); z-index: 0; pointer-events: none; }
  body::before { width: 320px; height: 320px; top: -80px; right: -100px; background: radial-gradient(#FF7A5C80, transparent 70%); }
  body::after { width: 300px; height: 300px; bottom: 10%; left: -120px; background: radial-gradient(#8FD19E5C, transparent 70%); }
  main { position: relative; z-index: 1; width: 100%; max-width: 440px; padding: 48px 24px 40px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 18px; }
  .brand { display: flex; align-items: center; gap: 10px; font-family: Sora, sans-serif; font-weight: 700; font-size: 18px; margin-bottom: 18px; }
  .brand img { width: 44px; height: 44px; border-radius: 11px; }
  .avatar { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: #1A0B06; font-family: Sora, sans-serif; font-weight: 800; flex: none; }
  h1 { font-family: Sora, sans-serif; font-weight: 700; font-size: 26px; line-height: 1.2; letter-spacing: -0.5px; margin: 0; }
  .line { color: #C4D3C7; font-size: 16px; line-height: 1.5; margin: 0; }
  .crew { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 6px 0; }
  .chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; border-radius: 999px; background: #FFFFFF14;
    border: 1px solid #FFFFFF1F; font-weight: 700; font-size: 14px; }
  .chip.you { padding: 6px 14px; border-style: dashed; border-color: #8FD19E; color: #8FD19E; background: transparent; }
  .button { display: block; width: 100%; margin-top: 10px; padding: 18px; border-radius: 999px; background: #FF7A5C; color: #1A0B06;
    font-family: Sora, sans-serif; font-weight: 700; font-size: 17px; text-decoration: none; box-shadow: 0 10px 30px #FF7A5C59; }
  .code { color: #839287; font-size: 13px; margin: 0; }
  .code b { color: #F3F6F0; letter-spacing: 1px; }
  .open { color: #8FD19E; font-weight: 700; font-size: 15px; text-decoration: none; padding: 8px; }
</style>
</head><body><main>
  <div class="brand"><img src="/icon.png" alt="" width="44" height="44">FotoThis</div>
  ${body}
</main>
<script>
  // Copy the link first: after install, the app's "Paste invite" button finds the code.
  document.getElementById("get")?.addEventListener("click", () => { try { navigator.clipboard.writeText(${JSON.stringify(url)}); } catch {} });
</script>
</body></html>`;
}

export function appSiteAssociation() {
  return {
    applinks: {
      details: [{
        appIDs: [`${config.teamId}.${config.bundleId}`],
        components: [{ "/": "/c/*", comment: "Outside Challenge invites" }],
      }],
    },
  };
}
