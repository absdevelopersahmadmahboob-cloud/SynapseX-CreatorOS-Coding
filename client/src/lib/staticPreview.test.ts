import { describe, expect, it } from "vitest";
import { buildStaticPreview, findPreviewEntry } from "./staticPreview";

describe("static workspace preview", () => {
  it("finds a root index.html entry", () => {
    expect(findPreviewEntry([{ path: "index.html", content: "<html></html>" }])?.path).toBe("index.html");
  });

  it("inlines locally referenced stylesheet and script content", () => {
    const preview = buildStaticPreview([
      { path: "index.html", content: '<link rel="stylesheet" href="assets/site.css"><script src="assets/site.js"></script>' },
      { path: "assets/site.css", content: "body { color: teal; }" },
      { path: "assets/site.js", content: "window.previewReady = true;" },
    ]);
    expect(preview).toContain("body { color: teal; }");
    expect(preview).toContain("window.previewReady = true;");
    expect(preview).not.toContain('src="assets/site.js"');
  });

  it("does not create a preview without an HTML entry", () => {
    expect(buildStaticPreview([{ path: "README.md", content: "No preview" }])).toBeNull();
  });
});
