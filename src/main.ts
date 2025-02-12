import {
  Engine,
  Scene,
  Vector3,
  MeshBuilder,
  PostProcess,
  Vector2,
  Effect,
  Ray,
  Matrix,
  DepthRenderer,
  HDRCubeTexture,
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
  /**
   * Scale factor to convert kilometers into simulation units.
   * In this context, 1 Babylon.js unit represents 1,000 km.
   */
  private static readonly SCALE_FACTOR = 1 / 1_000;

  /**
   * Converts a distance from kilometers to simulation units.
   *
   * @param value_km - The distance in kilometers.
   * @returns The equivalent distance in simulation units.
   */
  public static toSimulationUnits(value_km: number): number {
    return value_km * this.SCALE_FACTOR;
  }

  /**
   * Converts a position vector from kilometers to simulation units.
   *
   * @param position_km - The position vector in kilometers.
   * @returns A new `Vector3` instance representing the position in simulation units.
   */
  public static toSimulationVector(position_km: Vector3): Vector3 {
    return position_km.scale(this.SCALE_FACTOR);
  }
}

/**
 * The main canvas element.
 * @constant
 */
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas not found!");

/**
 * The Babylon.js engine instance
 * @constant
 */
const engine = new Engine(canvas, true);

/**
 * Creates and returns a Babylon.js scene with a skybox, a light, a star object,
 * and a ray marching post-process effect that uses a custom GLSL shader
 *
 * @returns {Scene} The created scene
 */
const createScene = (): Scene => {
  const scene = new Scene(engine);
  //scene.debugLayer.show({ overlay: false });
  scene.clearColor.set(0, 0, 0, 1);

  // Création d'une FreeCamera à la position souhaitée
  const camera = new FreeCamera(
    "freeCamera",
    ScaleManager.toSimulationVector(new Vector3(0, 0, -424_500)),
    scene
  );

  // Orienter la caméra vers le centre de la scène
  camera.setTarget(Vector3.Zero());
  camera.attachControl(canvas, true);
  camera.minZ = 0.01;
  camera.maxZ = 100_000_000_000;

  // Définir les touches de déplacement pour un clavier AZERT (zqsd)
  camera.keysUp = [90]; // touche Z pour avancer
  camera.keysLeft = [81]; // touche Q pour aller à gauche
  camera.keysDown = [83]; // touche S pour reculer
  camera.keysRight = [68]; // touche D pour aller à droite

  // (Optionnel) Ajuster la vitesse de déplacement
  camera.speed = 0.05;

  // Add Skybox
  const skybox = MeshBuilder.CreateBox("skyBox", { size: 1000 }, scene);
  const skyboxMaterial = new StandardMaterial("skyBox", scene);

  skyboxMaterial.backFaceCulling = false;
  skyboxMaterial.disableLighting = true;
  skybox.material = skyboxMaterial;
  skybox.infiniteDistance = true;
  skyboxMaterial.disableLighting = true;

  skyboxMaterial.reflectionTexture = new CubeTexture("textures/skybox", scene);
  skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;

  // Create a "star" mesh (a small sphere) positioned at the origin
  const sphereRadius = ScaleManager.toSimulationUnits(696_342);
  const sphere = MeshBuilder.CreateSphere(
    "star",
    { diameter: sphereRadius },
    scene
  );
  sphere.position = new Vector3(0, 0, 0);
  const sphereMaterial = new StandardMaterial("sphereMat", scene);
  sphereMaterial.diffuseColor = new Color3(1, 1, 1);
  sphereMaterial.alpha = 0;
  sphere.material = sphereMaterial;

  // Update collision detection on every frame
  scene.onBeforeRenderObservable.add(() => {
    // Recalculate the current camera origin and direction
    const currentOrigin = camera.position.clone();
    const currentDirection = camera.getForwardRay().direction.clone();
    const ray = new Ray(currentOrigin, currentDirection, 1000);
  });

  // Create a post-process for ray marching using the custom shader
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

  // Create a DepthRenderer to generate a depth texture
  const depthRenderer = new DepthRenderer(scene);
  depthRenderer.useOnlyInActiveCamera = true;
  const depthTexture = depthRenderer.getDepthMap();

  // Set uniforms for the post-process
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
