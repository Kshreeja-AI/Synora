/** Library entrypoint (as opposed to src/index.ts, the process entrypoint) so products can import createServer/buildPlatformContainer without spawning a second process. */
export { buildPlatformContainer, type PlatformContainer } from './container.js';
export { createServer } from './server.js';
