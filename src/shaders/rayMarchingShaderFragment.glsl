precision highp float;

// Uniforms
uniform vec2 resolution;               // Screen resolution (width, height)
uniform float time;                    // Time in seconds (for dynamic effects)
uniform vec3 cameraPosition;           // Camera world position
uniform vec3 spherePosition;           // Sphere center position (used in the SDF)
uniform float sphereRadius;            // Radius of the sphere used in the SDF
uniform mat4 inverseProjection;        // Inverse of the camera's projection matrix
uniform mat4 inverseView;              // Inverse of the camera's view matrix
uniform float cameraNear;              // Near clipping plane distance
uniform float cameraFar;               // Far clipping plane distance
uniform sampler2D depthSampler;        // Depth texture sampler
uniform sampler2D textureSampler;      // Original scene texture sampler

// ----------------------
// Cellular Noise
// ----------------------

vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
}

float cellularNoise(vec3 P) {
    vec3 Pi = floor(P);
    vec3 Pf = fract(P);
    float F1 = 1.0; // On va chercher la distance minimale

    // Parcourir les cellules voisines (3x3x3)
    for(int xi = -1; xi <= 1; xi++) {
        for(int yi = -1; yi <= 1; yi++) {
            for(int zi = -1; zi <= 1; zi++) {
                vec3 offset = vec3(float(xi), float(yi), float(zi));
                // Obtenir le point caractéristique aléatoire de la cellule
                vec3 cellPoint = hash3(Pi + offset);
                // Calculer la distance entre notre point et le point caractéristique
                vec3 diff = offset + cellPoint - Pf;
                float d = length(diff);
                F1 = min(F1, d);
            }
        }
    }
    return F1;
}

// ----------------------
// Noise and FBM functions
// ----------------------

// Hash function for 3D noise
float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
}

// 3D Noise function with trilinear interpolation
float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    vec3 u = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec3(1.0, 0.0, 0.0));
    float c = hash(i + vec3(0.0, 1.0, 0.0));
    float d = hash(i + vec3(1.0, 1.0, 0.0));
    float e = hash(i + vec3(0.0, 0.0, 1.0));
    float f0 = hash(i + vec3(1.0, 0.0, 1.0));
    float g = hash(i + vec3(0.0, 1.0, 1.0));
    float h = hash(i + vec3(1.0, 1.0, 1.0));

    float mix1 = mix(a, b, u.x);
    float mix2 = mix(c, d, u.x);
    float mix3 = mix(e, f0, u.x);
    float mix4 = mix(g, h, u.x);

    float mix5 = mix(mix1, mix2, u.y);
    float mix6 = mix(mix3, mix4, u.y);

    return mix(mix5, mix6, u.z);
}

// Fractal Brownian Motion (FBM) function
float fbm(vec3 p) {
    float total = 0.0;
    float amplitude = 0.5;
    float frequency = 20.0;
    const int octaves = 5;
    for(int i = 0; i < octaves; i++) {
        total += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return total;
}

// ----------------------
// Utility Functions
// ----------------------

// Remaps a value from one range to another.
float remap(float value, float min1, float max1, float min2, float max2) {
    return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

// Computes the world-space position from UV coordinates and an arbitrary depth.
vec3 worldFromUV(vec2 UV, float depth) {
    vec4 ndc = vec4(UV * 2.0 - 1.0, 0.0, 1.0);
    vec4 posVS = inverseProjection * ndc;
    posVS.xyz *= remap(depth, 0.0, 1.0, cameraNear, cameraFar);
    vec4 posWS = inverseView * vec4(posVS.xyz, 1.0);
    return posWS.xyz;
}

// SDF for a sphere with FBM noise displacement.
float sdfSphere(vec3 p, vec3 sphereCenter, float radius) {
    float baseDist = length(p - sphereCenter) - radius * 0.5;
    vec3 radialDir = normalize(p - sphereCenter);

    //float displacement = fbm((p - sphereCenter) * 3.0 - radialDir * time) * 0.25;
    float displacement = cellularNoise((p - sphereCenter) * 20.0 - radialDir * time) * 0.07;

    return baseDist + displacement;
}

// Fire palette function to map density to a fire-like color.
vec3 firePalette(float i) {
    float T = 1400.0 + 1200.0 * (1.5 - i); // Temperature range in Kelvin
    vec3 L = vec3(6.4, 5.6, 4.4);   // Wavelengths for R, G, B (scaled)

    L = pow(L, vec3(5.0)) * (exp(1.43876719683e5 / (T * L)) - 1.0);
    return 1.0 - exp(-5e8 / L);
}

// --------------------------------------------------------------------
// Function: computeVolumetricColor
// Effectue le raymarching volumétrique et renvoie un vec4
// dont rgb = couleur volumétrique et a = alpha (facteur de mélange).
// --------------------------------------------------------------------
vec4 computeVolumetricColor(vec3 ro, vec3 rd) {
    float t = 0.0;      // Distance parcourue le long du rayon
    float ld = 0.0;     // Densité locale
    float td = 0.0;     // Densité totale accumulée
    float w = 0.0;      // Facteur de pondération
    float d = 1.0;      // Pas de distance issu de la SDF
    const float h = 0.1;// Seuil pour l'accumulation
    vec3 tc = vec3(0.0); // Accumulateur de couleur (densité)

    for(int i = 0; i < 32; i++) {
        if(td > (1.5 - 1.0 / 200.0) || d < 0.001 * t || t > 1000.0)
            break;
        vec3 p = ro + t * rd;
        d = sdfSphere(p, spherePosition, sphereRadius);
        ld = (h - d) * step(d, h);
        w = (1.4 - td) * ld;
        tc += w * w + 1.0 / 50.0;
        td += w + 1.0 / 200.0;
        d = max(d, 0.05);
        t += d * 0.6;
    }
    vec3 volColor = firePalette(tc.x);
    float alpha = clamp(td, 0.0, 1.0);
    return vec4(volColor, alpha);
}

// ----------------------
// Main fragment shader entry point
// ----------------------
void main() {
    // Calcul des coordonnées UV
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    // Récupération de la couleur de la scène (arrière-plan) depuis la texture
    vec3 sceneColor = texture2D(textureSampler, uv).rgb;

    // Conversion des UV en position dans l'espace monde
    vec3 worldPos = worldFromUV(uv, 1.0);

    // Calcul de la direction du rayon depuis la caméra
    vec3 rd = normalize(worldPos - cameraPosition);
    vec3 ro = cameraPosition;

    // Appel de la fonction de raymarching volumétrique
    vec4 volData = computeVolumetricColor(ro, rd);
    vec3 volumetricColor = volData.rgb;
    float alpha = volData.a;

    // Mélange de la couleur de la scène et de l'effet volumétrique
    vec3 finalColor = mix(sceneColor, volumetricColor, alpha);

    gl_FragColor = vec4(finalColor, 1.0);
}
