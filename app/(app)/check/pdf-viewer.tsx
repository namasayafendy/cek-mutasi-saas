"use client";

import { useEffect, useRef } from "react";
import type { RenderedPage } from "@/lib/pdf/renderer";
import type { ParsedPdf } from "@/lib/pdf/parser";

export function PdfViewer({
  pages,
  matchedTxMap,
  parsed,
}: {
  pages: RenderedPage[];
  matchedTxMap: Map<string, string>; // page-no -> colorHex
  parsed: ParsedPdf;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Mount canvases (only once per page render)
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    // Clear existing
    c.innerHTML = "";
    for (const page of pages) {
      const wrapper = document.createElement("div");
      wrapper.className = "relative inline-block bg-white shadow-sm mx-auto mb-4";
      wrapper.style.width = `${page.canvas.width}px`;
      wrapper.style.height = `${page.canvas.height}px`;

      const overlay = document.createElement("div");
      overlay.className = "absolute inset-0 pointer-events-none";
      overlay.dataset.page = String(page.pageNum);
      overlay.id = `pdf-overlay-${page.pageNum}`;

      wrapper.appendChild(page.canvas);
      wrapper.appendChild(overlay);
      c.appendChild(wrapper);
    }
  }, [pages]);

  // Update highlights overlay when matchedTxMap changes
  useEffect(() => {
    if (!parsed) return;
    for (const page of pages) {
      const overlay = document.getElementById(`pdf-overlay-${page.pageNum}`);
      if (!overlay) continue;
      overlay.innerHTML = "";
      const pageTxs = parsed.transactions.filter((t) => t.page === page.pageNum);
      for (const tx of pageTxs) {
        const colorHex = matchedTxMap.get(`${tx.page}-${tx.no}`);
        if (!colorHex) continue;
        // Convert PDF coords (origin bottom-left) to canvas coords (origin top-left)
        const cssTop = (page.pdfHeight - (tx.bbox.yBottom + tx.bbox.height)) * page.scale;
        const cssLeft = tx.bbox.xLeft * page.scale;
        const cssWidth = tx.bbox.width * page.scale;
        const cssHeight = tx.bbox.height * page.scale;

        const div = document.createElement("div");
        div.style.position = "absolute";
        div.style.top = `${cssTop}px`;
        div.style.left = `${cssLeft}px`;
        div.style.width = `${cssWidth}px`;
        div.style.height = `${cssHeight}px`;
        div.style.backgroundColor = colorHex;
        div.style.opacity = "0.4";
        div.style.mixBlendMode = "multiply";
        overlay.appendChild(div);
      }
    }
  }, [matchedTxMap, parsed, pages]);

  return (
    <div
      ref={containerRef}
      className="overflow-auto bg-slate-100 p-4"
      style={{ maxHeight: "calc(100vh - 220px)" }}
    />
  );
}
