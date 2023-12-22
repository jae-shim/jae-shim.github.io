import fs from "fs";

function createStorageBuffers(device, GRID_SIZE) {
    // Create an array representing the active state of each cell.
    const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE);

    // Create two storage buffers to hold the cell state.
    const cellStateStorage = [
        device.createBuffer({
            label: "Cell State A",
            size: cellStateArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),
        device.createBuffer({
            label: "Cell State B",
            size: cellStateArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })
    ];

    // Mark every third cell of the first grid as active.
    for (let i = 0; i < cellStateArray.length; i += 3) {
        cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
    }
    device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);

    // Mark every other cell of the second grid as active.
    for (let i = 0; i < cellStateArray.length; i++) {
        cellStateArray[i] = i % 2;
    }
    device.queue.writeBuffer(cellStateStorage[1], 0, cellStateArray);

    return [cellStateStorage];
}

function createUniformBuffers(device, GRID_SIZE) {
    // Create a uniform buffer that describes the grid.
    const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
    const uniformBuffer = device.createBuffer({
        label: "Grid Uniforms",
        size: uniformArray.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    return [uniformBuffer];
}

function createPipeline(device, canvasFormat, pipelineLayout) {
    const triangleVertices = new Float32Array([
        1.0,  1.0, 0.0,
        -1.0,  1.0, 0.0,
        0.0, -1.0, 0.0
    ]);

    const triangleVertexBuffer = device.createBuffer({
        label: "Triangle vertices",
        size: triangleVertices.byteLength,
        usage: GPUBufferUsage.RAY_TRACING | GPUBufferUsage.COPY_DST
    });

    device.queue.writeBuffer(triangleVertexBuffer, /*bufferOffset=*/0, triangleVertices);

    const triangleIndices = new Uint32Array([
        0, 1, 2
    ]);

    const triangleIndexBuffer = device.createBuffer({
        label: "Triangle indices",
        size: triangleIndices.byteLength,
        usage: GPUBufferUsage.RAY_TRACING | GPUBufferUsage.COPY_DST
    });

    device.queue.writeBuffer(triangleIndexBuffer, /*bufferOffset=*/0, triangleIndices);

    let encoder = device.createCommandEncoder();

    const geometryContainer = device.createRayTracingAccelerationContainer({
        level: "bottom",
        flags: GPURayTracingAccelerationContainerFlag.PREFER_FAST_TRACE,
        geometries: [
            {
                type: "triangles", // the geometry kind of the vertices (triangles or aabbs)
                vertex: {
                    buffer: triangleVertexBuffer, // our GPU buffer containing the vertices
                    format: "float3", // one vertex is made up of 3 floats
                    stride: 3 * Float32Array.BYTES_PER_ELEMENT, // the byte stride between each vertex
                    count: triangleVertices.length, // the total amount of vertices
                },
                index: {
                    buffer: triangleIndexBuffer, // (optional) the index buffer to use
                    format: "uint32", // (optional) the format of the index buffer (Uint32Array)
                    count: triangleIndices.length // the total amount of indices
                }
            }
        ]
    });

    device.queue.submit([encoder.finish()]);

    encoder = device.createCommandEncoder();

    const instanceContainer = device.createRayTracingAccelerationContainer({
        level: "top",
        flags: GPURayTracingAccelerationContainerFlag.PREFER_FAST_TRACE,
        instances: [
            {
                flags: GPURayTracingAccelerationInstanceFlag.TRIANGLE_CULL_DISABLE, // disable back-face culling
                mask: 0xFF, // in the shader, you can cull objects based on their mask
                instanceId: 0, // a custom Id which you can use to identify an object in the shaders
                instanceOffset: 0x0, // unused
                transform: { // defines how to position the instance in the world
                    translation: { x: 0, y: 0, z: 0 },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 }
                },
                geometryContainer: geometryContainer // reference to a geometry container
            }
        ]
    });

    device.queue.submit([encoder.finish()]);

    const pixelBufferSize = window.width * window.height * 4 * Float32Array.BYTES_PER_ELEMENT;

    const pixelBuffer = device.createBuffer({
        label: "Pixels",
        size: pixelBufferSize,
        usage: GPUBufferUsage.STORAGE
    });

    const rtBindGroupLayout = device.createBindGroupLayout({
        bindings: [
            // the first binding will be the acceleration container
            {
                binding: 0,
                visibility: GPUShaderStage.RAY_GENERATION,
                type: "acceleration-container"
            },
            // the second binding will be the pixel buffer
            {
                binding: 1,
                visibility: GPUShaderStage.RAY_GENERATION,
                type: "storage-buffer"
            }
        ]
    });

    const rtBindGroup = device.createBindGroup({
        layout: rtBindGroupLayout,
        bindings: [
            {
                binding: 0,
                accelerationContainer: instanceContainer,
                offset: 0,
                size: 0
            },
            {
                binding: 1,
                buffer: pixelBuffer,
                offset: 0,
                size: pixelBufferSize
            }
        ]
    });

    const genShaderModule = device.createShaderModule({
        label: "Ray Generation shader",
        code: fs.readFileSync(`./ray.rgen`, "utf-8") `
        #version 460
        #extension GL_EXT_ray_tracing : enable
        #pragma shader_stage(raygen)
        
        struct RayPayload { vec3 color; };
        layout(location = 0) rayPayloadEXT RayPayload payload;
        
        layout(set = 0, binding = 0) uniform accelerationStructureEXT acc;
        layout(set = 0, binding = 1, std140) buffer PixelBuffer {
            vec4 pixels[];
        } pixelBuffer;
        
        void main() {
            ivec2 ipos = ivec2(gl_LaunchIDEXT.xy);
            const ivec2 resolution = ivec2(gl_LaunchSizeEXT.xy);
            
            vec2 pixelCenter = vec2(gl_LaunchIDEXT.xy) + vec2(0.5);
            
            vec2 d = (pixelCenter / vec2(gl_LaunchSizeEXT.xy)) * 2.0 - 1.0;
            float aspectRatio = float(gl_LaunchSizeEXT.x) / float(gl_LaunchSizeEXT.y);
            
            vec3 rayOrigin = vec3(0, 0, -1.5);
            vec3 rayDir = normalize(vec3(d.x * aspectRatio, -d.y, 1));
            
            uint sbtOffset = 0;
            uint sbtStride = 0;
            uint missIndex = 0;
            payload.color = vec3(0);
            traceRayEXT(
                acc, gl_RayFlagsOpaqueEXT, 0xff,
                sbtOffset, sbtStride, missIndex,
                rayOrigin, 0.001, rayDir, 100.0,
                0
            );
            
            const uint pixelIndex = ipos.y * resolution.x + ipos.x;
            pixelBuffer.pixels[pixelIndex] = vec4(payload.color, 1.0);
        }
        `
    });

    const vertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
            format: "float32x3",
            offset: 0,
            shaderLocation: 0, // Position, see vertex shader
        }],
    };

    const cellShaderModule = device.createShaderModule({
        label: "Cell shader",
        code: `
        struct VertexInput {
            @location(0) pos: vec2f,
            @builtin(instance_index) instance: u32,
        };

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) cell: vec2f,
        };

        @group(0) @binding(0) var<uniform> grid: vec2f;
        @group(0) @binding(1) var<storage> cellState: array<u32>;
        
        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput  {
            let i = f32(input.instance);
            let cell = vec2f(i % grid.x, floor(i / grid.x));
            let state = f32(cellState[input.instance]);
            let cellOffset = cell / grid * 2;
            let gridPos = (input.pos * state + 1) / grid - 1 + cellOffset;

            var output: VertexOutput;
            output.pos = vec4f(gridPos, 0, 1);
            output.cell = cell / grid;
            return output;
        }
        
        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
            return vec4f(input.cell, 1 - input.cell.x, 1);
        }
        `
    });

    const cellPipeline = device.createRenderPipeline({
        label: "Cell pipeline",
        layout: pipelineLayout,
        vertex: {
            module: cellShaderModule,
            entryPoint: "vertexMain",
            buffers: [vertexBufferLayout]
        },
        fragment: {
            module: cellShaderModule,
            entryPoint: "fragmentMain",
            targets: [{
                format: canvasFormat
            }]
        }
    });

    return [vertices, vertexBuffer, cellPipeline];
}