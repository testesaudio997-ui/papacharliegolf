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
// Devolve { videos: [4 últimos vídeos], streams: [4 últimas lives] }.
// Com YOUTUBE_API_KEY: lê a lista de uploads do canal e separa lives (têm liveStreamingDetails) de vídeos comuns.
// Sem chave: usa o feed RSS e confere cada página para saber se é uma live (menos confiável).
const N = 4;
const isoSeg = d => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || ""); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };

async function canalViaApi(key) {
  const playlist = "UU" + CHANNEL_ID.slice(2); // playlist de uploads do canal
  const vids = [], strs = [];
  let token = "";
  for (let p = 0; p < 4 && (vids.length < N || strs.length < N); p++) {
    const pl = await ft(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${playlist}&key=${key}${token ? "&pageToken=" + token : ""}`);
    if (!pl.ok) throw new Error("api playlist " + pl.status);
    const pj = await pl.json();
    const ids = (pj.items || []).map(i => i.contentDetails.videoId);
    if (ids.length) {
      const dr = await ft(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails&id=${ids.join(",")}&key=${key}`);
      if (!dr.ok) throw new Error("api videos " + dr.status);
      const dj = await dr.json();
      const byId = Object.fromEntries((dj.items || []).map(v => [v.id, v]));
      for (const id of ids) {
        const v = byId[id];
        if (!v) continue;
        const ld = v.liveStreamingDetails;
        if (ld) {
          const st = v.snippet.liveBroadcastContent;
          if (st === "upcoming") continue; // live agendada, ainda não começou
          strs.push({ id, title: v.snippet.title, date: ld.actualStartTime || v.snippet.publishedAt, live: st === "live" });
        } else {
          if (isoSeg(v.contentDetails.duration) <= 60) continue; // ignora Shorts
          vids.push({ id, title: v.snippet.title, date: v.snippet.publishedAt });
        }
      }
    }
    token = pj.nextPageToken;
    if (!token) break;
  }
  return { videos: vids.slice(0, N), streams: strs.slice(0, N) };
}

async function canalViaRss() {
  const res = await ft(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
  if (!res.ok) throw new Error("feed " + res.status);
  const xml = await res.text();
  const entries = xml.split("<entry>").slice(1, 16).map(e => ({
    id: (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1],
    title: dec((e.match(/<title>(.*?)<\/title>/) || [])[1] || ""),
    date: (e.match(/<published>(.*?)<\/published>/) || [])[1]
  })).filter(v => v.id);
  const marcados = await Promise.all(entries.map(async v => {
    try {
      const r = await ft(`https://www.youtube.com/watch?v=${v.id}`, { headers: UA }, 6000);
      const html = await r.text();
      return { ...v, live: /"isLiveContent":\s*true/.test(html) };
    } catch { return { ...v, live: false }; }
  }));
  return {
    videos: marcados.filter(v => !v.live).slice(0, N),
    streams: marcados.filter(v => v.live).slice(0, N)
  };
}

async function videos(env) {
  try {
    const key = env.YOUTUBE_API_KEY;
    let dados;
    if (key) {
      try { dados = await canalViaApi(key); }
      catch (e) { dados = await canalViaRss(); } // chave inválida/API desligada
    } else {
      dados = await canalViaRss();
    }
    return send(200, dados, "public, max-age=300");
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

/* ================= PAINEL (overlay) ================= */
// Repassa GET /api/painel/<caminho> para o painel do overlay (evita o bloqueio http x https e o CORS no navegador).
// Para trocar o endereço sem mexer no código: variável PAINEL_URL (Settings > Variables).
// Não pode ser o IP puro (o Cloudflare bloqueia com erro 1003): usa o nome criado no DNS (registro A "painel", DNS only).
const PAINEL_PADRAO = "http://painel.papacharliegolf.com.br:3010";
async function painel(env, caminho, search) {
  const base = (env.PAINEL_URL || PAINEL_PADRAO).replace(/\/$/, "");
  try {
    const r = await ft(`${base}/${caminho}${search}`, {
      headers: { "Accept": "application/json, */*", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36", "Referer": base + "/", "Origin": base }
    }, 8000);
    if (!r.ok) {
      const t = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
      throw new Error("painel " + r.status + (t ? " · " + t : ""));
    }
    return new Response(await r.text(), {
      status: 200,
      headers: { "Content-Type": r.headers.get("content-type") || "application/json", "Cache-Control": "public, max-age=15" }
    });
  } catch (err) {
    return send(502, { error: String(err) });
  }
}

/* ================= ROTEAMENTO ================= */
// Aceita /api/metar e também /.netlify/functions/metar (assim o index.html não precisa mudar).
export default {
  async fetch(request, env) {
    const { pathname, search } = new URL(request.url);
    const pn = request.method === "GET" && pathname.match(/^\/api\/painel\/([\w\-./]*)$/);
    if (pn && !pn[1].includes("..")) return painel(env, pn[1], search);
    const m = pathname.match(/^\/(?:api|\.netlify\/functions)\/(metar|live|videos|stats)\/?$/);
    if (m) {
      switch (m[1]) {
        case "metar": return metar(env);
        case "live": return live(env);
        case "videos": return videos(env);
        case "stats": return stats(env);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
