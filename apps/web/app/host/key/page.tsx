import type { Metadata } from 'next';
import { KeyForm } from './KeyForm';

export const metadata: Metadata = { title: 'Your Anthropic key · Anti-Debate Live' };

export default function KeyPage() {
  return (
    <main className="min-h-dvh bg-field">
      <div className="mx-auto max-w-2xl px-6 pb-20 pt-16">
        <h1 className="text-[30px] leading-tight text-ink">Connect your Anthropic key</h1>
        <p className="mt-3 text-[15px] text-ink-2">The analysis runs on Claude and is paid for by your own Anthropic account. Your key stays in this browser and goes only to Anthropic.</p>
        <ol className="mt-8 list-decimal space-y-4 pl-5 text-[15px] text-ink">
          <li>Create an account at <a className="underline" href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>. Do this a few days before your event: new accounts can start with lower limits.</li>
          <li>Open <strong>Billing</strong> and buy credits. $25 is a comfortable start: a 90-minute debate used about $12–15 in our measurements (2026-09-28).</li>
          <li>Open <strong>API keys</strong>, choose <strong>Create key</strong>, and name it “antidebate”. Optional: create it in its own workspace and set a monthly spend limit there.</li>
          <li>Copy the key (it starts with <code>sk-ant-</code>) and paste it below.</li>
        </ol>
        <div className="mt-10">
          <KeyForm />
        </div>
        <p className="mt-8 text-sm text-ink-3">Anyone who uses this browser profile can run sessions on this key. On a shared computer, choose Forget key when you finish.</p>
      </div>
    </main>
  );
}
