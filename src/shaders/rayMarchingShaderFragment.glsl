/**
 * @file rayMarchingShaderFragment.glsl
 * @brief Fragment shader implementing ray marching with SDF and dynamic glow.
 *
 * This shader computes world positions from UV coordinates, performs ray marching
 * on a sphere SDF (which can be easily replaced with other SDFs), accumulates a
 * volumetric glow (modulated by time), and blends the glow effect with the original
 * scene color.
 */

precision highp float;

// Uniforms
uniform vec2 resolution;               // Screen resolution (width, height)
uniform float time;                    // Time in seconds (for dynamic effects)
uniform float collisionDetected;       // Collision flag (1.0 if collision detected, 0.0 otherwise)
uniform vec3 cameraPosition;           // Camera world position
uniform vec3 cubePosition;             // SDF object's position (used here as the sphere's center)
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
 * @brief Signed Distance Function (SDF) for a box.
 *
 * Computes the signed distance from point p to a box centered at the origin with
 * half-dimensions b.
 *
 * @param p The point in space.
 * @param b The half-dimensions of the box.
 * @return float The signed distance to the box.
 */
float sdfBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
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
    return length(p - sphereCenter) - radius;
}

/**
 * @brief Performs ray marching and accumulates a dynamic volumetric glow.
 *
 * Marches a ray from the origin (ro) in direction (rd), computes the SDF for a sphere
 * centered at cubePosition with radius 1.0, and accumulates a glow effect based on
 * the distance to the surface. The glow intensity is modulated by time.
 *
 * @param ro The ray origin.
 * @param rd The normalized ray direction.
 * @param glow Output parameter that accumulates the glow value.
 * @return float The distance along the ray if an intersection is detected; otherwise, -1.0.
 */
float rayMarch(vec3 ro, vec3 rd, out float glow) {
    float t = 0.0;
    glow = 0.0;
    bool hit = false;

    // Increase for a more pronounced effect
    const int steps = 100;

    // Define a threshold for glow accumulation
    float threshold = 80.0;

    for(int i = 0; i < steps; i++) {
        vec3 p = ro + t * rd;

        // Compute the signed distance from point p to the sphere SDF
        float d = sdfSphere(p, cubePosition, 1.0);

        // Use smoothstep to modulate glow accumulation based on the distance d.
        // When d is small (close to the surface), the contribution is high.
        // When d is greater than 'threshold', the contribution smoothly goes to 0.
        float glowContribution = 1.0 - smoothstep(0.0, threshold, d);

        // Accumulate glow contribution dynamically using time modulation
        glow += glowContribution * 0.2 * (1.0 + 0.3 * sin(time));

        // Mark hit if the distance is below a threshold (here, 50.0)
        if(!hit && d < 100.0) {
            hit = true;
        }

        t += d;
        if(t > 100000.0)
            break;
    }
    return hit ? t : -1.0;
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
    float glow;
    float t = rayMarch(ro, rd, glow);

    // Blend the glow with the original scene color
    vec3 glowColor = vec3(0.73, 0.85, 1.0);
    vec3 effectColor = sceneColor;
    if(t > 0.0) {
        // Instead of sceneColor + vec3(glow), multiply glow with the desired color.
        effectColor = sceneColor + glow * glowColor;
        effectColor = clamp(effectColor, 0.0, 1.0);
    } else {
        effectColor = sceneColor;
    }

    gl_FragColor = vec4(effectColor, 1.0);
}
