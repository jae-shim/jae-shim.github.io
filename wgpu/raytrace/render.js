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
    const vertices = new Float32Array([
        // X,    Y,
        -0.8, -0.8, // Triangle 1 (Blue)
        0.8, -0.8,
        0.8, 0.8,

        -0.8, -0.8, // Triangle 2 (Red)
        0.8, 0.8,
        -0.8, 0.8,
    ]);

    const vertexBuffer = device.createBuffer({
        label: "Cell vertices",
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, vertices);

    const vertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
            format: "float32x2",
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