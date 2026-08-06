export function checkAuth(apiKey: string | undefined, request: Request): Response | null {
  if (!apiKey) return null;

  if (new URL(request.url).pathname === "/health") return null;

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}
