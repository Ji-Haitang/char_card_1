import { Color, Data3DTexture, GLSL3, HalfFloatType, LinearFilter, MathUtils, Matrix4, NearestFilter, RedFormat, RepeatWrapping, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget } from "./three.module-DEUH6-St.mjs";
import { n as Pass, t as FullScreenQuad } from "./Pass-2joK0Utu.mjs";
import { a as skyRevealFragment, t as cloudField } from "./viewer-sky-Dg6PJ0QQ.mjs";
//#region scene3d/src/atmosphere.js
var vertexShader = `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
var fragmentShader = `
  precision highp sampler3D;
  precision highp sampler2DShadow;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform sampler2D tVolume;
  uniform sampler3D tNoise;
  uniform bool hasDepth;
  uniform mat4 inverseProjection;
  uniform mat4 cameraWorld;
  uniform vec2 volumeSize;
  uniform float seaHeight;
  uniform float shaftStrength;
  uniform float elapsed;
  uniform float daylight;
  uniform float golden;
  uniform vec3 sunDirection;
  uniform vec3 sunRadiance;
  uniform mat4 sunMatrix;
  uniform float sunBias;
  uniform float shadowIntensity;
  uniform vec2 shadowTexel;
  #if SHADOW_MODE == 2
    uniform sampler2DShadow tSunShadow;
  #elif SHADOW_MODE == 1
    uniform sampler2D tSunShadow;
  #endif

  vec3 unproject(vec2 uv, float depth) {
    vec4 p = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  ${skyRevealFragment}

  // Cubic value noise, hardware trilinear interpolation, no texture atlas seams.
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return textureLod(tNoise, (i + f + 0.5) / 64.0, 0.0).r;
  }

  float cloudDensity(vec3 p, bool detail) {
    float h = p.y - seaHeight;
    if (h <= -10.0 || h >= 3.5) return 0.0;
    // Shared with the painted cirrus, so both layers drift as one sky.
    vec3 wind = vec3(elapsed * ${cloudField.windX}, 0.0, elapsed * ${cloudField.windZ});
    vec3 q = p - wind;
    float weather = noise3(vec3(q.x * 0.057, 19.3, q.z * 0.057));
    vec3 domain = q * vec3(${cloudField.freqXZ}, ${cloudField.freqY}, ${cloudField.freqXZ});
    // Four independently advected scales form small turbulent folds on a broad bank.
    domain += vec3(weather * 1.7, elapsed * 0.021, weather * -1.1);
    float f = noise3(domain) * 0.47;
    f += noise3(domain * 2.03 + vec3(5.7, -elapsed * 0.048, 9.2)) * 0.28;
    if (detail) {
      f += noise3(domain * 4.11 + vec3(-elapsed * 0.039, 13.1, 3.7)) * 0.17;
      f += noise3(domain * 8.21 + vec3(4.1, elapsed * 0.061, 7.2)) * 0.08;
    } else {
      f += 0.125;
    }
    float top = 1.2 + weather * 2.3;
    float bottom = mix(-9.7, -6.8, weather);
    float surface = top - h - 2.2 + (f - 0.48) * 13.0;
    float cap = smoothstep(-0.1, 0.8, surface) * (1.0 - smoothstep(2.5, 3.5, h));
    float base = smoothstep(bottom, bottom + 2.1, h);
    // The connected lower stratum keeps distant coverage continuous.
    float horizon = smoothstep(-30.0, -12.0, p.z);
    return cap * base * (0.40 + f * 0.34) * horizon * horizon;
  }

  float sunVisibility(vec3 p) {
    #if SHADOW_MODE == 0
      return 1.0;
    #else
      vec4 clip = sunMatrix * vec4(p, 1.0);
      vec3 coord = clip.xyz / clip.w;
      coord.z += sunBias;
      if (any(lessThan(coord, vec3(0.0))) || any(greaterThan(coord, vec3(1.0)))) return 1.0;
      float visibility;
      #if SHADOW_MODE == 2
        // r185 PCF uses native comparison depth, NOT packed RGBA shadow.map.texture.
        visibility = textureGrad(tSunShadow, coord, vec2(0.0), vec2(0.0));
      #else
        visibility = step(coord.z, textureLod(tSunShadow, coord.xy, 0.0).r);
      #endif
      // Fade the edge of the finite shadow frustum, not the cloud sea itself.
      vec2 border = min(coord.xy, 1.0 - coord.xy);
      float edge = smoothstep(0.0, max(shadowTexel.x, shadowTexel.y) * 5.0, min(border.x, border.y));
      return mix(1.0, visibility, edge * shadowIntensity);
    #endif
  }

  float phase(float cosine, float g) {
    return (1.0 - g * g) / pow(max(0.01, 1.0 + g * g - 2.0 * g * cosine), 1.5);
  }

  float beamOpening(vec3 p) {
    vec3 axis = abs(sunDirection.y) < 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 u = normalize(cross(sunDirection, axis));
    vec3 v = cross(sunDirection, u);
    // A virtual offscreen canopy: constant along each sunlight ray, not radial UV streaks.
    vec3 q = vec3(dot(p, u) * 0.085, dot(p, v) * 0.035, 8.7);
    q.xy -= elapsed * vec2(0.006, 0.003);
    float opening = noise3(q) * 0.72 + noise3(q * 2.17 + 6.3) * 0.28;
    return smoothstep(0.43, 0.68, opening);
  }

  vec3 cloudLight(vec3 p, float density, float cosine, float visibility) {
    // Resolve nearby folds before the coarser probes account for the bank behind.
    float optical = cloudDensity(p + sunDirection * 0.35, true) * 0.8;
    optical += cloudDensity(p + sunDirection * 1.15, false) * 1.8;
    #if LIGHT_STEPS == 3
      optical += cloudDensity(p + sunDirection * 3.3, false) * 3.3;
    #endif
    float direct = exp(-optical * 1.65) * visibility;
    float multiple = exp(-optical * 0.40);
    float sky = smoothstep(-7.5, 2.0, p.y - seaHeight);
    vec3 ambient = mix(vec3(0.022, 0.028, 0.065), vec3(0.165, 0.192, 0.26), daylight);
    ambient *= 0.58 + sky * 0.62;
    float silver = pow(clamp(1.0 - density * 1.9, 0.0, 1.0), 2.0);
    float scattering = 0.66 + 0.18 * phase(cosine, 0.55);
    // Broad illumination is silver-white; the thin, directly lit rim keeps the sun's warmth.
    float sunLuma = dot(sunRadiance, vec3(0.2126, 0.7152, 0.0722));
    vec3 diffuseSun = mix(sunRadiance, vec3(sunLuma), 0.60);
    return ambient + diffuseSun * (direct * scattering * 0.62 + multiple * 0.035)
      + sunRadiance * direct * silver * (0.18 + golden * 0.06);
  }

  void integrateAir(vec3 p, float stepLength, float cosine, inout vec3 light, inout float transmittance) {
    float h = p.y - seaHeight;
    float envelope = smoothstep(-10.0, -3.0, h) * (1.0 - smoothstep(15.0, 30.0, h));
    float opening = beamOpening(p);
    float gapMist = smoothstep(-7.0, -2.0, h) * (1.0 - smoothstep(1.0, 6.0, h));
    float gap = 0.0;
    if (gapMist > 0.0) {
      // Follow sunlight back to the rolling sea, so enhanced shafts sit over real gaps.
      vec3 seaPoint = p - sunDirection * ((h + 1.0) / max(sunDirection.y, 0.15));
      gap = 1.0 - smoothstep(0.025, 0.25, cloudDensity(seaPoint, false));
    }
    float visibility = sunVisibility(p);
    float shaft = gapMist * gap * opening * opening * visibility * daylight;
    // Height-bound haze carries shadows above the cloud top, not only inside its gaps.
    // The slider controls sunlight scattering, leaving the cloud sea itself intact.
    float canopyShaft = opening * opening * visibility * daylight;
    // Localized gaps drive the visible beams; the broad canopy term stays much
    // weaker so extra Tyndall doesn't turn into a uniform white veil.
    float extinction = envelope * (exp(-max(h - 3.5, 0.0) * 0.048) * 0.00025
      + shaftStrength * (shaft * 0.0055 + canopyShaft * 0.0014));
    float alpha = 1.0 - exp(-extinction * stepLength);
    float illumination = visibility * opening * shaftStrength;
    float scattering = 0.9 + min(phase(cosine, 0.65), 5.0) * 0.3;
    vec3 air = mix(vec3(0.012, 0.024, 0.05), vec3(0.22, 0.31, 0.43), daylight);
    air += sunRadiance * illumination * scattering * (2.30 + golden * 0.70);
    light += transmittance * alpha * air;
    transmittance *= 1.0 - alpha;
  }

  bool slab(vec3 origin, vec3 direction, float low, float high, float limit, out vec2 interval) {
    if (abs(direction.y) < 0.00001) {
      interval = vec2(0.0, limit);
      return origin.y >= low && origin.y <= high;
    }
    vec2 bounds = (vec2(low, high) - origin.y) / direction.y;
    interval = vec2(max(0.0, min(bounds.x, bounds.y)), min(limit, max(bounds.x, bounds.y)));
    return interval.y > interval.x;
  }

  vec4 march(vec2 uv) {
    vec3 nearView = unproject(uv, 0.0);
    vec3 farView = unproject(uv, 1.0);
    vec3 origin = (cameraWorld * vec4(nearView, 1.0)).xyz;
    vec3 direction = normalize(mat3(cameraWorld) * (farView - nearView));
    float depth = textureLod(tDepth, uv, 0.0).r;
    vec3 surface = unproject(uv, depth);
    // Artistic upper sky band matches the distant-scenery material dissolve.
    // Reuse opaque depth: nearby roofs and the lower sea keep their full volume.
    float skyReveal = dioramaSkyReveal(uv, (cameraWorld * vec4(surface, 1.0)).xyz);
    if (depth >= 0.999999) skyReveal = smoothstep(0.56, 0.82, uv.y);
    if (skyReveal >= 0.999) return vec4(0.0, 0.0, 0.0, 1.0);
    float limit = min(length(surface - nearView), 600.0);
    // Never integrate beyond an opaque surface, including with zoom/off-axis ortho.
    if (depth < 0.999999) limit = max(0.0, limit - 0.035);
    float jitter = fract(52.9829189 * fract(dot(floor(uv * volumeSize), vec2(0.06711056, 0.00583715))));
    jitter = mix(0.15, 0.85, jitter);
    float cosine = dot(direction, sunDirection);
    vec3 light = vec3(0.0);
    float transmittance = 1.0;
    vec2 airRange;
    vec2 cloudRange;
    bool hasCloud = slab(origin, direction, seaHeight - 10.0, seaHeight + 3.5, limit, cloudRange);
    bool hasAir = slab(origin, direction, seaHeight - 10.0, seaHeight + 30.0, limit, airRange);
    // Separate the thin air from the dense layer so empty sky doesn't consume cloud steps.
    if (hasAir) {
      float end = hasCloud ? min(airRange.y, cloudRange.x) : airRange.y;
      float ds = max(0.0, end - airRange.x) / float(AIR_STEPS);
      if (ds > 0.0) {
        for (int i = 0; i < AIR_STEPS; i++) {
          vec3 p = origin + direction * (airRange.x + (float(i) + jitter) * ds);
          integrateAir(p, ds, cosine, light, transmittance);
        }
      }
    }
    if (hasCloud) {
      // At grazing angles, concentrate the bounded budget on the first opaque bank.
      float distance = min(cloudRange.y - cloudRange.x, 110.0);
      float ds = distance / float(CLOUD_STEPS);
      for (int i = 0; i < CLOUD_STEPS; i++) {
        vec3 p = origin + direction * (cloudRange.x + (float(i) + jitter) * ds);
        float density = cloudDensity(p, true);
        if (density > 0.001) {
          float alpha = 1.0 - exp(-density * ds);
          vec3 radiance = cloudLight(p, density, cosine, sunVisibility(p));
          light += transmittance * alpha * radiance;
          transmittance *= 1.0 - alpha;
        } else {
          integrateAir(p, ds, cosine, light, transmittance);
        }
        if (transmittance < 0.012) break;
      }
    }
    // RGB is premultiplied in-scattering; A is remaining scene transmittance.
    return mix(vec4(light, transmittance), vec4(0.0, 0.0, 0.0, 1.0), skyReveal);
  }

  void main() {
    #ifdef COMPOSITE
      vec4 scene = textureLod(tScene, vUv, 0.0);
      if (!hasDepth) { outColor = scene; return; }
      float depth = textureLod(tDepth, vUv, 0.0).r;
      float z = -unproject(vUv, depth).z;
      vec2 grid = vUv * volumeSize - 0.5;
      vec2 base = floor(grid);
      vec2 fraction = fract(grid);
      vec4 volume = vec4(0.0);
      float weights = 0.0;
      for (int y = 0; y < 2; y++) {
        for (int x = 0; x < 2; x++) {
          vec2 corner = vec2(float(x), float(y));
          vec2 uv = clamp((base + corner + 0.5) / volumeSize, 0.5 / volumeSize, 1.0 - 0.5 / volumeSize);
          float tapDepth = textureLod(tDepth, uv, 0.0).r;
          float tapZ = -unproject(uv, tapDepth).z;
          vec2 bilinear = mix(1.0 - fraction, fraction, corner);
          float weight = bilinear.x * bilinear.y * exp(-abs(tapZ - z) * 3.0);
          if ((depth >= 0.999999) != (tapDepth >= 0.999999)) weight = 0.0;
          volume += textureLod(tVolume, uv, 0.0) * weight;
          weights += weight;
        }
      }
      // Thin roofs/branches with no matching low-res sample get their own exact ray.
      volume = weights > 0.035 ? volume / weights : march(vUv);
      outColor = vec4(volume.rgb + scene.rgb * volume.a, scene.a);
    #else
      outColor = march(vUv);
    #endif
  }
`;
/**
* Scene-linear HDR atmosphere, inserted after DioramaPass and before DOF/OutputPass.
* setDepthTexture(beauty.target.depthTexture) borrows STANDARD opaque WebGL depth.
* Transparent, depthWrite:false objects cannot occlude the volume. Cloud lighting
* uses two/three sunward density probes, not a cloud shadow map on scene surfaces.
* Shafts combine real opaque sun shadows with a procedural offscreen canopy;
* outside the sun's shadow frustum, only the canopy provides light occlusion.
* update(seconds) is optional: otherwise render's composer delta advances time.
* Calling both advances once; render(0) without update makes a stable capture.
*/
function createAtmospherePass(camera, sunLight, { compact = false } = {}) {
	if (!camera?.isCamera) throw new TypeError("Atmosphere requires a THREE.Camera");
	if (!sunLight?.isDirectionalLight) throw new TypeError("Atmosphere requires a THREE.DirectionalLight");
	const pass = new Pass();
	const cloudSteps = compact ? 28 : 36;
	const airSteps = compact ? 8 : 12;
	const lightSteps = compact ? 2 : 3;
	const data = new Uint8Array(4096 * 64);
	let seed = 2447445413;
	for (let i = 0; i < data.length; i++) {
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		data[i] = seed >>> 24;
	}
	const noise = new Data3DTexture(data, 64, 64, 64);
	noise.name = "Atmosphere.noise";
	noise.format = RedFormat;
	noise.minFilter = noise.magFilter = LinearFilter;
	noise.wrapS = noise.wrapT = noise.wrapR = RepeatWrapping;
	noise.unpackAlignment = 1;
	noise.generateMipmaps = false;
	noise.needsUpdate = true;
	const volumeTarget = new WebGLRenderTarget(1, 1, {
		type: HalfFloatType,
		minFilter: NearestFilter,
		magFilter: NearestFilter,
		depthBuffer: false,
		stencilBuffer: false
	});
	volumeTarget.texture.name = "Atmosphere.scattering-transmittance";
	const uniforms = {
		tScene: { value: null },
		tDepth: { value: null },
		tVolume: { value: volumeTarget.texture },
		tNoise: { value: noise },
		hasDepth: { value: false },
		inverseProjection: { value: camera.projectionMatrixInverse },
		cameraWorld: { value: camera.matrixWorld },
		volumeSize: { value: new Vector2(1, 1) },
		seaHeight: { value: -5 },
		shaftStrength: { value: 1.4 },
		elapsed: { value: 0 },
		daylight: { value: 1 },
		golden: { value: 0 },
		sunDirection: { value: new Vector3() },
		sunRadiance: { value: new Color() },
		sunMatrix: { value: new Matrix4() },
		sunBias: { value: 0 },
		shadowIntensity: { value: 1 },
		shadowTexel: { value: new Vector2(1, 1) },
		tSunShadow: { value: null }
	};
	const materials = [false, true].map((composite) => new ShaderMaterial({
		name: composite ? "Atmosphere.DepthAwareComposite" : "Atmosphere.CloudSea",
		glslVersion: GLSL3,
		uniforms,
		defines: {
			CLOUD_STEPS: cloudSteps,
			AIR_STEPS: airSteps,
			LIGHT_STEPS: lightSteps,
			SHADOW_MODE: 0,
			...composite ? { COMPOSITE: 1 } : {}
		},
		vertexShader,
		fragmentShader,
		depthTest: false,
		depthWrite: false,
		blending: 0,
		toneMapped: false
	}));
	const quad = new FullScreenQuad(null);
	const lightPosition = new Vector3();
	const lightTarget = new Vector3();
	let disposed = false;
	let updated = false;
	let hour = 16.5;
	let width = 1;
	let height = 1;
	let shadowMode = 0;
	let speed = 1;
	let motion = true;
	let projOverride = null;
	const stats = {
		frames: 0,
		calls: 0,
		cpuMs: 0
	};
	pass.setDepthTexture = (texture) => {
		if (disposed) return pass;
		if (texture != null && (!texture.isDepthTexture || texture.compareFunction != null)) throw new TypeError("Atmosphere needs a non-comparison DepthTexture (not packed RGBA depth)");
		uniforms.tDepth.value = texture ?? null;
		uniforms.hasDepth.value = texture != null;
		return pass;
	};
	pass.setHeight = (worldY) => {
		if (!disposed && Number.isFinite(worldY)) uniforms.seaHeight.value = MathUtils.clamp(worldY, -16, 5);
		return pass;
	};
	pass.setStrength = (value) => {
		if (!disposed && Number.isFinite(value)) uniforms.shaftStrength.value = MathUtils.clamp(value, 0, 2);
		return pass;
	};
	pass.setSpeed = (value) => {
		if (!disposed && Number.isFinite(value)) speed = MathUtils.clamp(value, 0, 3);
		return pass;
	};
	pass.setMotion = (enabled) => {
		if (!disposed) motion = Boolean(enabled);
		return pass;
	};
	pass.setProjectionInverse = (matrix) => {
		if (!disposed) projOverride = matrix ?? null;
		return pass;
	};
	pass.setTime = (value) => {
		if (disposed || !Number.isFinite(value)) return pass;
		hour = MathUtils.clamp(value, 0, 24);
		const altitude = Math.sin((hour - 6) * Math.PI / 12);
		uniforms.daylight.value = MathUtils.smoothstep(altitude, -.14, .4);
		uniforms.golden.value = uniforms.daylight.value * (1 - MathUtils.smoothstep(altitude, .25, .85));
		return pass;
	};
	pass.update = (delta) => {
		if (!disposed && Number.isFinite(delta) && delta >= 0) {
			if (motion) uniforms.elapsed.value += delta * speed;
			updated = true;
		}
		return pass;
	};
	pass.setSize = (w, h) => {
		if (disposed || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
		width = Math.max(1, Math.floor(w));
		height = Math.max(1, Math.floor(h));
		const scale = compact ? .4 : .5;
		volumeTarget.setSize(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)));
		uniforms.volumeSize.value.set(volumeTarget.width, volumeTarget.height);
	};
	pass.render = (renderer, writeBuffer, readBuffer, delta = 0, maskActive = false) => {
		if (disposed) return;
		if (renderer.capabilities.logarithmicDepthBuffer || renderer.capabilities.reversedDepthBuffer) throw new Error("Atmosphere requires the standard WebGL depth buffer");
		const start = performance.now();
		if (!updated) pass.update(delta);
		updated = false;
		camera.updateWorldMatrix(true, false);
		uniforms.inverseProjection.value = projOverride ?? camera.projectionMatrixInverse;
		uniforms.cameraWorld.value = camera.matrixWorld;
		sunLight.getWorldPosition(lightPosition);
		sunLight.target.getWorldPosition(lightTarget);
		uniforms.sunDirection.value.subVectors(lightPosition, lightTarget).normalize();
		if (uniforms.sunDirection.value.lengthSq() < .5) uniforms.sunDirection.value.set(0, 1, 0);
		const aboveHorizon = MathUtils.smoothstep(uniforms.sunDirection.value.y, -.06, .12);
		uniforms.sunRadiance.value.copy(sunLight.color).multiplyScalar(Math.max(0, sunLight.intensity) * uniforms.daylight.value * aboveHorizon * (sunLight.visible ? 1 : 0));
		const shadow = sunLight.shadow;
		const shadowTexture = renderer.shadowMap.enabled && sunLight.castShadow && sunLight.visible ? shadow.map?.depthTexture : null;
		const mode = shadowTexture ? shadowTexture.compareFunction != null ? 2 : 1 : 0;
		if (mode !== shadowMode) {
			shadowMode = mode;
			for (const material of materials) {
				material.defines.SHADOW_MODE = mode;
				material.needsUpdate = true;
			}
		}
		uniforms.tSunShadow.value = shadowTexture;
		if (shadowTexture) {
			uniforms.sunMatrix.value.copy(shadow.matrix);
			uniforms.sunBias.value = shadow.bias;
			uniforms.shadowIntensity.value = shadow.intensity;
			uniforms.shadowTexel.value.set(1 / shadow.map.width, 1 / shadow.map.height);
		}
		uniforms.tScene.value = readBuffer.texture;
		const autoClear = renderer.autoClear;
		try {
			renderer.autoClear = false;
			if (uniforms.hasDepth.value) {
				if (maskActive) renderer.state.buffers.stencil.setTest(false);
				renderer.setRenderTarget(volumeTarget);
				quad.material = materials[0];
				quad.render(renderer);
				if (maskActive) renderer.state.buffers.stencil.setTest(true);
			}
			renderer.setRenderTarget(pass.renderToScreen ? null : writeBuffer);
			if (pass.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
			quad.material = materials[1];
			quad.render(renderer);
			stats.calls = uniforms.hasDepth.value ? 2 : 1;
			stats.frames++;
		} finally {
			if (maskActive) renderer.state.buffers.stencil.setTest(true);
			renderer.autoClear = autoClear;
			stats.cpuMs = performance.now() - start;
		}
	};
	pass.getStats = () => ({
		...stats,
		disposed,
		compact,
		width,
		height,
		volumeWidth: volumeTarget.width,
		volumeHeight: volumeTarget.height,
		seaHeight: uniforms.seaHeight.value,
		strength: uniforms.shaftStrength.value,
		speed,
		motion,
		hour,
		elapsed: uniforms.elapsed.value,
		cloudSteps,
		airSteps,
		lightSteps,
		hasDepth: uniforms.hasDepth.value,
		skyRelief: "shared upper-band/world-distance mask; reuses opaque depth and skips fully revealed rays",
		shadowMode: [
			"canopy-only",
			"native-depth",
			"hardware-pcf"
		][shadowMode]
	});
	pass.dispose = () => {
		if (disposed) return;
		disposed = true;
		pass.enabled = false;
		volumeTarget.dispose();
		noise.dispose();
		for (const material of materials) material.dispose();
		quad.dispose();
		uniforms.tDepth.value = uniforms.tScene.value = uniforms.tSunShadow.value = null;
		uniforms.hasDepth.value = false;
	};
	pass.setTime(hour);
	return pass;
}
//#endregion
export { createAtmospherePass };
