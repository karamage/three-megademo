import type { Chapter } from "../demo/timeline";

/** Frame the raw WebGL capture as a share-ready image with a quiet signature. */
export async function composeShareImage(blob: Blob, ch: Chapter): Promise<Blob> {
  const img = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.drawImage(img, 0, 0);

  const u = c.height / 1080;
  const grad = g.createLinearGradient(0, c.height * 0.72, 0, c.height);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,4,12,0.55)");
  g.fillStyle = grad;
  g.fillRect(0, c.height * 0.72, c.width, c.height * 0.28);

  await document.fonts.ready;
  const pad = 64 * u;
  g.fillStyle = "rgba(240,246,255,0.95)";
  g.textBaseline = "alphabetic";
  g.font = `italic 300 ${54 * u}px "Cormorant Garamond", serif`;
  g.fillText("Azure Eclipse", pad, c.height - pad - 30 * u);
  g.font = `400 ${17 * u}px "Inter", sans-serif`;
  g.fillStyle = "rgba(220,232,255,0.7)";
  const meta = `${ch.numeral}  ·  ${ch.en.toUpperCase()}  ·  ${ch.jp}`;
  g.fillText(meta.split("").join(String.fromCharCode(8202)), pad, c.height - pad + 6 * u);

  g.textAlign = "right";
  g.font = `400 ${15 * u}px "Inter", sans-serif`;
  g.fillStyle = "rgba(220,232,255,0.55)";
  g.fillText(location.host || "azure-eclipse", c.width - pad, c.height - pad + 6 * u);

  return new Promise((res) => c.toBlob((b) => res(b ?? blob), "image/jpeg", 0.93));
}
