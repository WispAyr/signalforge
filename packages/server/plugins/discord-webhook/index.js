// Discord Webhook Plugin — posts events to Discord
const lastPost = new Map();

async function postToDiscord(webhookUrl, embed) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'SignalForge',
        avatar_url: 'https://raw.githubusercontent.com/WispAyr/signalforge/main/packages/client/public/icon-192.png',
        embeds: [embed],
      }),
    });
  } catch (err) {
    console.error(`[discord-webhook] Post failed: ${err.message}`);
  }
}

function shouldPost(eventType, cooldownMs) {
  const now = Date.now();
  const last = lastPost.get(eventType) || 0;
  if (now - last < cooldownMs) return false;
  lastPost.set(eventType, now);
  return true;
}

export default {
  activate(ctx) {
    const config = ctx.getConfig();
    const webhookUrl = config.webhookUrl;
    const cooldownMs = (config.cooldownSeconds || 60) * 1000;

    if (!webhookUrl) {
      ctx.log('No webhook URL configured — Discord notifications disabled');
      return;
    }

    ctx.log('Discord webhook active');

    // Emergency squawk detection
    if (config.notifyEmergency !== false) {
      ctx.registerWebSocket('discord_adsb', (data) => {
        if (!data.squawk) return;
        const emergencyCodes = { '7700': '🚨 EMERGENCY (Mayday)', '7600': '📻 RADIO FAILURE', '7500': '⚠️ HIJACK' };
        const desc = emergencyCodes[data.squawk];
        if (!desc) return;
        if (!shouldPost(`emergency-${data.icao}`, cooldownMs)) return;

        postToDiscord(webhookUrl, {
          title: `${desc}`,
          description: `**${data.callsign || data.icao}** squawking **${data.squawk}**`,
          color: 0xff0000,
          fields: [
            { name: 'Altitude', value: `${data.altitude || '?'} ft`, inline: true },
            { name: 'Speed', value: `${data.speed || '?'} kts`, inline: true },
            { name: 'Position', value: data.latitude ? `${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}` : 'Unknown', inline: true },
          ],
          timestamp: new Date().toISOString(),
        });
      });
    }

    // Pager keyword alerts
    if (config.notifyPagerAlerts !== false) {
      ctx.registerWebSocket('discord_pager_alert', (data) => {
        if (!shouldPost(`pager-${data.capcode}`, cooldownMs)) return;

        postToDiscord(webhookUrl, {
          title: `📟 Pager Alert: ${data.filterName || 'Keyword Match'}`,
          description: data.content?.slice(0, 500) || 'No content',
          color: 0xff6b6b,
          fields: [
            { name: 'Capcode', value: String(data.capcode || '?'), inline: true },
            { name: 'Protocol', value: data.protocol || 'POCSAG', inline: true },
          ],
          timestamp: new Date().toISOString(),
        });
      });
    }

    // New aircraft
    if (config.notifyNewAircraft) {
      const seenCallsigns = new Set();
      ctx.registerWebSocket('discord_new_aircraft', (data) => {
        if (!data.callsign || seenCallsigns.has(data.callsign)) return;
        seenCallsigns.add(data.callsign);
        if (seenCallsigns.size > 5000) seenCallsigns.clear(); // prevent memory leak

        if (!shouldPost('new-aircraft', cooldownMs / 10)) return; // faster cooldown for new aircraft

        postToDiscord(webhookUrl, {
          title: `✈️ New Aircraft: ${data.callsign}`,
          color: 0x00e5ff,
          fields: [
            { name: 'ICAO', value: data.icao || '?', inline: true },
            { name: 'Altitude', value: `${data.altitude || '?'} ft`, inline: true },
          ],
          timestamp: new Date().toISOString(),
        });
      });
    }

    // Stats/test endpoint
    ctx.registerRoute('get', '/status', (_req, res) => {
      res.json({
        configured: !!webhookUrl,
        lastPosts: Object.fromEntries(lastPost),
      });
    });

    ctx.registerRoute('post', '/test', async (_req, res) => {
      await postToDiscord(webhookUrl, {
        title: '🧪 SignalForge Test',
        description: 'Discord webhook is working!',
        color: 0x00e676,
        timestamp: new Date().toISOString(),
      });
      res.json({ ok: true });
    });
  },

  deactivate() {
    lastPost.clear();
  },
};
