/**
 * Debate formats as data (PRD §7). A round tells the pipeline what to emphasise
 * and gives the round detector the moderator cues that open it. Durations come
 * from the source; `optional` rounds may be skipped without breaking the format.
 *
 * Anti-Debate: from the Synthesis Media how-to guide (shorter and longer
 * versions agree on sequence and durations). See docs/client/anti-debate-how-to-guide.md.
 */

/** Seat in the format, bound to participant keys per session (`session.started.format.seats`). */
export type Seat = 'aff' | 'neg' | 'moderator' | 'audience';

export type PipelineEmphasis =
  | 'positions' // what each side holds and why
  | 'clash' // rebuttals, direct disagreement, questions
  | 'steelman' // one side voicing the other: never commits the speaker
  | 'update_conditions' // "what would change my mind": crux material
  | 'synthesis' // higher ground, shared ground
  | 'updates'; // how positions moved

export type Phase = 'clarifying_difference' | 'exploring_synthesis' | 'taking_stock';

export interface RoundDef {
  id: string;
  name: string;
  phase: Phase;
  /** Planned length in ms; the upper bound when the source gives a range. */
  plannedMs: number | null;
  /** Speaking order within the round. `both` = open exchange. */
  speakingOrder: Array<Seat | 'both'>;
  optional: boolean;
  pipelineEmphasis: PipelineEmphasis[];
  /** Phrases a moderator typically uses to open the round (for live round detection). */
  cues: string[];
}

export interface FormatDef {
  id: string;
  name: string;
  source: string;
  plannedMs: number;
  phases: Array<{ id: Phase; name: string; plannedMs: number }>;
  rounds: RoundDef[];
}

const min = (m: number) => m * 60_000;

export const ANTI_DEBATE: FormatDef = {
  id: 'anti-debate',
  name: 'Anti-Debate',
  source: 'https://www.anti-debate.org/how-to-guide.html (Synthesis Media)',
  plannedMs: min(90),
  phases: [
    { id: 'clarifying_difference', name: 'Clarifying Difference', plannedMs: min(45) },
    { id: 'exploring_synthesis', name: 'Exploring Synthesis', plannedMs: min(30) },
    { id: 'taking_stock', name: 'Taking Stock', plannedMs: min(15) },
  ],
  rounds: [
    { id: 'intro', name: 'Introduction', phase: 'clarifying_difference', plannedMs: min(4), speakingOrder: ['moderator'], optional: false, pipelineEmphasis: [], cues: ['welcome', 'anti-debate', 'three phases'] },
    { id: 'pre_poll', name: 'Pre-Poll', phase: 'clarifying_difference', plannedMs: min(2), speakingOrder: ['audience'], optional: true, pipelineEmphasis: [], cues: ['poll', 'on a scale of one to five'] },
    { id: 'connection', name: 'Connection Before Content', phase: 'clarifying_difference', plannedMs: min(6), speakingOrder: ['neg', 'aff'], optional: true, pipelineEmphasis: ['positions'], cues: ['why do you personally care', 'why this topic means so much'] },
    { id: 'openings', name: 'Opening Statements', phase: 'clarifying_difference', plannedMs: min(12), speakingOrder: ['aff', 'neg'], optional: false, pipelineEmphasis: ['positions'], cues: ['opening statement', 'up to six minutes', 'make your case'] },
    { id: 'rebuttals', name: 'Rebuttals', phase: 'clarifying_difference', plannedMs: min(6), speakingOrder: ['aff', 'neg'], optional: false, pipelineEmphasis: ['clash'], cues: ['rebuttal', 'three minutes each'] },
    { id: 'open_debate', name: 'Open Debate', phase: 'clarifying_difference', plannedMs: min(10), speakingOrder: ['both'], optional: false, pipelineEmphasis: ['clash', 'positions'], cues: ['open debate', 'go at it', 'free-flowing'] },
    // Adapted formats: moderators often run a phase in their own structure (e.g. trust and values, then scenarios).
    { id: 'difference_adapted', name: 'Clarifying Difference (moderator\'s own structure)', phase: 'clarifying_difference', plannedMs: null, speakingOrder: ['both'], optional: true, pipelineEmphasis: ['positions', 'clash'], cues: ['what do you agree with, disagree with', 'section one'] },
    { id: 'synthesis_adapted', name: 'Exploring Synthesis (moderator\'s own structure)', phase: 'exploring_synthesis', plannedMs: null, speakingOrder: ['moderator', 'both'], optional: true, pipelineEmphasis: ['synthesis', 'update_conditions'], cues: ['next phase', 'section two', 'set aside the yes but', 'go one level deeper', 'scenarios', 'your relationship to'] },
    { id: 'steelman', name: 'Steel-Manning Each Other', phase: 'exploring_synthesis', plannedMs: min(12), speakingOrder: ['neg', 'aff', 'neg', 'aff', 'aff', 'neg', 'aff', 'neg'], optional: false, pipelineEmphasis: ['steelman'], cues: ['steel-man', 'steelman', 'strongest version', 'clarifying question'] },
    { id: 'red_team', name: 'Red-Teaming Ourselves', phase: 'exploring_synthesis', plannedMs: min(8), speakingOrder: ['aff', 'neg', 'neg', 'aff'], optional: false, pipelineEmphasis: ['update_conditions'], cues: ['red-team', 'red team', 'change your position', 'change your mind', 'weaknesses in your own'] },
    { id: 'integration', name: 'Exploring Integration', phase: 'exploring_synthesis', plannedMs: min(12), speakingOrder: ['moderator', 'both'], optional: false, pipelineEmphasis: ['synthesis'], cues: ['integration', 'both/and', 'under what circumstances', 'perverse incentives', 'synthesis'] },
    { id: 'audience_synthesis', name: 'Audience Participation', phase: 'exploring_synthesis', plannedMs: min(5), speakingOrder: ['audience'], optional: true, pipelineEmphasis: ['synthesis'], cues: ['points of synthesis from the audience'] },
    { id: 'check_in', name: 'Personal Check-In', phase: 'taking_stock', plannedMs: min(2), speakingOrder: ['aff', 'neg'], optional: true, pipelineEmphasis: [], cues: ['how do you feel right now'] },
    { id: 'contemplation', name: 'Contemplation', phase: 'taking_stock', plannedMs: min(2), speakingOrder: [], optional: true, pipelineEmphasis: [], cues: ['moment of silence', 'contemplation', 'reflect'] },
    { id: 'closings', name: 'Closing Statements', phase: 'taking_stock', plannedMs: min(8), speakingOrder: ['neg', 'aff'], optional: false, pipelineEmphasis: ['updates', 'synthesis'], cues: ['closing statement', 'how has your position expanded'] },
    { id: 'post_poll', name: 'Post-Poll', phase: 'taking_stock', plannedMs: min(2), speakingOrder: ['audience'], optional: true, pipelineEmphasis: [], cues: ['poll again'] },
    { id: 'outro', name: 'Outro', phase: 'taking_stock', plannedMs: min(5), speakingOrder: ['moderator'], optional: false, pipelineEmphasis: ['synthesis'], cues: ['thank you both', 'what we learned', 'round of applause'] },
    { id: 'qa', name: 'Audience Q&A', phase: 'taking_stock', plannedMs: null, speakingOrder: ['audience', 'both'], optional: true, pipelineEmphasis: ['clash'], cues: ['questions from the audience', 'q&a', 'mic'] },
  ],
};

/** Unstructured conversation: one open round. Used for podcasts and fixtures without a format. */
export const OPEN_DIALOGUE: FormatDef = {
  id: 'open',
  name: 'Open dialogue',
  source: 'built-in',
  plannedMs: min(90),
  phases: [{ id: 'clarifying_difference', name: 'Conversation', plannedMs: min(90) }],
  rounds: [{ id: 'open', name: 'Open dialogue', phase: 'clarifying_difference', plannedMs: null, speakingOrder: ['both'], optional: false, pipelineEmphasis: ['positions', 'clash', 'synthesis'], cues: [] }],
};

export const FORMATS: Record<string, FormatDef> = { [ANTI_DEBATE.id]: ANTI_DEBATE, [OPEN_DIALOGUE.id]: OPEN_DIALOGUE };

export function getFormat(id: string): FormatDef {
  return FORMATS[id] ?? OPEN_DIALOGUE;
}

export function roundDef(formatId: string, roundId: string): RoundDef | undefined {
  return getFormat(formatId).rounds.find((r) => r.id === roundId);
}
