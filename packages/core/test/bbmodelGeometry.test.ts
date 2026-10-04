import { describe, expect, it } from "vitest";
import { bbmodelToGeometry } from "../src/modelengine/bbmodelGeometry.js";
import { bbmodelToAnimations } from "../src/modelengine/bbmodelAnimation.js";
import type { BbModel } from "../src/modelengine/bbmodel.js";

/** A one-cube, one-bone model with a resolution and a rotation. */
function cubeModel(overrides: Partial<BbModel> = {}): BbModel {
  return {
    resolution: { width: 64, height: 64 },
    elements: [
      {
        uuid: "cube-1",
        name: "cube",
        type: "cube",
        from: [2, 0, 4],
        to: [6, 8, 10],
        origin: [4, 4, 7],
        rotation: [10, 20, 30],
        faces: {
          north: { uv: [0, 0, 4, 8], texture: 0 },
          south: { uv: [4, 0, 8, 8], texture: 0 },
        },
      },
    ],
    outliner: [{ uuid: "bone-1", name: "Body Part", origin: [1, 2, 3], children: ["cube-1"] }],
    textures: [{ name: "skin", width: 64, height: 64, source: "data:image/png;base64,AAAA" }],
    ...overrides,
  };
}

describe("bbmodelToGeometry", () => {
  it("mirrors X only — no item hand-centering offset", () => {
    // Entity geometry differs from item geometry in exactly one way here:
    // Bedrock/Blockbench mirror X (`-to.x`), but entity models are authored
    // around the entity origin, so the item-only `8 -` / `- 8` offsets are
    // absent. Getting this wrong shifts every mob model by half a block.
    const { geometry } = bbmodelToGeometry(cubeModel(), "geometry.test");
    const cube = geometry["minecraft:geometry"][0]!.bones[0]!.cubes![0]!;
    expect(cube.origin).toEqual([-6, 0, 4]); // [-to.x, from.y, from.z]
    expect(cube.size).toEqual([4, 8, 6]); // unmirsrored extent
    // The bone pivot is mirrored the same way.
    const bone = geometry["minecraft:geometry"][0]!.bones[0]!;
    expect(bone.pivot).toEqual([-1, 2, 3]);
  });

  it("flips the X and Y rotation signs and leaves Z alone", () => {
    const { geometry } = bbmodelToGeometry(cubeModel(), "geometry.test");
    const cube = geometry["minecraft:geometry"][0]!.bones[0]!.cubes![0]!;
    expect(cube.rotation).toEqual([-10, -20, 30]);
  });

  it("passes face UVs straight through in resolution space", () => {
    // UVs are authored in `resolution`, which we publish as texture_width/height,
    // so no rescaling happens — the reason elementToCube discards resW/resH.
    const { geometry } = bbmodelToGeometry(cubeModel(), "geometry.test");
    const desc = geometry["minecraft:geometry"][0]!.description;
    expect(desc.texture_width).toBe(64);
    expect(desc.texture_height).toBe(64);
    const uv = geometry["minecraft:geometry"][0]!.bones[0]!.cubes![0]!.uv;
    expect(uv.north).toEqual({ uv: [0, 0], uv_size: [4, 8] });
    expect(uv.south).toEqual({ uv: [4, 0], uv_size: [4, 8] });
  });

  it("drops uv_rotation and stays on format 1.16.0", () => {
    const model = cubeModel();
    model.elements![0]!.faces!.north = { uv: [0, 0, 4, 8], texture: 0, rotation: 90 };
    const { geometry } = bbmodelToGeometry(model, "geometry.test");
    expect(geometry.format_version).toBe("1.16.0");
    expect(geometry["minecraft:geometry"][0]!.bones[0]!.cubes![0]!.uv.north).toEqual({
      uv: [0, 0],
      uv_size: [4, 8],
    });
    expect(JSON.stringify(geometry)).not.toContain("uv_rotation");
  });

  it("sanitizes bone names and maps the blueprint uuid to the final name", () => {
    const { geometry, boneNames } = bbmodelToGeometry(cubeModel(), "geometry.test");
    expect(boneNames.get("bone-1")).toBe("body_part");
    expect(geometry["minecraft:geometry"][0]!.bones[0]!.name).toBe("body_part");
  });

  it("suffixes colliding bone names instead of letting one shadow the other", () => {
    const model: BbModel = {
      resolution: { width: 16, height: 16 },
      elements: [],
      outliner: [
        { uuid: "a", name: "Arm", origin: [0, 0, 0], children: [] },
        { uuid: "b", name: "Arm", origin: [1, 0, 0], children: [] },
        { uuid: "c", name: "arm", origin: [2, 0, 0], children: [] },
      ],
    };
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    expect(boneNames.get("a")).toBe("arm");
    expect(boneNames.get("b")).toBe("arm_2");
    expect(boneNames.get("c")).toBe("arm_3");
  });

  it("falls back to a uuid-derived name when a group name sanitizes to nothing", () => {
    const model: BbModel = {
      resolution: { width: 16, height: 16 },
      elements: [],
      outliner: [{ uuid: "abcdef1234567890", name: "###", origin: [0, 0, 0], children: [] }],
    };
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    expect(boneNames.get("abcdef1234567890")).toBe("bone_abcdef12");
  });

  it("keeps a group with no convertible cubes as a bone, so animations can bind", () => {
    const model: BbModel = {
      resolution: { width: 16, height: 16 },
      elements: [{ uuid: "mesh-1", type: "mesh", from: [0, 0, 0], to: [1, 1, 1] }],
      outliner: [{ uuid: "bone-1", name: "Hand", origin: [0, 0, 0], children: ["mesh-1"] }],
    };
    const { geometry } = bbmodelToGeometry(model, "geometry.test");
    const bones = geometry["minecraft:geometry"][0]!.bones;
    expect(bones).toHaveLength(1);
    expect(bones[0]!.name).toBe("hand");
    expect(bones[0]!.cubes).toBeUndefined();
  });

  it("reports no bones for an outliner with nothing convertible", () => {
    const model: BbModel = {
      resolution: { width: 16, height: 16 },
      elements: [{ uuid: "mesh-1", type: "mesh" }],
      outliner: ["mesh-1"],
    };
    const { geometry } = bbmodelToGeometry(model, "geometry.test");
    expect(geometry["minecraft:geometry"][0]!.bones).toHaveLength(0);
  });

  it("collects the texture indices each bone uses, for binding_bones", () => {
    const model = cubeModel();
    model.elements![0]!.faces!.north = { uv: [0, 0, 1, 1], texture: 0 };
    model.elements![0]!.faces!.south = { uv: [0, 0, 1, 1], texture: 1 };
    const { boneTextures } = bbmodelToGeometry(model, "geometry.test");
    expect(Array.from(boneTextures.get("body_part")!).sort()).toEqual([0, 1]);
  });

  it("omits the rotation key entirely for an identity group", () => {
    const model: BbModel = {
      resolution: { width: 16, height: 16 },
      elements: [],
      outliner: [{ uuid: "a", name: "Idle", origin: [0, 0, 0], rotation: [0, 0, 0], children: [] }],
    };
    const { geometry } = bbmodelToGeometry(model, "geometry.test");
    expect(geometry["minecraft:geometry"][0]!.bones[0]!.rotation).toBeUndefined();
  });

  it("defaults the resolution to 16 when the model does not declare one", () => {
    const model = cubeModel({ resolution: undefined });
    const { geometry } = bbmodelToGeometry(model, "geometry.test");
    const desc = geometry["minecraft:geometry"][0]!.description;
    expect(desc.texture_width).toBe(16);
    expect(desc.texture_height).toBe(16);
  });
});

describe("bbmodelToAnimations", () => {
  function animatedModel(): BbModel {
    return {
      ...cubeModel(),
      animations: [
        {
          name: "idle",
          loop: "loop",
          length: 2,
          animators: {
            "bone-1": {
              name: "Body Part",
              keyframes: [
                { channel: "rotation", time: 0, data_points: [{ x: 10, y: 5, z: -2 }] },
                { channel: "rotation", time: 0.5, data_points: [{ x: 0, y: 0, z: 0 }] },
                { channel: "position", time: 0.5, data_points: [{ x: 1, y: -2, z: 3 }] },
                { channel: "scale", time: 1, data_points: [{ x: 2, y: 2, z: 2 }] },
              ],
            },
          },
        },
      ],
    };
  }

  it("binds animator uuids to the final bone names and transforms values per channel", () => {
    const model = animatedModel();
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "test_drone", boneNames)!;
    const anim = anims.animations["animation.test_drone.idle"]!;
    const body = anim.bones.body_part!;
    // rotation negates X and Y; position negates X; scale is untouched.
    expect(body.rotation!["0"]).toEqual([-10, -5, -2]);
    expect(body.rotation!["0.5"]).toEqual([-0, -0, 0]);
    expect(body.position!["0.5"]).toEqual([-1, -2, 3]);
    expect(body.scale!["1"]).toEqual([2, 2, 2]);
    expect(anim.loop).toBe(true);
    expect(anim.animation_length).toBe(2);
  });

  it("keeps only the first data point of a multi-point keyframe", () => {
    // Documented behaviour: catmullrom smoothing is not reproduced, so a second
    // data point is dropped rather than averaged.
    const model = animatedModel();
    model.animations![0]!.animators!["bone-1"]!.keyframes = [
      {
        channel: "rotation",
        time: 0,
        interpolation: "catmullrom",
        data_points: [{ x: 1, y: 1, z: 1 }, { x: 99, y: 99, z: 99 }],
      },
    ];
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "m", boneNames)!;
    expect(anims.animations["animation.m.idle"]!.bones.body_part!.rotation!["0"]).toEqual([-1, -1, 1]);
  });

  it("never emits an interpolation mode", () => {
    const model = animatedModel();
    model.animations![0]!.animators!["bone-1"]!.keyframes![0]!.interpolation = "catmullrom";
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "m", boneNames)!;
    expect(JSON.stringify(anims)).not.toContain("interpolation");
    expect(JSON.stringify(anims)).not.toContain("catmullrom");
  });

  it("stringifies numeric times as decimal-keyed buckets", () => {
    const model = animatedModel();
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "m", boneNames)!;
    const keys = Object.keys(anims.animations["animation.m.idle"]!.bones.body_part!.rotation!);
    expect(keys).toContain("0");
    expect(keys).toContain("0.5");
  });

  it("falls back to 0 for MoLang expression strings rather than dropping the keyframe", () => {
    const model = animatedModel();
    model.animations![0]!.animators!["bone-1"]!.keyframes = [
      { channel: "rotation", time: 0, data_points: [{ x: "math.sin(q.life_time)", y: 3, z: undefined }] },
    ];
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "m", boneNames)!;
    expect(anims.animations["animation.m.idle"]!.bones.body_part!.rotation!["0"]).toEqual([-0, -3, 0]);
  });

  it("accepts a numeric string for a coordinate", () => {
    const model = animatedModel();
    model.animations![0]!.animators!["bone-1"]!.keyframes = [
      { channel: "position", time: 0.25, data_points: [{ x: "1.5", y: "-2", z: "0" }] },
    ];
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "m", boneNames)!;
    expect(anims.animations["animation.m.idle"]!.bones.body_part!.position!["0.25"]).toEqual([-1.5, -2, 0]);
  });

  it("emits loop only for loop/true, omitting it for once and hold", () => {
    for (const loop of ["once", "hold", false] as const) {
      const model = animatedModel();
      model.animations![0]!.loop = loop;
      const { boneNames } = bbmodelToGeometry(model, "geometry.test");
      const anims = bbmodelToAnimations(model, "m", boneNames)!;
      expect(anims.animations["animation.m.idle"]!.loop).toBeUndefined();
      expect(JSON.stringify(anims.animations["animation.m.idle"])).not.toContain('"loop"');
    }
  });

  it("uniquifies animation names that sanitize to the same string", () => {
    // "attack.1" and "attack_1" both sanitize to attack_1; without the suffix
    // the second silently replaces the first and the MythicMobs config that
    // references it by name stops working.
    const model = animatedModel();
    const animator = model.animations![0]!.animators!;
    model.animations = [
      { name: "attack.1", loop: "loop", animators: { ...animator } },
      { name: "attack_1", loop: "loop", animators: { ...animator } },
    ];
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "m", boneNames)!;
    const names = Object.keys(anims.animations);
    expect(names).toHaveLength(2);
    expect(names).toContain("animation.m.attack_1");
    expect(names).toContain("animation.m.attack_1_2");
  });

  it("resolves a bone rename: the uuid wins over the animator's own name", () => {
    const model = animatedModel();
    // The geometry renamed this bone to body_part; an animator carrying a stale
    // name must still bind through the uuid map.
    model.animations![0]!.animators!["bone-1"]!.name = "Old Name";
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "m", boneNames)!;
    expect(Object.keys(anims.animations["animation.m.idle"]!.bones)).toEqual(["body_part"]);
  });

  it("falls back to the animator name when the uuid is unknown", () => {
    const model = animatedModel();
    model.animations![0]!.animators = {
      "ghost-uuid": { name: "Tail Bone", keyframes: [{ channel: "rotation", time: 0, data_points: [{ x: 1 }] }] },
    };
    const anims = bbmodelToAnimations(model, "m", new Map())!;
    expect(Object.keys(anims.animations["animation.m.idle"]!.bones)).toEqual(["tail_bone"]);
  });

  it("drops an animator whose bone cannot be resolved at all", () => {
    const model = animatedModel();
    model.animations![0]!.animators = {
      "ghost-uuid": { name: "###", keyframes: [{ channel: "rotation", time: 0, data_points: [{ x: 1 }] }] },
    };
    expect(bbmodelToAnimations(model, "m", new Map())).toBeUndefined();
  });

  it("returns undefined with no animations, or when every one has no resolvable bones", () => {
    expect(bbmodelToAnimations({ ...cubeModel(), animations: [] }, "m", new Map())).toBeUndefined();
    expect(bbmodelToAnimations(cubeModel(), "m", new Map())).toBeUndefined();
    const empty: BbModel = {
      ...cubeModel(),
      animations: [{ name: "idle", animators: { "bone-1": { name: "Body", keyframes: [] } } }],
    };
    expect(bbmodelToAnimations(empty, "m", new Map())).toBeUndefined();
  });

  it("emits format 1.8.0 with the Bedrock animation id shape", () => {
    const model = animatedModel();
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "test_drone", boneNames)!;
    expect(anims.format_version).toBe("1.8.0");
    expect(Object.keys(anims.animations)).toEqual(["animation.test_drone.idle"]);
  });

  it("falls back to the literal name anim when an animation name sanitizes to nothing", () => {
    const model = animatedModel();
    model.animations![0]!.name = "###";
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "m", boneNames)!;
    expect(Object.keys(anims.animations)).toEqual(["animation.m.anim"]);
  });

  it("uses 0.0 as the time key for a non-finite time", () => {
    const model = animatedModel();
    model.animations![0]!.animators!["bone-1"]!.keyframes = [
      { channel: "rotation", time: Number.NaN, data_points: [{ x: 1, y: 1, z: 1 }] },
    ];
    const { boneNames } = bbmodelToGeometry(model, "geometry.test");
    const anims = bbmodelToAnimations(model, "m", boneNames)!;
    expect(Object.keys(anims.animations["animation.m.idle"]!.bones.body_part!.rotation!)).toEqual(["0.0"]);
  });
});
