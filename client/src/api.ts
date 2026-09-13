export async function api(path: string, options: RequestInit = {}) {
  let r: Response;
  try {
    r = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error(
      "We couldn’t connect. Your entries are still here. Please try again.",
    );
  }
  const result = await r
    .json()
    .catch(() => ({
      error: "The service is temporarily unavailable. Please try again.",
    }));
  if (!r.ok)
    throw Object.assign(
      new Error(result.error || "Something went wrong. Please try again."),
      { status: r.status, fields: result.fields },
    );
  return result;
}
