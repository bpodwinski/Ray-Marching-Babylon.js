import {
  Engine,
  Scene,
  ArcRotateCamera,
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
} from "@babylonjs/core";

import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";

import rayMarchingShaderFragment from "./shaders/rayMarchingShaderFragment.glsl?raw";
Effect.ShadersStore["rayMarchingShaderFragmentShader"] =
  rayMarchingShaderFragment;

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
  scene.debugLayer.show({ overlay: false });
  scene.clearColor.set(0, 0, 0, 1);

  // Création d'une FreeCamera à la position souhaitée
  const camera = new FreeCamera("freeCamera", new Vector3(0, 2, -10), scene);

  // Orienter la caméra vers le centre de la scène
  camera.setTarget(Vector3.Zero());

  // Attacher les contrôles sur le canvas
  camera.attachControl(canvas, true);

  // Définir les touches de déplacement pour un clavier AZERT (zqsd)
  camera.keysUp = [90]; // touche Z pour avancer
  camera.keysLeft = [81]; // touche Q pour aller à gauche
  camera.keysDown = [83]; // touche S pour reculer
  camera.keysRight = [68]; // touche D pour aller à droite

  // (Optionnel) Ajuster la vitesse de déplacement
  camera.speed = 0.05;

  // Create a skybox using an HDR cube texture
  // const environmentMap = new HDRCubeTexture(
  //   "https://bpodwinski.github.io/Ray-Marching-Babylon.js/starmap_2020_4k.hdr",
  //   scene,
  //   1024
  // );
  // scene.createDefaultSkybox(environmentMap, true, 1000);
  // scene.environmentTexture = environmentMap;

  // Create a "star" mesh (a small sphere) positioned at the origin
  const sphereRadius = 8;
  const sphere = MeshBuilder.CreateSphere(
    "star",
    { diameter: sphereRadius },
    scene
  );
  sphere.position = new Vector3(0, 0, 0);
  const sphereMaterial = new StandardMaterial("sphereMat", scene);
  sphereMaterial.diffuseColor = new Color3(1, 1, 1);
  sphereMaterial.alpha = 0.0;

  // Assigner le matériau à la sphère
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
    effect.setFloat("time", performance.now() * 0.001);
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
