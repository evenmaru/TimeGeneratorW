export type Result<TValue, TError> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{ ok: false; error: TError }>;

export function success<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

export function failure<TError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}
