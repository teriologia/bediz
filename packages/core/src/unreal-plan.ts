import { toUnrealBrush, type Asset } from "./slice.js";
import { walk, type Node, type NodeType, type Slot, type Widget } from "./scene.js";

const TS = {
  umg: "UMGToolSet.UMGToolSet",
  obj: "editor_toolset.toolsets.object.ObjectTools",
  asset: "editor_toolset.toolsets.asset.AssetTools",
  tex: "editor_toolset.toolsets.texture.TextureTools",
  editor: "EditorToolset.EditorAppToolset",
} as const;

/** Adım argümanlarında `{ $ref: "Ad.widget" | "Ad.slot" }`, önceki bir AddWidget adımının (save: "Ad") sonucundan doldurulur. */
export interface PlanRef { $ref: string }
export interface PlanStep {
  id: string;
  toolset: string; // call_tool.toolset_name
  tool: string; // call_tool.tool_name (toolset öneki olmadan)
  arguments: Record<string, unknown>;
  save?: string; // AddWidget sonucundaki {widget, slot} bu adla saklanır
  optional?: boolean; // başarısız olması planı durdurmaz (ör. ekran görüntüsü)
  note?: string;
}
export interface UnrealPlan {
  folder: string;
  blueprint: string; // /Game/.../WBP_X
  textures: Record<string, string>; // bediz asset id → /Game/.../T_X
  steps: PlanStep[];
  howToRun: string[];
}
export interface PlanOptions {
  folder?: string; // varsayılan /Game/Bediz/<widget>
  sizeBox?: boolean; // kökü widget boyutunda SizeBox ile sar (varsayılan true; yoksa widget tüm alanı doldurur)
  verify?: boolean; // editörde açıp ekran görüntüsü alan isteğe bağlı adımlar ekle
}

const ref = (name: string, part: "widget" | "slot"): PlanRef => ({ $ref: `${name}.${part}` });
const ueName = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");
const zero = { left: 0, top: 0, right: 0, bottom: 0 };

/** #RRGGBB (sRGB) → UE FLinearColor. */
function linear(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return { r: +c[0].toFixed(5), g: +c[1].toFixed(5), b: +c[2].toFixed(5), a: 1 };
}

function slotValues(parent: NodeType | "SizeBox", slot: Slot | undefined): Record<string, unknown> {
  const s = slot ?? {};
  // UE'nin varsayılan hizaları bediz'inkinden farklıdır (Overlay: Left/Top); bu yüzden her zaman açık yazılır.
  const align = { horizontalAlignment: `HAlign_${s.hAlign ?? "Fill"}`, verticalAlignment: `VAlign_${s.vAlign ?? "Fill"}` };
  const padding = s.padding ?? zero;
  switch (parent) {
    case "CanvasPanel": {
      const a = s.anchors ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      return {
        layoutData: {
          offsets: s.offsets ?? { left: 0, top: 0, right: 100, bottom: 100 },
          anchors: { minimum: { x: a.minX, y: a.minY }, maximum: { x: a.maxX, y: a.maxY } },
          alignment: s.alignment ?? { x: 0, y: 0 },
        },
        bAutoSize: !!s.autoSize,
      };
    }
    case "HorizontalBox":
    case "VerticalBox":
      return { size: s.fill ? { sizeRule: "Fill", value: s.fill } : { sizeRule: "Automatic", value: 1 }, padding, ...align };
    default: // Overlay, Border, SizeBox
      return { padding, ...align };
  }
}

export function unrealPlan(widget: Widget, lookup: (assetId: string) => Asset | undefined, opts: PlanOptions = {}): UnrealPlan {
  const folder = opts.folder ?? `/Game/Bediz/${ueName(widget.id)}`;
  if (!/^\/Game(\/[A-Za-z0-9_]+)+$/.test(folder)) throw new Error(`folder /Game/... biçiminde olmalı (harf, rakam, _): ${folder}`);
  const wbpName = `WBP_${ueName(widget.id)}`, wbpPath = `${folder}/${wbpName}`;
  const bp = { refPath: `${wbpPath}.${wbpName}` };
  const steps: PlanStep[] = [];
  const push = (s: Omit<PlanStep, "id">) => void steps.push({ id: `s${steps.length + 1}`, ...s });
  const setProps = (instance: unknown, values: Record<string, unknown>, note?: string) =>
    Object.keys(values).length && push({ toolset: TS.obj, tool: "set_properties", arguments: { instance, values: JSON.stringify(values) }, note });

  // 1) kullanılan asset'ler
  const used = new Map<string, Asset>();
  for (const { node } of walk(widget.root)) {
    for (const id of [node.brush?.asset, node.states?.hovered?.asset, node.states?.pressed?.asset, node.states?.disabled?.asset, node.fill?.asset]) {
      if (!id) continue;
      const a = lookup(id);
      if (!a) throw new Error(`${node.id}: asset yok: ${id} (önce export_design ile dışa aktar)`);
      used.set(a.id, a);
    }
  }
  const textures: Record<string, string> = {}, texName = new Map<string, string>();
  for (const id of used.keys()) {
    let n = `T_${ueName(id)}`;
    while ([...texName.values()].includes(n)) n += "_";
    texName.set(id, n);
    textures[id] = `${folder}/${n}`;
  }

  push({ toolset: TS.asset, tool: "create_folder", arguments: { path: folder } });
  for (const [id, a] of used) {
    const name = texName.get(id)!;
    push({ toolset: TS.tex, tool: "import_file", arguments: { folder_path: folder, asset_name: name, source_file: a.path.replace(/\\/g, "/") } });
    // UI dokusu: sıkıştırma/mip/LOD grubu; tile'lar Wrap, çerçeve ve sprite'lar Clamp.
    setProps({ refPath: `${folder}/${name}.${name}` }, {
      compressionSettings: "TC_EditorIcon", mipGenSettings: "TMGS_NoMipmaps", lodGroup: "TEXTUREGROUP_UI",
      addressX: a.tile ? "TA_Wrap" : "TA_Clamp", addressY: a.tile ? "TA_Wrap" : "TA_Clamp",
    }, `${id}: UI dokusu ayarları`);
  }

  // 2) widget blueprint + ağaç
  push({ toolset: TS.umg, tool: "CreateWidgetBlueprint", arguments: { folderPath: folder, assetName: wbpName, parentClass: { refPath: "/Script/UMG.UserWidget" } } });

  const names = new Map<Node, string>(), taken = new Set<string>(["SizeBox"]);
  for (const { node } of walk(widget.root)) {
    let n = ueName(node.id);
    while (taken.has(n)) n += "_";
    taken.add(n);
    names.set(node, n);
  }
  const addWidget = (cls: string, name: string, parent?: string) => push({
    toolset: TS.umg, tool: "AddWidget", save: name,
    arguments: { widgetBlueprint: bp, widgetClass: { refPath: `/Script/UMG.${cls}` }, widgetDisplayName: name, ...(parent ? { parentWidget: ref(parent, "widget") } : {}) },
  });

  const sizeBox = opts.sizeBox ?? true;
  if (sizeBox) {
    // Widget'ın kendi boyutu yoktur; SizeBox, yerleşim panellerine istenen boyutu bildirir.
    addWidget("SizeBox", "SizeBox");
    setProps(ref("SizeBox", "widget"), { widthOverride: widget.width, heightOverride: widget.height, bOverride_WidthOverride: true, bOverride_HeightOverride: true }, "widget boyutu");
  }
  const brushJson = (a: Asset) => {
    const b = toUnrealBrush(a), n = texName.get(a.id)!;
    return {
      drawAs: b.DrawAs, imageSize: { x: b.ImageSize.X, y: b.ImageSize.Y }, resourceObject: `${folder}/${n}.${n}`,
      ...("Margin" in b && b.Margin ? { margin: { left: b.Margin.Left, top: b.Margin.Top, right: b.Margin.Right, bottom: b.Margin.Bottom } } : {}),
      ...("Tiling" in b && b.Tiling ? { tiling: b.Tiling } : {}),
    };
  };
  const brushOf = (n: Node) => (n.brush ? brushJson(used.get(n.brush.asset)!) : { drawAs: "NoDrawType", ...(n.size ? { imageSize: { x: n.size.x, y: n.size.y } } : {}) });
  // Button/ProgressBar stilleri UE'de varsayılan olarak gri tint'lidir; dokulu brush'ların renkleri bozulmasın diye beyaza çekilir.
  const white = { specifiedColor: { r: 1, g: 1, b: 1, a: 1 }, colorUseRule: "UseColor_Specified" };
  const styled = (b: Record<string, unknown>) => ({ ...b, tintColor: white });
  const stateBrush = (n: Node, k: "hovered" | "pressed" | "disabled") => (n.states?.[k] ? brushJson(used.get(n.states[k]!.asset)!) : brushOf(n));
  const widgetValues = (n: Node): Record<string, unknown> => {
    if (n.type === "Button") {
      return { widgetStyle: { normal: styled(brushOf(n)), hovered: styled(stateBrush(n, "hovered")), pressed: styled(stateBrush(n, "pressed")), disabled: styled(stateBrush(n, "disabled")) } };
    }
    if (n.type === "ProgressBar") {
      const i = n.inset ?? 0;
      return {
        widgetStyle: { backgroundImage: styled(brushOf(n)), fillImage: n.fill ? styled(brushJson(used.get(n.fill.asset)!)) : { drawAs: "NoDrawType" } },
        percent: n.percent ?? 0.5, barFillType: "LeftToRight", barFillStyle: "Scale", borderPadding: { x: i, y: i }, fillColorAndOpacity: { r: 1, g: 1, b: 1, a: 1 },
      };
    }
    if (n.type === "Image") return { brush: { ...brushOf(n), ...(n.size ? { imageSize: { x: n.size.x, y: n.size.y } } : {}) } };
    if (n.type === "Border") return { background: brushOf(n) };
    if (n.type === "TextBlock") return { text: n.text ?? "", font: { size: n.fontSize ?? 16 }, colorAndOpacity: { specifiedColor: linear(n.color ?? "#ffffff"), colorUseRule: "UseColor_Specified" } };
    return {};
  };

  const visit = (n: Node, parent: Node | undefined) => {
    const name = names.get(n)!;
    const parentName = parent ? names.get(parent)! : sizeBox ? "SizeBox" : undefined;
    addWidget(n.type, name, parentName);
    if (parentName) setProps(ref(name, "slot"), slotValues(parent ? parent.type : "SizeBox", n.slot), `${name}: yerleşim`);
    setProps(ref(name, "widget"), widgetValues(n), `${name}: görünüm`);
    for (const c of n.children) visit(c, n);
  };
  visit(widget.root, undefined);

  // 3) derle + kaydet
  push({ toolset: TS.umg, tool: "CompileWidgetBlueprint", arguments: { widgetBlueprint: bp } });
  push({ toolset: TS.asset, tool: "save_assets", arguments: { asset_paths: [wbpPath, ...Object.values(textures)] } });
  if (opts.verify) {
    push({ toolset: TS.editor, tool: "OpenEditorForAsset", arguments: { assetPath: wbpPath }, optional: true, note: "editörde bir sekme açar" });
    push({ toolset: TS.editor, tool: "CaptureEditorImage", arguments: {}, optional: true, note: "~4 sn bekledikten sonra; görüntü returnValue.data içinde base64 PNG" });
    // Editör asset'i açınca yeniden derleyip "kaydedilmemiş" işaretleyebilir.
    push({ toolset: TS.asset, tool: "save_assets", arguments: { asset_paths: [wbpPath] }, optional: true, note: "editör açıldıktan sonra tekrar kaydet" });
  }

  return {
    folder, blueprint: wbpPath, textures, steps,
    howToRun: [
      "Adımları SIRAYLA unreal-mcp'nin call_tool'uyla çalıştır: {toolset_name: step.toolset, tool_name: step.tool, arguments: step.arguments}.",
      "`save` adı olan adımların (AddWidget) sonucundan returnValue.widget ve returnValue.slot referanslarını o adla sakla.",
      "Argümanlardaki {\"$ref\": \"Ad.widget\"} veya {\"$ref\": \"Ad.slot\"} değerlerini sakladığın referansla değiştir.",
      "set_properties'in `values` alanı zaten JSON metnidir; olduğu gibi gönder. returnValue false ise dur ve nedeni araştır.",
      "Önce kullanıcıdan onay al: bu plan Unreal projesine asset ekler. Mevcut asset'lere dokunmaz ama folder'ı yeni/boş seç.",
      "Aynı plan, depodaki tools/run-unreal-plan.mjs ile tek komutla da çalıştırılabilir.",
    ],
  };
}
