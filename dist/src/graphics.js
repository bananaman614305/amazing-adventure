// The camera pipeline: tone mapping, exposure, colour space and ambient light.
//
// Why this file exists. Three.js by default renders a linear scene straight to
// the canvas with no tone mapping (NoToneMapping) and no image-based ambient
// light. That produces the flat, chalky look the plaza had: bright surfaces
// clip to white instead of rolling off, dark corners go pure black instead of
// picking up bounce light, and metal or wet stone has nothing to reflect.
//
// Two changes fix most of it, and both are cheap:
//
//   1. A filmic tone curve (ACES) plus an explicit exposure per phase. Bright
//      values compress instead of clipping, so the sunlit stone keeps its
//      texture, and night can be exposed up so lanterns read without washing
//      the sky.
//   2. A procedural environment map (IBL). A tiny gradient "room" - the same
//      sky the dome shows, over the ground colour - is prefiltered into a
//      PMREM and handed to scene.environment. Every MeshStandardMaterial then
//      gets real ambient specular and a directional ambient tint for free,
//      which is what makes stone and wood stop looking like flat paint.
//
// Everything that can be decided without a GPU is a pure function here so it
// can be unit-tested: the exposure table, the tone mapping choice, the gradient
// colours fed to the environment room, and the shadow budget per quality tier.
// Nothing in this file reads a clock or the DOM.

/**
 * Tone curve. ACES filmic is the standard choice: it keeps a long highlight
 * rolloff (sunlit plaster stops clipping to flat white) while leaving midtones
 * close to their authored value.
 */
export const TONE_MAPPING_NAME = 'ACESFilmic';

/**
 * Exposure per phase. Day is the reference (1.0). Dusk lifts slightly because
 * the sun is low and warm; night lifts more so lantern pools and moonlit stone
 * are legible without blowing out the lamp bulbs, which are emissive and are
 * already the brightest thing in frame.
 *
 * These are multipliers on the tone-mapped output, not light intensities: the
 * per-phase sun/hemi numbers in world.js still control the actual lighting.
 */
export const PHASE_EXPOSURE = Object.freeze({
  day: 1.0,
  dusk: 1.12,
  night: 1.55
});

/** Exposure for a phase id, defaulting to the day reference for unknown ids. */
export function phaseExposure(phaseId) {
  return PHASE_EXPOSURE[phaseId] ?? PHASE_EXPOSURE.day;
}

/**
 * The ambient room the environment map is built from: a sky colour overhead,
 * a horizon colour at eye level, and a ground colour below. Feeding the real
 * phase colours (rather than a fixed studio grey) is what makes the ambient
 * light agree with the sky the player can see.
 *
 * Returns plain { zenith, horizon, ground } hex numbers so it is comparable in
 * a test without constructing Three.js objects.
 */
export function ambientRoomFor(zenith, horizon, ground) {
  return {
    zenith: zenith >>> 0,
    horizon: horizon >>> 0,
    ground: ground >>> 0
  };
}

/**
 * How much of the environment map to fold in. Night gets a touch more so the
 * dark side of objects is not crushed to black, but never so much that the
 * scene stops reading as night.
 */
export const PHASE_ENV_INTENSITY = Object.freeze({
  day: 0.55,
  dusk: 0.5,
  night: 0.42
});

export function phaseEnvIntensity(phaseId) {
  return PHASE_ENV_INTENSITY[phaseId] ?? PHASE_ENV_INTENSITY.day;
}

/**
 * Shadow budget per quality tier. The full tier keeps a 2048 map with a tight
 * frustum around the plaza; the low tier (weak phones) turns the shadow pass
 * off entirely, which is the single largest per-frame saving and matches what
 * world.setQuality already does to sun.castShadow.
 */
export function shadowSettings(tier) {
  if (tier === 'low') {
    return { enabled: false, mapSize: 1024, normalBias: 0.02, bias: -0.0006 };
  }
  return { enabled: true, mapSize: 2048, normalBias: 0.02, bias: -0.0006 };
}

/**
 * Applies the camera pipeline to a renderer. Kept as one call so main.js cannot
 * set tone mapping in one place and forget the colour space in another.
 *
 * `THREE` is passed in rather than imported so this module stays free of a
 * Three.js dependency and can be unit-tested in Node.
 */
export function configureRenderer(renderer, THREE) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = PHASE_EXPOSURE.day;
  // Explicit rather than relying on the default: an sRGB output space is what
  // makes the linear lighting maths above end up looking like the authored
  // colours, and it is the only correct setting for a colour-managed scene.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/**
 * Applies a phase's exposure and ambient intensity. Called from the same
 * phase-change path as world.applyPhase, so exposure and lighting can never
 * disagree about what time it is.
 */
export function applyPhaseLook(renderer, scene, phaseId) {
  if (renderer) renderer.toneMappingExposure = phaseExposure(phaseId);
  // Assigned unconditionally when a scene is given: r163+ Scene has
  // environmentIntensity and an older build simply gains an inert property,
  // which is better than silently skipping the ambient step on a plain stub.
  if (scene) scene.environmentIntensity = phaseEnvIntensity(phaseId);
  return { exposure: phaseExposure(phaseId), environmentIntensity: phaseEnvIntensity(phaseId) };
}

/**
 * Builds the procedural environment map.
 *
 * A throwaway scene holds one inside-out sphere painted with the same
 * zenith/horizon gradient as the visible sky dome, plus a flat ground disc in
 * the ground colour. PMREMGenerator prefilters that into the roughness-aware
 * mip chain MeshStandardMaterial expects. Cost is paid once per phase change
 * (three times a cycle), not per frame, and the source scene is disposed.
 *
 * Returns the generated texture, or null if the renderer cannot make one (a
 * lost context, or a test stub), in which case the caller keeps whatever
 * ambient it had - the game must never depend on IBL to render.
 */
export function buildEnvironmentMap(renderer, THREE, room) {
  if (!renderer || typeof THREE.PMREMGenerator !== 'function') return null;
  let pmrem = null;
  let envScene = null;
  try {
    pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    envScene = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(10, 24, 16);
    const material = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false });
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const zenith = new THREE.Color(room.zenith);
    const horizon = new THREE.Color(room.horizon);
    const ground = new THREE.Color(room.ground);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i) / 10;
      // Above the equator: horizon -> zenith. Below: horizon -> ground. This
      // is the same shape the sky dome paints, so ambient and sky agree.
      let c;
      if (y >= 0) {
        const t = Math.min(1, y * 1.6);
        const s = t * t * (3 - 2 * t);
        c = { r: horizon.r + (zenith.r - horizon.r) * s,
          g: horizon.g + (zenith.g - horizon.g) * s,
          b: horizon.b + (zenith.b - horizon.b) * s };
      } else {
        const t = Math.min(1, -y * 2.2);
        const s = t * t * (3 - 2 * t);
        c = { r: horizon.r + (ground.r - horizon.r) * s,
          g: horizon.g + (ground.g - horizon.g) * s,
          b: horizon.b + (ground.b - horizon.b) * s };
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    material.vertexColors = true;
    const sphere = new THREE.Mesh(geometry, material);
    envScene.add(sphere);

    const target = pmrem.fromScene(envScene, 0, 0.1, 100);
    return target.texture;
  } catch {
    return null;
  } finally {
    if (envScene) {
      envScene.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    }
    pmrem?.dispose?.();
  }
}
