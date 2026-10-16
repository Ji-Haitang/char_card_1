import * as THREE from 'three'
import { skyBudget, skyFragment, skyGradientFragment, skyRevealFragment } from './viewer-sky.js'
import { INTERIOR_SCENES } from './interior-scenes.js'
import { addWindowViews, applyWindowViewMaterial } from './viewer-window-views.js'
import { RENDER_DEFAULTS, DEFAULT_PAPER_COLOR, NIGHT_PAPER_COLOR } from './render-defaults.js'

export const environmentProgramKey = 'diorama-environment-v8'
const seasons = ['spring', 'summer', 'autumn', 'winter']
const roles = { Diorama_Foliage: 'foliage', Diorama_Blossom: 'blossom', Diorama_Crop: 'crop', Diorama_InkAndPigment: 'surface', Diorama_LanternGlow: 'glow', Diorama_PlaqueGold: 'gold', LanternGlow: 'glow', PlaqueGold: 'gold', Smith_blossom: 'blossom' }
const roleIds = { surface: 0, foliage: 1, blossom: 2, crop: 3, glow: 4, gold: 5 }
const noise = /* glsl */`
  float dioramaHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float dioramaNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(dioramaHash(i), dioramaHash(i + vec2(1,0)), f.x),
      mix(dioramaHash(i + vec2(0,1)), dioramaHash(i + vec2(1,1)), f.x), f.y);
  }
  float dioramaBillow(vec2 p) {
    return dioramaNoise(p) * 0.58 + dioramaNoise(p * 2.03 + 7.1) * 0.28
      + dioramaNoise(p * 4.11 + 19.4) * 0.14;
  }
  vec3 dioramaSea(vec2 world, float clock, vec3 shade, vec3 light) {
    vec2 flow = vec2(clock * 0.025, -clock * 0.012);
    vec2 p = world * 0.095 + flow;
    float curl = dioramaNoise(p * 0.53 - flow * 0.25);
    float billow = dioramaBillow(p + vec2(curl * 1.8, curl * 0.7));
    float wisps = dioramaNoise(p * vec2(1.4, 4.8) + billow * 2.0);
    return mix(shade, light, smoothstep(0.24, 0.78, billow + wisps * 0.12));
  }
`

/**
 * Explicit, instance-local environment; importing this module never accesses UI.
 * collect owns main-model material variants; prepareInterior owns room variants,
 * window planes and local lights. Source GLB geometry/textures/materials are borrowed.
 * Release environment bindings BEFORE the host disposes the source GLB resources.
 * tick advances visual animation only; game time can only change through setTime.
 */
export function createEnvironment({ scene, camera, renderer, sun, fill, ambient, api = {}, reducedMotion = false, onTimeChange, onPaperColor, onCloudHeight, onCloudSpeed, onCloudMotion, exposureOverride, volumeClouds = false, paperColor = DEFAULT_PAPER_COLOR }) {
  api.metrics ??= {}
  let disposed = false
  // Starfield zoom reference: the main-scene home zoom the authored look was tuned
  // against. createEnvironment runs before positionCamera sets camera.zoom, so this
  // is pinned to the 'main' home zoom (1.24) instead of reading camera.zoom (still 1 here).
  const skyZoomBase = 1.24
  const state = { timeOfDay: 14, season: 'spring', autoTime: false, cloudHeight: 4.4, cloudMotion: !reducedMotion, cloudSpeed: 1, clockSeconds: 0, cloudSeconds: 0, paused: false, reducedMotion: Boolean(reducedMotion), skyEffects: true, skyBlend: false, skyAnalytic: true, roomLightStrength: 1 }
  const originalFog = scene.fog
  const originalFogColor = originalFog?.color.clone()
  const originalExposure = renderer.toneMappingExposure
  const originalLights = [sun, fill, ambient].map(light => ({ light, color: light.color.clone(), groundColor: light.groundColor?.clone(), intensity: light.intensity, position: light.position.clone() }))
  const uniforms = {
    dioramaPaperBackground: { value: 0 },
    dioramaPaperAlpha: { value: 1 },
    dioramaPaperColor: { value: new THREE.Color(paperColor) },
    dioramaHazeStrength: { value: 1 },
    dioramaHazeScale: { value: RENDER_DEFAULTS.hazeStrength },
    dioramaHazeColor: { value: new THREE.Color() },
    dioramaCloudColor: { value: new THREE.Color() },
    dioramaCloudShade: { value: new THREE.Color() },
    dioramaSkyColor: { value: new THREE.Color() },
    dioramaHorizonColor: { value: new THREE.Color() },
    dioramaCloudHeight: { value: state.cloudHeight },
    dioramaCloudTime: { value: 0 },
    dioramaSeason: { value: 0 },
    dioramaNight: { value: 0 },
    dioramaDayPhase: { value: 0 },
    dioramaSkyEffects: { value: 1 },
    dioramaSkyTime: { value: 0 },
    dioramaRoomLightStrength: { value: 1 },
    dioramaRoomTint: { value: new THREE.Color('#ffffff') },
    dioramaViewDirection: { value: new THREE.Vector3() },
    dioramaViewport: { value: new THREE.Vector4() },
    dioramaCameraNear: { value: camera.near },
    dioramaVolumetric: { value: volumeClouds ? 1 : 0 },
    // Scales how strongly tagged far scenery dissolves into the painted sky.
    // 0 keeps the distant mountain geometry fully intact, 1 is the authored look.
    dioramaSkyBlend: { value: 0 },
    // Key light direction in world space. The analytic scattering reads it, so the
    // backdrop can never contradict the shadows.
    dioramaSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    dioramaMoonDirection: { value: new THREE.Vector3(0, -1, 0) },
    dioramaCameraAzimuth: { value: 0 },
    // Camera zoom ratio (vs home framing) so the starfield magnifies with the
    // scene instead of staying a fixed screen size.
    dioramaSkyZoom: { value: 1 },
    // 0 keeps the authored two-colour gradient, 1 uses Preetham scattering.
    dioramaSkyAnalytic: { value: 1 },
  }
  const skyMaterial = new THREE.ShaderMaterial({
    name: 'Diorama_CloudSea', depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { ...uniforms, inverseProjection: { value: camera.projectionMatrixInverse }, cameraWorld: { value: camera.matrixWorld } },
    vertexShader: /* glsl */`
      uniform mat4 inverseProjection;
      uniform mat4 cameraWorld;
      varying vec3 rayOrigin;
      varying vec3 rayDirection;
      varying vec2 skyUV;
      void main() {
        skyUV = position.xy * 0.5 + 0.5;
        vec4 nearPoint = inverseProjection * vec4(position.xy, -1.0, 1.0);
        vec4 farPoint = inverseProjection * vec4(position.xy, 1.0, 1.0);
        rayOrigin = (cameraWorld * vec4(nearPoint.xyz / nearPoint.w, 1.0)).xyz;
        rayDirection = (cameraWorld * vec4(farPoint.xyz / farPoint.w, 1.0)).xyz - rayOrigin;
        gl_Position = vec4(position.xy, 0.9999, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 rayOrigin;
      varying vec3 rayDirection;
      varying vec2 skyUV;
      uniform float dioramaCloudHeight, dioramaCloudTime, dioramaHazeStrength, dioramaVolumetric;
      uniform vec3 dioramaCloudColor, dioramaCloudShade, dioramaSkyColor, dioramaHorizonColor;
      uniform float dioramaSkyEffects, dioramaSkyTime, dioramaDayPhase, dioramaNight;
      uniform float dioramaCameraAzimuth, dioramaSkyAnalytic, dioramaSkyZoom;
      uniform vec3 dioramaSunDirection, dioramaMoonDirection, dioramaViewDirection;
      uniform vec4 dioramaViewport;
      uniform float dioramaPaperBackground, dioramaPaperAlpha;
      uniform vec3 dioramaPaperColor;
      ${noise}
      ${skyGradientFragment}
      ${skyFragment}
      void main() {
        if (dioramaPaperBackground > 0.5) {
          // Opaque paper. The cinematic output detects the backdrop by far depth
          // plus opaque alpha — a marker that survives mobile HalfFloat/MSAA
          // resolves (unlike the old zero-alpha coverage, which some GPUs lost).
          // Transparent cloth/water over the backdrop keep alpha < 1 and survive.
          gl_FragColor = vec4(dioramaPaperColor, 1.0);
          #include <colorspace_fragment>
          return;
        }
        vec3 ray = normalize(rayDirection);
        float distanceToSea = (dioramaCloudHeight - rayOrigin.y) / min(ray.y, -0.001);
        vec3 sky = dioramaSkyBackdrop(skyUV);
        float visibleSea = (1.0 - smoothstep(85.0, 260.0, distanceToSea)) * step(0.0, distanceToSea) * step(ray.y, -0.001);
        // Artistic upper backdrop for parallel downward home-camera rays.
        visibleSea *= 1.0 - smoothstep(0.56, 0.76, skyUV.y);
        // The existing volume atmosphere owns its sea; do not shade a second one.
        visibleSea *= (1.0 - dioramaVolumetric) * dioramaHazeStrength;
        if (visibleSea > 0.001) {
          vec2 world = (rayOrigin + ray * clamp(distanceToSea, 0.0, 2000.0)).xz;
          sky = mix(sky, dioramaSea(world, dioramaCloudTime, dioramaCloudShade, dioramaCloudColor), visibleSea);
        }
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial)
  sky.name = 'Viewer_CloudSea_Background'
  sky.frustumCulled = false
  sky.renderOrder = -10000
  sky.onBeforeRender = (_renderer, _scene, renderCamera) => {
    uniforms.dioramaPaperAlpha.value = _renderer.getRenderTarget() ? 0 : 1
    skyMaterial.uniforms.inverseProjection.value = renderCamera.projectionMatrixInverse
    skyMaterial.uniforms.cameraWorld.value = renderCamera.matrixWorld
    renderCamera.getWorldDirection(uniforms.dioramaViewDirection.value)
    // Backdrop azimuth follows the camera, so orbiting slides the painted sky.
    uniforms.dioramaCameraAzimuth.value = Math.atan2(uniforms.dioramaViewDirection.value.x, uniforms.dioramaViewDirection.value.z)
    _renderer.getCurrentViewport(uniforms.dioramaViewport.value)
    uniforms.dioramaCameraNear.value = renderCamera.near
    // Starfield magnifies with the scene: normalize against the home zoom so the
    // authored look is unchanged at rest, then scale by the live zoom.
    uniforms.dioramaSkyZoom.value = renderCamera.zoom / skyZoomBase
    api.metrics.environment.sky.cameraType = renderCamera.isOrthographicCamera ? 'orthographic' : 'perspective'
  }
  scene.add(sky)

  // Palette and haze uniforms stay linear; convert for the actual render target.
  const keys = [
    [0, '#2a4d82', '#26354d', '#53637d', '#27344e', '#8fa7e5', '#7995c1', 0.8, 0.62, 0.92],
    [5, '#182039', '#8a696e', '#877e92', '#444d69', '#b3bce5', '#899ac5', 0.75, 0.55, 0.90],
    [6.5, '#829ba8', '#f4be8e', '#edd9ba', '#939dae', '#ffd1a1', '#b1c8e1', 2.3, 1.20, 1.04],
    [12, '#aebfcb', '#e4ddd1', '#f3eddd', '#aabcc4', '#fff0d5', '#d2e5f4', 3.0, 1.55, 1.08],
    [16, '#a7b9c0', '#ead5b3', '#f3e5c9', '#a4b9c0', '#ffdab0', '#c5dfed', 2.8, 1.45, 1.08],
    [18, '#645e7e', '#db9474', '#d8b6ab', '#777a97', '#ffad79', '#9eacd5', 2.0, 1.0, 1.0],
    [19.5, '#17213d', '#574867', '#7b7795', '#3a415e', '#a1b4ee', '#839cc6', 0.8, 0.6, 0.90],
    [24, '#2a4d82', '#26354d', '#53637d', '#27344e', '#8fa7e5', '#7995c1', 0.8, 0.62, 0.92],
  ].map(([hour, ...values]) => [hour, ...values.map(value => typeof value === 'string' ? new THREE.Color(value) : value)])
  const color = new THREE.Color(), lightPosition = new THREE.Vector3(), sunPosition = new THREE.Vector3(), moonPosition = new THREE.Vector3()
  const baseMaterials = new Set()
  const patchedMaterials = new Map()
  const exteriors = new Map()
  const interiors = new Map()
  const lanternLights = []
  const boundModels = new Set()
  const exteriorFog = scene.fog || (volumeClouds ? null : new THREE.Fog('#d5e2dd', 76, 160))
  const exteriorShadow = Object.fromEntries(['left', 'right', 'top', 'bottom', 'near', 'far'].map(key => [key, sun.shadow.camera[key]]))
  const exteriorNormalBias = sun.shadow.normalBias
  const exteriorTarget = sun.target.position.clone()
  const roomTints = ['#fff3e6', '#f3f8ff', '#ffe9d1', '#dae8ff'].map(value => new THREE.Color(value))
  let activeInterior = null
  let lastShadow = -Infinity, shadowHour = null
  api.metrics.environment = {
    backgroundDraws: 1, shadowUpdates: 0, shadowIntervalSeconds: 0.5, taggedMaterials: {}, shaderKey: environmentProgramKey,
    interior: null, dofSceneScale: 1, roomLightCount: 0, roomLightLimit: 4, roomLightStrength: 1, roomLights: [], preparedInteriors: 0, interiorMaterials: 0,
    sky: { ...skyBudget, enabled: true, blend: false, analytic: true, clock: 'shared environment clock; automatic motion freezes on pause/reduced motion', cameraType: camera.isOrthographicCamera ? 'orthographic' : 'perspective' },
  }
  const nightAt = hour => 1 - THREE.MathUtils.smoothstep(Math.sin((hour - 6) * Math.PI / 12), -0.12, 0.22)
  const paperDay = uniforms.dioramaPaperColor.value.clone()
  const paperNight = new THREE.Color(NIGHT_PAPER_COLOR)
  function updatePaper(night) {
    const paper = uniforms.dioramaPaperColor.value.copy(paperDay).lerp(paperNight, night)
    api.metrics.environment.paperColor = `#${paper.getHexString()}`
    // The optional cinematic output consumes the same linear palette. No DOM,
    // storage or autonomous clock is needed, including on the plain/low path.
    if (typeof onPaperColor === 'function') onPaperColor(paper.clone())
  }

  function updateLight(forceShadow = false) {
    if (disposed) return false
    const hour = state.timeOfDay
    const index = keys.findIndex((key, i) => i < keys.length - 1 && hour >= key[0] && hour < keys[i + 1][0])
    const a = keys[Math.max(0, index)], b = keys[Math.max(0, index) + 1]
    let t = (hour - a[0]) / (b[0] - a[0])
    t = t * t * (3 - 2 * t)
    for (const [name, column] of [['dioramaSkyColor', 1], ['dioramaHorizonColor', 2], ['dioramaCloudColor', 3], ['dioramaCloudShade', 4]]) uniforms[name].value.copy(a[column]).lerp(b[column], t)
    color.copy(uniforms.dioramaCloudShade.value).lerp(uniforms.dioramaCloudColor.value, 0.68)
    const night = nightAt(hour)
    updatePaper(night)
    uniforms.dioramaHazeColor.value.copy(color).lerp(uniforms.dioramaSkyColor.value, night)
    scene.fog?.color.copy(uniforms.dioramaHazeColor.value)
    sun.color.copy(a[5]).lerp(b[5], t)
    fill.color.copy(a[6]).lerp(b[6], t)
    sun.intensity = THREE.MathUtils.lerp(a[7], b[7], t)
    fill.intensity = THREE.MathUtils.lerp(a[8], b[8], t)
    // Cinematic uses the ts3d constant exposure; the plain path keeps the per-hour curve.
    renderer.toneMappingExposure = exposureOverride ?? THREE.MathUtils.lerp(a[9], b[9], t)
    uniforms.dioramaNight.value = night
    uniforms.dioramaDayPhase.value = (hour - 12) * Math.PI / 12
    // Change only the backdrop palette, not the established cloud/lighting curves.
    uniforms.dioramaSkyColor.value.lerp(color.set('#368ddd'), (1 - night) * 0.82)
    // Night moonlight keeps the model readable without changing the light arc.
    sun.color.lerp(color.set('#c3d5f5'), night)
    sun.intensity = THREE.MathUtils.lerp(sun.intensity, 1.45, night)
    fill.color.lerp(color.set('#a5badd'), night)
    fill.intensity = THREE.MathUtils.lerp(fill.intensity, 0.95, night)
    fill.groundColor.set('#7d827b').lerp(color.set('#3c4b68'), night)
    ambient.color.set('#efdfc9').lerp(color.set('#97aed5'), night)
    ambient.intensity = THREE.MathUtils.lerp(0.2, 0.22, night)
    for (const light of lanternLights) {
      light.visible = !activeInterior
      light.intensity = activeInterior ? 0 : light.userData.nightIntensity * night
    }
    if (activeInterior && !activeInterior.landscape) {
      uniforms.dioramaRoomTint.value.copy(roomTints[seasons.indexOf(state.season)])
      // Moonlight is cool, so at night ease the warm seasonal tint back toward
      // white; otherwise it neutralises the blue and the room reads lantern-warm.
      const interiorTint = uniforms.dioramaRoomTint.value.clone().lerp(color.set('#ffffff'), night * 0.5)
      sun.color.multiply(interiorTint)
      fill.color.lerp(interiorTint, 0.12)
      ambient.color.multiply(interiorTint)
      sun.intensity *= THREE.MathUtils.lerp(0.82, 0.62, night)
      fill.intensity *= THREE.MathUtils.lerp(0.78, 0.74, night)
      ambient.intensity *= THREE.MathUtils.lerp(0.85, 1.5, night)
      updateRoomLights(night)
    } else {
      uniforms.dioramaRoomTint.value.set('#ffffff')
      if (activeInterior) updateRoomLights(night)
    }
    // Sun rises east (06:00), peaks south (12:00), sets west (18:00). The full moon
    // is antipodal: it rises east at dusk, peaks south at midnight. Each body's own
    // altitude crosses the horizon, so the inactive one hides below the cyclorama
    // instead of two spheres sharing one always-elevated arc.
    const sunPhase = (hour - 6) * Math.PI / 12
    const moonPhase = sunPhase - Math.PI
    sunPosition.set(38 * Math.cos(sunPhase), 4 + 66 * Math.sin(sunPhase), 38 * Math.sin(sunPhase))
    moonPosition.set(38 * Math.cos(moonPhase), 4 + 66 * Math.sin(moonPhase), 38 * Math.sin(moonPhase))
    // The shadow key light is the sun by day and the moon by night; analytic
    // scattering and cast shadows stay two views of the same light.
    lightPosition.copy(sunPosition).lerp(moonPosition, night)
    uniforms.dioramaSunDirection.value.copy(sunPosition).sub(sun.target.position).normalize()
    uniforms.dioramaMoonDirection.value.copy(moonPosition).sub(sun.target.position).normalize()
    const since = state.clockSeconds - lastShadow
    if (shadowHour === null || forceShadow || (since >= 0.5 && Math.abs(hour - shadowHour) >= 0.025)) {
      sun.position.copy(lightPosition)
      if (activeInterior) {
        // Fit the actual room in light space; sun still follows its original arc.
        activeInterior.bounds.getCenter(sun.target.position)
        sun.target.updateMatrixWorld(true)
        sun.updateMatrixWorld(true)
        sun.shadow.updateMatrices(sun)
        const bounds = activeInterior.bounds.clone().applyMatrix4(sun.shadow.camera.matrixWorldInverse)
        Object.assign(sun.shadow.camera, { left: bounds.min.x - 1, right: bounds.max.x + 1, bottom: bounds.min.y - 1, top: bounds.max.y + 1,
          near: Math.max(0.1, -bounds.max.z - 2), far: Math.max(1, -bounds.min.z + 2) })
        sun.shadow.camera.updateProjectionMatrix()
      }
      renderer.shadowMap.needsUpdate = true
      shadowHour = hour
      lastShadow = state.clockSeconds
    }
    if (typeof onTimeChange === 'function') onTimeChange(hour)
    api.metrics.environment.night = night
    api.metrics.environment.roomTint = uniforms.dioramaRoomTint.value.getHexString()
    api.metrics.environment.shadowBounds = Object.fromEntries(['left', 'right', 'top', 'bottom', 'near', 'far'].map(key => [key, sun.shadow.camera[key]]))
    api.metrics.environment.shadowNormalBias = sun.shadow.normalBias
    api.metrics.environment.activeLocalLights = activeInterior ? activeInterior.lights.length : lanternLights.length
  }

  function refreshAtmosphere(preference = api.metrics.atmosphere !== false) {
    if (disposed) return false
    const preferred = Boolean(preference)
    const effective = preferred && !activeInterior
    api.metrics.atmosphere = preferred
    uniforms.dioramaHazeStrength.value = effective ? 1 : 0
    uniforms.dioramaVolumetric.value = volumeClouds && effective ? 1 : 0
    scene.fog = effective && !volumeClouds ? exteriorFog : null
    if (scene.fog) scene.fog.color.copy(uniforms.dioramaHazeColor.value)
    Object.assign(api.metrics.environment, { atmospherePreference: preferred, effectiveAtmosphere: effective,
      subsceneHaze: false, subsceneShafts: false,
      effectiveHazeStrength: uniforms.dioramaHazeStrength.value, volumeClouds: volumeClouds && effective, fog: scene.fog !== null })
    return effective
  }

  function updateMaterialMetrics() {
    const materials = [...baseMaterials]
    let interiorMaterials = 0
    for (const room of interiors.values()) {
      materials.push(...room.materials)
      interiorMaterials += room.materials.size
    }
    api.metrics.environment.taggedMaterials = materials.reduce((counts, material) => {
      const role = material.userData.viewerSeasonRole
      counts[role] = (counts[role] || 0) + 1
      return counts
    }, {})
    Object.assign(api.metrics.environment, { preparedInteriors: interiors.size, interiorMaterials, exteriorMaterials: baseMaterials.size })
  }

  function meshBounds(mesh, slot = null) {
    const geometry = mesh.geometry
    const bounds = new THREE.Box3()
    const groups = slot === null ? [] : geometry.groups.filter(group => group.materialIndex === slot)
    if (groups.length) {
      // Multi-material meshes must not turn the whole room into a window bound.
      const point = new THREE.Vector3(), position = geometry.attributes.position
      const count = geometry.index?.count ?? position.count
      for (const group of groups) for (let i = group.start; i < Math.min(group.start + group.count, count); i++) {
        point.fromBufferAttribute(position, geometry.index ? geometry.index.getX(i) : i)
        bounds.expandByPoint(point)
      }
    } else {
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      bounds.copy(geometry.boundingBox)
    }
    return bounds.applyMatrix4(mesh.matrixWorld)
  }

  function prepareInterior(root, id) {
    if (disposed || !root?.isObject3D || exteriors.has(root)) return false
    if (interiors.has(root)) return true
    root.updateWorldMatrix(true, true)
    const room = { root, id: id ?? (root.name || root.uuid), landscape: INTERIOR_SCENES[id]?.environment === 'landscape', bounds: new THREE.Box3(), meshes: [], materials: new Set(), assignments: [], sources: [], lights: [], windowViews: [], windowResources: [] }
    const variants = new Map(), sources = new Map(), greenSignals = new WeakMap()
    // Register ownership before shader hooks run, so failed preparation is releasable.
    interiors.set(root, room)
    try {
    root.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return
      let names = '', source = null, kind = null, plantZone = false
      for (let node = mesh; node; node = node.parent) {
        if (node.userData.navigationOnly === true) return
        const label = `${node.name || ''} ${node.userData.interactionId || ''}`
        names += ` ${label}`
        if (/plant|bonsai|foliage|flower|herb|bamboo|vegetation/i.test(label)) plantZone = true
        if (/^window(?:_|$)/i.test(node.userData.interactionId || '')) { source = node; kind = 'window' }
        else if (kind !== 'window' && /stove|furnace|brazier|hearth|firebox/i.test(label)) { source = node; kind = 'heat' }
        else if (!source && /lantern|lamp|glow|emiss|flame/i.test(label)) { source = node; kind = 'glow' }
        if (node === root) break
      }
      room.meshes.push(mesh)
      room.bounds.union(meshBounds(mesh))
      const original = mesh.material
      const replacements = [].concat(original).map((material, slot) => {
        if (!material?.isMeshStandardMaterial) return material
        const materialName = material.name || ''
        const authoredRole = roles[materialName.replace(/\.\d{3}$/, '')] || material.userData.seasonRole
        const emitted = (material.emissive && Math.max(material.emissive.r, material.emissive.g, material.emissive.b) > 0 && material.emissiveIntensity > 0)
          || /glow|emiss|flame|firelight/i.test(materialName)
        const protectedPigment = /portrait|painting|calligraphy|couplet|text|plaque|book|scroll|rug|floor|table|desk/i.test(`${names} ${materialName}`)
        const colors = material.vertexColors && mesh.geometry.attributes.color
        if (colors && !greenSignals.has(colors)) {
          let samples = 0, green = 0
          for (let i = 0, stride = Math.max(1, Math.ceil(colors.count / 2048)); i < colors.count; i += stride) {
            const g = colors.getY(i)
            if (g > 0.06 && g > Math.max(colors.getX(i), colors.getZ(i)) * 1.13 + 0.025) green++
            samples++
          }
          greenSignals.set(colors, green >= 2 && green / Math.max(samples, 1) > 0.015)
        }
        const authoredPlant = ['foliage', 'blossom', 'crop'].includes(authoredRole)
        // Never infer vegetation from a textured portrait or a shared wood albedo.
        const vegetation = room.landscape
          ? authoredPlant || (room.id === 'forge' && /garden/i.test(names) && !material.map && colors && greenSignals.get(colors))
          : !protectedPigment && (plantZone || (!material.map && colors && greenSignals.get(colors)))
        const role = emitted ? 'glow' : vegetation ? (authoredPlant ? authoredRole : 'foliage') : 'surface'
        const mask = vegetation && (!room.landscape || !authoredPlant) ? (colors ? 2 : authoredPlant ? 0 : 1) : 0
        const window = emitted && kind === 'window' ? 1 : 0
        const profile = `${role}:${mask}:${window}`
        if (!variants.has(material)) variants.set(material, new Map())
        const byProfile = variants.get(material)
        if (!byProfile.has(profile)) {
          // Runtime variants own only shader hooks. All source maps/PBR/alpha and
          // vertex-color flags survive clone(), and textures remain source-owned.
          const clone = material.clone()
          const previous = patchedMaterials.get(material)
          clone.onBeforeCompile = previous?.compile ?? material.onBeforeCompile
          clone.customProgramCacheKey = previous ? () => previous.key : material.customProgramCacheKey
          Object.assign(clone.userData, { viewerInterior: true, viewerOutdoor: room.landscape, viewerWater: room.landscape && /Ravine_(water|foam)/.test(materialName), viewerInteriorRole: role, viewerVegetationMask: mask, viewerWindowLight: window })
          if (room.landscape && /(?:Ravine_(water|foam)|Smith_water)/.test(materialName)) clone.userData.snowEligible = false
          room.materials.add(clone)
          applyMaterial(clone, false)
          byProfile.set(profile, clone)
        }
        if (kind === 'window' || emitted) {
          const owner = source || mesh
          if (!sources.has(owner)) sources.set(owner, { kind: kind || 'glow', name: owner.userData.interactionId || owner.name || materialName, members: [], bounds: new THREE.Box3() })
          // A semantic lantern contributes only its emitting surfaces, not its frame.
          sources.get(owner).members.push({ mesh, slot })
        }
        return byProfile.get(profile)
      })
      mesh.material = Array.isArray(original) ? replacements : replacements[0]
      room.assignments.push({ mesh, original, replacements })
    })
    room.sources = [...sources.values()]
    room.windowViews = addWindowViews(root, room.id, uniforms)
    room.windowResources = room.windowViews.map(view => ({ view, geometry: view.geometry, material: view.material }))
    updateMaterialMetrics()
    return true
    } catch (error) {
      releaseInterior(root)
      throw error
    }
  }

  function updateRoomLights(night = uniforms.dioramaNight.value) {
    if (!activeInterior) return
    for (const light of activeInterior.lights) {
      const { kind, dayIntensity, nightIntensity } = light.userData
      light.color.set(kind === 'window' ? '#fff0d5' : kind === 'heat' ? '#ff9948' : '#ffbd75')
      if (kind === 'window') light.color.lerp(color.set('#87adff'), night).multiply(uniforms.dioramaRoomTint.value)
      light.intensity = THREE.MathUtils.lerp(dayIntensity, nightIntensity, night) * state.roomLightStrength
    }
    api.metrics.environment.roomLights = activeInterior.lights.map(light => ({ name: light.name, kind: light.userData.kind,
      source: light.userData.source, position: light.position.toArray(), distance: light.distance, intensity: light.intensity,
      color: light.color.getHexString(), castShadow: light.castShadow }))
  }

  function setInterior(root, id = null) {
    if (disposed) return false
    // Loading/preparation belongs to main; never silently prepare an unknown root.
    if (root !== null && !interiors.has(root)) return false
    if (activeInterior) for (const light of activeInterior.lights) light.removeFromParent()
    activeInterior = root === null ? null : interiors.get(root)
    uniforms.dioramaPaperBackground.value = activeInterior ? 1 : 0
    api.metrics.environment.background = activeInterior ? 'paper' : 'sky'
    if (activeInterior) {
      const room = activeInterior
      if (id !== null) room.id = id
      root.updateWorldMatrix(true, true)
      room.bounds.makeEmpty()
      for (const mesh of room.meshes) room.bounds.union(meshBounds(mesh))
      if (room.bounds.isEmpty()) room.bounds.setFromCenterAndSize(root.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(2, 2, 2))
      for (const source of room.sources) {
        source.bounds.makeEmpty()
        for (const { mesh, slot } of source.members) source.bounds.union(meshBounds(mesh, slot))
      }
      const windows = room.sources.filter(source => source.kind === 'window' && !source.bounds.isEmpty())
      const warm = room.sources.filter(source => source.kind !== 'window' && !source.bounds.isEmpty()).sort((a, b) => Number(b.kind === 'heat') - Number(a.kind === 'heat'))
      const chosen = [...windows.slice(0, 2), ...warm].slice(0, 4)
      if (chosen.length < 4) chosen.push(...windows.slice(2, 6 - chosen.length))
      for (const light of room.lights.splice(chosen.length)) light.dispose()
      const center = room.bounds.getCenter(new THREE.Vector3()), size = room.bounds.getSize(new THREE.Vector3())
      const span = Math.max(size.x, size.z, 1)
      for (let i = 0; i < chosen.length; i++) {
        const source = chosen[i]
        const light = room.lights[i] || new THREE.PointLight('#ffffff', 0, 1, 2)
        room.lights[i] = light
        source.bounds.getCenter(light.position)
        if (source.kind === 'window') {
          const inward = center.clone().sub(light.position).setY(0)
          if (inward.lengthSq() > 0) light.position.addScaledVector(inward.normalize(), Math.min(0.65, span * 0.06))
        } else light.position.y += 0.12
        // Local bounded pools are deliberately unshadowed, not simulated GI.
        light.position.clamp(room.bounds.min, room.bounds.max)
        light.name = `Viewer_Room_${room.id}_${source.name}`
        light.castShadow = false
        light.distance = THREE.MathUtils.clamp(span * (source.kind === 'window' ? 0.7 : 0.48), 2, 10)
        const scale = THREE.MathUtils.clamp(span / 10, 0.35, 1.3)
        light.userData = { kind: source.kind, source: source.name,
          dayIntensity: (source.kind === 'window' ? 3 : source.kind === 'heat' ? 2 : 0.7) * scale,
          nightIntensity: (source.kind === 'window' ? 1.1 : source.kind === 'heat' ? 12 : 10) * scale }
        scene.add(light)
      }
      sun.shadow.normalBias = 0.008
    } else {
      sun.target.position.copy(exteriorTarget)
      sun.target.updateMatrixWorld(true)
      Object.assign(sun.shadow.camera, exteriorShadow)
      sun.shadow.camera.updateProjectionMatrix()
      sun.shadow.normalBias = exteriorNormalBias
    }
    // Use authored room meshes, not NPC cards, aspect or camera.zoom. The host
    // can forward this stable reference to cinematic.setSceneScale().
    const roomSize = activeInterior?.bounds.getSize(new THREE.Vector3())
    const dofSceneScale = roomSize ? Math.max(0.0001, (Math.hypot(roomSize.x, roomSize.z) + roomSize.y) / Math.SQRT2 * 1.30 / 40) : 1
    Object.assign(api.metrics.environment, { interior: activeInterior?.id ?? null, dofSceneScale, roomLightCount: activeInterior?.lights.length ?? 0, roomLights: [],
      roomLightSourceCount: activeInterior?.sources.length ?? 0, windowViewCount: activeInterior?.windowViews.length ?? 0,
      roomBounds: activeInterior ? { min: activeInterior.bounds.min.toArray(), max: activeInterior.bounds.max.toArray() } : null })
    refreshAtmosphere()
    updateLight(true)
    return true
  }

  function releaseInterior(root) {
    const room = interiors.get(root)
    if (!room) return false
    if (room === activeInterior) setInterior(null)
    for (const light of room.lights) { light.removeFromParent(); light.dispose() }
    restoreAssignments(room.assignments)
    for (const material of room.materials) {
      baseMaterials.delete(material)
      patchedMaterials.delete(material)
      material.dispose()
    }
    for (const { view, geometry, material } of room.windowResources) {
      view.removeFromParent()
      geometry.dispose()
      patchedMaterials.delete(material)
      material.dispose()
    }
    interiors.delete(root)
    updateMaterialMetrics()
    return true
  }

  function applyMaterial(material, track = true) {
    if (disposed || !material?.isMaterial) return false
    if (!material.userData.viewerWindowView && !material.isMeshStandardMaterial) return false
    if (!patchedMaterials.has(material)) patchedMaterials.set(material, {
      compile: material.onBeforeCompile, key: material.customProgramCacheKey(), keyFunction: material.customProgramCacheKey,
      userData: new Map(['viewerHaze', 'viewerSeasonRole'].map(key => [key, Object.getOwnPropertyDescriptor(material.userData, key)])),
    })
    const previous = patchedMaterials.get(material)
    if (material.userData.viewerWindowView) {
      applyWindowViewMaterial(material, uniforms)
      previous.installedCompile = material.onBeforeCompile
      previous.installedKey = material.customProgramCacheKey
      return true
    }
    // Shipped v03 names have Blender duplicate suffixes such as .003.
    const role = material.userData.viewerInterior ? material.userData.viewerInteriorRole : roles[material.name.replace(/\.\d{3}$/, '')] || (Object.hasOwn(roleIds, material.userData.seasonRole) ? material.userData.seasonRole : null)
    material.userData.viewerHaze = true
    material.userData.viewerSeasonRole = role || 'unclassified'
    if (track && !material.userData.viewerInterior) baseMaterials.add(material)
    const skyBackdrop = Boolean(material.userData.viewerMountainLayer && !material.userData.viewerInterior)
    material.customProgramCacheKey = () => `${environmentProgramKey}|sky=${skyBackdrop}|outdoor=${!!material.userData.viewerOutdoor}|water=${!!material.userData.viewerWater}|${previous.key}`
    material.onBeforeCompile = (shader, webglRenderer) => {
      previous.compile.call(material, shader, webglRenderer)
      Object.assign(shader.uniforms, uniforms)
      shader.uniforms.dioramaMountainLayer = { value: material.userData.viewerMountainLayer || 0 }
      shader.uniforms.dioramaRole = { value: role == null ? -1 : roleIds[role] }
      shader.uniforms.dioramaSnowEligible = { value: (!material.userData.viewerInterior || material.userData.viewerOutdoor) && material.userData.snowEligible !== false && role && !['glow', 'gold'].includes(role) && !material.transparent && material.opacity >= 1 ? 1 : 0 }
      shader.uniforms.dioramaIndoor = { value: material.userData.viewerInterior ? 1 : 0 }
      shader.uniforms.dioramaVegetationMask = { value: material.userData.viewerVegetationMask || 0 }
      shader.uniforms.dioramaWindowLight = { value: material.userData.viewerWindowLight || 0 }
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDioramaWorld;\nvarying vec3 vDioramaNormal;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vDioramaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vDioramaNormal = inverseTransformDirection(transformedNormal, viewMatrix);
        `)
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vDioramaWorld, vDioramaNormal;
        uniform float dioramaHazeStrength, dioramaMountainLayer, dioramaCloudHeight, dioramaCloudTime, dioramaHazeScale;
        uniform float dioramaSeason, dioramaRole, dioramaSnowEligible, dioramaNight, dioramaVolumetric;
        uniform float dioramaIndoor, dioramaVegetationMask, dioramaWindowLight, dioramaRoomLightStrength;
        ${material.userData.viewerWater ? 'uniform float dioramaSkyTime;' : ''}
        uniform vec3 dioramaRoomTint;
        uniform vec3 dioramaHazeColor, dioramaViewDirection, dioramaCloudColor, dioramaCloudShade, dioramaSkyColor, dioramaHorizonColor;
        uniform vec4 dioramaViewport;
        uniform float dioramaCameraNear;
        uniform vec3 dioramaSunDirection, dioramaMoonDirection;
        uniform float dioramaCameraAzimuth, dioramaSkyAnalytic;
        ${noise}
        ${skyGradientFragment}
        ${skyBackdrop ? `uniform float dioramaSkyEffects, dioramaSkyTime, dioramaDayPhase, dioramaSkyBlend, dioramaSkyZoom;\n${skyFragment}\n${skyRevealFragment}` : ''}
      `).replace('#include <color_fragment>', `#include <color_fragment>
        // Seasonal pigment is linear albedo, before PBR lighting. Never edit GLB colors.
        ${material.userData.viewerWater ? 'diffuseColor.rgb *= 0.96 + 0.055 * sin(vDioramaWorld.x * 9.0 + vDioramaWorld.z * 7.0 + vDioramaWorld.y * 14.0 + dioramaSkyTime * 2.3);' : ''}
        if (dioramaRole >= 1.0 && dioramaRole <= 3.0 && dioramaSeason > 0.5) {
          float pigment = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.045, 0.8);
          vec3 leaf = dioramaRole > 1.5 && dioramaRole < 2.5 ? vec3(0.13, 0.31, 0.055) : vec3(0.08, 0.25, 0.038);
          if (dioramaSeason > 1.5) leaf = dioramaRole < 2.5 ? vec3(0.56, 0.19, 0.025) : vec3(0.53, 0.35, 0.065);
          if (dioramaSeason > 2.5) leaf = vec3(0.12, 0.19, 0.16);
          float vegetation = 1.0;
          if (dioramaIndoor > 0.5 && dioramaVegetationMask > 0.5) {
            vec3 signalColor = diffuseColor.rgb;
            #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
              if (dioramaVegetationMask > 1.5) signalColor = vColor.rgb;
            #endif
            vegetation = smoothstep(0.025, 0.10, signalColor.g - max(signalColor.r, signalColor.b) * 1.13) * smoothstep(0.06, 0.22, signalColor.g);
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, leaf * (0.5 + pigment * 1.5), vegetation);
        }
        if (dioramaSeason > 2.5 && dioramaSnowEligible > 0.5) {
          vec3 surfaceNormal = normalize(vDioramaNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          float facingUp = smoothstep(0.48, 0.88, surfaceNormal.y);
          float dust = mix(0.48, 0.78, dioramaNoise(vDioramaWorld.xz * 0.8));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.86, 0.89), facingUp * dust);
        }
      `).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (dioramaRole == 4.0) {
          if (dioramaIndoor > 0.5) {
            vec3 warmth = vec3(1.0, 0.57, 0.24);
            totalEmissiveRadiance *= mix(mix(1.0, 2.8, dioramaNight), 1.0 - dioramaNight, dioramaWindowLight) * mix(vec3(1.0), warmth, dioramaNight * 0.65);
            totalEmissiveRadiance *= dioramaRoomLightStrength;
            totalEmissiveRadiance *= mix(vec3(1.0), dioramaRoomTint, dioramaWindowLight * 0.3);
          } else {
            totalEmissiveRadiance *= mix(1.0, 3.5, dioramaNight);
            totalEmissiveRadiance *= mix(vec3(1.0), vec3(1.0, 0.48, 0.15), dioramaNight);
          }
        }
      `).replace('#include <fog_fragment>', `#include <fog_fragment>
        if (dioramaHazeStrength > 0.001 && dioramaIndoor < 0.5) {
        vec2 cloudFlow = vec2(dioramaCloudTime * 0.025, -dioramaCloudTime * 0.012);
        float billow = dioramaNoise(vDioramaWorld.xz * 0.095 + cloudFlow);
        float hazeCeiling = dioramaCloudHeight + (billow - 0.5) * 3.0;
        float groundHaze = 0.995 * (1.0 - smoothstep(hazeCeiling - 8.0, hazeCeiling + 1.6, vDioramaWorld.y));
        groundHaze *= 1.0 - dioramaVolumetric; // volume raymarch owns the sea bed in that mode
        float mountainHaze = 0.42 * smoothstep(24.0, 56.0, length(vDioramaWorld.xz));
        mountainHaze = max(mountainHaze, dioramaMountainLayer * (
          0.45 * smoothstep(19.0, 44.0, length(vDioramaWorld.xz))
          + 0.12 * smoothstep(18.0, 38.0, vDioramaWorld.y)));
        // Airlight fades with daylight. Do not inject display-sRGB into the
        // cinematic linear HDR buffer (which used to make unlit rocks glow).
        mountainHaze *= mix(1.0, 0.12, dioramaNight);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(dioramaHazeColor, 1.0)).rgb, mountainHaze * dioramaHazeScale * dioramaHazeStrength);
        if (groundHaze * dioramaHazeStrength > 0.001) {
          // Match the background on this orthographic ray, including its horizon fade.
          vec3 cloudPoint = vDioramaWorld + dioramaViewDirection * ((dioramaCloudHeight - vDioramaWorld.y) / min(dioramaViewDirection.y, -0.001));
          float seaDistance = dot(cloudPoint - cameraPosition, dioramaViewDirection) - dioramaCameraNear;
          float seaVisible = (1.0 - smoothstep(85.0, 260.0, seaDistance)) * step(0.0, seaDistance) * step(dioramaViewDirection.y, -0.001);
          float screenY = (gl_FragCoord.y - dioramaViewport.y) / dioramaViewport.w;
          seaVisible *= 1.0 - smoothstep(0.56, 0.76, screenY);
          vec3 skyColor = dioramaSkyGradient(vec2((gl_FragCoord.x - dioramaViewport.x) / dioramaViewport.z, screenY));
          vec3 cloudColor = mix(skyColor, dioramaSea(cloudPoint.xz, dioramaCloudTime, dioramaCloudShade, dioramaCloudColor), seaVisible);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(cloudColor, 1.0)).rgb, groundHaze * dioramaHazeStrength);
        }
        }
        ${skyBackdrop ? /* glsl */`
          // Only tagged far scenery dissolves. Its original opaque depth stays
          // intact for picking, AO, shadows and foreground occlusion.
          vec2 skyUV = (gl_FragCoord.xy - dioramaViewport.xy) / dioramaViewport.zw;
          float reveal = dioramaSkyReveal(skyUV, vDioramaWorld) * dioramaSkyBlend;
          if (reveal > 0.001) {
            vec3 backdrop = dioramaSkyBackdrop(skyUV);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(backdrop, 1.0)).rgb, reveal);
          }
        ` : ''}
      `)
    }
    previous.installedCompile = material.onBeforeCompile
    previous.installedKey = material.customProgramCacheKey
    material.needsUpdate = true
    if (track) updateMaterialMetrics()
    return true
  }

  function advance(seconds) {
    if (disposed || !Number.isFinite(seconds) || seconds < 0) return false
    state.clockSeconds += seconds
    if (state.cloudMotion && !state.reducedMotion) state.cloudSeconds += seconds * state.cloudSpeed
    uniforms.dioramaCloudTime.value = state.cloudSeconds
    if (!state.reducedMotion) uniforms.dioramaSkyTime.value = state.clockSeconds
    return true
  }

  function bindModel(model) {
    if (disposed || !model?.isObject3D) return false
    if (boundModels.has(model)) return true
    boundModels.add(model)
    model.updateWorldMatrix(true, true)
    // The original two unshadowed lantern pools, with idempotent binding.
    for (const id of ['gate', 'council']) {
      const root = model.getObjectByName(id)
      if (!root) continue
      const bounds = new THREE.Box3()
      root.traverse(mesh => {
        if (mesh.isMesh && [].concat(mesh.material).some(m => m?.userData.viewerSeasonRole === 'glow')) bounds.expandByObject(mesh)
      })
      if (bounds.isEmpty()) continue
      const light = new THREE.PointLight('#ffb15e', 0, id === 'gate' ? 10 : 8, 2)
      bounds.getCenter(light.position)
      light.position.y += 0.15
      light.name = `Viewer_${id}_LanternPool`
      light.userData.nightIntensity = id === 'gate' ? 38 : 28
      scene.add(light)
      lanternLights.push(light)
    }
    api.metrics.environment.localLights = lanternLights.length
    updateLight()
    return true
  }

  function collect(model) {
    if (disposed || !model?.isObject3D || interiors.has(model)) return false
    if (exteriors.has(model)) return true
    const record = { assignments: [], materials: new Set() }
    const variants = new Map()
    exteriors.set(model, record)
    model.traverse(mesh => {
      if (!mesh.isMesh) return
      let mountain = false
      for (let node = mesh; node; node = node.parent) {
        if (!node.userData.interactionId) continue
        mountain = node.userData.interactionId === 'environment'
        break
      }
      const original = mesh.material
      const replacements = [].concat(original).map(material => {
        if (!material?.isMeshStandardMaterial) return material
        if (!variants.has(material)) variants.set(material, new Map())
        const profiles = variants.get(material)
        if (!profiles.has(mountain)) {
          const clone = material.clone()
          // Clone all shader-bearing materials, not the shared source assets.
          const previous = patchedMaterials.get(material)
          clone.onBeforeCompile = previous?.compile ?? material.onBeforeCompile
          clone.customProgramCacheKey = previous ? () => previous.key : material.customProgramCacheKey
          if (mountain) clone.userData.viewerMountainLayer = 1
          record.materials.add(clone)
          applyMaterial(clone)
          profiles.set(mountain, clone)
        }
        return profiles.get(mountain)
      })
      record.assignments.push({ mesh, original, replacements, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow })
      mesh.material = Array.isArray(original) ? replacements : replacements[0]
      mesh.castShadow = mesh.receiveShadow = true
    })
    bindModel(model)
    updateMaterialMetrics()
    return true
  }

  function restoreAssignments(assignments) {
    for (const { mesh, original, replacements, castShadow, receiveShadow } of assignments) {
      // A host-owned selection material must not be replaced behind its back.
      if (Array.isArray(mesh.material)) {
        if (mesh.material.length === replacements.length && mesh.material.every((material, i) => material === replacements[i])) mesh.material = original
        else mesh.material = mesh.material.map((material, i) => material === replacements[i] ? [].concat(original)[i] : material)
      } else if (mesh.material === replacements[0]) mesh.material = original
      if (castShadow !== undefined) mesh.castShadow = castShadow
      if (receiveShadow !== undefined) mesh.receiveShadow = receiveShadow
    }
  }

  const setters = {
    setTimeOfDay(hours) {
      if (!Number.isFinite(hours)) return false
      state.timeOfDay = ((hours % 24) + 24) % 24
      updateLight(true)
      return true
    },
    setSeason(season) {
      if (!seasons.includes(season)) return false
      state.season = season
      uniforms.dioramaSeason.value = seasons.indexOf(season)
      updateLight()
      return true
    },
    setSkyEffects(enabled) {
      state.skyEffects = Boolean(enabled)
      uniforms.dioramaSkyEffects.value = state.skyEffects ? 1 : 0
      uniforms.dioramaSkyAnalytic.value = state.skyEffects && state.skyAnalytic ? 1 : 0
      api.metrics.environment.sky.enabled = state.skyEffects
      api.metrics.environment.sky.analytic = uniforms.dioramaSkyAnalytic.value > 0.5
      return true
    },
    setSkyAnalytic(enabled) {
      state.skyAnalytic = Boolean(enabled)
      uniforms.dioramaSkyAnalytic.value = state.skyEffects && state.skyAnalytic ? 1 : 0
      api.metrics.environment.sky.analytic = uniforms.dioramaSkyAnalytic.value > 0.5
      return true
    },
    setSkyBlend(enabled) {
      state.skyBlend = Boolean(enabled)
      uniforms.dioramaSkyBlend.value = state.skyBlend ? 1 : 0
      api.metrics.environment.sky.blend = state.skyBlend
      return true
    },
    setRoomLightStrength(strength) {
      if (!Number.isFinite(strength)) return false
      state.roomLightStrength = THREE.MathUtils.clamp(strength, 0, 2)
      uniforms.dioramaRoomLightStrength.value = state.roomLightStrength
      api.metrics.environment.roomLightStrength = state.roomLightStrength
      updateRoomLights()
      return true
    },
    setCloudHeight(height) {
      if (!Number.isFinite(height)) return false
      state.cloudHeight = THREE.MathUtils.clamp(height, -8, 12)
      uniforms.dioramaCloudHeight.value = state.cloudHeight
      if (typeof onCloudHeight === 'function') onCloudHeight(state.cloudHeight)
      return true
    },
    // Compatibility only: enabling an independent preview clock is forbidden.
    setAutoTime(enabled) { return !Boolean(enabled) },
    setCloudMotion(enabled) {
      state.cloudMotion = Boolean(enabled)
      if (typeof onCloudMotion === 'function') onCloudMotion(state.cloudMotion && !state.reducedMotion && !state.paused)
      return true
    },
    setCloudSpeed(speed) {
      if (!Number.isFinite(speed)) return false
      state.cloudSpeed = THREE.MathUtils.clamp(speed, 0, 3)
      if (typeof onCloudSpeed === 'function') onCloudSpeed(state.cloudSpeed)
      return true
    },
    setPaused(paused) {
      state.paused = Boolean(paused)
      if (typeof onCloudMotion === 'function') onCloudMotion(state.cloudMotion && !state.reducedMotion && !state.paused)
      return true
    },
    setReducedMotion(value) {
      state.reducedMotion = Boolean(value)
      if (typeof onCloudMotion === 'function') onCloudMotion(state.cloudMotion && !state.reducedMotion && !state.paused)
      return true
    },
    setClock(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return false
      state.clockSeconds = state.cloudSeconds = seconds
      uniforms.dioramaCloudTime.value = seconds
      uniforms.dioramaSkyTime.value = seconds
      lastShadow = -Infinity
      return true
    },
    advanceEnvironment: advance,
  }
  setters.setTime = setters.setTimeOfDay
  const controls = Object.fromEntries(Object.entries(setters).map(([key, method]) => [key, (...args) => disposed ? false : method(...args)]))
  const exports = { atmosphere: uniforms, ...controls }
  const apiDescriptors = new Map(Object.keys(exports).concat('environment').map(key => [key, Object.getOwnPropertyDescriptor(api, key)]))
  const snapshot = () => Object.freeze({ ...state, disposed })
  Object.defineProperty(api, 'environment', { configurable: true, enumerable: true, get: snapshot })
  Object.assign(api, exports)

  function dispose() {
    if (disposed) return
    // Stop all future mutations before releasing resources. Do not fire host callbacks.
    disposed = true
    activeInterior = null
    for (const root of [...interiors.keys()]) releaseInterior(root)
    for (const record of exteriors.values()) {
      restoreAssignments(record.assignments)
      for (const material of record.materials) {
        baseMaterials.delete(material)
        patchedMaterials.delete(material)
        material.dispose()
      }
    }
    exteriors.clear()
    // applyMaterial may also have been used for borrowed/highlight materials.
    // Undo only hooks still installed by this environment; never dispose them.
    for (const [material, previous] of patchedMaterials) {
      if (material.onBeforeCompile === previous.installedCompile) material.onBeforeCompile = previous.compile
      if (material.customProgramCacheKey === previous.installedKey) material.customProgramCacheKey = previous.keyFunction
      for (const [key, descriptor] of previous.userData) {
        if (descriptor) Object.defineProperty(material.userData, key, descriptor)
        else delete material.userData[key]
      }
      material.needsUpdate = true
    }
    patchedMaterials.clear()
    baseMaterials.clear()
    for (const light of lanternLights.splice(0)) { light.removeFromParent(); light.dispose() }
    boundModels.clear()
    sky.removeFromParent()
    sky.onBeforeRender = () => {}
    sky.geometry.dispose()
    skyMaterial.dispose()
    scene.fog = originalFog
    if (originalFogColor) originalFog.color.copy(originalFogColor)
    sun.target.position.copy(exteriorTarget)
    sun.target.updateMatrixWorld(true)
    Object.assign(sun.shadow.camera, exteriorShadow)
    sun.shadow.camera.updateProjectionMatrix()
    sun.shadow.normalBias = exteriorNormalBias
    for (const { light, color, groundColor, intensity, position } of originalLights) {
      light.color.copy(color)
      if (groundColor) light.groundColor.copy(groundColor)
      light.intensity = intensity
      light.position.copy(position)
    }
    renderer.toneMappingExposure = originalExposure
    renderer.shadowMap.needsUpdate = true
    Object.assign(api.metrics.environment, { disposed: true, backgroundDraws: 0, interior: null, preparedInteriors: 0,
      roomLightCount: 0, roomLights: [], localLights: 0, activeLocalLights: 0, windowViewCount: 0, exteriorMaterials: 0, interiorMaterials: 0, taggedMaterials: {} })
    for (const [key, descriptor] of apiDescriptors) {
      const stillOwned = key === 'environment' ? Object.getOwnPropertyDescriptor(api, key)?.get === snapshot : api[key] === exports[key]
      if (!stillOwned) continue
      if (descriptor) Object.defineProperty(api, key, descriptor)
      else delete api[key]
    }
  }

  try {
    refreshAtmosphere()
    updateLight(true)
  } catch (error) {
    dispose()
    throw error
  }
  return {
    ...controls, uniforms, applyMaterial, updateLight, prepareInterior, setInterior, releaseInterior, refreshAtmosphere,
    collect, bindModel, dispose, getState: snapshot,
    tick: delta => !disposed && !state.paused && !state.reducedMotion ? advance(Math.min(delta, 0.1)) : false,
  }
}
