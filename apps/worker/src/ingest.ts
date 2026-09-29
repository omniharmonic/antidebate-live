/**
 * Ingest any recorded debate (docs/R0_DEMO.md):
 *   URL → audio (yt-dlp) → FluidAudio ASR + diarization (services/capture offline)
 *   → proposed speaker identities (model reads self-introductions + video metadata)
 *   → fixtures/antidebate/<slug>/manifest.json, ready for `run:session --fixture <slug>`.
 *
 *   pnpm --filter @adl/worker ingest -- --url https://www.youtube.com/watch?v=… --slug open-source-ai
 *   pnpm --filter @adl/worker ingest -- --slug open-source-ai --confirm     # accept the proposed speakers
 *
 * Nothing is attributed to a named person until the operator confirms (AGENTS.md).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { z } from 'zod';
import { callStructured } from '@adl/llm';
import { REPO_ROOT } from './sources';

config({ path: `${REPO_ROOT}.env`, quiet: true });

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    url: { type: 'string' },
    slug: { type: 'string' },
    format: { type: 'string', default: 'anti-debate' },
    confirm: { type: 'boolean', default: false },
  },
});
if (!values.slug) throw new Error('--slug is required');
const dir = `${REPO_ROOT}fixtures/antidebate/${values.slug}`;
const manifestPath = `${dir}/manifest.json`;

interface Manifest {
  slug: string;
  programStartMs?: number;
  title: string;
  format: string;
  moderator?: { key: string; displayName: string };
  moderators?: { key: string; displayName: string }[];
  participants: { key: string; displayName: string }[];
  seats?: Record<string, 'aff' | 'neg' | 'moderator'>;
  speakerMap?: Record<string, string>;
  speakerMapEvidence?: Record<string, unknown>;
  sources: { video?: string };
  media: Record<string, string>;
}

if (values.confirm) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  m.speakerMapEvidence = { ...(m.speakerMapEvidence ?? {}), confirmedBy: 'operator (ingest --confirm)', confirmedAt: new Date().toISOString() };
  writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
  console.log(`confirmed speakers for ${values.slug}: ${JSON.stringify(m.speakerMap)}`);
  process.exit(0);
}

const sh = (cmd: string, args: string[], cwd = REPO_ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

// 1. Audio
mkdirSync(dir, { recursive: true });
if (!existsSync(`${dir}/audio.16k.wav`)) {
  if (!values.url) throw new Error('--url is required for a new slug');
  sh('uvx', ['--with', 'curl_cffi', '--with', 'yt-dlp-ejs', 'yt-dlp', '--js-runtimes', 'node', '-f', 'bestaudio[ext=m4a]/bestaudio', '-x', '--audio-format', 'm4a', '--write-info-json', '-o', `${dir}/audio.%(ext)s`, values.url]);
  sh('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${dir}/audio.m4a`, '-ac', '1', '-ar', '16000', `${dir}/audio.16k.wav`]);
}

// 2. Transcript (FluidAudio; reuses outputs if present)
sh('uv', ['run', 'python', '-m', 'adl_capture.offline', dir], `${REPO_ROOT}services/capture`);
const utterances = (JSON.parse(readFileSync(`${dir}/transcript.utterances.json`, 'utf8')) as { utterances: { speaker: string; startMs: number; endMs: number; text: string }[] }).utterances;

// 3. Speaker identities from self-introductions and metadata
const info = existsSync(`${dir}/audio.info.json`) ? (JSON.parse(readFileSync(`${dir}/audio.info.json`, 'utf8')) as { title?: string; description?: string; webpage_url?: string }) : {};
const byLabel = new Map<string, typeof utterances>();
for (const u of utterances) byLabel.set(u.speaker, [...(byLabel.get(u.speaker) ?? []), u]);
const minutes = (l: string) => (byLabel.get(l) ?? []).reduce((n, u) => n + (u.endMs - u.startMs), 0) / 60000;
const sample = [...byLabel.keys()]
  .sort((a, b) => minutes(b) - minutes(a))
  .map((label) => {
    const us = byLabel.get(label)!;
    const intro = us.filter((u) => /\b(I|I'm|my|me)\b/.test(u.text)).slice(0, 12);
    const lines = [...new Set([...us.slice(0, 6), ...intro])].map((u) => `  [${(u.startMs / 60000).toFixed(1)}m] ${u.text.slice(0, 300)}`);
    return `${label} (${minutes(label).toFixed(1)} min, ${us.length} utterances):\n${lines.join('\n')}`;
  })
  .join('\n\n');
// Everyone the transcript names, for cross-reference ("Daniel, you go first").
const firstLines = utterances.slice(0, 40).map((u) => `[${u.speaker}] ${u.text.slice(0, 240)}`).join('\n');

const SpeakerOut = z.object({
  title: z.string().describe('Short title for the debate'),
  programStartMinute: z.number().nullable().describe('Minute where the event itself begins (the host\'s welcome, including introductions), after any teaser montage of clips, trailer or narrated preface; null if it begins immediately'),
  speakers: z.array(
    z.object({
      label: z.string(),
      displayName: z.string().nullable().describe('Full name, or null if not identifiable'),
      role: z.enum(['debater', 'moderator', 'audience', 'unknown']),
      seat: z.enum(['aff', 'neg', 'moderator', 'none']).describe('aff = the debater who opens first in the format'),
      evidence: z.string().describe('Verbatim words that identify them, with the minute'),
    }),
  ),
});
const res = await callStructured({
  pass: 'speaker_id',
  promptVersion: 'speaker-id-v0.1',
  instructions: `You identify speakers in a diarized transcript of a moderated debate. Speaker labels (S1, S2, …) come from automatic diarization. For each label, decide who it is from what they say about themselves, how others address them, and the video metadata. Moderators introduce the debaters and keep time; audience members ask short questions late. Several labels can be the same person. Spell names as the video title/description do (ASR often misspells them). Give verbatim evidence. Also give the minute where the event itself starts, if the recording opens with a teaser, trailer or narrated preface. If the evidence is weak, set displayName null and role unknown. Return only the JSON object required by the schema.`,
  input: `VIDEO TITLE: ${info.title ?? '(none)'}\nVIDEO DESCRIPTION: ${(info.description ?? '').slice(0, 1500)}\n\nOPENING OF THE TRANSCRIPT:\n${firstLines}\n\nSAMPLES PER LABEL:\n${sample}`,
  schema: SpeakerOut,
});
if (!res.ok) throw new Error(`speaker identification failed: ${res.reason} ${res.detail}`);

// 4. Manifest: one key per person; labels map to keys.
const people = new Map<string, { key: string; role: string; seat: string; labels: string[]; evidence: string[] }>();
let n = 0;
for (const s of res.data.speakers) {
  if (!s.displayName || s.role === 'unknown' || s.role === 'audience') continue;
  const mods = [...people.values()].filter((x) => x.role === 'moderator').length;
  const p = people.get(s.displayName) ?? { key: s.role === 'moderator' ? (mods ? `MOD${mods + 1}` : 'MOD') : String.fromCharCode(65 + n++), role: s.role, seat: s.seat, labels: [], evidence: [] };
  p.labels.push(s.label);
  p.evidence.push(`${s.label}: ${s.evidence}`);
  people.set(s.displayName, p);
}
const manifest: Manifest = {
  slug: values.slug,
  title: res.data.title,
  format: values.format!,
  participants: [...people].filter(([, p]) => p.role === 'debater').map(([displayName, p]) => ({ key: p.key, displayName })),
  ...(() => {
    const mods = [...people].filter(([, p]) => p.role === 'moderator').map(([displayName, p]) => ({ key: p.key, displayName }));
    return mods.length === 1 ? { moderator: mods[0]! } : mods.length ? { moderators: mods } : {};
  })(),
  seats: Object.fromEntries([...people.values()].filter((p) => p.seat !== 'none').map((p) => [p.key, p.seat as 'aff' | 'neg' | 'moderator'])),
  speakerMap: Object.fromEntries([...people.values()].flatMap((p) => p.labels.map((l) => [l, p.key]))),
  speakerMapEvidence: { method: 'model proposal from self-identification and metadata (speaker-id-v0.1)', ...Object.fromEntries([...people].map(([name, p]) => [name, p.evidence.join(' | ')])), confirmedBy: null },
  ...(res.data.programStartMinute ? { programStartMs: Math.max(0, Math.round(res.data.programStartMinute * 60_000) - 5000) } : {}),
  sources: { ...(values.url ? { video: values.url } : info.webpage_url ? { video: info.webpage_url } : {}) },
  media: { audio: 'audio.m4a', transcript: 'transcript.utterances.json', status: 'transcribed' },
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n${manifest.title}`);
for (const [name, p] of people) console.log(`  ${p.key} ${name} (${p.role}, ${p.seat}) ← ${p.labels.join(', ')}`);
console.log(`\nwrote ${manifestPath.replace(REPO_ROOT, '')}. Check the speakers, then:\n  pnpm --filter @adl/worker ingest -- --slug ${values.slug} --confirm\n  pnpm --filter @adl/worker run:session -- --fixture ${values.slug} --speed 1`);
