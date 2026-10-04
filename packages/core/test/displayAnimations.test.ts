import { describe, expect, it } from "vitest";
import { buildDisplayAnimations } from "../src/bedrock/animations.js";
import { BONE_ROOT, BONE_X, BONE_Y, BONE_Z } from "../src/bedrock/geometry.js";
import type { JavaDisplayContext, JavaDisplayTransform } from "../src/java/model.js";

const identity: JavaDisplayTransform = { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1] };

/** All five slots with an identity transform, so a test can vary just one. */
function allSlots(transform: JavaDisplayTransform = identity): Record<string, JavaDisplayTransform> {
  return {
    thirdperson_righthand: transform,
    thirdperson_lefthand: transform,
    firstperson_righthand: transform,
    firstperson_lefthand: transform,
    head: transform,
  };
}

describe("buildDisplayAnimations", () => {
  it("emits all five slot animations, even when the model defines none of them", () => {
    // A missing display context degrades to the identity transform, not to a
    // missing animation — otherwise the attachable's `animate` entries would
    // reference animations that do not exist and the item would vanish in that
    // slot rather than sitting at its default pose.
    const { refs } = buildDisplayAnimations("demo", {});
    expect(Object.keys(refs).sort()).toEqual([
      "firstperson_main_hand",
      "firstperson_off_hand",
      "head",
      "thirdperson_main_hand",
      "thirdperson_off_hand",
    ]);
  });

  it("uses the same bone names as the geometry emitter", () => {
    // One source of truth: the rig in geometry.ts and these animations must
    // agree or the item renders unposed.
    const { file } = buildDisplayAnimations("demo", allSlots()) as any;
    const anim = file.animations["animation.geyser_custom.demo.thirdperson_main_hand"];
    expect(Object.keys(anim.bones).sort()).toEqual([BONE_ROOT, BONE_X, BONE_Y, BONE_Z].sort());
  });

  it("ids each animation after the file-safe name it was given", () => {
    const { refs, file } = buildDisplayAnimations("ruby_sword", allSlots()) as any;
    expect(refs.thirdperson_main_hand).toBe("animation.geyser_custom.ruby_sword.thirdperson_main_hand");
    expect(Object.keys(file.animations)).toHaveLength(5);
    expect(file.format_version).toBe("1.8.0");
  });

  it("puts the Java transform on the X bone and the base pose on the root", () => {
    // The root's rotation applies to everything below it, so folding the Java
    // translation into the root position would apply it in Bedrock's hand frame
    // instead of Java's item frame (a 90-degree axis swap for the third-person
    // pose). Only the X bone carries the authored transform.
    const display = allSlots({ rotation: [0, 0, 0], translation: [2, 3, 4], scale: [1, 1, 1] });
    const { file } = buildDisplayAnimations("demo", display) as any;
    const anim = file.animations["animation.geyser_custom.demo.thirdperson_main_hand"];
    expect(anim.bones[BONE_ROOT].position).toEqual([0, 13, -3]); // Bedrock's own base pose
    expect(anim.bones[BONE_X].position).toEqual([-2, 3, 4]); // Java translation, X negated
    expect(anim.bones[BONE_Y].position).toBeUndefined();
    expect(anim.bones[BONE_Z].position).toBeUndefined();
  });

  it("negates X rotation on the X bone but keeps Y and Z signs for the right hand", () => {
    const display = allSlots({ rotation: [11, 22, 33], translation: [0, 0, 0], scale: [1, 1, 1] });
    const { file } = buildDisplayAnimations("demo", display) as any;
    const anim = file.animations["animation.geyser_custom.demo.thirdperson_main_hand"];
    expect(anim.bones[BONE_X].rotation).toEqual([-11, 0, 0]);
    expect(anim.bones[BONE_Y].rotation).toEqual([0, -22, 0]);
    expect(anim.bones[BONE_Z].rotation).toEqual([0, 0, 33]);
  });

  it("mirrors translation X and the Y/Z rotations for the left-hand slots", () => {
    // Java's ItemTransform.apply negates X translation and the Y/Z rotations
    // for the off hand. The authored *_lefthand values are pre-mirror, so
    // feeding them through the right-hand formula puts the item on the wrong
    // side facing the wrong way.
    const display = allSlots({ rotation: [11, 22, 33], translation: [5, 6, 7], scale: [1, 1, 1] });
    const { file } = buildDisplayAnimations("demo", display) as any;
    const anim = file.animations["animation.geyser_custom.demo.firstperson_off_hand"];
    expect(anim.bones[BONE_X].position).toEqual([5, 6, 7]); // mirror flipped
    expect(anim.bones[BONE_X].rotation).toEqual([-11, 0, 0]); // X rotation never mirrored
    expect(anim.bones[BONE_Y].rotation).toEqual([0, 22, 0]);
    expect(anim.bones[BONE_Z].rotation).toEqual([0, 0, -33]);
  });

  it("omits the bone scale key when the transform is identity", () => {
    // Hand slots with identity scale emit no scale key; this keeps the JSON
    // small and mirrors Java, where the scale is identity.
    const { file } = buildDisplayAnimations("demo", allSlots()) as any;
    const anim = file.animations["animation.geyser_custom.demo.thirdperson_main_hand"];
    expect(anim.bones[BONE_X].scale).toBeUndefined();
  });

  it("scales the head slot by 0.625 even for an identity transform", () => {
    // Head-slot display values are authored in skull space and shrink by the
    // render scale, so the head animation always carries a scale.
    const { file } = buildDisplayAnimations("demo", allSlots()) as any;
    const anim = file.animations["animation.geyser_custom.demo.head"];
    expect(anim.bones[BONE_X].scale).toEqual([0.625, 0.625, 0.625]);
  });

  it("uses Bedrock's per-slot base pose for the off hand's own placement", () => {
    const { file } = buildDisplayAnimations("demo", allSlots()) as any;
    const off = file.animations["animation.geyser_custom.demo.firstperson_off_hand"];
    expect(off.bones[BONE_ROOT].position).toEqual([-18.5, 18.3, 15]);
    expect(off.bones[BONE_ROOT].rotation).toEqual([180, 0, 180]);
    expect(off.bones[BONE_ROOT].scale).toBe(1.2);
    const main = file.animations["animation.geyser_custom.demo.firstperson_main_hand"];
    expect(main.bones[BONE_ROOT].position).toEqual([0, 15, 2]);
    expect(main.bones[BONE_ROOT].scale).toBe(1.4);
  });

  it("gives the head slot a position but no base rotation", () => {
    const { file } = buildDisplayAnimations("demo", allSlots()) as any;
    const head = file.animations["animation.geyser_custom.demo.head"];
    expect(head.bones[BONE_ROOT].position).toEqual([0, 19.9, 0]);
    expect(head.bones[BONE_ROOT].rotation).toBeUndefined();
  });

  it("applies headLift only to the head slot", () => {
    // HMCCosmetics back cosmetics sit lower on Bedrock's armor stand; +12 units
    // compensates. Everything outside the head slot ignores it.
    const { file } = buildDisplayAnimations("demo", allSlots(), { headLift: 12 }) as any;
    expect(file.animations["animation.geyser_custom.demo.head"].bones[BONE_ROOT].position).toEqual([0, 31.9, 0]);
    expect(file.animations["animation.geyser_custom.demo.thirdperson_main_hand"].bones[BONE_ROOT].position).toEqual([
      0, 13, -3,
    ]);
  });

  it("falls back to the right-hand context when a left-hand one is missing", () => {
    // Java falls back left -> right when a context is absent, applied AFTER the
    // mirror, so the left slot mirrors a right-hand-authored transform exactly
    // as Java's renderer does.
    const display: Partial<Record<JavaDisplayContext, JavaDisplayTransform>> = {
      thirdperson_righthand: { rotation: [0, 45, 0], translation: [1, 0, 0], scale: [1, 1, 1] },
    };
    const { file } = buildDisplayAnimations("demo", display) as any;
    const left = file.animations["animation.geyser_custom.demo.thirdperson_off_hand"];
    expect(left.bones[BONE_Y].rotation).toEqual([0, 45, 0]); // mirrored back to +45
    expect(left.bones[BONE_X].position).toEqual([1, 0, 0]);
  });

  it("marks every animation as looping", () => {
    const { file } = buildDisplayAnimations("demo", allSlots()) as any;
    for (const anim of Object.values(file.animations) as any[]) {
      expect(anim.loop).toBe(true);
    }
  });

  it("builds a refs map the attachable can spread in directly", () => {
    const { refs, file } = buildDisplayAnimations("demo", allSlots()) as any;
    for (const [key, id] of Object.entries(refs)) {
      expect(file.animations[id as string]).toBeDefined();
      expect(key).toBe((id as string).split(".").pop());
    }
  });
});
