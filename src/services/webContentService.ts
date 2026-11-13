/**
 * Extracts all HTTP/HTTPS URLs from a given text string.
 */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s"')]+/g;
  // "veja https://dart.dev/blog." → drop sentence punctuation stuck to the URL.
  return (text.match(urlRegex) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ''));
}

/**
 * Fetches the text content of a URL, stripping HTML tags.
 * Follows meta refresh redirects if detected.
 * Returns null if the fetch fails or the content is too short to be meaningful.
 */
export async function fetchUrlContent(url: string, maxRedirects = 3): Promise<string | null> {
  if (maxRedirects < 0) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s hard timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[URL Fetch] HTTP ${response.status} for: ${url}`);
      return null;
    }

    const html = await response.text();

    // Check for client-side / meta refresh redirects (e.g. GitHub Pages or Docusaurus stubs)
    const metaRefreshMatch = html.match(/content=["'][0-9]+;\s*url=([^"'>\s]+)["']/i);
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"'>]+)["']/i);
    const targetRedirect = metaRefreshMatch?.[1] || (html.length < 1000 ? canonicalMatch?.[1] : null);

    if (targetRedirect) {
      try {
        const resolvedUrl = new URL(targetRedirect, url).toString();
        if (resolvedUrl !== url) {
          console.log(`[URL Fetch] Following redirect from ${url} -> ${resolvedUrl}`);
          return fetchUrlContent(resolvedUrl, maxRedirects - 1);
        }
      } catch {
        // Invalid URL, continue with current html
      }
    }

    // Strip scripts, styles, and all HTML tags for clean text extraction
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s{3,}/g, '\n\n')
      .trim();

    // Only return if the content is meaningful; cap at 12K chars to stay within token budget
    return text.length > 80 ? text.substring(0, 12_000) : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[URL Fetch] Failed to fetch ${url}: ${message}`);
    return null;
  }
}
