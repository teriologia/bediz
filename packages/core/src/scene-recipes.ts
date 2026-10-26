/**
 * Sahne/atmosfer tarifleri: LLM'in kopyalayıp uyarlayacağı, şemaya karşı test edilen katman dizileri (1280×720 gece sahnesi için).
 * Her tarif kendi başına çalışır; boyut/renk değiştirerek uyarla. Koordinatlar tuval pikselidir.
 */
const sol = (color: string) => ({ kind: "solid", color });
export const SCENE_RECIPES: Record<string, { about: string; layers: object[] }> = {
  night_sky: {
    about: "Gece gökyüzü: üstten alta koyu→lacivert gradyan + ince gren.",
    layers: [
      { id: "sky", kind: "box", inset: 0, fill: { kind: "linear", angle: 90, stops: [[0, "#05070d"], [0.6, "#101a2a"], [1, "#1c2a3c"]] } },
    ],
  },
  moon_halo: {
    about: "Ay + yumuşak ışıma: halo büyük bulanık daire (blend screen), ay diskinin üstüne soluk radyal leke. Ay diski düz çizilirse yapay durur, mutlaka halo ekle.",
    layers: [
      { id: "moon_halo", kind: "ellipse", cx: 960, cy: 190, rx: 150, ry: 150, fill: sol("#9fb4d8"), opacity: 0.55, blend: "screen", effects: [{ kind: "blur", radius: 40 }] },
      { id: "moon", kind: "ellipse", cx: 960, cy: 190, rx: 62, ry: 62, fill: { kind: "radial", stops: [[0, "#f4f6ff"], [1, "#b8c4de"]] } },
      { id: "moon_marks", kind: "ellipse", cx: 960, cy: 190, rx: 62, ry: 62, fill: { kind: "noise", style: "clouds", scale: 3, seed: 5, colors: ["#8b97b5", "#dfe6f7"] }, opacity: 0.35, blend: "multiply" },
    ],
  },
  mist: {
    about: "Sis bandı: yatay uzun bulanık elips (screen) + bulut dokusu (overlay). Sahne katmanlarının ARASINA koy: arkadaki dağ/kule sisin içinde kalır, derinlik verir.",
    layers: [
      { id: "mist_band", kind: "ellipse", cx: 640, cy: 560, rx: 700, ry: 70, fill: sol("#8fa3bd"), opacity: 0.35, blend: "screen", effects: [{ kind: "blur", radius: 30 }] },
      { id: "mist_fbm", kind: "box", x: 0, y: 470, w: 1280, h: 180, fill: { kind: "noise", style: "clouds", scale: 3, seed: 2, colors: ["#000000", "#c8d4e6"] }, opacity: 0.25, blend: "screen", mask: { layer: "mist_fade", use: "luma" } },
      { id: "mist_fade", kind: "box", x: 0, y: 470, w: 1280, h: 180, hidden: true, fill: { kind: "linear", angle: 90, stops: [[0, "#000000"], [0.5, "#ffffff"], [1, "#000000"]] } },
    ],
  },
  mountains: {
    about: "Dağ silueti: path ile tırtıklı üst kenar, alt kenarı tuvalin altında; iki sıra (uzak soluk, yakın koyu) derinlik verir. Uzak sıraya blur 1-2 ekle.",
    layers: [
      { id: "mtn_far", kind: "path", d: "M0,520 L90,430 L170,480 L270,390 L380,470 L470,420 L600,500 L720,410 L840,480 L960,420 L1100,490 L1280,430 L1280,720 L0,720 Z", fill: sol("#17243a"), effects: [{ kind: "blur", radius: 1.5 }] },
      { id: "mtn_near", kind: "path", d: "M0,600 L140,520 L260,590 L400,500 L560,600 L700,540 L860,610 L1020,520 L1160,590 L1280,540 L1280,720 L0,720 Z", fill: sol("#0b1220") },
    ],
  },
  tower_silhouette: {
    about: "Kule/kale silüeti: polygon (düz kenar + sivri tepe), pencereler küçük sıcak ışıklı kutular (glow). Gövdeyi tek renkli koyu bırak, dokuyu üstüne ekleme: siluet okunur kalır. Üst kenara distort ekle ki mekanik durmasın.",
    layers: [
      { id: "tower_body", kind: "polygon", points: [[1020, 720], [1020, 330], [1050, 330], [1050, 280], [1075, 150], [1100, 280], [1100, 330], [1130, 330], [1130, 720]], fill: sol("#070b14"), effects: [{ kind: "distort", amount: 1.2, scale: 9 }] },
      { id: "tower_win", kind: "box", x: 1066, y: 420, w: 18, h: 34, radius: 9, fill: sol("#ffb347"), effects: [{ kind: "glow", blur: 8, color: "#ff9a2e", opacity: 0.9 }] },
    ],
  },
  torn_paper: {
    about: "Yırtık/yaşlı kâğıt: parşömen malzeme + distort (kenar bozma) + gölge. amount 5-9, scale 10-16 iyi çalışır.",
    layers: [
      { id: "paper", kind: "box", x: 80, y: 60, w: 400, h: 560, fill: { kind: "material", preset: "parchment", seed: 4, wear: 0.4 }, effects: [{ kind: "distort", amount: 7, scale: 14 }, { kind: "shadow", dx: 2, dy: 5, blur: 6, opacity: 0.7 }] },
    ],
  },
  vignette: {
    about: "Vinyet: en üst katman, kenarları karartır (radyal, ortası saydam). Sahnenin sonuna koy.",
    layers: [
      { id: "vignette", kind: "box", inset: 0, fill: { kind: "radial", stops: [[0.55, "#00000000"], [1, "#000000cc"]] } },
    ],
  },
};
