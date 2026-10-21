import { platform } from "../../platform/index.ts";

export function recordAt<T>(location: string) {
  return {
    get: () => platform.get<T>(location),
    put: (value: T, options?: { ttl?: number }) => platform.put(location, value, options),
    remove: () => platform.remove(location),
  };
}
