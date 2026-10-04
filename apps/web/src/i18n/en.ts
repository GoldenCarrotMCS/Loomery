/**
 * English message catalogue — the source of truth for the UI's text.
 *
 * Every other locale is typed as `Messages`, so adding a key here is a type
 * error until every locale has it. `test/i18n.test.ts` additionally checks that
 * no locale has an extra or empty key and that interpolation placeholders agree
 * across languages (a `{count}` that only exists in English renders as literal
 * text in the others).
 *
 * Inline markup inside strings: `code` for monospace, **bold** for emphasis.
 * Both are rendered by <RichText>, so the strings stay plain and translatable.
 */
export const en = {
  lang: { name: "English" },

  intro: {
    badge: "Java → Bedrock",
    title: "Watch a flat Java item become real Bedrock geometry",
    sub: "Java draws an item as stacked pixel layers with alpha. Bedrock needs six textured faces on real geometry. Scroll to peel the sprite apart, then watch the faces close into a cube.",
    step1Title: "A flat sprite",
    step1Desc: "What Java Edition actually renders: layer0…layerN stacked in Z, every one of them a flat plane with per-pixel alpha.",
    step2Title: "Peeled and remapped",
    step2Desc: "The layers separate and dissolve while UVs are remapped out of Java texture space into the new atlas tile.",
    step3Title: "A textured cube",
    step3Desc: "Six faces converge from their own directions into real geometry — ready for an attachable, animations and a render controller.",
    scrollHint: "Scroll",
    javaLabel: "Java: flat layers",
    bedrockLabel: "Bedrock: 6 faces",
    specLayers: "source layers",
    specLayersValue: "4",
    specFaces: "cube faces",
    specFacesValue: "6",
    specGeo: "geometry bones",
    specGeoValue: "4",
  },

  header: {
    tagline:
      "Convert a Java Edition resource pack into a Bedrock pack plus Geyser mappings — custom items, 3D models, armor, furniture, fonts and sounds.",
    badgeLocal: "Runs in your browser",
    badgePrivate: "Files never uploaded",
    badgeOpenSource: "Open source",
  },

  rail: {
    packs: "Your packs",
    empty: "No pack staged",
    emptyHint: "Drop a resource pack in the workspace, or pick one below.",
    chooseFile: "Choose file…",
    staged: "Staged pack",
    stagedHint: "Remove it to pick a different one.",
    mergeHint:
      "**#1 wins** any file two packs both contain. Sounds, language files, atlases and fonts are merged instead, so nothing is lost from those.",
    packsCount: "{count} packs — merged into one",
    totalSize: "{size} MB total",
    addAnother: "Click to add another pack",
    moveUp: "Move up (higher priority)",
    moveDown: "Move down (lower priority)",
    remove: "Remove",
    options: "Options",
    output: "Output size",
    outputHint: "Shapes the generated pack. None of it changes what players see.",
    optimize: "Lossless optimization",
    optimizeHint: "Minify JSON, merge duplicate textures, drop unused ones.",
    maxCompress: "Maximum compression",
    maxCompressHint: "Recompresses large textures for ~12% more off them. Adds a minute or two.",
    effort: "Compression effort — level {level} {tone}",
    effortFast: "(fastest)",
    effortBalanced: "(balanced)",
    effortSlow: "(smallest, slowest)",
    effortHint: "Higher levels trade minutes for a few percent more. Gains past level 4 are usually small.",
    animate2d: "Animate held 2D items",
    animate2dHint:
      "Plays sprite frames while the item is held. Icons stay on frame one, and held items render as flat cards.",
    configs: "Plugin configs",
    configsHint: "What makes base items, display names, armor sets and furniture come out right.",
    configsLoaded: "Configs loaded",
    configsCount: "{count} configs",
    advanced: "Advanced",
    material: "Attachable material (3D items)",
    baseItem: "Fallback base item",
    baseItemHint: "Used when a 1.21.4+ item asset does not name the vanilla item it belongs to.",
    frames: "Animation quality (max flipbook frames)",
    framesFull: "Full animation (default)",
    framesN: "{n} frames",
    framesHint: "Lower means a smaller pack and faster downloads.",
  },

  convert: {
    action: "Convert pack",
    needPack: "Add a resource pack to get started.",
    ready: "Add configs and options first — then convert.",
  },

  work: {
    workspace: "Workspace",
    welcome: "Drop a pack to begin",
    welcomeHint:
      "Everything runs locally in a Web Worker. Large packs take a minute or two; you can keep using the tab.",
    converting: "Converting {name}",
    stage: "{stage} · {done}/{total}",
    cancel: "Cancel",
    cancelHint: "Everything is running on your machine — this is the slow part.",
  },

  drop: {
    title: "Drop your Java resource pack here",
    sub: ".zip, .mcpack or .tar.gz — drop several to merge them into one Bedrock pack",
    pick: "or click to browse",
    notSupported: '"{name}" is not a .zip, .mcpack or .tar.gz',
    tooBig: '"{name}" is over {limit} MB',
    duplicate: '"{name}" is already added',
    overTotal: '"{name}" would take the total over {limit} MB',
    another: "{size} MB total — click to add another pack",
  },

  result: {
    done: "Conversion complete",
    again: "Convert another",
    statConverted: "Converted",
    statApproximated: "Approximated",
    statSkipped: "Skipped",
    statErrors: "Errors",
    furnitureMappings: "furniture mappings.yml",
    furnitureConfig: "furniture config.yml (seats furniture)",
    modelEngine: "ModelEngine models (input.zip)",
    reportJson: "report.json",
    reportTitle: "Conversion report",
    reportSub: "What happened to every asset in the pack.",
    all: "All",
    empty: "Nothing with this status.",
    more: "…and {count} more — see report.json",
    columnStatus: "Status",
    columnStage: "Stage",
    columnSource: "Source",
    columnDetail: "Detail",
    statusConverted: "Converted",
    statusApproximated: "Approximated",
    statusSkipped: "Skipped",
    statusError: "Error",
    perf: "Performance — {total} total",
    perfStage: "By stage",
    perfOps: "Hot operations",
  },

  plugins: {
    title: "Required plugins & extensions",
    sub: "Install these on your server so Bedrock players see the converted content.",
    geyser: "Geyser",
    geyserNote: "lets Bedrock players join; loads the .mcpack and mappings",
    floodgate: "Floodgate",
    floodgateNote: "Bedrock auth, no Java account needed",
    displayEntity: "GeyserDisplayEntity",
    displayEntityNote: "renders furniture and placed display-entity items on Bedrock",
    modelEngine: "GeyserModelEngine (extension + Spigot plugin)",
    modelEngineNote: "renders ModelEngine / MythicMobs mob models on Bedrock",
    utils: "GeyserUtils",
    utilsNote: "required by GeyserModelEngine for Bedrock-side features",
  },

  guide: {
    title: "Setup guide",
    sub: "Where each generated file goes on your server.",
    required: "Required",
    baseTitle: "1. Resource pack + Geyser",
    base1: "Install **Geyser** and **Floodgate** on your server or proxy.",
    base2: "Drop the **.mcpack** into Geyser's `packs/` folder.",
    base3: "Put the mapping json ({files}) into Geyser's `custom_mappings/` folder.",
    base4: "Set `enable-custom-content: true` in Geyser's `config.yml` — needed for custom blocks.",
    base5: "Restart Geyser. Bedrock players now see the custom items and textures.",
    furnitureTitle: "2. Furniture (GeyserDisplayEntity)",
    furniture1:
      "Download the **GeyserDisplayEntity** extension jar into Geyser's `extensions/` folder. Restart once so it creates its folders.",
    furniture2: "Put `geyser_displayentity_mappings.yml` in `extensions/geyserdisplayentity/Mappings/`.",
    furniture3:
      "Put `geyserdisplayentity_config.yml` in `extensions/geyserdisplayentity/` (back up your own first). The global y-offset and height here are what seat furniture on the floor — without it pieces float about a block up.",
    furniture4: "Restart Geyser. Furniture your plugin places now renders for Bedrock players.",
    mobTitle: "{n}. ModelEngine / MythicMobs mobs (GeyserModelEngine)",
    mob1:
      "Server plugins: keep **ModelEngine** and **MythicMobs**, then add **GeyserModelEngine** (Spigot) and **GeyserUtils** (Spigot).",
    mob2: "Geyser extensions: put **GeyserModelEngineExtension** and **geyserutils-geyser** into `extensions/`.",
    mob3:
      "On a proxy (Velocity/Bungee), set `send-floodgate-data: true` in Floodgate and copy `key.pem` to the backends.",
    mob4:
      "Start the server once so the extension creates its folders, then unzip `modelengine_input.zip` into `extensions/geysermodelengineextension/input/` — the zip is already laid out per model.",
    mob5:
      "Reload Geyser. The extension generates the Bedrock pack from `input/` and applies it automatically, with no manual pack install.",
    mob6: "Spawn a mob through MythicMobs or MCPets as usual; Bedrock players now see the model.",
  },

  nudge: {
    title: "Items may not map correctly — upload a plugin config zip",
    action: "Convert again with config",
  },

  error: {
    title: "Conversion failed",
    retry: "Try again",
  },

  features: {
    title: "What it converts",
    sub: "Coverage is broad but not total — anything that cannot map cleanly is reported instead of silently dropped.",
    vanilla: {
      title: "Vanilla retextures",
      desc: "Blocks, items, entities, armor and environment textures, remapped through a verified rename table.",
    },
    legacyItems: {
      title: "Legacy custom items",
      desc: "custom_model_data overrides from 1.14 onwards, emitted as Geyser v2 legacy mappings.",
    },
    modernItems: {
      title: "Modern item definitions",
      desc: "1.21.4+ items/*.json, including condition, select and range_dispatch predicates.",
    },
    sprites: {
      title: "2D sprites",
      desc: "Multi-layer items composited into a single icon, with generated and handheld parents resolved.",
    },
    models3d: {
      title: "3D models",
      desc: "Geometry, atlases, attachables and display-transform animations for held and worn items.",
    },
    armor: {
      title: "Custom armor",
      desc: "Modern equipment assets and legacy layer textures, bound to the vanilla armor geometries.",
    },
    elytra: { title: "Elytra wings", desc: "Wing layers converted into a working elytra attachable." },
    flipbooks: { title: "Animated textures", desc: "Block flipbooks via flipbook_textures.json; item icons use frame one." },
    bowPull: { title: "Bow pull frames", desc: "Charge-progress render controllers for vanilla and custom-model bows." },
    blocks: { title: "Custom blocks", desc: "State overrides on note_block, tripwire and friends, with Geyser block mappings." },
    furniture: { title: "Furniture", desc: "Display-entity furniture for GeyserDisplayEntity, seated and scaled correctly." },
    mobs: { title: "ModelEngine mobs", desc: ".bbmodel blueprints converted to a GeyserModelEngine input bundle." },
    sounds: { title: "Sounds & language", desc: "sounds.json plus ogg files, and lang files with positional arguments rewritten." },
    fonts: { title: "Bitmap fonts", desc: "Custom glyph pages, sized to Java's height metric rather than their source resolution." },
    paintings: { title: "Paintings", desc: "Stitched into the Bedrock kz.png atlas, with a warning when only some are overridden." },
    merge: { title: "Multi-pack merge", desc: "Stack several packs into one, with the first winning each contested path." },
  },

  pluginsRow: {
    title: "Reads configs from",
    sub: "Upload a plugin's config folder as a zip to unlock real base items, display names, armor sets and furniture.",
  },

  faq: {
    title: "Questions",
    q1: "Do my files get uploaded anywhere?",
    a1: "No. The whole conversion runs inside a Web Worker in this tab. Nothing is sent to a server, and there is no account or rate limit.",
    q2: "Why does an asset say *approximated*?",
    a2: "Something could be converted but not perfectly — a tint that Java applies server-side, an item icon that Bedrock cannot animate, a texture with no exact equivalent. The detail column says exactly what was lost and usually how to fix it.",
    q3: "Why upload a plugin config zip?",
    a3: "A pack alone does not say which vanilla item a custom model replaces — that lives in the server plugin's config. Without it, modern items fall back to a generic base item and names are guessed from filenames.",
    q4: "Furniture floats a block up. What now?",
    a4: "Install the generated `geyserdisplayentity_config.yml`. Its global y-offset and height are what seat furniture on the floor; the per-item mappings assume they are present.",
    q5: "Can I convert a stack of packs at once?",
    a5: "Yes — drop them together and they merge into one Bedrock pack, because a Bedrock client can only be sent a single pack. The first upload wins any file two packs both define.",
  },

  footer: {
    local: "Everything runs locally in your browser — your pack is never uploaded anywhere.",
    source: "Source on GitHub",
    docs: "Geyser custom items docs",
    license: "GPL-3.0",
  },
};

export type Messages = typeof en;
