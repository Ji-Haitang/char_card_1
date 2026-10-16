import { t as INTERIOR_SCENES } from "./chunks/interior-scenes-Lg8DtedF.mjs";
import { r as RENDER_DEFAULTS } from "./chunks/render-defaults-BmDJN6tp.mjs";
//#region scene3d/src/protocol.js
var PROTOCOL = 1;
var LOCATION_TO_SCENE = Object.freeze({
	tianshanpai: "main",
	map: "main",
	yanwuchang: "training",
	cangjingge: "library",
	huofang: "kitchen",
	houshan: "back_mountain",
	yishiting: "council",
	tiejiangpu: "forge",
	nandizi: "male_quarters",
	nvdizi: "female_quarters",
	shanmen: "gate",
	gongtian: "fields",
	danfang: "alchemy"
});
var SCENE_TO_LOCATION = Object.freeze(Object.fromEntries(Object.entries(LOCATION_TO_SCENE).filter(([id]) => id !== "map").map(([id, scene]) => [scene, id])));
var own = (object, key) => Object.hasOwn(object, key);
var freeze = (value) => {
	if (value && typeof value === "object") {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
};
function invalid(message) {
	const error = new TypeError(message);
	error.code = "PROTOCOL_INVALID";
	throw error;
}
function normalizeSnapshot(input) {
	if (!input || input.protocol !== 1) invalid("Unsupported Scene3D protocol");
	for (const key of ["sessionEpoch", "revision"]) if (!Number.isSafeInteger(input[key]) || input[key] < 0) invalid(`Invalid ${key}`);
	if (!Number.isSafeInteger(input.mode)) invalid("Invalid mode");
	const sceneId = input.sceneId ?? null;
	if (sceneId !== null && !own(SCENE_TO_LOCATION, sceneId)) invalid("Unknown or unavailable scene");
	if (sceneId && (input.mode !== 0 || LOCATION_TO_SCENE[input.logicalPage] !== sceneId || LOCATION_TO_SCENE[input.gameLocationId] !== sceneId)) invalid("Inconsistent route");
	for (const key of [
		"visible",
		"renderEnabled",
		"interactive"
	]) if (typeof input[key] !== "boolean") invalid(`Invalid ${key}`);
	if (!Array.isArray(input.residents ?? []) || !Array.isArray(input.renderedNpcs ?? [])) invalid("Invalid NPC roster");
	const residents = (input.residents ?? []).map((item) => {
		if (!item || typeof item.gameNpcId !== "string" || !/^[A-O]$/.test(item.gameNpcId) || item.visible === false) invalid("Inconsistent resident");
		return {
			gameNpcId: item.gameNpcId,
			displayName: String(item.displayName ?? "")
		};
	});
	const ids = new Set(residents.map((item) => item.gameNpcId));
	if (ids.size !== residents.length) invalid("Duplicate residents");
	const renderedNpcs = (input.renderedNpcs ?? []).map((item) => {
		if (!item || !ids.has(item.gameNpcId) || ![
			"static",
			"animated",
			"atlas"
		].includes(item.visualKind)) invalid("Inconsistent rendered NPC");
		return {
			gameNpcId: item.gameNpcId,
			displayName: String(item.displayName ?? residents.find((resident) => resident.gameNpcId === item.gameNpcId)?.displayName ?? item.gameNpcId),
			visualKind: item.visualKind,
			visualKey: String(item.visualKey ?? ""),
			portraitUrl: String(item.portraitUrl ?? ""),
			heightMeters: Number.isFinite(item.heightMeters) && item.heightMeters > 0 && item.heightMeters < 10 ? item.heightMeters : void 0
		};
	});
	if (renderedNpcs.length > 15 || new Set(renderedNpcs.map((item) => item.gameNpcId)).size !== renderedNpcs.length) invalid("Invalid rendered subset");
	const locationNpcCounts = Object.fromEntries(Object.keys(LOCATION_TO_SCENE).filter((id) => !["map", "tianshanpai"].includes(id)).map((id) => [id, 0]));
	if (input.locationNpcCounts !== void 0) {
		const counts = input.locationNpcCounts;
		if (!counts || typeof counts !== "object" || Array.isArray(counts)) invalid("Invalid location NPC counts");
		for (const key of Reflect.ownKeys(counts)) {
			if (!own(locationNpcCounts, key) || !Number.isSafeInteger(counts[key]) || counts[key] < 0 || counts[key] > 16) invalid("Invalid location NPC count");
			locationNpcCounts[key] = counts[key];
		}
	}
	const env = input.environment ?? {};
	return freeze({
		protocol: 1,
		sessionEpoch: input.sessionEpoch,
		revision: input.revision,
		mode: input.mode,
		logicalPage: String(input.logicalPage ?? "other"),
		gameLocationId: String(input.gameLocationId ?? ""),
		sceneId,
		environment: {
			season: [
				"spring",
				"summer",
				"autumn",
				"winter"
			].includes(env.season) ? env.season : "winter",
			hour: Number.isFinite(env.hour) && env.hour >= 0 && env.hour < 24 ? env.hour : 12,
			timeSource: String(env.timeSource ?? "dayNightFallback")
		},
		residents,
		renderedNpcs,
		locationNpcCounts,
		layoutKey: String(input.layoutKey ?? `${input.sessionEpoch}:${sceneId}:${renderedNpcs.map((n) => n.gameNpcId).join(",")}`),
		visible: input.visible,
		renderEnabled: input.renderEnabled,
		interactive: input.interactive,
		blockReasons: (input.blockReasons ?? []).map(String)
	});
}
function applyResult(status, snapshot) {
	return Object.freeze({
		status,
		epoch: snapshot?.sessionEpoch ?? null,
		revision: snapshot?.revision ?? null,
		sceneId: snapshot?.sceneId ?? null
	});
}
function compareVersion(a, b) {
	return a.sessionEpoch === b.sessionEpoch ? Math.sign(a.revision - b.revision) : Math.sign(a.sessionEpoch - b.sessionEpoch);
}
function normalizeAssetBase(value) {
	if (typeof value !== "string" || !value) invalid("assetBaseUrl must be explicit and absolute");
	let url;
	try {
		url = new URL(value);
	} catch {
		invalid("assetBaseUrl must be absolute");
	}
	if (![
		"http:",
		"https:",
		"file:",
		"capacitor:"
	].includes(url.protocol) || url.search || url.hash || url.username || url.password) invalid("Invalid asset base URL");
	if (!url.pathname.endsWith("/")) url.pathname += "/";
	return url.href;
}
function semanticLocation(object) {
	for (let node = object; node; node = node.parent) {
		const id = node.userData?.interactionId;
		if (id) return node.userData.clickable === true && own(SCENE_TO_LOCATION, id) && id !== "main" ? SCENE_TO_LOCATION[id] : null;
	}
	return null;
}
function clientAnchor(point, rect) {
	if (!rect.width || !rect.height || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
	return Object.freeze({
		space: "client-css-px",
		left: rect.left + (point.x + 1) * rect.width / 2,
		top: rect.top + (1 - point.y) * rect.height / 2,
		width: 0,
		height: 0
	});
}
//#endregion
//#region scene3d/src/resources.js
function createResourceRegistry() {
	const roots = /* @__PURE__ */ new Map(), refs = /* @__PURE__ */ new Map(), disposed = /* @__PURE__ */ new WeakSet();
	const totals = {
		registered: 0,
		disposed: 0
	};
	function resourcesOf(root) {
		const found = /* @__PURE__ */ new Set();
		const inspect = (value) => {
			if (value?.isTexture) {
				found.add(value);
				for (const image of [].concat(value.source?.data || value.image || [])) if (typeof image?.close === "function") found.add(image);
			} else if (Array.isArray(value)) value.forEach(inspect);
		};
		root?.traverse?.((object) => {
			if (object.geometry) found.add(object.geometry);
			if (object.skeleton) found.add(object.skeleton);
			for (const material of [].concat(object.material || [])) {
				found.add(material);
				Object.values(material).forEach(inspect);
				for (const uniform of Object.values(material.uniforms || {})) inspect(uniform?.value);
			}
		});
		return found;
	}
	function track(root) {
		if (!root) return root;
		let owned = roots.get(root);
		if (!owned) {
			owned = /* @__PURE__ */ new Set();
			roots.set(root, owned);
		}
		for (const resource of resourcesOf(root)) if (!owned.has(resource)) {
			owned.add(resource);
			refs.set(resource, (refs.get(resource) || 0) + 1);
			totals.registered++;
		}
		return root;
	}
	function release(root) {
		if (!roots.has(root)) return;
		track(root);
		const owned = roots.get(root);
		roots.delete(root);
		root.removeFromParent?.();
		for (const resource of owned) {
			const count = refs.get(resource) - 1;
			if (count > 0) {
				refs.set(resource, count);
				continue;
			}
			refs.delete(resource);
			if (disposed.has(resource)) continue;
			disposed.add(resource);
			try {
				resource.dispose?.();
			} catch {}
			if (!resource.isTexture) try {
				resource.close?.();
			} catch {}
			totals.disposed++;
		}
	}
	return {
		track,
		release,
		dispose() {
			for (const root of [...roots.keys()]) release(root);
		},
		snapshot() {
			let geometries = 0, materials = 0, textures = 0;
			for (const resource of refs.keys()) {
				if (resource.isBufferGeometry) geometries++;
				if (resource.isMaterial) materials++;
				if (resource.isTexture) textures++;
			}
			return Object.freeze({
				roots: roots.size,
				resources: refs.size,
				geometries,
				materials,
				textures,
				...totals
			});
		}
	};
}
function createListenerRegistry() {
	const disposers = /* @__PURE__ */ new Set();
	return {
		listen(target, type, handler, options) {
			target.addEventListener(type, handler, options);
			const remove = () => {
				target.removeEventListener(type, handler, options);
				disposers.delete(remove);
			};
			disposers.add(remove);
			return remove;
		},
		dispose() {
			for (const remove of [...disposers]) remove();
		},
		get size() {
			return disposers.size;
		}
	};
}
//#endregion
//#region scene3d/src/navigation.js
function createNavigation({ load, activate, deactivate, release, onStart = () => {}, onError = () => {} }) {
	let generation = 0, task = null, main = null, room = null, active = null, destroyed = false;
	let failedKey = null, committedKey = null;
	const keyOf = (id, epoch) => `${epoch}:${id}`;
	function cancel() {
		generation++;
		committedKey = null;
		if (task) {
			task.controller.abort();
			task = null;
		}
	}
	function drop(record) {
		if (!record) return;
		if (active === record) {
			deactivate(record);
			active = null;
		}
		release(record);
	}
	function navigate(id, epoch, { force = false } = {}) {
		if (destroyed) return Promise.resolve("destroyed");
		const key = keyOf(id, epoch);
		if (!force && task?.key === key) return task.promise;
		if (!force && failedKey === key) return Promise.resolve("degraded");
		if (!force && active?.id === id && committedKey === key) return Promise.resolve("applied");
		cancel();
		failedKey = null;
		committedKey = null;
		const token = generation, controller = new AbortController();
		const valid = () => !destroyed && token === generation && !controller.signal.aborted;
		onStart(id);
		if (room && room.id !== id && id !== "main") {
			const old = room;
			room = null;
			drop(old);
		}
		const run = {
			key,
			controller,
			promise: null
		};
		task = run;
		let abortResolve;
		const aborted = new Promise((resolve) => {
			abortResolve = resolve;
		});
		controller.signal.addEventListener("abort", () => abortResolve(destroyed ? "destroyed" : "superseded"), { once: true });
		const work = (async () => {
			let candidate = null;
			try {
				if (!main) {
					candidate = await load("main", controller.signal);
					if (!valid()) return destroyed ? "destroyed" : "superseded";
					main = candidate;
					candidate = null;
				}
				if (!valid()) return destroyed ? "destroyed" : "superseded";
				let record = main;
				if (id !== "main") {
					if (!room || room.id !== id) {
						candidate = await load(id, controller.signal);
						if (!valid()) return destroyed ? "destroyed" : "superseded";
						room = candidate;
						candidate = null;
					}
					record = room;
				}
				if (active && active !== record) deactivate(active);
				active = record;
				record.epoch = epoch;
				await activate(record, valid);
				if (!valid()) return destroyed ? "destroyed" : "superseded";
				committedKey = key;
				return "applied";
			} catch (error) {
				if (!valid()) return destroyed ? "destroyed" : "superseded";
				failedKey = key;
				if (active) {
					deactivate(active);
					active = null;
				}
				if (room) {
					const old = room;
					room = null;
					release(old);
				}
				onError(error, id);
				return "degraded";
			} finally {
				if (candidate) release(candidate);
				if (task === run) task = null;
			}
		})();
		run.promise = Promise.race([work, aborted]);
		return run.promise;
	}
	return {
		navigate,
		cancel,
		dispose() {
			if (destroyed) return;
			destroyed = true;
			cancel();
			if (active) {
				deactivate(active);
				active = null;
			}
			if (room) release(room);
			if (main) release(main);
			main = room = null;
		},
		get active() {
			return active;
		},
		get busy() {
			return Boolean(task);
		},
		get generation() {
			return generation;
		},
		snapshot() {
			return Object.freeze({
				routeGeneration: generation,
				pending: Number(Boolean(task)),
				cachedMain: Number(Boolean(main)),
				cachedRooms: Number(Boolean(room)),
				activeSceneId: active?.id ?? null
			});
		}
	};
}
//#endregion
//#region scene3d/src/interactive-hotspots.js
var HOTSPOTS = Object.freeze({
	gate: [["Gate_stairs", "下山"]],
	fields: [["Fields_shed", "耕种"]],
	library: [["desk", "学习"], ["shelf_classics", "技能习得"]],
	alchemy: [["Alchemy_furnace", "炼丹"]],
	female_quarters: [["Female_screen", "拜访"]],
	training: [["Training_medallion", "练武"]],
	council: [["sand_table", "汇报"], ["bounty_board", "悬赏任务"]],
	kitchen: [["Kitchen_firewood", "打杂"], ["Kitchen_counter", "交易"]],
	male_quarters: [["Male_bed_east", "休息"]],
	forge: [["Smith_anvil", "打铁"], ["Smith_weapon_rack", "交易"]],
	back_mountain: [["Ravine_cave", "秘密赌场"], ["Ravine_stairs", "探索"]]
});
function createHotspots({ THREE, container, camera, renderer, onAction }) {
	const doc = container.ownerDocument, ns = "http://www.w3.org/2000/svg";
	const layer = doc.createElement("div");
	layer.className = "scene3d-hotspots";
	layer.setAttribute("aria-hidden", "true");
	layer.style.pointerEvents = "none";
	const svg = doc.createElementNS(ns, "svg");
	layer.appendChild(svg);
	container.appendChild(layer);
	let items = [], disposed = false, sceneId = null;
	function clear() {
		for (const item of items) {
			item.label.remove();
			item.line.remove();
		}
		items = [];
		sceneId = null;
		layer.hidden = true;
	}
	function bind(root, id) {
		clear();
		if (disposed || !root) return;
		sceneId = id;
		root.updateMatrixWorld(true);
		for (const [name, text] of HOTSPOTS[id] || []) {
			const node = root.getObjectByName(name);
			if (!node) continue;
			const bounds = new THREE.Box3().setFromObject(node);
			if (bounds.isEmpty()) continue;
			const point = bounds.getCenter(new THREE.Vector3());
			point.y = bounds.max.y;
			const label = doc.createElement("button");
			label.type = "button";
			label.className = "scene3d-hotspot";
			label.textContent = text;
			label.dataset.mesh = name;
			label.setAttribute("aria-label", text);
			label.addEventListener("click", (event) => {
				event.stopPropagation();
				if (!disposed) onAction?.(sceneId, name, text);
			});
			layer.appendChild(label);
			const line = doc.createElementNS(ns, "line");
			svg.appendChild(line);
			items.push({
				point,
				label,
				line
			});
		}
	}
	function setVisible(value) {
		layer.hidden = disposed || !value || items.length === 0;
	}
	function update() {
		if (disposed || layer.hidden) return;
		const rect = renderer.domElement.getBoundingClientRect(), w = container.clientWidth, h = container.clientHeight;
		if (!rect.width || !rect.height || !w || !h) return;
		svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
		const used = [];
		for (const item of items) {
			const p = item.point.clone().project(camera), visible = p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
			item.label.hidden = !visible;
			item.line.style.display = visible ? "" : "none";
			if (!visible) continue;
			const x = (p.x + 1) * w / 2, y = (1 - p.y) * h / 2, lw = item.label.offsetWidth, lh = item.label.offsetHeight;
			let left = Math.max(4, Math.min(w - lw - 4, x - lw / 2)), top = Math.max(4, Math.min(h - lh - 4, y - lh - 27));
			for (const previous of used) if (left < previous.left + previous.w + 4 && left + lw + 4 > previous.left && top < previous.top + previous.h + 4 && top + lh + 4 > previous.top) top = Math.max(4, Math.min(h - lh - 4, previous.top + previous.h + 6));
			used.push({
				left,
				top,
				w: lw,
				h: lh
			});
			item.label.style.left = left + "px";
			item.label.style.top = top + "px";
			for (const [key, value] of Object.entries({
				x1: x,
				y1: y,
				x2: left + lw / 2,
				y2: top + lh
			})) item.line.setAttribute(key, String(value));
		}
	}
	return {
		bind,
		update,
		setVisible,
		clear,
		dispose() {
			if (disposed) return;
			clear();
			disposed = true;
			layer.remove();
		},
		getStats() {
			return {
				sceneId,
				count: items.length,
				visible: !layer.hidden,
				disposed,
				labels: items.map((i) => ({
					text: i.label.textContent,
					mesh: i.label.dataset.mesh,
					visible: !layer.hidden && !i.label.hidden
				}))
			};
		}
	};
}
//#endregion
//#region scene3d/src/npc-focus.js
function npcFocusZoom(camera, projectedHeight, fraction = .29) {
	if (!Number.isFinite(projectedHeight) || projectedHeight <= 0) return null;
	return camera.zoom * fraction / projectedHeight;
}
function clearNpcCameraDamping(camera, controls) {
	const position = camera.position.clone(), target = controls.target.clone();
	const quaternion = camera.quaternion.clone(), zoom = camera.zoom;
	const damping = controls.enableDamping, autoRotate = controls.autoRotate;
	controls.enableDamping = false;
	controls.autoRotate = false;
	controls.update();
	camera.position.copy(position);
	controls.target.copy(target);
	camera.quaternion.copy(quaternion);
	camera.zoom = zoom;
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld(true);
	controls.enableDamping = damping;
	controls.autoRotate = autoRotate;
}
function restoreNpcRoomCamera(camera, controls, target, zoom = 1.55) {
	camera.position.add(target.clone().sub(controls.target));
	controls.target.copy(target);
	controls.minZoom = .5;
	controls.maxZoom = 5;
	camera.zoom = zoom;
	camera.lookAt(controls.target);
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld(true);
}
function frameNpcCamera(camera, controls, geometry, fraction = .29) {
	const zoom = npcFocusZoom(camera, geometry.projectedHeight, fraction);
	if (!Number.isFinite(zoom) || zoom <= 0) return false;
	const shift = geometry.center.clone().sub(controls.target);
	camera.position.add(shift);
	controls.target.copy(geometry.center);
	controls.maxZoom = Math.max(5, zoom * 1.25);
	controls.minZoom = Math.min(.5, zoom);
	camera.zoom = zoom;
	camera.updateProjectionMatrix();
	camera.lookAt(controls.target);
	camera.updateMatrixWorld(true);
	return true;
}
//#endregion
//#region scene3d/src/location-labels.js
var ROOF_LANDMARKS = {
	gate: [
		0,
		13.054235,
		13.1
	],
	back_mountain: [
		19.8,
		10.08,
		-15.8
	]
};
function createLocationLabels({ THREE, container, camera }) {
	const doc = container.ownerDocument;
	const layer = doc.createElement("div");
	layer.className = "scene3d-location-labels";
	layer.setAttribute("aria-hidden", "true");
	layer.style.pointerEvents = "none";
	layer.hidden = true;
	container.appendChild(layer);
	const world = new THREE.Vector3(), view = new THREE.Vector3(), projected = new THREE.Vector3();
	let items = [], sceneId = null, disposed = false, counts = {};
	function applyCount(item) {
		const value = counts[SCENE_TO_LOCATION[item.label.dataset.sceneId]];
		const count = Number.isSafeInteger(value) && value >= 0 && value <= 16 ? value : 0;
		if (item.count === count) return;
		for (const child of [...item.people.children]) child.remove();
		for (let i = 0; i < count; i++) {
			const dot = doc.createElement("span");
			dot.className = "people-dot";
			item.people.appendChild(dot);
		}
		item.divider.style.opacity = count > 0 ? "1" : "0.35";
		item.label.dataset.npcCount = String(count);
		item.count = count;
	}
	function setCounts(value = {}) {
		if (disposed) return;
		counts = { ...value };
		for (const item of items) applyCount(item);
	}
	function clear() {
		for (const item of items) item.label.remove();
		items = [];
		sceneId = null;
		layer.hidden = true;
	}
	function bind(root, id) {
		clear();
		if (disposed || id !== "main" || !root) return;
		sceneId = id;
		root.updateWorldMatrix(true, true);
		const seen = /* @__PURE__ */ new Set();
		root.traverse((node) => {
			const data = node.userData || {}, descriptor = INTERIOR_SCENES[data.interactionId];
			if (data.category !== "location" || !descriptor || data.interactionId === "guest_quarters" || seen.has(data.interactionId)) return;
			const model = node.getObjectByName(`${data.interactionId}_matte`) || node;
			const bounds = new THREE.Box3().setFromObject(model);
			if (bounds.isEmpty()) return;
			let point, anchorNode = node;
			const landmark = ROOF_LANDMARKS[data.interactionId];
			if (landmark && model.name === `${data.interactionId}_matte` && model.geometry) {
				model.geometry.computeBoundingBox();
				const roof = new THREE.Vector3().fromArray(landmark);
				if (model.geometry.boundingBox?.containsPoint(roof)) {
					point = roof;
					anchorNode = model;
				}
			}
			if (!point) {
				point = bounds.getCenter(new THREE.Vector3());
				point.y = bounds.max.y;
				node.worldToLocal(point);
			}
			const label = doc.createElement("span");
			label.className = "scene3d-location-label";
			label.textContent = typeof data.label === "string" && data.label.trim() ? data.label.trim() : descriptor.label;
			label.dataset.sceneId = data.interactionId;
			label.style.pointerEvents = "none";
			label.hidden = true;
			const divider = doc.createElement("span");
			divider.className = "location-label-divider";
			const people = doc.createElement("span");
			people.className = "location-people";
			label.appendChild(divider);
			label.appendChild(people);
			layer.appendChild(label);
			const item = {
				node: anchorNode,
				point,
				label,
				divider,
				people,
				count: null
			};
			items.push(item);
			applyCount(item);
			seen.add(data.interactionId);
		});
	}
	function nodeVisible(node) {
		for (let current = node; current; current = current.parent) if (!current.visible) return false;
		return true;
	}
	function setVisible(value) {
		const hidden = disposed || !value || !items.length;
		const changed = layer.hidden !== hidden;
		layer.hidden = hidden;
		if (changed && !hidden) update();
	}
	function update() {
		if (disposed || layer.hidden) return;
		const width = container.clientWidth, height = container.clientHeight;
		camera.updateWorldMatrix(true, false);
		for (const item of items) {
			if (!width || !height || !nodeVisible(item.node)) {
				item.label.hidden = true;
				continue;
			}
			item.node.updateWorldMatrix(true, false);
			world.copy(item.point).applyMatrix4(item.node.matrixWorld);
			view.copy(world).applyMatrix4(camera.matrixWorldInverse);
			projected.copy(world).project(camera);
			const visible = view.z < 0 && [
				projected.x,
				projected.y,
				projected.z
			].every(Number.isFinite) && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
			item.label.hidden = !visible;
			if (!visible) continue;
			item.label.style.left = `${(projected.x + 1) * width / 2}px`;
			item.label.style.top = `${(1 - projected.y) * height / 2}px`;
		}
	}
	return {
		bind,
		clear,
		setVisible,
		setCounts,
		update,
		dispose() {
			if (disposed) return;
			clear();
			disposed = true;
			layer.remove();
		},
		getStats() {
			return {
				sceneId,
				count: items.length,
				visible: !layer.hidden,
				disposed,
				labels: items.map((item) => ({
					sceneId: item.label.dataset.sceneId,
					text: item.label.textContent,
					npcCount: item.count,
					visible: !layer.hidden && !item.label.hidden
				}))
			};
		}
	};
}
var MODEL_BYTE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
function createModelByteCache({ version = "", maxEntries = 3, maxBytes = MODEL_BYTE_CACHE_MAX_BYTES } = {}) {
	if (typeof version !== "string") throw new TypeError("Cache version must be a string");
	if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 3) throw new RangeError("Cache supports at most 3 entries");
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 33554432) throw new RangeError("Cache supports at most 32 MiB");
	const entries = /* @__PURE__ */ new Map();
	let bytes = 0;
	const stats = {
		hits: 0,
		misses: 0,
		puts: 0,
		rejected: 0,
		evictions: 0,
		clears: 0
	};
	const checkKey = (key) => {
		if (typeof key !== "string" || !key.length) throw new TypeError("Cache key must be a nonempty string");
	};
	function remove(key) {
		const entry = entries.get(key);
		if (!entry) return;
		bytes -= entry.size;
		entries.delete(key);
	}
	return Object.freeze({
		get(key) {
			checkKey(key);
			const entry = entries.get(key);
			if (!entry || entry.buffer.byteLength !== entry.size) {
				if (entry) remove(key);
				stats.misses++;
				return null;
			}
			entries.delete(key);
			entries.set(key, entry);
			stats.hits++;
			return entry.buffer;
		},
		put(key, buffer) {
			checkKey(key);
			if (!(buffer instanceof ArrayBuffer)) throw new TypeError("Only encoded ArrayBuffer values may be cached");
			const size = buffer.byteLength;
			if (!size || size > maxBytes) {
				stats.rejected++;
				return false;
			}
			remove(key);
			while (entries.size >= maxEntries || bytes + size > maxBytes) {
				remove(entries.keys().next().value);
				stats.evictions++;
			}
			entries.set(key, {
				buffer,
				size
			});
			bytes += size;
			stats.puts++;
			return true;
		},
		clear() {
			entries.clear();
			bytes = 0;
			stats.clears++;
		},
		getStats() {
			return Object.freeze({
				version,
				entries: entries.size,
				bytes,
				maxEntries,
				maxBytes,
				...stats
			});
		}
	});
}
/** Optional one-pass prefetcher, explicitly started only after main readiness.
* Each item is { key, url }; use immutable versioned absolute URLs as keys.
* Its AbortController belongs ONLY to prefetch, never to a foreground route.
* pause() aborts and removes the timer; resume() cannot start before start().
* A fetch ignoring abort holds the sole slot until it settles, preventing overlap.
* dispose() invalidates late completion but does not own/clear the caller's cache.
*/
function createModelBytePrefetcher({ cache, items, fetch, AbortController: Controller, clock, shouldRun }) {
	if (!cache || typeof cache.get !== "function" || typeof cache.put !== "function") throw new TypeError("A byte cache is required");
	if (!Array.isArray(items) || items.some((item) => !item || typeof item.key !== "string" || !item.key || typeof item.url !== "string" || !item.url)) throw new TypeError("Prefetch items require key/url strings");
	if (typeof fetch !== "function" || typeof Controller !== "function" || typeof shouldRun !== "function" || typeof clock?.setTimeout !== "function" || typeof clock?.clearTimeout !== "function") throw new TypeError("Inject fetch, AbortController, clock and shouldRun");
	const queue = [...new Map(items.map((item) => [item.key, Object.freeze({
		key: item.key,
		url: item.url
	})])).values()];
	let started = false, paused = true, disposed = false, generation = 0, cursor = 0, timer = null, active = null;
	const stats = {
		requested: 0,
		stored: 0,
		skipped: 0,
		rejected: 0,
		failed: 0,
		aborted: 0
	};
	function allowed() {
		try {
			return Boolean(shouldRun());
		} catch {
			return false;
		}
	}
	function clearTimer() {
		if (timer !== null) clock.clearTimeout(timer);
		timer = null;
	}
	function schedule(delay = 350) {
		if (!started || paused || disposed || active || timer !== null || cursor >= queue.length) return;
		timer = clock.setTimeout(pump, delay);
	}
	function pump() {
		timer = null;
		if (!started || paused || disposed || active || cursor >= queue.length) return;
		if (!allowed()) {
			schedule();
			return;
		}
		if (paused || disposed) return;
		const item = queue[cursor];
		if (cache.get(item.key)) {
			stats.skipped++;
			cursor++;
			schedule();
			return;
		}
		const run = {
			controller: new Controller(),
			token: generation
		};
		active = run;
		const valid = () => !disposed && !paused && run.token === generation && !run.controller.signal.aborted;
		stats.requested++;
		(async () => {
			try {
				const response = await fetch(item.url, { signal: run.controller.signal });
				if (!valid()) return;
				if (!response?.ok) throw new Error("Prefetch HTTP failure");
				const buffer = await response.arrayBuffer();
				if (!valid() || !allowed() || !valid()) return;
				if (cache.put(item.key, buffer)) stats.stored++;
				else stats.rejected++;
				cursor++;
			} catch {
				if (valid()) {
					stats.failed++;
					cursor++;
				}
			} finally {
				if (active === run) active = null;
				schedule();
			}
		})();
	}
	function pause() {
		if (disposed) return false;
		paused = true;
		generation++;
		clearTimer();
		if (active && !active.controller.signal.aborted) {
			stats.aborted++;
			active.controller.abort();
		}
		return true;
	}
	return Object.freeze({
		start() {
			if (disposed || started) return false;
			started = true;
			paused = false;
			schedule(0);
			return true;
		},
		pause,
		resume() {
			if (disposed || !started) return false;
			paused = false;
			schedule();
			return true;
		},
		dispose() {
			if (disposed) return;
			pause();
			disposed = true;
		},
		getStats() {
			return Object.freeze({
				started,
				paused,
				disposed,
				pending: Number(Boolean(active)),
				timers: Number(timer !== null),
				cursor,
				total: queue.length,
				complete: cursor >= queue.length,
				...stats
			});
		}
	});
}
//#endregion
//#region scene3d/src/runtime.js
function renderPixelRatio(quality, deviceDpr, width, height) {
	return Math.min(quality === "low" ? 1 : Math.min(deviceDpr || 1, 1.25), Math.sqrt(45e5 / Math.max(1, width * height)));
}
function renderScaleRatio(scale, width, height) {
	return Math.min(scale, Math.sqrt(45e5 / Math.max(1, width * height)));
}
/** Shared 420ms smoothstep for NPC focus/return; owns no timers or GPU resources. */
function advanceNpcCameraTween(camera, controls, view, now, reducedMotion = false) {
	view.start ??= now;
	const progress = reducedMotion ? 1 : Math.max(0, Math.min(1, (now - view.start) / 420));
	const t = progress * progress * (3 - 2 * progress);
	camera.position.lerpVectors(view.fromPosition, view.position, t);
	controls.target.lerpVectors(view.fromTarget, view.target, t);
	camera.zoom = view.fromZoom + (view.zoom - view.fromZoom) * t;
	camera.lookAt(controls.target);
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld(true);
	return progress === 1;
}
var instances = /* @__PURE__ */ new WeakMap();
var nextInstance = 0;
var dependencies;
function importDependencies() {
	if (!dependencies) dependencies = Promise.all([
		import("./chunks/three.module-DEUH6-St.mjs"),
		import("./chunks/OrbitControls-B62UhULX.mjs"),
		import("./chunks/GLTFLoader-DpM_B4sa.mjs"),
		import("./chunks/DRACOLoader-CYkkE_hg.mjs"),
		import("./chunks/environment-CzWESj8G.mjs"),
		import("./chunks/npcs-CwSliwd8.mjs")
	]).catch((error) => {
		dependencies = null;
		throw error;
	});
	return dependencies;
}
var noopNpc = () => ({
	bind() {},
	update() {},
	tick() {},
	pick() {
		return null;
	},
	dispose() {}
});
function failure(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}
function diagnosticSnapshot(value, seen = /* @__PURE__ */ new WeakSet()) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (!value || typeof value !== "object" || seen.has(value)) return null;
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
	seen.add(value);
	const copy = Array.isArray(value) ? value.map((item) => diagnosticSnapshot(item, seen)) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, diagnosticSnapshot(item, seen)]));
	seen.delete(value);
	return Object.freeze(copy);
}
/** Three 0.185.1 compileAsync owns uncancellable timers over disposable materials.
* Use its public compile submission and the same KHR readiness query, but own
* every continuation. Never retain GPU resources merely to keep a poll alive.
* properties/currentProgram is a version-pinned Three adapter, not a stable API.
*/
function createCompileLifecycle(renderer, clock, { timeoutMs = 3e4 } = {}) {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("Compile timeout must be finite and positive");
	let active = null, disposed = false;
	const stats = {
		started: 0,
		completed: 0,
		cancelled: 0,
		failed: 0
	};
	function cancel() {
		active?.finish(false);
	}
	function compile(scene, camera, valid = () => true, targetScene = scene) {
		cancel();
		if (disposed || !valid()) return Promise.resolve(false);
		return new Promise((resolve, reject) => {
			let timer = null, done = false, materials = /* @__PURE__ */ new Set(), elapsed = 0;
			const observed = /* @__PURE__ */ new Set();
			const onDispose = () => finish(false);
			function finish(result, error) {
				if (done) return;
				done = true;
				if (timer !== null) clock.clearTimeout(timer);
				timer = null;
				for (const material of observed) material.removeEventListener("dispose", onDispose);
				observed.clear();
				materials.clear();
				if (active?.finish === finish) active = null;
				if (error) {
					stats.failed++;
					reject(error);
				} else {
					stats[result ? "completed" : "cancelled"]++;
					resolve(result);
				}
			}
			active = {
				finish,
				get timer() {
					return timer;
				},
				get materials() {
					return observed.size;
				}
			};
			stats.started++;
			function poll() {
				timer = null;
				if (done) return;
				try {
					if (disposed || !valid()) {
						finish(false);
						return;
					}
					if (renderer.getContext().isContextLost()) throw failure("COMPILE_CONTEXT_LOST", "Context lost during shader compilation");
					for (const material of materials) {
						const program = renderer.properties.has(material) && renderer.properties.get(material).currentProgram;
						if (!program?.program || typeof program.isReady !== "function") throw failure("COMPILE_PROGRAM_MISSING", "Compiled material program was released or is unavailable");
						if (program.isReady()) materials.delete(material);
					}
					if (!materials.size) {
						finish(true);
						return;
					}
					if (elapsed >= timeoutMs) throw failure("COMPILE_TIMEOUT", "Shader compilation timeout");
					elapsed += 10;
					timer = clock.setTimeout(poll, 10);
				} catch (error) {
					finish(false, error);
				}
			}
			try {
				const submitted = renderer.compile(scene, camera, targetScene);
				if (done) return;
				if (disposed || !valid()) {
					finish(false);
					return;
				}
				if (renderer.getContext().isContextLost()) throw failure("COMPILE_CONTEXT_LOST", "Context lost during shader compilation");
				if (!(submitted instanceof Set)) throw failure("COMPILE_API_CHANGED", "Expected Three compile() to return Set<Material>");
				materials = new Set(submitted);
				for (const material of materials) {
					material.addEventListener("dispose", onDispose);
					observed.add(material);
				}
				if (renderer.extensions.get("KHR_parallel_shader_compile") === null) finish(true);
				else poll();
			} catch (error) {
				finish(false, error);
			}
		});
	}
	return {
		compile,
		cancel,
		dispose() {
			disposed = true;
			cancel();
		},
		snapshot() {
			return Object.freeze({
				...stats,
				pending: Number(Boolean(active)),
				timers: Number(active?.timer != null),
				materialListeners: active?.materials || 0,
				disposed
			});
		}
	};
}
/** Import and mount never initialize WebGL. The first visible applyState does.
* npcFactory is an internal renderer extension, not a business-state owner.
*/
function mount(container, options = {}) {
	options = { ...options };
	for (const key of ["mainTimeoutMs", "roomTimeoutMs"]) if (options[key] !== void 0 && (!Number.isFinite(options[key]) || options[key] <= 0)) throw new TypeError(`Invalid ${key}`);
	if (!container?.appendChild || !container.ownerDocument) throw new TypeError("Scene3D requires a DOM container");
	if (instances.has(container)) throw new Error("A Scene3D instance already owns this container");
	if (options.protocol !== void 0 && options.protocol !== 1) throw new TypeError("Unsupported Scene3D protocol");
	const assetBaseUrl = normalizeAssetBase(options.assetBaseUrl);
	if (options.quality !== void 0 && !["low", "balanced"].includes(options.quality)) throw new TypeError("Unknown quality");
	const doc = container.ownerDocument, win = doc.defaultView;
	const instanceId = ++nextInstance, registry = createResourceRegistry(), listeners = createListenerRegistry();
	const api = { metrics: {} }, decoders = /* @__PURE__ */ new Set(), requests = /* @__PURE__ */ new Set();
	let latest = null, destroyed = false, destroyPromise, initializing = null, initializeFailure = null;
	let visible = false, renderEnabled = false, interactive = false, ready = false;
	let renderer, scene, camera, controls, environment, cinematic, atmosphere, navigation, THREE, sun, observer, shell, back, reset;
	let cinematicFactory = null;
	let npc = noopNpc(), lastNpcStats = null, activeRecord = null, appliedVersion = null, readyKey = null, drawable = false;
	let raf = 0, lastFrame = 0, width = 0, height = 0, frameWaiters = /* @__PURE__ */ new Set(), motionReduced = false;
	let gesture = null, pointers = /* @__PURE__ */ new Set(), quality = options.quality || "low", qualityFallback = false;
	const counters = {
		frames: 0,
		rendererCreated: 0,
		rendererDisposed: 0,
		modelRequests: 0,
		pendingLoads: 0,
		errors: 0,
		attempts: 0,
		npcErrors: 0
	};
	let initializationSerial = 0, compiler = null, lastCompileStats = null, hotspots = null;
	let modelCache = null, prefetch = null, lastPrefetchStats = null, locationLabels = null;
	const tuning = options.tuning || {};
	const settings = {
		renderScale: [
			1,
			1.25,
			1.5,
			2
		].includes(options.renderScale) ? options.renderScale : null,
		msaa: [2, 4].includes(options.msaa) ? options.msaa : 2,
		shadows: options.shadows !== false,
		atmosphere: options.atmosphere !== false,
		skyEffects: options.skyEffects !== false,
		skyBlend: options.skyBlend === true,
		skyAnalytic: options.skyAnalytic !== false,
		tuning: {
			bloom: Number.isFinite(tuning.bloom) ? tuning.bloom : RENDER_DEFAULTS.bloom,
			shaft: Number.isFinite(tuning.shaft) ? tuning.shaft : RENDER_DEFAULTS.shaftStrength,
			saturation: Number.isFinite(tuning.saturation) ? tuning.saturation : RENDER_DEFAULTS.saturation,
			contrast: Number.isFinite(tuning.contrast) ? tuning.contrast : RENDER_DEFAULTS.contrast,
			gamma: Number.isFinite(tuning.gamma) ? tuning.gamma : RENDER_DEFAULTS.gamma,
			warmth: Number.isFinite(tuning.warmth) ? tuning.warmth : RENDER_DEFAULTS.warmth,
			vignette: Number.isFinite(tuning.vignette) ? tuning.vignette : RENDER_DEFAULTS.vignette
		}
	};
	let selectionObjects = [];
	let npcFocus = null, npcViewReturn = null, selectedNpcId = null, lastNpcAnchor = "";
	const PAN_RADIUS_MAX = 15;
	let panOrigin = null, panRadius = PAN_RADIUS_MAX;
	function canPrefetch() {
		return quality === "balanced" && canInteract() && !npcViewReturn && !pointers.size && counters.pendingLoads === 0;
	}
	function syncPrefetch() {
		if (canPrefetch()) {
			if (activeRecord?.id === "main") prefetch?.start();
			prefetch?.resume();
		} else prefetch?.pause();
	}
	function pixelRatio() {
		if (quality === "low") return renderPixelRatio("low", win.devicePixelRatio, width, height);
		if (settings.renderScale != null) return renderScaleRatio(settings.renderScale, width, height);
		return renderPixelRatio(quality, win.devicePixelRatio, width, height);
	}
	function applyShadows() {
		if (!renderer) return;
		const enabled = quality !== "low" && settings.shadows;
		renderer.shadowMap.enabled = enabled;
		renderer.shadowMap.needsUpdate = true;
		if (sun) sun.castShadow = enabled;
		scene?.traverse((object) => {
			if (object.isMesh) for (const material of [].concat(object.material)) material.needsUpdate = true;
		});
	}
	function applyAtmosphere() {
		environment?.refreshAtmosphere(settings.atmosphere);
		if (atmosphere) atmosphere.enabled = (activeRecord?.id ?? latest?.sceneId) === "main" && settings.atmosphere;
	}
	function applyTuning() {
		if (cinematic) {
			cinematic.set("bloom", settings.tuning.bloom);
			cinematic.set("saturation", settings.tuning.saturation);
			cinematic.set("contrast", settings.tuning.contrast);
			cinematic.set("gamma", settings.tuning.gamma);
			cinematic.set("warmth", settings.tuning.warmth);
			cinematic.set("vignette", settings.tuning.vignette);
		}
		atmosphere?.setStrength(settings.tuning.shaft);
	}
	function applyPaperFallback(color) {
		if (!container?.style) return;
		container.style.background = `#${color.getHexString()}`;
	}
	function rebuildCinematic() {
		if (!renderer || !scene || !camera || quality !== "balanced" || !cinematicFactory) return false;
		try {
			cinematic?.dispose();
			cinematic = cinematicFactory(renderer, scene, camera, {
				atmosphere,
				msaa: settings.msaa,
				paperColor: options.paperColor || "#f6f0e0"
			});
			cinematic.setSelection(selectionObjects);
			applyTuning();
			if (width && height) cinematic.resize(width, height);
			return true;
		} catch (error) {
			dropPostprocessing();
			return false;
		}
	}
	function selectLocation(locationId) {
		const objects = [];
		if (activeRecord?.id === "main" && activeRecord.root) activeRecord.root.traverse((node) => {
			if (node.isMesh && semanticLocation(node) === locationId) objects.push(node);
		});
		selectionObjects = objects;
		cinematic?.setSelection(objects);
		return objects;
	}
	function npcMenuOnlyLock() {
		return Boolean(latest?.blockReasons.length) && latest.blockReasons.every((reason) => reason === "scene-menu");
	}
	function awaitingNpcMenuUnlock() {
		return Boolean(npcViewReturn?.awaitingMenuUnlock) && npcMenuOnlyLock();
	}
	function clearSelection({ restoreView = false } = {}) {
		const menuLocked = npcMenuOnlyLock();
		const shouldRestore = restoreView && Boolean(selectedNpcId || npcFocus) && canDraw() && (interactive && !latest?.blockReasons.length || menuLocked) && ready && !navigation?.busy && activeRecord?.id !== "main";
		if (!restoreView || shouldRestore) npcViewReturn = null;
		npcFocus = null;
		selectedNpcId = null;
		lastNpcAnchor = "";
		npc.setSelection?.(null);
		selectionObjects = [];
		cinematic?.setSelection([]);
		if (shouldRestore) {
			const fromPosition = camera.position.clone(), fromTarget = controls.target.clone(), fromZoom = camera.zoom;
			clearNpcCameraDamping(camera, controls);
			restoreNpcRoomCamera(camera, controls, activeRecord.target);
			fit();
			if (!motionReduced || menuLocked) {
				npcViewReturn = {
					epoch: latest.sessionEpoch,
					sceneId: activeRecord.id,
					awaitingMenuUnlock: menuLocked,
					fromPosition,
					fromTarget,
					fromZoom,
					position: camera.position.clone(),
					target: controls.target.clone(),
					zoom: camera.zoom
				};
				camera.position.copy(fromPosition);
				controls.target.copy(fromTarget);
				camera.zoom = fromZoom;
				camera.lookAt(controls.target);
				camera.updateProjectionMatrix();
				camera.updateMatrixWorld(true);
			}
			npc.tick?.(0, 0);
		}
		syncInput();
		if (shouldRestore) schedule();
	}
	function setSettings(patch) {
		if (destroyed || !patch || typeof patch !== "object") return false;
		let applied = false;
		if (patch.renderScale !== void 0) {
			if (patch.renderScale !== null && ![
				1,
				1.25,
				1.5,
				2
			].includes(patch.renderScale)) return false;
			if (settings.renderScale !== patch.renderScale) {
				settings.renderScale = patch.renderScale;
				resize();
				applied = true;
			}
		}
		if (patch.msaa !== void 0) {
			if (![2, 4].includes(patch.msaa)) return false;
			if (settings.msaa !== patch.msaa) {
				settings.msaa = patch.msaa;
				rebuildCinematic();
				applied = true;
			}
		}
		if (patch.shadows !== void 0) {
			if (typeof patch.shadows !== "boolean") return false;
			if (settings.shadows !== patch.shadows) {
				settings.shadows = patch.shadows;
				applyShadows();
				applied = true;
			}
		}
		if (patch.atmosphere !== void 0) {
			if (typeof patch.atmosphere !== "boolean") return false;
			if (settings.atmosphere !== patch.atmosphere) {
				settings.atmosphere = patch.atmosphere;
				applyAtmosphere();
				applied = true;
			}
		}
		if (patch.skyEffects !== void 0) {
			if (typeof patch.skyEffects !== "boolean") return false;
			if (settings.skyEffects !== patch.skyEffects) {
				settings.skyEffects = patch.skyEffects;
				environment?.setSkyEffects(patch.skyEffects);
				applied = true;
			}
		}
		if (patch.skyBlend !== void 0) {
			if (typeof patch.skyBlend !== "boolean") return false;
			if (settings.skyBlend !== patch.skyBlend) {
				settings.skyBlend = patch.skyBlend;
				environment?.setSkyBlend(patch.skyBlend);
				applied = true;
			}
		}
		if (patch.skyAnalytic !== void 0) {
			if (typeof patch.skyAnalytic !== "boolean") return false;
			if (settings.skyAnalytic !== patch.skyAnalytic) {
				settings.skyAnalytic = patch.skyAnalytic;
				environment?.setSkyAnalytic(patch.skyAnalytic);
				applied = true;
			}
		}
		if (patch.tuning) {
			let tuningChanged = false;
			for (const key of [
				"bloom",
				"shaft",
				"saturation",
				"contrast",
				"gamma",
				"warmth",
				"vignette"
			]) {
				const value = patch.tuning[key];
				if (value === void 0) continue;
				if (!Number.isFinite(value)) return false;
				if (settings.tuning[key] !== value) {
					settings.tuning[key] = value;
					tuningChanged = true;
				}
			}
			if (tuningChanged) {
				applyTuning();
				applied = true;
			}
		}
		return applied;
	}
	function emit(type, detail = {}, snapshot = latest) {
		if (destroyed || !snapshot) return;
		try {
			options.onEvent?.(Object.freeze({
				type,
				epoch: snapshot.sessionEpoch,
				revision: snapshot.revision,
				...detail
			}));
		} catch {}
	}
	function emitError(error, sceneId = latest?.sceneId) {
		counters.errors++;
		emit("error", {
			scope: "scene",
			code: error?.code || "RENDER_FAILED",
			message: String(error?.message || error || "Scene rendering failed"),
			retryable: true,
			sceneId
		});
	}
	function eligible() {
		return !destroyed && visible && latest?.mode === 0 && Boolean(latest.sceneId) && !doc.hidden && width > 0 && height > 0;
	}
	function canDraw() {
		return eligible() && renderEnabled && drawable && Boolean(renderer && activeRecord);
	}
	function canInteract() {
		return eligible() && renderEnabled && interactive && !latest?.blockReasons.length && ready && !navigation?.busy && !npcFocus;
	}
	function flushGestures() {
		pointers.clear();
		gesture = null;
	}
	function syncInput() {
		const enabled = canInteract();
		hotspots?.setVisible(enabled);
		locationLabels?.setVisible(eligible() && ready && activeRecord?.id === "main");
		syncPrefetch();
		if (controls) controls.enabled = enabled && !npcViewReturn;
		if (!enabled) flushGestures();
		if (back) {
			back.hidden = !latest?.sceneId || latest.sceneId === "main";
			back.disabled = !enabled;
		}
		if (reset) reset.disabled = !enabled;
		if (shell) {
			shell.hidden = !visible || !latest?.sceneId;
			shell.dataset.state = destroyed ? "destroyed" : ready ? "ready" : initializeFailure ? "degraded" : "loading";
		}
	}
	function stopFrames() {
		if (raf) win.cancelAnimationFrame(raf);
		raf = 0;
		lastFrame = 0;
	}
	function wakeWaiters() {
		for (const resolve of frameWaiters) resolve();
		frameWaiters.clear();
	}
	function schedule() {
		syncInput();
		if (!canDraw()) {
			stopFrames();
			return;
		}
		if (!raf) raf = win.requestAnimationFrame(frame);
	}
	function dropPostprocessing() {
		prefetch?.dispose();
		lastPrefetchStats = prefetch?.getStats() || null;
		prefetch = null;
		modelCache?.clear();
		modelCache = null;
		cinematic?.dispose();
		atmosphere?.dispose();
		cinematic = atmosphere = null;
		if (renderer) {
			renderer.toneMapping = THREE.AgXToneMapping;
			renderer.setPixelRatio(1);
			renderer.shadowMap.enabled = false;
		}
		quality = "low";
		qualityFallback = true;
		api.metrics.atmosphere = false;
		environment?.refreshAtmosphere(false);
	}
	function draw(delta) {
		if (cinematic) try {
			cinematic.setFocus(controls.target);
			cinematic.render(delta);
		} catch (error) {
			if (qualityFallback) throw error;
			dropPostprocessing();
			resize();
			renderer.render(scene, camera);
		}
		else renderer.render(scene, camera);
		counters.frames++;
	}
	function frame(now) {
		raf = 0;
		if (!canDraw()) return;
		const delta = lastFrame ? Math.min((now - lastFrame) / 1e3, .1) : 0;
		lastFrame = now;
		try {
			if (npcFocus) advanceNpcFocus(now);
			else if (npcViewReturn) advanceNpcViewReturn(now);
			else if (canInteract()) controls.update(delta);
			environment?.tick(motionReduced ? 0 : delta);
			try {
				npc.tick?.(now, motionReduced ? 0 : delta);
			} catch {
				counters.npcErrors++;
			}
			draw(motionReduced ? 0 : delta);
			hotspots?.update();
			locationLabels?.update();
			if (selectedNpcId && !npcFocus) {
				const anchor = npc.getAnchor?.(selectedNpcId);
				const key = JSON.stringify(anchor);
				if (anchor && key !== lastNpcAnchor) {
					lastNpcAnchor = key;
					emit("npcAnchor", {
						gameNpcId: selectedNpcId,
						anchor
					});
				}
			}
		} catch (error) {
			ready = false;
			renderEnabled = false;
			initializeFailure = error;
			cancelNavigation();
			wakeWaiters();
			emitError(error);
			syncInput();
			return;
		}
		wakeWaiters();
		schedule();
	}
	async function firstFrame(valid) {
		while (valid()) {
			if (canDraw()) {
				draw(0);
				return;
			}
			await new Promise((resolve) => frameWaiters.add(resolve));
		}
	}
	function fit(record = activeRecord) {
		if (!camera || !width || !height) return;
		const aspect = width / height;
		if (record && record.id !== "main") {
			const diagonal = Math.hypot(record.size.x, record.size.z);
			const span = Math.max((diagonal + record.size.y) / Math.SQRT2, diagonal / aspect) * 1.3;
			camera.left = -span * aspect / 2;
			camera.right = span * aspect / 2;
			camera.top = span / 2;
			camera.bottom = -span / 2;
		} else {
			const span = 40 * Math.max(1, 1.36 / aspect), offset = aspect > 1 ? -1.2 : 0;
			camera.left = -span * aspect / 2;
			camera.right = span * aspect / 2;
			camera.top = span / 2 + offset;
			camera.bottom = -span / 2 + offset;
		}
		camera.updateProjectionMatrix();
	}
	function resize() {
		if (destroyed) return;
		width = Math.max(0, container.clientWidth || 0);
		height = Math.max(0, container.clientHeight || 0);
		if (renderer && width && height) {
			fit();
			if (selectedNpcId && !npcFocus) {
				const geometry = npc.getFocusGeometry?.(selectedNpcId);
				if (geometry) frameNpcCamera(camera, controls, geometry);
			}
			if (npcFocus) {
				const geometry = npc.getFocusGeometry?.(npcFocus.id);
				if (geometry?.projectedHeight > 0) npcFocus.zoom = camera.zoom * .29 / geometry.projectedHeight;
			}
			renderer.setPixelRatio(pixelRatio());
			renderer.setSize(width, height, false);
			cinematic?.resize(width, height);
			npc.tick?.(0, 0);
			locationLabels?.update();
		}
		wakeWaiters();
		schedule();
		if (!raf && !canDraw() && eligible() && drawable && renderer && activeRecord) try {
			draw(0);
		} catch (_) {}
	}
	function resetView() {
		if (!canInteract() || !activeRecord) return false;
		clearSelection();
		positionCamera(activeRecord);
		fit();
		npc.tick?.(0, 0);
		return true;
	}
	function clampPanTarget() {
		if (!panOrigin || npcFocus || npcViewReturn || selectedNpcId) return;
		const dx = controls.target.x - panOrigin.x, dy = controls.target.y - panOrigin.y, dz = controls.target.z - panOrigin.z, dist = Math.hypot(dx, dy, dz);
		if (!(dist > panRadius)) return;
		const scale = panRadius / dist, cx = panOrigin.x + dx * scale, cy = panOrigin.y + dy * scale, cz = panOrigin.z + dz * scale;
		camera.position.x += cx - controls.target.x;
		camera.position.y += cy - controls.target.y;
		camera.position.z += cz - controls.target.z;
		controls.target.set(cx, cy, cz);
	}
	function positionCamera(record) {
		controls.enableDamping = false;
		controls.update();
		controls.autoRotate = false;
		controls.enablePan = true;
		controls.zoomToCursor = false;
		controls.minZoom = .5;
		controls.maxZoom = 5;
		controls.minPolarAngle = record.id === "main" ? Math.PI / 4 : Math.PI / 3;
		controls.maxPolarAngle = record.id === "main" ? 5 * Math.PI / 12 : Math.PI / 3;
		if (record.id === "main") {
			camera.position.set(10.39, 44.82, 53.63);
			controls.target.set(-.19, 10.49, -4.74);
		} else {
			camera.position.copy(record.position);
			controls.target.copy(record.target);
		}
		panOrigin = (panOrigin || new THREE.Vector3()).copy(controls.target);
		panRadius = record.size ? Math.min(Math.min(record.size.x, record.size.z) / 2, PAN_RADIUS_MAX) : PAN_RADIUS_MAX;
		camera.zoom = record.id === "main" ? 1.24 : 1.55;
		camera.updateProjectionMatrix();
		controls.update();
		camera.updateMatrixWorld(true);
		controls.enableDamping = !motionReduced;
	}
	function invalidateNpc() {
		compiler?.cancel();
		try {
			Promise.resolve(npc.bind?.(null, null, latest || void 0)).catch(() => {
				counters.npcErrors++;
			});
		} catch {
			counters.npcErrors++;
		}
	}
	function cancelNavigation() {
		clearSelection();
		navigation?.cancel();
		invalidateNpc();
	}
	function projectEnvironment() {
		if (!environment || !latest) return;
		environment.setAutoTime?.(false);
		environment.setSeason(latest.environment.season);
		environment.setTime(latest.environment.hour);
		cinematic?.setTime(latest.environment.hour);
		cinematic?.setSceneScale(api.metrics.environment?.dofSceneScale || 1);
		try {
			npc.update?.(latest);
		} catch {
			counters.npcErrors++;
		}
	}
	function advanceNpcViewReturn(now) {
		const view = npcViewReturn;
		if (!view) return;
		if (view.epoch !== latest?.sessionEpoch || view.sceneId !== activeRecord?.id || !canDraw()) {
			clearSelection();
			return;
		}
		if (awaitingNpcMenuUnlock()) return;
		if (!interactive || latest.blockReasons.length) {
			clearSelection();
			return;
		}
		view.awaitingMenuUnlock = false;
		if (!advanceNpcCameraTween(camera, controls, view, now, motionReduced)) return;
		npcViewReturn = null;
		restoreNpcRoomCamera(camera, controls, activeRecord.target);
		fit();
		npc.tick?.(now, 0);
		syncInput();
	}
	function advanceNpcFocus(now) {
		const focus = npcFocus;
		if (!focus) return;
		if (focus.epoch !== latest?.sessionEpoch || focus.sceneId !== activeRecord?.id || !latest.renderedNpcs.some((n) => n.gameNpcId === focus.id) || latest.blockReasons.length) {
			clearSelection();
			return;
		}
		if (!advanceNpcCameraTween(camera, controls, focus, now, motionReduced)) return;
		const geometry = npc.getFocusGeometry?.(focus.id);
		if (geometry) frameNpcCamera(camera, controls, geometry);
		npc.tick?.(now, 0);
		const anchor = npc.getAnchor?.(focus.id) || focus.anchor;
		npcFocus = null;
		lastNpcAnchor = JSON.stringify(anchor);
		emit("npcIntent", {
			gameNpcId: focus.id,
			anchor: Object.freeze({ ...anchor })
		});
	}
	function emitNpcIntent(gameNpcId, anchor) {
		if (gameNpcId && typeof gameNpcId === "object") ({gameNpcId, anchor} = gameNpcId);
		if (!canInteract() || !latest.renderedNpcs.some((n) => n.gameNpcId === gameNpcId)) return false;
		if (anchor?.space !== "client-css-px" || ![
			"left",
			"top",
			"width",
			"height"
		].every((k) => Number.isFinite(anchor[k]))) return false;
		clearSelection();
		if (!npc.getFocusGeometry?.(gameNpcId)) {
			emit("npcIntent", {
				gameNpcId,
				anchor: Object.freeze({ ...anchor })
			});
			return true;
		}
		const fromPosition = camera.position.clone(), fromTarget = controls.target.clone(), fromZoom = camera.zoom;
		clearNpcCameraDamping(camera, controls);
		const geometry = npc.getFocusGeometry(gameNpcId);
		if (!geometry || !frameNpcCamera(camera, controls, geometry)) return false;
		selectedNpcId = gameNpcId;
		npc.setSelection?.(gameNpcId);
		npcFocus = {
			id: gameNpcId,
			epoch: latest.sessionEpoch,
			sceneId: activeRecord.id,
			anchor,
			fromPosition,
			fromTarget,
			fromZoom,
			position: camera.position.clone(),
			target: controls.target.clone(),
			zoom: camera.zoom
		};
		camera.position.copy(fromPosition);
		controls.target.copy(fromTarget);
		camera.zoom = fromZoom;
		camera.lookAt(controls.target);
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
		schedule();
		return true;
	}
	function installInput() {
		const canvas = renderer.domElement;
		const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
		listeners.listen(canvas, "pointerdown", (event) => {
			if (!canInteract()) return;
			pointers.add(event.pointerId);
			prefetch?.pause();
			if (pointers.size > 1 && gesture) gesture.multiple = true;
			if (pointers.size === 1) gesture = {
				id: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				time: event.timeStamp,
				button: event.button,
				moved: false,
				multiple: false
			};
		});
		listeners.listen(canvas, "pointermove", (event) => {
			if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.moved = true;
		});
		listeners.listen(canvas, "pointerup", (event) => {
			const press = gesture;
			pointers.delete(event.pointerId);
			if (!pointers.size) gesture = null;
			if (!canInteract() || !press || press.id !== event.pointerId || press.button !== 0 || press.moved || press.multiple || event.timeStamp - press.time > 700 || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) return;
			const rect = canvas.getBoundingClientRect();
			if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
			let npcHit;
			try {
				npcHit = npc.pick?.(event.clientX, event.clientY);
			} catch {
				counters.npcErrors++;
			}
			if (npcHit && emitNpcIntent(npcHit.gameNpcId, npcHit.anchor)) return;
			if (activeRecord?.id !== "main") return;
			pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
			raycaster.setFromCamera(pointer, camera);
			const hit = raycaster.intersectObject(activeRecord.root, true)[0];
			const locationId = hit && semanticLocation(hit.object);
			if (!locationId) {
				clearSelection();
				return;
			}
			selectLocation(locationId);
			const anchor = clientAnchor(hit.point.clone().project(camera), rect);
			if (anchor) emit("locationIntent", {
				locationId,
				anchor
			});
		});
		const cancel = (event) => {
			pointers.delete(event.pointerId);
			if (gesture) gesture.multiple = true;
			if (!pointers.size) gesture = null;
		};
		listeners.listen(canvas, "pointercancel", cancel);
		listeners.listen(canvas, "lostpointercapture", cancel);
		listeners.listen(canvas, "pointerleave", (event) => {
			if (!event.buttons) cancel(event);
		});
		listeners.listen(canvas, "webglcontextlost", (event) => {
			event.preventDefault();
			emitError(failure("CONTEXT_LOST", "WebGL context lost"));
			destroy();
		});
		listeners.listen(back, "click", () => {
			if (canInteract() && activeRecord.id !== "main") emit("returnIntent");
		});
		listeners.listen(reset, "click", resetView);
	}
	function releaseRecord(record) {
		if (!record || record.released) return;
		record.released = true;
		if (record.prepared && record.id !== "main") environment?.releaseInterior(record.root);
		for (const root of record.roots) registry.release(root);
	}
	function deactivate(record) {
		record.root.visible = false;
		if (activeRecord !== record) return;
		activeRecord = null;
		ready = false;
		hotspots?.clear();
		locationLabels?.clear();
		clearSelection();
		invalidateNpc();
		environment?.setInterior(null);
		stopFrames();
		syncInput();
	}
	async function loadModel(id, routeSignal) {
		prefetch?.pause();
		const controller = new AbortController(), signal = controller.signal;
		const abort = () => controller.abort(routeSignal.reason);
		routeSignal.addEventListener("abort", abort, { once: true });
		if (routeSignal.aborted) abort();
		const timeoutMs = id === "main" ? options.mainTimeoutMs ?? 3e4 : options.roomTimeoutMs ?? 6e4;
		let timedOut = false;
		const timer = win.setTimeout(() => {
			timedOut = true;
			controller.abort(failure("MODEL_TIMEOUT", "Model timeout"));
		}, timeoutMs);
		requests.add(controller);
		counters.pendingLoads++;
		counters.modelRequests++;
		let requestFinished = false;
		function finishRequest() {
			if (requestFinished) return;
			requestFinished = true;
			win.clearTimeout(timer);
			routeSignal.removeEventListener("abort", abort);
			requests.delete(controller);
			counters.pendingLoads--;
		}
		let draco, record;
		const work = (async () => {
			try {
				const url = new URL(id === "main" ? "sect_diorama.glb" : INTERIOR_SCENES[id].file, assetBaseUrl);
				let bytes = modelCache?.get(url.href);
				if (!bytes) {
					const response = await (options.fetch || win.fetch.bind(win))(url.href, { signal });
					if (!response.ok) throw failure("MODEL_HTTP", `Model HTTP ${response.status}`);
					bytes = await response.arrayBuffer();
					if (signal.aborted || destroyed) throw signal.reason || failure("CANCELLED", "Destroyed");
					modelCache?.put(url.href, bytes);
				}
				if (signal.aborted) throw signal.reason;
				const [, , { GLTFLoader }, { DRACOLoader }] = await importDependencies();
				if (signal.aborted) throw signal.reason;
				draco = new DRACOLoader().setDecoderPath(new URL("draco/", assetBaseUrl).href).setWorkerLimit(2);
				decoders.add(draco);
				const gltf = await new GLTFLoader().setDRACOLoader(draco).parseAsync(bytes, new URL(".", url).href);
				const root = gltf.scene, roots = [...new Set(gltf.scenes?.length ? gltf.scenes : [root])];
				for (const item of roots) registry.track(item);
				record = {
					id,
					root,
					roots,
					bytes: bytes.byteLength,
					prepared: false,
					released: false
				};
				if (signal.aborted || destroyed) throw signal.reason || failure("CANCELLED", "Destroyed");
				root.updateMatrixWorld(true);
				let meshes = 0;
				root.traverse((object) => {
					if (object.isMesh) {
						meshes++;
						const floor = object.userData.navigationOnly || object.userData.interactionId === "floor";
						object.castShadow = object.receiveShadow = quality !== "low" && !floor;
					}
				});
				const bounds = new THREE.Box3().setFromObject(root);
				if (!meshes || bounds.isEmpty()) throw failure("MODEL_EMPTY", "Model has no visible mesh");
				const size = bounds.getSize(new THREE.Vector3()), target = bounds.getCenter(new THREE.Vector3());
				const angle = (INTERIOR_SCENES[id]?.azimuth || 0) * Math.PI / 180;
				const position = target.clone().add(new THREE.Vector3(Math.sin(angle), 1, Math.cos(angle)).multiplyScalar(Math.max(size.x, size.z) * 1.8));
				Object.assign(record, {
					size,
					target,
					position,
					meshes
				});
				root.visible = false;
				return record;
			} catch (error) {
				releaseRecord(record);
				if (timedOut) throw failure("MODEL_TIMEOUT", "Model timeout");
				throw error?.code ? error : failure("MODEL_PARSE", "Model could not be decoded");
			} finally {
				finishRequest();
				if (draco) {
					decoders.delete(draco);
					draco.dispose();
				}
			}
		})();
		let cancelListener;
		const cancellation = new Promise((_, reject) => {
			cancelListener = () => reject(timedOut ? failure("MODEL_TIMEOUT", "Model timeout") : signal.reason || failure("CANCELLED", "Cancelled"));
			signal.addEventListener("abort", cancelListener, { once: true });
			if (signal.aborted) cancelListener();
		});
		try {
			return await Promise.race([work, cancellation]);
		} finally {
			signal.removeEventListener("abort", cancelListener);
			finishRequest();
		}
	}
	async function activate(record, valid) {
		if (!valid()) return;
		if (!record.prepared) {
			record.prepared = true;
			if (record.id === "main") environment.collect(record.root);
			else environment.prepareInterior(record.root, record.id);
		}
		if (!valid()) return;
		scene.add(record.root);
		record.root.visible = true;
		activeRecord = record;
		environment.setInterior(record.id === "main" ? null : record.root, record.id);
		if (atmosphere) atmosphere.enabled = record.id === "main" && settings.atmosphere;
		cinematic?.set("interior", Number(record.id !== "main"));
		positionCamera(record);
		fit();
		projectEnvironment();
		try {
			await npc.bind?.(record.root, record.id, latest);
		} catch {
			counters.npcErrors++;
		}
		if (!valid()) return;
		projectEnvironment();
		renderer.shadowMap.needsUpdate = true;
		let compiled;
		try {
			compiled = await compiler.compile(record.id === "main" ? scene : record.root, camera, valid, scene);
		} catch (error) {
			if (!valid()) return;
			if (!cinematic || qualityFallback) throw error;
			dropPostprocessing();
			resize();
			compiled = await compiler.compile(record.id === "main" ? scene : record.root, camera, valid, scene);
		}
		if (!valid()) return;
		if (!compiled) throw failure("COMPILE_CANCELLED", "Material lifetime changed during shader compilation");
		drawable = true;
		await firstFrame(valid);
		if (!valid()) return;
		ready = true;
		initializeFailure = null;
		hotspots?.bind(record.root, record.id);
		locationLabels?.setCounts(latest?.locationNpcCounts);
		locationLabels?.bind(record.root, record.id);
		if (record.id === "main" && canPrefetch()) prefetch?.start();
		const key = `${latest.sessionEpoch}:${record.id}:${navigation.generation}`;
		if (key !== readyKey) {
			readyKey = key;
			emit("ready", { sceneId: record.id });
		}
		schedule();
	}
	async function initialize() {
		if (initializing) return initializing;
		if (renderer) return;
		const serial = ++initializationSerial;
		initializing = (async () => {
			const [three, { OrbitControls }, , , { createEnvironment }, { createNpcController }] = await importDependencies();
			if (destroyed || serial !== initializationSerial || !visible) return;
			THREE = three;
			motionReduced = options.reducedMotion ?? Boolean(win.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
			shell = doc.createElement("div");
			shell.className = "scene3d-runtime";
			shell.dataset.scene3dInstance = String(instanceId);
			shell.hidden = true;
			renderer = new THREE.WebGLRenderer({
				antialias: true,
				alpha: true,
				powerPreference: quality === "low" ? "low-power" : "high-performance"
			});
			compiler = createCompileLifecycle(renderer, win);
			counters.rendererCreated++;
			renderer.setClearColor("#d5e2dd", 1);
			renderer.outputColorSpace = THREE.SRGBColorSpace;
			renderer.toneMapping = quality === "low" ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
			renderer.toneMappingExposure = quality === "low" ? 1.08 : 1;
			renderer.shadowMap.enabled = quality !== "low" && settings.shadows;
			renderer.shadowMap.type = THREE.PCFShadowMap;
			renderer.shadowMap.autoUpdate = false;
			renderer.setPixelRatio(pixelRatio());
			renderer.domElement.className = "scene3d-canvas";
			renderer.domElement.tabIndex = 0;
			renderer.domElement.setAttribute("aria-label", "门派3D场景：拖动环绕，双指或滚轮缩放，点击建筑查看信息");
			shell.appendChild(renderer.domElement);
			back = doc.createElement("button");
			back.className = "scene3d-back";
			back.type = "button";
			back.textContent = "返回地图";
			reset = doc.createElement("button");
			reset.className = "scene3d-reset";
			reset.type = "button";
			reset.setAttribute("aria-label", "镜头归位");
			reset.title = "镜头归位";
			reset.innerHTML = "<svg viewBox=\"0 0 24 24\" width=\"100%\" height=\"100%\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z\"/><path d=\"M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z\"/></svg>";
			shell.appendChild(back);
			shell.appendChild(reset);
			container.appendChild(shell);
			scene = new THREE.Scene();
			scene.fog = quality === "low" ? new THREE.Fog("#d5e2dd", 76, 160) : null;
			camera = new THREE.OrthographicCamera(-60, 60, 41, -41, .1, 420);
			camera.position.set(18, 53, 45);
			controls = new OrbitControls(camera, renderer.domElement);
			controls.enabled = false;
			controls.target.set(0, 7.5, -3);
			controls.autoRotate = false;
			controls.enableDamping = !motionReduced;
			controls.dampingFactor = .075;
			controls.rotateSpeed = .55;
			controls.zoomSpeed = .85;
			controls.panSpeed = .75;
			controls.addEventListener("change", clampPanTarget);
			const fill = new THREE.HemisphereLight("#dcebf4", "#8c8d82", 1.65), ambient = new THREE.AmbientLight("#efdfc9", .2);
			sun = new THREE.DirectionalLight("#ffdfb1", 3);
			sun.position.set(-32, 65, 38);
			sun.target.position.set(0, 4, -2);
			sun.castShadow = quality !== "low" && settings.shadows;
			Object.assign(sun.shadow.camera, {
				left: -42,
				right: 42,
				top: 42,
				bottom: -42,
				near: 1,
				far: 180
			});
			sun.shadow.camera.updateProjectionMatrix();
			sun.shadow.mapSize.set(2048, 2048);
			sun.shadow.normalBias = .035;
			sun.shadow.bias = -15e-5;
			sun.shadow.radius = 3;
			scene.add(fill, ambient, sun, sun.target);
			api.metrics.atmosphere = quality !== "low";
			environment = createEnvironment({
				scene,
				camera,
				renderer,
				sun,
				fill,
				ambient,
				api,
				reducedMotion: motionReduced,
				paperColor: options.paperColor || "#f6f0e0",
				exposureOverride: quality === "low" ? null : 1,
				volumeClouds: quality !== "low",
				onPaperColor: (color) => {
					cinematic?.setPaperColor(color);
					applyPaperFallback(color);
				},
				onTimeChange: (hour) => cinematic?.setTime(hour),
				onCloudHeight: (value) => atmosphere?.setHeight(value),
				onCloudSpeed: (value) => atmosphere?.setSpeed(value),
				onCloudMotion: (value) => atmosphere?.setMotion(value)
			});
			environment.setAutoTime?.(false);
			environment.setSkyEffects(settings.skyEffects);
			environment.setSkyBlend(settings.skyBlend);
			environment.setSkyAnalytic(settings.skyAnalytic);
			if (quality === "balanced") try {
				const [{ createCinematic }, { createAtmospherePass }] = await Promise.all([import("./chunks/cinematic-CCYpChE8.mjs"), import("./chunks/atmosphere-DcOL5AbX.mjs")]);
				if (destroyed || serial !== initializationSerial) return;
				cinematicFactory = createCinematic;
				atmosphere = createAtmospherePass(camera, sun);
				atmosphere.setStrength(settings.tuning.shaft);
				atmosphere.setHeight(4.4);
				atmosphere.setSpeed(api.environment.cloudSpeed);
				atmosphere.setMotion(api.environment.cloudMotion);
				cinematic = createCinematic(renderer, scene, camera, {
					atmosphere,
					msaa: settings.msaa,
					paperColor: options.paperColor || "#f6f0e0"
				});
				applyTuning();
				cinematic.setSelection(selectionObjects);
			} catch (error) {
				if (!destroyed) dropPostprocessing();
			}
			if (destroyed || serial !== initializationSerial) return;
			setNpcController((options.npcFactory || createNpcController)({
				scene,
				camera,
				renderer,
				assetBaseUrl,
				emitNpcIntent,
				container: shell,
				registry,
				isInteractionEnabled: canInteract,
				fetch: options.fetch,
				npcShadows: options.npcShadows
			}));
			hotspots = createHotspots({
				THREE,
				container: shell,
				camera,
				renderer,
				onAction: (sceneId, mesh, label) => emit("actionIntent", {
					sceneId,
					mesh,
					label
				})
			});
			locationLabels = createLocationLabels({
				THREE,
				container: shell,
				camera
			});
			locationLabels.setCounts(latest?.locationNpcCounts);
			navigation = createNavigation({
				load: loadModel,
				activate,
				deactivate,
				release: releaseRecord,
				onStart() {
					ready = false;
					drawable = false;
					appliedVersion = null;
					invalidateNpc();
					stopFrames();
					syncInput();
				},
				onError(error, id) {
					ready = false;
					initializeFailure = error;
					emitError(error, id);
					syncInput();
				}
			});
			if (quality === "balanced") {
				modelCache = createModelByteCache({ version: assetBaseUrl });
				const items = Object.values(INTERIOR_SCENES).map((descriptor) => {
					const url = new URL(descriptor.file, assetBaseUrl).href;
					return {
						key: url,
						url
					};
				});
				prefetch = createModelBytePrefetcher({
					cache: modelCache,
					items,
					fetch: options.fetch || win.fetch.bind(win),
					AbortController: win.AbortController,
					clock: win,
					shouldRun: canPrefetch
				});
			}
			installInput();
			listeners.listen(doc, "visibilitychange", () => {
				if (doc.hidden) {
					cancelNavigation();
					ready = false;
					wakeWaiters();
				} else if (visible && latest) applyState(latest);
				schedule();
			});
			listeners.listen(win, "pagehide", () => {
				destroy();
			});
			if (win.ResizeObserver) {
				observer = new win.ResizeObserver(resize);
				observer.observe(container);
			} else listeners.listen(win, "resize", resize);
			resize();
			projectEnvironment();
		})().catch((error) => {
			if (!destroyed) {
				initializeFailure = error;
				cleanupGraphics();
				throw error;
			}
		}).finally(() => {
			initializing = null;
		});
		return initializing;
	}
	async function applyState(input) {
		if (destroyed) return applyResult("destroyed", latest || input);
		const snapshot = normalizeSnapshot(input);
		if (latest && compareVersion(snapshot, latest) < 0) return applyResult("superseded", snapshot);
		if (latest && (latest.sessionEpoch !== snapshot.sessionEpoch || latest.sceneId !== snapshot.sceneId)) {
			cancelNavigation();
			ready = false;
			drawable = false;
			appliedVersion = null;
		}
		latest = snapshot;
		locationLabels?.setCounts(snapshot.locationNpcCounts);
		visible = snapshot.visible && snapshot.mode === 0 && Boolean(snapshot.sceneId);
		renderEnabled = snapshot.renderEnabled;
		interactive = snapshot.interactive;
		if (npcFocus && (!renderEnabled || !interactive || snapshot.blockReasons.length) || npcViewReturn && (!renderEnabled || (!interactive || snapshot.blockReasons.length) && !awaitingNpcMenuUnlock()) || selectedNpcId && !snapshot.renderedNpcs.some((n) => n.gameNpcId === selectedNpcId)) clearSelection();
		wakeWaiters();
		schedule();
		if (!visible || !snapshot.sceneId) {
			cancelNavigation();
			ready = false;
			appliedVersion = null;
			wakeWaiters();
			schedule();
			return applyResult("superseded", snapshot);
		}
		if (initializeFailure && !renderer) return applyResult("degraded", snapshot);
		try {
			await initialize();
			if (destroyed) return applyResult("destroyed", snapshot);
			if (!latest || compareVersion(snapshot, latest) !== 0) return applyResult("superseded", snapshot);
			if (!visible || !navigation) return applyResult("superseded", snapshot);
			projectEnvironment();
			syncInput();
			const status = await navigation.navigate(snapshot.sceneId, snapshot.sessionEpoch);
			if (destroyed) return applyResult("destroyed", snapshot);
			if (compareVersion(snapshot, latest) !== 0) return applyResult("superseded", snapshot);
			if (status === "applied") {
				appliedVersion = `${snapshot.sessionEpoch}:${snapshot.revision}`;
				ready = true;
				projectEnvironment();
			}
			schedule();
			return applyResult(status, snapshot);
		} catch (error) {
			if (destroyed) return applyResult("destroyed", snapshot);
			if (compareVersion(snapshot, latest) !== 0) return applyResult("superseded", snapshot);
			initializeFailure = error;
			ready = false;
			emitError(error);
			syncInput();
			return applyResult("degraded", snapshot);
		}
	}
	function setVisible(value) {
		if (destroyed) return;
		visible = Boolean(value);
		if (!visible) {
			cancelNavigation();
			ready = false;
			appliedVersion = null;
			wakeWaiters();
		}
		syncInput();
		schedule();
	}
	function setRenderEnabled(value) {
		if (!destroyed) {
			renderEnabled = Boolean(value);
			if (!renderEnabled && (npcFocus || npcViewReturn)) clearSelection();
			wakeWaiters();
			schedule();
		}
	}
	function setInteractionEnabled(value) {
		if (!destroyed) {
			interactive = Boolean(value);
			if (!interactive && (npcFocus || npcViewReturn && !awaitingNpcMenuUnlock())) clearSelection();
			syncInput();
		}
	}
	function setNpcController(controller) {
		if (destroyed) {
			controller?.dispose?.();
			return false;
		}
		if (!controller || typeof controller !== "object") throw new TypeError("NPC controller must be an object");
		compiler?.cancel();
		try {
			npc.dispose?.();
		} catch {
			counters.npcErrors++;
		}
		npc = controller;
		lastNpcStats = null;
		if (activeRecord) try {
			Promise.resolve(npc.bind?.(activeRecord.root, activeRecord.id, latest)).catch(() => {
				counters.npcErrors++;
			});
			npc.update?.(latest);
		} catch {
			counters.npcErrors++;
		}
		return true;
	}
	async function retry() {
		if (destroyed) return applyResult("destroyed", latest);
		if (!latest) throw new Error("Apply a snapshot before retry");
		counters.attempts++;
		initializeFailure = null;
		appliedVersion = null;
		readyKey = null;
		cancelNavigation();
		wakeWaiters();
		if (navigation) {
			const snapshot = latest;
			if (!visible) return applyResult("superseded", snapshot);
			projectEnvironment();
			const status = await navigation.navigate(snapshot.sceneId, snapshot.sessionEpoch, { force: true });
			if (destroyed) return applyResult("destroyed", snapshot);
			if (compareVersion(snapshot, latest) !== 0) return applyResult("superseded", snapshot);
			if (status === "applied") appliedVersion = `${snapshot.sessionEpoch}:${snapshot.revision}`;
			schedule();
			return applyResult(status, snapshot);
		}
		return applyState(latest);
	}
	function getNpcStats() {
		try {
			return npc.getStats ? diagnosticSnapshot(npc.getStats()) : lastNpcStats;
		} catch {
			return null;
		}
	}
	function cleanupGraphics() {
		compiler?.dispose();
		lastCompileStats = compiler?.snapshot() || lastCompileStats;
		compiler = null;
		stopFrames();
		wakeWaiters();
		observer?.disconnect();
		observer = null;
		listeners.dispose();
		controls?.dispose();
		controls = null;
		hotspots?.dispose();
		hotspots = null;
		locationLabels?.dispose();
		locationLabels = null;
		prefetch?.dispose();
		lastPrefetchStats = prefetch?.getStats() || lastPrefetchStats;
		prefetch = null;
		modelCache?.clear();
		modelCache = null;
		for (const request of requests) request.abort();
		for (const decoder of decoders) decoder.dispose();
		decoders.clear();
		try {
			npc.dispose?.();
		} catch {
			counters.npcErrors++;
		}
		lastNpcStats = getNpcStats();
		npc = noopNpc();
		environment?.dispose();
		environment = null;
		navigation?.dispose();
		navigation = null;
		activeRecord = null;
		cinematic?.dispose();
		atmosphere?.dispose();
		cinematic = atmosphere = null;
		registry.dispose();
		sun?.dispose();
		sun = null;
		if (renderer) {
			renderer.dispose();
			renderer.forceContextLoss?.();
			renderer.domElement.remove();
			renderer = null;
			counters.rendererDisposed++;
		}
		scene?.clear();
		scene = camera = null;
		shell?.remove();
		shell = back = reset = null;
	}
	function destroy() {
		if (destroyPromise) return destroyPromise;
		destroyed = true;
		visible = renderEnabled = interactive = ready = false;
		initializationSerial++;
		cancelNavigation();
		stopFrames();
		wakeWaiters();
		flushGestures();
		cleanupGraphics();
		instances.delete(container);
		destroyPromise = Promise.resolve();
		return destroyPromise;
	}
	function getDiagnostics() {
		return Object.freeze({
			instanceId,
			destroyed,
			ready,
			visible,
			renderEnabled,
			interactionEnabled: canInteract(),
			phase: destroyed ? "destroyed" : initializeFailure ? "degraded" : ready ? "ready" : navigation?.busy || initializing ? "loading" : "idle",
			epoch: latest?.sessionEpoch ?? null,
			revision: latest?.revision ?? null,
			sceneId: latest?.sceneId ?? null,
			activeSceneId: activeRecord?.id ?? null,
			appliedVersion,
			quality,
			qualityFallback,
			dpr: renderer?.getPixelRatio() ?? 0,
			width,
			height,
			drawingWidth: renderer?.domElement.width ?? 0,
			drawingHeight: renderer?.domElement.height ?? 0,
			raf: Number(Boolean(raf)),
			listeners: listeners.size,
			controls: Number(Boolean(controls)),
			observers: Number(Boolean(observer)),
			renderers: Number(Boolean(renderer)),
			canvases: Number(Boolean(renderer?.domElement.parentNode)),
			decoders: decoders.size,
			fetches: requests.size,
			...counters,
			...registry.snapshot(),
			...navigation?.snapshot() || {
				routeGeneration: 0,
				pending: 0,
				cachedMain: 0,
				cachedRooms: 0
			},
			environmentResources: environment ? Object.freeze({
				preparedInteriors: api.metrics.environment?.preparedInteriors || 0,
				exteriorMaterials: api.metrics.environment?.exteriorMaterials || 0,
				interiorMaterials: api.metrics.environment?.interiorMaterials || 0,
				backgroundDraws: api.metrics.environment?.backgroundDraws || 0
			}) : null,
			postprocessing: Number(Boolean(cinematic)),
			atmosphere: Number(Boolean(atmosphere)),
			npc: getNpcStats(),
			compilation: compiler?.snapshot() || lastCompileStats,
			hotspots: diagnosticSnapshot(hotspots?.getStats() || {
				count: 0,
				visible: false
			}),
			locationLabels: diagnosticSnapshot(locationLabels?.getStats() || {
				count: 0,
				visible: false
			}),
			selectedNpcId,
			focusingNpc: Boolean(npcFocus),
			returningNpcView: Boolean(npcViewReturn),
			modelByteCache: diagnosticSnapshot(modelCache?.getStats() || {
				entries: 0,
				bytes: 0
			}),
			prefetch: diagnosticSnapshot(prefetch?.getStats() || lastPrefetchStats || {
				pending: 0,
				timers: 0
			}),
			cameraView: camera ? Object.freeze({
				position: Object.freeze(camera.position.toArray()),
				target: Object.freeze(controls.target.toArray()),
				offset: Object.freeze(camera.position.clone().sub(controls.target).toArray()),
				distance: camera.position.distanceTo(controls.target),
				roomTarget: activeRecord?.target ? Object.freeze(activeRecord.target.toArray()) : null,
				zoom: camera.zoom,
				minPolarAngle: controls.minPolarAngle,
				maxPolarAngle: controls.maxPolarAngle,
				enablePan: controls.enablePan,
				panRadius,
				panOrigin: panOrigin ? Object.freeze(panOrigin.toArray()) : null
			}) : null,
			renderTuning: diagnosticSnapshot(cinematic?.getStats?.() || null),
			environmentState: diagnosticSnapshot(api.metrics.environment || null),
			renderSettings: Object.freeze({
				renderScale: settings.renderScale,
				msaa: settings.msaa,
				shadows: settings.shadows,
				atmosphere: settings.atmosphere,
				skyEffects: settings.skyEffects,
				skyBlend: settings.skyBlend,
				skyAnalytic: settings.skyAnalytic,
				tuning: Object.freeze({ ...settings.tuning }),
				selectedObjects: selectionObjects.length
			})
		});
	}
	const handle = {
		applyState,
		setVisible,
		setRenderEnabled,
		setInteractionEnabled,
		resize,
		retry,
		destroy,
		resetView,
		setNpcController,
		setSettings,
		clearSelection,
		setNpcShadows(value) {
			if (destroyed || typeof value !== "boolean") return false;
			options.npcShadows = value;
			npc.setNpcShadows?.(value);
			return true;
		},
		getDiagnostics,
		getDebugState: getDiagnostics
	};
	if (options.debug) Object.defineProperty(handle, "debug", {
		enumerable: true,
		get: getDiagnostics
	});
	Object.freeze(handle);
	instances.set(container, handle);
	return handle;
}
//#endregion
export { LOCATION_TO_SCENE, PROTOCOL, SCENE_TO_LOCATION, mount };
