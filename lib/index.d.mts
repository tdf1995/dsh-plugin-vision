/**
 * dsh-plugin-vision — type declarations.
 *
 * The package ships plain JavaScript; these declarations describe the
 * exported Cordis plugin and its configuration surface.
 */
import type { Context } from '@deepseek-ai/cordis';

export interface VisionConfig {
  /** Default provider when the caller does not pass one: auto | gemini | glm. */
  provider?: 'auto' | 'gemini' | 'glm';
  /** Default Gemini model id. */
  geminiModel?: string;
  /** Default GLM (Zhipu) model id. */
  glmModel?: string;
  /** Credential reference (env var name) for the Gemini API key. */
  geminiKeyEnv?: string;
  /** Credential reference (env var name) for the Zhipu API key. */
  glmKeyEnv?: string;
  /** Rate-limit retry attempts per provider before failing over. */
  maxAttempts?: number;
  /** Reject images larger than this many bytes. */
  maxImageBytes?: number;
  /** Images larger than this are downscaled before upload; 0 disables. */
  downscaleThreshold?: number;
  /** Longest edge after downscale. */
  maxDimension?: number;
  /** JPEG quality used when downscaling (0-100). */
  jpegQuality?: number;
}

export interface VisionPlugin {
  inject: readonly string[];
  config: unknown;
  apply(ctx: Context): void;
}

declare const plugin: VisionPlugin;
export default plugin;
