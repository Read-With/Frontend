// Compute color and label text from positivity value (-1..1)
export function getRelationStyle(positivity) {
  const value = typeof positivity === 'number' ? positivity : 0;
  const h = (120 * (value + 1)) / 2; // -1~1 → 0~120
  const color = `hsl(${h}, 70%, 45%)`;
  if (value > 0.6) return { color, text: "긍정적" };
  if (value > 0.3) return { color, text: "우호적" };
  if (value > -0.3) return { color, text: "중립적" };
  if (value > -0.6) return { color, text: "비우호적" };
  return { color, text: "부정적" };
}


