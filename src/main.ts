import {
  WebGPUEngine,
  Scene,
  Vector3,
  MeshBuilder,
  PostProcess,
  Vector2,
  Effect,
  Matrix,
  DepthRenderer,
  StandardMaterial,
  Color3,
  FreeCamera,
  CubeTexture,
  Texture,
  PointLight,
  Engine,
  PBRMetallicRoughnessMaterial,
  PBRMaterial,
} from "@babylonjs/core";

import "@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader";
import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";

import rayMarchingShaderFragment from "./shaders/rayMarchingShaderFragment.glsl?raw";
Effect.ShadersStore["rayMarchingShaderFragmentShader"] =
  rayMarchingShaderFragment;

/**
 * Manages scale conversion between real-world distances (in kilometers)
 */
class ScaleManager {
  private static readonly SCALE_FACTOR = 1 / 1_000;
  /**
   * Converts kilometers to simulation units.
   *
   * @param value_km - Distance in kilometers.
   * @returns The distance in simulation units.
   */
  public static toSimulationUnits(value_km: number): number {
    return value_km * this.SCALE_FACTOR;
  }
  /**
   * Converts a position from kilometers to simulation units.
   *
   * @param position_km - The position vector in kilometers.
   * @returns The position vector in simulation units.
   */
  public static toSimulationVector(position_km: Vector3): Vector3 {
    return position_km.scale(this.SCALE_FACTOR);
  }
}

/**
 * Class representing a volumetric scene.
 *
 * This class creates a BabylonJS scene with a skybox, a planet ("star") sphere, a free camera,
 * a point light, and a post-process that applies a custom ray marching shader.
 *
 * @remarks The engine type is chosen based on the `useWebGPU` parameter.
 */
class VolumetricScene {
  public engine!: Engine | WebGPUEngine;
  public scene!: Scene;

  /**
   * Creates a new instance of the VolumetricScene.
   *
   * @param canvas - The HTML canvas element to render on.
   * @param useWebGPU - If true, uses WebGPUEngine; otherwise, uses the default Engine (WebGL).
   */
  constructor(
    private canvas: HTMLCanvasElement,
    private useWebGPU: boolean = true
  ) {}

  /**
   * Asynchronously initializes the scene.
   *
   * Sets up the engine (WebGPU or WebGL), creates the scene, camera, skybox, sphere,
   * point light, and post-process with the ray marching shader.
   *
   * @returns A promise that resolves when initialization is complete.
   */
  public async init(): Promise<void> {
    if (this.useWebGPU) {
      this.engine = new WebGPUEngine(this.canvas);
      await (this.engine as WebGPUEngine).initAsync();
    } else {
      this.engine = new Engine(this.canvas, true);
    }

    // Create scene
    this.scene = new Scene(this.engine);
    this.scene.clearColor.set(0, 0, 0, 1);
    this.scene.collisionsEnabled = true;
    this.scene.debugLayer.show({ overlay: true });

    // Create camera
    const camera = new FreeCamera(
      "freeCamera",
      ScaleManager.toSimulationVector(new Vector3(0, 0, -450_000)),
      this.scene
    );
    camera.setTarget(Vector3.Zero());
    camera.attachControl(this.canvas, true);
    camera.minZ = 0.001;
    camera.maxZ = 100_000_000_000;
    camera.keysUp = [90];
    camera.keysLeft = [81];
    camera.keysDown = [83];
    camera.keysRight = [68];
    camera.speed = 0.25;

    // Create skybox
    const skybox = MeshBuilder.CreateBox("skyBox", { size: 1000 }, this.scene);
    const skyboxMaterial = new StandardMaterial("skyBox", this.scene);
    skyboxMaterial.backFaceCulling = false;
    skyboxMaterial.disableLighting = true;
    skybox.material = skyboxMaterial;
    skybox.infiniteDistance = true;
    skyboxMaterial.reflectionTexture = new CubeTexture(
      "textures/skybox",
      this.scene
    );
    skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;

    // Create star
    const sphereRadius = ScaleManager.toSimulationUnits(696_342);
    const sphere = MeshBuilder.CreateSphere(
      "star",
      { diameter: sphereRadius, segments: 128 },
      this.scene
    );
    sphere.position = new Vector3(0, 0, 0);

    let sunMaterial = new StandardMaterial("sunMaterial", this.scene);

    const emissiveTexture = (sunMaterial.emissiveTexture = new Texture(
      "textures/granulation_emissive.ktx2",
      this.scene
    ));
    emissiveTexture.wrapU = Texture.WRAP_ADDRESSMODE;
    emissiveTexture.wrapV = Texture.WRAP_ADDRESSMODE;
    emissiveTexture.uScale = 100;
    emissiveTexture.vScale = 75;
    sunMaterial.emissiveTexture = emissiveTexture;

    const bumpTexture = (sunMaterial.bumpTexture = new Texture(
      "textures/granulation_bump.ktx2",
      this.scene
    ));
    bumpTexture.wrapU = Texture.WRAP_ADDRESSMODE;
    bumpTexture.wrapV = Texture.WRAP_ADDRESSMODE;
    bumpTexture.uScale = 100;
    bumpTexture.vScale = 75;
    sunMaterial.bumpTexture = bumpTexture;
    bumpTexture.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);

    sunMaterial.emissiveColor = new Color3(0, 0, 0);

    sunMaterial.useParallax = true;
    sunMaterial.useParallaxOcclusion = true;
    sunMaterial.parallaxScaleBias = 0.01;

    sunMaterial.roughness = 0.0;
    sphere.material = sunMaterial;

    // Create a point light positioned at the center of the sphere
    const sunLight = new PointLight("sun", sphere.position, this.scene);
    sunLight.intensity = 10;

    // Create the post-process
    const postProcess = new PostProcess(
      "rayMarching",
      "rayMarchingShader",
      [
        "resolution",
        "time",
        "cameraPosition",
        "spherePosition",
        "sphereRadius",
        "inverseProjection",
        "inverseView",
        "cameraNear",
        "cameraFar",
        "noiseTexture",
      ],
      null,
      1,
      camera
    );

    const depthRenderer = new DepthRenderer(this.scene);
    depthRenderer.useOnlyInActiveCamera = true;
    const depthTexture = depthRenderer.getDepthMap();

    // Load your noise texture
    const noiseTexture = new Texture("textures/noise.png", this.scene);

    postProcess.onApply = (effect) => {
      effect.setVector2(
        "resolution",
        new Vector2(this.canvas.width, this.canvas.height)
      );
      effect.setFloat("time", performance.now() * 0.0003);
      effect.setVector3("cameraPosition", camera.position);
      effect.setVector3("spherePosition", sphere.position);
      effect.setFloat(
        "sphereRadius",
        sphere.getBoundingInfo().boundingSphere.radius
      );
      effect.setMatrix(
        "inverseProjection",
        Matrix.Invert(camera.getProjectionMatrix())
      );
      effect.setMatrix("inverseView", Matrix.Invert(camera.getViewMatrix()));
      effect.setFloat("cameraNear", camera.minZ);
      effect.setFloat("cameraFar", camera.maxZ);
      effect.setTexture("depthSampler", depthTexture);
      effect.setTexture("noiseTexture", noiseTexture);
    };
  }

  /**
   * Starts the render loop
   */
  public run(): void {
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
    window.addEventListener("resize", () => this.engine.resize());
  }
}

// Init scene
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas not found!");

const useWebGPU = true;

const myScene = new VolumetricScene(canvas, useWebGPU);
await myScene.init();
myScene.run();
