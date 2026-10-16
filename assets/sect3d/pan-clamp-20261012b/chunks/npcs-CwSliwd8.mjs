import { Color, DataTexture, Group, LinearFilter, Matrix3, Matrix4, Mesh, MeshBasicMaterial, NearestFilter, Object3D, PlaneGeometry, Quaternion, Raycaster, SRGBColorSpace, Texture, Vector2, Vector3, Vector4 } from "./three.module-DEUH6-St.mjs";
//#region scene3d/src/npc-spawn.js
function seededRandom(seed) {
	seed = seed >>> 0;
	return () => {
		let t = seed += 1831565813;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function layoutSeed(key) {
	let hash = 2166136261;
	for (const char of String(key)) {
		hash ^= char.codePointAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
function findNpcFloor(root) {
	let floor = null;
	root?.traverse((node) => {
		if (!floor && node.isMesh && node.name === "floor" && node.userData.npcSpawn && node.geometry?.attributes.position) floor = node;
	});
	return floor;
}
/** Area-weighted barycentric sampling of the authored safe, upward floor faces. */
function createFloorSampler(floor) {
	if (!floor?.isMesh || floor.name !== "floor" || !floor.userData.npcSpawn || !floor.geometry?.attributes.position) throw new Error("NPC_FLOOR_MISSING");
	floor.updateWorldMatrix(true, false);
	const { position } = floor.geometry.attributes, index = floor.geometry.index;
	const triangles = [], cross = new Vector3(), edge = new Vector3();
	let area = 0;
	for (let i = 0; i + 2 < (index?.count ?? position.count); i += 3) {
		const vertices = [
			0,
			1,
			2
		].map((j) => new Vector3().fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(floor.matrixWorld));
		if (!vertices.every((v) => [
			v.x,
			v.y,
			v.z
		].every(Number.isFinite))) continue;
		cross.subVectors(vertices[1], vertices[0]).cross(edge.subVectors(vertices[2], vertices[0]));
		const weight = cross.length() / 2;
		if (weight < 1e-10 || cross.y / (2 * weight) < .5) continue;
		area += weight;
		triangles.push({
			vertices,
			cumulative: area
		});
	}
	if (!Number.isFinite(area) || !area) throw new Error("NPC_FLOOR_NO_STANDABLE_TRIANGLES");
	return {
		area,
		sample(random) {
			if (typeof random !== "function") throw new TypeError("NPC sampling requires an explicit private random source");
			const target = random() * area;
			let lo = 0, hi = triangles.length - 1;
			while (lo < hi) {
				const mid = lo + hi >> 1;
				if (triangles[mid].cumulative < target) lo = mid + 1;
				else hi = mid;
			}
			const [a, b, c] = triangles[lo].vertices, u = Math.sqrt(random()), v = random();
			return a.clone().multiplyScalar(1 - u).addScaledVector(b, u * (1 - v)).addScaledVector(c, u * v);
		}
	};
}
function cardSize(npc, camera, height = npc.height) {
	if (!Number.isFinite(height) || height <= 0) throw new TypeError("NPC height must be positive");
	const bounds = npc.bounds;
	if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw new TypeError("NPC bounds must be nonempty");
	const up = new Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new Quaternion()));
	const screenHeight = height * Math.max(.25, Math.abs(up.y));
	return {
		width: screenHeight * (bounds[2] - bounds[0]) / (bounds[3] - bounds[1]),
		height,
		screenHeight
	};
}
function minimumSeparation(a, b, camera) {
	return Math.max(1.8, (cardSize(a, camera).width + cardSize(b, camera).width) / 2 + .6);
}
function cardsOverlap(a, pa, b, pb, camera) {
	const sa = cardSize(a, camera), sb = cardSize(b, camera);
	const va = pa.clone().applyMatrix4(camera.matrixWorldInverse), vb = pb.clone().applyMatrix4(camera.matrixWorldInverse);
	return Math.abs(va.x - vb.x) < (sa.width + sb.width) / 2 + .15 && Math.min(va.y + sa.screenHeight, vb.y + sb.screenHeight) > Math.max(va.y, vb.y) - .15;
}
function placeDenseNpcs(sampler, npcs, camera, random, attempts, trials) {
	const candidates = Array.from({ length: trials }, () => {
		const point = sampler.sample(random), view = point.clone().applyMatrix4(camera.matrixWorldInverse);
		return {
			point,
			x: view.x,
			y: view.y
		};
	});
	const sizes = npcs.map((npc) => cardSize(npc, camera));
	const order = npcs.map((_, i) => i).sort((a, b) => sizes[b].width * sizes[b].screenHeight - sizes[a].width * sizes[a].screenHeight || a - b);
	const sweeps = Array.from({ length: attempts }, (_, i) => {
		const slope = attempts > 1 ? (i / (attempts - 1) - .5) * 2 : 0;
		return candidates.slice().sort((a, b) => a.y + slope * a.x - (b.y + slope * b.x));
	});
	function pack(scale) {
		for (const sweep of sweeps) {
			const placed = [];
			for (const i of order) {
				const size = sizes[i];
				const candidate = sweep.find((point) => placed.every((other) => {
					const peer = sizes[other.i], separation = Math.max(1.8, (size.width + peer.width) / 2 + .6) * scale;
					if (Math.hypot(point.point.x - other.point.point.x, point.point.z - other.point.point.z) < separation) return false;
					return Math.abs(point.x - other.point.x) >= (size.width + peer.width) * scale / 2 + .15 || Math.min(point.y + size.screenHeight * scale, other.point.y + peer.screenHeight * scale) <= Math.max(point.y, other.point.y) - .15;
				}));
				if (!candidate) break;
				placed.push({
					i,
					point: candidate
				});
			}
			if (placed.length === npcs.length) return placed.sort((a, b) => a.i - b.i).map(({ i, point }) => ({
				npc: npcs[i],
				point: point.point,
				scale
			}));
		}
		return null;
	}
	const full = pack(1);
	if (full) return full;
	let low = 0, high = 1, best = null;
	for (let step = 0; step < 10; step++) {
		const scale = (low + high) / 2, result = pack(scale);
		if (result) {
			low = scale;
			best = result;
		} else high = scale;
	}
	if (best) return best;
	throw new Error("NPC_FLOOR_CROWDED");
}
function placeNpcs(floor, npcs, camera, random, { attempts = 40, trials = 600 } = {}) {
	if (typeof random !== "function") throw new TypeError("NPC placement requires an explicit private random source");
	if (!Array.isArray(npcs) || npcs.length > 15) throw new TypeError("NPC placement only accepts the host roster (at most fifteen)");
	if (!npcs.length) return [];
	attempts = Math.max(1, Math.min(40, Math.floor(attempts) || 1));
	trials = Math.max(1, Math.min(600, Math.floor(trials) || 1));
	const sampler = createFloorSampler(floor);
	camera.updateMatrixWorld(true);
	if (npcs.length > 3) return placeDenseNpcs(sampler, npcs, camera, random, attempts, trials);
	for (let attempt = 0; attempt < attempts; attempt++) {
		const placed = [];
		for (let i = 0; i < npcs.length; i++) {
			const npc = npcs[i];
			for (let trial = 0; trial < trials; trial++) {
				const point = sampler.sample(random);
				if (placed.every((other) => Math.hypot(point.x - other.point.x, point.z - other.point.z) >= minimumSeparation(npc, other.npc, camera) && !cardsOverlap(npc, point, other.npc, other.point, camera))) {
					placed.push({
						npc,
						point
					});
					break;
				}
			}
			if (placed.length < i + 1) break;
		}
		if (placed.length === npcs.length) return placed;
	}
	throw new Error("NPC_FLOOR_CROWDED");
}
//#endregion
//#region scene3d/src/npc-sizing.js
var DEFAULT_NPC_SCENE_SCALE = 1.5;
var valid = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
function npcHeight(value, authored = 1.5) {
	return valid(value, .5, 3) ? value : valid(authored, .5, 3) ? authored : 1.5;
}
/** A supplied height is an effective world-space override, not an authored base.
* Defaults come from the imported CSV-derived atlas manifest, never a second roster.
* Apply the scene multiplier AFTER base validation: 2.20m * 1.5 is valid 3.30m.
*/
function npcEffectiveHeight(value, authored, sceneScale = DEFAULT_NPC_SCENE_SCALE) {
	if (Number.isFinite(value) && value > 0 && value < 10) return value;
	return npcHeight(void 0, authored) * (valid(sceneScale, .5, 3) ? sceneScale : DEFAULT_NPC_SCENE_SCALE);
}
//#endregion
//#region scene3d/src/npc-contact-shadows.js
var NPC_SHADOW_LIFT = .002;
function createNpcContactShadows({ parent, floor }) {
	if (!parent?.isObject3D || !floor?.isMesh || !floor.geometry?.attributes.position) throw new TypeError("NPC contact shadows require a parent and floor mesh");
	const geometry = new PlaneGeometry(1, 1);
	const resolution = 64, pixels = new Uint8Array(resolution * resolution * 4);
	for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
		const radius = Math.hypot((x + .5) / resolution * 2 - 1, (y + .5) / resolution * 2 - 1);
		const falloff = Math.max(0, 1 - radius * radius);
		pixels[(y * resolution + x) * 4 + 3] = Math.round(255 * falloff * falloff);
	}
	const texture = new DataTexture(pixels, resolution, resolution);
	texture.minFilter = texture.magFilter = LinearFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	const material = new MeshBasicMaterial({
		map: texture,
		transparent: true,
		opacity: .44,
		depthTest: true,
		depthWrite: false,
		alphaTest: .001,
		toneMapped: false,
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -1
	});
	material.name = "NPC_Soft_Contact_Shadow";
	const entries = /* @__PURE__ */ new Map(), ray = new Raycaster();
	const foot = new Vector3(), axisX = new Vector3(), axisY = new Vector3();
	const center = new Vector3(), size = new Vector3(), rotation = new Quaternion();
	const normalMatrix = new Matrix3(), basis = new Matrix4(), inverse = new Matrix4();
	const floorMatrix = new Matrix4(), down = new Vector3(0, -1, 0);
	let disposed = false, enabled = true, raycasts = 0;
	let floorGeometry, floorPosition, floorIndex, positionVersion, indexVersion;
	function add(card) {
		if (disposed || entries.has(card)) return false;
		if (!card?.isMesh || typeof card.userData.gameNpcId !== "string") throw new TypeError("NPC contact shadow requires gameNpcId");
		const mesh = new Mesh(geometry, material);
		mesh.name = `NPC_ContactShadow_${card.userData.gameNpcId}`;
		mesh.userData.npcContactShadow = true;
		mesh.raycast = () => {};
		mesh.matrixAutoUpdate = false;
		mesh.castShadow = mesh.receiveShadow = false;
		mesh.visible = false;
		parent.add(mesh);
		entries.set(card, {
			mesh,
			foot: new Vector3(Infinity, Infinity, Infinity),
			support: null,
			width: 0,
			depth: 0
		});
		return true;
	}
	function update(value = enabled) {
		if (disposed) return;
		enabled = Boolean(value);
		parent.updateWorldMatrix(true, true);
		floor.updateWorldMatrix(true, false);
		const position = floor.geometry?.attributes.position, index = floor.geometry?.index;
		const floorChanged = !floorMatrix.equals(floor.matrixWorld) || floorGeometry !== floor.geometry || floorPosition !== position || floorIndex !== index || positionVersion !== position?.version || indexVersion !== index?.version;
		floorMatrix.copy(floor.matrixWorld);
		floorGeometry = floor.geometry;
		floorPosition = position;
		floorIndex = index;
		positionVersion = position?.version;
		indexVersion = index?.version;
		normalMatrix.getNormalMatrix(floor.matrixWorld);
		inverse.copy(parent.matrixWorld).invert();
		for (const [card, entry] of entries) {
			const { mesh } = entry;
			foot.setFromMatrixPosition(card.matrixWorld);
			if (floorChanged || !entry.foot.equals(foot)) {
				entry.foot.copy(foot);
				ray.set(center.copy(foot).addScaledVector(Object3D.DEFAULT_UP, .06), down);
				ray.near = 0;
				ray.far = .14;
				raycasts++;
				const hit = position && ray.intersectObject(floor, false).find((hit) => hit.face && hit.face.normal.clone().applyMatrix3(normalMatrix).normalize().y > .5);
				entry.support = hit ? {
					point: hit.point.clone(),
					normal: hit.face.normal.clone().applyMatrix3(normalMatrix).normalize()
				} : null;
			}
			mesh.visible = enabled && card.visible && card.material.visible && !!entry.support;
			if (!entry.support) continue;
			const { point, normal } = entry.support;
			axisX.setFromMatrixColumn(card.matrixWorld, 0);
			const width = axisX.length(), height = axisY.setFromMatrixColumn(card.matrixWorld, 1).length();
			entry.width = Math.max(width * .68, height * .26);
			entry.depth = height * .23;
			axisX.addScaledVector(normal, -axisX.dot(normal)).normalize();
			axisY.crossVectors(normal, axisX).normalize();
			basis.makeBasis(axisX, axisY, normal);
			rotation.setFromRotationMatrix(basis);
			center.copy(point).addScaledVector(normal, NPC_SHADOW_LIFT);
			size.set(entry.width, entry.depth, 1);
			mesh.matrix.compose(center, rotation, size).premultiply(inverse);
			mesh.matrixWorldNeedsUpdate = true;
		}
		parent.updateWorldMatrix(true, true);
	}
	function snapshot() {
		const residents = Object.freeze([...entries].map(([card, entry]) => {
			let visible = entry.mesh.visible;
			for (let node = entry.mesh.parent; node; node = node.parent) visible &&= node.visible;
			return Object.freeze({
				gameNpcId: card.userData.gameNpcId,
				visible,
				supported: !!entry.support,
				foot: Object.freeze(entry.foot.toArray()),
				position: Object.freeze(new Vector3().setFromMatrixPosition(entry.mesh.matrixWorld).toArray()),
				normal: entry.support ? Object.freeze(entry.support.normal.toArray()) : null,
				width: entry.width,
				depth: entry.depth
			});
		}));
		return Object.freeze({
			raycasts,
			residents
		});
	}
	function dispose() {
		if (disposed) return;
		disposed = true;
		for (const { mesh } of entries.values()) mesh.removeFromParent();
		entries.clear();
		geometry.dispose();
		material.dispose();
		texture.dispose();
		texture.image = null;
		floorGeometry = floorPosition = floorIndex = null;
	}
	return {
		add,
		update,
		snapshot,
		dispose
	};
}
//#endregion
//#region scene3d/src/npc-outline.js
var NPC_OUTLINE_COLOR = "#dba23c";
var NPC_OUTLINE_WIDTH = 1.5;
function npcOutlineCssWidth(projectedHeight = 180, viewportWidth = 1280, viewportHeight = 900) {
	const screen = Math.max(0, Math.min(1, (Math.max(0, Math.min(viewportWidth, viewportHeight)) - 320) / 580));
	const portrait = Math.max(0, Math.min(1, (projectedHeight - 40) / 140));
	return .6 + .9 * Math.min(screen, portrait);
}
function installNpcOutline(material) {
	let cssWidth = NPC_OUTLINE_WIDTH, pixelRatio = 1;
	const uniforms = {
		npcOutlineSelected: { value: 0 },
		npcOutlineColor: { value: new Color(NPC_OUTLINE_COLOR) },
		npcOutlineWidth: { value: NPC_OUTLINE_WIDTH },
		npcOutlineFrame: { value: new Vector4(0, 0, 1, 1) }
	};
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.fragmentShader = shader.fragmentShader.replace("#include <map_pars_fragment>", `
#include <map_pars_fragment>
uniform float npcOutlineSelected;
uniform vec3 npcOutlineColor;
uniform float npcOutlineWidth;
uniform vec4 npcOutlineFrame;
#ifdef USE_MAP
float npcOutlineAlpha(vec2 uv) {
  // An adjacent atlas cell (or ClampToEdge at a tightly cropped portrait)
  // must never be mistaken for part of this frame's silhouette.
  if (any(lessThan(uv, npcOutlineFrame.xy)) || any(greaterThan(uv, npcOutlineFrame.zw))) return 0.0;
  return texture2D(map, uv).a;
}
#endif
`).replace("#include <map_fragment>", `
#include <map_fragment>
#ifdef USE_MAP
if (npcOutlineSelected > 0.5) {
  // Derivatives keep the adaptive CSS contour consistent across zoom, DPR,
  // downsampled low quality, resizing, and differently sized atlas frames.
  vec2 dx = dFdx(vMapUv) * npcOutlineWidth;
  vec2 dy = dFdy(vMapUv) * npcOutlineWidth;
  float inside = npcOutlineAlpha(vMapUv + dx);
  inside = min(inside, npcOutlineAlpha(vMapUv - dx));
  inside = min(inside, npcOutlineAlpha(vMapUv + dy));
  inside = min(inside, npcOutlineAlpha(vMapUv - dy));
  inside = min(inside, npcOutlineAlpha(vMapUv + (dx + dy) * 0.70710678));
  inside = min(inside, npcOutlineAlpha(vMapUv + (dx - dy) * 0.70710678));
  inside = min(inside, npcOutlineAlpha(vMapUv + (-dx + dy) * 0.70710678));
  inside = min(inside, npcOutlineAlpha(vMapUv - (dx + dy) * 0.70710678));
  diffuseColor.rgb = mix(diffuseColor.rgb, npcOutlineColor, 1.0 - step(0.35, inside));
  // Keep original alpha and the standard alphaTest/depth behavior unchanged.
}
#endif
`);
	};
	material.customProgramCacheKey = () => "npc-alpha-contour-v1";
	return {
		setSelected(value) {
			uniforms.npcOutlineSelected.value = value ? 1 : 0;
		},
		setPixelRatio(value) {
			pixelRatio = Number.isFinite(value) && value > 0 ? value : 1;
			uniforms.npcOutlineWidth.value = cssWidth * pixelRatio;
		},
		setViewport(projectedHeight, width, height) {
			cssWidth = npcOutlineCssWidth(projectedHeight, width, height);
			uniforms.npcOutlineWidth.value = cssWidth * pixelRatio;
		},
		getStats() {
			return {
				cssWidth,
				bufferWidth: uniforms.npcOutlineWidth.value,
				pixelRatio
			};
		},
		setFrame({ x, y, width, height, sheet }) {
			uniforms.npcOutlineFrame.value.set(x / sheet.width, 1 - (y + height) / sheet.height, (x + width) / sheet.width, 1 - y / sheet.height);
		}
	};
}
//#endregion
//#region scene3d/src/npcs.js
var NPC_ANIMATED_IDS = Object.freeze({
	A: "pozhenzi",
	B: "dongting",
	C: "qiantang",
	D: "xiaobaihu",
	E: "jisi",
	F: "shiyannian",
	G: "huyanxian",
	H: "yuzhu",
	I: "anmu",
	J: "tangmuli",
	K: "luoqianyou",
	L: "shenmizayi",
	M: "xuantianqing",
	N: "luchunruo",
	O: "lingxuefei"
});
var ANIMATED = NPC_ANIMATED_IDS;
var ALPHA = 90;
var abortError = () => Object.assign(/* @__PURE__ */ new Error("NPC load cancelled"), { name: "AbortError" });
var fail = (code) => Object.assign(new Error(code), { code });
var check = (signal) => {
	if (signal.aborted) throw signal.reason || abortError();
};
/** Reject cancellation promptly; a non-cancellable decode must release late output. */
function abortable(work, signal, disposeLate = () => {}) {
	return new Promise((resolve, reject) => {
		let done = false;
		const cancel = () => {
			if (!done) {
				done = true;
				reject(signal.reason || abortError());
			}
		};
		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) cancel();
		Promise.resolve(work).then((value) => {
			signal.removeEventListener("abort", cancel);
			if (done || signal.aborted) {
				disposeLate(value);
				cancel();
				return;
			}
			done = true;
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", cancel);
			if (!done) {
				done = true;
				reject(error);
			}
		});
	});
}
function disposeImage(image) {
	if (!image || image.released) return;
	image.released = true;
	image.dispose?.();
	image.image?.close?.();
	image.alpha = null;
	image.image = null;
}
function disposeAsset(asset) {
	if (!asset || asset.disposed) return;
	asset.disposed = true;
	for (const sheet of asset.sheets) {
		sheet.texture.dispose();
		sheet.texture.image = null;
		disposeImage(sheet.image);
	}
	asset.sheets.length = 0;
}
/** Downsampled alpha bounds in original image coordinates, upper bounds exclusive. */
function alphaBounds(alpha, width, height, imageWidth = width, imageHeight = height) {
	if (!(alpha instanceof Uint8Array || alpha instanceof Uint8ClampedArray) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || alpha.length !== width * height) throw fail("NPC_ALPHA_INVALID");
	let left = width, top = height, right = -1, bottom = -1;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		if (alpha[y * width + x] < ALPHA) continue;
		left = Math.min(left, x);
		right = Math.max(right, x);
		top = Math.min(top, y);
		bottom = Math.max(bottom, y);
	}
	if (right < left) throw fail("NPC_IMAGE_EMPTY");
	return [
		Math.floor(left / width * imageWidth),
		Math.floor(top / height * imageHeight),
		Math.ceil((right + 1) / width * imageWidth),
		Math.ceil((bottom + 1) / height * imageHeight)
	];
}
function frameAt(visual, elapsedMs) {
	if (visual.kind !== "animated") return 0;
	let phase = Math.max(0, elapsedMs) % visual.durationMs, frame = 0;
	while (frame < visual.delays.length - 1 && phase >= visual.delays[frame]) phase -= visual.delays[frame++];
	return frame;
}
function copySnapshot(input = {}) {
	const rendered = input.renderedNpcs ?? [];
	if (!Array.isArray(rendered) || rendered.length > 15) throw fail("NPC_SUBSET_INVALID");
	const residents = new Map((input.residents ?? []).map((npc) => [npc.gameNpcId, npc.displayName]));
	const ids = /* @__PURE__ */ new Set();
	const npcs = rendered.map((npc) => {
		if (!/^[A-O]$/.test(npc.gameNpcId) || ids.has(npc.gameNpcId) || input.residents && !residents.has(npc.gameNpcId)) throw fail("NPC_SUBSET_INVALID");
		ids.add(npc.gameNpcId);
		return {
			gameNpcId: npc.gameNpcId,
			displayName: String(npc.displayName || residents.get(npc.gameNpcId) || npc.gameNpcId),
			visualKind: String(npc.visualKind || (ANIMATED[npc.gameNpcId] ? "animated" : "static")),
			visualKey: String(npc.visualKey || ""),
			portraitUrl: String(npc.portraitUrl || ""),
			heightMeters: npc.heightMeters
		};
	});
	return {
		sessionEpoch: input.sessionEpoch ?? 0,
		revision: input.revision ?? 0,
		sceneId: input.sceneId ?? null,
		layoutKey: String(input.layoutKey ?? `${input.sessionEpoch ?? 0}:${input.sceneId}:${npcs.map((n) => n.gameNpcId).join(",")}`),
		environment: { hour: Number.isFinite(input.environment?.hour) ? input.environment.hour : 12 },
		npcs,
		visible: input.visible !== false,
		interactive: input.interactive !== false,
		renderEnabled: input.renderEnabled !== false,
		blockReasons: [...input.blockReasons || []]
	};
}
function signature(snapshot) {
	return JSON.stringify([
		snapshot.sessionEpoch,
		snapshot.sceneId,
		snapshot.layoutKey,
		snapshot.npcs.map((n) => [
			n.gameNpcId,
			n.visualKind,
			n.visualKey,
			n.portraitUrl
		])
	]);
}
function imageUrl(value, base, manifestAsset = false) {
	const url = new URL(value, base);
	if (![
		"http:",
		"https:",
		"data:",
		"blob:",
		"capacitor:"
	].includes(url.protocol)) throw fail("NPC_IMAGE_URL_INVALID");
	if (manifestAsset && (!url.href.startsWith(base.href) || url.origin !== base.origin || !/^npc\/generated\/[a-z0-9_-]+\.png$/i.test(value))) throw fail("NPC_ATLAS_PATH_INVALID");
	if (url.protocol === "data:" && !/^data:image\/(png|jpeg|webp|gif);/i.test(value)) throw fail("NPC_IMAGE_URL_INVALID");
	return url.href;
}
function validateAnimated(entry, id) {
	if (!entry || entry.id !== id || !Array.isArray(entry.sheets) || !entry.sheets.length || entry.sheets.length > 32) throw fail("NPC_MANIFEST_INVALID");
	for (const key of [
		"width",
		"heightPixels",
		"cellWidth",
		"cellHeight",
		"columns",
		"frameCount"
	]) if (!Number.isSafeInteger(entry[key]) || entry[key] <= 0) throw fail("NPC_MANIFEST_INVALID");
	if (!Number.isFinite(entry.height) || entry.height < .5 || entry.height > 3) throw fail("NPC_MANIFEST_INVALID");
	if (entry.anchor !== void 0 && (!Array.isArray(entry.anchor) || entry.anchor.length !== 2 || entry.anchor[0] !== .5 || entry.anchor[1] !== 0)) throw fail("NPC_MANIFEST_INVALID");
	if (entry.frameCount > 2048 || !Number.isSafeInteger(entry.padding) || entry.padding < 0 || entry.width + entry.padding * 2 > entry.cellWidth || entry.heightPixels + entry.padding * 2 > entry.cellHeight) throw fail("NPC_MANIFEST_INVALID");
	if (!Array.isArray(entry.bounds) || entry.bounds.length !== 4 || !entry.bounds.every(Number.isFinite) || entry.bounds[2] <= entry.bounds[0] || entry.bounds[3] <= entry.bounds[1]) throw fail("NPC_MANIFEST_INVALID");
	if (!Array.isArray(entry.delays) || entry.delays.length !== entry.frameCount || !entry.delays.every((d) => Number.isFinite(d) && d > 0 && d <= 6e4)) throw fail("NPC_MANIFEST_INVALID");
	let count = 0;
	const sheets = entry.sheets.map((sheet) => {
		if (![
			sheet.first,
			sheet.count,
			sheet.width,
			sheet.height
		].every(Number.isSafeInteger) || sheet.first !== count || sheet.count < 1 || sheet.width < 1 || sheet.height < 1 || entry.columns * entry.cellWidth > sheet.width || Math.ceil(sheet.count / entry.columns) * entry.cellHeight > sheet.height) throw fail("NPC_MANIFEST_INVALID");
		count += sheet.count;
		return {
			file: String(sheet.file),
			first: sheet.first,
			count: sheet.count,
			width: sheet.width,
			height: sheet.height
		};
	});
	if (count !== entry.frameCount) throw fail("NPC_MANIFEST_INVALID");
	return {
		kind: "animated",
		id,
		height: npcHeight(entry.height),
		bounds: [...entry.bounds],
		width: entry.width,
		heightPixels: entry.heightPixels,
		cellWidth: entry.cellWidth,
		cellHeight: entry.cellHeight,
		columns: entry.columns,
		padding: entry.padding,
		frameCount: entry.frameCount,
		delays: [...entry.delays],
		durationMs: entry.delays.reduce((a, b) => a + b, 0),
		sheets
	};
}
/** Browser adapter uses only the injected container/canvas ownerDocument at load time. */
function browserImageLoader(context, fetcher) {
	return async (url, { signal, maxTextureSize, maxPixels }) => {
		const doc = context.container?.ownerDocument || context.renderer.domElement?.ownerDocument;
		const win = doc?.defaultView;
		if (!doc) throw fail("NPC_IMAGE_DECODER_UNAVAILABLE");
		const response = await fetcher(url, { signal });
		if (!response.ok) throw fail("NPC_IMAGE_HTTP");
		const blob = await response.blob();
		check(signal);
		let bitmap, image, objectUrl, canvas;
		try {
			if (win?.createImageBitmap) {
				bitmap = await win.createImageBitmap(blob);
				image = bitmap;
			} else {
				objectUrl = URL.createObjectURL(blob);
				image = doc.createElement("img");
				await new Promise((resolve, reject) => {
					const cancelled = () => {
						image.onload = image.onerror = null;
						image.src = "";
						reject(signal.reason || abortError());
					};
					image.onload = () => {
						signal.removeEventListener("abort", cancelled);
						resolve();
					};
					image.onerror = () => {
						signal.removeEventListener("abort", cancelled);
						reject(fail("NPC_IMAGE_DECODE"));
					};
					signal.addEventListener("abort", cancelled, { once: true });
					if (signal.aborted) cancelled();
					else image.src = objectUrl;
				});
			}
			check(signal);
			const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
			if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > maxTextureSize || height > maxTextureSize || width * height > maxPixels) throw fail("NPC_IMAGE_TOO_LARGE");
			canvas = doc.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const full = canvas.getContext("2d");
			if (!full) throw fail("NPC_CANVAS_UNAVAILABLE");
			full.drawImage(image, 0, 0);
			const scale = Math.min(1, 512 / Math.max(width, height));
			const mask = doc.createElement("canvas");
			mask.width = Math.max(1, Math.ceil(width * scale));
			mask.height = Math.max(1, Math.ceil(height * scale));
			let alpha;
			try {
				const ctx = mask.getContext("2d", { willReadFrequently: true });
				if (!ctx) throw fail("NPC_CANVAS_UNAVAILABLE");
				ctx.drawImage(canvas, 0, 0, mask.width, mask.height);
				const rgba = ctx.getImageData(0, 0, mask.width, mask.height).data;
				alpha = new Uint8Array(mask.width * mask.height);
				for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
				const alphaWidth = mask.width, alphaHeight = mask.height;
				alphaBounds(alpha, alphaWidth, alphaHeight);
				const ownedCanvas = canvas;
				return {
					image: canvas,
					width,
					height,
					alpha,
					alphaWidth,
					alphaHeight,
					dispose() {
						ownedCanvas.width = ownedCanvas.height = 0;
					}
				};
			} finally {
				mask.width = mask.height = 0;
			}
		} catch (error) {
			if (canvas) canvas.width = canvas.height = 0;
			throw error;
		} finally {
			bitmap?.close?.();
			if (image && !bitmap) {
				image.onload = image.onerror = null;
				image.src = "";
			}
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		}
	};
}
/**
* Instance-local NPC layer. bind/update promises always settle to a status.
* pick ONLY returns {gameNpcId, anchor}; it never emits. Local fallback buttons
* call emitNpcIntent({gameNpcId, anchor}); runtime owns epoch/revision and locks.
* Presentation option: npcShadows (boolean, default true), independent of sun/quality.
* setNpcShadows changes only this instance and never reads/writes storage.
* Missing heightMeters uses CSV-derived manifest.height * DEFAULT_NPC_SCENE_SCALE;
* an explicit valid heightMeters overrides that authored world-space height.
* Crowded >3 rosters may apply one uniform placementScale only after full-size
* packing fails. Base heights remain authored; diagnostics expose effective sizes.
* Test seams: fetch, loadImage(url,{signal,maxTextureSize,maxPixels}), placement.
* A custom loadImage returns owned {image,width,height,alpha,alphaWidth,alphaHeight,dispose?}.
*/
function createNpcController(context) {
	const { scene, camera, renderer, container } = context;
	if (!scene?.isScene || !camera?.isCamera || !renderer) throw new TypeError("NPC controller requires scene, camera and renderer");
	const base = new URL(context.assetBaseUrl);
	if (!base.pathname.endsWith("/")) base.pathname += "/";
	const doc = container?.ownerDocument || renderer.domElement?.ownerDocument;
	const fetcher = context.fetch || ((...args) => globalThis.fetch(...args));
	const loadImage = context.loadImage || browserImageLoader(context, fetcher);
	const maxTextureSize = Math.min(renderer.capabilities?.maxTextureSize || 2048, context.maxTextureSize || 2048);
	const maxPixels = Math.min(context.maxPixels || 4194304, 16777216);
	const timeoutMs = Number.isFinite(context.timeoutMs) && context.timeoutMs > 0 ? context.timeoutMs : 2e4;
	const cache = /* @__PURE__ */ new Map(), leases = /* @__PURE__ */ new Set(), pendingControllers = /* @__PURE__ */ new Set();
	const raycaster = new Raycaster(), pointer = new Vector2();
	const counters = {
		loads: 0,
		texturesCreated: 0,
		texturesDisposed: 0,
		imagesDisposed: 0,
		shadowGroupsCreated: 0,
		shadowGroupsDisposed: 0
	};
	let shadowsEnabled = context.npcShadows !== false, contactShadows = null;
	let disposed = false, generation = 0, root = null, sceneId = null, snapshot = null, key = null;
	let group = null, cards = [], fallbacks = [], fallbackNode = null, buttons = [], elapsed = 0, lastUse = 0;
	let task = Promise.resolve({ status: "applied" }), manifestPromise = null, manifestController = null;
	let currentKeys = /* @__PURE__ */ new Set(), selectedNpcId = null;
	function releaseAsset(asset) {
		if (!asset || asset.disposed) return;
		counters.texturesDisposed += asset.sheets.length;
		counters.imagesDisposed += asset.sheets.length;
		disposeAsset(asset);
	}
	function evict(entry) {
		if (cache.get(entry.key) !== entry || entry.refs > 0) return;
		cache.delete(entry.key);
		entry.controller.abort(abortError());
		releaseAsset(entry.asset);
		entry.asset = null;
	}
	function trim(keep = null) {
		for (const entry of [...cache.values()]) if (!entry.refs && keep && !keep.has(entry.key)) evict(entry);
		while (cache.size > 18) {
			const victim = [...cache.values()].filter((entry) => !entry.refs).sort((a, b) => a.used - b.used)[0];
			if (!victim) throw fail("NPC_CACHE_PIN_LIMIT");
			evict(victim);
		}
	}
	async function manifest(signal) {
		if (!manifestPromise) {
			const controller = new AbortController();
			manifestController = controller;
			pendingControllers.add(controller);
			const timer = setTimeout(() => controller.abort(fail("NPC_MANIFEST_TIMEOUT")), timeoutMs);
			manifestPromise = abortable((async () => {
				const response = await fetcher(new URL("npc/generated/manifest.json", base).href, { signal: controller.signal });
				if (!response.ok) throw fail("NPC_MANIFEST_HTTP");
				const value = await response.json();
				check(controller.signal);
				if (value.version !== 1 || !Array.isArray(value.npcs)) throw fail("NPC_MANIFEST_INVALID");
				return value;
			})(), controller.signal).catch((error) => {
				manifestPromise = null;
				throw error;
			}).finally(() => {
				clearTimeout(timer);
				pendingControllers.delete(controller);
				if (manifestController === controller) manifestController = null;
			});
		}
		return abortable(manifestPromise, signal);
	}
	function assetKey(npc) {
		if (ANIMATED[npc.gameNpcId] && ["animated", "atlas"].includes(npc.visualKind)) return `animated:${ANIMATED[npc.gameNpcId]}`;
		return `static:${npc.visualKey || npc.gameNpcId}:${npc.portraitUrl}`;
	}
	async function loadAsset(npc, signal) {
		const asset = {
			sheets: [],
			visual: null,
			disposed: false
		};
		try {
			if (ANIMATED[npc.gameNpcId] && ["animated", "atlas"].includes(npc.visualKind)) asset.visual = validateAnimated((await manifest(signal)).npcs.find((item) => item.id === ANIMATED[npc.gameNpcId]), ANIMATED[npc.gameNpcId]);
			else {
				if (!npc.portraitUrl) throw fail("NPC_PORTRAIT_MISSING");
				asset.visual = {
					kind: "static",
					height: 1.5,
					imageUrl: imageUrl(npc.portraitUrl, base),
					frameCount: 1
				};
			}
			const sources = asset.visual.kind === "animated" ? asset.visual.sheets : [{
				file: asset.visual.imageUrl,
				first: 0,
				count: 1
			}];
			for (const source of sources) {
				check(signal);
				const url = asset.visual.kind === "animated" ? imageUrl(source.file, base, true) : source.file;
				const image = await abortable(Promise.resolve().then(() => loadImage(url, {
					signal,
					maxTextureSize,
					maxPixels
				})), signal, disposeImage);
				let texture;
				try {
					check(signal);
					const { width, height, alpha, alphaWidth, alphaHeight } = image;
					if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= maxTextureSize) || width * height > maxPixels || !image.image) throw fail("NPC_IMAGE_TOO_LARGE");
					const bounds = alphaBounds(alpha, alphaWidth, alphaHeight, width, height);
					if (asset.visual.kind === "animated" && (source.width !== width || source.height !== height)) throw fail("NPC_ATLAS_DIMENSIONS");
					if (asset.visual.kind === "static") Object.assign(asset.visual, {
						width,
						heightPixels: height,
						bounds
					});
					texture = new Texture(image.image);
					texture.colorSpace = SRGBColorSpace;
					texture.magFilter = asset.visual.kind === "animated" ? NearestFilter : LinearFilter;
					texture.minFilter = LinearFilter;
					texture.generateMipmaps = false;
					texture.needsUpdate = true;
					counters.texturesCreated++;
					asset.sheets.push({
						...source,
						width,
						height,
						texture,
						image
					});
				} catch (error) {
					texture?.dispose();
					disposeImage(image);
					throw error;
				}
			}
			return asset;
		} catch (error) {
			releaseAsset(asset);
			throw error;
		}
	}
	function acquire(npc) {
		const id = assetKey(npc);
		let entry = cache.get(id);
		if (!entry) {
			const controller = new AbortController();
			entry = {
				key: id,
				refs: 0,
				used: ++lastUse,
				controller,
				asset: null,
				settled: false,
				promise: null
			};
			cache.set(id, entry);
			pendingControllers.add(controller);
			counters.loads++;
			const timer = setTimeout(() => controller.abort(fail("NPC_IMAGE_TIMEOUT")), timeoutMs);
			entry.promise = abortable(loadAsset(npc, controller.signal), controller.signal, releaseAsset).then((asset) => {
				if (disposed || cache.get(id) !== entry || controller.signal.aborted) {
					releaseAsset(asset);
					throw abortError();
				}
				entry.asset = asset;
				entry.settled = true;
				return asset;
			}).catch((error) => {
				entry.settled = true;
				if (cache.get(id) === entry) cache.delete(id);
				throw error;
			}).finally(() => {
				clearTimeout(timer);
				pendingControllers.delete(controller);
			});
		}
		entry.refs++;
		entry.used = ++lastUse;
		const lease = {
			entry,
			promise: entry.promise,
			released: false,
			release() {
				if (lease.released) return;
				lease.released = true;
				leases.delete(lease);
				entry.refs--;
				entry.used = ++lastUse;
				if (!entry.refs && !entry.settled) evict(entry);
				trim();
			}
		};
		leases.add(lease);
		trim();
		return lease;
	}
	function clearFallback() {
		for (const { button, click } of buttons) button.removeEventListener("click", click);
		buttons = [];
		fallbackNode?.remove();
		fallbackNode = null;
	}
	function clearCurrent() {
		if (contactShadows) {
			contactShadows.dispose();
			contactShadows = null;
			counters.shadowGroupsDisposed++;
		}
		group?.removeFromParent();
		for (const card of cards) {
			card.geometry.dispose();
			card.material.dispose();
		}
		cards = [];
		group = null;
		fallbacks = [];
		selectedNpcId = null;
		clearFallback();
		for (const lease of [...leases]) lease.release();
	}
	function inputAllowed() {
		return !disposed && root && snapshot?.visible && snapshot.interactive && snapshot.renderEnabled && !snapshot.blockReasons.length && (!context.isInteractionEnabled || context.isInteractionEnabled());
	}
	function syncFallback() {
		for (const { button, id } of buttons) {
			const npc = snapshot?.npcs.find((n) => n.gameNpcId === id);
			button.disabled = !npc || !inputAllowed();
			if (npc) button.textContent = `${npc.displayName} · 人物信息`;
		}
		if (fallbackNode) fallbackNode.hidden = !snapshot?.visible || !root;
	}
	function showFallback(token) {
		if (!fallbacks.length || !container?.appendChild || !doc) return;
		fallbackNode = doc.createElement("div");
		fallbackNode.className = "scene3d-npc-fallback";
		fallbackNode.setAttribute("aria-label", "当前显示人物（立绘暂不可用）");
		Object.assign(fallbackNode.style, {
			position: "absolute",
			left: "8px",
			bottom: "48px",
			display: "flex",
			flexWrap: "wrap",
			gap: "6px",
			pointerEvents: "auto",
			maxWidth: "calc(100% - 16px)"
		});
		for (const item of fallbacks) {
			const button = doc.createElement("button");
			button.type = "button";
			button.className = "scene3d-npc-fallback-button";
			button.dataset.gameNpcId = item.gameNpcId;
			button.title = "立绘暂不可用，仍可查看本角色信息";
			const click = (event) => {
				event.stopPropagation?.();
				if (token !== generation || !inputAllowed() || !snapshot.npcs.some((n) => n.gameNpcId === item.gameNpcId)) return;
				const rect = button.getBoundingClientRect();
				if (!rect.width || !rect.height) return;
				context.emitNpcIntent?.({
					gameNpcId: item.gameNpcId,
					anchor: {
						space: "client-css-px",
						left: rect.left,
						top: rect.top,
						width: rect.width,
						height: rect.height
					}
				});
			};
			button.addEventListener("click", click);
			buttons.push({
				button,
				click,
				id: item.gameNpcId
			});
			fallbackNode.appendChild(button);
		}
		container.appendChild(fallbackNode);
		syncFallback();
	}
	function setFrame(card, frame) {
		if (card.userData.frame === frame) return;
		const { asset } = card.userData, visual = asset.visual;
		const sheet = asset.sheets.find((s) => frame >= s.first && frame < s.first + s.count);
		if (!sheet) return;
		let x, y, width, height;
		if (visual.kind === "animated") {
			const cell = frame - sheet.first;
			x = cell % visual.columns * visual.cellWidth + visual.padding;
			y = Math.floor(cell / visual.columns) * visual.cellHeight + visual.padding;
			width = visual.width;
			height = visual.heightPixels;
		} else {
			x = visual.bounds[0];
			y = visual.bounds[1];
			width = visual.bounds[2] - x;
			height = visual.bounds[3] - y;
		}
		const uv = card.geometry.attributes.uv;
		uv.setXY(0, x / sheet.width, 1 - y / sheet.height);
		uv.setXY(1, (x + width) / sheet.width, 1 - y / sheet.height);
		uv.setXY(2, x / sheet.width, 1 - (y + height) / sheet.height);
		uv.setXY(3, (x + width) / sheet.width, 1 - (y + height) / sheet.height);
		uv.needsUpdate = true;
		card.material.map = sheet.texture;
		card.userData.frame = frame;
		card.userData.frameRect = {
			x,
			y,
			width,
			height,
			sheet
		};
		card.userData.outline.setFrame(card.userData.frameRect);
	}
	function alphaHit(card, uv) {
		const { sheet } = card.userData.frameRect;
		const image = sheet.image;
		const x = Math.max(0, Math.min(image.alphaWidth - 1, Math.floor(uv.x * image.alphaWidth)));
		const y = Math.max(0, Math.min(image.alphaHeight - 1, Math.floor((1 - uv.y) * image.alphaHeight)));
		return image.alpha?.[y * image.alphaWidth + x] >= ALPHA;
	}
	function buildCard(npc, asset, foot, placementScale = 1) {
		const material = new MeshBasicMaterial({
			alphaTest: .35,
			depthTest: true,
			depthWrite: true,
			side: 2
		});
		const card = new Mesh(new PlaneGeometry(1, 1).translate(0, .5, 0), material);
		card.userData.outline = installNpcOutline(material);
		card.name = `Scene3D_NPC_${npc.gameNpcId}`;
		card.castShadow = card.receiveShadow = false;
		Object.assign(card.userData, {
			gameNpcId: npc.gameNpcId,
			asset,
			placementScale,
			heightMeters: npcEffectiveHeight(npc.heightMeters, asset.visual.height) * placementScale,
			foot: foot.toArray(),
			frame: -1,
			scene3dNpc: true
		});
		card.position.copy(root.worldToLocal(foot.clone()));
		card.raycast = function(ray, intersections) {
			const hits = [];
			Mesh.prototype.raycast.call(this, ray, hits);
			for (const hit of hits) if (hit.uv && alphaHit(this, hit.uv)) intersections.push(hit);
		};
		setFrame(card, 0);
		group.add(card);
		cards.push(card);
		contactShadows?.add(card);
	}
	function tick(_now, delta = 0) {
		if (disposed || !root || !snapshot) return;
		if (snapshot.visible && snapshot.renderEnabled && Number.isFinite(delta) && delta > 0) elapsed += Math.min(delta, .1) * 1e3;
		camera.updateMatrixWorld(true);
		root.updateWorldMatrix(true, false);
		const parentQuaternion = root.getWorldQuaternion(new Quaternion()).invert();
		const parentScale = root.getWorldScale(new Vector3());
		const forward = new Vector3(0, 0, 1).applyQuaternion(camera.getWorldQuaternion(new Quaternion()));
		const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(forward.x, forward.z));
		const viewport = renderer.domElement.getBoundingClientRect();
		const night = snapshot.environment.hour < 6 || snapshot.environment.hour >= 19.5;
		for (const card of cards) {
			const npc = snapshot.npcs.find((n) => n.gameNpcId === card.userData.gameNpcId);
			if (!npc) continue;
			card.userData.heightMeters = npcEffectiveHeight(npc.heightMeters, card.userData.asset.visual.height) * card.userData.placementScale;
			const size = cardSize(card.userData.asset.visual, camera, card.userData.heightMeters);
			card.quaternion.copy(parentQuaternion).multiply(facing);
			card.scale.set(size.width / Math.max(1e-4, Math.abs(parentScale.x)), size.height / Math.max(1e-4, Math.abs(parentScale.y)), 1 / Math.max(1e-4, Math.abs(parentScale.z)));
			card.material.color.set(night ? "#aab8d5" : "#ffffff");
			card.updateWorldMatrix(true, false);
			const foot = new Vector3(0, 0, 0).applyMatrix4(card.matrixWorld).project(camera);
			const head = new Vector3(0, 1, 0).applyMatrix4(card.matrixWorld).project(camera);
			card.userData.outline.setViewport(Math.abs(head.y - foot.y) * viewport.height / 2, viewport.width, viewport.height);
			card.userData.outline.setPixelRatio(renderer.getPixelRatio?.() ?? 1);
			setFrame(card, frameAt(card.userData.asset.visual, elapsed));
		}
		if (group) {
			group.visible = snapshot.visible;
			group.updateWorldMatrix(true, true);
		}
		contactShadows?.update(shadowsEnabled);
		syncFallback();
	}
	function setSelection(gameNpcId = null) {
		selectedNpcId = !disposed && cards.some((card) => card.userData.gameNpcId === gameNpcId) ? gameNpcId : null;
		for (const card of cards) card.userData.outline.setSelected(card.userData.gameNpcId === selectedNpcId);
		return selectedNpcId !== null;
	}
	function setNpcShadows(value) {
		if (disposed || typeof value !== "boolean") return false;
		shadowsEnabled = value;
		contactShadows?.update(shadowsEnabled);
		return true;
	}
	function bind(nextRoot, nextId, input = {}) {
		if (disposed) return Promise.resolve({ status: "destroyed" });
		let next;
		try {
			next = copySnapshot(input);
		} catch (error) {
			generation++;
			clearCurrent();
			root = null;
			sceneId = null;
			key = null;
			return Promise.resolve({
				status: "degraded",
				code: error.code
			});
		}
		const nextKey = signature(next);
		if (root === nextRoot && sceneId === nextId && key === nextKey) {
			snapshot = next;
			tick(0, 0);
			return task;
		}
		const previousKeys = currentKeys;
		generation++;
		const token = generation;
		clearCurrent();
		root = nextRoot;
		sceneId = nextId;
		snapshot = next;
		key = nextKey;
		elapsed = 0;
		currentKeys = new Set(next.npcs.map(assetKey));
		trim(/* @__PURE__ */ new Set([...previousKeys, ...currentKeys]));
		if (!root || nextId === "main" || !nextId || !next.npcs.length) {
			task = Promise.resolve({
				status: "applied",
				cards: 0,
				fallbacks: 0
			});
			return task;
		}
		const boundRoot = root, selected = next.npcs;
		task = (async () => {
			const local = selected.map((npc) => ({
				npc,
				lease: acquire(npc)
			}));
			const results = await Promise.allSettled(local.map((item) => item.lease.promise));
			if (disposed || token !== generation || root !== boundRoot) {
				for (const item of local) item.lease.release();
				return { status: disposed ? "destroyed" : "superseded" };
			}
			const loaded = [];
			for (let i = 0; i < results.length; i++) if (results[i].status === "fulfilled") loaded.push({
				npc: selected[i],
				asset: results[i].value
			});
			else {
				local[i].lease.release();
				fallbacks.push({
					gameNpcId: selected[i].gameNpcId,
					reason: results[i].reason?.code || "NPC_IMAGE_FAILED"
				});
			}
			let placements = [], floor = null;
			try {
				floor = findNpcFloor(boundRoot);
				if (!floor) throw fail("NPC_FLOOR_MISSING");
				const descriptors = loaded.map(({ npc, asset }) => ({
					...asset.visual,
					height: npcEffectiveHeight(npc.heightMeters, asset.visual.height)
				}));
				placements = (context.placement || placeNpcs)(floor, descriptors, camera, seededRandom(layoutSeed(`${next.layoutKey}:${nextId}`)));
				if (placements.length !== loaded.length || !placements.every((p) => p.point?.isVector3 && p.point.toArray().every(Number.isFinite) && (p.scale === void 0 || Number.isFinite(p.scale) && p.scale > 0 && p.scale <= 1))) throw fail("NPC_PLACEMENT_INVALID");
			} catch (error) {
				for (const item of loaded) fallbacks.push({
					gameNpcId: item.npc.gameNpcId,
					reason: error.code || error.message || "NPC_FLOOR_CROWDED"
				});
				loaded.length = 0;
				for (const item of local) item.lease.release();
			}
			group = new Group();
			group.name = "Scene3D_NPCs";
			boundRoot.add(group);
			if (loaded.length) {
				contactShadows = createNpcContactShadows({
					parent: group,
					floor
				});
				counters.shadowGroupsCreated++;
			}
			for (let i = 0; i < loaded.length; i++) buildCard(loaded[i].npc, loaded[i].asset, placements[i].point, placements[i].scale ?? 1);
			fallbacks.sort((a, b) => selected.findIndex((n) => n.gameNpcId === a.gameNpcId) - selected.findIndex((n) => n.gameNpcId === b.gameNpcId));
			showFallback(token);
			tick(0, 0);
			return {
				status: "applied",
				cards: cards.length,
				fallbacks: fallbacks.length
			};
		})().catch((error) => {
			if (disposed || token !== generation) return { status: disposed ? "destroyed" : "superseded" };
			clearCurrent();
			fallbacks = selected.map((npc) => ({
				gameNpcId: npc.gameNpcId,
				reason: error.code || "NPC_FAILED"
			}));
			showFallback(token);
			return {
				status: "degraded",
				code: error.code || "NPC_FAILED",
				cards: 0,
				fallbacks: fallbacks.length
			};
		});
		return task;
	}
	function update(input) {
		if (disposed) return Promise.resolve({ status: "destroyed" });
		let next;
		try {
			next = copySnapshot(input);
		} catch {
			return bind(null, null, input);
		}
		if (root && next.sceneId !== null && next.sceneId !== sceneId) return bind(null, null, input);
		if (root && signature(next) !== key) return bind(root, sceneId, input);
		snapshot = next;
		tick(0, 0);
		return task;
	}
	function anchor(card) {
		const rect = renderer.domElement.getBoundingClientRect();
		if (!rect.width || !rect.height) return null;
		const points = [
			[-.5, 0],
			[.5, 0],
			[-.5, 1],
			[.5, 1]
		].map(([x, y]) => new Vector3(x, y, 0).applyMatrix4(card.matrixWorld).project(camera));
		if (points.every((p) => p.z < -1 || p.z > 1)) return null;
		const left = Math.max(-1, Math.min(...points.map((p) => p.x))), right = Math.min(1, Math.max(...points.map((p) => p.x)));
		const top = Math.min(1, Math.max(...points.map((p) => p.y))), bottom = Math.max(-1, Math.min(...points.map((p) => p.y)));
		if (right <= left || top <= bottom) return null;
		return {
			space: "client-css-px",
			left: rect.left + (left + 1) * rect.width / 2,
			top: rect.top + (1 - top) * rect.height / 2,
			width: (right - left) * rect.width / 2,
			height: (top - bottom) * rect.height / 2
		};
	}
	function getFocusGeometry(gameNpcId) {
		const card = cards.find((item) => item.userData.gameNpcId === gameNpcId);
		if (!card || disposed || !root) return null;
		tick(0, 0);
		const foot = new Vector3(0, 0, 0).applyMatrix4(card.matrixWorld);
		const head = new Vector3(0, 1, 0).applyMatrix4(card.matrixWorld);
		return {
			center: foot.clone().lerp(head, .5),
			projectedHeight: Math.abs(head.clone().project(camera).y - foot.clone().project(camera).y) / 2
		};
	}
	function getAnchor(gameNpcId) {
		const card = cards.find((item) => item.userData.gameNpcId === gameNpcId);
		return card ? anchor(card) : null;
	}
	function pick(clientX, clientY) {
		if (!inputAllowed() || !cards.length || ![clientX, clientY].every(Number.isFinite)) return null;
		const rect = renderer.domElement.getBoundingClientRect();
		if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.left + rect.width || clientY < rect.top || clientY > rect.top + rect.height) return null;
		tick(0, 0);
		pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
		raycaster.setFromCamera(pointer, camera);
		const hit = raycaster.intersectObjects(cards, false)[0];
		if (!hit) return null;
		const occluders = [];
		root.traverseVisible((object) => {
			if (!object.isMesh || object.userData.scene3dNpc || object.userData.npcContactShadow || object.userData.navigationOnly || object.name === "floor" && object.userData.npcSpawn) return;
			if ([].concat(object.material).some((material) => material?.visible && material.depthWrite && material.opacity > .35)) occluders.push(object);
		});
		const obstruction = raycaster.intersectObjects(occluders, false)[0];
		if (obstruction && obstruction.distance < hit.distance - .02) return null;
		const value = anchor(hit.object);
		return value ? {
			gameNpcId: hit.object.userData.gameNpcId,
			anchor: value
		} : null;
	}
	function dispose() {
		if (disposed) return;
		disposed = true;
		generation++;
		clearCurrent();
		root = null;
		sceneId = null;
		snapshot = null;
		key = null;
		for (const entry of [...cache.values()]) {
			entry.refs = 0;
			evict(entry);
		}
		for (const controller of pendingControllers) controller.abort(abortError());
		manifestController?.abort(abortError());
		manifestPromise = null;
		currentKeys.clear();
	}
	function getStats() {
		const shadows = contactShadows?.snapshot() ?? {
			raycasts: 0,
			residents: Object.freeze([])
		};
		const npcShadows = Object.freeze({
			enabled: shadowsEnabled,
			mode: "soft-contact",
			count: shadows.residents.length,
			visibleCount: shadows.residents.filter((shadow) => shadow.visible).length,
			shadowMapPasses: 0,
			...shadows
		});
		return Object.freeze({
			disposed,
			generation,
			sceneId,
			cards: cards.length,
			fallbacks: Object.freeze(fallbacks.map((n) => Object.freeze({ ...n }))),
			placementScale: cards[0]?.userData.placementScale ?? 1,
			cacheBudget: 18,
			residentLimit: 15,
			cachedAssets: cache.size,
			pinnedAssets: [...cache.values()].filter((entry) => entry.refs > 0).length,
			pendingLoads: pendingControllers.size,
			alphaBytes: [...cache.values()].reduce((total, entry) => total + (entry.asset?.sheets.reduce((sum, sheet) => sum + (sheet.image.alpha?.byteLength || 0), 0) || 0), 0),
			fallbackListeners: buttons.length,
			elapsedMs: elapsed,
			defaultSceneScale: DEFAULT_NPC_SCENE_SCALE,
			npcShadows,
			...counters,
			outline: Object.freeze({
				mode: "alpha-contour",
				color: NPC_OUTLINE_COLOR,
				selectedNpcId,
				count: Number(selectedNpcId !== null)
			}),
			residents: Object.freeze(cards.map((card) => {
				const bounds = anchor(card);
				return Object.freeze({
					gameNpcId: card.userData.gameNpcId,
					frame: card.userData.frame,
					height: card.userData.heightMeters,
					baseHeight: card.userData.asset.visual.height,
					placementScale: card.userData.placementScale,
					width: card.scale.x,
					foot: Object.freeze([...card.userData.foot]),
					outline: Object.freeze(card.userData.outline.getStats()),
					anchor: bounds ? Object.freeze(bounds) : null
				});
			}))
		});
	}
	return {
		bind,
		update,
		tick,
		pick,
		getFocusGeometry,
		getAnchor,
		dispose,
		getStats,
		setNpcShadows,
		setSelection
	};
}
//#endregion
export { NPC_ANIMATED_IDS, alphaBounds, createNpcController, frameAt };
