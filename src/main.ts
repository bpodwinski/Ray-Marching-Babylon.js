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
    20,
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
  const cube = MeshBuilder.CreateSphere("cube", { diameter: 2 }, scene);
  cube.position = new Vector3(0, 1, 0);

  // Sphere
  // const sphere = MeshBuilder.CreateSphere("sphere", { diameter: 3 }, scene);
  // sphere.position = new Vector3(0, 1.45, 6);

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
  depthRenderer.useOnlyInActiveCamera = true; // Facultatif, pour limiter le calcul à la caméra active

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

    // SDF cube
    float sdfBox(vec3 p, vec3 b) {
        vec3 d = abs(p) - b;
        return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
    }

    // SDF sphere
    float sdfSphere(vec3 p, vec3 sphereCenter, float radius) {
        return length(p - sphereCenter) - radius;
    }

    // Fonction de ray marching modifiée pour accumuler un glow volumétrique
    float rayMarch(vec3 ro, vec3 rd, out float glow) {
        float t = 0.0;
        glow = 0.0;
        bool hit = false;
        const int steps = 100; // On peut augmenter le nombre d'itérations pour un effet plus prononcé
        for (int i = 0; i < steps; i++) {
            vec3 p = ro + t * rd;

            // Calcul de la distance signée au cube (déplacé par cubePosition)
            // float d = sdfBox(p - cubePosition, vec3(1.0));

            // Calcul de la distance signée au cube (déplacé par cubePosition)
            float d = sdfSphere(p, cubePosition, 1.0);
            
            // Accumulation de la contribution glow :
            // Plus d est faible (donc proche de la surface), plus la contribution est forte.
            // Ici, le facteur 15.0 et 0.1 sont des coefficients à ajuster selon l'effet désiré.
            // glow += exp(-d * 1.0) * 0.2;
            //glow += exp(-d * 1.0) * 0.2 * (0.5 + 0.5 * sin(time * 2.0));
            glow += exp(-d * (1.0 + 0.5 * sin(time))) * 0.2;
            
            // Marquer l'intersection mais ne pas arrêter l'intégration
            if (!hit && d < 50.0) {
                hit = true;
            }
            
            t += d;
            if (t > 100.0) break;
        }
        // Retourne t si on a détecté un hit, sinon -1.0
        return hit ? t : -1.0;
    }

    void main() {
        // Calcul des coordonnées UV en [0, 1]
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        
        // Récupérer la couleur de la scène originale
        vec3 sceneColor = texture2D(textureSampler, uv).rgb;
        
        // On choisit une profondeur arbitraire (ici 1.0, à ajuster si besoin)
        vec3 worldPos = worldFromUV(uv, 1.0);
        
        // Calcul de la direction du rayon et de son origine
        vec3 rd = normalize(worldPos - cameraPosition);
        vec3 ro = cameraPosition;
        
        // Ray marching avec accumulation de glow
        float glow;
        float t = rayMarch(ro, rd, glow);
        
        vec3 effectColor = sceneColor;
        if (t > 0.0) {
            // Ajoute le glow à la couleur de la scène originale.
            effectColor = sceneColor + vec3(glow);
            // Optionnel : on peut clamp pour éviter des valeurs trop élevées.
            effectColor = clamp(effectColor, 0.0, 1.0);
        } else {
            effectColor = sceneColor;
        }
        
        gl_FragColor = vec4(effectColor, 1.0);
    }
`;
