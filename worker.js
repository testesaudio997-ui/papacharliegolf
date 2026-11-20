// Worker do Papa Charlie Golf TV: serve o site (assets) e as rotas /metar, /live, /videos e /stats.
// Chaves (Settings > Variables and secrets): REDEMET_API_KEY e YOUTUBE_API_KEY.
const CHANNEL_ID = "UCdz_Kbzu83ZE86LVcGFN0JA";
const UA = { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR,pt;q=0.9", "Cookie": "CONSENT=YES+1; SOCS=CAI" };
const dec = s => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const nf = n => Number(n).toLocaleString("pt-BR");

const send = (code, body, cache = "no-store") =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { "Content-Type": "application/json", "Cache-Control": cache }
  });

async function ft(url, opts = {}, ms = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); }
  finally { clearTimeout(t); }
}

/* ================= METAR ================= */
const REDEMET = "https://api-redemet.decea.mil.br/mensagens/metar/SBRF";
const fmt = d => d.toISOString().slice(0, 13).replace(/[-T]/g, "");

async function getMetarList(url) {
  const r = await ft(url, {}, 8000);
  if (!r.ok) throw new Error("redemet " + r.status);
  const j = await r.json();
  const d = j && j.data && (Array.isArray(j.data) ? j.data : j.data.data);
  return Array.isArray(d) ? d : [];
}

function parseMetar(raw) {
  const txt = raw.replace(/=/g, "").trim();
  const tk = txt.split(/\s+/);
  const out = { raw: txt, wind: { dir: null, spd: 0, gust: null, vrb: false } };
  const w = txt.match(/\b(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  if (w) out.wind = { dir: w[1] === "VRB" ? null : +w[1], spd: +w[2], gust: w[3] ? +w[3] : null, vrb: w[1] === "VRB" };
  const t = txt.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  const num = v => (v[0] === "M" ? -1 : 1) * parseInt(v.replace("M", ""), 10);
  if (t) { out.temp = num(t[1]); out.dew = num(t[2]); }
  const q = txt.match(/\bQ(\d{4})\b/); if (q) out.qnh = +q[1];

  const wx = tk.find(x => /^[-+]?(VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(DZ|RA|SN|GR|BR|FG|FU|HZ|DU|SA|SQ|FC|SS|DS)+$/.test(x));
  const cov = ["FEW", "SCT", "BKN", "OVC"].filter(c => new RegExp("\\b" + c + "\\d{3}").test(txt));
  const top = cov[cov.length - 1];
  let clima = { OVC: "Encoberto", BKN: "Nublado", SCT: "Parcialmente nublado", FEW: "Poucas nuvens" }[top] || "Céu claro";
  if (wx) {
    const forca = wx[0] === "+" ? " forte" : wx[0] === "-" ? " fraca" : "";
    if (/TS/.test(wx)) clima = "Trovoada";
    else if (/DZ/.test(wx)) clima = "Garoa";
    else if (/RA/.test(wx)) clima = (/SH/.test(wx) ? "Pancadas de chuva" : "Chuva") + forca;
    else if (/FG/.test(wx)) clima = "Nevoeiro";
    else if (/BR/.test(wx)) clima = "Névoa úmida";
    else if (/HZ/.test(wx)) clima = "Névoa seca";
  }
  out.clima = clima;

  out.rwy = null;
  if (out.wind.dir != null && out.wind.spd >= 3) {
    const rad = x => (x * Math.PI) / 180, d = out.wind.dir, s = out.wind.spd;
    const h18 = s * Math.cos(rad(d - 180)), h36 = s * Math.cos(rad(d - 360));
    out.rwy = h36 > h18 ? "36" : "18";
    out.head = Math.round(Math.max(h18, h36));
    out.cross = Math.round(Math.abs(s * Math.sin(rad(d - (out.rwy === "18" ? 180 : 360)))));
  }
  return out;
}

async function metar(env) {
  const key = env.REDEMET_API_KEY;
  if (!key) return send(500, { error: "REDEMET_API_KEY não configurada" });
  try {
    const now = new Date(), ini = new Date(now - 4 * 3600e3);
    let list = await getMetarList(`${REDEMET}?api_key=${key}&data_ini=${fmt(ini)}&data_fim=${fmt(now)}`);
    if (!list.length) list = await getMetarList(`${REDEMET}?api_key=${key}`);
    if (!list.length) return send(404, { error: "sem METAR recente" });
    list.sort((a, b) => String(a.validade_inicial).localeCompare(String(b.validade_inicial)));
    const last = list[list.length - 1];
    const m = parseMetar(last.mens || "");
    m.validade = last.validade_inicial;
    return send(200, m, "public, max-age=120");
  } catch (err) {
    return send(502, { error: String(err) });
  }
}

/* ================= LIVES ================= */
async function livesViaApi(ids, key) {
  const r = await ft(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(",")}&key=${key}`);
  if (!r.ok) throw new Error("api " + r.status);
  const j = await r.json();
  return (j.items || []).filter(v => v.snippet.liveBroadcastContent === "live")
    .map(v => ({ id: v.id, title: v.snippet.title }));
}

async function livesViaPagina(ids) {
  const checks = await Promise.all(ids.map(async id => {
    try {
      const r = await ft(`https://www.youtube.com/watch?v=${id}`, { headers: UA }, 6000);
      const html = await r.text();
      if (!/"isLiveNow":\s*true/.test(html)) return null;
      const t = (html.match(/<meta name="title" content="(.*?)">/) || [])[1] || "Live";
      return { id, title: dec(t) };
    } catch { return null; }
  }));
  return checks.filter(Boolean);
}

async function live(env) {
  try {
    const feed = await ft(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
    if (!feed.ok) throw new Error("feed " + feed.status);
    const xml = await feed.text();
    const ids = [...xml.matchAll(/<yt:videoId>(.*?)<\/yt:videoId>/g)].map(m => m[1]).slice(0, 10);
    let lives = [];
    const key = env.YOUTUBE_API_KEY;
    if (ids.length) {
      if (key) {
        try { lives = await livesViaApi(ids, key); }
        catch (e) { lives = await livesViaPagina(ids); }
      } else {
        lives = await livesViaPagina(ids);
      }
    }
    return send(200, lives, "public, max-age=30");
  } catch (err) {
    return send(502, { error: String(err) });
  }
}

/* ================= VÍDEOS ================= */
async function videos() {
  try {
    const res = await ft(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
    if (!res.ok) throw new Error("feed " + res.status);
    const xml = await res.text();
    const entries = xml.split("<entry>").slice(1, 13).map(e => ({
      id: (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1],
      title: dec((e.match(/<title>(.*?)<\/title>/) || [])[1] || ""),
      date: (e.match(/<published>(.*?)<\/published>/) || [])[1]
    })).filter(v => v.id);
    return send(200, entries, "public, max-age=300");
  } catch (err) {
    return send(502, { error: String(err) });
  }
}

/* ================= STATS ================= */
async function statsViaApi(key) {
  const r = await ft(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${CHANNEL_ID}&key=${key}`);
  if (!r.ok) throw new Error("api " + r.status);
  const j = await r.json();
  const s = j.items && j.items[0] && j.items[0].statistics;
  if (!s) throw new Error("canal não encontrado");
  return {
    inscritos: s.hiddenSubscriberCount ? null : nf(s.subscriberCount),
    visualizacoes: nf(s.viewCount),
    videos: nf(s.videoCount)
  };
}

async function statsViaPagina() {
  const r = await ft(`https://www.youtube.com/channel/${CHANNEL_ID}/about`, { headers: UA });
  if (!r.ok) throw new Error("pagina " + r.status);
  const html = await r.text();
  const pick = re => { const m = html.match(re); return m ? m[1] : null; };
  const num = t => (t ? t.replace(/\s*(inscritos?|visualizações|visualização|vídeos?|views|subscribers?|videos?)\s*$/i, "").trim() : null);
  const out = {
    inscritos: num(pick(/"subscriberCountText":\s*(?:\{"simpleText":\s*)?"([^"]+)"/)),
    visualizacoes: num(pick(/"viewCountText":\s*(?:\{"simpleText":\s*)?"([^"]+)"/)),
    videos: num(pick(/"videoCountText":\s*(?:\{"simpleText":\s*)?"([^"]+)"/))
  };
  if (!out.inscritos && !out.visualizacoes && !out.videos) throw new Error("não foi possível ler a página");
  return out;
}

async function stats(env) {
  try {
    const key = env.YOUTUBE_API_KEY;
    const dados = key ? await statsViaApi(key) : await statsViaPagina();
    return send(200, dados, "public, max-age=600");
  } catch (err) {
    return send(502, { error: String(err) });
  }
}

/* ================= ROTEAMENTO ================= */
// Aceita /api/metar e também /.netlify/functions/metar (assim o index.html não precisa mudar).
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const m = pathname.match(/^\/(?:api|\.netlify\/functions)\/(metar|live|videos|stats)\/?$/);
    if (m) {
      switch (m[1]) {
        case "metar": return metar(env);
        case "live": return live(env);
        case "videos": return videos();
        case "stats": return stats(env);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
