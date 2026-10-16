//#region scene3d/src/viewer-sky.js
var skyBudget = Object.freeze({
	additionalDraws: 0,
	additionalPasses: 0,
	textureSamplers: 0,
	cubemaps: 0,
	raymarchSteps: 0,
	starLayers: 2,
	cloudNoiseOctaves: 3,
	temporalAA: false,
	budgetSource: "static code budget, not measured GPU timing",
	projection: "camera-facing cyclorama; azimuth anchored to the camera, altitude from the light direction",
	celestialAlignment: "no painted sun/moon bodies; lighting and scattering follow the key light direction",
	analyticScattering: "Preetham single scattering, luma matched to the authored palette",
	cloudField: "the volume cloud sea carries its own wind and noise; no sky-texture cirrus",
	backdropMask: [.56, .76],
	farSceneryRadius: [22, 28],
	revealBand: [.56, .82],
	sceneryComposition: "tagged exterior scenery only; foreground radius <=22m protected",
	volumeOcclusion: "depth-aware upper-band relief in existing volume march; no depth override",
	skyEvaluations: "background plus tagged distant surfaces; no new draw or texture"
});
var cloudField = Object.freeze({
	windX: .23,
	windZ: .095,
	freqXZ: .3,
	freqY: .38
});
var cloudFieldGlsl = `
  const vec2 dioramaCloudWind = vec2(${cloudField.windX}, ${cloudField.windZ});
  const float dioramaCloudFreq = ${cloudField.freqXZ};
  const float dioramaCloudFreqY = ${cloudField.freqY};
`;
var skyConstants = `
  const float DIORAMA_PI = 3.141592653589793;
  // Half the screen width spans this much azimuth, and one unit of uv.y spans
  // this much altitude: the cyclorama that keeps the body on screen while it
  // still answers to the camera orbit.
  const float DIORAMA_AZ_SPAN = 2.9;
  const float DIORAMA_ALT_SPAN = 2.78;
`;
var skyRevealFragment = `
  float dioramaSkyReveal(vec2 uv, vec3 world) {
    return smoothstep(0.56, 0.82, uv.y) * smoothstep(22.0, 28.0, length(world.xz));
  }
`;
var skyGradientFragment = `
  ${skyConstants}

  // World direction a pixel of the backdrop stands for. Azimuth is measured from
  // the camera facing so orbiting slides the sky; altitude comes from uv.y so the
  // painted band still reads as horizon-to-zenith.
  vec3 dioramaSkyDirection(vec2 uv) {
    float azimuth = dioramaCameraAzimuth + (uv.x - 0.5) * 2.0 * DIORAMA_AZ_SPAN;
    float altitude = (uv.y - 0.5) * DIORAMA_ALT_SPAN;
    float horizontal = cos(altitude);
    return vec3(sin(azimuth) * horizontal, sin(altitude), cos(azimuth) * horizontal);
  }

  float dioramaSunIntensity(float altitude) {
    float zenithAngleCos = clamp(altitude, -1.0, 1.0);
    return 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(zenithAngleCos)) / 1.5)));
  }

  // Preetham analytic sky, single scattering, evaluated on the backdrop direction.
  // Only the sun direction is real; the zenith angles come from the cyclorama
  // mapping above, which is what keeps the diorama's painted composition intact.
  vec3 dioramaSkyScatter(vec3 direction, vec3 sunDirection) {
    vec3 dir = normalize(vec3(direction.x, max(direction.y, -0.03), direction.z));
    float zenithAngle = acos(clamp(dir.y, -1.0, 1.0));
    float degreesFromZenith = degrees(zenithAngle);
    float airmass = max(cos(zenithAngle) + 0.15 * pow(max(93.885 - degreesFromZenith, 0.75), -1.253), 0.02);
    float rayleighLength = 8400.0 / airmass;
    float mieLength = 1250.0 / airmass;
    vec3 betaR = vec3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
    vec3 betaM = vec3(1.096e-7, 1.636e-7, 2.359e-7);
    vec3 extinction = exp(-(betaR * rayleighLength + betaM * mieLength));
    float cosTheta = dot(dir, sunDirection);
    float phaseR = 0.05968310365946075 * (1.0 + cosTheta * cosTheta);
    float g = 0.8;
    float mieDenom = max(1.0 + g * g - 2.0 * g * cosTheta, 1e-4);
    float phaseM = 0.07957747154594767 * (1.0 - g * g) / pow(mieDenom, 1.5);
    float sunfade = 1.0 - clamp(1.0 - exp(sunDirection.y), 0.0, 1.0);
    // At night the same arc carries moonlight, so the scattering budget drops with it.
    float sunE = dioramaSunIntensity(sunDirection.y) * mix(1.0, 0.06, clamp(dioramaNight, 0.0, 1.0));
    vec3 scatter = (betaR * rayleighLength) * phaseR + (betaM * mieLength) * phaseM;
    vec3 luminance = sunE * scatter * (1.0 - extinction);
    vec3 lin = pow(luminance, vec3(1.5));
    lin *= mix(vec3(1.0), pow(luminance, vec3(0.5)), clamp(pow(1.0 - sunDirection.y, 5.0), 0.0, 1.0));
    vec3 color = (lin + vec3(0.1) * extinction) * 0.04 + vec3(0.0, 0.0003, 0.00075);
    return pow(color, vec3(1.0 / (1.2 + 1.2 * sunfade)));
  }

  // Authored palette gradient, optionally replaced by analytic scattering.
  vec3 dioramaSkyGradient(vec2 uv) {
    vec3 base = mix(dioramaHorizonColor, dioramaSkyColor, smoothstep(0.1, 1.0, uv.y));
    if (dioramaSkyAnalytic <= 0.001) return base;
    vec3 activeLight = normalize(mix(dioramaSunDirection, dioramaMoonDirection, clamp(dioramaNight, 0.0, 1.0)));
    vec3 scatter = dioramaSkyScatter(dioramaSkyDirection(uv), activeLight);
    float scatterLuma = max(dot(scatter, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    float authoredLuma = max(dot(base, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    // Keep the physical hue and its horizon ramp, but hold the authored exposure
    // so the seasonal palette still sets how bright the sky reads.
    vec3 tuned = scatter * (mix(scatterLuma, authoredLuma, 0.45) / scatterLuma);
    return mix(base, tuned, dioramaSkyAnalytic);
  }
`;
var skyFragment = `
  ${cloudFieldGlsl}

  vec3 dioramaStars(vec2 p, float scale, float seed) {
    // The camera zoom magnifies the scene; the starfield must magnify with it or
    // it reads as a pasted-on layer. Zooming the coordinate spreads the grid
    // (fewer, wider cells) and the radius scale grows the disk so both the spacing
    // and the star size track the camera instead of staying a fixed screen size.
    vec2 q = p / dioramaSkyZoom;
    vec2 cell = floor(q * scale);
    float h = dioramaHash(cell + seed);
    vec2 center = 0.15 + 0.7 * vec2(dioramaHash(cell + seed + 17.2), dioramaHash(cell + seed + 39.8));
    float d = length(fract(q * scale) - center);
    float aa = max(length(fwidth(q * scale)) * 0.55, 0.001);
    // A finite soft footprint survives the existing sparse cinematic DOF taps;
    // subpixel disks otherwise turn into conspicuous dotted bokeh rings.
    float radius = max(0.05, aa * 3.4) * 0.6 * dioramaSkyZoom;
    float star = exp(-d * d / (radius * radius)) * step(0.9832, h);
    float twinkle = 0.62 + 0.38 * sin(dioramaSkyTime * (0.8 + center.x * 1.7) + h * 213.0);
    vec3 tint = mix(vec3(0.58, 0.73, 1.0), vec3(1.0, 0.86, 0.66), dioramaHash(cell + 8.2));
    return tint * star * twinkle * (1.5 + h);
  }

  vec3 dioramaCelestialSky(vec3 base, vec2 uv) {
    float backdrop = smoothstep(0.56, 0.76, uv.y);
    if (dioramaSkyEffects < 0.5 || backdrop <= 0.0) return base;
    float aspect = max(dioramaViewport.z / max(dioramaViewport.w, 1.0), 0.1);
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    vec3 result = base;
    float night = clamp(dioramaNight, 0.0, 1.0);
    float darkness = night * night;
    if (darkness > 0.001) {
      // Broad tilted galactic band with a broken dust lane, not a textured dome.
      vec2 sp = p / dioramaSkyZoom;
      vec2 galaxy = vec2(sp.x * 0.86 + sp.y * 0.51, -sp.x * 0.51 + sp.y * 0.86);
      float bandOffset = (galaxy.y - 0.17) * 8.5;
      float band = exp(-bandOffset * bandOffset);
      float dust = dioramaBillow(galaxy * vec2(5.0, 19.0) + 41.3);
      float lane = smoothstep(0.035, 0.085, abs(galaxy.y - 0.17 + (dust - 0.5) * 0.06));
      result += vec3(0.11, 0.14, 0.24) * band * (0.22 + dust * 0.78) * (0.3 + lane * 0.7) * darkness;
      result += (dioramaStars(p, 45.0, 11.0) + dioramaStars(p, 89.0, 83.0) * 0.55) * darkness;
    }
    // The painted sun/moon discs were removed: they duplicated the key light and
    // read as stickers. Lighting, shadows and scattering still follow the real
    // light direction, so only the drawn body is gone.

    return mix(base, result, backdrop);
  }

  // Gradient plus the celestial pass. Both the background quad and the distant
  // scenery dissolve call this, so they cannot drift apart.
  vec3 dioramaSkyBackdrop(vec2 uv) {
    return dioramaCelestialSky(dioramaSkyGradient(uv), uv);
  }
`;
//#endregion
export { skyRevealFragment as a, skyGradientFragment as i, skyBudget as n, skyFragment as r, cloudField as t };
