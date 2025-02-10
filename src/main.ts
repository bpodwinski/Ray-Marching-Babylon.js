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
  Matrix,
  StandardMaterial,
  Color3,
  DepthRenderer,
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
  const light = new PointLight("light", new Vector3(-10, 5, 10), scene);

  // Plane
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 20, height: 20 },
    scene
  );
  ground.position = new Vector3(0, 0, 0);
  const groundMaterial = new StandardMaterial("groundMat", scene);
  groundMaterial.diffuseColor = new Color3(0.4, 0.43, 0.4);
  ground.material = groundMaterial;

  // Cube
  const cube = MeshBuilder.CreateBox("cube", { size: 2 }, scene);
  cube.position = new Vector3(0, 1, 0);

  // Sphere
  const sphere = MeshBuilder.CreateSphere("sphere", { diameter: 3 }, scene);
  sphere.position = new Vector3(0, 1.45, 4);

  let collisionDetected = 0.0; // Valeur envoyée au shader

  // Fonction pour vérifier si le rayon intersecte le cube
  scene.onBeforeRenderObservable.add(() => {
    // Recalculer l'origine et la direction à chaque frame
    const currentOrigin = camera.position.clone();
    const currentDirection = camera.getForwardRay().direction.clone();
    const ray = new Ray(currentOrigin, currentDirection, 1000);

    if (ray.intersectsMesh(cube, true)) {
      collisionDetected = 1.0;
    } else {
      collisionDetected = 0.0;
    }
  });

  // Shader Post-Process Ray Marching
  const postProcess = new PostProcess(
    "rayMarching",
    "rayMarchingShader",
    [
      "resolution",
      "time",
      "collisionDetected",
      "cameraPosition",
      "cubePosition",
      "inverseProjection",
      "inverseView",
      "cameraNear",
      "cameraFar",
    ],
    null,
    1,
    camera
  );

  // Créer un DepthRenderer pour la scène
  const depthRenderer = new DepthRenderer(scene);
  //depthRenderer.useOnlyInActiveCamera = true; // Facultatif, pour limiter le calcul à la caméra active

  // Vous pouvez accéder à la texture de profondeur ainsi :
  const depthTexture = depthRenderer.getDepthMap();

  postProcess.onApply = (effect) => {
    effect.setVector2("resolution", new Vector2(canvas.width, canvas.height));
    effect.setFloat("time", performance.now() * 0.001);
    effect.setFloat("collisionDetected", collisionDetected);
    effect.setVector3("cameraPosition", camera.position);
    effect.setVector3("cubePosition", cube.position);
    effect.setMatrix(
      "inverseProjection",
      Matrix.Invert(camera.getProjectionMatrix())
    );
    effect.setMatrix("inverseView", Matrix.Invert(camera.getViewMatrix()));
    effect.setFloat("cameraNear", camera.minZ);
    effect.setFloat("cameraFar", camera.maxZ);
    effect.setTexture("depthSampler", depthTexture);
  };
  //postProcess.alphaMode = Engine.ALPHA_SCREENMODE;

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
    uniform vec3 cubePosition;
    uniform mat4 inverseProjection;
    uniform mat4 inverseView;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform sampler2D depthSampler;
    uniform sampler2D textureSampler;

    float remap(float value, float min1, float max1, float min2, float max2) {
      return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
    }

    // Calcule la position en monde d'un pixel à partir de ses coordonnées UV et d'une valeur de profondeur
    vec3 worldFromUV(vec2 UV, float depth) {
        // Conversion des UV en coordonnées NDC [-1, 1]
        vec4 ndc = vec4(UV * 2.0 - 1.0, 0.0, 1.0);
        
        // Dé-projection en espace de vue
        vec4 posVS = inverseProjection * ndc;
        
        // Correction pour la profondeur (depth remappé de [0,1] à [cameraNear, cameraFar])
        posVS.xyz *= remap(depth, 0.0, 1.0, cameraNear, cameraFar);
        
        // Transformation en espace monde
        vec4 posWS = inverseView * vec4(posVS.xyz, 1.0);
        return posWS.xyz;
    }

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
            float d = sdfBox(p - cubePosition, vec3(1.0)); // Cube de taille 2
            if (d < 0.001) return t;
            t += d;
            if (t > 100.0) break;
        }
        return -1.0;
    }

    void main() {
        // Calcul des coordonnées UV en [0, 1]
        vec2 uv = gl_FragCoord.xy / resolution.xy;

        // Récupérer la couleur de la scène originale
        vec3 sceneColor = texture2D(textureSampler, uv).rgb;

        // Récupérer la valeur de profondeur (utilisez texture2D en WebGL 1)
        float depthValue = texture2D(depthSampler, uv).r;
        
        // On peut choisir une profondeur arbitraire (ici 1.0, ou adapter selon vos besoins)
        vec3 worldPos = worldFromUV(uv, 1.0);

        // La direction du rayon est le vecteur entre la position de la caméra et la position dé-projetée
        vec3 rd = normalize(worldPos - cameraPosition);
        
        // L'origine du rayon est la position de la caméra
        vec3 ro = cameraPosition;

        // Lancer les rayons de ray marching
        float t = rayMarch(ro, rd);
        
        vec3 effectColor = sceneColor;
        if (t > 0.0) {
            // Ici, au lieu d'afficher une couleur fixe, on peut afficher la profondeur du cube.
            // Par exemple, mapper depthValue en niveaux de gris :
            // effectColor = vec3(depthValue);
            // Vous pouvez aussi choisir d'afficher vert/orange selon collisionDetected, en mélangeant avec la profondeur :
            effectColor = mix(vec3(depthValue), (collisionDetected > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(1.0, 0.5, 0.2)), 0.3);
        }
        
        gl_FragColor = vec4(effectColor, 1.0);
    }
`;
