// The plain pages on fotothis.one: home (/), privacy (/privacy) and terms (/terms).
// Same look as the invite page. The App Store listing and the app link to these URLs.
import { config } from "./config.js";
import { escapeHtml } from "./challenges/invite-page.js";

const UPDATED = "20 October 2026";

function page({ title, description, body }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="https://${config.inviteHost}/icon.png">
<meta name="theme-color" content="#0B1A10">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #0B1A10; color: #F3F6F0; font-family: Manrope, -apple-system, sans-serif;
    display: flex; justify-content: center; overflow-x: hidden; }
  body::before { content: ""; position: fixed; width: 320px; height: 320px; top: -80px; right: -100px; border-radius: 50%;
    filter: blur(10px); background: radial-gradient(#FF7A5C66, transparent 70%); z-index: 0; pointer-events: none; }
  main { position: relative; z-index: 1; width: 100%; max-width: 680px; padding: 40px 20px 56px; }
  .brand { display: flex; align-items: center; gap: 10px; font-family: Sora, sans-serif; font-weight: 700; font-size: 18px;
    color: inherit; text-decoration: none; margin-bottom: 28px; }
  .brand img { width: 40px; height: 40px; border-radius: 10px; }
  h1 { font-family: Sora, sans-serif; font-weight: 700; font-size: 30px; line-height: 1.2; letter-spacing: -0.5px; margin: 0 0 8px; }
  h2 { font-family: Sora, sans-serif; font-weight: 700; font-size: 19px; margin: 32px 0 8px; }
  p, li { color: #C4D3C7; font-size: 16px; line-height: 1.6; }
  p { margin: 0 0 12px; }
  ul { padding-left: 20px; margin: 0 0 12px; }
  li { margin-bottom: 6px; }
  b { color: #F3F6F0; }
  a { color: #8FD19E; }
  .muted { color: #839287; font-size: 14px; }
  .lead { font-size: 18px; color: #F3F6F0; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 14px; }
  th, td { text-align: left; vertical-align: top; padding: 10px 8px; border-bottom: 1px solid #FFFFFF1F; color: #C4D3C7; line-height: 1.5; }
  th { color: #F3F6F0; font-family: Sora, sans-serif; font-weight: 600; }
  .wrap { overflow-x: auto; }
  .button { display: inline-block; margin-top: 12px; padding: 16px 28px; border-radius: 999px; background: #FF7A5C; color: #1A0B06;
    font-family: Sora, sans-serif; font-weight: 700; font-size: 17px; text-decoration: none; box-shadow: 0 10px 30px #FF7A5C59; }
  footer { margin-top: 40px; display: flex; gap: 18px; flex-wrap: wrap; font-size: 14px; }
</style>
</head><body><main>
<a class="brand" href="/"><img src="/icon.png" alt="">FotoThis</a>
${body}
<footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:${escapeHtml(config.contactEmail)}">${escapeHtml(config.contactEmail)}</a></footer>
</main></body></html>`;
}

export function homePage() {
  return page({
    title: "FotoThis: App Blocker & Focus",
    description: "Trade scrolling for exploring.",
    body: `
<h1>Trade scrolling for exploring.</h1>
<p class="lead">FotoThis locks the apps you lose hours to until you step outside and take a photo of nature. Every verified photo and every 1,000 steps earns minutes back.</p>
<p>Invite up to 7 friends to a 7-day Outside Challenge and see who gets out the most.</p>
<a class="button" href="${escapeHtml(config.appStoreUrl)}">Get FotoThis on the App Store</a>
<h2>Support</h2>
<p>Questions or problems? Email <a href="mailto:${escapeHtml(config.contactEmail)}">${escapeHtml(config.contactEmail)}</a>. Manage or cancel your subscription in the iPhone Settings app → your name → Subscriptions.</p>`,
  });
}

export function privacyPage() {
  const email = escapeHtml(config.contactEmail);
  return page({
    title: "Privacy Policy · FotoThis",
    description: "What FotoThis keeps on your phone, what it sends, and for how long.",
    body: `
<h1>Privacy Policy</h1>
<p class="muted">Last updated ${UPDATED}</p>
<p class="lead">FotoThis has no accounts. Your photo collection, your exact location and your Screen Time choices stay on your iPhone. We send only what's needed to name a plant and, if you join one, to run an Outside Challenge with your friends.</p>

<h2>Who we are</h2>
<p>FotoThis is made by Acrypt ApS, Copenhagen, Denmark (CVR DK43269054) ("we"). We are responsible for the data described here. Contact: <a href="mailto:${email}">${email}</a>.</p>

<h2>What stays on your iPhone</h2>
<p>These are used and kept only on your phone. We never receive them:</p>
<ul>
  <li><b>Your photos</b> from both cameras, including the selfie. The checks that decide an unlock (outdoor scene, selfie, repeat photo, movement) all run on the phone.</li>
  <li><b>Your location</b>, used to check you've moved and to work out sunset and the weather bonus.</li>
  <li><b>Your steps</b> from Apple Health.</li>
  <li><b>The apps you lock.</b> Apple's Screen Time gives FotoThis an encrypted token for each app, not its name or what you do in it.</li>
  <li>Your onboarding answers (first name, age range, scroll habits), minutes, streaks and collection.</li>
</ul>
<p>For the weather bonus, your phone asks Apple WeatherKit for the current weather at your location (under <a href="https://www.apple.com/legal/privacy/">Apple's privacy policy</a>), or <a href="https://open-meteo.com/en/terms">Open-Meteo</a> if Apple doesn't answer (Open-Meteo gets your position rounded to about 1 km). They receive it for that request only, not who you are.</p>

<h2>Naming a plant</h2>
<p>When you take a verified photo, FotoThis sends the back-camera photo (never the selfie), made smaller, to our server, together with your approximate position (rounded to about 1 km).</p>
<ul>
  <li>The position is used only to choose the right regional flora. It isn't stored and isn't passed on.</li>
  <li>The photo is passed to <b>Pl@ntNet</b> (a French research consortium: Cirad, INRAE, Inria and IRD) to name the plant, under <a href="https://plantnet.org/en/privacy-policy/">Pl@ntNet's privacy policy</a>. We don't store the photo.</li>
  <li>The plant's name and its Wikipedia article (no photo, nothing about you) go to <b>Groq</b>, an AI service, to pick a few facts. Facts are kept per species and language for up to 180 days so others get them faster.</li>
  <li>To tell whether the plant is common, seasonal or rare near you, our server asks <b>GBIF</b> (the Global Biodiversity Information Facility, an open science database) how often it has been recorded in a roughly 100 km square around you. GBIF gets the plant's name and that square only, never the photo or your exact position. The answer is kept per plant and square for up to 30 days.</li>
  <li>To limit free-trial lookups to 3 a day, the server counts lookups against an anonymous device key. The count is deleted after 2 days.</li>
</ul>

<h2>Checking your subscription and your app</h2>
<ul>
  <li><b>Subscription:</b> your App Store transaction ID is sent so our server can ask Apple whether you're subscribed. The answer is kept for 1 hour. Payment is handled by Apple; we never see your card or Apple ID.</li>
  <li><b>App Attest:</b> Apple's App Attest proves requests come from the real FotoThis app. We keep the anonymous public key it creates for this install.</li>
</ul>

<h2>Outside Challenges</h2>
<p>Only if you create or join a challenge, FotoThis creates an anonymous member ID on your phone and sends:</p>
<div class="wrap"><table>
<tr><th>Data</th><th>Why</th></tr>
<tr><td>Anonymous member ID</td><td>To recognise your phone. Not linked to your name, email, phone number or Apple ID.</td></tr>
<tr><td>Nickname and colour you choose</td><td>Shown to your crew on the board.</td></tr>
<tr><td>Daily totals: whether you went outside, number of verified photos, names of new plants, locked minutes, emergency unlocks, and whether you loosened your locked apps or turned off Screen Time access that day</td><td>To score the challenge and show it to your crew.</td></tr>
<tr><td>Daily steps (only with "Share my daily steps with this crew" on; you can turn it off)</td><td>Shown to your crew.</td></tr>
<tr><td>Time zone</td><td>To know which day it is for you and to keep notifications out of quiet hours.</td></tr>
<tr><td>Push notification token</td><td>To tell you when a friend joins, goes outside, cheers or nudges you.</td></tr>
<tr><td>Cheers, nudges and joins</td><td>Shown in your crew's feed.</td></tr>
</table></div>
<p><b>Who sees it:</b> only the people in your challenge (up to 8). There's no public profile, no chat and no global leaderboard. We never send photos, faces or locations for challenges.</p>
<p><b>How long we keep it:</b></p>
<ul>
  <li>A challenge and everything in it is deleted 30 days after it ends.</li>
  <li>A challenge nobody joins is deleted after 30 days.</li>
  <li>If you leave a challenge, or the creator removes you, your progress in it is deleted.</li>
  <li>A member ID that hasn't been in a challenge for 90 days is deleted with its nickname and push token.</li>
</ul>

<h2>Invite links</h2>
<p>Opening an invite link at fotothis.one/c/… shows the inviter's nickname, colour and who has joined. The page shows no scores.</p>

<h2>What we don't do</h2>
<ul>
  <li>No advertising, no tracking across apps or websites, no analytics or advertising SDKs.</li>
  <li>We don't sell or share your data with anyone except the services named above, which act only to provide FotoThis.</li>
</ul>

<h2>Where it's processed</h2>
<p>Our server runs on <b>Vercel</b> in the United States; challenge data is stored in a <b>Neon</b> Postgres database in Frankfurt, Germany (EU), and short-lived counters in <b>Upstash</b> Redis. Where data leaves the EU/EEA, these providers use the European Commission's Standard Contractual Clauses. Like any web server, ours sees your IP address; we use it only to stop abuse (rate limits, kept up to 1 hour) and in short-lived server logs.</p>

<h2>Legal basis (GDPR)</h2>
<p>We process this data to provide the app you asked for (contract), and to keep it safe from abuse (legitimate interest). Sharing steps with your crew is your choice and can be turned off at any time (consent).</p>

<h2>Your rights</h2>
<p>You can ask to see, correct or delete your data, or object to its use. Because there's no account, we can't tell which data is yours without your member ID. In the app, Settings › Delete my challenge data deletes your member ID, nickname, push token and all your challenge progress from our server straight away. You can also email us at <a href="mailto:${email}">${email}</a> for anything else. You can also complain to your data protection authority (in Denmark, <a href="https://www.datatilsynet.dk">Datatilsynet</a>).</p>

<h2>Children</h2>
<p>FotoThis is for people aged 13 and over. We don't knowingly collect data from younger children.</p>

<h2>Changes</h2>
<p>If this policy changes, we'll update this page and the date at the top. Important changes will also be shown in the app.</p>`,
  });
}

export function termsPage() {
  const email = escapeHtml(config.contactEmail);
  return page({
    title: "Terms of Use · FotoThis",
    description: "The terms for using FotoThis.",
    body: `
<h1>Terms of Use</h1>
<p class="muted">Last updated ${UPDATED}</p>
<p class="lead">These terms apply together with Apple's <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/">Standard End User License Agreement</a>. By using FotoThis you agree to both.</p>

<h2>The app</h2>
<p>FotoThis is made by Acrypt ApS, Copenhagen, Denmark (CVR DK43269054) ("we"). It helps you spend less time in distracting apps by locking them until you earn minutes outside. You must be 13 or older to use it.</p>

<h2>Subscriptions</h2>
<ul>
  <li>FotoThis needs a subscription: yearly or weekly, each with a 3-day free trial for new subscribers. Prices are shown in the app before you buy.</li>
  <li>Payment is charged to your Apple ID when the trial ends. The subscription renews automatically unless you cancel at least 24 hours before the end of the current period.</li>
  <li>Manage or cancel in the iPhone Settings app → your name → Subscriptions. Refunds are handled by Apple.</li>
</ul>

<h2>Screen Time</h2>
<p>FotoThis uses Apple's Screen Time to lock the apps you choose. You can change your apps or remove FotoThis's access in Settings at any time. The emergency unlock is always there if you need an app right away. FotoThis isn't a parental control or a medical treatment.</p>

<h2>Stay safe outside</h2>
<p>You decide when and where to go outside. Pay attention to traffic, weather, water and private property, don't trespass, and never take risks for a photo. Plant names and facts are automatic guesses and may be wrong: never eat or touch a plant because of what the app says.</p>

<h2>Outside Challenges</h2>
<ul>
  <li>Choose a nickname that isn't offensive and doesn't impersonate someone. Be kind with cheers and nudges.</li>
  <li>The challenge creator can remove members. We may remove nicknames or members that break these rules.</li>
  <li>Challenges are for fun; there are no prizes from us.</li>
</ul>

<h2>Fair play</h2>
<p>Don't try to trick the photo checks, reuse photos, or tamper with the app or our server. We may block lookups or challenge access for a device that does.</p>

<h2>Liability</h2>
<p>FotoThis is provided as it is. As far as the law allows, we aren't liable for indirect losses, or for anything that happens while you're outside. Nothing here limits rights you have as a consumer under the law of your country.</p>

<h2>Changes and contact</h2>
<p>We may update these terms; the date above shows the latest version. Danish law applies, except where your local consumer law gives you more protection. Questions: <a href="mailto:${email}">${email}</a>.</p>`,
  });
}
