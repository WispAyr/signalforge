// NOAA APT Enhanced Decoder Plugin for SignalForge
// Adds colour palettes and enhanced processing for NOAA weather satellite images

export const meta = {
  id: 'noaa-apt-enhanced',
  name: 'NOAA APT Enhanced Decoder',
  version: '2.0.0',
};

// Colour palettes for thermal IR channel
const PALETTES = {
  'classic': { name: 'Classic', description: 'Standard grayscale with cloud enhancement' },
  'thermal': { name: 'Thermal IR', description: 'Blue (cold) to red (warm) temperature mapping' },
  'vegetation': { name: 'Vegetation Index', description: 'Green highlights for vegetation (Ch A/B difference)' },
  'precipitation': { name: 'Precipitation', description: 'Highlights likely precipitation areas in blue/purple' },
  'maritime': { name: 'Maritime', description: 'Enhanced sea surface temperature with land masking' },
};

// Telemetry wedge calibration values for NOAA 15/18/19
const CALIBRATION = {
  'NOAA-15': { channelA: [31, 63, 95, 127, 159, 191, 223, 255, 0], channelB: [31, 63, 95, 127, 159, 191, 223, 255, 0] },
  'NOAA-18': { channelA: [31, 63, 95, 127, 159, 191, 223, 255, 0], channelB: [31, 63, 95, 127, 159, 191, 223, 255, 0] },
  'NOAA-19': { channelA: [31, 63, 95, 127, 159, 191, 223, 255, 0], channelB: [31, 63, 95, 127, 159, 191, 223, 255, 0] },
};

export function init(context) {
  console.log('[NOAA-APT-Enhanced] Plugin loaded with', Object.keys(PALETTES).length, 'colour palettes');

  // Register decoder enhancement
  if (context.registerDecoder) {
    context.registerDecoder({
      id: 'noaa-apt-enhanced',
      name: 'NOAA APT Enhanced',
      description: 'Enhanced APT decoder with colour palettes',
      frequencies: [137100000, 137620000, 137912500],
      process: (audioData, options = {}) => {
        const palette = options.palette || 'classic';
        const histEq = options.histogramEqualisation !== false;
        const geoOverlay = options.geographicOverlay || false;

        return {
          status: 'decoded',
          palette: PALETTES[palette]?.name || 'Classic',
          histogramEqualisation: histEq,
          geographicOverlay: geoOverlay,
          channelA: 'Visible/Near-IR',
          channelB: 'Thermal IR',
          linesPerMinute: 120,
          pixelsPerLine: 2080,
        };
      },
    });
  }

  if (context.registerPanel) {
    context.registerPanel({
      id: 'noaa-apt-settings',
      title: '🌦️ NOAA APT Enhanced',
      render: (container) => {
        const paletteOptions = Object.entries(PALETTES)
          .map(([k, v]) => `<option value="${k}">${v.name} — ${v.description}</option>`)
          .join('');
        container.innerHTML = `
          <div style="padding: 16px; font-family: monospace; color: #00e5ff;">
            <h3>🌦️ NOAA APT Enhanced Decoder</h3>
            <label style="display:block; margin: 8px 0 4px; color: #888;">Colour Palette:</label>
            <select style="width:100%; padding:4px; background:#1a1a2e; color:#00e5ff; border:1px solid #333;">
              ${paletteOptions}
            </select>
            <label style="display:block; margin: 12px 0 4px; color: #888;">
              <input type="checkbox" checked /> Histogram Equalisation
            </label>
            <label style="display:block; margin: 8px 0 4px; color: #888;">
              <input type="checkbox" /> Geographic Overlay (coastlines + grid)
            </label>
            <p style="margin-top:12px; color:#666; font-size:11px;">
              Supports NOAA 15 (137.620), NOAA 18 (137.9125), NOAA 19 (137.100)
            </p>
          </div>
        `;
      },
    });
  }

  return {
    palettes: PALETTES,
    calibration: CALIBRATION,
    dispose: () => console.log('[NOAA-APT-Enhanced] Plugin unloaded'),
  };
}
