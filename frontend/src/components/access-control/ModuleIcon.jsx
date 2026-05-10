// ════════════════════════════════════════════════════════════════════
// ModuleIcon — colored circle + inline SVG glyph used in every view.
// Pure presentational. Resolves the icon key + tone from feature_key
// and section so callers don't have to repeat the lookup.
// ════════════════════════════════════════════════════════════════════

import { iconKeyFor, toneFor, iconSvg } from "./moduleIcons";

export default function ModuleIcon({ featureKey, section, size = 34, glyphSize = 18 }) {
  const tone = toneFor(section);
  const key  = iconKeyFor(featureKey, section);
  const html = iconSvg(key, glyphSize);

  return (
    <span
      className={`acc-mod-ico ${tone}`}
      style={size !== 34 ? { width: size, height: size } : undefined}
      // SVG comes from a static map, not user input — safe to inject.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
