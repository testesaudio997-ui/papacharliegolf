// Lista as lives que estão NO AR agora no canal.
// Com YOUTUBE_API_KEY (variável de ambiente no Netlify): usa a API oficial (mais confiável).
// Se a chave não existir ou falhar, confere os vídeos recentes do feed RSS e vê se a página marca "isLiveNow".
const CHANNEL_ID = "UCdz_Kbzu83ZE86LVcGFN0JA";
const UA = { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR,pt;q=0.9", "Cookie": "CONSENT=YES+1; SOCS=CAI" };
const dec = s => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// fetch com limite de tempo (o Netlify corta funções que passam de ~10 s)
async function ft(url, opts = {}, ms = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); }
  finally { clearTimeout(t); }
}

async function viaApi(ids, key) {
  const r = await ft(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(",")}&key=${key}`);
  if (!r.ok) throw new Error("api " + r.status);
  const j = await r.json();
  return (j.items || []).filter(v => v.snippet.liveBroadcastContent === "live")
    .map(v => ({ id: v.id, title: v.snippet.title }));
}

async function viaPagina(ids) {
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

exports.handler = async () => {
  try {
    const feed = await ft(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
    if (!feed.ok) throw new Error("feed " + feed.status);
    const xml = await feed.text();
    const ids = [...xml.matchAll(/<yt:videoId>(.*?)<\/yt:videoId>/g)].map(m => m[1]).slice(0, 10);

    let lives = [];
    const key = process.env.YOUTUBE_API_KEY;
    if (ids.length) {
      if (key) {
        try { lives = await viaApi(ids, key); }
        catch (e) { lives = await viaPagina(ids); } // chave inválida/API desligada: tenta sem chave
      } else {
        lives = await viaPagina(ids);
      }
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30" },
      body: JSON.stringify(lives)
    };
  } catch (err) {
    return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: String(err) }) };
  }
};
