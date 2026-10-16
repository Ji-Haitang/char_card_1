import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as THREE from '../../scene3d/node_modules/three/build/three.module.js'
import { EffectComposer } from '../../scene3d/node_modules/three/examples/jsm/postprocessing/EffectComposer.js'
import { createCinematic } from '../../scene3d/src/cinematic.js'
import { createEnvironment } from '../../scene3d/src/environment.js'
import { RENDER_DEFAULTS, DEFAULT_MSAA, DEFAULT_PAPER_COLOR, NIGHT_PAPER_COLOR, SUBSCENE_TILT_SHIFT, calculateDofRanges } from '../../scene3d/src/render-defaults.js'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
function cinematicFixture(options = {}, maxSamples = 4) {
  const passes = [], camera = new THREE.OrthographicCamera(-20, 20, 20, -20, .1, 420)
  const renderer = {
    capabilities: { maxSamples },
    getPixelRatio: () => 1.25,
    getSize: target => target.set(801, 603),
    setSize() {},
  }
  const original = EffectComposer.prototype.addPass
  EffectComposer.prototype.addPass = function (pass) { passes.push(pass); return original.call(this, pass) }
  let cinematic
  try { cinematic = createCinematic(renderer, new THREE.Scene(), camera, options) }
  finally { EffectComposer.prototype.addPass = original }
  return { cinematic, camera, passes }
}
function environmentFixture(options = {}) {
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-20, 20, 20, -20, .1, 420)
  const sun = new THREE.DirectionalLight(), fill = new THREE.HemisphereLight(), ambient = new THREE.AmbientLight()
  const renderer = { toneMappingExposure: 1.08, shadowMap: { enabled: false, needsUpdate: false } }
  const api = { metrics: { atmosphere: options.atmosphere ?? false } }
  scene.add(sun, sun.target, fill, ambient)
  const environment = createEnvironment({ scene, camera, sun, fill, ambient, renderer, api, ...options })
  return { scene, camera, sun, renderer, api, environment }
}

test('shared visual defaults match Pro without changing quality ownership', () => {
  assert.deepEqual(RENDER_DEFAULTS, { tiltShift: 2, dofSharp: 4.5, dofBlur: 1.5, bloom: 1, shaftStrength: .85, saturation: 1.4, contrast: 1.4, gamma: .88, warmth: .38, vignette: .85, hazeStrength: .6 })
  assert.ok(Object.isFrozen(RENDER_DEFAULTS))
  assert.equal(DEFAULT_MSAA, 2)
  assert.equal(DEFAULT_PAPER_COLOR, '#f6f0e0')
  assert.equal(NIGHT_PAPER_COLOR, '#101c32')
  assert.equal(SUBSCENE_TILT_SHIFT, 1.5)
})

test('DOF uses geometry scale and square-root zoom exactly once', () => {
  assert.deepEqual(calculateDofRanges(4.5, 1, 1), { sharpRange: 4.5, falloff: 22 })
  assert.deepEqual(calculateDofRanges(4.5, 4, .25), { sharpRange: .5625, falloff: 2.75 })
  near(calculateDofRanges(4.5, 0, .25).sharpRange, 4.5 * .25 / Math.sqrt(.1))
  for (const scale of [0, -1, Infinity, NaN]) assert.throws(() => calculateDofRanges(4.5, 1, scale), TypeError)
})

test('cinematic defaults use beauty-only 2x MSAA and half-resolution linear AO', () => {
  const { cinematic, passes } = cinematicFixture()
  try {
    const stats = cinematic.getStats(), beauty = passes[0]
    assert.equal(stats.samples, 2)
    assert.equal(beauty.target.samples, 2)
    assert.equal(beauty.aoTarget.samples, 0)
    assert.deepEqual([stats.width, stats.height], [1001, 753])
    assert.deepEqual([stats.aoWidth, stats.aoHeight], [500, 376])
    assert.equal(beauty.aoTarget.texture.minFilter, THREE.LinearFilter)
    assert.equal(beauty.aoTarget.texture.magFilter, THREE.LinearFilter)
    for (const material of [beauty.aoMaterial, beauty.aoBlendMaterial]) {
      near(material.uniforms.texel.value.x, 1 / 500)
      near(material.uniforms.texel.value.y, 1 / 376)
    }
    assert.deepEqual(stats.tuning, { tiltShift: 2, dofSharp: 4.5, dofBlur: 1.5, bloom: 1, saturation: 1.4, contrast: 1.4, gamma: .88, warmth: .38, vignette: .85 })
    cinematic.resize(1, 1)
    assert.deepEqual([cinematic.getStats().aoWidth, cinematic.getStats().aoHeight], [1, 1])
  } finally { cinematic.dispose() }
  for (const [requested, capability, expected] of [[4, 4, 4], [4, 1, 1], [0, 4, 2]]) {
    const { cinematic: c } = cinematicFixture({ msaa: requested }, capability)
    try { assert.equal(c.getStats().samples, expected) } finally { c.dispose() }
  }
})

test('scene DOF/tilt switching preserves blur pixels and restores main scale', () => {
  const { cinematic, camera, passes } = cinematicFixture()
  try {
    const initialBlur = cinematic.getStats().maxBlur
    assert.equal(cinematic.set('interior', 1), true)
    assert.equal(cinematic.getStats().tuning.tiltShift, 1.5)
    camera.zoom = 1.55
    assert.equal(cinematic.setSceneScale(.25), true)
    near(cinematic.getStats().sharpRange, 4.5 * .25 / Math.sqrt(1.55))
    near(cinematic.getStats().falloff, 22 * .25 / Math.sqrt(1.55))
    assert.equal(cinematic.getStats().maxBlur, initialBlur)
    for (const invalid of [0, -1, NaN, Infinity]) assert.equal(cinematic.setSceneScale(invalid), false)
    assert.equal(cinematic.set('dofSharp', -1), false)
    cinematic.set('interior', 0)
    assert.equal(cinematic.getStats().dofSceneScale, 1)
    assert.equal(cinematic.getStats().tuning.tiltShift, 2)
    const dof = passes.find(pass => pass.material?.name === 'Cinematic.DepthOfField')
    assert.match(dof.material.fragmentShader, /max\(abs\(coc\(tapDepth\)\), tiltBlur\(uv\)\)/)
  } finally { cinematic.dispose() }
  assert.equal(cinematic.setSceneScale(.5), false)
  assert.equal(cinematic.setPaperColor('#000000'), false)
})

test('paper uses far depth plus opaque coverage and shared vignette outside bloom/grade, accepts linear colors', () => {
  const { cinematic, passes } = cinematicFixture()
  try {
    const output = passes.at(-1), grade = passes.find(pass => pass.material?.name === 'Cinematic.FilmGrade')
    assert.equal(output.uniforms.paperVignette, grade.uniforms.gradeVignette)
    assert.equal(output.uniforms.tCoverage.value, passes[0].target.texture)
    assert.equal(output.uniforms.tDepth.value, passes[0].target.depthTexture)
    assert.match(output.material.fragmentShader, /texture2D\(tDepth, vUv\)\.r >= 0\.999999 && texture2D\(tCoverage, vUv\)\.a >= 0\.999999/)
    assert.match(output.material.fragmentShader, /paperColor \* vignetteFactor\(vUv, paperVignette\)/)
    assert.equal(cinematic.getStats().paperColor, DEFAULT_PAPER_COLOR)
    const color = new THREE.Color(NIGHT_PAPER_COLOR)
    assert.equal(cinematic.setPaperColor(color), true)
    assert.equal(cinematic.getStats().paperColor, NIGHT_PAPER_COLOR)
    assert.notEqual(output.uniforms.paperColor.value, color)
    assert.deepEqual(output.uniforms.paperColor.value.toArray(), color.toArray())
    assert.equal(cinematic.setPaperColor(NaN), false)
    assert.equal(cinematic.setPaperColor(''), false)
  } finally { cinematic.dispose() }
})

test('plain environment defaults sky effects on (stars/analytic) with blend off and host-driven day/night paper without postFX', () => {
  const received = [], fixture = environmentFixture({ onPaperColor: color => received.push(color) })
  const { environment: env, renderer, api } = fixture
  try {
    assert.equal(env.getState().skyEffects, true)
    assert.equal(env.getState().skyBlend, false)
    assert.equal(env.getState().skyAnalytic, true)
    assert.equal(env.uniforms.dioramaSkyEffects.value, 1)
    assert.equal(env.uniforms.dioramaSkyBlend.value, 0)
    assert.equal(env.uniforms.dioramaSkyAnalytic.value, 1)
    assert.deepEqual([api.metrics.environment.sky.enabled, api.metrics.environment.sky.blend, api.metrics.environment.sky.analytic], [true, false, true])
    assert.equal(env.uniforms.dioramaHazeScale.value, .6)
    env.setTime(12)
    assert.equal(api.metrics.environment.paperColor, DEFAULT_PAPER_COLOR)
    env.setTime(0)
    assert.equal(api.metrics.environment.paperColor, NIGHT_PAPER_COLOR)
    assert.equal(received.at(-1).getHexString(), '101c32')
    received.at(-1).set('#ffffff')
    assert.equal(env.uniforms.dioramaPaperColor.value.getHexString(), '101c32')
    assert.equal(env.setAutoTime(true), false)
    env.tick(.1)
    assert.equal(env.getState().timeOfDay, 0)
    assert.equal(renderer.shadowMap.enabled, false)
    assert.equal(api.metrics.environment.effectiveAtmosphere, false)
  } finally { env.dispose() }
  const count = received.length
  assert.equal(env.setTime(12), false)
  assert.equal(received.length, count)
})

test('room metrics derive DOF scale from authored bounds; sub atmosphere stays off and main restores', () => {
  const { environment: env, api, camera } = environmentFixture({ atmosphere: true, volumeClouds: true })
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(8, 4, 6), material = new THREE.MeshStandardMaterial()
  root.add(new THREE.Mesh(geometry, material))
  try {
    assert.equal(env.prepareInterior(root, 'training'), true)
    // NPC geometry added after preparation must not affect the reference bounds.
    const npc = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial())
    root.add(npc)
    env.setInterior(root, 'training')
    const expected = (10 + 4) / Math.SQRT2 * 1.30 / 40
    near(api.metrics.environment.dofSceneScale, expected)
    assert.equal(api.metrics.environment.effectiveAtmosphere, false)
    assert.equal(api.metrics.environment.subsceneHaze, false)
    assert.equal(api.metrics.environment.subsceneShafts, false)
    assert.equal(env.uniforms.dioramaPaperBackground.value, 1)
    assert.equal(env.uniforms.dioramaVolumetric.value, 0)
    camera.zoom = 5
    env.setInterior(root, 'training')
    near(api.metrics.environment.dofSceneScale, expected)
    env.setInterior(null)
    assert.equal(api.metrics.environment.dofSceneScale, 1)
    assert.equal(api.metrics.environment.effectiveAtmosphere, true)
    assert.equal(env.uniforms.dioramaPaperBackground.value, 0)
    npc.geometry.dispose(); npc.material.dispose(); npc.removeFromParent()
  } finally { env.dispose(); geometry.dispose(); material.dispose() }
})

test('paper palette respects host override and instances never share mutable state', () => {
  const a = environmentFixture({ paperColor: '#abcdef' }), b = environmentFixture()
  try {
    a.environment.setTime(12); b.environment.setTime(0)
    assert.equal(a.api.metrics.environment.paperColor, '#abcdef')
    assert.equal(b.api.metrics.environment.paperColor, NIGHT_PAPER_COLOR)
    a.environment.setSkyEffects(false)
    assert.equal(b.environment.getState().skyEffects, true)
  } finally { a.environment.dispose(); b.environment.dispose() }
})

test('rendering modules do not introduce viewer DOM/storage dependencies', async () => {
  for (const name of ['render-defaults.js', 'environment.js', 'cinematic.js']) {
    const source = await readFile(new URL(`../../scene3d/src/${name}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\b(?:document|localStorage|sessionStorage)\s*\./)
  }
})
