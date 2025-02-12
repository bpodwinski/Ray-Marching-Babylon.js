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
    float frequency = 10.0;
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

/**
 * @brief Remaps a value from one range to another.
 */
float remap(float value, float min1, float max1, float min2, float max2) {
    return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

/**
 * @brief Computes the world-space position from UV coordinates and an arbitrary depth.
 */
vec3 worldFromUV(vec2 UV, float depth) {
    vec4 ndc = vec4(UV * 2.0 - 1.0, 0.0, 1.0);
    vec4 posVS = inverseProjection * ndc;
    posVS.xyz *= remap(depth, 0.0, 1.0, cameraNear, cameraFar);
    vec4 posWS = inverseView * vec4(posVS.xyz, 1.0);
    return posWS.xyz;
}

/**
 * @brief Signed Distance Function (SDF) for a sphere with FBM noise.
 */
float sdfSphere(vec3 p, vec3 sphereCenter, float radius) {
    float baseDist = length(p - sphereCenter) - radius * 0.5;
    float displacement = fbm(p * 2.0 + time) * 0.1;
    return baseDist + displacement;
}

/**
 * @brief Ray marches to detect a sphere intersection.
 */
float rayMarch(vec3 ro, vec3 rd) {
    float t = 0.0;
    const int steps = 100;
    const float maxDistance = 1000.0;
    const float hitThreshold = 0.1;

    for(int i = 0; i < steps; i++) {
        vec3 p = ro + t * rd;
        float d = sdfSphere(p, spherePosition, sphereRadius);
        if(d < hitThreshold) {
            return t;
        }
        t += d;
        if(t > maxDistance)
            break;
    }
    return -1.0;
}

/**
 * @brief Main fragment shader entry point.
 */
void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 sceneColor = texture2D(textureSampler, uv).rgb;
    vec3 worldPos = worldFromUV(uv, 1.0);
    vec3 rd = normalize(worldPos - cameraPosition);
    vec3 ro = cameraPosition;

    float t = rayMarch(ro, rd);

    vec3 effectColor = sceneColor;
    if(t > 0.0) {
        effectColor = vec3(1.0, 0.9, 0.0);
    } else {
        effectColor = sceneColor;
    }

    gl_FragColor = vec4(effectColor, 1.0);
}
