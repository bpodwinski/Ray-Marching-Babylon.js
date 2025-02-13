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

// Prédéfinition des 27 offsets dans un tableau constant
const vec3 offsets[27] = vec3[27](vec3(-1.0, -1.0, -1.0), vec3(0.0, -1.0, -1.0), vec3(1.0, -1.0, -1.0), vec3(-1.0, 0.0, -1.0), vec3(0.0, 0.0, -1.0), vec3(1.0, 0.0, -1.0), vec3(-1.0, 1.0, -1.0), vec3(0.0, 1.0, -1.0), vec3(1.0, 1.0, -1.0), vec3(-1.0, -1.0, 0.0), vec3(0.0, -1.0, 0.0), vec3(1.0, -1.0, 0.0), vec3(-1.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0), vec3(1.0, 0.0, 0.0), vec3(-1.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), vec3(-1.0, -1.0, 1.0), vec3(0.0, -1.0, 1.0), vec3(1.0, -1.0, 1.0), vec3(-1.0, 0.0, 1.0), vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 1.0), vec3(-1.0, 1.0, 1.0), vec3(0.0, 1.0, 1.0), vec3(1.0, 1.0, 1.0));

/// Computes a simplified cellular noise value.
/// It returns the difference between the two smallest distances within the 3x3x3 neighborhood.
///
/// @param P The input 3D point.
/// @return The cellular noise value (F2 - F1).
float cellularNoise(vec3 P) {
    vec3 Pi = floor(P);
    vec3 Pf = fract(P);
    float F1 = 1e10;
    float F2 = 1e10;

    // Iterate over the predefined 27 offsets.
    for(int i = 0; i < 27; i++) {
        vec3 offset = offsets[i];
        vec3 cellPoint = hash3(Pi + offset);
        vec3 diff = offset + cellPoint - Pf;
        float d = length(diff);
        if(d < F1) {
            F2 = F1;
            F1 = d;
        } else if(d < F2) {
            F2 = d;
        }
    }
    return F2 - F1;
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
    //float displacement = cellularNoise((p - sphereCenter) * 20.0 - radialDir * time) * 0.07;

    float displacement = smoothstep(0.05, 0.55, cellularNoise((p - sphereCenter) * 2.0 - radialDir * time)) * 0.05;

    return baseDist + displacement;
}

// Fire palette function to map density to a fire-like color.
// vec3 firePalette(float i) {
//     float T = 1400.0 + 1200.0 * i; // Temperature range in Kelvin
//     vec3 L = vec3(7.4, 5.6, 4.4);   // Wavelengths for R, G, B (scaled)

//     L = pow(L, vec3(5.0)) * (exp(1.43876719683e5 / (T * L)) - 1.0);
//     return 1.0 - exp(-5e8 / L);
// }

vec3 firePalette(float i) {
    // Inverser et remapper i non linéairement pour accentuer la différence
    float t = pow(0.1 + i, 2.0);  // Plus i est faible (centre), plus t est élevé
    // Ici, T varie de 1400K à 2600K en fonction de t
    float T = 1400.0 + 1200.0 * t;
    vec3 L = vec3(7.4, 5.6, 4.4);
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

    for(int i = 0; i < 48; i++) {
        if(td > 2.0 || d < 0.000001 * t || t > 10000.0)
            break;
        vec3 p = ro + t * rd;
        d = sdfSphere(p, spherePosition, sphereRadius * 1.158);
        ld = (h - d) * step(d, h);
        w = (1.4 - td) * ld;
        tc += w * w + 1.0 / 70.0;
        td += w + 1.0 / 200.0;
        d = max(d, 0.01);
        t += d * 0.9;
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

    // Récupération de la couleur de la scène (arrière-plan)
    vec3 sceneColor = texture2D(textureSampler, uv).rgb;

    // Conversion des UV en position dans l'espace monde
    vec3 worldPos = worldFromUV(uv, 1.0);

    // Calcul de la direction du rayon depuis la caméra
    vec3 rd = normalize(worldPos - cameraPosition);
    vec3 ro = cameraPosition;

    vec4 volData = computeVolumetricColor(ro, rd);
    vec3 volumetricColor = volData.rgb;
    float alpha = volData.a;

    vec3 finalColor = mix(sceneColor, volumetricColor, alpha);

    gl_FragColor = vec4(finalColor, 1.0);
}