// D1 permits at most 100 bound parameters per query.
// https://developers.cloudflare.com/d1/platform/limits/
const D1_MAX_BOUND_PARAMETERS = 100;

/**
 * Values for an `IN` list, split so no query binds more than D1 allows.
 *
 * `reserved` is how many parameters the rest of the statement binds. Getting it
 * too low passes every node test and fails only on D1, with "too many SQL
 * variables".
 */
export function queryBatches<T>(values: readonly T[], reserved: number): T[][] {
  const size = D1_MAX_BOUND_PARAMETERS - reserved;
  if (!Number.isInteger(reserved) || reserved < 0 || size < 1) {
    throw new RangeError(`no room for an IN list beside ${reserved} bound parameters`);
  }
  const batches: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) batches.push(values.slice(offset, offset + size));
  return batches;
}
