"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        {/* Production builds replace server error messages with a generic React
            one; the digest is what appears in the server logs instead. */}
        {error.digest && process.env.NODE_ENV === "production"
          ? "The server hit an error while loading this page. Try again, or pass the reference below to whoever runs the help desk."
          : error.message}
      </p>
      {error.digest && (
        <p className="text-xs text-[var(--muted-foreground)]">
          Reference: <code>{error.digest}</code>
        </p>
      )}
      <button
        onClick={reset}
        className="self-start rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--accent)]"
      >
        Try again
      </button>
    </div>
  );
}
