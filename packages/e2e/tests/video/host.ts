const host = process.env.SURFACE_E2E_HOST ?? '127.0.0.1';
const loopback = host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);

export const bindHost = host;
export const browserHost = loopback ? host : 'surface.localhost';
export const browserArgs = loopback ? [] : [`--host-resolver-rules=MAP surface.localhost ${host}`];
