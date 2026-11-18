"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { HtmlBody } from "@/components/message-body";
import { useSignatureImages } from "@/components/signature-image";
import { setSignature } from "@/lib/actions/views";
import { MAX_SIGNATURE_LENGTH, signatureBlock } from "@/lib/signature";
import { TEAM_NAME } from "@/lib/utils";

const EXAMPLE = `<p style="margin:0">
  <strong>Your Name</strong><br>
  Technology Help Desk<br>
  <a href="https://example.org">example.org</a>
</p>`;

/** Edit my reply signature as HTML, with a live preview of how a reply ends. */
export function SignatureEditor({ name, saved }: { name: string; saved: string | null }) {
  const [html, setHtml] = useState(saved ?? "");
  const [savedHtml, setSavedHtml] = useState(saved ?? "");
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const dirty = html !== savedHtml;
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const images = useSignatureImages({
    textarea: boxRef,
    value: html,
    onChange: (next) => {
      setHtml(next);
      setMessage({});
    },
  });

  const preview =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#1f2328">` +
    `<div>Hi Pat,</div><div><br></div><div>Thanks for letting us know. We're looking into it now.</div>` +
    signatureBlock({ name, signature: html }, TEAM_NAME).html +
    `</div>`;

  function save(value: string) {
    start(async () => {
      const r = await setSignature(value);
      setMessage(r);
      if (r.ok) {
        setHtml(value);
        setSavedHtml(value);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-xs font-medium">
        HTML
        <Textarea
          ref={boxRef}
          {...images.boxProps}
          value={html}
          onChange={(e) => {
            setHtml(e.target.value);
            setMessage({});
          }}
          placeholder={EXAMPLE}
          rows={9}
          spellCheck={false}
          maxLength={MAX_SIGNATURE_LENGTH}
          className="font-mono text-xs leading-relaxed"
        />
        <span className="font-normal text-[var(--muted-foreground)]">
          Formatting, links and images are kept; scripts and forms are removed. Insert image (or
          paste one into the box) to add a logo; it&apos;s sent inside each email, so recipients
          see it without loading pictures. Leave this empty to use the default signature.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending || images.busy || !dirty} onClick={() => save(html)}>
          {pending ? "Saving…" : "Save signature"}
        </Button>
        {savedHtml && (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => save("")}>
            Use the default
          </Button>
        )}
        {dirty && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setHtml(savedHtml)}>
            Discard changes
          </Button>
        )}
        {message.ok && !dirty && <span className="text-xs text-[var(--muted-foreground)]">{message.ok}</span>}
        <span className="ml-auto">{images.button}</span>
        {message.error && <span className="text-xs text-[var(--destructive)]">{message.error}</span>}
        {images.error && <span className="w-full text-xs text-[var(--destructive)]">{images.error}</span>}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium">Preview</p>
        <div className="rounded-lg border border-[var(--border)] p-3">
          <HtmlBody html={preview} />
        </div>
        <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
          Every reply and new message you send ends with this.
        </p>
      </div>
    </div>
  );
}
