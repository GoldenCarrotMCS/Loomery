import type { Messages } from "./en.js";

/**
 * 简体中文目录。
 *
 * 结构与 `en.ts` 完全一致：`Messages` 类型会强制这里包含每一个键，`test/i18n.test.ts`
 * 还会检查占位符是否与英文一致（只在英文里存在的 `{count}` 会在中文界面里按字面量渲染）。
 * 行内标记沿用同一套：`code` 是等宽代码，**bold** 是加粗，由 <RichText> 渲染。
 */
export const zhCN: Messages = {
  lang: { name: "简体中文" },

  intro: {
    badge: "Java → Bedrock",
    title: "看一个扁平的 Java 物品变成真正的 Bedrock 几何体",
    sub: "Java 版把物品画成一叠带透明通道的像素层。Bedrock 需要的却是真正几何体上的六面贴图。向下滚动，精灵图会逐层剥离，随后六个面合拢成方块。",
    step1Title: "一张扁平精灵图",
    step1Desc: "这是 Java 版实际渲染的东西：layer0…layerN 沿 Z 轴叠放，每一层都是带逐像素透明度的平面。",
    step2Title: "剥离与重映射",
    step2Desc: "各层分离并消散，同时 UV 从 Java 贴图空间重映射到新的图集区域。",
    step3Title: "一个带贴图的方块",
    step3Desc: "六个面从各自方向汇聚成真正的几何体 —— 接下来就能挂上 attachable、动画与渲染控制器。",
    scrollHint: "向下滚动",
    javaLabel: "Java：扁平分层",
    bedrockLabel: "Bedrock：六个面",
    specLayers: "源图层",
    specLayersValue: "4",
    specFaces: "方块面数",
    specFacesValue: "6",
    specGeo: "几何骨骼",
    specGeoValue: "4",
  },

  header: {
    tagline:
      "把 Java 版资源包转换为 Bedrock 资源包，并生成 Geyser 映射 —— 支持自定义物品、3D 模型、盔甲、家具、字体与音效。",
    badgeLocal: "全程在浏览器内运行",
    badgePrivate: "文件不会上传",
    badgeOpenSource: "开源",
  },

  rail: {
    packs: "你的资源包",
    empty: "尚未添加资源包",
    emptyHint: "把资源包拖到右侧工作区，或点击下方按钮选择文件。",
    chooseFile: "选择文件…",
    staged: "已添加的资源包",
    stagedHint: "移除后可以重新选择。",
    mergeHint:
      "两个包都包含同一个文件时，**#1 优先**。音效、语言文件、图集与字体则会被合并，这些内容不会丢失。",
    packsCount: "{count} 个资源包 — 将合并为一个",
    totalSize: "共 {size} MB",
    addAnother: "点击可再添加一个资源包",
    moveUp: "上移（提高优先级）",
    moveDown: "下移（降低优先级）",
    remove: "移除",
    options: "选项",
    output: "输出体积",
    outputHint: "只影响生成的资源包大小，不会改变玩家看到的内容。",
    optimize: "无损优化",
    optimizeHint: "压缩 JSON、合并重复贴图并清理未引用的贴图。",
    maxCompress: "最大压缩",
    maxCompressHint: "对大体量贴图重新压缩，通常还能再减小约 12%，代价是一两分钟的等待。",
    effort: "压缩强度 — 等级 {level} {tone}",
    effortFast: "（最快）",
    effortBalanced: "（均衡）",
    effortSlow: "（最小、最慢）",
    effortHint: "等级越高越慢，收益越小。超过 4 级之后提升通常很有限。",
    animate2d: "让手中的 2D 物品播放动画",
    animate2dHint:
      "手持时播放贴图序列帧。物品栏图标仍固定在第一帧，且手持物品会变成一张平面卡片。",
    configs: "插件配置",
    configsHint: "决定基础物品、显示名称、盔甲套装与家具能否正确换算。",
    configsLoaded: "配置已加载",
    configsCount: "{count} 个配置",
    advanced: "高级选项",
    material: "Attachable 材质（3D 物品）",
    baseItem: "默认基础物品",
    baseItemHint: "当 1.21.4+ 物品资源没有说明自己属于哪个原版物品时使用。",
    frames: "动画质量（翻转书最大帧数）",
    framesFull: "完整动画（默认）",
    framesN: "{n} 帧",
    framesHint: "数值越低，资源包越小、下载越快。",
  },

  convert: {
    action: "开始转换",
    needPack: "先添加一个资源包。",
    ready: "先添加插件配置和选项，再开始转换。",
  },

  work: {
    workspace: "工作区",
    welcome: "拖入资源包即可开始",
    welcomeHint:
      "全部转换都在 Web Worker 中本地完成。大型资源包需要一两分钟，期间可以继续使用这个标签页。",
    converting: "正在转换 {name}",
    stage: "{stage} · {done}/{total}",
    cancel: "取消",
    cancelHint: "一切都在你的电脑上运行 —— 这一步本来就慢。",
  },

  drop: {
    title: "把 Java 版资源包拖到这里",
    sub: ".zip、.mcpack 或 .tar.gz —— 可以一次拖入多个，合并为一个 Bedrock 资源包",
    pick: "或点击选择文件",
    notSupported: "「{name}」不是 .zip、.mcpack 或 .tar.gz",
    tooBig: "「{name}」超过了 {limit} MB",
    duplicate: "「{name}」已经添加过了",
    overTotal: "添加「{name}」会让总量超过 {limit} MB",
    another: "共 {size} MB —— 点击可再添加一个资源包",
  },

  result: {
    done: "转换完成",
    again: "再转一个",
    statConverted: "已转换",
    statApproximated: "近似转换",
    statSkipped: "已跳过",
    statErrors: "错误",
    furnitureMappings: "家具映射 mappings.yml",
    furnitureConfig: "家具配置 config.yml（决定家具落地）",
    modelEngine: "ModelEngine 模型（input.zip）",
    reportJson: "report.json",
    reportTitle: "转换报告",
    reportSub: "资源包中每个资源的处理结果。",
    all: "全部",
    empty: "没有该状态的条目。",
    more: "……还有 {count} 条 —— 详见 report.json",
    columnStatus: "状态",
    columnStage: "阶段",
    columnSource: "来源",
    columnDetail: "说明",
    statusConverted: "已转换",
    statusApproximated: "近似转换",
    statusSkipped: "已跳过",
    statusError: "错误",
    perf: "性能 — 共 {total}",
    perfStage: "按阶段",
    perfOps: "高频操作",
  },

  plugins: {
    title: "需要的插件与扩展",
    sub: "在服务端安装这些，Bedrock 玩家才能看到转换后的内容。",
    geyser: "Geyser",
    geyserNote: "让 Bedrock 玩家进服；负责加载 .mcpack 与映射文件",
    floodgate: "Floodgate",
    floodgateNote: "Bedrock 版登录验证，玩家无需 Java 账号",
    displayEntity: "GeyserDisplayEntity",
    displayEntityNote: "在 Bedrock 上渲染家具与放置的展示实体物品",
    modelEngine: "GeyserModelEngine（Geyser 扩展 + Spigot 插件）",
    modelEngineNote: "在 Bedrock 上渲染 ModelEngine / MythicMobs 怪物模型",
    utils: "GeyserUtils",
    utilsNote: "GeyserModelEngine 调用 Bedrock 侧功能时所必需",
  },

  guide: {
    title: "安装步骤",
    sub: "每个生成的文件应该放到服务端的什么位置。",
    required: "必需",
    baseTitle: "1. 资源包 + Geyser",
    base1: "在服务端或代理端安装 **Geyser** 与 **Floodgate**。",
    base2: "把 **.mcpack** 放进 Geyser 的 `packs/` 目录。",
    base3: "把映射 json（{files}）放进 Geyser 的 `custom_mappings/` 目录。",
    base4: "在 Geyser 的 `config.yml` 中设置 `enable-custom-content: true` —— 自定义方块需要它。",
    base5: "重启 Geyser。Bedrock 玩家现在就能看到这些自定义物品与贴图了。",
    furnitureTitle: "2. 家具（GeyserDisplayEntity）",
    furniture1:
      "下载 **GeyserDisplayEntity** 扩展的 jar，放进 Geyser 的 `extensions/` 目录。先重启一次，让它创建自己的文件夹。",
    furniture2: "把 `geyser_displayentity_mappings.yml` 放进 `extensions/geyserdisplayentity/Mappings/`。",
    furniture3:
      "把 `geyserdisplayentity_config.yml` 放进 `extensions/geyserdisplayentity/`（先备份你自己的）。其中的全局 y-offset 与 height 决定家具能否落在地面上 —— 缺少它，家具会浮空约一个方块。",
    furniture4: "重启 Geyser。你的插件放置的家具现在能在 Bedrock 上渲染了。",
    mobTitle: "{n}. ModelEngine / MythicMobs 怪物（GeyserModelEngine）",
    mob1:
      "服务端插件：保留 **ModelEngine** 与 **MythicMobs**，再加上 **GeyserModelEngine**（Spigot）与 **GeyserUtils**（Spigot）。",
    mob2: "Geyser 扩展：把 **GeyserModelEngineExtension** 与 **geyserutils-geyser** 放进 `extensions/`。",
    mob3:
      "如果使用代理（Velocity / Bungee），在 Floodgate 中设置 `send-floodgate-data: true`，并把 `key.pem` 复制到各个后端服务端。",
    mob4:
      "先启动一次服务端，让扩展创建文件夹，然后把 `modelengine_input.zip` 解压进 `extensions/geysermodelengineextension/input/` —— 压缩包内已按模型分好目录。",
    mob5: "重载 Geyser。扩展会根据 `input/` 自动生成并应用 Bedrock 资源包，无需手动安装。",
    mob6: "照常用 MythicMobs 或 MCPets 生成怪物，Bedrock 玩家现在就能看到模型了。",
  },

  nudge: {
    title: "物品可能无法正确映射 —— 请上传插件配置压缩包",
    action: "带上配置重新转换",
  },

  error: {
    title: "转换失败",
    retry: "重试",
  },

  features: {
    title: "支持转换的内容",
    sub: "覆盖面很广，但并非无所不能 —— 任何无法干净映射的内容都会被如实报告，而不是悄悄丢掉。",
    vanilla: { title: "原版贴图替换", desc: "方块、物品、实体、盔甲与环境贴图，通过经过校验的重命名表映射。" },
    legacyItems: { title: "旧版自定义物品", desc: "1.14 起的 custom_model_data 覆盖，输出为 Geyser v2 legacy 映射。" },
    modernItems: { title: "现代物品定义", desc: "1.21.4+ 的 items/*.json，含 condition、select 与 range_dispatch 断言。" },
    sprites: { title: "2D 贴图物品", desc: "多层贴图合成为单一图标，并正确解析 generated 与 handheld 父模型。" },
    models3d: { title: "3D 模型", desc: "几何体、图集、attachable，以及手持/穿戴物品的 display 变换动画。" },
    armor: { title: "自定义盔甲", desc: "现代 equipment 资源与旧版分层贴图，绑定到原版盔甲几何体。" },
    elytra: { title: "鞘翅羽翼", desc: "羽翼分层贴图转换为可用的鞘翅 attachable。" },
    flipbooks: { title: "动态贴图", desc: "方块翻转书写入 flipbook_textures.json；物品图标取第一帧。" },
    bowPull: { title: "弓的拉弓帧", desc: "为原版弓与自定义模型弓生成蓄力进度渲染控制器。" },
    blocks: { title: "自定义方块", desc: "note_block、tripwire 等方块的状态覆盖，并输出 Geyser 方块映射。" },
    furniture: { title: "家具", desc: "面向 GeyserDisplayEntity 的展示实体家具，正确落地与缩放。" },
    mobs: { title: "ModelEngine 怪物", desc: ".bbmodel 蓝图转换为 GeyserModelEngine 的 input 资源包。" },
    sounds: { title: "音效与语言", desc: "sounds.json 与 ogg 文件，语言文件的定位参数会被改写为 Bedrock 语法。" },
    fonts: { title: "位图字体", desc: "自定义字形页，按 Java 的高度度量而非源图像分辨率来缩放。" },
    paintings: { title: "画", desc: "拼接进 Bedrock 的 kz.png 图集，只覆盖部分画作时会给出提醒。" },
    merge: { title: "多包合并", desc: "把多个资源包叠成一个，冲突的路径由第一个包胜出。" },
  },

  pluginsRow: {
    title: "可读取的配置来源",
    sub: "把某个插件的配置目录打成 zip 传上来，就能还原真实的基础物品、显示名称、盔甲套装与家具。",
  },

  faq: {
    title: "常见问题",
    q1: "我的文件会被上传到什么地方吗？",
    a1: "不会。整个转换都在这个标签页的 Web Worker 内完成，没有任何内容发送到服务器，也不需要账号或限流。",
    q2: "为什么有些资源显示为*近似转换*？",
    a2: "说明它能转换，但无法做到完全一致 —— 比如 Java 在服务端染色的颜色、Bedrock 无法播放动画的物品图标、没有精确对应的贴图。说明列会写清具体损失了什么，以及通常怎么补救。",
    q3: "为什么要上传插件配置压缩包？",
    a3: "资源包本身不会说明某个自定义模型替换的是哪个原版物品 —— 这些信息在服务端插件的配置里。没有它，现代物品只能退回默认基础物品，名称也只能从文件名猜。",
    q4: "家具浮在地面上方一个方块，怎么办？",
    a4: "安装生成的 `geyserdisplayentity_config.yml`。其中的全局 y-offset 与 height 正是让家具落地的关键，逐物品的映射假定它们已经生效。",
    q5: "可以一次转换多个资源包吗？",
    a5: "可以 —— 一起拖进来即可合并为一个 Bedrock 资源包，因为 Bedrock 客户端只能接收单个资源包。两个包都定义的文件由先上传的那个胜出。",
  },

  footer: {
    local: "一切都在你的浏览器中本地运行 —— 资源包不会被上传到任何地方。",
    source: "GitHub 源码",
    docs: "Geyser 自定义物品文档",
    license: "GPL-3.0",
  },
};
