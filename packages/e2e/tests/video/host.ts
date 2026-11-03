export const host = process.env.SURFACE_E2E_HOST ?? '127.0.0.1';
if (!/^127(\.\d{1,3}){3}$/.test(host)) {
  throw new Error(`SURFACE_E2E_HOST=${host} is not a loopback address. e2e opens plain HTTP only on loopback, so the test and visual servers bind 127.0.0.1; unset SURFACE_E2E_HOST or set it to a 127.x.x.x address.`);
}
