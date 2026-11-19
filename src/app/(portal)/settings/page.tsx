import { requireAgent } from "@/lib/auth";
import { SignatureEditor } from "@/components/signature-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/** Your own settings. Notifications and theme also live in the avatar menu. */
export default async function SettingsPage() {
  const { agent } = await requireAgent();
  return (
    <div className="max-w-3xl p-6">
      <h1 className="mb-1 text-base font-semibold">Settings</h1>
      <p className="mb-5 text-xs text-[var(--muted-foreground)]">
        Only you see these. Email notifications and your theme are in the menu under your name.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Signature</CardTitle>
          <CardDescription>Added to the end of every reply and new message you send.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignatureEditor name={agent.name} saved={agent.signature} />
        </CardContent>
      </Card>
    </div>
  );
}
