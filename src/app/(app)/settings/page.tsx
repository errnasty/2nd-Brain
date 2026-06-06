import { requireUser } from "@/lib/auth";
import { SettingsForm } from "@/components/settings/settings-form";
import { SettingsShortcuts } from "@/components/shell/keyboard-shortcuts";

export default async function SettingsPage() {
  const { user } = await requireUser();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
        </header>
        <SettingsForm />
        <div className="mt-8">
          <SettingsShortcuts />
        </div>
      </div>
    </div>
  );
}
