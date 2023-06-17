function createUniformBuffers(device, time) {
    // Create a uniform buffer that describes the grid.
    const uniformArray = new Float32Array([time]);
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
        -1.0, -1.0,
        3.0, -1.0,
        -1.0,  3.0,
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
        };
        
        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput  {
            var output: VertexOutput;
            output.pos = vec4f(input.pos, 0, 1);
            return output;
        }

        const MAX_STEPS = 100;
        const MAX_DIST = 100.;
        const SURF_DIST = .01;
        
        const WIDTH = 640;
        const HEIGHT = 480;
        
        @group(0) @binding(0) var<uniform> time: f32;
        
        fn sdCylinder(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32
        {
            let ap: vec3f = p - a;
            let ab: vec3f = b - a;
        
            var t: f32 = dot(ap, ab) / dot(ab, ab);
            t = clamp(t, 0, 1);
        
            let c: vec3f = a + t * ab;
        
            let d: f32 = length(p - c) - r;
        
            let y: f32 = (abs(t - 0.5) - 0.5) * length(ab);
        
            let e: f32 = length(vec2f(max(d, 0), max(y, 0)));
        
            let i: f32 = min(max(d, y), 0);
        
            return e + i;
        }
        
        fn sdBox(p: vec3f, size: f32) -> f32
        {
            return length(vec3f(max(abs(p.x) - size, 0), max(abs(p.y) - size, 0), max(abs(p.z) - size, 0)));
        }
        
        fn sdTorus(p: vec3f, r: vec2f) ->f32
        {
            return length(vec2f(length(p.xz) - r.x, p.y)) - r.y;
        }
        
        fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32
        {
            let ap: vec3f = p - a;
            let ab: vec3f = b - a;
        
            var t: f32 = dot(ap, ab) / dot(ab, ab);
            t = clamp(t, 0, 1);
        
            let c: vec3f = a + t * ab;
        
            return length(p - c) - r;
        }
        
        fn GetDist(p: vec3f) -> f32
        {
            let s: vec4f = vec4(0, 1, 6, 1);
        
            let sphereDist: f32 = length(p - s.xyz) - s.w;
            let planeDist: f32 = p.y;
        
            let capsuleDist: f32 = sdCapsule(p, vec3f(0, 1, 6), vec3f(1, 2, 6), 0.2);
            let torusDist: f32 = sdTorus(p - vec3f(0, 0.5, 6), vec2f(1.5, 0.3));
            let boxDist: f32 = sdBox(p - vec3f(-3, 0.75, 6), 0.75);
            let cylinderDist: f32 = sdCylinder(p, vec3f(0, 0.3, 3), vec3f(3, 0.3, 5), 0.3);
        
            var d: f32 = min(capsuleDist, planeDist);
            d = min(d, torusDist);
            d = min(d, boxDist);
            d = min(d, cylinderDist);
        
            return d;
        }
        
        fn RayMarch(origin: vec3f, direction: vec3f) -> f32
        {
            var distOrigin: f32 = 0;
        
            for(var i: i32 = 0; i < MAX_STEPS; i++)
            {
                let p: vec3f = origin + direction * distOrigin;
                let distSurface: f32 = GetDist(p);
                distOrigin += distSurface;
                if(distOrigin > MAX_DIST || distSurface < SURF_DIST)
                {
                    break;
                }
            }
        
            return distOrigin;
        }
        
        fn GetNormal(p: vec3f) -> vec3f
        {
            let d: f32 = GetDist(p);
            let e: vec2f = vec2f(0.01, 0);
        
            let n: vec3f = d - vec3f(GetDist(p - e.xyy), GetDist(p - e.yxy), GetDist(p - e.yyx));
        
            return normalize(n);
        }
        
        fn GetLight(p: vec3f) -> vec3f
        {
            var lightPos: vec3f = vec3f(0, 5, 6);
            let lightColor: vec3f = vec3f(1, 1, 1);
            lightPos.x += sin(time) * 2.;
            lightPos.z += cos(time) * 2.;
            let l: vec3f = normalize(lightPos - p);
            let n: vec3f = GetNormal(p);
        
            var dif: vec3f = clamp(dot(n, l), 0, 1) * lightColor;
            let d: f32 = RayMarch(p + n * SURF_DIST * 2, l);
            if(d < length(lightPos - p))
            {
                dif *= 0.1;
            }
            return dif;
        }
        
        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
            var uv: vec2f = (input.pos.xy - 0.5 * vec2f(WIDTH, HEIGHT)) / HEIGHT;
            uv.y *= -1.;
        
            var col: vec3f = vec3f(0);
        
            let origin: vec3f = vec3f(0, 2, 0);
            let direction: vec3f = normalize(vec3f(uv.x, uv.y, 1));
        
            let d: f32 = RayMarch(origin, direction);
        
            let p: vec3f = origin + direction * d;
        
            let dif: vec3f = GetLight(p);
            col = dif;
        
            return vec4(col, 1.0);
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