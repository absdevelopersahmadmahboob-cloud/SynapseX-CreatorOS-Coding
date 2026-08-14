export type PreviewWorkspaceFile = { path: string; content: string };

function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\\/g, "/");
}

function resolveRelativePath(fromPath: string, reference: string): string {
  if (/^(?:https?:|data:|#|\/)/i.test(reference)) return reference;
  const base = normalizePath(fromPath).split("/").slice(0, -1);
  for (const segment of reference.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") base.pop();
    else base.push(segment);
  }
  return base.join("/");
}

export function findPreviewEntry(files: PreviewWorkspaceFile[]): PreviewWorkspaceFile | null {
  return files.find(file => normalizePath(file.path).toLowerCase() === "index.html")
    ?? files.find(file => normalizePath(file.path).toLowerCase().endsWith("/index.html"))
    ?? null;
}

export function buildStaticPreview(files: PreviewWorkspaceFile[]): string | null {
  const entry = findPreviewEntry(files);
  if (!entry) return null;
  const contentByPath = new Map(files.map(file => [normalizePath(file.path), file.content]));
  let document = entry.content;

  document = document.replace(/<link([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (wholeTag, before, href, after) => {
    const stylesheet = contentByPath.get(resolveRelativePath(entry.path, href));
    return stylesheet === undefined ? wholeTag : `<style data-synapsex-preview="${href}">${stylesheet}</style>`;
  });

  document = document.replace(/<script([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi, (wholeTag, before, src, after) => {
    const script = contentByPath.get(resolveRelativePath(entry.path, src));
    return script === undefined ? wholeTag : `<script data-synapsex-preview="${src}"${before}${after}>${script}</script>`;
  });

  return document;
}
