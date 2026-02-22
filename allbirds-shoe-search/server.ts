import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

export interface Shoe {
  name: string;
  price: string;
  imageUrl: string;
  productUrl: string;
  size?: string;
  handle: string;
}

export interface SearchResult {
  query: string;
  size?: string;
  gender?: "men" | "women";
  shoes: Shoe[];
  totalFound: number;
  error: string | null;
}

// Shopify product types
interface ShopifyVariant {
  title: string;
  price: string;
  available: boolean;
}
interface ShopifyProduct {
  title: string;
  handle: string;
  variants: ShopifyVariant[];
  images: Array<{ src: string }>;
}
interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

// EU → US men's size conversion (approximate)
const EU_TO_US: Record<number, string> = {
  35: "4", 36: "4.5", 37: "5", 38: "6", 39: "6.5",
  40: "7", 41: "8", 42: "9", 43: "10", 44: "11",
  45: "12", 46: "13", 47: "14", 48: "15",
};

// Generic words that appear in queries but not in product titles
const IGNORED_TERMS = new Set(["shoes", "shoe", "chaussures", "chaussure", "sneakers", "sneaker"]);

function resolveSize(size: string): string {
  const num = parseFloat(size);
  if (!isNaN(num) && num >= 35 && num <= 50) {
    return EU_TO_US[Math.round(num)] ?? size;
  }
  return size;
}

/**
 * Parse a free-text query that may contain a size (e.g. "men runner 9" or "runner taille 42").
 * Returns the cleaned search terms and the detected size (if any).
 */
function parseQueryAndSize(rawQuery: string, explicitSize?: string): { terms: string[]; size?: string } {
  const tokens = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const sizeTokens: string[] = [];
  const textTokens: string[] = [];

  for (const token of tokens) {
    const num = parseFloat(token);
    // US size range 4–15 or EU size range 35–50
    if (!isNaN(num) && ((num >= 4 && num <= 15) || (num >= 35 && num <= 50))) {
      sizeTokens.push(token);
    } else if (token === "taille" || token === "size") {
      // skip connector words
    } else if (!IGNORED_TERMS.has(token)) {
      textTokens.push(token);
    }
  }

  // Explicit size param wins over query-embedded size
  const rawSize = explicitSize ?? sizeTokens[0];
  const size = rawSize ? resolveSize(rawSize) : undefined;

  return { terms: textTokens, size };
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
  try {
    // Request a small version via Shopify image params — width=200 keeps total payload under 1 MB for 10 images
    const sep = url.includes("?") ? "&" : "?";
    const imgUrl = `${url}${sep}width=200&format=pjpg`;
    const res = await fetch(imgUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) return "";
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${contentType};base64,${base64}`;
  } catch {
    return "";
  }
}

// Cache all products to avoid fetching on every request
let productsCache: ShopifyProduct[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  if (productsCache && Date.now() - cacheTime < CACHE_TTL_MS) {
    return productsCache;
  }

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
  };

  // Allbirds has ~250 products total — one page is enough
  const res = await fetch("https://www.allbirds.com/products.json?limit=250", { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch Allbirds products`);

  const data = await res.json() as ShopifyProductsResponse;
  productsCache = data.products ?? [];
  cacheTime = Date.now();
  return productsCache;
}

async function searchAllbirds(query: string, size?: string, gender?: "men" | "women"): Promise<SearchResult> {
  const { terms, size: detectedSize } = parseQueryAndSize(query, size);
  const usSize = detectedSize;
  const allProducts = await fetchAllProducts();

  // Filter by query terms — use word-boundary regex to avoid "men" matching "women"
  let matches = allProducts.filter((p) => {
    const title = p.title.toLowerCase();
    return terms.length === 0 || terms.every((term) => {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      return re.test(title);
    });
  });

  // Filter by gender if provided
  if (gender === "women") {
    matches = matches.filter((p) => /\bwomen\b/i.test(p.title));
  } else if (gender === "men") {
    matches = matches.filter((p) => /\bmen\b/i.test(p.title) && !/\bwomen\b/i.test(p.title));
  }

  // Filter by size if provided
  if (usSize) {
    matches = matches.filter((p) =>
      p.variants.some((v) => v.title.toLowerCase() === usSize.toLowerCase() && v.available !== false),
    );
  }

  const top10 = matches.slice(0, 5);

  const shoes: Shoe[] = await Promise.all(top10.map(async (p) => {
    const targetVariant = usSize
      ? p.variants.find((v) => v.title.toLowerCase() === usSize.toLowerCase())
      : p.variants[0];

    const price = targetVariant?.price
      ? `$${parseFloat(targetVariant.price).toFixed(0)}`
      : "See price";

    const rawImageUrl = p.images[0]?.src ?? "";
    const imageUrl = rawImageUrl ? await fetchImageAsDataUrl(rawImageUrl) : "";

    return {
      name: p.title,
      price,
      imageUrl,
      productUrl: `https://www.allbirds.com/products/${p.handle}${usSize ? `?size=${usSize}` : ""}`,
      size: usSize,
      handle: p.handle,
    };
  }));

  return { query, size: usSize ?? size, gender, shoes, totalFound: matches.length, error: null };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "Allbirds Shoe Search", version: "1.0.0" });
  const resourceUri = "ui://allbirds-shoe-search/mcp-app.html";

  registerAppTool(
    server,
    "search-allbirds-shoes",
    {
      title: "Search Allbirds Shoes",
      description:
        "Search for shoes on Allbirds (allbirds.com). Returns up to 5 matching products with name, price, image, available sizes and product URL. Sizes can be EU (e.g. 42) or US (e.g. 9).",
      inputSchema: z.object({
        query: z.string().min(1).describe('Search query, e.g. "tree runner", "wool runner", "trail"'),
        size: z.string().optional().describe("Shoe size to filter by — EU (e.g. 42) or US (e.g. 9)."),
        gender: z.enum(["men", "women"]).optional().describe("Filter by gender: 'men' or 'women'."),
      }),
      outputSchema: z.object({
        query: z.string(),
        size: z.string().optional(),
        gender: z.enum(["men", "women"]).optional(),
        shoes: z.array(
          z.object({
            name: z.string(),
            price: z.string(),
            imageUrl: z.string(),
            productUrl: z.string(),
            size: z.string().optional(),
            handle: z.string(),
          }),
        ),
        totalFound: z.number(),
        error: z.string().nullable(),
      }),
      _meta: { ui: { resourceUri } },
    },
    async ({ query, size, gender }): Promise<CallToolResult> => {
      try {
        const result = await searchAllbirds(query, size, gender);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const result: SearchResult = { query, size, gender, shoes: [], totalFound: 0, error };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
          isError: true,
        };
      }
    },
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return { contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  return server;
}
