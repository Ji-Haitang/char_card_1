//#region scene3d/src/interior-scenes.js
var scenes = {
	library: {
		label: "藏经阁",
		file: "sub_scene/library_interior.glb",
		azimuth: 38
	},
	council: {
		label: "议事厅",
		file: "sub_scene/council_hall.glb",
		azimuth: 38
	},
	alchemy: {
		label: "丹房",
		file: "sub_scene/alchemy_room.glb",
		azimuth: 38
	},
	kitchen: {
		label: "伙房",
		file: "sub_scene/kitchen_room.glb",
		azimuth: -34
	},
	male_quarters: {
		label: "男弟子房",
		file: "sub_scene/male_quarters.glb",
		azimuth: -38
	},
	female_quarters: {
		label: "女弟子房",
		file: "sub_scene/female_quarters.glb",
		azimuth: Math.atan2(-11, 15) * 180 / Math.PI
	},
	guest_quarters: {
		label: "厢房",
		file: "sub_scene/guest_quarters.glb",
		azimuth: Math.atan2(-11, 15) * 180 / Math.PI,
		chapter: "听雨篇",
		lightLabel: "厢房窗灯"
	},
	forge: {
		label: "铁匠铺",
		file: "sub_scene/blacksmith.glb",
		azimuth: Math.atan2(11, 16) * 180 / Math.PI,
		kind: "outdoor",
		environment: "landscape",
		chapter: "工坊篇",
		lightLabel: "工坊炉灯"
	},
	back_mountain: {
		label: "后山",
		file: "sub_scene/back_mountain.glb",
		azimuth: Math.atan2(20, 28) * 180 / Math.PI,
		kind: "outdoor",
		environment: "landscape",
		entry: "入山",
		chapter: "后山篇",
		lightLabel: "洞口石灯"
	},
	gate: {
		label: "山门",
		file: "sub_scene/gate.glb",
		azimuth: Math.atan2(12, 26) * 180 / Math.PI,
		kind: "outdoor",
		environment: "landscape",
		entry: "访门",
		chapter: "山门篇",
		lightLabel: "山门灯火"
	},
	training: {
		label: "演武场",
		file: "sub_scene/training.glb",
		azimuth: Math.atan2(15, 29) * 180 / Math.PI,
		kind: "outdoor",
		environment: "landscape",
		entry: "入场",
		chapter: "演武篇",
		lightLabel: "演武场灯火"
	},
	fields: {
		label: "公田",
		file: "sub_scene/fields.glb",
		azimuth: Math.atan2(12, 24) * 180 / Math.PI,
		kind: "outdoor",
		environment: "landscape",
		entry: "入田",
		chapter: "农桑篇",
		lightLabel: "田边石灯"
	}
};
var INTERIOR_SCENES = Object.freeze(Object.fromEntries(Object.entries(scenes).map(([id, descriptor]) => [id, Object.freeze({
	...descriptor,
	inspect: true,
	npcPreview: "silhouette",
	returnLabel: "返回主场景"
})])));
//#endregion
export { INTERIOR_SCENES as t };
