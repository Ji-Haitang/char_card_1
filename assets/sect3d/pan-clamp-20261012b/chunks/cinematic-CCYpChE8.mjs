import { a as calculateDofRanges, i as SUBSCENE_TILT_SHIFT, r as RENDER_DEFAULTS, t as DEFAULT_PAPER_COLOR } from "./render-defaults-BmDJN6tp.mjs";
import { Color, ColorManagement, DepthTexture, HalfFloatType, LinearFilter, MathUtils, Matrix4, MeshBasicMaterial, MeshDepthMaterial, RGBADepthPacking, RawShaderMaterial, ShaderMaterial, Timer, UniformsUtils, UnsignedIntType, Vector2, Vector3, Vector4, WebGLRenderTarget } from "./three.module-DEUH6-St.mjs";
import { n as Pass, t as FullScreenQuad } from "./Pass-2joK0Utu.mjs";
//#region scene3d/node_modules/three/examples/jsm/shaders/CopyShader.js
/**
* @module CopyShader
* @three_import import { CopyShader } from 'three/addons/shaders/CopyShader.js';
*/
/**
* Full-screen copy shader pass.
*
* @constant
* @type {ShaderMaterial~Shader}
*/
var CopyShader = {
	name: "CopyShader",
	uniforms: {
		"tDiffuse": { value: null },
		"opacity": { value: 1 }
	},
	vertexShader: `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
	fragmentShader: `

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;


		}`
};
//#endregion
//#region scene3d/node_modules/three/examples/jsm/postprocessing/ShaderPass.js
/**
* This pass can be used to create a post processing effect
* with a raw GLSL shader object. Useful for implementing custom
* effects.
*
* ```js
* const fxaaPass = new ShaderPass( FXAAShader );
* composer.addPass( fxaaPass );
* ```
*
* @augments Pass
* @three_import import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
*/
var ShaderPass = class extends Pass {
	/**
	* Constructs a new shader pass.
	*
	* @param {Object|ShaderMaterial} [shader] - A shader object holding vertex and fragment shader as well as
	* defines and uniforms. It's also valid to pass a custom shader material.
	* @param {string} [textureID='tDiffuse'] - The name of the texture uniform that should sample
	* the read buffer.
	*/
	constructor(shader, textureID = "tDiffuse") {
		super();
		/**
		* The name of the texture uniform that should sample the read buffer.
		*
		* @type {string}
		* @default 'tDiffuse'
		*/
		this.textureID = textureID;
		/**
		* The pass uniforms.
		*
		* @type {?Object}
		*/
		this.uniforms = null;
		/**
		* The pass material.
		*
		* @type {?ShaderMaterial}
		*/
		this.material = null;
		if (shader instanceof ShaderMaterial) {
			this.uniforms = shader.uniforms;
			this.material = shader;
		} else if (shader) {
			this.uniforms = UniformsUtils.clone(shader.uniforms);
			this.material = new ShaderMaterial({
				name: shader.name !== void 0 ? shader.name : "unspecified",
				defines: Object.assign({}, shader.defines),
				uniforms: this.uniforms,
				vertexShader: shader.vertexShader,
				fragmentShader: shader.fragmentShader
			});
		}
		this._fsQuad = new FullScreenQuad(this.material);
	}
	/**
	* Performs the shader pass.
	*
	* @param {WebGLRenderer} renderer - The renderer.
	* @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
	* destination for the pass.
	* @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
	* previous pass from this buffer.
	* @param {number} deltaTime - The delta time in seconds.
	* @param {boolean} maskActive - Whether masking is active or not.
	*/
	render(renderer, writeBuffer, readBuffer) {
		if (this.uniforms[this.textureID]) this.uniforms[this.textureID].value = readBuffer.texture;
		this._fsQuad.material = this.material;
		if (this.renderToScreen) {
			renderer.setRenderTarget(null);
			this._fsQuad.render(renderer);
		} else {
			renderer.setRenderTarget(writeBuffer);
			if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
			this._fsQuad.render(renderer);
		}
	}
	/**
	* Frees the GPU-related resources allocated by this instance. Call this
	* method whenever the pass is no longer used in your app.
	*/
	dispose() {
		this.material.dispose();
		this._fsQuad.dispose();
	}
};
//#endregion
//#region scene3d/node_modules/three/examples/jsm/postprocessing/MaskPass.js
/**
* This pass can be used to define a mask during post processing.
* Meaning only areas of subsequent post processing are affected
* which lie in the masking area of this pass. Internally, the masking
* is implemented with the stencil buffer.
*
* ```js
* const maskPass = new MaskPass( scene, camera );
* composer.addPass( maskPass );
* ```
*
* @augments Pass
* @three_import import { MaskPass } from 'three/addons/postprocessing/MaskPass.js';
*/
var MaskPass = class extends Pass {
	/**
	* Constructs a new mask pass.
	*
	* @param {Scene} scene - The 3D objects in this scene will define the mask.
	* @param {Camera} camera - The camera.
	*/
	constructor(scene, camera) {
		super();
		/**
		* The scene that defines the mask.
		*
		* @type {Scene}
		*/
		this.scene = scene;
		/**
		* The camera.
		*
		* @type {Camera}
		*/
		this.camera = camera;
		/**
		* Overwritten to perform a clear operation by default.
		*
		* @type {boolean}
		* @default true
		*/
		this.clear = true;
		/**
		* Overwritten to disable the swap.
		*
		* @type {boolean}
		* @default false
		*/
		this.needsSwap = false;
		/**
		* Whether to inverse the mask or not.
		*
		* @type {boolean}
		* @default false
		*/
		this.inverse = false;
	}
	/**
	* Performs a mask pass with the configured scene and camera.
	*
	* @param {WebGLRenderer} renderer - The renderer.
	* @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
	* destination for the pass.
	* @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
	* previous pass from this buffer.
	* @param {number} deltaTime - The delta time in seconds.
	* @param {boolean} maskActive - Whether masking is active or not.
	*/
	render(renderer, writeBuffer, readBuffer) {
		const context = renderer.getContext();
		const state = renderer.state;
		state.buffers.color.setMask(false);
		state.buffers.depth.setMask(false);
		state.buffers.color.setLocked(true);
		state.buffers.depth.setLocked(true);
		let writeValue, clearValue;
		if (this.inverse) {
			writeValue = 0;
			clearValue = 1;
		} else {
			writeValue = 1;
			clearValue = 0;
		}
		state.buffers.stencil.setTest(true);
		state.buffers.stencil.setOp(context.REPLACE, context.REPLACE, context.REPLACE);
		state.buffers.stencil.setFunc(context.ALWAYS, writeValue, 4294967295);
		state.buffers.stencil.setClear(clearValue);
		state.buffers.stencil.setLocked(true);
		renderer.setRenderTarget(readBuffer);
		if (this.clear) renderer.clear();
		renderer.render(this.scene, this.camera);
		renderer.setRenderTarget(writeBuffer);
		if (this.clear) renderer.clear();
		renderer.render(this.scene, this.camera);
		state.buffers.color.setLocked(false);
		state.buffers.depth.setLocked(false);
		state.buffers.color.setMask(true);
		state.buffers.depth.setMask(true);
		state.buffers.stencil.setLocked(false);
		state.buffers.stencil.setFunc(context.EQUAL, 1, 4294967295);
		state.buffers.stencil.setOp(context.KEEP, context.KEEP, context.KEEP);
		state.buffers.stencil.setLocked(true);
	}
};
/**
* This pass can be used to clear a mask previously defined with {@link MaskPass}.
*
* ```js
* const clearPass = new ClearMaskPass();
* composer.addPass( clearPass );
* ```
*
* @augments Pass
*/
var ClearMaskPass = class extends Pass {
	/**
	* Constructs a new clear mask pass.
	*/
	constructor() {
		super();
		/**
		* Overwritten to disable the swap.
		*
		* @type {boolean}
		* @default false
		*/
		this.needsSwap = false;
	}
	/**
	* Performs the clear of the currently defined mask.
	*
	* @param {WebGLRenderer} renderer - The renderer.
	* @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
	* destination for the pass.
	* @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
	* previous pass from this buffer.
	* @param {number} deltaTime - The delta time in seconds.
	* @param {boolean} maskActive - Whether masking is active or not.
	*/
	render(renderer) {
		renderer.state.buffers.stencil.setLocked(false);
		renderer.state.buffers.stencil.setTest(false);
	}
};
//#endregion
//#region scene3d/node_modules/three/examples/jsm/postprocessing/EffectComposer.js
/**
* Used to implement post-processing effects in three.js.
* The class manages a chain of post-processing passes to produce the final visual result.
* Post-processing passes are executed in order of their addition/insertion.
* The last pass is automatically rendered to screen.
*
* This module can only be used with {@link WebGLRenderer}.
*
* ```js
* const composer = new EffectComposer( renderer );
*
* // adding some passes
* const renderPass = new RenderPass( scene, camera );
* composer.addPass( renderPass );
*
* const glitchPass = new GlitchPass();
* composer.addPass( glitchPass );
*
* const outputPass = new OutputPass()
* composer.addPass( outputPass );
*
* function animate() {
*
* 	composer.render(); // instead of renderer.render()
*
* }
* ```
*
* @three_import import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
*/
var EffectComposer = class {
	/**
	* Constructs a new effect composer.
	*
	* @param {WebGLRenderer} renderer - The renderer.
	* @param {WebGLRenderTarget} [renderTarget] - This render target and a clone will
	* be used as the internal read and write buffers. If not given, the composer creates
	* the buffers automatically.
	*/
	constructor(renderer, renderTarget) {
		/**
		* The renderer.
		*
		* @type {WebGLRenderer}
		*/
		this.renderer = renderer;
		this._pixelRatio = renderer.getPixelRatio();
		if (renderTarget === void 0) {
			const size = renderer.getSize(new Vector2());
			this._width = size.width;
			this._height = size.height;
			renderTarget = new WebGLRenderTarget(this._width * this._pixelRatio, this._height * this._pixelRatio, { type: HalfFloatType });
			renderTarget.texture.name = "EffectComposer.rt1";
		} else {
			this._width = renderTarget.width;
			this._height = renderTarget.height;
		}
		this.renderTarget1 = renderTarget;
		this.renderTarget2 = renderTarget.clone();
		this.renderTarget2.texture.name = "EffectComposer.rt2";
		/**
		* A reference to the internal write buffer. Passes usually write
		* their result into this buffer.
		*
		* @type {WebGLRenderTarget}
		*/
		this.writeBuffer = this.renderTarget1;
		/**
		* A reference to the internal read buffer. Passes usually read
		* the previous render result from this buffer.
		*
		* @type {WebGLRenderTarget}
		*/
		this.readBuffer = this.renderTarget2;
		/**
		* Whether the final pass is rendered to the screen (default framebuffer) or not.
		*
		* @type {boolean}
		* @default true
		*/
		this.renderToScreen = true;
		/**
		* An array representing the (ordered) chain of post-processing passes.
		*
		* @type {Array<Pass>}
		*/
		this.passes = [];
		/**
		* A copy pass used for internal swap operations.
		*
		* @private
		* @type {ShaderPass}
		*/
		this.copyPass = new ShaderPass(CopyShader);
		this.copyPass.material.blending = 0;
		/**
		* The internal timer for managing time data.
		*
		* @private
		* @type {Timer}
		*/
		this.timer = new Timer();
	}
	/**
	* Swaps the internal read/write buffers.
	*/
	swapBuffers() {
		const tmp = this.readBuffer;
		this.readBuffer = this.writeBuffer;
		this.writeBuffer = tmp;
	}
	/**
	* Adds the given pass to the pass chain.
	*
	* @param {Pass} pass - The pass to add.
	*/
	addPass(pass) {
		this.passes.push(pass);
		pass.setSize(this._width * this._pixelRatio, this._height * this._pixelRatio);
	}
	/**
	* Inserts the given pass at a given index.
	*
	* @param {Pass} pass - The pass to insert.
	* @param {number} index - The index into the pass chain.
	*/
	insertPass(pass, index) {
		this.passes.splice(index, 0, pass);
		pass.setSize(this._width * this._pixelRatio, this._height * this._pixelRatio);
	}
	/**
	* Removes the given pass from the pass chain.
	*
	* @param {Pass} pass - The pass to remove.
	*/
	removePass(pass) {
		const index = this.passes.indexOf(pass);
		if (index !== -1) this.passes.splice(index, 1);
	}
	/**
	* Returns `true` if the pass for the given index is the last enabled pass in the pass chain.
	*
	* @param {number} passIndex - The pass index.
	* @return {boolean} Whether the pass for the given index is the last pass in the pass chain.
	*/
	isLastEnabledPass(passIndex) {
		for (let i = passIndex + 1; i < this.passes.length; i++) if (this.passes[i].enabled) return false;
		return true;
	}
	/**
	* Executes all enabled post-processing passes in order to produce the final frame.
	*
	* @param {number} deltaTime - The delta time in seconds. If not given, the composer computes
	* its own time delta value.
	*/
	render(deltaTime) {
		this.timer.update();
		if (deltaTime === void 0) deltaTime = this.timer.getDelta();
		const currentRenderTarget = this.renderer.getRenderTarget();
		let maskActive = false;
		for (let i = 0, il = this.passes.length; i < il; i++) {
			const pass = this.passes[i];
			if (pass.enabled === false) continue;
			pass.renderToScreen = this.renderToScreen && this.isLastEnabledPass(i);
			pass.render(this.renderer, this.writeBuffer, this.readBuffer, deltaTime, maskActive);
			if (pass.needsSwap) {
				if (maskActive) {
					const context = this.renderer.getContext();
					const stencil = this.renderer.state.buffers.stencil;
					stencil.setFunc(context.NOTEQUAL, 1, 4294967295);
					this.copyPass.render(this.renderer, this.writeBuffer, this.readBuffer, deltaTime);
					stencil.setFunc(context.EQUAL, 1, 4294967295);
				}
				this.swapBuffers();
			}
			if (MaskPass !== void 0) {
				if (pass instanceof MaskPass) maskActive = true;
				else if (pass instanceof ClearMaskPass) maskActive = false;
			}
		}
		this.renderer.setRenderTarget(currentRenderTarget);
	}
	/**
	* Resets the internal state of the EffectComposer.
	*
	* @param {WebGLRenderTarget} [renderTarget] - This render target has the same purpose like
	* the one from the constructor. If set, it is used to setup the read and write buffers.
	*/
	reset(renderTarget) {
		if (renderTarget === void 0) {
			const size = this.renderer.getSize(new Vector2());
			this._pixelRatio = this.renderer.getPixelRatio();
			this._width = size.width;
			this._height = size.height;
			renderTarget = this.renderTarget1.clone();
			renderTarget.setSize(this._width * this._pixelRatio, this._height * this._pixelRatio);
		}
		this.renderTarget1.dispose();
		this.renderTarget2.dispose();
		this.renderTarget1 = renderTarget;
		this.renderTarget2 = renderTarget.clone();
		this.writeBuffer = this.renderTarget1;
		this.readBuffer = this.renderTarget2;
	}
	/**
	* Resizes the internal read and write buffers as well as all passes. Similar to {@link WebGLRenderer#setSize},
	* this method honors the current pixel ration.
	*
	* @param {number} width - The width in logical pixels.
	* @param {number} height - The height in logical pixels.
	*/
	setSize(width, height) {
		this._width = width;
		this._height = height;
		const effectiveWidth = this._width * this._pixelRatio;
		const effectiveHeight = this._height * this._pixelRatio;
		this.renderTarget1.setSize(effectiveWidth, effectiveHeight);
		this.renderTarget2.setSize(effectiveWidth, effectiveHeight);
		for (let i = 0; i < this.passes.length; i++) this.passes[i].setSize(effectiveWidth, effectiveHeight);
	}
	/**
	* Sets device pixel ratio. This is usually used for HiDPI device to prevent blurring output.
	* Setting the pixel ratio will automatically resize the composer.
	*
	* @param {number} pixelRatio - The pixel ratio to set.
	*/
	setPixelRatio(pixelRatio) {
		this._pixelRatio = pixelRatio;
		this.setSize(this._width, this._height);
	}
	/**
	* Frees the GPU-related resources allocated by this instance. Call this
	* method whenever the composer is no longer used in your app.
	*/
	dispose() {
		this.renderTarget1.dispose();
		this.renderTarget2.dispose();
		this.copyPass.dispose();
	}
};
//#endregion
//#region scene3d/node_modules/three/examples/jsm/postprocessing/RenderPass.js
/**
* This class represents a render pass. It takes a camera and a scene and produces
* a beauty pass for subsequent post processing effects.
*
* ```js
* const renderPass = new RenderPass( scene, camera );
* composer.addPass( renderPass );
* ```
*
* @augments Pass
* @three_import import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
*/
var RenderPass = class extends Pass {
	/**
	* Constructs a new render pass.
	*
	* @param {Scene} scene - The scene to render.
	* @param {Camera} camera - The camera.
	* @param {?Material} [overrideMaterial=null] - The override material. If set, this material is used
	* for all objects in the scene.
	* @param {?(number|Color|string)} [clearColor=null] - The clear color of the render pass.
	* @param {?number} [clearAlpha=null] - The clear alpha of the render pass.
	*/
	constructor(scene, camera, overrideMaterial = null, clearColor = null, clearAlpha = null) {
		super();
		/**
		* The scene to render.
		*
		* @type {Scene}
		*/
		this.scene = scene;
		/**
		* The camera.
		*
		* @type {Camera}
		*/
		this.camera = camera;
		/**
		* The override material. If set, this material is used
		* for all objects in the scene.
		*
		* @type {?Material}
		* @default null
		*/
		this.overrideMaterial = overrideMaterial;
		/**
		* The clear color of the render pass.
		*
		* @type {?(number|Color|string)}
		* @default null
		*/
		this.clearColor = clearColor;
		/**
		* The clear alpha of the render pass.
		*
		* @type {?number}
		* @default null
		*/
		this.clearAlpha = clearAlpha;
		/**
		* Overwritten to perform a clear operation by default.
		*
		* @type {boolean}
		* @default true
		*/
		this.clear = true;
		/**
		* If set to `true`, only the depth can be cleared when `clear` is to `false`.
		*
		* @type {boolean}
		* @default false
		*/
		this.clearDepth = false;
		/**
		* Overwritten to disable the swap.
		*
		* @type {boolean}
		* @default false
		*/
		this.needsSwap = false;
		/**
		* This flag indicates that this pass renders the scene itself.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isRenderPass = true;
		this._oldClearColor = new Color();
	}
	/**
	* Performs a beauty pass with the configured scene and camera.
	*
	* @param {WebGLRenderer} renderer - The renderer.
	* @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
	* destination for the pass.
	* @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
	* previous pass from this buffer.
	* @param {number} deltaTime - The delta time in seconds.
	* @param {boolean} maskActive - Whether masking is active or not.
	*/
	render(renderer, writeBuffer, readBuffer) {
		const oldAutoClear = renderer.autoClear;
		renderer.autoClear = false;
		let oldClearAlpha, oldOverrideMaterial;
		if (this.overrideMaterial !== null) {
			oldOverrideMaterial = this.scene.overrideMaterial;
			this.scene.overrideMaterial = this.overrideMaterial;
		}
		if (this.clearColor !== null) {
			renderer.getClearColor(this._oldClearColor);
			renderer.setClearColor(this.clearColor, renderer.getClearAlpha());
		}
		if (this.clearAlpha !== null) {
			oldClearAlpha = renderer.getClearAlpha();
			renderer.setClearAlpha(this.clearAlpha);
		}
		if (this.clearDepth == true) renderer.clearDepth();
		renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
		if (this.clear === true) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
		renderer.render(this.scene, this.camera);
		if (this.clearColor !== null) renderer.setClearColor(this._oldClearColor);
		if (this.clearAlpha !== null) renderer.setClearAlpha(oldClearAlpha);
		if (this.overrideMaterial !== null) this.scene.overrideMaterial = oldOverrideMaterial;
		renderer.autoClear = oldAutoClear;
	}
};
//#endregion
//#region scene3d/node_modules/three/examples/jsm/shaders/LuminosityHighPassShader.js
/**
* @module LuminosityHighPassShader
* @three_import import { LuminosityHighPassShader } from 'three/addons/shaders/LuminosityHighPassShader.js';
*/
/**
* Luminosity high pass shader.
*
* @constant
* @type {ShaderMaterial~Shader}
*/
var LuminosityHighPassShader = {
	name: "LuminosityHighPassShader",
	uniforms: {
		"tDiffuse": { value: null },
		"luminosityThreshold": { value: 1 },
		"smoothWidth": { value: 1 },
		"defaultColor": { value: new Color(0) },
		"defaultOpacity": { value: 0 }
	},
	vertexShader: `

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
	fragmentShader: `

		uniform sampler2D tDiffuse;
		uniform vec3 defaultColor;
		uniform float defaultOpacity;
		uniform float luminosityThreshold;
		uniform float smoothWidth;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );

			float v = luminance( texel.xyz );

			vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );

			float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );

			gl_FragColor = mix( outputColor, texel, alpha );

		}`
};
//#endregion
//#region scene3d/node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js
/**
* This pass is inspired by the bloom pass of Unreal Engine. It creates a
* mip map chain of bloom textures and blurs them with different radii. Because
* of the weighted combination of mips, and because larger blurs are done on
* higher mips, this effect provides good quality and performance.
*
* When using this pass, tone mapping must be enabled in the renderer settings.
*
* Reference:
* - [Bloom in Unreal Engine](https://docs.unrealengine.com/latest/INT/Engine/Rendering/PostProcessEffects/Bloom/)
*
* ```js
* const resolution = new THREE.Vector2( window.innerWidth, window.innerHeight );
* const bloomPass = new UnrealBloomPass( resolution, 1.5, 0.4, 0.85 );
* composer.addPass( bloomPass );
* ```
*
* @augments Pass
* @three_import import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
*/
var UnrealBloomPass = class UnrealBloomPass extends Pass {
	/**
	* Constructs a new Unreal Bloom pass.
	*
	* @param {Vector2} [resolution] - The effect's resolution.
	* @param {number} [strength=1] - The Bloom strength.
	* @param {number} radius - The Bloom radius.
	* @param {number} threshold - The luminance threshold limits which bright areas contribute to the Bloom effect.
	*/
	constructor(resolution, strength = 1, radius, threshold) {
		super();
		/**
		* The Bloom strength.
		*
		* @type {number}
		* @default 1
		*/
		this.strength = strength;
		/**
		* The Bloom radius. Must be in the range `[0,1]`.
		*
		* @type {number}
		*/
		this.radius = radius;
		/**
		* The luminance threshold limits which bright areas contribute to the Bloom effect.
		*
		* @type {number}
		*/
		this.threshold = threshold;
		/**
		* The effect's resolution.
		*
		* @type {Vector2}
		* @default (256,256)
		*/
		this.resolution = resolution !== void 0 ? new Vector2(resolution.x, resolution.y) : new Vector2(256, 256);
		/**
		* The effect's clear color
		*
		* @type {Color}
		* @default (0,0,0)
		*/
		this.clearColor = new Color(0, 0, 0);
		/**
		* Overwritten to disable the swap.
		*
		* @type {boolean}
		* @default false
		*/
		this.needsSwap = false;
		this.renderTargetsHorizontal = [];
		this.renderTargetsVertical = [];
		this.nMips = 5;
		let resx = Math.round(this.resolution.x / 2);
		let resy = Math.round(this.resolution.y / 2);
		this.renderTargetBright = new WebGLRenderTarget(resx, resy, { type: HalfFloatType });
		this.renderTargetBright.texture.name = "UnrealBloomPass.bright";
		this.renderTargetBright.texture.generateMipmaps = false;
		for (let i = 0; i < this.nMips; i++) {
			const renderTargetHorizontal = new WebGLRenderTarget(resx, resy, { type: HalfFloatType });
			renderTargetHorizontal.texture.name = "UnrealBloomPass.h" + i;
			renderTargetHorizontal.texture.generateMipmaps = false;
			this.renderTargetsHorizontal.push(renderTargetHorizontal);
			const renderTargetVertical = new WebGLRenderTarget(resx, resy, { type: HalfFloatType });
			renderTargetVertical.texture.name = "UnrealBloomPass.v" + i;
			renderTargetVertical.texture.generateMipmaps = false;
			this.renderTargetsVertical.push(renderTargetVertical);
			resx = Math.round(resx / 2);
			resy = Math.round(resy / 2);
		}
		const highPassShader = LuminosityHighPassShader;
		this.highPassUniforms = UniformsUtils.clone(highPassShader.uniforms);
		this.highPassUniforms["luminosityThreshold"].value = threshold;
		this.highPassUniforms["smoothWidth"].value = .01;
		this.materialHighPassFilter = new ShaderMaterial({
			uniforms: this.highPassUniforms,
			vertexShader: highPassShader.vertexShader,
			fragmentShader: highPassShader.fragmentShader
		});
		this.separableBlurMaterials = [];
		const kernelSizeArray = [
			6,
			10,
			14,
			18,
			22
		];
		resx = Math.round(this.resolution.x / 2);
		resy = Math.round(this.resolution.y / 2);
		for (let i = 0; i < this.nMips; i++) {
			this.separableBlurMaterials.push(this._getSeparableBlurMaterial(kernelSizeArray[i]));
			this.separableBlurMaterials[i].uniforms["invSize"].value = new Vector2(1 / resx, 1 / resy);
			resx = Math.round(resx / 2);
			resy = Math.round(resy / 2);
		}
		this.compositeMaterial = this._getCompositeMaterial(this.nMips);
		this.compositeMaterial.uniforms["blurTexture1"].value = this.renderTargetsVertical[0].texture;
		this.compositeMaterial.uniforms["blurTexture2"].value = this.renderTargetsVertical[1].texture;
		this.compositeMaterial.uniforms["blurTexture3"].value = this.renderTargetsVertical[2].texture;
		this.compositeMaterial.uniforms["blurTexture4"].value = this.renderTargetsVertical[3].texture;
		this.compositeMaterial.uniforms["blurTexture5"].value = this.renderTargetsVertical[4].texture;
		this.compositeMaterial.uniforms["bloomStrength"].value = strength;
		this.compositeMaterial.uniforms["bloomRadius"].value = .1;
		const bloomFactors = [
			1,
			.8,
			.6,
			.4,
			.2
		];
		this.compositeMaterial.uniforms["bloomFactors"].value = bloomFactors;
		this.bloomTintColors = [
			new Vector3(1, 1, 1),
			new Vector3(1, 1, 1),
			new Vector3(1, 1, 1),
			new Vector3(1, 1, 1),
			new Vector3(1, 1, 1)
		];
		this.compositeMaterial.uniforms["bloomTintColors"].value = this.bloomTintColors;
		this.copyUniforms = UniformsUtils.clone(CopyShader.uniforms);
		this.blendMaterial = new ShaderMaterial({
			uniforms: this.copyUniforms,
			vertexShader: CopyShader.vertexShader,
			fragmentShader: CopyShader.fragmentShader,
			premultipliedAlpha: true,
			blending: 2,
			depthTest: false,
			depthWrite: false,
			transparent: true
		});
		this._oldClearColor = new Color();
		this._oldClearAlpha = 1;
		this._basic = new MeshBasicMaterial();
		this._fsQuad = new FullScreenQuad(null);
	}
	/**
	* Frees the GPU-related resources allocated by this instance. Call this
	* method whenever the pass is no longer used in your app.
	*/
	dispose() {
		for (let i = 0; i < this.renderTargetsHorizontal.length; i++) this.renderTargetsHorizontal[i].dispose();
		for (let i = 0; i < this.renderTargetsVertical.length; i++) this.renderTargetsVertical[i].dispose();
		this.renderTargetBright.dispose();
		for (let i = 0; i < this.separableBlurMaterials.length; i++) this.separableBlurMaterials[i].dispose();
		this.compositeMaterial.dispose();
		this.blendMaterial.dispose();
		this._basic.dispose();
		this._fsQuad.dispose();
	}
	/**
	* Sets the size of the pass.
	*
	* @param {number} width - The width to set.
	* @param {number} height - The height to set.
	*/
	setSize(width, height) {
		let resx = Math.round(width / 2);
		let resy = Math.round(height / 2);
		this.renderTargetBright.setSize(resx, resy);
		for (let i = 0; i < this.nMips; i++) {
			this.renderTargetsHorizontal[i].setSize(resx, resy);
			this.renderTargetsVertical[i].setSize(resx, resy);
			this.separableBlurMaterials[i].uniforms["invSize"].value = new Vector2(1 / resx, 1 / resy);
			resx = Math.round(resx / 2);
			resy = Math.round(resy / 2);
		}
	}
	/**
	* Performs the Bloom pass.
	*
	* @param {WebGLRenderer} renderer - The renderer.
	* @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
	* destination for the pass.
	* @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
	* previous pass from this buffer.
	* @param {number} deltaTime - The delta time in seconds.
	* @param {boolean} maskActive - Whether masking is active or not.
	*/
	render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
		renderer.getClearColor(this._oldClearColor);
		this._oldClearAlpha = renderer.getClearAlpha();
		const oldAutoClear = renderer.autoClear;
		renderer.autoClear = false;
		renderer.setClearColor(this.clearColor, 0);
		if (maskActive) renderer.state.buffers.stencil.setTest(false);
		if (this.renderToScreen) {
			this._fsQuad.material = this._basic;
			this._basic.map = readBuffer.texture;
			renderer.setRenderTarget(null);
			renderer.clear();
			this._fsQuad.render(renderer);
		}
		this.highPassUniforms["tDiffuse"].value = readBuffer.texture;
		this.highPassUniforms["luminosityThreshold"].value = this.threshold;
		this._fsQuad.material = this.materialHighPassFilter;
		renderer.setRenderTarget(this.renderTargetBright);
		renderer.clear();
		this._fsQuad.render(renderer);
		let inputRenderTarget = this.renderTargetBright;
		for (let i = 0; i < this.nMips; i++) {
			this._fsQuad.material = this.separableBlurMaterials[i];
			this.separableBlurMaterials[i].uniforms["colorTexture"].value = inputRenderTarget.texture;
			this.separableBlurMaterials[i].uniforms["direction"].value = UnrealBloomPass.BlurDirectionX;
			renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
			renderer.clear();
			this._fsQuad.render(renderer);
			this.separableBlurMaterials[i].uniforms["colorTexture"].value = this.renderTargetsHorizontal[i].texture;
			this.separableBlurMaterials[i].uniforms["direction"].value = UnrealBloomPass.BlurDirectionY;
			renderer.setRenderTarget(this.renderTargetsVertical[i]);
			renderer.clear();
			this._fsQuad.render(renderer);
			inputRenderTarget = this.renderTargetsVertical[i];
		}
		this._fsQuad.material = this.compositeMaterial;
		this.compositeMaterial.uniforms["bloomStrength"].value = this.strength;
		this.compositeMaterial.uniforms["bloomRadius"].value = this.radius;
		this.compositeMaterial.uniforms["bloomTintColors"].value = this.bloomTintColors;
		renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
		renderer.clear();
		this._fsQuad.render(renderer);
		this._fsQuad.material = this.blendMaterial;
		this.copyUniforms["tDiffuse"].value = this.renderTargetsHorizontal[0].texture;
		if (maskActive) renderer.state.buffers.stencil.setTest(true);
		if (this.renderToScreen) {
			renderer.setRenderTarget(null);
			this._fsQuad.render(renderer);
		} else {
			renderer.setRenderTarget(readBuffer);
			this._fsQuad.render(renderer);
		}
		renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
		renderer.autoClear = oldAutoClear;
	}
	_getSeparableBlurMaterial(kernelRadius) {
		const coefficients = [];
		const sigma = kernelRadius / 3;
		for (let i = 0; i < kernelRadius; i++) coefficients.push(.39894 * Math.exp(-.5 * i * i / (sigma * sigma)) / sigma);
		return new ShaderMaterial({
			defines: { "KERNEL_RADIUS": kernelRadius },
			uniforms: {
				"colorTexture": { value: null },
				"invSize": { value: new Vector2(.5, .5) },
				"direction": { value: new Vector2(.5, .5) },
				"gaussianCoefficients": { value: coefficients }
			},
			vertexShader: `

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,
			fragmentShader: `

				#include <common>

				varying vec2 vUv;

				uniform sampler2D colorTexture;
				uniform vec2 invSize;
				uniform vec2 direction;
				uniform float gaussianCoefficients[KERNEL_RADIUS];

				void main() {

					float weightSum = gaussianCoefficients[0];
					vec3 diffuseSum = texture2D( colorTexture, vUv ).rgb * weightSum;

					for ( int i = 1; i < KERNEL_RADIUS; i ++ ) {

						float x = float( i );
						float w = gaussianCoefficients[i];
						vec2 uvOffset = direction * invSize * x;
						vec3 sample1 = texture2D( colorTexture, vUv + uvOffset ).rgb;
						vec3 sample2 = texture2D( colorTexture, vUv - uvOffset ).rgb;
						diffuseSum += ( sample1 + sample2 ) * w;

					}

					gl_FragColor = vec4( diffuseSum, 1.0 );

				}`
		});
	}
	_getCompositeMaterial(nMips) {
		return new ShaderMaterial({
			defines: { "NUM_MIPS": nMips },
			uniforms: {
				"blurTexture1": { value: null },
				"blurTexture2": { value: null },
				"blurTexture3": { value: null },
				"blurTexture4": { value: null },
				"blurTexture5": { value: null },
				"bloomStrength": { value: 1 },
				"bloomFactors": { value: null },
				"bloomTintColors": { value: null },
				"bloomRadius": { value: 0 }
			},
			vertexShader: `

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,
			fragmentShader: `

				varying vec2 vUv;

				uniform sampler2D blurTexture1;
				uniform sampler2D blurTexture2;
				uniform sampler2D blurTexture3;
				uniform sampler2D blurTexture4;
				uniform sampler2D blurTexture5;
				uniform float bloomStrength;
				uniform float bloomRadius;
				uniform float bloomFactors[NUM_MIPS];
				uniform vec3 bloomTintColors[NUM_MIPS];

				float lerpBloomFactor( const in float factor ) {

					float mirrorFactor = 1.2 - factor;
					return mix( factor, mirrorFactor, bloomRadius );

				}

				void main() {

					// 3.0 for backwards compatibility with previous alpha-based intensity
					vec3 bloom = 3.0 * bloomStrength * (
						lerpBloomFactor( bloomFactors[ 0 ] ) * bloomTintColors[ 0 ] * texture2D( blurTexture1, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 1 ] ) * bloomTintColors[ 1 ] * texture2D( blurTexture2, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 2 ] ) * bloomTintColors[ 2 ] * texture2D( blurTexture3, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 3 ] ) * bloomTintColors[ 3 ] * texture2D( blurTexture4, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 4 ] ) * bloomTintColors[ 4 ] * texture2D( blurTexture5, vUv ).rgb
					);

					float bloomAlpha = max( bloom.r, max( bloom.g, bloom.b ) );
					gl_FragColor = vec4( bloom, bloomAlpha );

				}`
		});
	}
};
UnrealBloomPass.BlurDirectionX = new Vector2(1, 0);
UnrealBloomPass.BlurDirectionY = new Vector2(0, 1);
//#endregion
//#region scene3d/node_modules/three/examples/jsm/shaders/OutputShader.js
/**
* @module OutputShader
* @three_import import { OutputShader } from 'three/addons/shaders/OutputShader.js';
*/
/**
* Performs tone mapping and color space conversion for
* FX workflows.
*
* Used by {@link OutputPass}.
*
* @constant
* @type {ShaderMaterial~Shader}
*/
var OutputShader = {
	name: "OutputShader",
	uniforms: {
		"tDiffuse": { value: null },
		"toneMappingExposure": { value: 1 }
	},
	vertexShader: `
		precision highp float;

		uniform mat4 modelViewMatrix;
		uniform mat4 projectionMatrix;

		attribute vec3 position;
		attribute vec2 uv;

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
	fragmentShader: `

		precision highp float;

		uniform sampler2D tDiffuse;

		#include <tonemapping_pars_fragment>
		#include <colorspace_pars_fragment>

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			// tone mapping

			#ifdef LINEAR_TONE_MAPPING

				gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

			#elif defined( REINHARD_TONE_MAPPING )

				gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

			#elif defined( CINEON_TONE_MAPPING )

				gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

			#elif defined( ACES_FILMIC_TONE_MAPPING )

				gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

			#elif defined( AGX_TONE_MAPPING )

				gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

			#elif defined( NEUTRAL_TONE_MAPPING )

				gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

			#elif defined( CUSTOM_TONE_MAPPING )

				gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );

			#endif

			// color space

			#ifdef SRGB_TRANSFER

				gl_FragColor = sRGBTransferOETF( gl_FragColor );

			#endif

		}`
};
//#endregion
//#region scene3d/node_modules/three/examples/jsm/postprocessing/OutputPass.js
/**
* This pass is responsible for including tone mapping and color space conversion
* into your pass chain. In most cases, this pass should be included at the end
* of each pass chain. If a pass requires sRGB input (e.g. like FXAA), the pass
* must follow `OutputPass` in the pass chain.
*
* The tone mapping and color space settings are extracted from the renderer.
*
* ```js
* const outputPass = new OutputPass();
* composer.addPass( outputPass );
* ```
*
* @augments Pass
* @three_import import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
*/
var OutputPass = class extends Pass {
	/**
	* Constructs a new output pass.
	*/
	constructor() {
		super();
		/**
		* This flag indicates that this is an output pass.
		*
		* @type {boolean}
		* @readonly
		* @default true
		*/
		this.isOutputPass = true;
		/**
		* The pass uniforms.
		*
		* @type {Object}
		*/
		this.uniforms = UniformsUtils.clone(OutputShader.uniforms);
		/**
		* The pass material.
		*
		* @type {RawShaderMaterial}
		*/
		this.material = new RawShaderMaterial({
			name: OutputShader.name,
			uniforms: this.uniforms,
			vertexShader: OutputShader.vertexShader,
			fragmentShader: OutputShader.fragmentShader
		});
		this._fsQuad = new FullScreenQuad(this.material);
		this._outputColorSpace = null;
		this._toneMapping = null;
	}
	/**
	* Performs the output pass.
	*
	* @param {WebGLRenderer} renderer - The renderer.
	* @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
	* destination for the pass.
	* @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
	* previous pass from this buffer.
	* @param {number} deltaTime - The delta time in seconds.
	* @param {boolean} maskActive - Whether masking is active or not.
	*/
	render(renderer, writeBuffer, readBuffer) {
		this.uniforms["tDiffuse"].value = readBuffer.texture;
		this.uniforms["toneMappingExposure"].value = renderer.toneMappingExposure;
		if (this._outputColorSpace !== renderer.outputColorSpace || this._toneMapping !== renderer.toneMapping) {
			this._outputColorSpace = renderer.outputColorSpace;
			this._toneMapping = renderer.toneMapping;
			this.material.defines = {};
			if (ColorManagement.getTransfer(this._outputColorSpace) === "srgb") this.material.defines.SRGB_TRANSFER = "";
			if (this._toneMapping === 1) this.material.defines.LINEAR_TONE_MAPPING = "";
			else if (this._toneMapping === 2) this.material.defines.REINHARD_TONE_MAPPING = "";
			else if (this._toneMapping === 3) this.material.defines.CINEON_TONE_MAPPING = "";
			else if (this._toneMapping === 4) this.material.defines.ACES_FILMIC_TONE_MAPPING = "";
			else if (this._toneMapping === 6) this.material.defines.AGX_TONE_MAPPING = "";
			else if (this._toneMapping === 7) this.material.defines.NEUTRAL_TONE_MAPPING = "";
			else if (this._toneMapping === 5) this.material.defines.CUSTOM_TONE_MAPPING = "";
			this.material.needsUpdate = true;
		}
		if (this.renderToScreen === true) {
			renderer.setRenderTarget(null);
			this._fsQuad.render(renderer);
		} else {
			renderer.setRenderTarget(writeBuffer);
			if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
			this._fsQuad.render(renderer);
		}
	}
	/**
	* Frees the GPU-related resources allocated by this instance. Call this
	* method whenever the pass is no longer used in your app.
	*/
	dispose() {
		this.material.dispose();
		this._fsQuad.dispose();
	}
};
//#endregion
//#region scene3d/node_modules/three/examples/jsm/postprocessing/OutlinePass.js
/**
* A pass for rendering outlines around selected objects.
*
* ```js
* const resolution = new THREE.Vector2( window.innerWidth, window.innerHeight );
* const outlinePass = new OutlinePass( resolution, scene, camera );
* composer.addPass( outlinePass );
* ```
*
* @augments Pass
* @three_import import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
*/
var OutlinePass = class OutlinePass extends Pass {
	/**
	* Constructs a new outline pass.
	*
	* @param {Vector2} [resolution] - The effect's resolution.
	* @param {Scene} scene - The scene to render.
	* @param {Camera} camera - The camera.
	* @param {Array<Object3D>} [selectedObjects] - The selected 3D objects that should receive an outline.
	*
	*/
	constructor(resolution, scene, camera, selectedObjects) {
		super();
		/**
		* The scene to render.
		*
		* @type {Object}
		*/
		this.renderScene = scene;
		/**
		* The camera.
		*
		* @type {Object}
		*/
		this.renderCamera = camera;
		/**
		* The selected 3D objects that should receive an outline.
		*
		* @type {Array<Object3D>}
		*/
		this.selectedObjects = selectedObjects !== void 0 ? selectedObjects : [];
		/**
		* The visible edge color.
		*
		* @type {Color}
		* @default (1,1,1)
		*/
		this.visibleEdgeColor = new Color(1, 1, 1);
		/**
		* The hidden edge color.
		*
		* @type {Color}
		* @default (0.1,0.04,0.02)
		*/
		this.hiddenEdgeColor = new Color(.1, .04, .02);
		/**
		* Can be used for an animated glow/pulse effect.
		*
		* @type {number}
		* @default 0
		*/
		this.edgeGlow = 0;
		/**
		* Whether to use a pattern texture for to highlight selected
		* 3D objects or not.
		*
		* @type {boolean}
		* @default false
		*/
		this.usePatternTexture = false;
		/**
		* Can be used to highlight selected 3D objects. Requires to set
		* {@link OutlinePass#usePatternTexture} to `true`.
		*
		* @type {?Texture}
		* @default null
		*/
		this.patternTexture = null;
		/**
		* The edge thickness.
		*
		* @type {number}
		* @default 1
		*/
		this.edgeThickness = 1;
		/**
		* The edge strength.
		*
		* @type {number}
		* @default 3
		*/
		this.edgeStrength = 3;
		/**
		* The downsample ratio. The effect can be rendered in a much
		* lower resolution than the beauty pass.
		*
		* @type {number}
		* @default 2
		*/
		this.downSampleRatio = 2;
		/**
		* The pulse period.
		*
		* @type {number}
		* @default 0
		*/
		this.pulsePeriod = 0;
		this._visibilityCache = /* @__PURE__ */ new Map();
		this._selectionCache = /* @__PURE__ */ new Set();
		/**
		* The effect's resolution.
		*
		* @type {Vector2}
		* @default (256,256)
		*/
		this.resolution = resolution !== void 0 ? new Vector2(resolution.x, resolution.y) : new Vector2(256, 256);
		const resx = Math.round(this.resolution.x / this.downSampleRatio);
		const resy = Math.round(this.resolution.y / this.downSampleRatio);
		this.renderTargetMaskBuffer = new WebGLRenderTarget(this.resolution.x, this.resolution.y);
		this.renderTargetMaskBuffer.texture.name = "OutlinePass.mask";
		this.renderTargetMaskBuffer.texture.generateMipmaps = false;
		this.depthMaterial = new MeshDepthMaterial();
		this.depthMaterial.side = 2;
		this.depthMaterial.depthPacking = RGBADepthPacking;
		this.depthMaterial.blending = 0;
		this.prepareMaskMaterial = this._getPrepareMaskMaterial();
		this.prepareMaskMaterial.side = 2;
		this.prepareMaskMaterial.fragmentShader = replaceDepthToViewZ(this.prepareMaskMaterial.fragmentShader, this.renderCamera);
		this.renderTargetDepthBuffer = new WebGLRenderTarget(this.resolution.x, this.resolution.y, { type: HalfFloatType });
		this.renderTargetDepthBuffer.texture.name = "OutlinePass.depth";
		this.renderTargetDepthBuffer.texture.generateMipmaps = false;
		this.renderTargetMaskDownSampleBuffer = new WebGLRenderTarget(resx, resy, { type: HalfFloatType });
		this.renderTargetMaskDownSampleBuffer.texture.name = "OutlinePass.depthDownSample";
		this.renderTargetMaskDownSampleBuffer.texture.generateMipmaps = false;
		this.renderTargetBlurBuffer1 = new WebGLRenderTarget(resx, resy, { type: HalfFloatType });
		this.renderTargetBlurBuffer1.texture.name = "OutlinePass.blur1";
		this.renderTargetBlurBuffer1.texture.generateMipmaps = false;
		this.renderTargetBlurBuffer2 = new WebGLRenderTarget(Math.round(resx / 2), Math.round(resy / 2), { type: HalfFloatType });
		this.renderTargetBlurBuffer2.texture.name = "OutlinePass.blur2";
		this.renderTargetBlurBuffer2.texture.generateMipmaps = false;
		this.edgeDetectionMaterial = this._getEdgeDetectionMaterial();
		this.renderTargetEdgeBuffer1 = new WebGLRenderTarget(resx, resy, { type: HalfFloatType });
		this.renderTargetEdgeBuffer1.texture.name = "OutlinePass.edge1";
		this.renderTargetEdgeBuffer1.texture.generateMipmaps = false;
		this.renderTargetEdgeBuffer2 = new WebGLRenderTarget(Math.round(resx / 2), Math.round(resy / 2), { type: HalfFloatType });
		this.renderTargetEdgeBuffer2.texture.name = "OutlinePass.edge2";
		this.renderTargetEdgeBuffer2.texture.generateMipmaps = false;
		const MAX_EDGE_THICKNESS = 4;
		const MAX_EDGE_GLOW = 4;
		this.separableBlurMaterial1 = this._getSeparableBlurMaterial(MAX_EDGE_THICKNESS);
		this.separableBlurMaterial1.uniforms["texSize"].value.set(resx, resy);
		this.separableBlurMaterial1.uniforms["kernelRadius"].value = 1;
		this.separableBlurMaterial2 = this._getSeparableBlurMaterial(MAX_EDGE_GLOW);
		this.separableBlurMaterial2.uniforms["texSize"].value.set(Math.round(resx / 2), Math.round(resy / 2));
		this.separableBlurMaterial2.uniforms["kernelRadius"].value = MAX_EDGE_GLOW;
		this.overlayMaterial = this._getOverlayMaterial();
		const copyShader = CopyShader;
		this.copyUniforms = UniformsUtils.clone(copyShader.uniforms);
		this.materialCopy = new ShaderMaterial({
			uniforms: this.copyUniforms,
			vertexShader: copyShader.vertexShader,
			fragmentShader: copyShader.fragmentShader,
			blending: 0,
			depthTest: false,
			depthWrite: false
		});
		this.enabled = true;
		this.needsSwap = false;
		this._oldClearColor = new Color();
		this.oldClearAlpha = 1;
		this._fsQuad = new FullScreenQuad(null);
		this.tempPulseColor1 = new Color();
		this.tempPulseColor2 = new Color();
		this.textureMatrix = new Matrix4();
		function replaceDepthToViewZ(string, camera) {
			const type = camera.isPerspectiveCamera ? "perspective" : "orthographic";
			return string.replace(/DEPTH_TO_VIEW_Z/g, type + "DepthToViewZ");
		}
	}
	/**
	* Frees the GPU-related resources allocated by this instance. Call this
	* method whenever the pass is no longer used in your app.
	*/
	dispose() {
		this.renderTargetMaskBuffer.dispose();
		this.renderTargetDepthBuffer.dispose();
		this.renderTargetMaskDownSampleBuffer.dispose();
		this.renderTargetBlurBuffer1.dispose();
		this.renderTargetBlurBuffer2.dispose();
		this.renderTargetEdgeBuffer1.dispose();
		this.renderTargetEdgeBuffer2.dispose();
		this.depthMaterial.dispose();
		this.prepareMaskMaterial.dispose();
		this.edgeDetectionMaterial.dispose();
		this.separableBlurMaterial1.dispose();
		this.separableBlurMaterial2.dispose();
		this.overlayMaterial.dispose();
		this.materialCopy.dispose();
		this._fsQuad.dispose();
	}
	/**
	* Sets the size of the pass.
	*
	* @param {number} width - The width to set.
	* @param {number} height - The height to set.
	*/
	setSize(width, height) {
		this.renderTargetMaskBuffer.setSize(width, height);
		this.renderTargetDepthBuffer.setSize(width, height);
		let resx = Math.round(width / this.downSampleRatio);
		let resy = Math.round(height / this.downSampleRatio);
		this.renderTargetMaskDownSampleBuffer.setSize(resx, resy);
		this.renderTargetBlurBuffer1.setSize(resx, resy);
		this.renderTargetEdgeBuffer1.setSize(resx, resy);
		this.separableBlurMaterial1.uniforms["texSize"].value.set(resx, resy);
		resx = Math.round(resx / 2);
		resy = Math.round(resy / 2);
		this.renderTargetBlurBuffer2.setSize(resx, resy);
		this.renderTargetEdgeBuffer2.setSize(resx, resy);
		this.separableBlurMaterial2.uniforms["texSize"].value.set(resx, resy);
	}
	/**
	* Performs the Outline pass.
	*
	* @param {WebGLRenderer} renderer - The renderer.
	* @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
	* destination for the pass.
	* @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
	* previous pass from this buffer.
	* @param {number} deltaTime - The delta time in seconds.
	* @param {boolean} maskActive - Whether masking is active or not.
	*/
	render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
		if (this.selectedObjects.length > 0) {
			renderer.getClearColor(this._oldClearColor);
			this.oldClearAlpha = renderer.getClearAlpha();
			const oldAutoClear = renderer.autoClear;
			renderer.autoClear = false;
			if (maskActive) renderer.state.buffers.stencil.setTest(false);
			renderer.setClearColor(16777215, 1);
			this._updateSelectionCache();
			this._changeVisibilityOfSelectedObjects(false);
			const currentBackground = this.renderScene.background;
			const currentOverrideMaterial = this.renderScene.overrideMaterial;
			this.renderScene.background = null;
			this.renderScene.overrideMaterial = this.depthMaterial;
			renderer.setRenderTarget(this.renderTargetDepthBuffer);
			renderer.clear();
			renderer.render(this.renderScene, this.renderCamera);
			this._changeVisibilityOfSelectedObjects(true);
			this._visibilityCache.clear();
			this._updateTextureMatrix();
			this._changeVisibilityOfNonSelectedObjects(false);
			this.renderScene.overrideMaterial = this.prepareMaskMaterial;
			this.prepareMaskMaterial.uniforms["cameraNearFar"].value.set(this.renderCamera.near, this.renderCamera.far);
			this.prepareMaskMaterial.uniforms["depthTexture"].value = this.renderTargetDepthBuffer.texture;
			this.prepareMaskMaterial.uniforms["textureMatrix"].value = this.textureMatrix;
			renderer.setRenderTarget(this.renderTargetMaskBuffer);
			renderer.clear();
			renderer.render(this.renderScene, this.renderCamera);
			this._changeVisibilityOfNonSelectedObjects(true);
			this._visibilityCache.clear();
			this._selectionCache.clear();
			this.renderScene.background = currentBackground;
			this.renderScene.overrideMaterial = currentOverrideMaterial;
			this._fsQuad.material = this.materialCopy;
			this.copyUniforms["tDiffuse"].value = this.renderTargetMaskBuffer.texture;
			renderer.setRenderTarget(this.renderTargetMaskDownSampleBuffer);
			renderer.clear();
			this._fsQuad.render(renderer);
			this.tempPulseColor1.copy(this.visibleEdgeColor);
			this.tempPulseColor2.copy(this.hiddenEdgeColor);
			if (this.pulsePeriod > 0) {
				const scalar = 1.25 / 2 + Math.cos(performance.now() * .01 / this.pulsePeriod) * .75 / 2;
				this.tempPulseColor1.multiplyScalar(scalar);
				this.tempPulseColor2.multiplyScalar(scalar);
			}
			this._fsQuad.material = this.edgeDetectionMaterial;
			this.edgeDetectionMaterial.uniforms["maskTexture"].value = this.renderTargetMaskDownSampleBuffer.texture;
			this.edgeDetectionMaterial.uniforms["texSize"].value.set(this.renderTargetMaskDownSampleBuffer.width, this.renderTargetMaskDownSampleBuffer.height);
			this.edgeDetectionMaterial.uniforms["visibleEdgeColor"].value = this.tempPulseColor1;
			this.edgeDetectionMaterial.uniforms["hiddenEdgeColor"].value = this.tempPulseColor2;
			renderer.setRenderTarget(this.renderTargetEdgeBuffer1);
			renderer.clear();
			this._fsQuad.render(renderer);
			this._fsQuad.material = this.separableBlurMaterial1;
			this.separableBlurMaterial1.uniforms["colorTexture"].value = this.renderTargetEdgeBuffer1.texture;
			this.separableBlurMaterial1.uniforms["direction"].value = OutlinePass.BlurDirectionX;
			this.separableBlurMaterial1.uniforms["kernelRadius"].value = this.edgeThickness;
			renderer.setRenderTarget(this.renderTargetBlurBuffer1);
			renderer.clear();
			this._fsQuad.render(renderer);
			this.separableBlurMaterial1.uniforms["colorTexture"].value = this.renderTargetBlurBuffer1.texture;
			this.separableBlurMaterial1.uniforms["direction"].value = OutlinePass.BlurDirectionY;
			renderer.setRenderTarget(this.renderTargetEdgeBuffer1);
			renderer.clear();
			this._fsQuad.render(renderer);
			this._fsQuad.material = this.separableBlurMaterial2;
			this.separableBlurMaterial2.uniforms["colorTexture"].value = this.renderTargetEdgeBuffer1.texture;
			this.separableBlurMaterial2.uniforms["direction"].value = OutlinePass.BlurDirectionX;
			renderer.setRenderTarget(this.renderTargetBlurBuffer2);
			renderer.clear();
			this._fsQuad.render(renderer);
			this.separableBlurMaterial2.uniforms["colorTexture"].value = this.renderTargetBlurBuffer2.texture;
			this.separableBlurMaterial2.uniforms["direction"].value = OutlinePass.BlurDirectionY;
			renderer.setRenderTarget(this.renderTargetEdgeBuffer2);
			renderer.clear();
			this._fsQuad.render(renderer);
			this._fsQuad.material = this.overlayMaterial;
			this.overlayMaterial.uniforms["maskTexture"].value = this.renderTargetMaskBuffer.texture;
			this.overlayMaterial.uniforms["edgeTexture1"].value = this.renderTargetEdgeBuffer1.texture;
			this.overlayMaterial.uniforms["edgeTexture2"].value = this.renderTargetEdgeBuffer2.texture;
			this.overlayMaterial.uniforms["patternTexture"].value = this.patternTexture;
			this.overlayMaterial.uniforms["edgeStrength"].value = this.edgeStrength;
			this.overlayMaterial.uniforms["edgeGlow"].value = this.edgeGlow;
			this.overlayMaterial.uniforms["usePatternTexture"].value = this.usePatternTexture;
			if (maskActive) renderer.state.buffers.stencil.setTest(true);
			renderer.setRenderTarget(readBuffer);
			this._fsQuad.render(renderer);
			renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
			renderer.autoClear = oldAutoClear;
		}
		if (this.renderToScreen) {
			this._fsQuad.material = this.materialCopy;
			this.copyUniforms["tDiffuse"].value = readBuffer.texture;
			renderer.setRenderTarget(null);
			this._fsQuad.render(renderer);
		}
	}
	_updateSelectionCache() {
		const cache = this._selectionCache;
		function gatherSelectedMeshesCallBack(object) {
			if (object.isMesh) cache.add(object);
		}
		cache.clear();
		for (let i = 0; i < this.selectedObjects.length; i++) this.selectedObjects[i].traverse(gatherSelectedMeshesCallBack);
	}
	_changeVisibilityOfSelectedObjects(bVisible) {
		const cache = this._visibilityCache;
		for (const mesh of this._selectionCache) if (bVisible === true) mesh.visible = cache.get(mesh);
		else {
			cache.set(mesh, mesh.visible);
			mesh.visible = bVisible;
		}
	}
	_changeVisibilityOfNonSelectedObjects(bVisible) {
		const visibilityCache = this._visibilityCache;
		const selectionCache = this._selectionCache;
		function VisibilityChangeCallBack(object) {
			if (object.isPoints || object.isLine || object.isLine2) if (bVisible === true) object.visible = visibilityCache.get(object);
			else {
				visibilityCache.set(object, object.visible);
				object.visible = bVisible;
			}
			else if (object.isMesh || object.isSprite) {
				if (!selectionCache.has(object)) {
					const visibility = object.visible;
					if (bVisible === false || visibilityCache.get(object) === true) object.visible = bVisible;
					visibilityCache.set(object, visibility);
				}
			}
		}
		this.renderScene.traverse(VisibilityChangeCallBack);
	}
	_updateTextureMatrix() {
		this.textureMatrix.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
		this.textureMatrix.multiply(this.renderCamera.projectionMatrix);
		this.textureMatrix.multiply(this.renderCamera.matrixWorldInverse);
	}
	_getPrepareMaskMaterial() {
		return new ShaderMaterial({
			uniforms: {
				"depthTexture": { value: null },
				"cameraNearFar": { value: new Vector2(.5, .5) },
				"textureMatrix": { value: null }
			},
			vertexShader: `#include <batching_pars_vertex>
				#include <morphtarget_pars_vertex>
				#include <skinning_pars_vertex>

				varying vec4 projTexCoord;
				varying vec4 vPosition;
				uniform mat4 textureMatrix;

				void main() {

					#include <batching_vertex>
					#include <skinbase_vertex>
					#include <begin_vertex>
					#include <morphtarget_vertex>
					#include <skinning_vertex>
					#include <project_vertex>

					vPosition = mvPosition;

					vec4 worldPosition = vec4( transformed, 1.0 );

					#ifdef USE_INSTANCING

						worldPosition = instanceMatrix * worldPosition;

					#endif

					worldPosition = modelMatrix * worldPosition;

					projTexCoord = textureMatrix * worldPosition;

				}`,
			fragmentShader: `#include <packing>
				varying vec4 vPosition;
				varying vec4 projTexCoord;
				uniform sampler2D depthTexture;
				uniform vec2 cameraNearFar;

				void main() {

					float depth = unpackRGBAToDepth(texture2DProj( depthTexture, projTexCoord ));
					float viewZ = - DEPTH_TO_VIEW_Z( depth, cameraNearFar.x, cameraNearFar.y );
					float depthTest = (-vPosition.z > viewZ) ? 1.0 : 0.0;
					gl_FragColor = vec4(0.0, depthTest, 1.0, 1.0);

				}`
		});
	}
	_getEdgeDetectionMaterial() {
		return new ShaderMaterial({
			uniforms: {
				"maskTexture": { value: null },
				"texSize": { value: new Vector2(.5, .5) },
				"visibleEdgeColor": { value: new Vector3(1, 1, 1) },
				"hiddenEdgeColor": { value: new Vector3(1, 1, 1) }
			},
			vertexShader: `varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,
			fragmentShader: `varying vec2 vUv;

				uniform sampler2D maskTexture;
				uniform vec2 texSize;
				uniform vec3 visibleEdgeColor;
				uniform vec3 hiddenEdgeColor;

				void main() {
					vec2 invSize = 1.0 / texSize;
					vec4 uvOffset = vec4(1.0, 0.0, 0.0, 1.0) * vec4(invSize, invSize);
					vec4 c1 = texture2D( maskTexture, vUv + uvOffset.xy);
					vec4 c2 = texture2D( maskTexture, vUv - uvOffset.xy);
					vec4 c3 = texture2D( maskTexture, vUv + uvOffset.yw);
					vec4 c4 = texture2D( maskTexture, vUv - uvOffset.yw);
					float diff1 = (c1.r - c2.r)*0.5;
					float diff2 = (c3.r - c4.r)*0.5;
					float d = length( vec2(diff1, diff2) );
					float a1 = min(c1.g, c2.g);
					float a2 = min(c3.g, c4.g);
					float visibilityFactor = min(a1, a2);
					vec3 edgeColor = 1.0 - visibilityFactor > 0.001 ? visibleEdgeColor : hiddenEdgeColor;
					gl_FragColor = vec4(edgeColor, 1.0) * vec4(d);
				}`
		});
	}
	_getSeparableBlurMaterial(maxRadius) {
		return new ShaderMaterial({
			defines: { "MAX_RADIUS": maxRadius },
			uniforms: {
				"colorTexture": { value: null },
				"texSize": { value: new Vector2(.5, .5) },
				"direction": { value: new Vector2(.5, .5) },
				"kernelRadius": { value: 1 }
			},
			vertexShader: `varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,
			fragmentShader: `#include <common>
				varying vec2 vUv;
				uniform sampler2D colorTexture;
				uniform vec2 texSize;
				uniform vec2 direction;
				uniform float kernelRadius;

				float gaussianPdf(in float x, in float sigma) {
					return 0.39894 * exp( -0.5 * x * x/( sigma * sigma))/sigma;
				}

				void main() {
					vec2 invSize = 1.0 / texSize;
					float sigma = kernelRadius/2.0;
					float weightSum = gaussianPdf(0.0, sigma);
					vec4 diffuseSum = texture2D( colorTexture, vUv) * weightSum;
					vec2 delta = direction * invSize * kernelRadius/float(MAX_RADIUS);
					vec2 uvOffset = delta;
					for( int i = 1; i <= MAX_RADIUS; i ++ ) {
						float x = kernelRadius * float(i) / float(MAX_RADIUS);
						float w = gaussianPdf(x, sigma);
						vec4 sample1 = texture2D( colorTexture, vUv + uvOffset);
						vec4 sample2 = texture2D( colorTexture, vUv - uvOffset);
						diffuseSum += ((sample1 + sample2) * w);
						weightSum += (2.0 * w);
						uvOffset += delta;
					}
					gl_FragColor = diffuseSum/weightSum;
				}`
		});
	}
	_getOverlayMaterial() {
		return new ShaderMaterial({
			uniforms: {
				"maskTexture": { value: null },
				"edgeTexture1": { value: null },
				"edgeTexture2": { value: null },
				"patternTexture": { value: null },
				"edgeStrength": { value: 1 },
				"edgeGlow": { value: 1 },
				"usePatternTexture": { value: 0 }
			},
			vertexShader: `varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,
			fragmentShader: `varying vec2 vUv;

				uniform sampler2D maskTexture;
				uniform sampler2D edgeTexture1;
				uniform sampler2D edgeTexture2;
				uniform sampler2D patternTexture;
				uniform float edgeStrength;
				uniform float edgeGlow;
				uniform bool usePatternTexture;

				void main() {
					vec4 edgeValue1 = texture2D(edgeTexture1, vUv);
					vec4 edgeValue2 = texture2D(edgeTexture2, vUv);
					vec4 maskColor = texture2D(maskTexture, vUv);
					vec4 patternColor = texture2D(patternTexture, 6.0 * vUv);
					float visibilityFactor = 1.0 - maskColor.g > 0.0 ? 1.0 : 0.5;
					vec4 edgeValue = edgeValue1 + edgeValue2 * edgeGlow;
					vec4 finalColor = edgeStrength * maskColor.r * edgeValue;
					if(usePatternTexture)
						finalColor += + visibilityFactor * (1.0 - maskColor.r) * (1.0 - patternColor.r);
					gl_FragColor = finalColor;
				}`,
			blending: 2,
			depthTest: false,
			depthWrite: false,
			transparent: true
		});
	}
};
OutlinePass.BlurDirectionX = new Vector2(1, 0);
OutlinePass.BlurDirectionY = new Vector2(0, 1);
//#endregion
//#region scene3d/src/cinematic.js
var vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
var depthGLSL = `
  uniform sampler2D tDepth;
  uniform mat4 inverseProjection;
  vec3 viewPosition(vec2 uv) {
    float depth = textureLod(tDepth, uv, 0.0).r;
    vec4 position = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return position.xyz / position.w;
  }
`;
var vignetteGLSL = `
  float vignetteFactor(vec2 uv, float strength) {
    vec2 edge = (uv - 0.5) * 2.0;
    return 1.0 - strength * smoothstep(0.30, 1.6, dot(edge, edge));
  }
`;
function screenMaterial(name, uniforms, fragmentShader) {
	return new ShaderMaterial({
		name,
		uniforms,
		vertexShader,
		fragmentShader,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		blending: 0
	});
}
/** Opaque beauty and AO, then transparency on the SAME untouched depth buffer. */
var DioramaPass = class extends RenderPass {
	constructor(scene, camera, samples) {
		super(scene, camera);
		this.target = new WebGLRenderTarget(1, 1, {
			type: HalfFloatType,
			samples,
			depthTexture: new DepthTexture(1, 1, UnsignedIntType),
			stencilBuffer: false,
			resolveDepthBuffer: true
		});
		this.target.texture.name = "Cinematic.beauty";
		this.target.depthTexture.name = "Cinematic.depth";
		this.aoTarget = new WebGLRenderTarget(1, 1, {
			type: HalfFloatType,
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			depthBuffer: false
		});
		this.aoTarget.texture.name = "Cinematic.ao-depth";
		this.transparentPass = new RenderPass(scene, camera);
		this.transparentPass.clear = false;
		this.materials = /* @__PURE__ */ new Set();
		this.hidden = [];
		this.quad = new FullScreenQuad(null);
		this.aoMaterial = screenMaterial("Cinematic.ContactAO", {
			tDepth: { value: this.target.depthTexture },
			inverseProjection: { value: camera.projectionMatrixInverse },
			projection: { value: camera.projectionMatrix },
			texel: { value: new Vector2(1, 1) },
			radius: { value: .85 },
			intensity: { value: 1.25 }
		}, `
      varying vec2 vUv;
      uniform mat4 projection;
      uniform vec2 texel;
      uniform float radius;
      uniform float intensity;
      ${depthGLSL}
      void main() {
        vec3 p = viewPosition(vUv);
        if (texture2D(tDepth, vUv).r >= 0.999999) {
          gl_FragColor = vec4(1.0, -p.z, 0.0, 1.0);
          return;
        }
        vec3 left = p - viewPosition(vUv - vec2(texel.x, 0.0));
        vec3 right = viewPosition(vUv + vec2(texel.x, 0.0)) - p;
        vec3 down = p - viewPosition(vUv - vec2(0.0, texel.y));
        vec3 up = viewPosition(vUv + vec2(0.0, texel.y)) - p;
        vec3 dx = abs(left.z) < abs(right.z) ? left : right;
        vec3 dy = abs(down.z) < abs(up.z) ? down : up;
        vec3 n = cross(dx, dy);
        n /= max(length(n), 0.00001);
        vec4 clip = projection * vec4(p, 1.0);
        vec2 spread = 0.5 * radius * vec2(projection[0][0], projection[1][1]) / clip.w;
        float occlusion = 0.0;
        for (int i = 0; i < 8; i++) {
          float f = float(i);
          float angle = f * 2.39996323;
          vec2 uv = vUv + vec2(cos(angle), sin(angle)) * spread * sqrt((f + 0.5) / 8.0);
          if (any(lessThan(uv, texel)) || any(greaterThan(uv, 1.0 - texel))) continue;
          if (texture2D(tDepth, uv).r >= 0.999999) continue;
          vec3 offset = viewPosition(uv) - p;
          float distance = length(offset);
          float horizon = max(dot(n, offset) / max(distance, 0.0001) - 0.09, 0.0);
          float falloff = 1.0 - smoothstep(radius * 0.15, radius, distance);
          occlusion += horizon * falloff;
        }
        float ao = 1.0 - clamp(occlusion * intensity / 4.0, 0.0, 0.38);
        gl_FragColor = vec4(ao, -p.z, 0.0, 1.0);
      }
    `);
		this.aoBlendMaterial = screenMaterial("Cinematic.AOBilateralBlend", {
			tAO: { value: this.aoTarget.texture },
			texel: { value: new Vector2(1, 1) }
		}, `
      varying vec2 vUv;
      uniform sampler2D tAO;
      uniform vec2 texel;
      void main() {
        vec2 center = texture2D(tAO, vUv).rg;
        float sum = center.r * 2.0;
        float weights = 2.0;
        for (int i = 0; i < 4; i++) {
          float angle = float(i) * 1.57079633;
          vec2 tap = texture2D(tAO, vUv + vec2(cos(angle), sin(angle)) * texel).rg;
          float weight = exp(-abs(tap.g - center.g) * 12.0);
          sum += tap.r * weight;
          weights += weight;
        }
        float ao = sum / weights;
        gl_FragColor = vec4(ao, mix(ao, 1.0, 0.06), mix(ao, 1.0, 0.14), 1.0);
      }
    `);
		Object.assign(this.aoBlendMaterial, {
			transparent: true,
			blending: 5,
			blendSrc: 208,
			blendDst: 200,
			blendSrcAlpha: 200,
			blendDstAlpha: 201
		});
		this.copyMaterial = screenMaterial("Cinematic.BeautyCopy", { tDiffuse: { value: this.target.texture } }, `
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
    `);
	}
	render(renderer, writeBuffer, readBuffer) {
		const background = this.scene.background;
		const autoClear = renderer.autoClear;
		const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
		this.materials.clear();
		this.scene.traverseVisible((object) => {
			if (Array.isArray(object.material)) for (const material of object.material) this.materials.add(material);
			else if (object.material) this.materials.add(object.material);
		});
		try {
			for (const material of this.materials) if (material.visible && material.transparent) {
				material.visible = false;
				this.hidden.push(material);
			}
			super.render(renderer, writeBuffer, this.target);
			for (const material of this.hidden) material.visible = true;
			this.hidden.length = 0;
			renderer.autoClear = false;
			renderer.setRenderTarget(this.aoTarget);
			this.quad.material = this.aoMaterial;
			this.quad.render(renderer);
			renderer.setRenderTarget(this.target);
			this.quad.material = this.aoBlendMaterial;
			this.quad.render(renderer);
			for (const material of this.materials) if (material.visible && !material.transparent) {
				material.visible = false;
				this.hidden.push(material);
			}
			this.scene.background = null;
			renderer.shadowMap.autoUpdate = false;
			this.transparentPass.render(renderer, writeBuffer, this.target);
			for (const material of this.hidden) material.visible = true;
			this.hidden.length = 0;
			renderer.setRenderTarget(readBuffer);
			this.quad.material = this.copyMaterial;
			this.quad.render(renderer);
		} finally {
			for (const material of this.hidden) material.visible = true;
			this.hidden.length = 0;
			this.materials.clear();
			this.scene.background = background;
			renderer.shadowMap.autoUpdate = shadowAutoUpdate;
			renderer.autoClear = autoClear;
		}
	}
	setSize(width, height) {
		width = Math.max(1, Math.floor(width));
		height = Math.max(1, Math.floor(height));
		this.target.setSize(width, height);
		const aoWidth = Math.max(1, Math.floor(width / 2));
		const aoHeight = Math.max(1, Math.floor(height / 2));
		this.aoTarget.setSize(aoWidth, aoHeight);
		this.aoMaterial.uniforms.texel.value.set(1 / aoWidth, 1 / aoHeight);
		this.aoBlendMaterial.uniforms.texel.value.set(1 / aoWidth, 1 / aoHeight);
	}
	dispose() {
		this.target.dispose();
		this.aoTarget.dispose();
		this.aoMaterial.dispose();
		this.aoBlendMaterial.dispose();
		this.copyMaterial.dispose();
		this.transparentPass.dispose();
		this.quad.dispose();
		this.materials.clear();
	}
};
function createCinematic(renderer, scene, camera, { compact = false, atmosphere = null, msaa = 2, paperColor = DEFAULT_PAPER_COLOR } = {}) {
	if (renderer.capabilities.logarithmicDepthBuffer || renderer.capabilities.reversedDepthBuffer) throw new Error("Cinematic requires the standard WebGL depth buffer");
	const samples = Math.min([2, 4].includes(msaa) ? msaa : 2, renderer.capabilities.maxSamples);
	const composer = new EffectComposer(renderer, new WebGLRenderTarget(1, 1, {
		type: HalfFloatType,
		depthBuffer: false
	}));
	composer.setPixelRatio(1);
	const beauty = new DioramaPass(scene, camera, samples);
	if (atmosphere?.setDepthTexture) atmosphere.setDepthTexture(beauty.target.depthTexture);
	const dof = new ShaderPass(screenMaterial("Cinematic.DepthOfField", {
		tDiffuse: { value: null },
		tDepth: { value: beauty.target.depthTexture },
		inverseProjection: { value: new Matrix4() },
		resolution: { value: new Vector2(1, 1) },
		focusDistance: { value: 60 },
		sharpRange: { value: RENDER_DEFAULTS.dofSharp },
		falloff: { value: 22 },
		maxBlur: { value: RENDER_DEFAULTS.dofBlur },
		tiltShift: { value: RENDER_DEFAULTS.tiltShift }
	}, `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float focusDistance;
    uniform float sharpRange;
    uniform float falloff;
    uniform float maxBlur;
    uniform float tiltShift;
    ${depthGLSL}
    float coc(float depth) {
      float difference = depth - focusDistance;
      return sign(difference) * smoothstep(sharpRange, sharpRange + falloff, abs(difference));
    }
    float tiltBlur(vec2 uv) {
      return tiltShift * smoothstep(0.30, 0.72, abs(uv.y - 0.5) * 2.0);
    }
    void main() {
      vec4 center = textureLod(tDiffuse, vUv, 0.0);
      float depth = -viewPosition(vUv).z;
      // HD-2D tilt-shift: a horizontal band stays sharp while top/bottom blur out,
      // selling the miniature-diorama read of the scene.
      float blur = max(abs(coc(depth)), tiltBlur(vUv));
      if (blur < 0.025) { gl_FragColor = center; return; }
      vec2 radius = vec2(maxBlur * blur) / resolution;
      vec3 sum = center.rgb;
      float weights = 1.0;
      for (int i = 0; i < ${compact ? 12 : 20}; i++) {
        float f = float(i) + 0.5;
        float angle = f * 2.39996323;
        vec2 offset = vec2(cos(angle), sin(angle)) * sqrt(f / ${compact ? "12.0" : "20.0"});
        vec2 uv = clamp(vUv + offset * radius, 0.5 / resolution, 1.0 - 0.5 / resolution);
        float tapDepth = -viewPosition(uv).z;
        float weight = 1.0 - smoothstep(0.8, 3.5, abs(tapDepth - depth));
        // Depth-sharp taps still contribute to screen-space tilt blur.
        weight *= smoothstep(0.0, 0.2, max(abs(coc(tapDepth)), tiltBlur(uv)));
        sum += textureLod(tDiffuse, uv, 0.0).rgb * weight;
        weights += weight;
      }
      gl_FragColor = vec4(mix(center.rgb, sum / weights, smoothstep(0.025, 0.15, blur)), center.a);
    }
  `));
	const bloom = new UnrealBloomPass(new Vector2(1, 1), .12, .25, .98);
	bloom.highPassUniforms.smoothWidth.value = .28;
	bloom.highPassUniforms.tDepth = { value: beauty.target.depthTexture };
	bloom.highPassUniforms.indoor = { value: 0 };
	bloom.materialHighPassFilter.fragmentShader = `uniform sampler2D tDepth;
    uniform float indoor;
    ${bloom.materialHighPassFilter.fragmentShader}`.replace("void main() {", `void main() {
      if (indoor > 0.5 && texture2D(tDepth, vUv).r >= 0.999999) {
        gl_FragColor = vec4(0.0);
        return;
      }
    `);
	for (const tint of bloom.bloomTintColors) tint.set(1, .85, .66);
	const bloomSetSize = bloom.setSize.bind(bloom);
	bloom.setSize = (width, height) => bloomSetSize(Math.max(32, Math.floor(width * (compact ? .5 : 1))), Math.max(32, Math.floor(height * (compact ? .5 : 1))));
	for (const target of [
		bloom.renderTargetBright,
		...bloom.renderTargetsHorizontal,
		...bloom.renderTargetsVertical
	]) target.depthBuffer = false;
	const grade = new ShaderPass(screenMaterial("Cinematic.FilmGrade", {
		tDiffuse: { value: null },
		golden: { value: .7 },
		night: { value: 0 },
		grainFrame: { value: 0 },
		gradeSat: { value: RENDER_DEFAULTS.saturation },
		gradeContrast: { value: RENDER_DEFAULTS.contrast },
		gradeGamma: { value: RENDER_DEFAULTS.gamma },
		gradeWarm: { value: RENDER_DEFAULTS.warmth },
		gradeVignette: { value: RENDER_DEFAULTS.vignette }
	}, `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float golden;
    uniform float night;
    uniform float grainFrame;
    uniform float gradeSat;
    uniform float gradeContrast;
    uniform float gradeGamma;
    uniform float gradeWarm;
    uniform float gradeVignette;
    ${vignetteGLSL}
    float noise(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }
    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 color = max(source.rgb, 0.0);
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float shade = 1.0 - smoothstep(0.04, 0.62, luma);
      float light = smoothstep(0.26, 1.8, luma) * (1.0 - night * 0.75);
      color *= mix(vec3(1.0), vec3(0.88, 0.96, 1.07), shade * 0.82);
      color *= mix(vec3(1.0), vec3(1.16, 1.02, 0.82), light * (0.42 + golden * 0.58));
      // HD-2D: push saturation hard (ACES desaturates highlights, so pre-compensate),
      // deepen blacks and pivot contrast around 18% gray.
      color = mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, gradeSat);
      vec3 contrasted = 0.18 + (color - 0.18) * gradeContrast;
      // A gentle night toe preserves deep-blue sky/window detail below the old
      // hard 0.0235 linear cutoff. Midtones/daytime keep the authored contrast.
      vec3 toe = max(color, 0.0) * pow(clamp(max(color, 0.0) / 0.18, 0.00001, 1.0), vec3(max(gradeContrast - 1.0, 0.0)));
      color = mix(contrasted, max(contrasted, toe), night * (1.0 - smoothstep(0.025, 0.10, luma)));
      color = 0.18 * pow(max(color, 0.0) / 0.18, vec3(gradeGamma));
      color *= mix(vec3(1.0), vec3(1.06, 1.0, 0.86), (1.0 - night) * gradeWarm);
      color *= vignetteFactor(vUv, gradeVignette);

      luma = max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.00001);
      float dither = noise(gl_FragCoord.xy);
      float quantized = floor(sqrt(luma) * 96.0 + dither) / 96.0;
      color *= mix(1.0, quantized * quantized / luma, 0.16);
      float grain = noise(gl_FragCoord.xy + grainFrame * vec2(17.0, 29.0)) - 0.5;
      color += grain * 0.004 * sqrt(luma);
      gl_FragColor = vec4(max(color, 0.0), source.a);
    }
  `));
	const output = new OutputPass();
	output.uniforms.paperBackground = { value: 0 };
	output.uniforms.paperVignette = grade.uniforms.gradeVignette;
	output.uniforms.tCoverage = { value: beauty.target.texture };
	output.uniforms.tDepth = { value: beauty.target.depthTexture };
	output.uniforms.paperColor = { value: new Color(paperColor) };
	output.material.fragmentShader = output.material.fragmentShader.replace("uniform sampler2D tDiffuse;", "uniform sampler2D tDiffuse, tCoverage, tDepth;\nuniform float paperBackground, paperVignette;\nuniform vec3 paperColor;").replace("void main() {", `${vignetteGLSL}\nvoid main() {
      // Backdrop = far depth AND opaque alpha. The sky quad now writes alpha 1,
      // a marker that survives mobile HalfFloat/MSAA resolves (the old zero-alpha
      // coverage was lost there). Transparent cloth/water over the backdrop keep
      // alpha < 1 and pass through untouched.
      if (paperBackground > 0.5 && texture2D(tDepth, vUv).r >= 0.999999 && texture2D(tCoverage, vUv).a >= 0.999999) {
        gl_FragColor = vec4(paperColor * vignetteFactor(vUv, paperVignette), 1.0);
        #ifdef SRGB_TRANSFER
          gl_FragColor = sRGBTransferOETF(gl_FragColor);
        #endif
        return;
      }
    `);
	const selectionOutline = new OutlinePass(new Vector2(1, 1), scene, camera);
	selectionOutline.visibleEdgeColor.set("#dba23c");
	selectionOutline.hiddenEdgeColor.set("#000000");
	selectionOutline.edgeStrength = 1.8;
	selectionOutline.edgeGlow = .15;
	selectionOutline.edgeThickness = 1.5;
	selectionOutline.pulsePeriod = 0;
	selectionOutline.enabled = false;
	for (const pass of [
		beauty,
		atmosphere,
		dof,
		bloom,
		grade,
		selectionOutline,
		output
	].filter(Boolean)) composer.addPass(pass);
	let disposed = false;
	let focusTarget = new Vector3(0, 2.4, 0);
	const viewTarget = new Vector3();
	const size = renderer.getSize(new Vector2());
	const viewport = new Vector4();
	const scissor = new Vector4();
	const clearColor = new Color();
	let elapsed = 0;
	let hour = 16.5;
	let pixelRatio = 1;
	let daylight = 1;
	let golden = 0;
	let dofSharpBase = RENDER_DEFAULTS.dofSharp;
	let dofSceneScale = 1;
	let dofMaxBlurBase = RENDER_DEFAULTS.dofBlur;
	let bloomScale = RENDER_DEFAULTS.bloom;
	const stableInvProj = new Matrix4();
	const stats = {
		calls: 0,
		triangles: 0,
		points: 0,
		lines: 0,
		cpuMs: 0,
		frames: 0
	};
	atmosphere?.setProjectionInverse?.(stableInvProj);
	function resize(width, height) {
		if (disposed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
		width = Math.max(1, Math.floor(width));
		height = Math.max(1, Math.floor(height));
		pixelRatio = renderer.getPixelRatio();
		if (renderer.getSize(size).x !== width || renderer.getSize(size).y !== height) renderer.setSize(width, height, false);
		size.set(width, height);
		const physicalWidth = Math.max(1, Math.floor(width * pixelRatio));
		const physicalHeight = Math.max(1, Math.floor(height * pixelRatio));
		composer.setSize(physicalWidth, physicalHeight);
		dof.uniforms.resolution.value.set(physicalWidth, physicalHeight);
		dof.uniforms.maxBlur.value = dofMaxBlurBase * pixelRatio * MathUtils.clamp(height / 900, .65, 1.2);
	}
	function applyBloom() {
		bloom.strength = (MathUtils.lerp(.24, .16, daylight) + golden * .07) * bloomScale;
	}
	function setTime(value) {
		if (disposed || !Number.isFinite(value)) return;
		hour = MathUtils.clamp(value, 0, 24);
		const altitude = Math.sin((hour - 6) * Math.PI / 12);
		daylight = MathUtils.smoothstep(altitude, -.14, .4);
		golden = daylight * (1 - MathUtils.smoothstep(altitude, .25, .85));
		grade.uniforms.golden.value = golden;
		grade.uniforms.night.value = 1 - daylight;
		atmosphere?.setTime?.(hour);
		applyBloom();
	}
	function applyDofRanges() {
		const ranges = calculateDofRanges(dofSharpBase, camera.zoom, dofSceneScale);
		dof.uniforms.sharpRange.value = ranges.sharpRange;
		dof.uniforms.falloff.value = ranges.falloff;
	}
	function setSceneScale(value) {
		if (disposed || !Number.isFinite(value) || value <= 0) return false;
		dofSceneScale = value;
		applyDofRanges();
		return true;
	}
	function setPaperColor(value) {
		if (disposed) return false;
		if (!(value?.isColor ? [
			value.r,
			value.g,
			value.b
		].every(Number.isFinite) : typeof value === "string" && value.trim().length > 0 || typeof value === "number" && Number.isFinite(value))) return false;
		output.uniforms.paperColor.value.set(value);
		return true;
	}
	function set(name, value) {
		if (disposed || !Number.isFinite(value)) return false;
		switch (name) {
			case "interior":
				bloom.highPassUniforms.indoor.value = value > .5 ? 1 : 0;
				output.uniforms.paperBackground.value = value > .5 ? 1 : 0;
				dof.uniforms.tiltShift.value = value > .5 ? SUBSCENE_TILT_SHIFT : RENDER_DEFAULTS.tiltShift;
				if (value <= .5) setSceneScale(1);
				return true;
			case "tiltShift":
				dof.uniforms.tiltShift.value = value;
				return true;
			case "dofSceneScale": return setSceneScale(value);
			case "dofSharp":
				if (value < 0) return false;
				dofSharpBase = value;
				applyDofRanges();
				return true;
			case "dofBlur":
				dofMaxBlurBase = value;
				resize(size.x, size.y);
				return true;
			case "bloom":
				bloomScale = value;
				applyBloom();
				return true;
			case "saturation":
				grade.uniforms.gradeSat.value = value;
				return true;
			case "contrast":
				grade.uniforms.gradeContrast.value = value;
				return true;
			case "gamma":
				grade.uniforms.gradeGamma.value = value;
				return true;
			case "warmth":
				grade.uniforms.gradeWarm.value = value;
				return true;
			case "vignette":
				grade.uniforms.gradeVignette.value = value;
				return true;
			default: return false;
		}
	}
	function setFocus(target) {
		if (!disposed && target?.isVector3 && [
			target.x,
			target.y,
			target.z
		].every(Number.isFinite)) focusTarget = target;
	}
	function setSelection(objects = []) {
		if (disposed) return false;
		selectionOutline.selectedObjects = objects.filter((object) => object?.isObject3D);
		selectionOutline.enabled = selectionOutline.selectedObjects.length > 0;
		return true;
	}
	function render(delta = 0) {
		if (disposed) return;
		const start = performance.now();
		const dt = Number.isFinite(delta) ? MathUtils.clamp(delta, 0, .1) : 0;
		elapsed = (elapsed + dt) % 4096;
		camera.updateProjectionMatrix();
		stableInvProj.copy(camera.projectionMatrix).invert();
		dof.uniforms.inverseProjection.value.copy(stableInvProj);
		camera.updateWorldMatrix(true, false);
		viewTarget.copy(focusTarget).applyMatrix4(camera.matrixWorldInverse);
		dof.uniforms.focusDistance.value = MathUtils.clamp(-viewTarget.z, camera.near, camera.far);
		applyDofRanges();
		grade.uniforms.grainFrame.value = Math.floor(elapsed * 12);
		const target = renderer.getRenderTarget();
		const cubeFace = renderer.getActiveCubeFace();
		const mipLevel = renderer.getActiveMipmapLevel();
		const autoClear = renderer.autoClear;
		const scissorTest = renderer.getScissorTest();
		const clearAlpha = renderer.getClearAlpha();
		const infoAutoReset = renderer.info.autoReset;
		renderer.getViewport(viewport);
		renderer.getScissor(scissor);
		renderer.getClearColor(clearColor);
		const before = { ...renderer.info.render };
		renderer.info.autoReset = false;
		if (infoAutoReset) renderer.info.reset();
		try {
			renderer.autoClear = false;
			renderer.setScissorTest(false);
			renderer.setViewport(0, 0, size.x, size.y);
			composer.render(dt);
			for (const key of [
				"calls",
				"triangles",
				"points",
				"lines"
			]) stats[key] = renderer.info.render[key] - (infoAutoReset ? 0 : before[key]);
			stats.frames++;
		} finally {
			renderer.setRenderTarget(target, cubeFace, mipLevel);
			renderer.setViewport(viewport);
			renderer.setScissor(scissor);
			renderer.setScissorTest(scissorTest);
			renderer.setClearColor(clearColor, clearAlpha);
			renderer.autoClear = autoClear;
			renderer.info.autoReset = infoAutoReset;
			stats.cpuMs = performance.now() - start;
		}
	}
	function dispose() {
		if (disposed) return;
		disposed = true;
		for (const pass of composer.passes) if (pass !== atmosphere) pass.dispose();
		bloom.materialHighPassFilter.dispose();
		composer.dispose();
		composer.timer.dispose();
		composer.passes.length = 0;
	}
	function getStats() {
		return {
			...stats,
			disposed,
			compact,
			hour,
			pixelRatio,
			samples,
			width: beauty.target.width,
			height: beauty.target.height,
			focusDistance: dof.uniforms.focusDistance.value,
			dofSceneScale,
			sharpRange: dof.uniforms.sharpRange.value,
			falloff: dof.uniforms.falloff.value,
			maxBlur: dof.uniforms.maxBlur.value,
			paperColor: `#${output.uniforms.paperColor.value.getHexString()}`,
			aoWidth: beauty.aoTarget.width,
			aoHeight: beauty.aoTarget.height,
			aoSamples: 8,
			dofSamples: compact ? 12 : 20,
			bloomStrength: bloom.strength,
			interior: bloom.highPassUniforms.indoor.value > .5,
			selection: selectionOutline.enabled ? selectionOutline.selectedObjects.length : 0,
			tuning: {
				tiltShift: dof.uniforms.tiltShift.value,
				dofSharp: dofSharpBase,
				dofBlur: dofMaxBlurBase,
				bloom: bloomScale,
				saturation: grade.uniforms.gradeSat.value,
				contrast: grade.uniforms.gradeContrast.value,
				gamma: grade.uniforms.gradeGamma.value,
				warmth: grade.uniforms.gradeWarm.value,
				vignette: grade.uniforms.gradeVignette.value
			},
			overBudget: stats.calls >= 600
		};
	}
	resize(size.x, size.y);
	applyDofRanges();
	setTime(hour);
	return {
		render,
		resize,
		setTime,
		setFocus,
		setSceneScale,
		setPaperColor,
		setSelection,
		set,
		dispose,
		getStats
	};
}
//#endregion
export { createCinematic };
