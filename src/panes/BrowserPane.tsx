import { useEffect, useRef, useState, type FormEvent } from "react";
import { openExternalUrl } from "../api/browserApi";
import {
  isLocalPreviewUrl,
  normalizePreviewUrl,
} from "../browser/urlPolicy";
import type { BrowserFloatingPane } from "../workspace/floatingPaneTypes";

type Props = {
  pane: BrowserFloatingPane;
  onUrlChange: (id: string, url: string) => void;
};

const PREVIEW_TIMEOUT_MS = 4_000;

export function BrowserPane({ pane, onUrlChange }: Props) {
  const [draftUrl, setDraftUrl] = useState(pane.payload.url);
  const [frameUrl, setFrameUrl] = useState(pane.payload.url);
  const [frameKey, setFrameKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const fallbackTimer = useRef<number | undefined>(undefined);
  const localPreview = isLocalPreviewUrl(frameUrl);

  useEffect(() => {
    setDraftUrl(pane.payload.url);
    setFrameUrl(pane.payload.url);
  }, [pane.payload.url]);

  useEffect(() => {
    window.clearTimeout(fallbackTimer.current);
    setTimedOut(false);
    setLoading(localPreview);
    if (!localPreview) {
      return;
    }
    fallbackTimer.current = window.setTimeout(() => {
      setLoading(false);
      setTimedOut(true);
    }, PREVIEW_TIMEOUT_MS);
    return () => window.clearTimeout(fallbackTimer.current);
  }, [frameKey, frameUrl, localPreview]);

  const finishLoading = () => {
    window.clearTimeout(fallbackTimer.current);
    setLoading(false);
    setTimedOut(false);
  };

  const failLoading = () => {
    window.clearTimeout(fallbackTimer.current);
    setLoading(false);
    setTimedOut(true);
  };

  const navigate = (event: FormEvent) => {
    event.preventDefault();
    if (!draftUrl.trim()) {
      return;
    }
    const url = normalizePreviewUrl(draftUrl);
    setDraftUrl(url);
    setFrameUrl(url);
    setFrameKey((current) => current + 1);
    onUrlChange(pane.id, url);
  };

  const reload = () => {
    setFrameKey((current) => current + 1);
  };

  const openExternal = () => {
    void openExternalUrl(frameUrl);
  };

  return (
    <div className="browser-pane">
      <form className="browser-toolbar" onSubmit={navigate}>
        <button type="button" title="Reload local preview" onClick={reload}>
          R
        </button>
        <input
          aria-label="Preview URL"
          spellCheck={false}
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
        />
        <button type="button" title="Open External" onClick={openExternal}>
          Ext
        </button>
      </form>
      <div className="browser-content">
        {localPreview && (
          <iframe
            key={frameKey}
            title={pane.title}
            src={frameUrl}
            onLoad={finishLoading}
            onError={failLoading}
          />
        )}
        {loading && (
          <div className="browser-loading">
            Loading local preview: {frameUrl}
          </div>
        )}
        {!localPreview && (
          <div className="browser-fallback">
            <strong>External sites often block iframe embedding.</strong>
            <span>
              CSP, X-Frame-Options, or frame-ancestors may prevent display.
            </span>
            <span>Use Open External or a future Native Browser pane.</span>
            <button type="button" onClick={openExternal}>
              Open External
            </button>
          </div>
        )}
        {localPreview && timedOut && (
          <div className="browser-fallback">
            <strong>Local preview did not finish loading.</strong>
            <span>{frameUrl}</span>
            <span>Check that the local development server is running.</span>
            <button type="button" onClick={reload}>
              Reload
            </button>
            <button type="button" onClick={openExternal}>
              Open External
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
