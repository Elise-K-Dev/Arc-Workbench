import { basicSetup } from "codemirror";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import {
  Compartment,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import {
  chooseSavePath,
  chooseTextFile,
  readTextFile,
  writeTextFile,
} from "../api/fileApi";
import { detectLanguage } from "../editor/language";
import type { EditorFloatingPane } from "../workspace/floatingPaneTypes";

type EditorUpdate = Partial<EditorFloatingPane["payload"]> & {
  title?: string;
};

type Props = {
  pane: EditorFloatingPane;
  onUpdate: (id: string, update: EditorUpdate) => void;
};

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function languageExtension(language: string): Extension {
  switch (language) {
    case "javascript":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ jsx: true, typescript: true });
    case "rust":
      return rust();
    case "python":
      return python();
    case "markdown":
      return markdown();
    case "json":
      return json();
    case "yaml":
      return StreamLanguage.define(yaml);
    case "toml":
      return StreamLanguage.define(toml);
    default:
      return [];
  }
}

export function EditorPane({ pane, onUpdate }: Props) {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | undefined>(undefined);
  const contentRef = useRef(pane.payload.content ?? "");
  const updateRef = useRef(onUpdate);
  const paneIdRef = useRef(pane.id);
  const suppressChangesRef = useRef(false);
  const languageCompartmentRef = useRef(new Compartment());
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  updateRef.current = onUpdate;
  paneIdRef.current = pane.id;

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) {
      return;
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: contentRef.current,
        extensions: [
          basicSetup,
          oneDark,
          languageCompartmentRef.current.of(
            languageExtension(pane.payload.language ?? "text"),
          ),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%", backgroundColor: "#0c0e12" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily:
                "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace",
              fontSize: "12px",
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || suppressChangesRef.current) {
              return;
            }
            const content = update.state.doc.toString();
            contentRef.current = content;
            updateRef.current(paneIdRef.current, {
              content,
              dirty: true,
            });
          }),
        ],
      }),
    });
    editorViewRef.current = view;
    return () => {
      view.destroy();
      editorViewRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const nextContent = pane.payload.content;
    const view = editorViewRef.current;
    if (nextContent === undefined || !view || nextContent === contentRef.current) {
      return;
    }

    suppressChangesRef.current = true;
    contentRef.current = nextContent;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextContent },
    });
    suppressChangesRef.current = false;
  }, [pane.payload.content]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: languageCompartmentRef.current.reconfigure(
        languageExtension(pane.payload.language ?? "text"),
      ),
    });
  }, [pane.payload.language]);

  useEffect(() => {
    if (!pane.payload.filePath || pane.payload.content !== undefined) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void readTextFile(pane.payload.filePath)
      .then((content) => {
        if (!cancelled) {
          onUpdate(pane.id, {
            content,
            dirty: false,
            language: detectLanguage(pane.payload.filePath),
          });
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(`File not found or could not be loaded. ${String(reason)}`);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onUpdate, pane.id, pane.payload.content, pane.payload.filePath]);

  const openFile = async () => {
    if (pane.payload.dirty && !window.confirm("Discard unsaved changes?")) {
      return;
    }

    try {
      const path = await chooseTextFile();
      if (!path) {
        return;
      }
      setLoading(true);
      setError(undefined);
      const content = await readTextFile(path);
      onUpdate(pane.id, {
        title: fileName(path),
        filePath: path,
        content,
        dirty: false,
        language: detectLanguage(path),
      });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    try {
      let path = pane.payload.filePath;
      if (!path) {
        path = await chooseSavePath(pane.title);
      }
      if (!path) {
        return;
      }

      setError(undefined);
      await writeTextFile(path, contentRef.current);
      onUpdate(pane.id, {
        title: fileName(path),
        filePath: path,
        content: contentRef.current,
        dirty: false,
        language: detectLanguage(path),
      });
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <button type="button" onClick={() => void openFile()}>
          Open
        </button>
        <button type="button" onClick={() => void saveFile()}>
          Save
        </button>
        <span
          className="editor-path"
          title={pane.payload.filePath ?? "Unsaved document"}
        >
          {pane.payload.filePath ?? pane.title}
        </span>
        {pane.payload.dirty && (
          <span className="editor-dirty" title="Modified">
            modified
          </span>
        )}
      </div>
      <div className="editor-content" ref={editorHostRef} />
      {(loading || error) && (
        <div className={`editor-status${error ? " editor-status--error" : ""}`}>
          {error ?? "Loading..."}
        </div>
      )}
    </div>
  );
}
