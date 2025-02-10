# Ray Marching with Babylon.js Demo

This project is a demo showcasing real-time ray marching techniques using Babylon.js. The demo uses custom GLSL shaders to render SDF-based objects with dynamic glow effects.

## Features

- **Ray Marching:** Custom GLSL shader using Signed Distance Functions (SDF) for objects.
- **Dynamic Glow:** The shader accumulates a dynamic glow effect.

### Ray Data Transmission to the Shader
Babylon.js calculates the ray's origin and direction on the CPU using methods like `camera.getForwardRay()`. Collision detection is performed in the application code. Instead of sending the full ray to the shader, only key data is passed as uniforms:

## Demo
[https://bpodwinski.github.io/Ray-Marching-Babylon.js/](https://bpodwinski.github.io/Ray-Marching-Babylon.js/)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v12 or later)
- [npm](https://www.npmjs.com/)
