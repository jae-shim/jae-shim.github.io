const canvas = document.getElementById('webgpu-canvas');
const context = canvas.getContext('webgpu');

async function init() {
  // Request adapter
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  // Configure swap chain
  const contextAttributes = {
    device: device,
    format: "bgra8unorm",
  };
  const swapChain = canvas.configureSwapChain(contextAttributes);

  // Define shaders
  const vertexShaderModule = device.createShaderModule({
    code: `
      [[stage(vertex)]]
      fn main([[location(0)]] position: vec4<f32>) -> [[builtin(position)]] vec4<f32> {
        return position;
      }
    `,
  });

  const fragmentShaderModule = device.createShaderModule({
    code: `
      [[stage(fragment)]]
      fn main() -> [[location(0)]] vec4<f32> {
        return vec4<f32>(1.0, 0.0, 0.0, 1.0); // Red color
      }
    `,
  });

  // Create pipeline
  const pipeline = device.createRenderPipeline({
    vertex: {
      module: vertexShaderModule,
      entryPoint: "main",
    },
    fragment: {
      module: fragmentShaderModule,
      entryPoint: "main",
      targets: [
        {
          format: contextAttributes.format,
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  // Main rendering loop
  function render() {
    const commandEncoder = device.createCommandEncoder();
    const textureView = swapChain.getCurrentTexture().createView();

    const renderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          loadValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          storeOp: "store",
        },
      ],
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.draw(3, 1, 0, 0);
    passEncoder.endPass();

    device.queue.submit([commandEncoder.finish()]);

    requestAnimationFrame(render);
  }

  render();
}

init();
