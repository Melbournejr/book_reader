/**
 * OPDS (P2) — duyệt catalogue sách từ server Calibre / Kavita / Komga...
 * Hỗ trợ OPDS v1 (Atom XML) và OPDS v2 (JSON). Tải sách về thư mục user
 * chọn, rồi đọc như file local (không clone vào app).
 *
 * Giới hạn nói thẳng: fetch chạy trong WebView nên server nào không gửi
 * CORS (Access-Control-Allow-Origin) thì app không đọc được catalogue —
 * lỗi hiện rõ trong panel. Auth chỉ hỗ trợ HTTP Basic; feed nào cần
 * OAuth/token riêng thì app báo không hỗ trợ. Không hỗ trợ mua sách
 * (acquisition có giá) — chỉ tải link miễn phí/trực tiếp.
 */

export interface OpdsAcquisition {
  url: string;
  type: string;
  title?: string;
}

export interface OpdsEntry {
  title: string;
  author?: string;
  summary?: string;
  acquisitions: OpdsAcquisition[];
}

export interface OpdsNav {
  title: string;
  href: string;
}

export interface OpdsFeed {
  title: string;
  entries: OpdsEntry[];
  nav: OpdsNav[];
  /** Mẫu URL tìm kiếm (OpenSearch), chứa "{searchTerms}" — null nếu feed không hỗ trợ tìm. */
  searchTemplate?: string;
}

export interface OpdsAuth {
  user: string;
  pass: string;
}

/** Nối URL tương đối vào URL gốc của feed. */
export function resolveUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Link này có phải file sách tải được không (theo type, fallback theo đuôi href). */
export function isBookLink(type: string, href: string): boolean {
  const t = type.toLowerCase();
  const h = href.toLowerCase();
  if (
    t.includes("epub") ||
    t.includes("pdf") ||
    t.includes("cbz") ||
    t.includes("cbr") ||
    t.includes("zip") ||
    t.includes("mobi") ||
    t.includes("octet-stream")
  ) {
    return true;
  }
  return /\.(epub|pdf|cbz|cbr|zip|mobi|azw3)(\?|#|$)/.test(h);
}

/** Đoán đuôi file để lưu: ưu tiên type, fallback đuôi href, mặc định .epub. */
export function guessExt(type: string, href: string): string {
  const t = type.toLowerCase();
  if (t.includes("epub")) return ".epub";
  if (t.includes("pdf")) return ".pdf";
  if (t.includes("cbz")) return ".cbz";
  if (t.includes("cbr")) return ".cbr";
  if (t.includes("zip")) return ".zip";
  if (t.includes("mobi")) return ".mobi";
  const m = href.toLowerCase().match(/\.(epub|pdf|cbz|cbr|zip|mobi|azw3)(\?|#|$)/);
  return m ? `.${m[1]}` : ".epub";
}

/** Tên file an toàn trên Windows: bỏ ký tự cấm, cắt tối đa 100 ký tự. */
export function sanitizeFilename(name: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return (clean || "sach").slice(0, 100);
}

// ---------------------------------------------------------------- OPDS v2 (JSON)

function opds2Author(md: Record<string, unknown>): string | undefined {
  // OPDS 2 chuẩn dùng `authors` (mảng); một số server ghi `author` (1 người).
  const list = md.authors ?? md.author;
  if (typeof list === "string") return list;
  if (Array.isArray(list)) {
    const names = list
      .map((x) => (typeof x === "string" ? x : (x as Record<string, unknown>)?.name))
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    if (names.length > 0) return names.join(", ");
  }
  if (list && typeof list === "object") {
    const n = (list as Record<string, unknown>).name;
    if (typeof n === "string") return n;
  }
  return undefined;
}

/** Bóc feed OPDS v2 (JSON) — hàm thuần, test được bằng Node. */
export function parseOpdsJson(json: unknown, baseUrl: string): OpdsFeed {
  const root = (json ?? {}) as Record<string, unknown>;
  const md = (root.metadata ?? {}) as Record<string, unknown>;
  const title = typeof md.title === "string" ? md.title : "OPDS";
  const nav: OpdsNav[] = [];
  let searchTemplate: string | undefined;
  const topLinks = Array.isArray(root.links) ? root.links : [];
  for (const l of topLinks) {
    const link = l as Record<string, unknown>;
    const rel = typeof link.rel === "string" ? link.rel : "";
    const href = typeof link.href === "string" ? link.href : "";
    if (!href) continue;
    if (rel === "search" && href.includes("{")) {
      searchTemplate = resolveUrl(baseUrl, href);
    } else if (rel === "subsection" || rel === "navigation") {
      nav.push({ title: typeof link.title === "string" ? link.title : rel, href: resolveUrl(baseUrl, href) });
    }
  }
  const navList = Array.isArray(root.navigation) ? root.navigation : [];
  for (const l of navList) {
    const link = l as Record<string, unknown>;
    const href = typeof link.href === "string" ? link.href : "";
    if (href) nav.push({ title: typeof link.title === "string" ? link.title : "Mục", href: resolveUrl(baseUrl, href) });
  }
  const entries: OpdsEntry[] = [];
  const pubs = Array.isArray(root.publications) ? root.publications : [];
  for (const p of pubs) {
    const pub = p as Record<string, unknown>;
    const pm = (pub.metadata ?? {}) as Record<string, unknown>;
    const acquisitions: OpdsAcquisition[] = [];
    const links = Array.isArray(pub.links) ? pub.links : [];
    for (const l of links) {
      const link = l as Record<string, unknown>;
      const rel = typeof link.rel === "string" ? link.rel : "";
      const type = typeof link.type === "string" ? link.type : "";
      const href = typeof link.href === "string" ? link.href : "";
      if (
        (rel === "http://opds-spec.org/acquisition" || rel === "acquisition") &&
        href &&
        isBookLink(type, href)
      ) {
        acquisitions.push({
          url: resolveUrl(baseUrl, href),
          type,
          title: typeof link.title === "string" ? link.title : undefined,
        });
      }
    }
    entries.push({
      title: typeof pm.title === "string" ? pm.title : "Không tên",
      author: opds2Author(pm),
      summary: typeof pm.description === "string" ? pm.description : undefined,
      acquisitions,
    });
  }
  return { title, entries, nav, searchTemplate };
}

// ---------------------------------------------------------------- OPDS v1 (Atom XML)

function xmlText(el: Element | null, selector: string): string | undefined {
  const v = el?.querySelector(selector)?.textContent?.trim();
  return v ? v : undefined;
}

/** Bóc feed OPDS v1 (Atom XML) — cần DOMParser, chỉ chạy trong WebView. */
export function parseOpdsXml(doc: Document, baseUrl: string): OpdsFeed {
  const feed = doc.querySelector("feed");
  const title = xmlText(feed, ":scope > title") ?? "OPDS";
  const nav: OpdsNav[] = [];
  let searchTemplate: string | undefined;
  // Link ở cấp feed: subsection (duyệt) + search (OpenSearch, cần tải thêm
  // file mô tả để lấy template — xử lý ở fetchOpdsFeed, ở đây chỉ nhận
  // template viết sẵn trong href).
  feed?.querySelectorAll(":scope > link").forEach((l) => {
    const rel = l.getAttribute("rel") ?? "";
    const href = l.getAttribute("href") ?? "";
    const type = l.getAttribute("type") ?? "";
    if (!href) return;
    if (rel === "subsection") {
      nav.push({ title: l.getAttribute("title") ?? "Mục", href: resolveUrl(baseUrl, href) });
    } else if (rel === "search" && href.includes("{searchTerms}")) {
      searchTemplate = resolveUrl(baseUrl, href);
    }
  });
  const entries: OpdsEntry[] = [];
  feed?.querySelectorAll(":scope > entry").forEach((en) => {
    const etitle = xmlText(en, ":scope > title") ?? "Không tên";
    const author = xmlText(en, ":scope > author > name");
    const summary = xmlText(en, ":scope > summary") ?? xmlText(en, ":scope > content");
    const acquisitions: OpdsAcquisition[] = [];
    let subHref: string | null = null;
    let subTitle: string | null = null;
    en.querySelectorAll(":scope > link").forEach((l) => {
      const rel = l.getAttribute("rel") ?? "";
      const type = l.getAttribute("type") ?? "";
      const href = l.getAttribute("href") ?? "";
      if (!href) return;
      if (rel === "subsection") {
        subHref = resolveUrl(baseUrl, href);
        subTitle = l.getAttribute("title");
      } else if (
        (rel === "http://opds-spec.org/acquisition" || rel === "acquisition" || rel.includes("acquisition")) &&
        isBookLink(type, href)
      ) {
        acquisitions.push({
          url: resolveUrl(baseUrl, href),
          type,
          title: l.getAttribute("title") ?? undefined,
        });
      }
    });
    // Entry chỉ có link subsection (không có file tải) = 1 mục duyệt, không
    // phải 1 cuốn sách — đưa vào nav thay vì danh sách sách.
    if (acquisitions.length === 0 && subHref) {
      nav.push({ title: subTitle ?? etitle, href: subHref });
      return;
    }
    entries.push({ title: etitle, author, summary, acquisitions });
  });
  return { title, entries, nav, searchTemplate };
}

/** Lấy template tìm kiếm từ file mô tả OpenSearch (XML). */
export function parseOpenSearchXml(doc: Document, baseUrl: string): string | undefined {
  const urls = doc.querySelectorAll("Url");
  for (const u of Array.from(urls)) {
    const type = u.getAttribute("type") ?? "";
    const template = u.getAttribute("template") ?? "";
    if (template.includes("{searchTerms}") && (type.includes("atom") || type.includes("opds") || type === "")) {
      return resolveUrl(baseUrl, template);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- fetch

function authHeaders(auth?: OpdsAuth): Record<string, string> {
  if (!auth || !auth.user) return {};
  return { Authorization: `Basic ${btoa(`${auth.user}:${auth.pass}`)}` };
}

/**
 * Tải + bóc 1 feed OPDS (v1 XML hoặc v2 JSON, tự nhận theo Content-Type
 * hoặc ký tự đầu). Ném lỗi có message bắt đầu bằng:
 * - "OPDS_AUTH" (401/403: sai tài khoản/mật khẩu hoặc cần đăng nhập)
 * - "OPDS_KHONG_HOP_LE" (trả về không phải feed OPDS)
 * - "OPDS_MANG" (mất mạng, CORS, timeout, URL sai)
 */
export async function fetchOpdsFeed(
  url: string,
  auth?: OpdsAuth,
  fetchFn: typeof fetch = fetch,
): Promise<OpdsFeed> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: {
        ...authHeaders(auth),
        Accept:
          "application/atom+xml, application/opds+json, application/json, */*",
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("OPDS_MANG");
  }
  if (res.status === 401 || res.status === 403) throw new Error("OPDS_AUTH");
  if (!res.ok) throw new Error("OPDS_MANG");
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const text = await res.text();
  const trimmed = text.trimStart();
  let feed: OpdsFeed;
  if (ct.includes("json") || trimmed.startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("OPDS_KHONG_HOP_LE");
    }
    feed = parseOpdsJson(json, url);
  } else if (trimmed.startsWith("<")) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("OPDS_KHONG_HOP_LE");
    if (!doc.querySelector("feed")) throw new Error("OPDS_KHONG_HOP_LE");
    feed = parseOpdsXml(doc, url);
    // Search kiểu OpenSearch: tải thêm file mô tả để lấy template.
    const searchLink = doc.querySelector(
      'feed > link[rel="search"][type*="opensearchdescription"]',
    );
    const descHref = searchLink?.getAttribute("href");
    if (descHref && !feed.searchTemplate) {
      try {
        const descUrl = resolveUrl(url, descHref);
        const r2 = await fetchFn(descUrl, {
          headers: authHeaders(auth),
          signal: AbortSignal.timeout(10000),
        });
        if (r2.ok) {
          const d2 = new DOMParser().parseFromString(await r2.text(), "application/xml");
          const tpl = parseOpenSearchXml(d2, descUrl);
          if (tpl) feed.searchTemplate = tpl;
        }
      } catch {
        // Không lấy được template tìm kiếm thì catalogue vẫn duyệt được.
      }
    }
  } else {
    throw new Error("OPDS_KHONG_HOP_LE");
  }
  return feed;
}

/** Tìm trong 1 catalogue có hỗ trợ search (template chứa {searchTerms}). */
export async function searchOpdsFeed(
  feed: OpdsFeed,
  query: string,
  auth?: OpdsAuth,
  fetchFn: typeof fetch = fetch,
): Promise<OpdsFeed> {
  if (!feed.searchTemplate) throw new Error("OPDS_KHONG_TIM");
  const url = feed.searchTemplate.replace("{searchTerms}", encodeURIComponent(query));
  return fetchOpdsFeed(url, auth, fetchFn);
}

/** Dịch mã lỗi OPDS thành câu báo rõ cho người đọc. */
export function friendlyOpdsError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("OPDS_AUTH"))
    return "Catalogue này cần đăng nhập (HTTP Basic) — kiểm tra lại tên đăng nhập/mật khẩu, hoặc server cần loại auth khác mà app chưa hỗ trợ.";
  if (msg.includes("OPDS_KHONG_HOP_LE"))
    return "Link này không trả về catalogue OPDS (không phải Atom XML hay OPDS JSON) — kiểm tra lại URL, thường phải kết thúc bằng /opds hoặc /opds-catalog.";
  if (msg.includes("OPDS_KHONG_TIM"))
    return "Catalogue này không hỗ trợ tìm kiếm — duyệt theo mục ở trên.";
  return "Không tải được catalogue — kiểm tra lại mạng và URL. Một số server không gửi CORS nên app trong WebView không đọc được (thử mở URL này trên trình duyệt để kiểm tra).";
}
