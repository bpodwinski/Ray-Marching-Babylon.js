import {
  WebGPUEngine,
  Scene,
  Vector3,
  MeshBuilder,
  PostProcess,
  Vector2,
  Effect,
  Ray,
  Matrix,
  DepthRenderer,
  StandardMaterial,
  Color3,
  FreeCamera,
  CubeTexture,
  Texture,
} from "@babylonjs/core";

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
  public static toSimulationUnits(value_km: number): number {
    return value_km * this.SCALE_FACTOR;
  }
  public static toSimulationVector(position_km: Vector3): Vector3 {
    return position_km.scale(this.SCALE_FACTOR);
  }
}

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas not found!");

// Utilisation de WebGPUEngine au lieu de Engine
const engine = new WebGPUEngine(canvas);
await engine.initAsync();

const createScene = (): Scene => {
  const scene = new Scene(engine);
  scene.clearColor.set(0, 0, 0, 1);
  scene.collisionsEnabled = true;
  scene.debugLayer.show({ overlay: true });

  // Création d'une FreeCamera à la position souhaitée
  const camera = new FreeCamera(
    "freeCamera",
    ScaleManager.toSimulationVector(new Vector3(0, 0, -424_500)),
    scene
  );
  camera.setTarget(Vector3.Zero());
  camera.attachControl(canvas, true);
  camera.minZ = 0.01;
  camera.maxZ = 100_000_000_000;
  camera.keysUp = [90];
  camera.keysLeft = [81];
  camera.keysDown = [83];
  camera.keysRight = [68];
  camera.speed = 0.25;

  // Création du Skybox
  const skybox = MeshBuilder.CreateBox("skyBox", { size: 1000 }, scene);
  const skyboxMaterial = new StandardMaterial("skyBox", scene);
  skyboxMaterial.backFaceCulling = false;
  skyboxMaterial.disableLighting = true;
  skybox.material = skyboxMaterial;
  skybox.infiniteDistance = true;
  skyboxMaterial.disableLighting = true;
  skyboxMaterial.reflectionTexture = new CubeTexture("textures/skybox", scene);
  skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;

  // Création de la sphère "star"
  const sphereRadius = ScaleManager.toSimulationUnits(696_342);
  const sphere = MeshBuilder.CreateSphere(
    "star",
    { diameter: sphereRadius, segments: 128 },
    scene
  );
  sphere.position = new Vector3(0, 0, 0);
  const sphereMaterial = new StandardMaterial("sphereMat", scene);
  sphereMaterial.emissiveColor = new Color3(1, 0.55, 0.05);
  sphereMaterial.alpha = 1;
  sphere.material = sphereMaterial;

  scene.onBeforeRenderObservable.add(() => {
    const currentOrigin = camera.position.clone();
    const currentDirection = camera.getForwardRay().direction.clone();
    const ray = new Ray(currentOrigin, currentDirection, 1000);
  });

  // Création du post-process de ray marching
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
    ],
    null,
    1,
    camera
  );

  const depthRenderer = new DepthRenderer(scene);
  depthRenderer.useOnlyInActiveCamera = true;
  const depthTexture = depthRenderer.getDepthMap();

  postProcess.onApply = (effect) => {
    effect.setVector2("resolution", new Vector2(canvas.width, canvas.height));
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
  };

  return scene;
};

const scene = createScene();
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
