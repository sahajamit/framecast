/**
 * GPU mask refinement: joint-bilateral (guided) upsampling of the low-res
 * confidence mask, using the camera frame as the guidance image. Instead of
 * v1's blind bilinear upscale (uniform feather, edges in the wrong place),
 * every output pixel re-weights its low-res mask neighborhood by how similar
 * the full-res camera pixel is to the low-res camera pixel under each tap —
 * so the alpha boundary snaps onto real image edges (hair, glasses, shoulder
 * line) for a fraction of a millisecond of GPU time.
 *
 * The refiner's own WebGL2 canvas IS the published MaskSource: it renders
 * premultiplied white-on-alpha, which `destination-in` compositing consumes
 * directly, and the final guide-res → bubble-res bilinear step in scene.ts
 * provides the sub-pixel feather. Returns null anywhere WebGL2 is missing;
 * the engine then publishes the model-res mask and the v1 look survives.
 */

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  // V flipped: textures store the image top row at v=0, but the framebuffer
  // displays bottom-up through drawImage. Sampling with 1-v makes the
  // published mask canvas read top-down like every other CanvasImageSource
  // (without it the person cutout is vertically inverted).
  vUv = vec2(aPos.x, -aPos.y) * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uMask;    // low-res shaped alpha (R8)
uniform sampler2D uGuideLo; // camera downscaled to mask res
uniform sampler2D uGuideHi; // camera at output (guide) res
uniform vec2 uMaskTexel;    // 1 / mask size
uniform float uInvSigma2;   // 1 / (2 * sigmaRange^2), color-range term

void main() {
  vec3 ref = texture(uGuideHi, vUv).rgb;
  float wsum = 0.0;
  float asum = 0.0;
  // 5x5 taps over the low-res mask around this output pixel.
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * uMaskTexel;
      vec2 p = vUv + off;
      float a = texture(uMask, p).r;
      vec3 g = texture(uGuideLo, p).rgb;
      vec3 dc = ref - g;
      float spatial = exp(-float(dx * dx + dy * dy) * 0.18);
      float range = exp(-dot(dc, dc) * uInvSigma2);
      float w = spatial * range + 1e-4;
      wsum += w;
      asum += a * w;
    }
  }
  float alpha = clamp(asum / wsum, 0.0, 1.0);
  // Premultiplied white: destination-in only reads alpha, drawImage stays exact.
  outColor = vec4(alpha);
}`;

/** Color-range sigma (RGB L2, 0..~1.7 scale). Lower = edges stick harder to color changes. */
const SIGMA_RANGE = 0.14;

export interface RefineInputs {
  /** Shaped, temporally smoothed alpha at model res. */
  mask: Uint8Array;
  maskW: number;
  maskH: number;
  /** Camera frame downscaled to model res (the inference input canvas). */
  guideLo: OffscreenCanvas;
  /** Camera frame downscaled to output res. */
  guideHi: OffscreenCanvas;
}

export interface MaskRefiner {
  /** Renders one refined mask; the returned canvas stays valid until the next call. */
  render(inputs: RefineInputs): OffscreenCanvas | null;
  close(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

class JointBilateralRefiner implements MaskRefiner {
  private canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texMask: WebGLTexture;
  private texGuideLo: WebGLTexture;
  private texGuideHi: WebGLTexture;
  private uMaskTexel: WebGLUniformLocation | null;
  private lost = false;

  constructor(canvas: OffscreenCanvas, gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uMask'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'uGuideLo'), 1);
    gl.uniform1i(gl.getUniformLocation(program, 'uGuideHi'), 2);
    gl.uniform1f(
      gl.getUniformLocation(program, 'uInvSigma2'),
      1 / (2 * SIGMA_RANGE * SIGMA_RANGE),
    );
    this.uMaskTexel = gl.getUniformLocation(program, 'uMaskTexel');

    this.texMask = this.makeTexture();
    this.texGuideLo = this.makeTexture();
    this.texGuideHi = this.makeTexture();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    canvas.addEventListener?.('webglcontextlost', () => {
      this.lost = true;
    });
  }

  private makeTexture(): WebGLTexture {
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  render(inputs: RefineInputs): OffscreenCanvas | null {
    if (this.lost) return null;
    const { gl } = this;
    const outW = inputs.guideHi.width;
    const outH = inputs.guideHi.height;
    if (outW === 0 || outH === 0) return null;
    if (this.canvas.width !== outW || this.canvas.height !== outH) {
      this.canvas.width = outW;
      this.canvas.height = outH;
    }

    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texMask);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        inputs.maskW,
        inputs.maskH,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        inputs.mask,
      );
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.texGuideLo);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inputs.guideLo);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.texGuideHi);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inputs.guideHi);

      gl.viewport(0, 0, outW, outH);
      gl.useProgram(this.program);
      gl.uniform2f(this.uMaskTexel, 1 / inputs.maskW, 1 / inputs.maskH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return this.canvas;
    } catch {
      this.lost = true;
      return null;
    }
  }

  close(): void {
    const { gl } = this;
    this.lost = true;
    gl.deleteTexture(this.texMask);
    gl.deleteTexture(this.texGuideLo);
    gl.deleteTexture(this.texGuideHi);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/**
 * Creates the refiner, or null when WebGL2 (or OffscreenCanvas) is missing —
 * the engine then serves the un-refined model-res mask, which is exactly v1.
 */
export function createMaskRefiner(): MaskRefiner | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const canvas = new OffscreenCanvas(2, 2);
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return new JointBilateralRefiner(canvas, gl, program);
  } catch {
    return null;
  }
}
