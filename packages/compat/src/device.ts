/**
 * expo-device compat shim — derived from the browser's own identity.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface — the module-scope constants (isDevice, brand, manufacturer,
 * modelName, deviceType, osName, osVersion, totalMemory,
 * supportedCpuArchitectures, ...) and the async getters
 * (getDeviceTypeAsync, isRootedExperimentalAsync, getUptimeAsync,
 * getMaxMemoryAsync, getPlatformFeaturesAsync, hasPlatformFeatureAsync,
 * isSideLoadingEnabledAsync) plus the DeviceType enum.
 *
 * Sources are the ones a browser actually has: navigator.userAgent for the
 * OS/model/form factor, navigator.userAgentData for the same on Chromium
 * (where it is the maintained answer and the UA string is frozen),
 * navigator.deviceMemory for RAM. The UA parse below is deliberately a few
 * short regexes rather than a UA-parser dependency — it recognizes the
 * platforms an RN app cares about and returns null everywhere else, which is
 * a documented value of every one of these fields.
 *
 * Honest ceilings:
 * - **UA sniffing is an approximation, and shrinking.** Browsers freeze and
 *   reduce the UA string (Chrome's UA-Reduction, Safari's frozen version),
 *   and iPadOS reports itself as a Mac. Treat modelName/osVersion as hints,
 *   never as identity or as a gate.
 * - **Fields that need a device API report null**, as they do on the real
 *   package's web build: brand, modelId, designName, productName,
 *   deviceYearClass, osBuildId, osInternalBuildId, osBuildFingerprint,
 *   platformApiLevel and deviceName. A browser has no privileged read for
 *   any of them and inventing one would poison telemetry.
 * - **Uptime is the page's, not the device's.** getUptimeAsync reports
 *   milliseconds since this document started; there is no boot clock.
 * - **Android platform features do not exist here**, so
 *   getPlatformFeaturesAsync is empty and hasPlatformFeatureAsync is false —
 *   the same answers the package gives on iOS.
 * - navigator.hardwareConcurrency is available but deliberately unused:
 *   expo-device has no CPU-count field, and deriving deviceYearClass from
 *   cores + RAM would be a fabricated number where the API promises a
 *   measured one. It stays null.
 */

export enum DeviceType {
  UNKNOWN = 0,
  PHONE = 1,
  TABLET = 2,
  DESKTOP = 3,
  TV = 4,
}

interface UserAgentDataLike {
  mobile?: boolean;
  platform?: string;
  brands?: { brand: string; version: string }[];
}

function userAgent(): string {
  return typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
}

function userAgentData(): UserAgentDataLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
}

const ua = userAgent();
const uaData = userAgentData();

const isIPhone = /iPhone/.test(ua);
const isIPod = /iPod/.test(ua);
// iPadOS 13+ claims to be a Mac; the touch-point count is what separates them.
const isIPad =
  /iPad/.test(ua) ||
  (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 1);
const isMac = /Macintosh|Mac OS X/.test(ua) && !isIPad;
const isAndroid = /Android/.test(ua);
const isWindows = /Windows NT/.test(ua) || uaData?.platform === 'Windows';
const isTV = /\b(TV|SmartTV|GoogleTV|AppleTV|HbbTV|NetCast|Web0S|Tizen)\b/i.test(ua);

function firstMatch(pattern: RegExp): string | null {
  const match = pattern.exec(ua);
  return match?.[1] ?? null;
}

function detectOsName(): string | null {
  if (isIPad) return 'iPadOS';
  if (isIPhone || isIPod) return 'iOS';
  if (isAndroid) return 'Android';
  if (isMac) return 'macOS';
  if (isWindows) return 'Windows';
  if (/CrOS/.test(ua)) return 'Chrome OS';
  if (/Linux/.test(ua)) return 'Linux';
  return uaData?.platform ?? null;
}

function detectOsVersion(): string | null {
  // iOS/iPadOS report "OS 17_4_1"; macOS "Mac OS X 10_15_7"; both use underscores.
  if (isIPhone || isIPod || isIPad || isMac) {
    const version = firstMatch(/(?:iPhone )?OS (\d+([._]\d+)*)/) ?? firstMatch(/Mac OS X (\d+([._]\d+)*)/);
    return version ? version.replace(/_/g, '.') : null;
  }
  if (isAndroid) return firstMatch(/Android (\d+(\.\d+)*)/);
  if (isWindows) return firstMatch(/Windows NT (\d+(\.\d+)*)/);
  if (/CrOS/.test(ua)) return firstMatch(/CrOS \S+ (\d+(\.\d+)*)/);
  return null;
}

function detectModelName(): string | null {
  if (isIPhone) return 'iPhone';
  if (isIPod) return 'iPod touch';
  if (isIPad) return 'iPad';
  if (isMac) return 'Mac';
  if (isAndroid) {
    // "Android 13; Pixel 7 Build/TQ2A" → "Pixel 7". The build tag and the
    // language segment (some vendors keep it) are dropped.
    const segment = firstMatch(/Android [^;)]*;\s*([^;)]+)/);
    const model = segment?.split(' Build/')[0]?.trim();
    return model && model !== 'wv' ? model : null;
  }
  return null;
}

function detectManufacturer(): string | null {
  if (isIPhone || isIPod || isIPad || isMac) return 'Apple';
  if (!isAndroid) return null;
  const model = detectModelName();
  if (!model) return null;
  if (/^Pixel/.test(model)) return 'Google';
  if (/^SM-|^Samsung|^GT-/.test(model)) return 'Samsung';
  if (/^Moto|^XT\d/.test(model)) return 'Motorola';
  if (/^ONEPLUS/i.test(model)) return 'OnePlus';
  if (/^Redmi|^Mi |^POCO/i.test(model)) return 'Xiaomi';
  return null;
}

function detectDeviceType(): DeviceType {
  if (isTV) return DeviceType.TV;
  if (isIPad) return DeviceType.TABLET;
  if (isIPhone || isIPod) return DeviceType.PHONE;
  if (isAndroid) return /Mobile/.test(ua) ? DeviceType.PHONE : DeviceType.TABLET;
  if (uaData?.mobile === true) return DeviceType.PHONE;
  if (isMac || isWindows || /CrOS|Linux|X11/.test(ua)) return DeviceType.DESKTOP;
  return ua === '' ? DeviceType.UNKNOWN : DeviceType.DESKTOP;
}

function detectCpuArchitectures(): string[] | null {
  if (/aarch64|arm64/i.test(ua)) return ['arm64'];
  if (/armv(\d)l/i.test(ua)) return [firstMatch(/(armv\d l?)/i) ?? 'arm'];
  if (/x86_64|Win64; x64|WOW64|amd64/i.test(ua)) return ['x86_64'];
  if (/i686|i386/i.test(ua)) return ['x86'];
  // Apple silicon and modern iOS never say so in the UA; unknown is honest.
  return null;
}

function detectTotalMemory(): number | null {
  if (typeof navigator === 'undefined') return null;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  // Reported in GiB, bucketed by the browser for fingerprinting resistance.
  return typeof deviceMemory === 'number' ? Math.round(deviceMemory * 1024 ** 3) : null;
}

// ---------------------------------------------------------------------------
// Constants (module scope, exactly like the real package)
// ---------------------------------------------------------------------------

/** A browser always runs on real hardware — there is no simulator to detect. */
export const isDevice = true;
export const brand: string | null = null;
export const manufacturer: string | null = detectManufacturer();
export const modelId: string | null = null;
export const modelName: string | null = detectModelName();
export const designName: string | null = null;
export const productName: string | null = null;
export const deviceType: DeviceType | null = detectDeviceType();
export const deviceYearClass: number | null = null;
export const totalMemory: number | null = detectTotalMemory();
export const supportedCpuArchitectures: string[] | null = detectCpuArchitectures();
export const osName: string | null = detectOsName();
export const osVersion: string | null = detectOsVersion();
export const osBuildId: string | null = null;
export const osInternalBuildId: string | null = null;
export const osBuildFingerprint: string | null = null;
export const platformApiLevel: number | null = null;
export const deviceName: string | null = null;

// ---------------------------------------------------------------------------
// Async getters
// ---------------------------------------------------------------------------

export async function getDeviceTypeAsync(): Promise<DeviceType> {
  return detectDeviceType();
}

/** No jailbreak/root signal is reachable from a page — the real web build agrees. */
export async function isRootedExperimentalAsync(): Promise<boolean> {
  return false;
}

/** Milliseconds since this document started; a page has no boot clock. */
export async function getUptimeAsync(): Promise<number> {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return Math.round(performance.now());
  }
  return 0;
}

/**
 * The Android JVM heap ceiling. JS has no exposed heap limit, which is
 * exactly the "no inherent limit" case the API documents as
 * Number.MAX_SAFE_INTEGER.
 */
export async function getMaxMemoryAsync(): Promise<number> {
  return Number.MAX_SAFE_INTEGER;
}

export async function isSideLoadingEnabledAsync(): Promise<boolean> {
  return false;
}

export async function getPlatformFeaturesAsync(): Promise<string[]> {
  return [];
}

export async function hasPlatformFeatureAsync(_feature: string): Promise<boolean> {
  return false;
}

/**
 * `import * as Device from 'expo-device'` is the documented form and is
 * served by the named exports above; the namespace default is here so a
 * default import of the same module also works under ESM/CJS interop.
 */
const Device = {
  DeviceType,
  isDevice,
  brand,
  manufacturer,
  modelId,
  modelName,
  designName,
  productName,
  deviceType,
  deviceYearClass,
  totalMemory,
  supportedCpuArchitectures,
  osName,
  osVersion,
  osBuildId,
  osInternalBuildId,
  osBuildFingerprint,
  platformApiLevel,
  deviceName,
  getDeviceTypeAsync,
  isRootedExperimentalAsync,
  getUptimeAsync,
  getMaxMemoryAsync,
  isSideLoadingEnabledAsync,
  getPlatformFeaturesAsync,
  hasPlatformFeatureAsync,
};

export default Device;
