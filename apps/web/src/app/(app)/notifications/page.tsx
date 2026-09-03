import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Notifications' };

export default function Page() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Notifications</h1>
      <p className="text-muted-foreground mt-2">Notifications content coming soon.</p>
    </div>
  );
}

