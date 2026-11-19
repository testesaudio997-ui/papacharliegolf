// Busca os últimos vídeos do canal pelo feed RSS público do YouTube.
const CHANNEL_ID = "UCdz_Kbzu83ZE86LVcGFN0JA";

exports.handler = async () => {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
    if (!res.ok) throw new Error("feed " + res.status);
    const xml = await res.text();
    const entries = xml.split("<entry>").slice(1, 13).map(e => ({
      id: (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1],
      title: ((e.match(/<title>(.*?)<\/title>/) || [])[1] || "")
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
      date: (e.match(/<published>(.*?)<\/published>/) || [])[1]
    })).filter(v => v.id);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      body: JSON.stringify(entries)
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: String(err) }) };
  }
};
