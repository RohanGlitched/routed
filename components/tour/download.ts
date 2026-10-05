/**
 * Saves the on-screen poster as a 2160 × 3200 PNG. An SVG drawn into a canvas can't see the page's web fonts,
 * so the wood-type font files the page already loaded are inlined into the copy first, and CSS variables
 * (inks, font family) are resolved to plain values.
 */
async function fontFaces(): Promise<string> {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule) || !/Shoulders/i.test(rule.style.getPropertyValue("font-family"))) continue;
      const m = rule.style.getPropertyValue("src").match(/url\(["']?([^"')]+)["']?\)/);
      if (!m) continue;
      const buf = await fetch(new URL(m[1]!, sheet.href ?? location.href)).then((r) => r.arrayBuffer());
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out.push(`@font-face{font-family:${rule.style.getPropertyValue("font-family")};src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2");font-weight:${rule.style.getPropertyValue("font-weight") || "100 900"};}`);
    }
  }
  return out.join("");
}

export async function downloadPoster(box: HTMLElement, name: string): Promise<void> {
  const svg = box.querySelector("svg");
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const cs = getComputedStyle(svg);
  const vars = ["--fire", "--blue", "--poster-stock"].map((v) => [v, getComputedStyle(document.documentElement).getPropertyValue(v).trim()] as const);
  // Class-based styles (font sizes, weights, letter-spacing) are copied inline from the live element.
  const live = svg.querySelectorAll("text");
  const copy = clone.querySelectorAll("text");
  copy.forEach((t, i) => {
    const c = getComputedStyle(live[i]!);
    t.setAttribute("style", `${t.getAttribute("style") ?? ""};font-family:${cs.fontFamily};font-weight:${c.fontWeight};font-size:${c.fontSize};letter-spacing:${c.letterSpacing}`);
  });
  clone.querySelectorAll("g").forEach((g) => g.removeAttribute("class"));
  clone.setAttribute("width", "2160");
  clone.setAttribute("height", "3200");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = await fontFaces();
  clone.insertBefore(style, clone.firstChild);
  let xml = new XMLSerializer().serializeToString(clone);
  for (const [v, val] of vars) xml = xml.replaceAll(`var(${v})`, val);

  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 2160;
  canvas.height = 3200;
  canvas.getContext("2d")!.drawImage(img, 0, 0, 2160, 3200);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-poster.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
