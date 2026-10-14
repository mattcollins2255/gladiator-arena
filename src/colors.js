// Multiplies a colour's brightness (below 1 darkens, above 1 lightens).
export function shade(color, f) {
  const r = Math.min(255, ((color >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((color >> 8) & 255) * f) | 0;
  const b = Math.min(255, (color & 255) * f) | 0;
  return (r << 16) | (g << 8) | b;
}
