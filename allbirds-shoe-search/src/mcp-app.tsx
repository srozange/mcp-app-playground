import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./mcp-app.module.css";

interface Shoe {
  name: string;
  price: string;
  imageUrl: string;
  productUrl: string;
  size?: string;
  handle: string;
}

interface SearchResult {
  query: string;
  size?: string;
  shoes: Shoe[];
  totalFound: number;
  error: string | null;
}

function extractResult(r: CallToolResult): SearchResult | null {
  if (r.structuredContent) return r.structuredContent as unknown as SearchResult;
  const t = r.content?.find((c) => c.type === "text");
  if (t && "text" in t) {
    try { return JSON.parse(t.text) as SearchResult; } catch { return null; }
  }
  return null;
}

function ShoeCard({ shoe, onOpen }: { shoe: Shoe; onOpen: (url: string) => void }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className={styles.card} onClick={() => onOpen(shoe.productUrl)}>
      <div className={styles.cardImage}>
        {shoe.imageUrl && !imgError ? (
          <img src={shoe.imageUrl} alt={shoe.name} onError={() => setImgError(true)} loading="lazy" />
        ) : (
          <div className={styles.imagePlaceholder}>?</div>
        )}
      </div>
      <div className={styles.cardInfo}>
        <p className={styles.shoeName}>{shoe.name}</p>
        <div className={styles.cardMeta}>
          <span className={styles.price}>{shoe.price}</span>
          {shoe.size && <span className={styles.sizeTag}>US {shoe.size}</span>}
        </div>
      </div>
    </div>
  );
}

function AllbirdsApp() {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Allbirds Shoe Search", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = async () => { setLoading(true); setResult(null); };
      app.ontoolresult = async (r) => {
        setLoading(false);
        const parsed = extractResult(r);
        if (parsed) setResult(parsed);
      };
      app.ontoolcancelled = () => setLoading(false);
      app.onerror = console.error;
      app.onhostcontextchanged = (ctx) => setHostContext((prev) => ({ ...prev, ...ctx }));
    },
  });

  useEffect(() => { if (app) setHostContext(app.getHostContext()); }, [app]);

  const handleOpen = useCallback(async (url: string) => {
    if (app) await app.openLink({ url });
  }, [app]);

  if (error) return <div className={styles.message}><strong>Error:</strong> {error.message}</div>;
  if (!app) return <div className={styles.message}>Connecting…</div>;

  const safeArea = hostContext?.safeAreaInsets;

  return (
    <div className={styles.container} style={{
      paddingTop: safeArea?.top, paddingRight: safeArea?.right,
      paddingBottom: safeArea?.bottom, paddingLeft: safeArea?.left,
    }}>
      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      )}

      {!loading && result === null && (
        <div className={styles.message}>Ask the assistant to search for shoes.</div>
      )}

      {!loading && result?.error && (
        <div className={styles.message}>{result.error}</div>
      )}

      {!loading && result !== null && !result.error && result.shoes.length === 0 && (
        <div className={styles.message}>No results for &ldquo;{result.query}&rdquo;.</div>
      )}

      {!loading && result !== null && result.shoes.length > 0 && (
        <div className={styles.grid}>
          {result.shoes.map((shoe, i) => (
            <ShoeCard key={i} shoe={shoe} onOpen={handleOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><AllbirdsApp /></StrictMode>);
