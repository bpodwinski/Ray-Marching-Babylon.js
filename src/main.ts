import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  MeshBuilder,
  PostProcess,
  Vector2,
  Effect,
  PointLight,
  Ray,
} from "@babylonjs/core";
import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";

// Création de la scène
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas introuvable !");
const engine = new Engine(canvas, true);

const createScene = () => {
  const scene = new Scene(engine);
  scene.debugLayer.show({ overlay: true });

  // Ajout d'une caméra
  const camera = new ArcRotateCamera(
    "camera",
    Math.PI / 4,
    Math.PI / 4,
    5,
    new Vector3(0, 0, 0),
    scene
  );
  camera.attachControl(canvas, true);

  // Lumière
  const light = new PointLight("light", new Vector3(0, 3, 2), scene);

  // Cube principal
  const cube = MeshBuilder.CreateBox("cube", { size: 2 }, scene);
  cube.position = new Vector3(0, 0, 0);

  let collisionDetected = 0.0; // Valeur envoyée au shader
  const rayOrigin = camera.position;
  const rayDirection = camera.getForwardRay().direction;

  // Fonction pour vérifier si le rayon intersecte le cube
  scene.onBeforeRenderObservable.add(() => {
    const ray = new Ray(rayOrigin, rayDirection, 1000);

    if (ray.intersectsMesh(cube, true)) {
      collisionDetected = 1.0; // Collision détectée
    } else {
      collisionDetected = 0.0; // Pas de collision
    }
  });

  // Shader Post-Process Ray Marching
  const postProcess = new PostProcess(
    "rayMarching",
    "rayMarchingShader",
    ["resolution", "time", "collisionDetected", "cameraPosition", "viewMatrix"],
    null,
    1,
    camera
  );

  postProcess.onApply = (effect) => {
    effect.setVector2("resolution", new Vector2(canvas.width, canvas.height));
    effect.setFloat("time", performance.now() * 0.001);
    effect.setFloat("collisionDetected", collisionDetected);
    effect.setVector3("cameraPosition", camera.position);
    effect.setMatrix("viewMatrix", camera.getViewMatrix());
  };

  return scene;
};

const scene = createScene();
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());

// Shader Ray Marching SDF
Effect.ShadersStore["rayMarchingShaderFragmentShader"] = `
    precision highp float;

    uniform vec2 resolution;
    uniform float time;
    uniform float collisionDetected;
    uniform vec3 cameraPosition;
    uniform mat4 viewMatrix;

    // Signed Distance Function (SDF) pour un cube
    float sdfBox(vec3 p, vec3 b) {
        vec3 d = abs(p) - b;
        return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
    }

    // Ray Marching : Chaque pixel lance un rayon
    float rayMarch(vec3 ro, vec3 rd) {
        float t = 0.0;
        for (int i = 0; i < 100; i++) {
            vec3 p = ro + t * rd;
            float d = sdfBox(p, vec3(1.0)); // Cube de taille 2
            if (d < 0.001) return t;
            t += d;
            if (t > 10.0) break;
        }
        return -1.0;
    }

    void main() {
        // Transformation UV pour adapter à la résolution
        vec2 uv = (gl_FragCoord.xy / resolution.xy) * 2.0 - 1.0;
        uv.x *= resolution.x / resolution.y;

        // Champ de vision (FOV) correct pour une caméra en perspective
        float fov = 1.0;
        vec3 rd = normalize(vec3(uv * fov, -1.0));

        // Transformation du rayon avec la matrice de vue de Babylon.js
        rd = (viewMatrix * vec4(rd, 0.0)).xyz;
        
        // Position de départ des rayons = position de la caméra
        vec3 ro = cameraPosition;

        // Lancer les rayons de ray marching
        float t = rayMarch(ro, rd);
        vec3 col = vec3(0.0);

        if (t > 0.0) {
            col = vec3(1.0, 0.5, 0.2); // Couleur par défaut
            if (collisionDetected > 0.5) {
                col = vec3(0.0, 1.0, 0.0); // Changement de couleur si collision détectée
            }
        }
        
        gl_FragColor = vec4(col, 1.0);
    }
`;
