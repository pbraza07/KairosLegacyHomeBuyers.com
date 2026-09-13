import { useEffect, useState } from "react";
import { api } from "./api";
import type { SiteContent } from "../../shared/content";
type Inquiry = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
  notification_state: string;
  last_code: string | null;
};
const pretty = (s: string) =>
  s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (x) => x.toUpperCase());
function ContentFields({
  value,
  change,
  path = "",
}: {
  value: any;
  change: (v: any) => void;
  path?: string;
}) {
  if (typeof value === "string") {
    const label = pretty(path.split(".").at(-1) || "Text");
    return (
      <label className="editor-field">
        <span>{label}</span>
        {value.length > 100 ? (
          <textarea
            rows={4}
            value={value}
            onChange={(e) => change(e.target.value)}
          />
        ) : (
          <input value={value} onChange={(e) => change(e.target.value)} />
        )}
      </label>
    );
  }
  if (Array.isArray(value))
    return (
      <div className="editor-array">
        {value.map((v, i) => (
          <div className="editor-item" key={i}>
            <ContentFields
              value={v}
              path={`${path}.${i + 1}`}
              change={(next) =>
                change(value.map((old, j) => (j === i ? next : old)))
              }
            />
            <button
              type="button"
              className="text-button danger"
              onClick={() => change(value.filter((_, j) => i !== j))}
            >
              Remove item {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button outline small"
          onClick={() =>
            change([
              ...value,
              typeof value[0] === "object"
                ? Object.fromEntries(Object.keys(value[0]).map((k) => [k, ""]))
                : path === "about.team"
                  ? { name: "", role: "", bio: "" }
                  : "",
            ])
          }
        >
          Add item
        </button>
      </div>
    );
  return (
    <div className="editor-object">
      {Object.entries(value).map(([k, v]) =>
        typeof v === "string" ? (
          <ContentFields
            key={k}
            value={v}
            path={`${path}.${k}`}
            change={(next) => change({ ...value, [k]: next })}
          />
        ) : (
          <details key={k} className="editor-group">
            <summary>{pretty(k)}</summary>
            <ContentFields
              value={v}
              path={path ? `${path}.${k}` : k}
              change={(next) => change({ ...value, [k]: next })}
            />
          </details>
        ),
      )}
    </div>
  );
}
export default function Admin({
  onContent,
}: {
  onContent: (c: SiteContent) => void;
}) {
  const [csrf, setCsrf] = useState("");
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("content");
  const [content, setContent] = useState<SiteContent | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [items, setItems] = useState<Inquiry[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const secure = (path: string, options: RequestInit = {}) =>
    api(path, {
      ...options,
      headers: { "x-csrf-token": csrf, ...options.headers },
    });
  useEffect(() => {
    api("/api/admin/session")
      .then((r) => setCsrf(r.csrf))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  async function reload() {
    try {
      const r = await secure("/api/admin/content");
      setContent(r.content);
      setVersion(r.version);
      setDirty(false);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function leads() {
    try {
      const r = await secure(`/api/admin/inquiries?page=${page}`);
      setItems(r.items);
      setMore(r.hasMore);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (csrf) {
      void reload();
    }
  }, [csrf]);
  useEffect(() => {
    if (csrf && tab === "inquiries") void leads();
  }, [csrf, tab, page]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setPassword("");
      setCsrf(r.csrf);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await secure("/api/admin/content", {
        method: "PUT",
        body: JSON.stringify({ content, version }),
      });
      setVersion(r.version);
      setDirty(false);
      onContent(content!);
      setNotice("Your changes are live.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 4 * 1024 * 1024)
        throw new Error("Choose an image smaller than 4 MB.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await secure("/api/admin/assets", {
        method: "POST",
        body: JSON.stringify({ base64 }),
      });
      setNotice(
        `Image uploaded. Paste this path into Home → Image or Business → Logo, then save: ${r.path}`,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (checking)
    return (
      <section className="section container">
        <p>Checking your session…</p>
      </section>
    );
  if (!csrf)
    return (
      <section className="section container login">
        <p className="eyebrow">Kairos administration</p>
        <h1>Welcome back.</h1>
        <p>Sign in to manage website content and review inquiries.</p>
        <form onSubmit={login} className="form-card">
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          <button className="button" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    );
  return (
    <section className="section container admin">
      <div className="admin-heading">
        <div>
          <p className="eyebrow">Kairos administration</p>
          <h1>Your website, in your hands.</h1>
        </div>
        <button
          className="text-button"
          onClick={async () => {
            if (dirty && !window.confirm("Discard unsaved edits and sign out?"))
              return;
            try {
              await secure("/api/admin/logout", { method: "POST", body: "{}" });
              setCsrf("");
              setItems([]);
              setContent(null);
              setDirty(false);
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          Sign out
        </button>
      </div>
      <div className="admin-tabs">
        <button
          className={tab === "content" ? "selected" : ""}
          onClick={() => setTab("content")}
        >
          Website editor
        </button>
        <button
          className={tab === "inquiries" ? "selected" : ""}
          onClick={() => setTab("inquiries")}
        >
          Seller inquiries
        </button>
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {tab === "content" && content && (
        <>
          <div className="editor-toolbar">
            <p>
              Edit text, FAQs, service areas, page metadata, images, and brand
              colors. Changes publish when you save.{" "}
              {dirty && <strong>Unsaved changes.</strong>}
            </p>
            <button className="button" disabled={busy || !dirty} onClick={save}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button
              className="text-button"
              onClick={() => {
                if (!dirty || window.confirm("Discard unsaved changes?"))
                  void reload();
              }}
            >
              Reload
            </button>
          </div>
          <div className="upload-panel">
            <label>
              Upload an image (PNG, JPG, or WebP, up to 4 MB)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  if (e.target.files?.[0]) void upload(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <p>
              Original brand artwork should keep its proportions. Uploaded
              images are optimized and stored durably.
            </p>
          </div>
          <ContentFields
            value={content}
            change={(v) => {
              setContent(v);
              setDirty(true);
            }}
          />
        </>
      )}
      {tab === "inquiries" && (
        <>
          <div className="editor-toolbar">
            <p>
              Seller information is private. Notification status shows delivery
              separately from successful storage.
            </p>
            <button
              className="button outline small"
              onClick={() => void leads()}
            >
              Refresh
            </button>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await secure("/api/admin/retry-notifications", {
                    method: "POST",
                    body: "{}",
                  });
                  setNotice(
                    "Notification retries queued. If credentials are missing, notifications will remain disabled.",
                  );
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Retry email notifications
            </button>
          </div>
          {items.length === 0 ? (
            <p className="empty-state">No inquiries on this page.</p>
          ) : (
            items.map((item) => (
              <details className="inquiry-record" key={item.id}>
                <summary>
                  <span>
                    {String(item.payload.fullName)}{" "}
                    <small>
                      {item.kind === "offer"
                        ? "Property review"
                        : "Contact message"}
                    </small>
                  </span>
                  <span>
                    {new Date(item.created_at).toLocaleDateString()} · Email:{" "}
                    {item.notification_state}
                    {item.last_code && ` (${item.last_code})`}
                  </span>
                </summary>
                <dl>
                  {Object.entries(item.payload)
                    .filter(([, v]) => v !== "")
                    .map(([key, v]) => (
                      <div key={key}>
                        <dt>{pretty(key)}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                </dl>
                <button
                  className="text-button danger"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Permanently delete this inquiry and its notification record? This cannot be undone.",
                      )
                    )
                      return;
                    try {
                      await secure(`/api/admin/inquiries/${item.id}`, {
                        method: "DELETE",
                        body: "{}",
                      });
                      void leads();
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  Delete inquiry
                </button>
              </details>
            ))
          )}
          <div className="form-actions">
            <button
              className="button outline small"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              className="button outline small"
              disabled={!more}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
