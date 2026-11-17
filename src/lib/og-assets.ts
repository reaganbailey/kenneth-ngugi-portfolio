import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DATA } from "@/data/resume";

/**
 * Helpers for the OpenGraph image routes.
 *
 * On Cloudflare Workers, files in /public are served through the ASSETS
 * binding. Reading them from there avoids both `import.meta.url` file
 * fetches (which only worked with Vercel's edge bundler) and a Worker
 * fetching its own public hostname. Order: ASSETS binding (Workers) ->
 * /public on disk (build time, `next dev`) -> the public site URL.
 */

type AssetsBinding = { fetch(request: Request): Promise<Response> };

async function fetchPublicAsset(path: string): Promise<Response | null> {
  try {
    const { env } = getCloudflareContext();
    const assets = (env as { ASSETS?: AssetsBinding }).ASSETS;

    if (assets) {
      const response = await assets.fetch(
        new Request(new URL(path, "https://assets.local"))
      );
      if (response.ok) return response;
    }
  } catch {
    // Not running inside a Worker context; fall through.
  }

  // Build time / local Node: read straight from /public on disk.
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const buffer = await readFile(join(process.cwd(), "public", path));
    const ext = path.split(".").pop()?.toLowerCase();
    const type =
      ext === "png" ? "image/png" : ext === "ttf" ? "font/ttf" : "application/octet-stream";
    return new Response(new Uint8Array(buffer), {
      headers: { "content-type": type },
    });
  } catch {
    // Not available (e.g. inside a Worker); fall through.
  }

  try {
    const response = await fetch(new URL(path, DATA.url));
    if (response.ok) return response;
  } catch {
    // Fall through.
  }

  return null;
}

export async function getOgFonts() {
  try {
    const [cabinet, clash] = await Promise.all([
      fetchPublicAsset("/fonts/CabinetGrotesk-Medium.ttf"),
      fetchPublicAsset("/fonts/ClashDisplay-Semibold.ttf"),
    ]);

    if (!cabinet || !clash) return null;

    return {
      cabinetGrotesk: await cabinet.arrayBuffer(),
      clashDisplay: await clash.arrayBuffer(),
    };
  } catch (error) {
    console.error("Failed to load fonts:", error);
    return null;
  }
}

/** Returns the avatar as a data: URL so the renderer never makes a network call. */
export async function getAvatarDataUrl(): Promise<string | undefined> {
  if (!DATA.avatarUrl) return undefined;

  try {
    const response = await fetchPublicAsset(DATA.avatarUrl);
    if (!response) return undefined;

    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }

    const type = response.headers.get("content-type") || "image/png";
    return `data:${type};base64,${btoa(binary)}`;
  } catch (error) {
    console.error("Failed to load avatar:", error);
    return undefined;
  }
}
