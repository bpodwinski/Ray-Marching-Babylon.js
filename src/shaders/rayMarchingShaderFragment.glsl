precision highp float;

// Uniforms
uniform vec2 resolution;               // Screen resolution (width, height)
uniform float time;                    // Time in seconds (for dynamic effects)
uniform float collisionDetected;       // Collision flag (1.0 if collision detected, 0.0 otherwise)
uniform vec3 cameraPosition;           // Camera world position
uniform vec3 spherePosition;           // Sphere center position (used in the SDF)
uniform float sphereRadius;            // Radius of the sphere used in the SDF
uniform mat4 inverseProjection;        // Inverse of the camera's projection matrix
uniform mat4 inverseView;              // Inverse of the camera's view matrix
uniform float cameraNear;              // Near clipping plane distance
uniform float cameraFar;               // Far clipping plane distance
uniform sampler2D depthSampler;        // Depth texture sampler
uniform sampler2D textureSampler;      // Original scene texture sampler

/**
 * @brief Remaps a value from one range to another.
 * 
 * @param value The value to remap.
 * @param min1  The minimum of the original range.
 * @param max1  The maximum of the original range.
 * @param min2  The minimum of the target range.
 * @param max2  The maximum of the target range.
 * @return float The remapped value.
 */
float remap(float value, float min1, float max1, float min2, float max2) {
    return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

/**
 * @brief Computes the world-space position from UV coordinates and an arbitrary depth.
 *
 * Converts the UV coordinates (in [0,1]) to Normalized Device Coordinates,
 * unprojects them into view space using the inverse projection matrix, applies a depth
 * correction, and then transforms the result into world space.
 *
 * @param UV The UV coordinates.
 * @param depth A normalized depth value (typically between 0 and 1).
 * @return vec3 The computed world position.
 */
vec3 worldFromUV(vec2 UV, float depth) {
    // Convert UV to NDC coordinates in the range [-1, 1]
    vec4 ndc = vec4(UV * 2.0 - 1.0, 0.0, 1.0);

    // Unproject to view space
    vec4 posVS = inverseProjection * ndc;

    // Apply depth correction (remap depth from [0,1] to [cameraNear, cameraFar])
    posVS.xyz *= remap(depth, 0.0, 1.0, cameraNear, cameraFar);

    // Transform to world space using the inverse view matrix
    vec4 posWS = inverseView * vec4(posVS.xyz, 1.0);
    return posWS.xyz;
}

/**
 * @brief Signed Distance Function (SDF) for a sphere.
 *
 * Computes the signed distance from point p to a sphere with center sphereCenter and radius.
 *
 * @param p The point in space.
 * @param sphereCenter The center of the sphere.
 * @param radius The radius of the sphere.
 * @return float The signed distance to the sphere.
 */
float sdfSphere(vec3 p, vec3 sphereCenter, float radius) {
    return length(p - sphereCenter) - radius * 0.5;
}

/**
 * @brief Ray marches to detect a sphere intersection.
 *
 * Marches a ray from origin (ro) along the normalized direction (rd) and computes the sphere's SDF.
 * Returns the ray distance when the SDF falls below the hit threshold, or -1.0 if no intersection occurs.
 *
 * @param ro The ray origin in world space.
 * @param rd The normalized ray direction.
 * @return float The distance to the intersection, or -1.0 if none.
 */
float rayMarch(vec3 ro, vec3 rd) {
    float t = 0.0; // Current distance traveled along the ray
    const int steps = 100; // Maximum number of iterations/steps
    const float maxDistance = 1000.0; // Maximum distance to march before giving up
    const float hitThreshold = 0.05; // Distance threshold to consider the ray as hitting the surface

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
 *
 * Computes UV coordinates, retrieves the original scene color, unprojects UV to world space,
 * performs ray marching to accumulate a glow effect, and blends the glow with the original
 * scene color.
 */
void main() {
    // Compute UV coordinates in [0,1]
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    // Get the original scene color from the texture sampler
    vec3 sceneColor = texture2D(textureSampler, uv).rgb;

    // Compute world position from UV with an arbitrary depth (1.0)
    vec3 worldPos = worldFromUV(uv, 1.0);

    // Calculate the ray direction and set the origin as the camera position
    vec3 rd = normalize(worldPos - cameraPosition);
    vec3 ro = cameraPosition;

    // Perform ray marching and accumulate the glow effect
    float t = rayMarch(ro, rd);

    vec3 effectColor = sceneColor;
    if(t > 0.0) {
        effectColor = vec3(1.0, 0.9, 0.0);
    } else {
        effectColor = sceneColor;
    }

    gl_FragColor = vec4(effectColor, 1.0);
}
