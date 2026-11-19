"use client";

import { useRef, useState, type RefObject } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IMAGE_TYPES, imageFiles, prepareImage } from "@/lib/image-prep";
import { uploadSignatureImage } from "@/lib/actions/views";
import { SIGNATURE_IMAGE_MAX_SIDE } from "@/lib/signature";

/** Shown this wide at most when inserted; edit the width attribute to change it. */
const INSERT_WIDTH = 240;

/**
 * Uploading images into a signature's HTML box: the file is scaled down in
 * the browser, stored, and an <img> pointing at it goes in at the cursor.
 * Returns the button plus handlers for pasting or dropping onto the box.
 */
export function useSignatureImages({
  textarea,
  value,
  onChange,
  agentId,
}: {
  textarea: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  /** Another agent's signature (admins); omit for your own. */
  agentId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function insert(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    let html = value;
    const el = textarea.current;
    let at = el ? el.selectionEnd : html.length;
    for (const file of files) {
      try {
        const img = await prepareImage(file, SIGNATURE_IMAGE_MAX_SIDE);
        const r = await uploadSignatureImage({ dataUrl: img.src, filename: img.name, agentId });
        if (r.error || !r.src) throw new Error(r.error ?? "Upload failed");
        const width = Math.min(INSERT_WIDTH, await naturalWidth(img.src));
        const alt = img.name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/["<>&]/g, "");
        const tag = `<img src="${r.src}" alt="${alt}" width="${width}" style="max-width:100%;height:auto">`;
        html = html.slice(0, at) + tag + html.slice(at);
        at += tag.length;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    onChange(html);
    setBusy(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at, at);
    });
  }

  const button = (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        title="Insert image (or paste / drop one into the box)"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
        {busy ? "Uploading…" : "Insert image"}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void insert(files);
        }}
      />
    </>
  );

  const boxProps = {
    onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
      const files = imageFiles(e.clipboardData.files);
      if (!files.length) return;
      e.preventDefault();
      void insert(files);
    },
    onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
      const files = imageFiles(e.dataTransfer.files);
      if (!files.length) return;
      e.preventDefault();
      void insert(files);
    },
  };

  return { button, boxProps, busy, error };
}

function naturalWidth(src: string) {
  return new Promise<number>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth || INSERT_WIDTH);
    img.onerror = () => resolve(INSERT_WIDTH);
    img.src = src;
  });
}
